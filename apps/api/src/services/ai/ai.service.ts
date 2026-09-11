import { eq, and, isNull } from 'drizzle-orm';
import type { ExplainRequest, ExplainResponse, ExplainTopic } from '@archlens/shared';
import { db } from '../../db/index.js';
import { aiExplanations } from '../../db/schema.js';
import { repositoryService, RepositoryService } from '../repository.service.js';
import type { IAIProvider } from './provider.interface.js';
import { AIProviderFactory } from './provider.factory.js';
import { ContextBuilder } from './context-builder.js';
import { EvidenceValidator } from './evidence-validator.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';

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

  constructor(
    customProvider?: IAIProvider,
    customRepoService?: RepositoryService,
    customRetrievalService?: RetrievalService
  ) {
    this.provider = customProvider || AIProviderFactory.create();
    this.repoService = customRepoService || repositoryService;
    this.retrievalService =
      customRetrievalService ||
      new RetrievalService(undefined, undefined, undefined, this.repoService);
  }

  async explain(owner: string, repo: string, request: ExplainRequest): Promise<ExplainResponse> {
    const cleanOwner = owner.trim();
    const cleanRepo = repo.trim().replace(/\.git$/, '');
    const cleanTopic = request.topic;
    const cleanTarget = request.target ? request.target.trim() : null;

    // 1. Verify that repository has an existing deterministic analysis
    const latestRecord = await this.repoService.getLatestAnalysisWithRecord(cleanOwner, cleanRepo);
    if (!latestRecord) {
      throw new RepositoryNotAnalyzedError(cleanOwner, cleanRepo);
    }

    const { analysis, analysisId } = latestRecord;

    // 2. Check cache in PostgreSQL
    const targetFilter = cleanTarget
      ? eq(aiExplanations.target, cleanTarget)
      : isNull(aiExplanations.target);

    const [cached] = await db
      .select()
      .from(aiExplanations)
      .where(
        and(
          eq(aiExplanations.analysisId, analysisId),
          eq(aiExplanations.topic, cleanTopic),
          targetFilter
        )
      )
      .limit(1);

    if (cached) {
      return {
        topic: cached.topic as ExplainTopic,
        target: cached.target,
        summary: cached.summary,
        explanation: cached.explanation,
        keyTakeaways: cached.keyTakeaways,
        evidence: cached.evidence,
        generatedAt: cached.createdAt.toISOString(),
        provider: cached.provider,
        model: cached.model,
        cached: true,
      };
    }

    // 3. Fetch optional landmark content (e.g. README.md) for contextual grounding
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
      // README fetch is optional; continue if missing or rate limited
    }

    // 4. Fetch optional semantic retrieval chunks for localized architectural context
    let retrievedChunks:
      { filePath: string; startLine: number; endLine: number; content: string }[] | undefined;
    if (cleanTarget || cleanTopic === 'entrypoints' || cleanTopic === 'architecture') {
      try {
        const searchQuery =
          cleanTarget ||
          (cleanTopic === 'entrypoints'
            ? 'application startup entrypoint bootstrap listener'
            : 'architectural modular pattern boundaries');
        const searchRes = await this.retrievalService.search(
          cleanOwner,
          cleanRepo,
          { query: searchQuery, limit: 3, pathPrefix: cleanTarget || undefined },
          analysisId
        );
        if (searchRes.results.length > 0) {
          retrievedChunks = searchRes.results.map((r) => ({
            filePath: r.filePath,
            startLine: r.startLine,
            endLine: r.endLine,
            content: r.content,
          }));
        }
      } catch {
        // Retrieval is complementary; continue gracefully on any error
      }
    }

    // 5. Build prompt-injection-safe bounded context
    const groundedContext = ContextBuilder.build({
      analysis,
      topic: cleanTopic,
      target: cleanTarget,
      readmeExcerpt,
      retrievedChunks,
    });

    // 5. Query AI provider
    const result = await this.provider.explain({
      topic: cleanTopic,
      target: cleanTarget,
      context: groundedContext.combinedContext,
      repoName: `${cleanOwner}/${cleanRepo}`,
      analysis,
    });

    // 6. Validate evidence citations strictly against Phase 2 facts
    const validatedEvidence = EvidenceValidator.validate(result.evidence || [], analysis);

    const now = new Date();

    // 7. Cache explanation in PostgreSQL
    try {
      await db
        .insert(aiExplanations)
        .values({
          analysisId,
          topic: cleanTopic,
          target: cleanTarget,
          summary: result.summary,
          explanation: result.explanation,
          keyTakeaways: result.keyTakeaways,
          evidence: validatedEvidence,
          provider: result.provider,
          model: result.model,
          createdAt: now,
        })
        .onConflictDoNothing();
    } catch {
      // Non-critical: if concurrent duplicate insert occurs, ignore
    }

    return {
      topic: cleanTopic,
      target: cleanTarget,
      summary: result.summary,
      explanation: result.explanation,
      keyTakeaways: result.keyTakeaways,
      evidence: validatedEvidence,
      generatedAt: now.toISOString(),
      provider: result.provider,
      model: result.model,
      cached: false,
    };
  }
}

export const aiService = new AIService();
