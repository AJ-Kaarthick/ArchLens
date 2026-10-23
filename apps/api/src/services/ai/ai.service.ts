import { eq, and, isNull, isNotNull, desc } from 'drizzle-orm';
import type {
  ExplainRequest,
  ExplainResponse,
  ExplainTopic,
  InsightResponse,
} from '@archlens/shared';
import { db } from '../../db/index.js';
import { aiExplanations } from '../../db/schema.js';
import { repositoryService, RepositoryService } from '../repository.service.js';
import type { IAIProvider, ProviderLogger } from './provider.interface.js';
import { AIProviderFactory } from './provider.factory.js';
import { ContextBuilder } from './context-builder.js';
import { EvidenceValidator } from './evidence-validator.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { explanationRunner, ExplanationRunner } from './explanation-runner.js';

export class RepositoryNotAnalyzedError extends Error {
  readonly status = 404;
  constructor(owner: string, repo: string) {
    super(`No analysis found for repository '${owner}/${repo}'. Please run an analysis first.`);
    this.name = 'RepositoryNotAnalyzedError';
  }
}

export class AIService {
  private provider: IAIProvider;
  private repoService: RepositoryService;
  private retrievalService: RetrievalService;
  private runner: ExplanationRunner;

  constructor(
    customProvider?: IAIProvider,
    customRepoService?: RepositoryService,
    customRetrievalService?: RetrievalService,
    customRunner?: ExplanationRunner
  ) {
    this.provider = customProvider || AIProviderFactory.create();
    this.repoService = customRepoService || repositoryService;
    this.retrievalService =
      customRetrievalService ||
      new RetrievalService(undefined, undefined, undefined, this.repoService);
    this.runner = customRunner || explanationRunner;
    this.runner.setAiService(this);
  }

  getRunner(): ExplanationRunner {
    return this.runner;
  }

  /**
   * Generates a fresh AI explanation synchronously without caching.
   * Basic explanation uses deterministic repository facts and optional landmark content (README).
   */
  async generateExplanation(
    owner: string,
    repo: string,
    topic: ExplainTopic,
    target?: string | null,
    _promptVersion = 1,
    signal?: AbortSignal,
    logger?: ProviderLogger
  ): Promise<ExplainResponse> {
    const cleanOwner = owner.trim();
    const cleanRepo = repo.trim().replace(/\.git$/, '');
    const cleanTarget = target ? target.trim() : null;
    const overallDeadline = Date.now() + 18000;

    const latestRecord = await this.repoService.getLatestAnalysisWithRecord(cleanOwner, cleanRepo);
    if (!latestRecord) {
      throw new RepositoryNotAnalyzedError(cleanOwner, cleanRepo);
    }

    const { analysis } = latestRecord;

    if (signal?.aborted) {
      throw new Error('AI explanation request was aborted.');
    }

    // Optional README for contextual grounding
    let readmeExcerpt: string | null = null;
    try {
      const readme = await this.repoService.getLandmarkContent(
        cleanOwner,
        cleanRepo,
        'README.md',
        analysis.commitSha || undefined
      );
      if (readme && readme.content) {
        readmeExcerpt = readme.content;
      }
    } catch {
      // README is complementary; proceed if unavailable
    }

    if (signal?.aborted) {
      throw new Error('AI explanation request was aborted.');
    }

    // Grounded prompt-injection-safe bounded context
    const groundedContext = ContextBuilder.build({
      analysis,
      topic,
      target: cleanTarget,
      readmeExcerpt,
    });

    if (signal?.aborted) {
      throw new Error('AI explanation request was aborted.');
    }

    const result = await this.provider.explain({
      topic,
      target: cleanTarget,
      context: groundedContext.combinedContext,
      repoName: `${cleanOwner}/${cleanRepo}`,
      analysis,
      signal,
      deadlineMs: overallDeadline,
      logger,
    });

    const validatedEvidence = EvidenceValidator.validate(result.evidence || [], analysis);

    return {
      topic,
      target: cleanTarget,
      summary: result.summary,
      explanation: result.explanation,
      keyTakeaways: result.keyTakeaways,
      evidence: validatedEvidence,
      generatedAt: new Date().toISOString(),
      provider: result.provider,
      model: result.model,
      cached: false,
    };
  }

  /**
   * Status-based asynchronous insight endpoint.
   * Returns immediately with 'ready', 'pending', 'failed', or 'disabled'.
   * Never forces user requests to wait for AI providers.
   */
  async getOrEnqueueInsight(
    owner: string,
    repo: string,
    topic: ExplainTopic,
    target?: string | null,
    promptVersion = 1,
    forceRetry = false
  ): Promise<InsightResponse> {
    const cleanOwner = owner.trim();
    const cleanRepo = repo.trim().replace(/\.git$/, '');
    const cleanTarget = target ? target.trim() : null;

    const latestRecord = await this.repoService.getLatestAnalysisWithRecord(cleanOwner, cleanRepo);
    if (!latestRecord) {
      throw new RepositoryNotAnalyzedError(cleanOwner, cleanRepo);
    }

    const { analysis, analysisId, repositoryId } = latestRecord;
    const commitSha = analysis.commitSha || 'unknown';

    // 1. If AI is not configured, report disabled immediately
    if (!AIProviderFactory.isConfigured()) {
      return {
        status: 'disabled',
        topic,
        target: cleanTarget,
        isStale: false,
        promptVersion,
      };
    }

    const targetFilter = cleanTarget
      ? eq(aiExplanations.target, cleanTarget)
      : isNull(aiExplanations.target);

    // Helper: look up older successful explanation on prior commit for this repo & topic
    const findOlderSuccessful = async (): Promise<ExplainResponse | null> => {
      const [older] = await db
        .select()
        .from(aiExplanations)
        .where(
          and(
            eq(aiExplanations.repositoryId, repositoryId),
            eq(aiExplanations.topic, topic),
            targetFilter,
            eq(aiExplanations.status, 'ready'),
            isNotNull(aiExplanations.summary)
          )
        )
        .orderBy(desc(aiExplanations.createdAt))
        .limit(1);

      if (!older || !older.summary || !older.explanation) return null;
      return {
        topic: older.topic as ExplainTopic,
        target: older.target,
        summary: older.summary,
        explanation: older.explanation,
        keyTakeaways: older.keyTakeaways || [],
        evidence: older.evidence || [],
        generatedAt: older.createdAt.toISOString(),
        provider: older.provider || 'gemini',
        model: older.model || 'unknown',
        cached: true,
      };
    };

    // 2. Check for explanation record for this exact logical key
    const [row] = await db
      .select()
      .from(aiExplanations)
      .where(
        and(
          eq(aiExplanations.repositoryId, repositoryId),
          eq(aiExplanations.commitSha, commitSha),
          eq(aiExplanations.topic, topic),
          targetFilter,
          eq(aiExplanations.promptVersion, promptVersion)
        )
      )
      .limit(1);

    if (row) {
      if (row.status === 'ready') {
        const MIN_COOLDOWN_MS = 60_000; // 1 minute cooldown per key
        const ageMs = Date.now() - new Date(row.createdAt).getTime();
        const isCooldownActive = ageMs < MIN_COOLDOWN_MS;

        if (!forceRetry || isCooldownActive) {
          if (row.summary && row.explanation) {
            return {
              status: 'ready',
              topic,
              target: cleanTarget,
              result: {
                topic: row.topic as ExplainTopic,
                target: row.target,
                summary: row.summary,
                explanation: row.explanation,
                keyTakeaways: row.keyTakeaways || [],
                evidence: row.evidence || [],
                generatedAt: row.createdAt.toISOString(),
                provider: row.provider || 'gemini',
                model: row.model || 'unknown',
                cached: true,
              },
              isStale: false,
              promptVersion,
            };
          }
        }

        await db
          .update(aiExplanations)
          .set({
            status: 'pending',
            retryAt: null,
            lastErrorCategory: null,
            lastErrorMessage: null,
          })
          .where(eq(aiExplanations.id, row.id));

        this.runner.enqueue({
          repoId: repositoryId,
          commitSha,
          owner: cleanOwner,
          repo: cleanRepo,
          topic,
          target: cleanTarget,
          promptVersion,
          analysisId,
        });

        const currentAsStale: ExplainResponse | null =
          row.summary && row.explanation
            ? {
                topic: row.topic as ExplainTopic,
                target: row.target,
                summary: row.summary,
                explanation: row.explanation,
                keyTakeaways: row.keyTakeaways || [],
                evidence: row.evidence || [],
                generatedAt: row.createdAt.toISOString(),
                provider: row.provider || 'gemini',
                model: row.model || 'unknown',
                cached: true,
              }
            : await findOlderSuccessful();

        return {
          status: 'pending',
          topic,
          target: cleanTarget,
          result: currentAsStale,
          isStale: Boolean(currentAsStale),
          promptVersion,
        };
      }

      if (row.status === 'pending') {
        this.runner.enqueue({
          repoId: repositoryId,
          commitSha,
          owner: cleanOwner,
          repo: cleanRepo,
          topic,
          target: cleanTarget,
          promptVersion,
          analysisId,
        });
        const older = await findOlderSuccessful();
        return {
          status: 'pending',
          topic,
          target: cleanTarget,
          result: older,
          isStale: Boolean(older),
          promptVersion,
        };
      }

      if (row.status === 'failed') {
        const isPastRetryAt = !row.retryAt || new Date() >= new Date(row.retryAt);
        if (isPastRetryAt) {
          await db
            .update(aiExplanations)
            .set({ status: 'pending', retryAt: null })
            .where(eq(aiExplanations.id, row.id));

          this.runner.enqueue({
            repoId: repositoryId,
            commitSha,
            owner: cleanOwner,
            repo: cleanRepo,
            topic,
            target: cleanTarget,
            promptVersion,
            analysisId,
          });

          const older = await findOlderSuccessful();
          return {
            status: 'pending',
            topic,
            target: cleanTarget,
            result: older,
            isStale: Boolean(older),
            promptVersion,
          };
        } else {
          // Explicit retry MUST respect retryAt backoff
          const older = await findOlderSuccessful();
          return {
            status: 'failed',
            topic,
            target: cleanTarget,
            result: older,
            isStale: Boolean(older),
            retryAt: row.retryAt?.toISOString() || null,
            error: {
              error: row.lastErrorCategory || 'AIExplanationFailed',
              message: row.lastErrorMessage || 'AI explanation generation failed.',
              isRateLimit: row.lastErrorCategory === 'rate_limit',
              suggestedAction: row.retryAt
                ? `Retry available after ${row.retryAt.toISOString()}`
                : 'Check server configuration or logs.',
            },
            promptVersion,
          };
        }
      }
    }

    // 3. No record exists yet: insert pending and enqueue in background
    await db
      .insert(aiExplanations)
      .values({
        repositoryId,
        analysisId,
        commitSha,
        topic,
        target: cleanTarget,
        promptVersion,
        status: 'pending',
        attemptCount: 0,
        createdAt: new Date(),
      })
      .onConflictDoNothing();

    this.runner.enqueue({
      repoId: repositoryId,
      commitSha,
      owner: cleanOwner,
      repo: cleanRepo,
      topic,
      target: cleanTarget,
      promptVersion,
      analysisId,
    });

    const older = await findOlderSuccessful();
    return {
      status: 'pending',
      topic,
      target: cleanTarget,
      result: older,
      isStale: Boolean(older),
      promptVersion,
    };
  }

  /**
   * Synchronous explain endpoint maintained for direct requests and testing.
   */
  async explain(
    owner: string,
    repo: string,
    request: ExplainRequest,
    signal?: AbortSignal,
    logger?: ProviderLogger
  ): Promise<ExplainResponse> {
    const cleanOwner = owner.trim();
    const cleanRepo = repo.trim().replace(/\.git$/, '');
    const cleanTopic = request.topic;
    const cleanTarget = request.target ? request.target.trim() : null;

    const latestRecord = await this.repoService.getLatestAnalysisWithRecord(cleanOwner, cleanRepo);
    if (!latestRecord) {
      throw new RepositoryNotAnalyzedError(cleanOwner, cleanRepo);
    }

    const { analysis, analysisId, repositoryId } = latestRecord;
    const promptVersion = 1;
    const commitSha = analysis.commitSha || 'unknown';

    const targetFilter = cleanTarget
      ? eq(aiExplanations.target, cleanTarget)
      : isNull(aiExplanations.target);

    const [cached] = await db
      .select()
      .from(aiExplanations)
      .where(
        and(
          eq(aiExplanations.repositoryId, repositoryId),
          eq(aiExplanations.commitSha, commitSha),
          eq(aiExplanations.topic, cleanTopic),
          targetFilter,
          eq(aiExplanations.promptVersion, promptVersion),
          eq(aiExplanations.status, 'ready')
        )
      )
      .limit(1);

    if (cached && cached.summary && cached.explanation) {
      return {
        topic: cached.topic as ExplainTopic,
        target: cached.target,
        summary: cached.summary,
        explanation: cached.explanation,
        keyTakeaways: cached.keyTakeaways || [],
        evidence: cached.evidence || [],
        generatedAt: cached.createdAt.toISOString(),
        provider: cached.provider || 'gemini',
        model: cached.model || 'unknown',
        cached: true,
      };
    }

    const result = await this.generateExplanation(
      cleanOwner,
      cleanRepo,
      cleanTopic,
      cleanTarget,
      promptVersion,
      signal,
      logger
    );

    const now = new Date();
    try {
      await db
        .insert(aiExplanations)
        .values({
          repositoryId,
          analysisId,
          commitSha,
          topic: cleanTopic,
          target: cleanTarget,
          promptVersion,
          status: 'ready',
          summary: result.summary,
          explanation: result.explanation,
          keyTakeaways: result.keyTakeaways,
          evidence: result.evidence,
          provider: result.provider,
          model: result.model,
          createdAt: now,
        })
        .onConflictDoNothing();
    } catch {
      // Ignore concurrent duplicate insert
    }

    return result;
  }
}

export const aiService = new AIService();
