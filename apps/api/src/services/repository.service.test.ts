import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { RepositoryService } from './repository.service.js';
import { GitHubService } from './github.service.js';
import { initDb, sql, db } from '../db/index.js';
import { repositories, analyses } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

describe('RepositoryService - Analysis Identity and Deduplication', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('reuses existing analysis row on same commit SHA and skips getGitTree / metadata', async () => {
    const testOwner = `fastpath-test-${Date.now()}`;
    const testRepo = 'sample-repo';
    const commitSha = 'commit-1111111111111111111111111111111111111111';
    const treeSha = 'tree-2222222222222222222222222222222222222222';

    const mockMetadata = {
      id: '999999',
      owner: testOwner,
      name: testRepo,
      url: `https://github.com/${testOwner}/${testRepo}`,
      description: 'Deduplication test repo',
      defaultBranch: 'main',
      stars: 5,
      forks: 0,
      primaryLanguage: 'TypeScript',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockTree = {
      sha: treeSha,
      tree: [
        { path: 'package.json', mode: '100644', type: 'blob' as const, size: 100 },
        { path: 'src/index.ts', mode: '100644', type: 'blob' as const, size: 200 },
      ],
      truncated: false,
    };

    const manifestContent = JSON.stringify({ name: testRepo, dependencies: { react: '^18.0.0' } });

    const getHeadCommitSpy = vi.fn().mockResolvedValue({ commitSha, treeSha });
    const getMetadataSpy = vi.fn().mockResolvedValue(mockMetadata);
    const getGitTreeSpy = vi.fn().mockResolvedValue(mockTree);
    const getFileContentSpy = vi.fn().mockResolvedValue({
      path: 'package.json',
      name: 'package.json',
      size: manifestContent.length,
      content: manifestContent,
      encoding: 'utf-8',
      isTruncated: false,
    });

    const mockGh = {
      getHeadCommit: getHeadCommitSpy,
      getRepositoryMetadata: getMetadataSpy,
      getGitTree: getGitTreeSpy,
      getFileContent: getFileContentSpy,
    } as unknown as GitHubService;

    const service = new RepositoryService(mockGh);

    // Call 1: Cold analysis creates row
    const res1 = await service.analyze(testOwner, testRepo);
    expect(res1.commitSha).toBe(commitSha);
    expect(getHeadCommitSpy).toHaveBeenCalledTimes(1);
    expect(getGitTreeSpy).toHaveBeenCalledTimes(1);
    expect(getFileContentSpy).toHaveBeenCalledTimes(1);

    const [repoRow] = await db
      .select()
      .from(repositories)
      .where(and(eq(repositories.owner, testOwner), eq(repositories.name, testRepo)));
    expect(repoRow).toBeDefined();

    const analysisRows1 = await db
      .select()
      .from(analyses)
      .where(eq(analyses.repositoryId, repoRow.id));
    expect(analysisRows1).toHaveLength(1);
    expect(analysisRows1[0].commitSha).toBe(commitSha);
    const firstAnalysisId = analysisRows1[0].id;

    // Reset spies for Call 2
    getHeadCommitSpy.mockClear();
    getMetadataSpy.mockClear();
    getGitTreeSpy.mockClear();
    getFileContentSpy.mockClear();

    // Call 2: Cache hit - MUST use fast path!
    const res2 = await service.analyze(testOwner, testRepo);
    expect(res2.commitSha).toBe(commitSha);

    // CRITICAL FAST PATH ASSERTIONS:
    // Only getHeadCommit was called. NO tree, NO metadata, NO file content fetched!
    expect(getHeadCommitSpy).toHaveBeenCalledTimes(1);
    expect(getMetadataSpy).not.toHaveBeenCalled();
    expect(getGitTreeSpy).not.toHaveBeenCalled();
    expect(getFileContentSpy).not.toHaveBeenCalled();

    // Database still has exactly 1 analysis row
    const analysisRows2 = await db
      .select()
      .from(analyses)
      .where(eq(analyses.repositoryId, repoRow.id));
    expect(analysisRows2).toHaveLength(1);
    expect(analysisRows2[0].id).toBe(firstAnalysisId);

    // Cleanup
    await db.delete(repositories).where(eq(repositories.id, repoRow.id));
  });

  it('creates a new analysis row when the repository commit SHA changes', async () => {
    const testOwner = `sha-change-test-${Date.now()}`;
    const testRepo = 'sample-repo';
    const shaA = 'commit-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const shaB = 'commit-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    const mockMetadata = {
      id: '999998',
      owner: testOwner,
      name: testRepo,
      url: `https://github.com/${testOwner}/${testRepo}`,
      description: 'SHA change repo',
      defaultBranch: 'main',
      stars: 5,
      forks: 0,
      primaryLanguage: 'TypeScript',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockTreeA = {
      sha: 'tree-a',
      tree: [{ path: 'package.json', mode: '100644', type: 'blob' as const, size: 100 }],
      truncated: false,
    };

    const mockTreeB = {
      sha: 'tree-b',
      tree: [
        { path: 'package.json', mode: '100644', type: 'blob' as const, size: 100 },
        { path: 'src/app.ts', mode: '100644', type: 'blob' as const, size: 300 },
      ],
      truncated: false,
    };

    const getHeadCommitSpy = vi.fn()
      .mockResolvedValueOnce({ commitSha: shaA, treeSha: 'tree-a' })
      .mockResolvedValueOnce({ commitSha: shaB, treeSha: 'tree-b' });

    const mockGh = {
      getHeadCommit: getHeadCommitSpy,
      getRepositoryMetadata: vi.fn().mockResolvedValue(mockMetadata),
      getGitTree: vi.fn()
        .mockResolvedValueOnce(mockTreeA)
        .mockResolvedValueOnce(mockTreeB),
      getFileContent: vi.fn().mockResolvedValue({
        path: 'package.json',
        name: 'package.json',
        size: 50,
        content: '{"name":"test"}',
        encoding: 'utf-8',
        isTruncated: false,
      }),
    } as unknown as GitHubService;

    const service = new RepositoryService(mockGh);

    const resA = await service.analyze(testOwner, testRepo);
    expect(resA.commitSha).toBe(shaA);

    const resB = await service.analyze(testOwner, testRepo);
    expect(resB.commitSha).toBe(shaB);

    const [repoRow] = await db
      .select()
      .from(repositories)
      .where(and(eq(repositories.owner, testOwner), eq(repositories.name, testRepo)));

    const analysisRows = await db
      .select()
      .from(analyses)
      .where(eq(analyses.repositoryId, repoRow.id));

    expect(analysisRows).toHaveLength(2);

    // Cleanup
    await db.delete(repositories).where(eq(repositories.id, repoRow.id));
  });

  it('single-flight prevents duplicate work during concurrent cold analyses', async () => {
    const testOwner = `flight-test-${Date.now()}`;
    const testRepo = 'flight-repo';
    const commitSha = 'commit-flight-111111111111111111111111111111';

    const mockMetadata = {
      id: '888888',
      owner: testOwner,
      name: testRepo,
      url: `https://github.com/${testOwner}/${testRepo}`,
      description: 'Single-flight test repo',
      defaultBranch: 'main',
      stars: 1,
      forks: 0,
      primaryLanguage: 'TypeScript',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockTree = {
      sha: 'tree-flight',
      tree: [{ path: 'package.json', mode: '100644', type: 'blob' as const, size: 100 }],
      truncated: false,
    };

    const getGitTreeSpy = vi.fn().mockImplementation(async () => {
      // Simulate slow tree fetch
      await new Promise((r) => setTimeout(r, 50));
      return mockTree;
    });

    const mockGh = {
      getHeadCommit: vi.fn().mockResolvedValue({ commitSha, treeSha: 'tree-flight' }),
      getRepositoryMetadata: vi.fn().mockResolvedValue(mockMetadata),
      getGitTree: getGitTreeSpy,
      getFileContent: vi.fn().mockResolvedValue({
        path: 'package.json',
        name: 'package.json',
        size: 20,
        content: '{}',
        encoding: 'utf-8',
        isTruncated: false,
      }),
    } as unknown as GitHubService;

    const service = new RepositoryService(mockGh);

    // Trigger two concurrent cold analyses
    const [res1, res2] = await Promise.all([
      service.analyze(testOwner, testRepo),
      service.analyze(testOwner, testRepo),
    ]);

    expect(res1.commitSha).toBe(commitSha);
    expect(res2.commitSha).toBe(commitSha);

    // Single-flight ensures getGitTree was called ONLY ONCE
    expect(getGitTreeSpy).toHaveBeenCalledTimes(1);

    const [repoRow] = await db
      .select()
      .from(repositories)
      .where(and(eq(repositories.owner, testOwner), eq(repositories.name, testRepo)));

    const analysisRows = await db
      .select()
      .from(analyses)
      .where(eq(analyses.repositoryId, repoRow.id));

    expect(analysisRows).toHaveLength(1);

    // Cleanup
    await db.delete(repositories).where(eq(repositories.id, repoRow.id));
  });

  it('migrates legacy analysis stored with tree SHA to commit SHA on cache hit', async () => {
    const testOwner = `legacy-test-${Date.now()}`;
    const testRepo = 'legacy-repo';
    const legacyTreeSha = 'tree-old-legacy-sha-99999999999999999999';
    const actualCommitSha = 'commit-real-head-sha-8888888888888888888';

    // 1. Manually insert repo and legacy analysis with tree SHA
    const [repoRow] = await db
      .insert(repositories)
      .values({
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        description: 'Legacy repo',
        stars: 0,
        forks: 0,
        primaryLanguage: 'TypeScript',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await db.insert(analyses).values({
      repositoryId: repoRow.id,
      commitSha: legacyTreeSha, // Legacy stored treeSha
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
      analyzedAt: new Date(),
    });

    const mockGh = {
      getHeadCommit: vi.fn().mockResolvedValue({
        commitSha: actualCommitSha,
        treeSha: legacyTreeSha,
      }),
      getRepositoryMetadata: vi.fn(),
      getGitTree: vi.fn(),
      getFileContent: vi.fn(),
    } as unknown as GitHubService;

    const service = new RepositoryService(mockGh);

    // Call analyze: should detect legacy treeSha, migrate commitSha, and return cached result
    const res = await service.analyze(testOwner, testRepo);
    expect(res.commitSha).toBe(actualCommitSha);

    // Verify tree/metadata were NOT fetched
    expect(mockGh.getGitTree).not.toHaveBeenCalled();
    expect(mockGh.getRepositoryMetadata).not.toHaveBeenCalled();

    // Verify DB row now has actualCommitSha
    const [updatedRow] = await db
      .select()
      .from(analyses)
      .where(eq(analyses.repositoryId, repoRow.id));
    expect(updatedRow.commitSha).toBe(actualCommitSha);

    // Cleanup
    await db.delete(repositories).where(eq(repositories.id, repoRow.id));
  });
});
