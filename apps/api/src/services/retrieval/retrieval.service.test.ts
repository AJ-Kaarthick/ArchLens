import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RetrievalService, RepositoryNotAnalyzedError } from './retrieval.service.js';
import { MockEmbeddingProvider } from '../ai/embeddings/mock-embedding.provider.js';
import { CodeChunker, type ChunkInputFile } from './chunker.js';
import { initDb, sql, db } from '../../db/index.js';
import { repositories, analyses } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

describe('RetrievalService', () => {
  const embeddingProvider = new MockEmbeddingProvider();
  const chunker = new CodeChunker();
  let service: RetrievalService;

  beforeAll(async () => {
    await initDb();
    service = new RetrievalService(embeddingProvider, chunker);
  });

  afterAll(async () => {
    await sql.end();
  });

  it('throws RepositoryNotAnalyzedError when repository has no analysis', async () => {
    await expect(
      service.search('nonexistent', 'repo', { query: 'server routing', limit: 5 })
    ).rejects.toThrow(RepositoryNotAnalyzedError);
  });

  it('indexes files, performs semantic search, and enforces repository isolation', async () => {
    const testOwner = `retrieval-test-${Date.now()}`;
    const testRepoA = 'repo-a';
    const testRepoB = 'repo-b';

    // 1. Create Repo A and Repo B
    const [repoA] = await db
      .insert(repositories)
      .values({
        owner: testOwner,
        name: testRepoA,
        url: `https://github.com/${testOwner}/${testRepoA}`,
        defaultBranch: 'main',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const [repoB] = await db
      .insert(repositories)
      .values({
        owner: testOwner,
        name: testRepoB,
        url: `https://github.com/${testOwner}/${testRepoB}`,
        defaultBranch: 'main',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // 2. Create Analysis for Repo A
    const [analysisA] = await db
      .insert(analyses)
      .values({
        repositoryId: repoA.id,
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
          totalFiles: 2,
          totalBytes: 200,
          languages: {},
          categories: {},
          largestFiles: [],
        },
        tree: [],
        analyzedAt: new Date(),
      })
      .returning();

    // 3. Create Analysis for Repo B
    const [analysisB] = await db
      .insert(analyses)
      .values({
        repositoryId: repoB.id,
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
      })
      .returning();

    // Files for Repo A
    const filesA: ChunkInputFile[] = [
      {
        path: 'src/server.ts',
        content: `import fastify from 'fastify';\nconst app = fastify();\napp.get('/api/users', (req, reply) => {\n  reply.send({ users: [] });\n});\nexport default app;`,
        size: 150,
        category: 'source',
        language: 'TypeScript',
      },
      {
        path: 'src/auth.ts',
        content: `export function verifyJwtToken(token: string) {\n  // Verify JWT signature\n  return true;\n}`,
        size: 90,
        category: 'source',
        language: 'TypeScript',
      },
      {
        path: 'README.md',
        content: `# ArchLens Core\n\nInstant repository understanding without cloning.`,
        size: 65,
        category: 'doc',
      },
    ];

    // Files for Repo B
    const filesB: ChunkInputFile[] = [
      {
        path: 'src/other.ts',
        content: `export function calculateTax() {\n  return 0.15;\n}`,
        size: 60,
        category: 'source',
        language: 'TypeScript',
      },
    ];

    // Index Repo A and Repo B
    const resA = await service.indexFiles(analysisA.id, filesA);
    expect(resA.indexedChunks).toBe(3);

    const resB = await service.indexFiles(analysisB.id, filesB);
    expect(resB.indexedChunks).toBe(1);

    // Idempotent indexing: calling indexFiles again should skip duplicate insertion
    const reindexA = await service.indexFiles(analysisA.id, filesA);
    expect(reindexA.indexedChunks).toBe(1); // returned existing count

    // Search Repo A for "jwt authentication"
    const authSearch = await service.search(
      testOwner,
      testRepoA,
      { query: 'jwt authentication token verification', limit: 5 },
      analysisA.id
    );

    expect(authSearch.results.length).toBeGreaterThanOrEqual(1);
    expect(authSearch.results[0].filePath).toBe('src/auth.ts');
    expect(authSearch.results[0].content).toContain('verifyJwtToken');
    expect(authSearch.durationMs).toBeGreaterThanOrEqual(0);

    // Verify Repository Isolation: search on Repo A NEVER returns Repo B chunks
    for (const item of authSearch.results) {
      expect(item.filePath).not.toBe('src/other.ts');
    }

    // Filter by category: search with category='doc' only returns doc
    const docSearch = await service.search(
      testOwner,
      testRepoA,
      { query: 'repository understanding', limit: 5, category: 'doc' },
      analysisA.id
    );
    expect(docSearch.results.length).toBe(1);
    expect(docSearch.results[0].filePath).toBe('README.md');
    expect(docSearch.results[0].category).toBe('doc');

    // Filter by pathPrefix: search with pathPrefix='src/server'
    const prefixSearch = await service.search(
      testOwner,
      testRepoA,
      { query: 'fastify api endpoints', limit: 5, pathPrefix: 'src/server' },
      analysisA.id
    );
    expect(prefixSearch.results.length).toBe(1);
    expect(prefixSearch.results[0].filePath).toBe('src/server.ts');

    // Respects limit bound
    const limitSearch = await service.search(
      testOwner,
      testRepoA,
      { query: 'code', limit: 1 },
      analysisA.id
    );
    expect(limitSearch.results).toHaveLength(1);

    // Cleanup
    await db.delete(repositories).where(eq(repositories.id, repoA.id));
    await db.delete(repositories).where(eq(repositories.id, repoB.id));
  });
});
