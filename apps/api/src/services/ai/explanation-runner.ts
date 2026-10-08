import { db } from '../../db/index.js';
import { aiExplanations } from '../../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import type { ExplainTopic } from '@archlens/shared';
import {
  AIRateLimitError,
  AITemporaryUnavailableError,
} from './provider.interface.js';
import type { AIService } from './ai.service.js';
import { sanitizeErrorMessage } from './sanitize-error.js';

export function calculateBackoffMs(attemptCount: number): number {
  if (attemptCount <= 1) return 60_000;       // 1 min
  if (attemptCount === 2) return 120_000;     // 2 min
  if (attemptCount === 3) return 300_000;     // 5 min
  return 600_000;                             // 10 min
}

export interface ExplanationJob {
  key: string;
  repoId: number;
  commitSha: string;
  owner: string;
  repo: string;
  topic: ExplainTopic;
  target: string | null;
  promptVersion: number;
  analysisId?: number | null;
  abortController: AbortController;
}

export class ExplanationRunner {
  private queue: ExplanationJob[] = [];
  private activeJobs = new Map<string, ExplanationJob>();
  private concurrencyLimit: number;
  private aiService: AIService | null = null;

  constructor(concurrencyLimit = 2, aiService?: AIService) {
    this.concurrencyLimit = concurrencyLimit;
    if (aiService) {
      this.aiService = aiService;
    }
  }

  setAiService(service: AIService): void {
    this.aiService = service;
  }

  getLogicalKey(
    repoId: number,
    commitSha: string,
    topic: string,
    target?: string | null,
    promptVersion = 1
  ): string {
    return `${repoId}:${commitSha}:${topic}:${target || ''}:${promptVersion}`;
  }

  isJobActiveOrQueued(key: string): boolean {
    return this.activeJobs.has(key) || this.queue.some((j) => j.key === key);
  }

  enqueue(job: Omit<ExplanationJob, 'key' | 'abortController'>): boolean {
    const key = this.getLogicalKey(
      job.repoId,
      job.commitSha,
      job.topic,
      job.target,
      job.promptVersion
    );
    if (this.isJobActiveOrQueued(key)) {
      return false;
    }

    const fullJob: ExplanationJob = {
      ...job,
      key,
      abortController: new AbortController(),
    };

    this.queue.push(fullJob);
    this.processNext();
    return true;
  }

  private async processNext(): Promise<void> {
    if (this.activeJobs.size >= this.concurrencyLimit || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    if (!job) return;

    this.activeJobs.set(job.key, job);

    (async () => {
      try {
        if (!this.aiService) {
          throw new Error('AIService not attached to ExplanationRunner.');
        }

        const result = await this.aiService.generateExplanation(
          job.owner,
          job.repo,
          job.topic,
          job.target,
          job.promptVersion,
          job.abortController.signal
        );

        const targetFilter = job.target
          ? eq(aiExplanations.target, job.target)
          : isNull(aiExplanations.target);

        await db
          .update(aiExplanations)
          .set({
            status: 'ready',
            summary: result.summary,
            explanation: result.explanation,
            keyTakeaways: result.keyTakeaways,
            evidence: result.evidence,
            provider: result.provider,
            model: result.model,
            lastErrorCategory: null,
            lastErrorMessage: null,
            retryAt: null,
          })
          .where(
            and(
              eq(aiExplanations.repositoryId, job.repoId),
              eq(aiExplanations.commitSha, job.commitSha),
              eq(aiExplanations.topic, job.topic),
              targetFilter,
              eq(aiExplanations.promptVersion, job.promptVersion)
            )
          );
      } catch (err: unknown) {
        const isAborted =
          job.abortController.signal.aborted ||
          (err instanceof Error &&
            (err.name === 'AbortError' || err.message.toLowerCase().includes('aborted')));
        const clientStatus = (err as any)?.status;
        const isAuth = clientStatus === 401;
        const isPermission = clientStatus === 403;
        const isRateLimit =
          err instanceof AIRateLimitError ||
          (err as any)?.isRateLimit === true ||
          clientStatus === 429;
        const is503 = err instanceof AITemporaryUnavailableError || clientStatus === 503;

        let category: string;
        let shouldRetry = true;

        if (isAborted) {
          category = 'abort';
          shouldRetry = false;
        } else if (isAuth) {
          category = 'auth';
          shouldRetry = false;
        } else if (isPermission) {
          category = 'permission';
          shouldRetry = false;
        } else if (isRateLimit) {
          category = 'rate_limit';
        } else if (is503) {
          category = 'unavailable';
        } else {
          category = 'error';
        }

        const targetFilter = job.target
          ? eq(aiExplanations.target, job.target)
          : isNull(aiExplanations.target);

        const [existing] = await db
          .select({ attemptCount: aiExplanations.attemptCount })
          .from(aiExplanations)
          .where(
            and(
              eq(aiExplanations.repositoryId, job.repoId),
              eq(aiExplanations.commitSha, job.commitSha),
              eq(aiExplanations.topic, job.topic),
              targetFilter,
              eq(aiExplanations.promptVersion, job.promptVersion)
            )
          )
          .limit(1);

        const attemptCount = (existing?.attemptCount || 0) + 1;
        const retryAt = shouldRetry
          ? new Date(Date.now() + calculateBackoffMs(attemptCount))
          : null;

        await db
          .update(aiExplanations)
          .set({
            status: 'failed',
            attemptCount,
            lastErrorCategory: category,
            lastErrorMessage: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
            retryAt,
          })
          .where(
            and(
              eq(aiExplanations.repositoryId, job.repoId),
              eq(aiExplanations.commitSha, job.commitSha),
              eq(aiExplanations.topic, job.topic),
              targetFilter,
              eq(aiExplanations.promptVersion, job.promptVersion)
            )
          );
      } finally {
        this.activeJobs.delete(job.key);
        this.processNext();
      }
    })();
  }

  cancel(key: string): void {
    const active = this.activeJobs.get(key);
    if (active) {
      active.abortController.abort();
      this.activeJobs.delete(key);
    }
    this.queue = this.queue.filter((j) => j.key !== key);
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getActiveJobsCount(): number {
    return this.activeJobs.size;
  }
}

export const explanationRunner = new ExplanationRunner();
