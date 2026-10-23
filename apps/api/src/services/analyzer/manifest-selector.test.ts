import { describe, it, expect } from 'vitest';
import {
  selectManifestPathsToFetch,
  runWithConcurrency,
} from './manifest-selector.js';
import type { RawGitTreeItem } from '../github.service.js';

const makeBlob = (path: string): RawGitTreeItem => ({
  path,
  mode: '100644',
  type: 'blob',
  sha: 'fake-sha',
  size: 100,
});

describe('selectManifestPathsToFetch', () => {
  it('selects root manifests first and excludes vendor directories', () => {
    const rawTree: RawGitTreeItem[] = [
      makeBlob('node_modules/express/package.json'),
      makeBlob('vendor/bundle/gems/rails/Gemfile'),
      makeBlob('apps/api/package.json'),
      makeBlob('package.json'),
      makeBlob('pnpm-workspace.yaml'),
      makeBlob('packages/shared/package.json'),
      makeBlob('dist/package.json'),
      makeBlob('src/server.ts'),
    ];

    const selected = selectManifestPathsToFetch(rawTree, 25);

    expect(selected).toEqual([
      'package.json',
      'pnpm-workspace.yaml',
      'apps/api/package.json',
      'packages/shared/package.json',
    ]);
  });

  it('enforces maximum manifest cap', () => {
    const rawTree: RawGitTreeItem[] = [
      makeBlob('package.json'),
    ];

    for (let i = 1; i <= 30; i++) {
      rawTree.push(makeBlob(`packages/pkg-${i}/package.json`));
    }

    const selected = selectManifestPathsToFetch(rawTree, 10);
    expect(selected).toHaveLength(10);
    expect(selected[0]).toBe('package.json');
  });

  it('recognizes multiple ecosystem manifests in workspace repos', () => {
    const rawTree: RawGitTreeItem[] = [
      makeBlob('Cargo.toml'),
      makeBlob('crates/core/Cargo.toml'),
      makeBlob('pyproject.toml'),
      makeBlob('services/auth/requirements.txt'),
      makeBlob('go.mod'),
      makeBlob('services/worker/go.mod'),
      makeBlob('Dockerfile'),
      makeBlob('apps/web/Dockerfile'),
    ];

    const selected = selectManifestPathsToFetch(rawTree, 25);

    // Root manifests first, then depth 1/2
    expect(selected.slice(0, 4)).toEqual([
      'Cargo.toml',
      'Dockerfile',
      'go.mod',
      'pyproject.toml',
    ]);
    expect(selected).toContain('crates/core/Cargo.toml');
    expect(selected).toContain('services/auth/requirements.txt');
    expect(selected).toContain('services/worker/go.mod');
    expect(selected).toContain('apps/web/Dockerfile');
  });
});

describe('runWithConcurrency', () => {
  it('executes tasks with bounded parallel concurrency', async () => {
    let running = 0;
    let maxRunning = 0;

    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const results = await runWithConcurrency(items, 3, async (num) => {
      running++;
      if (running > maxRunning) maxRunning = running;
      await new Promise((resolve) => setTimeout(resolve, 20));
      running--;
      return num * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(maxRunning).toBeLessThanOrEqual(3);
  });
});
