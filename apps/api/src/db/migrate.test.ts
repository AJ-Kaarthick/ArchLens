import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import postgres from 'postgres';
import { getMigrationsFolder, runMigrations } from './migrate.js';
import { getDbConfig } from './index.js';

describe('Database Migration Runner', () => {

  it('locates the drizzle migrations folder with journal metadata', () => {
    const migrationsFolder = getMigrationsFolder();
    expect(fs.existsSync(migrationsFolder)).toBe(true);

    const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
    expect(fs.existsSync(journalPath)).toBe(true);

    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    expect(journal.entries).toBeDefined();
    expect(journal.entries.length).toBeGreaterThan(0);

    for (const entry of journal.entries) {
      const sqlFile = path.join(migrationsFolder, `${entry.tag}.sql`);
      const snapshotFile = path.join(
        migrationsFolder,
        'meta',
        `${String(entry.idx).padStart(4, '0')}_snapshot.json`
      );
      expect(fs.existsSync(sqlFile)).toBe(true);
      expect(fs.existsSync(snapshotFile)).toBe(true);
    }
  });

  it('applies migrations idempotently against the configured database', async () => {
    await expect(runMigrations()).resolves.toBeUndefined();
  });

  it('successfully migrates a completely fresh database and creates all tables and indexes', async () => {
    const config = getDbConfig();
    // Connect to administrative 'postgres' database to create/drop temporary test database
    const adminUrl = config.connectionString.replace(/\/[^/]+$/, '/postgres');
    const adminClient = postgres(adminUrl, { max: 1 });

    const tempDbName = `archlens_migration_test_${Date.now()}`;
    const tempDbUrl = config.connectionString.replace(/\/[^/]+$/, `/${tempDbName}`);

    try {
      await adminClient.unsafe(`CREATE DATABASE ${tempDbName};`);

      // Run migrations on the fresh empty database
      await runMigrations(tempDbUrl);

      // Verify created tables and indexes in the fresh database
      const testClient = postgres(tempDbUrl, { max: 1 });
      try {
        const tables = await testClient`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
          ORDER BY table_name;
        `;
        const tableNames = tables.map((t) => t.table_name);
        expect(tableNames).toContain('repositories');
        expect(tableNames).toContain('analyses');
        expect(tableNames).toContain('ai_explanations');
        expect(tableNames).toContain('code_chunks');
        expect(tableNames).toContain('repository_executions');

        const indexes = await testClient`
          SELECT indexname
          FROM pg_indexes
          WHERE tablename = 'analyses'
          ORDER BY indexname;
        `;
        const indexNames = indexes.map((i) => i.indexname);
        expect(indexNames).toContain('analyses_analyzed_at_desc_idx');
        expect(indexNames).toContain('analyses_repo_analyzed_at_idx');
        expect(indexNames).toContain('analyses_pkey');

        const migrationRecords = await testClient`
          SELECT id, hash FROM drizzle.__drizzle_migrations;
        `;
        expect(migrationRecords).toHaveLength(3);

        // Verify pgvector extension exists
        const extensions = await testClient`
          SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
        `;
        expect(extensions).toHaveLength(1);
        expect(extensions[0].extname).toBe('vector');

        // Verify embedding_vec column exists on code_chunks with vector(768)
        const chunkCols = await testClient`
          SELECT column_name, data_type, udt_name
          FROM information_schema.columns
          WHERE table_name = 'code_chunks' AND column_name = 'embedding_vec';
        `;
        expect(chunkCols).toHaveLength(1);
        expect(chunkCols[0].udt_name).toBe('vector');

        const typeInfo = await testClient`
          SELECT atttypmod
          FROM pg_attribute
          WHERE attrelid = 'code_chunks'::regclass AND attname = 'embedding_vec';
        `;
        expect(typeInfo[0]?.atttypmod).toBe(768);

        // Verify code_chunks_embedding_hnsw_idx index exists with hnsw and vector_cosine_ops
        const hnswIdx = await testClient`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE tablename = 'code_chunks' AND indexname = 'code_chunks_embedding_hnsw_idx';
        `;
        expect(hnswIdx).toHaveLength(1);
        expect(hnswIdx[0].indexdef).toContain('hnsw');
        expect(hnswIdx[0].indexdef).toContain('vector_cosine_ops');

        // Verify unique indexes with NULLS NOT DISTINCT exist
        const analysesIndexes = await testClient`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE tablename = 'analyses' AND indexname = 'analyses_repo_commit_sha_unique';
        `;
        expect(analysesIndexes).toHaveLength(1);
        expect(analysesIndexes[0].indexdef).toContain('NULLS NOT DISTINCT');

        const explanationIndexes = await testClient`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE tablename = 'ai_explanations' AND indexname = 'ai_explanations_repo_sha_topic_target_version_unique';
        `;
        expect(explanationIndexes).toHaveLength(1);
        expect(explanationIndexes[0].indexdef).toContain('NULLS NOT DISTINCT');

        // Verify column nullability semantics
        const explanationCols = await testClient`
          SELECT column_name, is_nullable
          FROM information_schema.columns
          WHERE table_name = 'ai_explanations' AND column_name IN ('analysis_id', 'repository_id', 'commit_sha');
        `;
        const analysisIdCol = explanationCols.find((c) => c.column_name === 'analysis_id');
        const repoIdCol = explanationCols.find((c) => c.column_name === 'repository_id');
        const commitShaCol = explanationCols.find((c) => c.column_name === 'commit_sha');

        expect(analysisIdCol?.is_nullable).toBe('YES');
        expect(repoIdCol?.is_nullable).toBe('NO');
        expect(commitShaCol?.is_nullable).toBe('NO');
      } finally {
        await testClient.end();
      }
    } finally {
      await adminClient.unsafe(`DROP DATABASE IF EXISTS ${tempDbName};`);
      await adminClient.end();
    }
  });

  it('fails visibly and does not record broken migrations in the ledger when a migration statement fails', async () => {
    const config = getDbConfig();
    const adminUrl = config.connectionString.replace(/\/[^/]+$/, '/postgres');
    const adminClient = postgres(adminUrl, { max: 1 });

    const tempDbName = `archlens_fail_test_${Date.now()}`;
    const tempDbUrl = config.connectionString.replace(/\/[^/]+$/, `/${tempDbName}`);

    const tempMigFolder = path.join(os.tmpdir(), `archlens_bad_mig_${Date.now()}`);
    const metaFolder = path.join(tempMigFolder, 'meta');
    fs.mkdirSync(metaFolder, { recursive: true });

    fs.writeFileSync(
      path.join(tempMigFolder, '0000_broken.sql'),
      'CREATE TABLE valid_tbl (id serial primary key);\n--> statement-breakpoint\nTHIS IS INVALID SQL SYNTAX;'
    );
    fs.writeFileSync(
      path.join(metaFolder, '_journal.json'),
      JSON.stringify({
        version: '5',
        dialect: 'pg',
        entries: [
          { idx: 0, version: '5', when: 1000, tag: '0000_broken', breakpoints: true },
        ],
      })
    );

    try {
      await adminClient.unsafe(`CREATE DATABASE ${tempDbName};`);

      // Migration must fail visibly by rejecting rather than silently swallowing errors
      await expect(runMigrations(tempDbUrl, tempMigFolder)).rejects.toThrow();

      // Ledger must NOT record the broken migration
      const testClient = postgres(tempDbUrl, { max: 1 });
      try {
        const migrations = await testClient`
          SELECT * FROM drizzle.__drizzle_migrations;
        `.catch(() => []);
        expect(migrations).toHaveLength(0);
      } finally {
        await testClient.end();
      }
    } finally {
      fs.rmSync(tempMigFolder, { recursive: true, force: true });
      await adminClient.unsafe(`DROP DATABASE IF EXISTS ${tempDbName};`);
      await adminClient.end();
    }
  });
});
