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
}
