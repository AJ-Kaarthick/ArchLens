import '../config/env.js';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getDbConfig } from './index.js';

/**
 * Resolves the absolute path to the drizzle migrations folder.
 * Traverses candidate paths to support running from monorepo root, apps/api, or nested directories.
 */
export function getMigrationsFolder(): string {
  const candidatePaths: string[] = [
    path.resolve(process.cwd(), 'drizzle'),
    path.resolve(process.cwd(), 'apps/api/drizzle'),
  ];

  let current = process.cwd();
  for (let i = 0; i < 4; i++) {
    candidatePaths.push(path.join(current, 'apps/api/drizzle'));
    candidatePaths.push(path.join(current, 'drizzle'));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  for (const candidate of candidatePaths) {
    const journal = path.join(candidate, 'meta', '_journal.json');
    if (fs.existsSync(journal)) {
      return candidate;
    }
  }

  return path.resolve(process.cwd(), 'apps/api/drizzle');
}

/**
 * Runs pending Drizzle database migrations against PostgreSQL.
 * Safe for both fresh databases and existing populated databases.
 */
export async function runMigrations(customConnectionString?: string): Promise<void> {
  const config = getDbConfig();
  const connectionString = customConnectionString || config.connectionString;
  const migrationsFolder = getMigrationsFolder();

  console.log(`[db:migrate] Connecting to database: ${connectionString.replace(/:[^:@]+@/, ':****@')}`);
  console.log(`[db:migrate] Using migrations folder: ${migrationsFolder}`);

  // Use a dedicated single-connection client for migrations
  const migrationClient = postgres(connectionString, {
    max: 1,
    connect_timeout: config.connect_timeout,
    ssl: config.ssl,
  });

  try {
    const db = drizzle(migrationClient);
    await migrate(db, { migrationsFolder });
    console.log('[db:migrate] All migrations applied successfully.');
  } finally {
    await migrationClient.end();
  }
}

// CLI entry point
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js'));

if (isDirectExecution) {
  runMigrations()
    .then(() => {
      console.log('[db:migrate] Migration process finished.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[db:migrate] Migration failed:', err);
      process.exit(1);
    });
}
