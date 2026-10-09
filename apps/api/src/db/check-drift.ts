import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getMigrationsFolder } from './migrate.js';

// 1. Ensure home directory local storage exists for drizzle-kit
try {
  fs.mkdirSync(path.join(os.homedir(), '.local', 'share'), { recursive: true });
} catch {
  // Ignore
}

// 2. Ensure journal entries all have their corresponding SQL and snapshot files
const drizzleDir = getMigrationsFolder();
const journalPath = path.join(drizzleDir, 'meta', '_journal.json');
if (!fs.existsSync(journalPath)) {
  console.error(`[db:check] Journal file missing: ${journalPath}`);
  process.exit(1);
}

const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
for (const entry of journal.entries) {
  const sqlFile = path.join(drizzleDir, `${entry.tag}.sql`);
  const snapshotFile = path.join(
    drizzleDir,
    'meta',
    `${String(entry.idx).padStart(4, '0')}_snapshot.json`
  );

  if (!fs.existsSync(sqlFile)) {
    console.error(`[db:check] Missing migration SQL file: ${sqlFile}`);
    process.exit(1);
  }
  if (!fs.existsSync(snapshotFile)) {
    console.error(`[db:check] Missing migration snapshot file: ${snapshotFile}`);
    process.exit(1);
  }
}

// 3. Run drizzle-kit generate:pg to ensure zero uncommitted schema drift
const apiDir = path.dirname(drizzleDir);
const repoRoot = path.resolve(apiDir, '../..');
const gitStatusBefore = execSync('git status --porcelain apps/api/drizzle', {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();

try {
  const out = execSync('npx drizzle-kit generate:pg', {
    cwd: apiDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  console.log(out.trim());
} catch (err: unknown) {
  console.error('[db:check] drizzle-kit generate:pg failed:', err);
  process.exit(1);
}

// 4. Verify drizzle-kit did not generate new migrations or modify existing files
const gitStatusAfter = execSync('git status --porcelain apps/api/drizzle', {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();

if (gitStatusBefore !== gitStatusAfter) {
  console.error(
    `[db:check] DRIFT DETECTED! drizzle-kit generated uncommitted schema changes:\n${gitStatusAfter}`
  );
  process.exit(1);
}

console.log('[db:check] Schema and migrations are 100% consistent. No drift detected.');
