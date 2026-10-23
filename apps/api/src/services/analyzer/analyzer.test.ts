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

    it('constructs deterministic reading guidance for fullstack monorepo', () => {
      const tree: RawGitTreeItem[] = [
        { path: 'README.md', mode: '100644', type: 'blob', sha: '1', size: 100 },
        { path: 'pnpm-workspace.yaml', mode: '100644', type: 'blob', sha: '2', size: 50 },
        { path: 'apps/web/src/App.tsx', mode: '100644', type: 'blob', sha: '3', size: 100 },
        { path: 'apps/api/src/server.ts', mode: '100644', type: 'blob', sha: '4', size: 100 },
        { path: 'packages/shared/src/index.ts', mode: '100644', type: 'blob', sha: '5', size: 100 },
        { path: 'Dockerfile', mode: '100644', type: 'blob', sha: '6', size: 50 },
      ];

      const arch = detectArchitecture(tree, {
        'pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n  - "packages/*"',
      });

      expect(arch.readingGuidance).toBeDefined();
      const guidance = arch.readingGuidance!;
      expect(guidance.length).toBeGreaterThanOrEqual(4);

      // Verify sequence and roles
      expect(guidance[0]).toEqual({
        step: 1,
        path: 'README.md',
        name: 'README.md',
        role: 'overview',
        rationale: expect.stringContaining('Start here'),
      });

      expect(guidance[1]).toEqual({
        step: 2,
        path: 'pnpm-workspace.yaml',
        name: 'pnpm-workspace.yaml',
        role: 'root-manifest',
        rationale: expect.stringContaining('workspace topology'),
      });

      const paths = guidance.map((g) => g.path);
      expect(paths).toContain('apps/api/src/server.ts');
      expect(paths).toContain('apps/web/src/App.tsx');
      expect(paths).toContain('packages/shared/src/index.ts');
      expect(paths).toContain('Dockerfile');

      // Verify no duplicates
      const uniquePaths = new Set(paths);
      expect(uniquePaths.size).toBe(paths.length);
    });

    it('constructs reading guidance for a single-package Go service', () => {
      const tree: RawGitTreeItem[] = [
        { path: 'README.md', mode: '100644', type: 'blob', sha: '1', size: 100 },
        { path: 'go.mod', mode: '100644', type: 'blob', sha: '2', size: 50 },
        { path: 'cmd/main.go', mode: '100644', type: 'blob', sha: '3', size: 100 },
        { path: 'docker-compose.yml', mode: '100644', type: 'blob', sha: '4', size: 100 },
      ];

      const arch = detectArchitecture(tree, {
        'go.mod': 'module github.com/example/service\n\ngo 1.21',
      });

      expect(arch.readingGuidance).toBeDefined();
      const guidance = arch.readingGuidance!;
      expect(guidance).toHaveLength(4);
      expect(guidance.map((g) => g.path)).toEqual([
        'README.md',
        'go.mod',
        'cmd/main.go',
        'docker-compose.yml',
      ]);
      expect(guidance[0].role).toBe('overview');
      expect(guidance[1].role).toBe('root-manifest');
      expect(guidance[2].role).toBe('entrypoint');
      expect(guidance[3].role).toBe('configuration');
    });

    it('constructs reading guidance for a Rust library crate without docker', () => {
      const tree: RawGitTreeItem[] = [
        { path: 'README.md', mode: '100644', type: 'blob', sha: '1', size: 100 },
        { path: 'Cargo.toml', mode: '100644', type: 'blob', sha: '2', size: 50 },
        { path: 'src/lib.rs', mode: '100644', type: 'blob', sha: '3', size: 100 },
      ];

      const arch = detectArchitecture(tree, {
        'Cargo.toml': '[package]\nname = "mycrate"\nversion = "0.1.0"',
      });

      expect(arch.readingGuidance).toBeDefined();
      const guidance = arch.readingGuidance!;
      expect(guidance).toHaveLength(3);
      expect(guidance.map((g) => g.path)).toEqual([
        'README.md',
        'Cargo.toml',
        'src/lib.rs',
      ]);
      expect(guidance[0].role).toBe('overview');
      expect(guidance[1].role).toBe('root-manifest');
      expect(guidance[2].role).toBe('entrypoint');
    });

    it('handles minimal repositories gracefully with zero crashes', () => {
      const tree: RawGitTreeItem[] = [
        { path: 'script.py', mode: '100644', type: 'blob', sha: '1', size: 100 },
      ];

      const arch = detectArchitecture(tree, {});
      expect(Array.isArray(arch.readingGuidance)).toBe(true);
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

  describe('Workspace-Aware Ecosystem Fixtures', () => {
    const dummyRepoMeta: RepositoryMetadata = {
      id: '1',
      owner: 'test',
      name: 'fixture-repo',
      url: 'https://github.com/test/fixture-repo',
      defaultBranch: 'main',
      description: 'Fixture',
      stars: 1,
      forks: 0,
      primaryLanguage: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    const makeBlob = (path: string, size = 100): RawGitTreeItem => ({
      path,
      mode: '100644',
      type: 'blob',
      sha: 'fake-sha',
      size,
    });

    it('Fixture 1: normal single-package repository', () => {
      const tree: RawGitTreeItem[] = [
        makeBlob('package.json'),
        makeBlob('src/server.ts'),
        makeBlob('tests/server.test.ts'),
      ];
      const manifestContents = {
        'package.json': JSON.stringify({
          dependencies: { express: '^4.19.2' },
          devDependencies: { jest: '^29.7.0', typescript: '^5.4.5' },
        }),
      };

      const result = analyzeRepositoryData({
        repository: dummyRepoMeta,
        commitSha: 'sha-single',
        rawTree: tree,
        manifestContents,
      });

      expect(result.architecture.isMonorepo).toBe(false);
      expect(result.architecture.workspaces).toHaveLength(0);
      expect(result.techStack.some((t) => t.name === 'Express')).toBe(true);
      expect(result.techStack.some((t) => t.name === 'Jest')).toBe(true);
      expect(result.architecture.primaryEntrypoints).toContain('src/server.ts');
    });

    it('Fixture 2: pnpm monorepo with multiple apps and shared packages', () => {
      const tree: RawGitTreeItem[] = [
        makeBlob('pnpm-workspace.yaml'),
        makeBlob('package.json'),
        makeBlob('apps/api/package.json'),
        makeBlob('apps/api/src/server.ts'),
        makeBlob('apps/web/package.json'),
        makeBlob('apps/web/src/main.tsx'),
        makeBlob('packages/shared/package.json'),
        makeBlob('packages/shared/src/index.ts'),
      ];

      const manifestContents = {
        'pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n  - "packages/*"',
        'package.json': JSON.stringify({ devDependencies: { turbo: '^1.13.0' } }),
        'apps/api/package.json': JSON.stringify({
          dependencies: { fastify: '^4.26.2', 'drizzle-orm': '^0.30.7' },
        }),
        'apps/web/package.json': JSON.stringify({
          dependencies: { react: '^18.2.0', tailwindcss: '^3.4.1' },
          devDependencies: { vite: '^5.2.0' },
        }),
        'packages/shared/package.json': JSON.stringify({
          dependencies: { zod: '^3.22.4' },
        }),
      };

      const result = analyzeRepositoryData({
        repository: dummyRepoMeta,
        commitSha: 'sha-pnpm',
        rawTree: tree,
        manifestContents,
      });

      expect(result.architecture.isMonorepo).toBe(true);
      expect(result.architecture.monorepoTool).toBe('pnpm workspaces');
      expect(result.architecture.workspaces).toEqual(
        expect.arrayContaining(['apps/api', 'apps/web', 'packages/shared'])
      );

      // Verify nested manifest dependencies are detected and attributed to their workspace
      const fastify = result.techStack.find((t) => t.name === 'Fastify');
      expect(fastify).toBeDefined();
      expect(fastify?.evidence).toContain('apps/api/package.json');

      const react = result.techStack.find((t) => t.name === 'React');
      expect(react).toBeDefined();
      expect(react?.evidence).toContain('apps/web/package.json');

      const zod = result.techStack.find((t) => t.name === 'Zod');
      expect(zod).toBeDefined();
      expect(zod?.evidence).toContain('packages/shared/package.json');

      expect(result.architecture.primaryEntrypoints).toContain('apps/api/src/server.ts');
      expect(result.architecture.primaryEntrypoints).toContain('apps/web/src/main.tsx');
    });

    it('Fixture 3: Python multi-package repository with requirements and pyproject', () => {
      const tree: RawGitTreeItem[] = [
        makeBlob('services/api/requirements.txt'),
        makeBlob('services/api/main.py'),
        makeBlob('services/worker/pyproject.toml'),
        makeBlob('services/worker/app.py'),
      ];

      const manifestContents = {
        'services/api/requirements.txt': `
# Web service dependencies
fastapi>=0.110.0
uvicorn[standard]>=0.29.0
sqlalchemy==2.0.29
pytest>=8.1.1
`,
        'services/worker/pyproject.toml': `
[project]
name = "worker"
dependencies = [
    "celery>=5.3.6",
    "redis>=5.0.3",
]
`,
      };

      const result = analyzeRepositoryData({
        repository: dummyRepoMeta,
        commitSha: 'sha-py',
        rawTree: tree,
        manifestContents,
      });

      expect(result.architecture.isMonorepo).toBe(true);
      expect(result.techStack.some((t) => t.name === 'Python')).toBe(true);
      expect(result.techStack.some((t) => t.name === 'FastAPI')).toBe(true);
      expect(result.techStack.some((t) => t.name === 'SQLAlchemy')).toBe(true);
      expect(result.techStack.some((t) => t.name === 'Celery')).toBe(true);
      expect(result.techStack.some((t) => t.name === 'Redis')).toBe(true);

      const fastapi = result.techStack.find((t) => t.name === 'FastAPI');
      expect(fastapi?.evidence).toContain('services/api/requirements.txt');
    });

    it('Fixture 4: Cargo workspace with member crates', () => {
      const tree: RawGitTreeItem[] = [
        makeBlob('Cargo.toml'),
        makeBlob('crates/server/Cargo.toml'),
        makeBlob('crates/server/src/main.rs'),
        makeBlob('crates/core/Cargo.toml'),
        makeBlob('crates/core/src/lib.rs'),
      ];

      const manifestContents = {
        'Cargo.toml': `
[workspace]
members = [
    "crates/server",
    "crates/core",
]
`,
        'crates/server/Cargo.toml': `
[package]
name = "server"
version = "0.1.0"

[dependencies]
axum = "0.7.5"
tokio = { version = "1.38", features = ["full"] }
`,
        'crates/core/Cargo.toml': `
[package]
name = "core"
version = "0.1.0"

[dependencies]
serde = "1.0.203"
`,
      };

      const result = analyzeRepositoryData({
        repository: dummyRepoMeta,
        commitSha: 'sha-cargo',
        rawTree: tree,
        manifestContents,
      });

      expect(result.architecture.isMonorepo).toBe(true);
      expect(result.architecture.monorepoTool).toBe('Cargo workspace');
      expect(result.architecture.workspaces).toContain('crates/server');
      expect(result.architecture.workspaces).toContain('crates/core');

      expect(result.techStack.some((t) => t.name === 'Rust')).toBe(true);
      expect(result.techStack.some((t) => t.name === 'Axum')).toBe(true);
      expect(result.techStack.some((t) => t.name === 'Tokio')).toBe(true);
      expect(result.techStack.some((t) => t.name === 'Serde')).toBe(true);

      const axum = result.techStack.find((t) => t.name === 'Axum');
      expect(axum?.evidence).toContain('crates/server/Cargo.toml');
    });

    it('avoids false positive substring detections', () => {
      // Mentioning "flask" in a random string or comment without dependency declaration
      const manifestContents = {
        'requirements.txt': `
# We used to consider flask-helpers, but now we use something else
requests==2.31.0
`,
      };

      const result = analyzeRepositoryData({
        repository: dummyRepoMeta,
        commitSha: 'sha-clean',
        rawTree: [makeBlob('requirements.txt')],
        manifestContents,
      });

      expect(result.techStack.some((t) => t.name === 'Flask')).toBe(false);
    });
  });
});
