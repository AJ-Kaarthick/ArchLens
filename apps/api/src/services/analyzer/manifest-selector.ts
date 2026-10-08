import type { RawGitTreeItem } from '../github.service.js';

export const RECOGNIZED_MANIFEST_NAMES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'Cargo.toml',
  'go.mod',
  'go.work',
  'pyproject.toml',
  'requirements.txt',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Dockerfile',
]);

const EXCLUDED_DIR_PATTERNS = [
  /(?:^|\/)node_modules\//i,
  /(?:^|\/)vendor\//i,
  /(?:^|\/)\.git\//i,
  /(?:^|\/)dist\//i,
  /(?:^|\/)build\//i,
  /(?:^|\/)target\//i,
  /(?:^|\/)\.venv\//i,
  /(?:^|\/)venv\//i,
  /(?:^|\/)__pycache__\//i,
  /(?:^|\/)\.cache\//i,
  /(?:^|\/)\.next\//i,
  /(?:^|\/)\.turbo\//i,
];

/**
 * Selects prioritized manifest filepaths from a repository git tree.
 * Enforces bounded selection (default 25 manifests) to avoid blowing GitHub API quotas
 * or memory on massive monorepos.
 *
 * Priority ordering:
 * 1. Root manifests (depth 0, e.g. package.json, pnpm-workspace.yaml, Cargo.toml)
 * 2. Primary workspace / package manifests (depth 1 or 2, e.g. apps/api/package.json, packages/shared/package.json)
 * 3. Deeply nested manifests (depth 3+) up to the maximum limit.
 */
export function selectManifestPathsToFetch(
  tree: RawGitTreeItem[],
  maxManifests = 25
): string[] {
  const candidates: Array<{ path: string; depth: number; isRoot: boolean }> = [];

  for (const item of tree) {
    if (item.type !== 'blob') continue;

    // Skip ignored/vendor directories
    if (EXCLUDED_DIR_PATTERNS.some((pattern) => pattern.test(item.path))) {
      continue;
    }

    const segments = item.path.split('/');
    const filename = segments[segments.length - 1];

    if (RECOGNIZED_MANIFEST_NAMES.has(filename) || filename.startsWith('Dockerfile')) {
      const depth = segments.length - 1;
      candidates.push({
        path: item.path,
        depth,
        isRoot: depth === 0,
      });
    }
  }

  // Sort candidates:
  // 1. Root manifests first (depth === 0)
  // 2. Shallower depths before deeper depths
  // 3. Deterministic alphabetical order by path
  candidates.sort((a, b) => {
    if (a.isRoot !== b.isRoot) {
      return a.isRoot ? -1 : 1;
    }
    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    return a.path.localeCompare(b.path);
  });

  return candidates.slice(0, maxManifests).map((c) => c.path);
}

/**
 * Bounded concurrency executor.
 * Runs an asynchronous task across an array of items with bounded parallel workers.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx]);
    }
  });

  await Promise.all(workers);
  return results;
}
