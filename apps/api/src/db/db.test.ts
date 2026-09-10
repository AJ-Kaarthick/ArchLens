import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, db, sql } from './index.js';
import { repositories } from './schema.js';
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
});
