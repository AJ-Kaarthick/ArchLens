import type { ArchitectureOverview, LandmarkInfo } from '@archlens/shared';
import type { RawGitTreeItem } from '../github.service.js';
import { detectLandmark } from './categorizer.js';

export function detectArchitecture(
  tree: RawGitTreeItem[],
  manifestContents: Record<string, string> = {}
): ArchitectureOverview {
  const paths = tree.map((t) => t.path);
  const patterns: string[] = [];
  const workspacesSet = new Set<string>();
  let isMonorepo = false;
  let monorepoTool: string | null = null;

  // 1. Monorepo & Workspace Manifest Detection
  if (paths.some((p) => p === 'pnpm-workspace.yaml')) {
    isMonorepo = true;
    monorepoTool = 'pnpm workspaces';
    const content = manifestContents['pnpm-workspace.yaml'] || '';
    const lines = content.split('\n');
    let inPackages = false;
    for (const line of lines) {
      if (line.trim().startsWith('packages:')) {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        if (line.trim().startsWith('-')) {
          const match = line.match(/-\s*["']?([^"'\s]+)["']?/);
          if (match) workspacesSet.add(match[1].trim());
        } else if (line.trim().length > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
          break;
        }
      }
    }
  } else if (paths.some((p) => p === 'turbo.json')) {
    isMonorepo = true;
    monorepoTool = 'Turborepo';
  } else if (paths.some((p) => p === 'nx.json')) {
    isMonorepo = true;
    monorepoTool = 'Nx';
  } else if (paths.some((p) => p === 'lerna.json')) {
    isMonorepo = true;
    monorepoTool = 'Lerna';
  } else if (paths.some((p) => p === 'rush.json')) {
    isMonorepo = true;
    monorepoTool = 'Rush';
  } else if (manifestContents['package.json']) {
    try {
      const pkg = JSON.parse(manifestContents['package.json']);
      if (pkg.workspaces) {
        isMonorepo = true;
        monorepoTool = 'npm/yarn workspaces';
        if (Array.isArray(pkg.workspaces)) {
          pkg.workspaces.forEach((w: string) => workspacesSet.add(w));
        } else if (Array.isArray(pkg.workspaces.packages)) {
          pkg.workspaces.packages.forEach((w: string) => workspacesSet.add(w));
        }
      }
    } catch {
      // ignore JSON parse error
    }
  }

  // Check for Cargo workspace
  if (manifestContents['Cargo.toml'] && manifestContents['Cargo.toml'].includes('[workspace]')) {
    isMonorepo = true;
    if (!monorepoTool) monorepoTool = 'Cargo workspace';
    const cargoLines = manifestContents['Cargo.toml'].split('\n');
    let inMembers = false;
    for (const line of cargoLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('members') && trimmed.includes('=')) {
        inMembers = true;
      }
      if (inMembers) {
        const matches = trimmed.matchAll(/["']([^"']+)["']/g);
        for (const match of matches) {
          workspacesSet.add(match[1]);
        }
        if (trimmed.includes(']')) {
          inMembers = false;
        }
      }
    }
  }

  // Check for Go workspaces (go.work)
  if (paths.some((p) => p === 'go.work')) {
    isMonorepo = true;
    if (!monorepoTool) monorepoTool = 'Go workspaces';
    const workContent = manifestContents['go.work'] || '';
    const workLines = workContent.split('\n');
    let inUse = false;
    for (const line of workLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('use (')) {
        inUse = true;
        continue;
      }
      if (inUse) {
        if (trimmed.startsWith(')')) {
          inUse = false;
          continue;
        }
        if (trimmed && !trimmed.startsWith('//')) {
          workspacesSet.add(trimmed.replace(/^.\//, ''));
        }
      }
    }
  }

  // Workspace package discovery from nested manifests
  const nestedManifestDirs = new Set<string>();
  for (const filePath of Object.keys(manifestContents)) {
    if (filePath.includes('/')) {
      const lastSlash = filePath.lastIndexOf('/');
      const dir = filePath.substring(0, lastSlash);
      if (
        dir &&
        !dir.startsWith('node_modules') &&
        !dir.startsWith('vendor') &&
        !dir.startsWith('dist')
      ) {
        nestedManifestDirs.add(dir);
      }
    }
  }

  // If >= 2 distinct subdirectories contain package manifests, it is a monorepo
  if (nestedManifestDirs.size >= 2) {
    isMonorepo = true;
    if (!monorepoTool) {
      monorepoTool = 'Multi-package repository';
    }
  }

  // Populate workspace paths from actual discovered package directories and declared globs
  if (isMonorepo) {
    for (const dir of nestedManifestDirs) {
      workspacesSet.add(dir);
    }
    if (workspacesSet.size === 0) {
      if (paths.some((p) => p.startsWith('apps/'))) workspacesSet.add('apps/*');
      if (paths.some((p) => p.startsWith('packages/'))) workspacesSet.add('packages/*');
      if (paths.some((p) => p.startsWith('crates/'))) workspacesSet.add('crates/*');
      if (paths.some((p) => p.startsWith('services/'))) workspacesSet.add('services/*');
    }
  }

  const workspaces = Array.from(workspacesSet).sort();

  // 2. Pattern Detections
  if (isMonorepo) {
    patterns.push('Monorepo Architecture');
  }

  const hasFrontend = paths.some(
    (p) =>
      p.startsWith('apps/web') ||
      p.startsWith('apps/client') ||
      p.startsWith('client/') ||
      p.startsWith('frontend/') ||
      p.includes('src/App.') ||
      p.includes('index.html')
  );

  const hasBackend = paths.some(
    (p) =>
      p.startsWith('apps/api') ||
      p.startsWith('apps/server') ||
      p.startsWith('server/') ||
      p.startsWith('backend/') ||
      p.includes('server.ts') ||
      p.includes('app.py') ||
      p.includes('main.go')
  );

  if (hasFrontend && hasBackend) {
    patterns.push('Client-Server Separation');
  }

  if (
    paths.some((p) => /(^|\/)services\//i.test(p)) &&
    (paths.some((p) => /(^|\/)routes\//i.test(p)) ||
      paths.some((p) => /(^|\/)controllers\//i.test(p)))
  ) {
    patterns.push('Layered / Service Architecture');
  }

  if (paths.some((p) => /(^|\/)components\//i.test(p))) {
    patterns.push('Component-Driven UI');
  }

  if (
    paths.some((p) => /(^|\/)db\//i.test(p)) ||
    paths.some((p) => /(^|\/)migrations\//i.test(p)) ||
    paths.some((p) => /(^|\/)schema\.[a-zA-Z0-9]+$/i.test(p))
  ) {
    patterns.push('Database Persistence Layer');
  }

  if (
    paths.some(
      (p) =>
        /(^|\/)Dockerfile$/i.test(p) || /(^|\/)docker-compose(\.[a-zA-Z0-9]+)?\.ya?ml$/i.test(p)
    )
  ) {
    patterns.push('Containerized');
  }

  if (paths.some((p) => p.startsWith('.github/workflows/'))) {
    patterns.push('Automated CI/CD');
  }

  // 3. Primary Entrypoints Discovery
  const primaryEntrypoints: string[] = [];
  const entryCandidates = [
    'src/index.ts',
    'src/main.ts',
    'src/index.js',
    'src/main.tsx',
    'src/App.tsx',
    'src/server.ts',
    'apps/api/src/server.ts',
    'apps/web/src/main.tsx',
    'apps/web/src/App.tsx',
    'packages/shared/src/index.ts',
    'main.go',
    'cmd/main.go',
    'main.py',
    'app.py',
    'index.html',
    'src/main.rs',
    'src/lib.rs',
  ];

  for (const candidate of entryCandidates) {
    if (paths.includes(candidate) && !primaryEntrypoints.includes(candidate)) {
      primaryEntrypoints.push(candidate);
    }
  }

  // Search for package-level entrypoints in monorepos
  for (const p of paths) {
    if (
      (p.startsWith('packages/') || p.startsWith('crates/') || p.startsWith('services/')) &&
      (p.endsWith('/index.js') ||
        p.endsWith('/index.ts') ||
        p.endsWith('/main.go') ||
        p.endsWith('/main.rs') ||
        p.endsWith('/lib.rs') ||
        p.endsWith('/app.py') ||
        p.endsWith('/main.py')) &&
      !p.includes('/test') &&
      !p.includes('/fixture') &&
      !p.includes('/__')
    ) {
      if (!primaryEntrypoints.includes(p)) {
        primaryEntrypoints.push(p);
      }
    }
  }

  // 4. Key Landmarks Discovery
  const keyLandmarks: LandmarkInfo[] = [];
  for (const p of paths) {
    const landmark = detectLandmark(p);
    if (landmark) {
      keyLandmarks.push(landmark);
    }
  }

  return {
    isMonorepo,
    monorepoTool,
    workspaces,
    detectedPatterns: patterns,
    primaryEntrypoints,
    keyLandmarks,
  };
}
