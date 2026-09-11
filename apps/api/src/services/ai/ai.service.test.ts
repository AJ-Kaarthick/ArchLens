import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AIService, RepositoryNotAnalyzedError } from './ai.service.js';
import type { IAIProvider, AIExplanationResult } from './provider.interface.js';
import { RepositoryService } from '../repository.service.js';
import { initDb, sql, db } from '../../db/index.js';
import { repositories, analyses, aiExplanations } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { AnalysisResult } from '@archlens/shared';

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

    const service = new AIService(mockProvider, mockRepoService);

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
    await db.delete(aiExplanations).where(eq(aiExplanations.analysisId, analysisRow.id));
    await db.delete(analyses).where(eq(analyses.id, analysisRow.id));
    await db.delete(repositories).where(eq(repositories.id, repoRow.id));
  });
});

