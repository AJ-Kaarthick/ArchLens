import '../config/env.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export interface DbConfig {
  connectionString: string;
  max: number;
  idle_timeout: number;
  connect_timeout: number;
  ssl?: boolean | 'require' | 'prefer';
}

/**
 * Returns database connection and pool parameters from environment variables
 * with sensible production defaults.
 */
export function getDbConfig(): DbConfig {
  const connectionString =
    process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/archlens';

  const max = process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 10;
  const idle_timeout = process.env.DB_IDLE_TIMEOUT ? parseInt(process.env.DB_IDLE_TIMEOUT, 10) : 20;
  const connect_timeout = process.env.DB_CONNECT_TIMEOUT
    ? parseInt(process.env.DB_CONNECT_TIMEOUT, 10)
    : 10;

  let ssl: boolean | 'require' | 'prefer' | undefined = undefined;
  const rawSsl = process.env.DB_SSL?.toLowerCase();
  if (rawSsl === 'require') {
    ssl = 'require';
  } else if (rawSsl === 'prefer') {
    ssl = 'prefer';
  } else if (rawSsl === 'true') {
    ssl = true;
  } else if (rawSsl === 'false') {
    ssl = false;
  }

  return {
    connectionString,
    max,
    idle_timeout,
    connect_timeout,
    ...(ssl !== undefined ? { ssl } : {}),
  };
}

const config = getDbConfig();

export const sql = postgres(config.connectionString, {
  max: config.max,
  idle_timeout: config.idle_timeout,
  connect_timeout: config.connect_timeout,
  ...(config.ssl !== undefined ? { ssl: config.ssl } : {}),
});

export const db = drizzle(sql, { schema });

/**
 * Verifies database connectivity without performing any schema-creation DDL.
 * Used during application startup to fail fast if the database is unreachable.
 */
export async function checkDbConnection(): Promise<boolean> {
  const res = await sql`SELECT 1 as alive;`;
  return res.length > 0;
}

/**
 * Validates database readiness on application startup or test setup.
 * Schema DDL has been moved to versioned migrations (pnpm db:migrate).
 */
export async function initDb(): Promise<void> {
  await checkDbConnection();
}

let _hasPgVector: boolean | null = null;

export async function hasPgVectorSupport(): Promise<boolean> {
  if (_hasPgVector !== null) return _hasPgVector;
  try {
    const res = await sql`SELECT 1 FROM pg_extension WHERE extname = 'vector';`;
    _hasPgVector = res.length > 0;
  } catch {
    _hasPgVector = false;
  }
  return _hasPgVector;
}

/**
 * Gracefully closes the database connection pool.
 * Used during process termination / graceful shutdown.
 */
export async function closeDbConnection(timeoutSeconds: number = 5): Promise<void> {
  try {
    await sql.end({ timeout: timeoutSeconds });
  } catch {
    // Ignore errors during closing if already closed
  }
}
