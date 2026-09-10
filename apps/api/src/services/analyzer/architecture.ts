import type { ArchitectureOverview, LandmarkInfo } from '@archlens/shared';
import type { RawGitTreeItem } from '../github.service.js';
import { detectLandmark } from './categorizer.js';

export function detectArchitecture(
  tree: RawGitTreeItem[],
  manifestContents: Record<string, string> = {}
): ArchitectureOverview {
  const paths = tree.map((t) => t.path);
  const patterns: string[] = [];
  const workspaces: string[] = [];
  let isMonorepo = false;
  let monorepoTool: string | null = null;

  // 1. Monorepo Detection
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
          const match = line.match(/-\s*["']?([^"']+)["']?/);
          if (match) workspaces.push(match[1].trim());
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
          workspaces.push(...pkg.workspaces);
        } else if (Array.isArray(pkg.workspaces.packages)) {
          workspaces.push(...pkg.workspaces.packages);
        }
      }
    } catch {
      // ignore parse error
    }
  }

  // Fallback workspace detection if directory layout is apps/* or packages/*
  if (isMonorepo && workspaces.length === 0) {
    if (paths.some((p) => p.startsWith('apps/'))) workspaces.push('apps/*');
    if (paths.some((p) => p.startsWith('packages/'))) workspaces.push('packages/*');
  }

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

  // 3. Primary Entrypoints
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
    'main.go',
    'main.py',
    'app.py',
    'index.html',
  ];

  for (const candidate of entryCandidates) {
    if (paths.includes(candidate)) {
      primaryEntrypoints.push(candidate);
    }
  }

  // If none matched candidates, look for entry landmarks in the tree
  if (primaryEntrypoints.length === 0) {
    for (const p of paths) {
      const lm = detectLandmark(p);
      if (lm && lm.type === 'entry') {
        primaryEntrypoints.push(p);
        if (primaryEntrypoints.length >= 5) break;
      }
    }
  }

  // 4. Key Landmarks
  const keyLandmarks: LandmarkInfo[] = [];
  const seenLandmarks = new Set<string>();

  for (const item of tree) {
    if (item.type === 'blob') {
      const lm = detectLandmark(item.path);
      if (lm && !seenLandmarks.has(lm.path)) {
        seenLandmarks.add(lm.path);
        keyLandmarks.push(lm);
      }
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
