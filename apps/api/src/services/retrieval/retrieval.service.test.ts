import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RetrievalService, RepositoryNotAnalyzedError } from './retrieval.service.js';
import { MockEmbeddingProvider } from '../ai/embeddings/mock-embedding.provider.js';
import { CodeChunker, type ChunkInputFile } from './chunker.js';
import { initDb, sql, db } from '../../db/index.js';
import { repositories, analyses, codeChunks } from '../../db/schema.js';
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

  it('supports force re-indexing to safely rebuild chunks for an existing analysis', async () => {
    const testOwner = `reindex-test-${Date.now()}`;
    const testRepo = 'reindex-repo';

    const [repo] = await db
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

    const [analysis] = await db
      .insert(analyses)
      .values({
        repositoryId: repo.id,
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
          totalBytes: 50,
          languages: {},
          categories: {},
          largestFiles: [],
        },
        tree: [],
        analyzedAt: new Date(),
      })
      .returning();

    const initialFiles: ChunkInputFile[] = [
      { path: 'file1.ts', content: 'const a = 1;', size: 12, category: 'source' },
      { path: 'file2.ts', content: 'const b = 2;', size: 12, category: 'source' },
    ];

    // Initial indexing
    const res1 = await service.indexFiles(analysis.id, initialFiles);
    expect(res1.indexedChunks).toBe(2);

    // Calling again without force is idempotent and skips
    const res2 = await service.indexFiles(analysis.id, initialFiles);
    expect(res2.indexedChunks).toBeGreaterThan(0);

    // Calling with force: true re-indexes
    const updatedFiles: ChunkInputFile[] = [
      { path: 'updated.ts', content: 'const updated = true;', size: 21, category: 'source' },
    ];
    const res3 = await service.indexFiles(analysis.id, updatedFiles, { force: true });
    expect(res3.indexedChunks).toBe(1);

    // Search reflects new chunk
    const searchRes = await service.search(
      testOwner,
      testRepo,
      { query: 'updated', limit: 5 },
      analysis.id
    );
    expect(searchRes.results).toHaveLength(1);
    expect(searchRes.results[0].filePath).toBe('updated.ts');

    // Cleanup
    await db.delete(repositories).where(eq(repositories.id, repo.id));
  });

  it('single-flights concurrent duplicate indexing operations', async () => {
    const testOwner = `singleflight-${Date.now()}`;
    const testRepo = 'sf-repo';

    const [repo] = await db
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

    const [analysis] = await db
      .insert(analyses)
      .values({
        repositoryId: repo.id,
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
          totalBytes: 50,
          languages: {},
          categories: {},
          largestFiles: [],
        },
        tree: [],
        analyzedAt: new Date(),
      })
      .returning();

    const files: ChunkInputFile[] = [
      { path: 'concurrent.ts', content: 'const c = 42;', size: 14, category: 'source' },
    ];

    // Trigger two indexFiles simultaneously on the exact same analysisId
    const [p1, p2] = await Promise.all([
      service.indexFiles(analysis.id, files),
      service.indexFiles(analysis.id, files),
    ]);

    expect(p1.indexedChunks).toBe(1);
    expect(p2.indexedChunks).toBe(1);

    await db.delete(repositories).where(eq(repositories.id, repo.id));
  });

  it('executes strictly read-only lexical search on unindexed repository without mutating DB', async () => {
    const testOwner = `readonly-test-${Date.now()}`;
    const testRepo = 'readonly-repo';

    const [repo] = await db
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

    const [analysis] = await db
      .insert(analyses)
      .values({
        repositoryId: repo.id,
        techStack: [],
        architecture: {
          isMonorepo: false,
          monorepoTool: null,
          workspaces: [],
          detectedPatterns: ['MVC'],
          primaryEntrypoints: ['src/index.ts'],
          keyLandmarks: [
            {
              path: 'src/server.ts',
              type: 'entry' as const,
              name: 'server.ts',
              description: 'Fastify HTTP application server and route registry',
            },
          ],
        },
        metrics: {
          totalFiles: 2,
          totalBytes: 200,
          languages: {},
          categories: {},
          largestFiles: [],
        },
        tree: [
          {
            path: 'src/server.ts',
            name: 'server.ts',
            type: 'file' as const,
            size: 100,
            category: 'source' as const,
            extension: 'ts',
            isLandmark: true,
          },
          {
            path: 'src/index.ts',
            name: 'index.ts',
            type: 'file' as const,
            size: 100,
            category: 'source' as const,
            extension: 'ts',
            isLandmark: false,
          },
        ],
        analyzedAt: new Date(),
      })
      .returning();

    // 1. Execute search on an unindexed repository
    const searchRes = await service.search(
      testOwner,
      testRepo,
      { query: 'fastify server', limit: 5 },
      analysis.id
    );

    // 2. Verified: results are returned with fallback: true
    expect(searchRes.results.length).toBeGreaterThanOrEqual(1);
    expect(searchRes.fallback).toBe(true);
    expect(searchRes.results[0].filePath).toBe('src/server.ts');
    expect(searchRes.results[0].content).toContain('Fastify HTTP application server');

    // 3. Verified: STRICTLY READ-ONLY - ZERO chunks were inserted into code_chunks
    const chunksInDb = await db
      .select({ id: codeChunks.id })
      .from(codeChunks)
      .where(eq(codeChunks.analysisId, analysis.id));
    expect(chunksInDb).toHaveLength(0);

    await db.delete(repositories).where(eq(repositories.id, repo.id));
  });

  it('supports explicit lexical, semantic, and hybrid search modes', async () => {
    const testOwner = `modes-test-${Date.now()}`;
    const testRepo = 'modes-repo';

    const [repo] = await db
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

    const [analysis] = await db
      .insert(analyses)
      .values({
        repositoryId: repo.id,
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

    const files: ChunkInputFile[] = [
      {
        path: 'src/payment.ts',
        content: 'export function processStripePayment(amount: number) { return amount > 0; }',
        size: 80,
        category: 'source',
        language: 'ts',
      },
      {
        path: 'src/logging.ts',
        content: 'export function logInfo(message: string) { console.log(message); }',
        size: 70,
        category: 'source',
        language: 'ts',
      },
    ];

    await service.indexFiles(analysis.id, files);

    // Lexical mode
    const lexRes = await service.search(
      testOwner,
      testRepo,
      { query: 'processStripePayment', limit: 5, mode: 'lexical' },
      analysis.id
    );
    expect(lexRes.results).toHaveLength(1);
    expect(lexRes.results[0].filePath).toBe('src/payment.ts');
    expect(lexRes.fallback).toBe(false);
    expect(lexRes.mode).toBe('lexical');

    // Semantic mode
    const semRes = await service.search(
      testOwner,
      testRepo,
      { query: 'credit card payment transaction', limit: 5, mode: 'semantic' },
      analysis.id
    );
    expect(semRes.results.length).toBeGreaterThanOrEqual(1);
    expect(semRes.results[0].filePath).toBe('src/payment.ts');
    expect(semRes.mode).toBe('semantic');

    // Hybrid mode
    const hybridRes = await service.search(
      testOwner,
      testRepo,
      { query: 'processStripePayment', limit: 5, mode: 'hybrid' },
      analysis.id
    );
    expect(hybridRes.results.length).toBeGreaterThanOrEqual(1);
    expect(hybridRes.results[0].filePath).toBe('src/payment.ts');
    expect(hybridRes.mode).toBe('hybrid');

    await db.delete(repositories).where(eq(repositories.id, repo.id));
  });

  it('falls back gracefully to lexical search when embedding provider fails', async () => {
    const testOwner = `fallback-test-${Date.now()}`;
    const testRepo = 'fallback-repo';

    const [repo] = await db
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

    const [analysis] = await db
      .insert(analyses)
      .values({
        repositoryId: repo.id,
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
          totalBytes: 50,
          languages: {},
          categories: {},
          largestFiles: [],
        },
        tree: [],
        analyzedAt: new Date(),
      })
      .returning();

    const files: ChunkInputFile[] = [
      {
        path: 'src/resilience.ts',
        content: 'export const resilientFeature = "active";',
        size: 40,
        category: 'source',
      },
    ];

    await service.indexFiles(analysis.id, files);

    // Mock embedding provider throwing rate limit error on embedQuery
    const failingProvider = {
      name: 'failing-provider',
      dimension: 768,
      embed: async (texts: string[]) => texts.map(() => new Array(768).fill(0.1)),
      embedQuery: async () => {
        throw new Error('Upstream provider quota exceeded');
      },
    };

    const resilientService = new RetrievalService(failingProvider, chunker);

    const result = await resilientService.search(
      testOwner,
      testRepo,
      { query: 'resilientFeature', limit: 5, mode: 'hybrid' },
      analysis.id
    );

    expect(result.fallback).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].filePath).toBe('src/resilience.ts');

    await db.delete(repositories).where(eq(repositories.id, repo.id));
  });

  it('manages background indexing lifecycle and status reporting', async () => {
    const testOwner = `bg-index-${Date.now()}`;
    const testRepo = 'bg-repo';

    const [repo] = await db
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

    await db
      .insert(analyses)
      .values({
        repositoryId: repo.id,
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
          totalFiles: 0,
          totalBytes: 0,
          languages: {},
          categories: {},
          largestFiles: [],
        },
        tree: [],
        analyzedAt: new Date(),
      })
      .returning();

    // 1. Check status before indexing
    const initialStatus = await service.getIndexStatus(testOwner, testRepo);
    expect(initialStatus.status).toBe('not_indexed');
    expect(initialStatus.indexedChunks).toBe(0);

    // 2. Start indexing
    const startStatus = await service.startIndexing(testOwner, testRepo);
    expect(['indexing', 'ready']).toContain(startStatus.status);

    await db.delete(repositories).where(eq(repositories.id, repo.id));
  });
});
