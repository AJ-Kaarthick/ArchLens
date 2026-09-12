import { describe, it, expect } from 'vitest';
import {
  categorizePath,
  detectLandmark,
  buildFileTreeItems,
  detectTechStack,
  detectArchitecture,
  calculateMetrics,
  analyzeRepositoryData,
} from './index.js';
import type { RawGitTreeItem } from '../github.service.js';
import type { RepositoryMetadata } from '@archlens/shared';

describe('Deterministic Analyzer', () => {
  describe('categorizer', () => {
    it('categorizes test files accurately', () => {
      expect(categorizePath('src/utils.test.ts')).toBe('test');
      expect(categorizePath('tests/integration/api.spec.js')).toBe('test');
      expect(categorizePath('__tests__/index.tsx')).toBe('test');
      expect(categorizePath('pkg/server_test.go')).toBe('test');
      expect(categorizePath('tests/test_auth.py')).toBe('test');
      expect(categorizePath('fixtures/attribute-behavior/src/index.js')).toBe('test');
      expect(categorizePath('fixtures/dom/src/index.js')).toBe('test');
      expect(categorizePath('__fixtures__/sample.js')).toBe('test');
      expect(categorizePath('__mocks__/axios.ts')).toBe('test');
    });

    it('categorizes CI workflows', () => {
      expect(categorizePath('.github/workflows/ci.yml')).toBe('ci');
      expect(categorizePath('.gitlab-ci.yml')).toBe('ci');
      expect(categorizePath('Jenkinsfile')).toBe('ci');
    });

    it('categorizes documentation', () => {
      expect(categorizePath('README.md')).toBe('doc');
      expect(categorizePath('docs/architecture.md')).toBe('doc');
      expect(categorizePath('LICENSE')).toBe('doc');
      expect(categorizePath('CONTRIBUTING.rst')).toBe('doc');
    });

    it('categorizes config and manifests', () => {
      expect(categorizePath('package.json')).toBe('config');
      expect(categorizePath('tsconfig.json')).toBe('config');
      expect(categorizePath('Dockerfile')).toBe('config');
      expect(categorizePath('docker-compose.yml')).toBe('config');
      expect(categorizePath('pnpm-workspace.yaml')).toBe('config');
      expect(categorizePath('Cargo.toml')).toBe('config');
    });

    it('categorizes assets', () => {
      expect(categorizePath('public/logo.png')).toBe('asset');
      expect(categorizePath('assets/font.woff2')).toBe('asset');
      expect(categorizePath('icons/favicon.ico')).toBe('asset');
    });

    it('categorizes source code', () => {
      expect(categorizePath('src/index.ts')).toBe('source');
      expect(categorizePath('src/App.tsx')).toBe('source');
      expect(categorizePath('backend/main.go')).toBe('source');
      expect(categorizePath('lib/core.py')).toBe('source');
      expect(categorizePath('main.rs')).toBe('source');
    });
  });

  describe('detectLandmark', () => {
    it('detects documentation landmarks', () => {
      const readme = detectLandmark('README.md');
      expect(readme).not.toBeNull();
      expect(readme?.type).toBe('doc');

      const license = detectLandmark('LICENSE');
      expect(license).not.toBeNull();
      expect(license?.type).toBe('doc');
    });

    it('detects manifest landmarks', () => {
      const pkg = detectLandmark('package.json');
      expect(pkg).not.toBeNull();
      expect(pkg?.type).toBe('manifest');

      const cargo = detectLandmark('Cargo.toml');
      expect(cargo).not.toBeNull();
      expect(cargo?.type).toBe('manifest');
    });

    it('detects entrypoint landmarks', () => {
      const main = detectLandmark('src/main.tsx');
      expect(main).not.toBeNull();
      expect(main?.type).toBe('entry');

      const server = detectLandmark('src/server.ts');
      expect(server).not.toBeNull();
      expect(server?.type).toBe('entry');
    });

    it('rejects test, fixture, and mock files as landmarks', () => {
      expect(detectLandmark('fixtures/attribute-behavior/src/index.js')).toBeNull();
      expect(detectLandmark('fixtures/dom/src/index.js')).toBeNull();
      expect(detectLandmark('tests/index.ts')).toBeNull();
      expect(detectLandmark('__tests__/server.ts')).toBeNull();
      expect(detectLandmark('__mocks__/index.js')).toBeNull();
      expect(detectLandmark('packages/react/index.js')?.type).toBe('entry');
    });

    it('builds file tree items with landmark flag and categories', () => {
      const items = buildFileTreeItems([
        { path: 'README.md', mode: '100644', type: 'blob', sha: '1', size: 100 },
        { path: 'src', mode: '040000', type: 'tree', sha: '2' },
      ]);
      expect(items).toHaveLength(2);
      expect(items[0].isLandmark).toBe(true);
      expect(items[0].category).toBe('doc');
      expect(items[1].type).toBe('dir');
    });
  });

  describe('detectTechStack', () => {
    const rawTree: RawGitTreeItem[] = [
      { path: 'package.json', mode: '100644', type: 'blob', sha: '1', size: 500 },
      { path: 'Dockerfile', mode: '100644', type: 'blob', sha: '2', size: 200 },
      { path: '.github/workflows/build.yml', mode: '100644', type: 'blob', sha: '3', size: 300 },
      { path: 'src/index.ts', mode: '100644', type: 'blob', sha: '4', size: 1000 },
      { path: 'src/App.tsx', mode: '100644', type: 'blob', sha: '5', size: 800 },
    ];

    const packageJsonContent = JSON.stringify({
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0',
        fastify: '^4.26.0',
        tailwindcss: '^3.4.0',
        'drizzle-orm': '^0.30.0',
        postgres: '^3.4.0',
      },
      devDependencies: {
        typescript: '^5.0.0',
        vite: '^5.0.0',
        vitest: '^1.5.0',
      },
    });

    it('detects frameworks, tooling, databases, and languages', () => {
      const tech = detectTechStack(rawTree, { 'package.json': packageJsonContent });

      const names = tech.map((t) => t.name);
      expect(names).toContain('React');
      expect(names).toContain('Fastify');
      expect(names).toContain('Tailwind CSS');
      expect(names).toContain('Drizzle ORM');
      expect(names).toContain('Vite');
      expect(names).toContain('Vitest');
      expect(names).toContain('Docker');
      expect(names).toContain('GitHub Actions');
      expect(names).toContain('TypeScript');

      // Verify versions extracted
      const react = tech.find((t) => t.name === 'React');
      expect(react?.version).toBe('18.2.0');
      expect(react?.confidence).toBe('high');
    });
  });

  describe('detectArchitecture', () => {
    it('detects monorepo with pnpm workspaces and client-server separation', () => {
      const tree: RawGitTreeItem[] = [
        { path: 'pnpm-workspace.yaml', mode: '100644', type: 'blob', sha: '1', size: 50 },
        { path: 'apps/web/src/App.tsx', mode: '100644', type: 'blob', sha: '2', size: 100 },
        { path: 'apps/api/src/server.ts', mode: '100644', type: 'blob', sha: '3', size: 100 },
        { path: 'packages/shared/src/index.ts', mode: '100644', type: 'blob', sha: '4', size: 100 },
        { path: 'Dockerfile', mode: '100644', type: 'blob', sha: '5', size: 50 },
      ];

      const pnpmWorkspaceContent = `packages:
  - "apps/*"
  - "packages/*"`;

      const arch = detectArchitecture(tree, { 'pnpm-workspace.yaml': pnpmWorkspaceContent });

      expect(arch.isMonorepo).toBe(true);
      expect(arch.monorepoTool).toBe('pnpm workspaces');
      expect(arch.workspaces).toEqual(['apps/*', 'packages/*']);
      expect(arch.detectedPatterns).toContain('Monorepo Architecture');
      expect(arch.detectedPatterns).toContain('Client-Server Separation');
      expect(arch.detectedPatterns).toContain('Containerized');
      expect(arch.primaryEntrypoints).toContain('apps/web/src/App.tsx');
      expect(arch.primaryEntrypoints).toContain('apps/api/src/server.ts');
    });

    it('excludes fixture files and discovers package entrypoints in monorepos', () => {
      const tree: RawGitTreeItem[] = [
        { path: 'fixtures/attribute-behavior/src/index.js', mode: '100644', type: 'blob', sha: '1', size: 50 },
        { path: 'fixtures/dom/src/index.js', mode: '100644', type: 'blob', sha: '2', size: 50 },
        { path: 'packages/react/index.js', mode: '100644', type: 'blob', sha: '3', size: 500 },
        { path: 'packages/react-dom/index.js', mode: '100644', type: 'blob', sha: '4', size: 500 },
      ];

      const arch = detectArchitecture(tree, {});
      expect(arch.primaryEntrypoints).not.toContain('fixtures/attribute-behavior/src/index.js');
      expect(arch.primaryEntrypoints).not.toContain('fixtures/dom/src/index.js');
      expect(arch.primaryEntrypoints).toContain('packages/react/index.js');
      expect(arch.primaryEntrypoints).toContain('packages/react-dom/index.js');
    });
  });

  describe('calculateMetrics', () => {
    it('calculates structural metrics and language breakdown percentages', () => {
      const tree: RawGitTreeItem[] = [
        { path: 'src/a.ts', mode: '100644', type: 'blob', sha: '1', size: 6000 },
        { path: 'src/b.ts', mode: '100644', type: 'blob', sha: '2', size: 2000 },
        { path: 'README.md', mode: '100644', type: 'blob', sha: '3', size: 1000 },
        { path: 'package.json', mode: '100644', type: 'blob', sha: '4', size: 1000 },
        { path: 'src', mode: '040000', type: 'tree', sha: '5' },
      ];

      const metrics = calculateMetrics(tree);

      expect(metrics.totalFiles).toBe(4);
      expect(metrics.totalBytes).toBe(10000);
      expect(metrics.languages['TypeScript'].bytes).toBe(8000);
      expect(metrics.languages['TypeScript'].percentage).toBe(80);
      expect(metrics.languages['Markdown'].percentage).toBe(10);
      expect(metrics.languages['JSON'].percentage).toBe(10);
      expect(metrics.largestFiles[0].path).toBe('src/a.ts');
      expect(metrics.largestFiles[0].size).toBe(6000);
    });
  });

  describe('analyzeRepositoryData pipeline', () => {
    it('produces full AnalysisResult from raw repository data', () => {
      const repository: RepositoryMetadata = {
        id: '1',
        owner: 'archlens',
        name: 'test-repo',
        url: 'https://github.com/archlens/test-repo',
        defaultBranch: 'main',
        description: 'Test Repository',
        stars: 15,
        forks: 3,
        primaryLanguage: 'TypeScript',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };

      const rawTree: RawGitTreeItem[] = [
        { path: 'README.md', mode: '100644', type: 'blob', sha: '1', size: 200 },
        { path: 'package.json', mode: '100644', type: 'blob', sha: '2', size: 400 },
        { path: 'src/index.ts', mode: '100644', type: 'blob', sha: '3', size: 800 },
      ];

      const result = analyzeRepositoryData({
        repository,
        commitSha: 'sha-12345',
        rawTree,
        manifestContents: {
          'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
        },
      });

      expect(result.repository.name).toBe('test-repo');
      expect(result.commitSha).toBe('sha-12345');
      expect(result.tree).toHaveLength(3);
      expect(result.metrics.totalFiles).toBe(3);
      expect(result.techStack.some((t) => t.name === 'React')).toBe(true);
      expect(result.analyzedAt).toBeDefined();
    });
  });
});
