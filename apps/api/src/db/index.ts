import '../config/env.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/archlens';

export const sql = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(sql, { schema });

/**
 * Ensures required database tables and unique indexes exist.
 * Runs idempotently on server start or migration.
 */
export async function initDb(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS repositories (
      id SERIAL PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      description TEXT,
      stars INTEGER NOT NULL DEFAULT 0,
      forks INTEGER NOT NULL DEFAULT 0,
      primary_language TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS repositories_owner_name_unique
    ON repositories (owner, name);
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS analyses (
      id SERIAL PRIMARY KEY,
      repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      commit_sha TEXT,
      tech_stack JSONB NOT NULL,
      architecture JSONB NOT NULL,
      metrics JSONB NOT NULL,
      tree JSONB NOT NULL,
      analyzed_at TIMESTAMPTZ NOT NULL
    );
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS analyses_repo_analyzed_at_idx
    ON analyses (repository_id, analyzed_at DESC);
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ai_explanations (
      id SERIAL PRIMARY KEY,
      analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      target TEXT,
      summary TEXT NOT NULL,
      explanation TEXT NOT NULL,
      key_takeaways JSONB NOT NULL,
      evidence JSONB NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_explanations_unique
    ON ai_explanations (analysis_id, topic, COALESCE(target, ''));
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS code_chunks (
      id SERIAL PRIMARY KEY,
      analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      content TEXT NOT NULL,
      language TEXT,
      category TEXT NOT NULL,
      embedding JSONB,
      created_at TIMESTAMPTZ NOT NULL
    );
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS code_chunks_analysis_idx
    ON code_chunks (analysis_id);
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS code_chunks_analysis_file_chunk_unique
    ON code_chunks (analysis_id, file_path, chunk_index);
  `;

  const isVectorSupported = await hasPgVectorSupport();
  if (isVectorSupported) {
    try {
      await sql`
        ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS embedding_vec vector(768);
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS code_chunks_embedding_hnsw_idx
        ON code_chunks USING hnsw (embedding_vec vector_cosine_ops);
      `;
    } catch {
      // Handled gracefully if vector type is not supported
    }
  }
}

let _hasPgVector: boolean | null = null;

export async function hasPgVectorSupport(): Promise<boolean> {
  if (_hasPgVector !== null) return _hasPgVector;
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector;`;
    const res = await sql`SELECT 1 FROM pg_extension WHERE extname = 'vector';`;
    _hasPgVector = res.length > 0;
  } catch {
    _hasPgVector = false;
  }
  return _hasPgVector;
}
