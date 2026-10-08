import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AIService, RepositoryNotAnalyzedError } from './ai.service.js';
import type { IAIProvider, AIExplanationResult } from './provider.interface.js';
import { RepositoryService } from '../repository.service.js';
import type { RetrievalService } from '../retrieval/retrieval.service.js';
import { initDb, sql, db } from '../../db/index.js';
import { repositories, analyses, aiExplanations } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { AnalysisResult } from '@archlens/shared';
import { ResilientFallbackProvider } from './providers/resilient-fallback.provider.js';
import { CircuitBreaker } from './circuit-breaker.js';

describe('AIService', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('throws RepositoryNotAnalyzedError when repository has no analysis', async () => {
    const mockRepoService = {
      getLatestAnalysisWithRecord: vi.fn().mockResolvedValue(null),
    } as unknown as RepositoryService;

    const service = new AIService(undefined, mockRepoService);

    await expect(service.explain('nonexistent', 'repo', { topic: 'overview' })).rejects.toThrow(
      RepositoryNotAnalyzedError
    );
  });

  it('generates, caches in PostgreSQL, and serves cached explanations', async () => {
    const testOwner = `ai-test-${Date.now()}`;
    const testRepo = 'cached-repo';

    // Insert test repo and analysis into real DB
    const [repoRow] = await db
      .insert(repositories)
      .values({
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        description: 'Test caching repository',
        stars: 10,
        forks: 1,
        primaryLanguage: 'TypeScript',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const mockAnalysis: AnalysisResult = {
      repository: {
        id: String(repoRow.id),
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        description: 'Test caching repository',
        stars: 10,
        forks: 1,
        primaryLanguage: 'TypeScript',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      commitSha: 'sha123',
      techStack: [
        {
          category: 'framework',
          name: 'Fastify',
          version: '4.26.0',
          confidence: 'high',
          evidence: 'package.json',
        },
      ],
      architecture: {
        isMonorepo: false,
        monorepoTool: null,
        workspaces: [],
        detectedPatterns: ['Service-Repository'],
        primaryEntrypoints: ['src/server.ts'],
        keyLandmarks: [
          {
            path: 'package.json',
            name: 'package.json',
            type: 'manifest',
            description: 'Package manifest',
          },
        ],
      },

      metrics: {
        totalFiles: 10,
        totalBytes: 5000,
        languages: { TypeScript: { bytes: 5000, percentage: 100, fileCount: 10 } },
        categories: { source: { bytes: 5000, percentage: 100, fileCount: 10 } },
        largestFiles: [{ path: 'src/server.ts', size: 500 }],
      },
      tree: [],
      analyzedAt: new Date().toISOString(),
    };

    const [analysisRow] = await db
      .insert(analyses)
      .values({
        repositoryId: repoRow.id,
        commitSha: mockAnalysis.commitSha,
        techStack: mockAnalysis.techStack,
        architecture: mockAnalysis.architecture,
        metrics: mockAnalysis.metrics,
        tree: mockAnalysis.tree,
        analyzedAt: new Date(),
      })
      .returning();

    const mockResult: AIExplanationResult = {
      summary: 'Deterministic summary for caching test.',
      explanation: 'Architectural explanation for testing.',
      keyTakeaways: ['Takeaway 1', 'Takeaway 2'],
      evidence: [
        {
          type: 'manifest',
          label: 'Root Manifest',
          reference: 'package.json',
          description: 'Package config',
        },
      ],
      provider: 'mock-test',
      model: 'test-model',
    };

    const mockExplain = vi.fn().mockResolvedValue(mockResult);
    const mockProvider: IAIProvider = {
      name: 'mock-test',
      model: 'test-model',
      explain: mockExplain,
    };

    const mockRepoService = {
      getLatestAnalysisWithRecord: vi.fn().mockResolvedValue({
        analysis: mockAnalysis,
        analysisId: analysisRow.id,
        repositoryId: repoRow.id,
      }),
      getLandmarkContent: vi.fn().mockResolvedValue({ content: 'Mock README' }),
    } as unknown as RepositoryService;

    const mockRetrievalService = {
      search: vi.fn().mockResolvedValue({
        query: 'test',
        results: [],
        totalChunks: 0,
        executionTimeMs: 1,
      }),
    } as unknown as RetrievalService;

    const service = new AIService(mockProvider, mockRepoService, mockRetrievalService);

    // Call 1: Uncached -> Should invoke provider
    const res1 = await service.explain(testOwner, testRepo, { topic: 'overview' });
    expect(res1.cached).toBe(false);
    expect(res1.summary).toBe(mockResult.summary);
    expect(mockExplain).toHaveBeenCalledTimes(1);

    // Call 2: Same topic and target -> Should be served from PostgreSQL cache
    const res2 = await service.explain(testOwner, testRepo, { topic: 'overview' });
    expect(res2.cached).toBe(true);
    expect(res2.summary).toBe(mockResult.summary);
    expect(mockExplain).toHaveBeenCalledTimes(1); // Provider NOT called again!

    // Call 3: Different topic -> Should invoke provider again
    const res3 = await service.explain(testOwner, testRepo, { topic: 'architecture' });
    expect(res3.cached).toBe(false);
    expect(mockExplain).toHaveBeenCalledTimes(2);

    // Clean up
    await db.delete(aiExplanations).where(eq(aiExplanations.analysisId, analysisRow.id));
    await db.delete(analyses).where(eq(analyses.id, analysisRow.id));
    await db.delete(repositories).where(eq(repositories.id, repoRow.id));
  });

  it('filters out hallucinated citations and preserves only verified facts', async () => {
    const testOwner = `ai-grounding-test-${Date.now()}`;
    const testRepo = 'grounding-repo';

    const [repoRow] = await db
      .insert(repositories)
      .values({
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const mockAnalysis: AnalysisResult = {
      repository: {
        id: String(repoRow.id),
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        description: 'Test repository for grounding',
        stars: 1,
        forks: 0,
        primaryLanguage: 'TypeScript',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      commitSha: 'sha999',
      techStack: [
        {
          category: 'framework',
          name: 'Fastify',
          version: '4.26.0',
          confidence: 'high',
          evidence: 'package.json',
        },
      ],
      architecture: {
        isMonorepo: false,
        monorepoTool: null,
        workspaces: [],
        detectedPatterns: ['Service-Repository'],
        primaryEntrypoints: ['src/server.ts'],
        keyLandmarks: [
          {
            path: 'package.json',
            name: 'package.json',
            type: 'manifest',
            description: 'Package config',
          },
        ],
      },
      metrics: {
        totalFiles: 1,
        totalBytes: 100,
        languages: { TypeScript: { bytes: 100, percentage: 100, fileCount: 1 } },
        categories: { source: { bytes: 100, percentage: 100, fileCount: 1 } },
        largestFiles: [],
      },
      tree: [
        {
          path: 'src/server.ts',
          name: 'server.ts',
          type: 'file',
          size: 100,
          extension: '.ts',
          category: 'source',
          isLandmark: false,
        },
      ],
      analyzedAt: new Date().toISOString(),
    };

    const [analysisRow] = await db
      .insert(analyses)
      .values({
        repositoryId: repoRow.id,
        commitSha: mockAnalysis.commitSha,
        techStack: mockAnalysis.techStack,
        architecture: mockAnalysis.architecture,
        metrics: mockAnalysis.metrics,
        tree: mockAnalysis.tree,
        analyzedAt: new Date(),
      })
      .returning();

    const hallucinatingProvider: IAIProvider = {
      name: 'hallucinator',
      model: 'fake-model',
      explain: vi.fn().mockResolvedValue({
        summary: 'Summary with fake citations.',
        explanation: 'Explanation text.',
        keyTakeaways: ['T1'],
        evidence: [
          {
            type: 'file',
            label: 'Hallucinated Database Secret File',
            reference: 'config/database.secret.json', // DOES NOT EXIST
            description: 'Fake citation',
          },
          {
            type: 'manifest',
            label: 'Real Manifest',
            reference: 'package.json', // REAL
            description: 'Real citation',
          },
        ],
        provider: 'hallucinator',
        model: 'fake-model',
      }),
    };

    const mockRepoService = {
      getLatestAnalysisWithRecord: vi.fn().mockResolvedValue({
        analysis: mockAnalysis,
        analysisId: analysisRow.id,
        repositoryId: repoRow.id,
      }),
      getLandmarkContent: vi.fn().mockResolvedValue(null),
    } as unknown as RepositoryService;

    const service = new AIService(hallucinatingProvider, mockRepoService);
    const result = await service.explain(testOwner, testRepo, { topic: 'overview' });

    // Verify fabricated citation was discarded, and verified citation was preserved
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].reference).toBe('package.json');

    // Clean up
    await db.delete(repositories).where(eq(repositories.id, repoRow.id));
  });

  it('separates cache by topic and target', async () => {
    const testOwner = `cache-keys-${Date.now()}`;
    const testRepo = 'key-repo';

    const [repoRow] = await db
      .insert(repositories)
      .values({
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const mockAnalysis: AnalysisResult = {
      repository: {
        id: String(repoRow.id),
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        description: null,
        stars: 10,
        forks: 1,
        primaryLanguage: 'TypeScript',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      commitSha: 'sha-keys-123',
      techStack: [],
      architecture: {
        isMonorepo: false,
        monorepoTool: null,
        workspaces: [],
        detectedPatterns: [],
        primaryEntrypoints: [],
        keyLandmarks: [],
      },
      metrics: {
        totalFiles: 1,
        totalBytes: 100,
        languages: {},
        categories: {},
        largestFiles: [],
      },
      tree: [],
      analyzedAt: new Date().toISOString(),
    };

    const [analysisRow] = await db
      .insert(analyses)
      .values({
        repositoryId: repoRow.id,
        commitSha: mockAnalysis.commitSha,
        techStack: mockAnalysis.techStack,
        architecture: mockAnalysis.architecture,
        metrics: mockAnalysis.metrics,
        tree: mockAnalysis.tree,
        analyzedAt: new Date(),
      })
      .returning();

    const mockExplain = vi.fn().mockImplementation((req) => ({
      summary: `Summary for ${req.topic} - ${req.target || 'no-target'}`,
      explanation: 'Detailed text',
      keyTakeaways: ['Point 1'],
      evidence: [],
      provider: 'mock',
      model: 'model',
    }));

    const mockProvider: IAIProvider = {
      name: 'mock',
      model: 'model',
      explain: mockExplain,
    };

    const mockRepoService = {
      getLatestAnalysisWithRecord: vi.fn().mockResolvedValue({
        analysis: mockAnalysis,
        analysisId: analysisRow.id,
        repositoryId: repoRow.id,
      }),
      getLandmarkContent: vi.fn().mockResolvedValue(null),
    } as unknown as RepositoryService;

    const service = new AIService(mockProvider, mockRepoService);

    // Call A: overview with no target
    await service.explain(testOwner, testRepo, { topic: 'overview' });
    expect(mockExplain).toHaveBeenCalledTimes(1);

    // Call B: overview with target -> must NOT be served from Call A's cache
    await service.explain(testOwner, testRepo, { topic: 'overview', target: 'src/server.ts' });
    expect(mockExplain).toHaveBeenCalledTimes(2);

    // Call C: architecture with target -> must NOT be served from Call B's cache
    await service.explain(testOwner, testRepo, { topic: 'architecture', target: 'src/server.ts' });
    expect(mockExplain).toHaveBeenCalledTimes(3);

    // Call D: repeat Call B -> MUST be served from cache
    const cachedB = await service.explain(testOwner, testRepo, {
      topic: 'overview',
      target: 'src/server.ts',
    });
    expect(cachedB.cached).toBe(true);
    expect(mockExplain).toHaveBeenCalledTimes(3);

    await db.delete(repositories).where(eq(repositories.id, repoRow.id));
  });

  it('basic AI explanation does not invoke retrieval service or require embeddings', async () => {
    const testOwner = `no-retrieval-${Date.now()}`;
    const testRepo = 'no-embed-repo';

    const [repoRow] = await db
      .insert(repositories)
      .values({
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const mockAnalysis: AnalysisResult = {
      repository: {
        id: String(repoRow.id),
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        description: null,
        stars: 10,
        forks: 1,
        primaryLanguage: 'TypeScript',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      commitSha: 'sha-no-embed',
      techStack: [],
      architecture: {
        isMonorepo: false,
        monorepoTool: null,
        workspaces: [],
        detectedPatterns: [],
        primaryEntrypoints: ['src/main.ts'],
        keyLandmarks: [],
      },
      metrics: {
        totalFiles: 1,
        totalBytes: 100,
        languages: {},
        categories: {},
        largestFiles: [],
      },
      tree: [],
      analyzedAt: new Date().toISOString(),
    };

    const [analysisRow] = await db
      .insert(analyses)
      .values({
        repositoryId: repoRow.id,
        commitSha: mockAnalysis.commitSha,
        techStack: mockAnalysis.techStack,
        architecture: mockAnalysis.architecture,
        metrics: mockAnalysis.metrics,
        tree: mockAnalysis.tree,
        analyzedAt: new Date(),
      })
      .returning();

    const mockExplain = vi.fn().mockResolvedValue({
      summary: 'Summary without retrieval',
      explanation: 'Explanation without retrieval',
      keyTakeaways: ['Point 1'],
      evidence: [],
      provider: 'mock',
      model: 'model',
    });

    const mockProvider: IAIProvider = {
      name: 'mock',
      model: 'model',
      explain: mockExplain,
    };

    const mockRetrievalService = {
      search: vi.fn(),
      indexAnalysis: vi.fn(),
      indexFiles: vi.fn(),
    } as unknown as RetrievalService;

    const mockRepoService = {
      getLatestAnalysisWithRecord: vi.fn().mockResolvedValue({
        analysis: mockAnalysis,
        analysisId: analysisRow.id,
        repositoryId: repoRow.id,
      }),
      getLandmarkContent: vi.fn().mockResolvedValue(null),
    } as unknown as RepositoryService;

    const service = new AIService(mockProvider, mockRepoService, mockRetrievalService);

    // Request entrypoints with a target (previously would trigger retrieval stampede)
    const res = await service.explain(testOwner, testRepo, {
      topic: 'entrypoints',
      target: 'src/main.ts',
    });

    expect(res.summary).toBe('Summary without retrieval');
    expect(mockRetrievalService.search).not.toHaveBeenCalled();
    expect(mockRetrievalService.indexAnalysis).not.toHaveBeenCalled();

    await db.delete(repositories).where(eq(repositories.id, repoRow.id));
  });

  it('enforces 60-second cooldown on ready explanations when forceRetry=true', async () => {
    const testOwner = `cooldown-owner-${Date.now()}`;
    const testRepo = 'cooldown-repo';

    const [repoRow] = await db
      .insert(repositories)
      .values({
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        description: 'Cooldown test repo',
        stars: 1,
        forks: 0,
        primaryLanguage: 'TypeScript',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const mockAnalysis: AnalysisResult = {
      repository: {
        id: String(repoRow.id),
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        description: 'Cooldown test repo',
        stars: 1,
        forks: 0,
        primaryLanguage: 'TypeScript',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      tree: [],
      techStack: [],
      metrics: { totalFiles: 1, totalBytes: 100, languages: {}, categories: {}, largestFiles: [] },
      architecture: {
        isMonorepo: false,
        monorepoTool: null,
        workspaces: [],
        detectedPatterns: [],
        primaryEntrypoints: [],
        keyLandmarks: [],
      },
      commitSha: 'sha-cooldown-123',
      analyzedAt: new Date().toISOString(),
    };

    const [analysisRow] = await db
      .insert(analyses)
      .values({
        repositoryId: repoRow.id,
        commitSha: 'sha-cooldown-123',
        techStack: [],
        architecture: mockAnalysis.architecture,
        metrics: mockAnalysis.metrics,
        tree: [],
        analyzedAt: new Date(),
      })
      .returning();

    // Insert an explanation that was created 10 seconds ago (cooldown is 60s)
    await db
      .insert(aiExplanations)
      .values({
        repositoryId: repoRow.id,
        analysisId: analysisRow.id,
        commitSha: 'sha-cooldown-123',
        topic: 'overview',
        target: null,
        promptVersion: 1,
        status: 'ready',
        summary: 'Original Ready Summary',
        explanation: 'Original Ready Explanation',
        keyTakeaways: ['Takeaway A'],
        createdAt: new Date(Date.now() - 10_000),
      })
      .returning();

    const mockRepoService = {
      getLatestAnalysisWithRecord: vi.fn().mockResolvedValue({
        analysis: mockAnalysis,
        analysisId: analysisRow.id,
        repositoryId: repoRow.id,
      }),
    } as unknown as RepositoryService;

    const mockRunner = {
      enqueue: vi.fn(),
      setAiService: vi.fn(),
    };

    const service = new AIService(undefined, mockRepoService, undefined, mockRunner as any);

    // Call getOrEnqueueInsight with forceRetry=true
    const insight = await service.getOrEnqueueInsight(testOwner, testRepo, 'overview', null, 1, true);

    // Should return cached ready result and NOT enqueue because cooldown is active
    expect(insight.status).toBe('ready');
    expect(insight.result?.summary).toBe('Original Ready Summary');
    expect(mockRunner.enqueue).not.toHaveBeenCalled();

    await db.delete(repositories).where(eq(repositories.id, repoRow.id));
  });

  it('respects retryAt backoff on failed explanations even when forceRetry=true', async () => {
    const testOwner = `backoff-owner-${Date.now()}`;
    const testRepo = 'backoff-repo';

    const [repoRow] = await db
      .insert(repositories)
      .values({
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        description: 'Backoff test repo',
        stars: 1,
        forks: 0,
        primaryLanguage: 'TypeScript',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const mockAnalysis: AnalysisResult = {
      repository: {
        id: String(repoRow.id),
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        description: 'Backoff test repo',
        stars: 1,
        forks: 0,
        primaryLanguage: 'TypeScript',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      tree: [],
      techStack: [],
      metrics: { totalFiles: 1, totalBytes: 100, languages: {}, categories: {}, largestFiles: [] },
      architecture: {
        isMonorepo: false,
        monorepoTool: null,
        workspaces: [],
        detectedPatterns: [],
        primaryEntrypoints: [],
        keyLandmarks: [],
      },
      commitSha: 'sha-backoff-456',
      analyzedAt: new Date().toISOString(),
    };

    const [analysisRow] = await db
      .insert(analyses)
      .values({
        repositoryId: repoRow.id,
        commitSha: 'sha-backoff-456',
        techStack: [],
        architecture: mockAnalysis.architecture,
        metrics: mockAnalysis.metrics,
        tree: [],
        analyzedAt: new Date(),
      })
      .returning();

    // Failed explanation with retryAt 30 seconds into the future
    const futureRetryAt = new Date(Date.now() + 30_000);
    await db
      .insert(aiExplanations)
      .values({
        repositoryId: repoRow.id,
        analysisId: analysisRow.id,
        commitSha: 'sha-backoff-456',
        topic: 'overview',
        target: null,
        promptVersion: 1,
        status: 'failed',
        lastErrorCategory: 'rate_limit',
        lastErrorMessage: 'Rate limit exceeded',
        retryAt: futureRetryAt,
        createdAt: new Date(),
      });

    const mockRepoService = {
      getLatestAnalysisWithRecord: vi.fn().mockResolvedValue({
        analysis: mockAnalysis,
        analysisId: analysisRow.id,
        repositoryId: repoRow.id,
      }),
    } as unknown as RepositoryService;

    const mockRunner = {
      enqueue: vi.fn(),
      setAiService: vi.fn(),
    };

    const service = new AIService(undefined, mockRepoService, undefined, mockRunner as any);

    // Call getOrEnqueueInsight with forceRetry=true while still in backoff
    const insight = await service.getOrEnqueueInsight(testOwner, testRepo, 'overview', null, 1, true);

    // Must remain failed, returning retryAt, and NOT re-enqueuing
    expect(insight.status).toBe('failed');
    expect(insight.error?.isRateLimit).toBe(true);
    expect(insight.retryAt).toBe(futureRetryAt.toISOString());
    expect(mockRunner.enqueue).not.toHaveBeenCalled();

    await db.delete(repositories).where(eq(repositories.id, repoRow.id));
  });

  it('seamlessly falls back to independent provider when primary provider fails with 503', async () => {
    const testOwner = `ai-fallback-${Date.now()}`;
    const testRepo = 'fallback-repo';

    const [repoRow] = await db
      .insert(repositories)
      .values({
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        description: 'Test fallback repository',
        stars: 5,
        forks: 0,
        primaryLanguage: 'TypeScript',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const mockAnalysis: AnalysisResult = {
      repository: {
        id: String(repoRow.id),
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        description: 'Test fallback repository',
        stars: 5,
        forks: 0,
        primaryLanguage: 'TypeScript',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      commitSha: 'sha-fb-789',
      techStack: [],
      architecture: {
        isMonorepo: false,
        monorepoTool: null,
        workspaces: [],
        detectedPatterns: ['Modular Monolith'],
        primaryEntrypoints: ['src/main.ts'],
        keyLandmarks: [
          {
            path: 'package.json',
            name: 'package.json',
            type: 'manifest',
            description: 'Root manifest',
          },
        ],
      },
      metrics: {
        totalFiles: 10,
        totalBytes: 5000,
        languages: { TypeScript: { bytes: 5000, percentage: 100, fileCount: 10 } },
        categories: { source: { bytes: 5000, percentage: 100, fileCount: 10 } },
        largestFiles: [{ path: 'src/main.ts', size: 500 }],
      },
      tree: [],
      analyzedAt: new Date().toISOString(),
    };

    const mockRepoService = {
      getLatestAnalysisWithRecord: vi.fn().mockResolvedValue({
        analysis: mockAnalysis,
        analysisId: 1,
        repositoryId: repoRow.id,
      }),
      getLandmarkContent: vi.fn().mockResolvedValue(null),
    } as unknown as RepositoryService;

    // Primary Gemini provider throws 503
    const mockPrimary = {
      name: 'gemini',
      model: 'gemini-3.8-flash',
      explain: vi.fn().mockRejectedValue(new Error('503 Service Unavailable')),
    };

    // Fallback independent provider succeeds
    const mockFallback = {
      name: 'openai-compatible',
      model: 'gpt-4o-mini',
      explain: vi.fn().mockResolvedValue({
        summary: 'Fallback generated summary',
        explanation: 'Detailed explanation from fallback provider',
        keyTakeaways: ['Resilience achieved'],
        evidence: [],
        provider: 'openai-compatible',
        model: 'gpt-4o-mini',
      }),
    };

    const resilient = new ResilientFallbackProvider([
      { provider: mockPrimary, breaker: new CircuitBreaker({ name: 'gemini' }) },
      { provider: mockFallback, breaker: new CircuitBreaker({ name: 'openai-compatible' }) },
    ]);

    const service = new AIService(resilient, mockRepoService);

    const explanation = await service.generateExplanation(testOwner, testRepo, 'overview');

    expect(explanation.summary).toBe('Fallback generated summary');
    expect(explanation.provider).toBe('openai-compatible');
    expect(explanation.model).toBe('gpt-4o-mini');
    expect(mockPrimary.explain).toHaveBeenCalledTimes(1);
    expect(mockFallback.explain).toHaveBeenCalledTimes(1);

    await db.delete(repositories).where(eq(repositories.id, repoRow.id));
  });
});
