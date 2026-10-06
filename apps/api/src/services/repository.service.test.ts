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

  it('reuses existing analysis row when repository is analyzed at the same commit SHA', async () => {
    const testOwner = `dedup-test-${Date.now()}`;
    const testRepo = 'sample-repo';
    const commitSha = 'sha-111111';

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
      sha: commitSha,
      tree: [
        { path: 'package.json', mode: '100644', type: 'blob', size: 100 },
        { path: 'src/index.ts', mode: '100644', type: 'blob', size: 200 },
      ],
      truncated: false,
    };

    const manifestContent = JSON.stringify({ name: testRepo, dependencies: { react: '^18.0.0' } });

    const getFileContentSpy = vi.fn().mockResolvedValue({
      path: 'package.json',
      name: 'package.json',
      size: manifestContent.length,
      content: manifestContent,
      encoding: 'utf-8',
      isTruncated: false,
    });

    const mockGh = {
      getRepositoryMetadata: vi.fn().mockResolvedValue(mockMetadata),
      getGitTree: vi.fn().mockResolvedValue(mockTree),
      getFileContent: getFileContentSpy,
    } as unknown as GitHubService;

    const service = new RepositoryService(mockGh);

    // First analysis: creates analysis row
    const res1 = await service.analyze(testOwner, testRepo);
    expect(res1.commitSha).toBe(commitSha);

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
    const firstAnalysisId = analysisRows1[0].id;

    // Second analysis: SAME SHA -> must reuse analysis and NOT fetch manifests again
    getFileContentSpy.mockClear();
    const res2 = await service.analyze(testOwner, testRepo);
    expect(res2.commitSha).toBe(commitSha);

    // Must NOT have fetched manifests again
    expect(getFileContentSpy).not.toHaveBeenCalled();

    // Must still have exactly 1 analysis row
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
    const shaA = 'sha-aaaaaa';
    const shaB = 'sha-bbbbbb';

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
      sha: shaA,
      tree: [{ path: 'package.json', mode: '100644', type: 'blob', size: 100 }],
      truncated: false,
    };

    const mockTreeB = {
      sha: shaB,
      tree: [
        { path: 'package.json', mode: '100644', type: 'blob', size: 100 },
        { path: 'src/app.ts', mode: '100644', type: 'blob', size: 300 },
      ],
      truncated: false,
    };

    const mockGh = {
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
});
