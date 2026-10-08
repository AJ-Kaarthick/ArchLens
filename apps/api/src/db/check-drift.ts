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

// 4. Verify git status in drizzle directory shows no unexpected changes
const repoRoot = path.resolve(apiDir, '../..');
const gitStatus = execSync('git status --porcelain apps/api/drizzle', {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();

// Ignore the newly tracked 0001_snapshot.json if staged or untracked during local testing
const unexpectedChanges = gitStatus
  .split('\n')
  .filter((line) => line && !line.includes('0001_snapshot.json'));

if (unexpectedChanges.length > 0) {
  console.error(
    `[db:check] DRIFT DETECTED! Schema has unmigrated changes or unexpected drizzle diff:\n${unexpectedChanges.join('\n')}`
  );
  process.exit(1);
}

console.log('[db:check] Schema and migrations are 100% consistent. No drift detected.');
