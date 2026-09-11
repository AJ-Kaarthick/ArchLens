import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, db, sql } from './index.js';
import { repositories, analyses, codeChunks } from './schema.js';
import { eq } from 'drizzle-orm';

describe('Database connection & schema', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterAll(async () => {
    await sql.end();
  });

  it('initializes tables and unique constraint on (owner, name)', async () => {
    const testOwner = `test-owner-${Date.now()}`;
    const testRepo = `test-repo-${Date.now()}`;

    // Insert 1
    const [inserted] = await db
      .insert(repositories)
      .values({
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        description: 'Initial description',
        stars: 10,
        forks: 2,
        primaryLanguage: 'TypeScript',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    expect(inserted.id).toBeDefined();
    expect(inserted.owner).toBe(testOwner);
    expect(inserted.description).toBe('Initial description');

    // Upsert (same owner, name)
    const [upserted] = await db
      .insert(repositories)
      .values({
        owner: testOwner,
        name: testRepo,
        url: `https://github.com/${testOwner}/${testRepo}`,
        defaultBranch: 'main',
        description: 'Updated description',
        stars: 100,
        forks: 20,
        primaryLanguage: 'TypeScript',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [repositories.owner, repositories.name],
        set: {
          description: 'Updated description',
          stars: 100,
          forks: 20,
        },
      })
      .returning();

    expect(upserted.id).toBe(inserted.id);
    expect(upserted.description).toBe('Updated description');
    expect(upserted.stars).toBe(100);

    // Verify only 1 row exists for this owner and repo
    const allMatching = await db
      .select()
      .from(repositories)
      .where(eq(repositories.owner, testOwner));
    expect(allMatching).toHaveLength(1);

    // Clean up
    await db.delete(repositories).where(eq(repositories.id, inserted.id));
  });

  it('stores code chunks linked to analysis and supports cascade delete', async () => {
    const testOwner = `chunks-test-${Date.now()}`;
    const testRepo = 'chunk-repo';

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
        metrics: { totalFiles: 0, totalBytes: 0, languages: {}, categories: {}, largestFiles: [] },
        tree: [],
        analyzedAt: new Date(),
      })
      .returning();

    const [chunk] = await db
      .insert(codeChunks)
      .values({
        analysisId: analysis.id,
        filePath: 'src/index.ts',
        chunkIndex: 0,
        startLine: 1,
        endLine: 40,
        content: 'console.log("hello world");',
        language: 'TypeScript',
        category: 'source',
        embedding: [0.1, 0.2, 0.3],
        createdAt: new Date(),
      })
      .returning();

    expect(chunk.id).toBeDefined();
    expect(chunk.filePath).toBe('src/index.ts');
    expect(chunk.embedding).toEqual([0.1, 0.2, 0.3]);

    // Delete repo -> cascade deletes analysis and codeChunks
    await db.delete(repositories).where(eq(repositories.id, repo.id));

    const orphanChunks = await db
      .select()
      .from(codeChunks)
      .where(eq(codeChunks.analysisId, analysis.id));
    expect(orphanChunks).toHaveLength(0);
  });
});
