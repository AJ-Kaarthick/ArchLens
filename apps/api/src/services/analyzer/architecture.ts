import type {
  ArchitectureOverview,
  LandmarkInfo,
  ReadingGuidanceItem,
  ReadingGuidanceRole,
  ReadingGuidanceEvidenceSource,
} from '@archlens/shared';
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
  const pathsSet = new Set(paths);

  const isExcluded = (candidate: string): boolean => {
    return (
      candidate.includes('/test') ||
      candidate.includes('/__') ||
      candidate.includes('/fixture') ||
      candidate.includes('/mock') ||
      candidate.includes('/dist/') ||
      candidate.includes('/build/') ||
      candidate.endsWith('.test.ts') ||
      candidate.endsWith('.test.js') ||
      candidate.endsWith('.test.tsx') ||
      candidate.endsWith('.spec.ts') ||
      candidate.endsWith('.spec.js') ||
      candidate.endsWith('.spec.tsx') ||
      candidate.endsWith('_test.go') ||
      candidate.endsWith('_test.py')
    );
  };

  const addEntrypoint = (candidate: string) => {
    if (
      pathsSet.has(candidate) &&
      !primaryEntrypoints.includes(candidate) &&
      !isExcluded(candidate)
    ) {
      if (candidate.endsWith('App.tsx') && !isSupportedAppTsx(candidate, pathsSet, manifestContents)) {
        return;
      }
      primaryEntrypoints.push(candidate);
    }
  };

  // 3a. Manifest-declared entrypoints (highest priority author-declared)
  for (const [manifestPath, content] of Object.entries(manifestContents)) {
    if (manifestPath.endsWith('package.json')) {
      const meta = parsePackageJsonMetadata(content, manifestPath, pathsSet);
      if (meta?.declaredEntrypoints) {
        for (const ep of meta.declaredEntrypoints) {
          addEntrypoint(ep.path);
        }
      }
    }
  }

  // 3b. Workspace application entrypoints across all discovered workspaces
  const allWorkspaces = Array.from(new Set([...workspaces, ...nestedManifestDirs]));
  for (const ws of allWorkspaces) {
    if (ws.includes('*')) continue;
    const wsPrefix = ws.endsWith('/') ? ws : `${ws}/`;
    const wsCandidates = [
      `${wsPrefix}src/server.ts`,
      `${wsPrefix}src/main.ts`,
      `${wsPrefix}src/main.tsx`,
      `${wsPrefix}src/App.tsx`,
      `${wsPrefix}src/index.ts`,
      `${wsPrefix}src/index.tsx`,
      `${wsPrefix}src/app.ts`,
      `${wsPrefix}server.ts`,
      `${wsPrefix}main.go`,
      `${wsPrefix}main.py`,
      `${wsPrefix}app.py`,
      `${wsPrefix}src/main.rs`,
      `${wsPrefix}src/lib.rs`,
      `${wsPrefix}index.html`,
    ];
    for (const cand of wsCandidates) {
      addEntrypoint(cand);
    }
  }

  // 3c. Idiomatic language & framework conventions across repository
  const idiomaticCandidates = [
    'src/index.ts',
    'src/main.ts',
    'src/index.js',
    'src/main.tsx',
    'src/App.tsx',
    'src/server.ts',
    'apps/api/src/server.ts',
    'apps/web/src/main.tsx',
    'apps/web/src/App.tsx',
    'lib/index.js',
    'index.js',
    'main.go',
    'cmd/main.go',
    'main.py',
    'app.py',
    'index.html',
    'src/main.rs',
    'src/lib.rs',
  ];

  for (const cand of idiomaticCandidates) {
    addEntrypoint(cand);
  }

  // Dynamic search for Go cmd/<service>/main.go and package-level entrypoints
  for (const p of paths) {
    if (
      /(^|\/)cmd\/[^/]+\/main\.go$/.test(p) ||
      ((p.startsWith('apps/') || p.startsWith('packages/') || p.startsWith('crates/') || p.startsWith('services/')) &&
        (p.endsWith('/index.js') ||
          p.endsWith('/index.ts') ||
          p.endsWith('/main.go') ||
          p.endsWith('/main.rs') ||
          p.endsWith('/lib.rs') ||
          p.endsWith('/app.py') ||
          p.endsWith('/main.py')))
    ) {
      addEntrypoint(p);
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

  // 5. Deterministic "Start Here" Reading Guidance
  const readingGuidance = generateReadingGuidance(
    paths,
    primaryEntrypoints,
    keyLandmarks,
    isMonorepo,
    workspaces,
    manifestContents
  );

  return {
    isMonorepo,
    monorepoTool,
    workspaces,
    detectedPatterns: patterns,
    primaryEntrypoints,
    keyLandmarks,
    readingGuidance,
  };
}

interface ManifestMetadata {
  name?: string;
  version?: string;
  isPrivate?: boolean;
  scripts?: string[];
  dependenciesCount?: number;
  declaredEntrypoints?: Array<{ path: string; source: 'main' | 'module' | 'bin' | 'exports' }>;
  workspaces?: string[];
  raw?: Record<string, unknown>;
}

function parsePackageJsonMetadata(
  content: string,
  manifestPath: string,
  pathsSet: Set<string>
): ManifestMetadata | null {
  try {
    const pkg = JSON.parse(content);
    if (typeof pkg !== 'object' || pkg === null) return null;

    const name = typeof pkg.name === 'string' ? pkg.name : undefined;
    const version = typeof pkg.version === 'string' ? pkg.version : undefined;
    const isPrivate = Boolean(pkg.private);
    const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? Object.keys(pkg.scripts) : [];
    const dependenciesCount =
      pkg.dependencies && typeof pkg.dependencies === 'object'
        ? Object.keys(pkg.dependencies).length
        : 0;

    let workspaces: string[] | undefined;
    if (Array.isArray(pkg.workspaces)) {
      workspaces = pkg.workspaces.filter((w: unknown): w is string => typeof w === 'string');
    } else if (
      pkg.workspaces &&
      typeof pkg.workspaces === 'object' &&
      Array.isArray(pkg.workspaces.packages)
    ) {
      workspaces = pkg.workspaces.packages.filter((w: unknown): w is string => typeof w === 'string');
    }

    const manifestDir = manifestPath.includes('/')
      ? manifestPath.substring(0, manifestPath.lastIndexOf('/'))
      : '';

    const declaredEntrypoints: Array<{ path: string; source: 'main' | 'module' | 'bin' | 'exports' }> = [];

    const resolveCandidate = (cand: unknown, source: 'main' | 'module' | 'bin' | 'exports') => {
      if (typeof cand !== 'string') return;
      const clean = cand.trim().replace(/^\.\//, '');
      if (!clean || clean.includes('*')) return;

      const candidatePath = manifestDir ? `${manifestDir}/${clean}` : clean;
      if (pathsSet.has(candidatePath)) {
        declaredEntrypoints.push({ path: candidatePath, source });
        return;
      }

      // If declared path is in dist/ or build/ and not present in git tree, try source equivalents
      if (clean.startsWith('dist/') || clean.startsWith('build/')) {
        const withoutPrefix = clean.replace(/^(dist|build)\//, '');
        const baseNameWithoutExt = withoutPrefix.replace(/\.[a-zA-Z0-9]+$/, '');
        const sourceCandidates = [
          `src/${withoutPrefix}`,
          `src/${baseNameWithoutExt}.ts`,
          `src/${baseNameWithoutExt}.tsx`,
          `src/${baseNameWithoutExt}.js`,
          `lib/${withoutPrefix}`,
          `lib/${baseNameWithoutExt}.js`,
          `${baseNameWithoutExt}.ts`,
          `${baseNameWithoutExt}.js`,
        ];
        for (const sc of sourceCandidates) {
          const resolvedSrc = manifestDir ? `${manifestDir}/${sc}` : sc;
          if (pathsSet.has(resolvedSrc)) {
            declaredEntrypoints.push({ path: resolvedSrc, source });
            return;
          }
        }
      }
    };

    if (pkg.main) resolveCandidate(pkg.main, 'main');
    if (pkg.module) resolveCandidate(pkg.module, 'module');
    if (typeof pkg.bin === 'string') {
      resolveCandidate(pkg.bin, 'bin');
    } else if (pkg.bin && typeof pkg.bin === 'object') {
      for (const val of Object.values(pkg.bin)) {
        resolveCandidate(val, 'bin');
      }
    }

    if (pkg.exports) {
      const extractExports = (obj: unknown) => {
        if (typeof obj === 'string') {
          resolveCandidate(obj, 'exports');
        } else if (obj && typeof obj === 'object') {
          for (const val of Object.values(obj)) {
            extractExports(val);
          }
        }
      };
      extractExports(pkg.exports);
    }

    return {
      name,
      version,
      isPrivate,
      scripts,
      dependenciesCount,
      declaredEntrypoints,
      workspaces,
      raw: pkg,
    };
  } catch {
    return null;
  }
}

function parseGoModMetadata(content: string): { module?: string; goVersion?: string } {
  const lines = content.split('\n');
  let module: string | undefined;
  let goVersion: string | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('module ')) {
      module = trimmed.substring(7).trim();
    } else if (trimmed.startsWith('go ')) {
      goVersion = trimmed.substring(3).trim();
    }
  }
  return { module, goVersion };
}

function parseCargoTomlMetadata(content: string): { name?: string; isWorkspace?: boolean } {
  const lines = content.split('\n');
  let name: string | undefined;
  const isWorkspace = content.includes('[workspace]');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('name') && trimmed.includes('=')) {
      const match = trimmed.match(/name\s*=\s*["']([^"']+)["']/);
      if (match) name = match[1];
    }
  }
  return { name, isWorkspace };
}

function isSupportedAppTsx(
  filePath: string,
  pathsSet: Set<string>,
  manifestContents: Record<string, string>
): boolean {
  if (!filePath.endsWith('App.tsx')) return false;

  // 1. Located in recognized frontend/client directory structure
  if (
    filePath.startsWith('apps/web/') ||
    filePath.startsWith('apps/client/') ||
    filePath.startsWith('client/') ||
    filePath.startsWith('frontend/')
  ) {
    return true;
  }

  // 2. In root src/App.tsx - verify frontend structure or manifest configuration
  if (filePath === 'src/App.tsx') {
    if (
      pathsSet.has('index.html') ||
      pathsSet.has('src/index.html') ||
      pathsSet.has('public/index.html') ||
      pathsSet.has('src/main.tsx') ||
      pathsSet.has('src/index.tsx')
    ) {
      return true;
    }

    for (const content of Object.values(manifestContents)) {
      if (
        content.includes('"react"') ||
        content.includes('"vue"') ||
        content.includes('"svelte"') ||
        content.includes('"vite"') ||
        content.includes('"next"')
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Deterministically constructs a recommended "Start Here" reading sequence for onboarding into a repository.
 * Operates purely on structural landmarks (README, primary entrypoints, root manifests, configuration, shared packages).
 */
export function generateReadingGuidance(
  paths: string[],
  primaryEntrypoints: string[],
  keyLandmarks: LandmarkInfo[],
  isMonorepo: boolean,
  workspaces: string[],
  manifestContents: Record<string, string> = {}
): ReadingGuidanceItem[] {
  const guidance: ReadingGuidanceItem[] = [];
  const seenPaths = new Set<string>();
  const pathsSet = new Set(paths);

  const addStep = (
    filePath: string,
    role: ReadingGuidanceRole,
    rationale: string,
    evidence?: string,
    evidenceSource?: ReadingGuidanceEvidenceSource
  ) => {
    if (seenPaths.has(filePath) || !pathsSet.has(filePath)) return;
    seenPaths.add(filePath);
    const lastSlash = filePath.lastIndexOf('/');
    const name = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
    guidance.push({
      step: guidance.length + 1,
      path: filePath,
      name,
      role,
      rationale,
      ...(evidence ? { evidence } : {}),
      ...(evidenceSource ? { evidenceSource } : {}),
    });
  };

  // Step 1: High-Level Overview Landmark (README)
  const readmeCandidate = paths.find((p) =>
    /^(readme(\.(md|markdown|rst|txt))?)$/i.test(p)
  );
  if (readmeCandidate) {
    addStep(
      readmeCandidate,
      'overview',
      'Start here for repository intent, high-level features, and architectural context.',
      'Root documentation file providing repository overview and architectural context.',
      'structure'
    );
  }

  // Step 2: Root Manifest / Project & Workspace Layout
  const rootManifestCandidates = [
    'pnpm-workspace.yaml',
    'package.json',
    'Cargo.toml',
    'go.mod',
    'pyproject.toml',
    'requirements.txt',
    'pom.xml',
    'build.gradle',
  ];
  for (const candidate of rootManifestCandidates) {
    if (pathsSet.has(candidate)) {
      if (candidate === 'pnpm-workspace.yaml') {
        const declared = workspaces.length > 0 ? workspaces.join(', ') : 'declared packages';
        addStep(
          candidate,
          'root-manifest',
          'Defines repository workspace topology, dependency boundaries, and package links.',
          `pnpm-workspace.yaml declares workspaces: ${declared}`,
          'manifest'
        );
      } else if (candidate === 'package.json') {
        const meta = parsePackageJsonMetadata(manifestContents['package.json'] || '', candidate, pathsSet);
        if (meta?.workspaces && meta.workspaces.length > 0) {
          addStep(
            candidate,
            'root-manifest',
            'Defines repository workspace topology, dependency boundaries, and package links.',
            `package.json declares workspaces: ${meta.workspaces.join(', ')} (${meta.name || 'root'})`,
            'manifest'
          );
        } else {
          const scriptsStr =
            meta?.scripts && meta.scripts.length > 0
              ? ` and scripts: ${meta.scripts.slice(0, 4).join(', ')}`
              : '';
          const depsStr =
            meta?.dependenciesCount !== undefined
              ? ` declares ${meta.dependenciesCount} dependencies`
              : '';
          const nameStr = meta?.name ? ` (${meta.name})` : '';
          addStep(
            candidate,
            'root-manifest',
            'Root package manifest declaring dependencies, build scripts, and engine constraints.',
            `package.json${nameStr}${depsStr}${scriptsStr}`,
            'manifest'
          );
        }
      } else if (candidate === 'go.mod') {
        const meta = parseGoModMetadata(manifestContents['go.mod'] || '');
        const modStr = meta.module ? `module ${meta.module}` : 'Go module';
        const verStr = meta.goVersion ? ` (go ${meta.goVersion})` : '';
        addStep(
          candidate,
          'root-manifest',
          'Root package manifest declaring dependencies, build scripts, and engine constraints.',
          `go.mod declares ${modStr}${verStr}`,
          'manifest'
        );
      } else if (candidate === 'Cargo.toml') {
        const meta = parseCargoTomlMetadata(manifestContents['Cargo.toml'] || '');
        const nameStr = meta.name ? `package ${meta.name}` : 'Rust crate';
        const wsStr = meta.isWorkspace ? ' with workspace members' : '';
        addStep(
          candidate,
          'root-manifest',
          isMonorepo
            ? 'Defines repository workspace topology, dependency boundaries, and package links.'
            : 'Root package manifest declaring dependencies, build scripts, and engine constraints.',
          `Cargo.toml declares ${nameStr}${wsStr}`,
          'manifest'
        );
      } else {
        addStep(
          candidate,
          'root-manifest',
          'Root package manifest declaring dependencies, build scripts, and engine constraints.',
          `${candidate} defines project dependencies and build targets.`,
          'manifest'
        );
      }
      break;
    }
  }

  // Step 3 & 4: Primary Runtime Entrypoints
  // Sort entrypoints: server/api first, then client/web/app, then library/cli
  const sortedEntrypoints = [...primaryEntrypoints].sort((a, b) => {
    const isServerA = /(server|main\.go|app\.py|main\.rs)/i.test(a);
    const isServerB = /(server|main\.go|app\.py|main\.rs)/i.test(b);
    if (isServerA && !isServerB) return -1;
    if (!isServerA && isServerB) return 1;
    const isClientA = /(main\.tsx|app\.tsx|index\.html)/i.test(a);
    const isClientB = /(main\.tsx|app\.tsx|index\.html)/i.test(b);
    if (isClientA && !isClientB) return -1;
    if (!isClientA && isClientB) return 1;
    return a.localeCompare(b);
  });

  let entrypointCount = 0;
  for (const entry of sortedEntrypoints) {
    if (entrypointCount >= 2) break;
    if (seenPaths.has(entry)) continue;

    let rationale = 'Execution kickoff point bootstrapping runtime services and routes.';
    let evidence = `Identified runtime entrypoint in repository tree (${entry}).`;
    let evidenceSource: ReadingGuidanceEvidenceSource = 'structure';

    // Check if declared in any package.json
    for (const [mPath, content] of Object.entries(manifestContents)) {
      if (mPath.endsWith('package.json')) {
        const meta = parsePackageJsonMetadata(content, mPath, pathsSet);
        const match = meta?.declaredEntrypoints?.find((d) => d.path === entry);
        if (match) {
          evidence = `Declared as package ${match.source} in ${mPath}`;
          evidenceSource = 'manifest';
          break;
        }
      }
    }

    if (/(cmd\/[^/]+\/main\.go|main\.go)/i.test(entry)) {
      rationale = 'Backend service bootstrapper initializing HTTP routes and dependencies.';
      if (evidenceSource !== 'manifest') {
        evidence = `Canonical Go application entrypoint convention (${entry})`;
        evidenceSource = 'convention';
      }
    } else if (/(web|client|main\.tsx|app\.tsx|index\.html)/i.test(entry)) {
      rationale = 'Frontend client bootstrapper mounting DOM components and view state.';
      if (evidenceSource !== 'manifest') {
        evidence = `Frontend application entrypoint in ${entry}`;
      }
    } else if (/(server|api)/i.test(entry)) {
      rationale = 'Backend service bootstrapper initializing HTTP routes and dependencies.';
      if (evidenceSource !== 'manifest') {
        evidence = `Backend service bootstrapper in ${entry}`;
      }
    } else if (/(lib\.rs)/i.test(entry)) {
      rationale = 'Core module entrypoint exposing public interfaces and exports.';
      if (evidenceSource !== 'manifest') {
        evidence = `Rust crate library root exposing public interfaces (${entry})`;
        evidenceSource = 'convention';
      }
    } else if (/(index\.ts|index\.js)/i.test(entry)) {
      rationale = 'Core module entrypoint exposing public interfaces and exports.';
    }

    addStep(entry, 'entrypoint', rationale, evidence, evidenceSource);
    entrypointCount++;
  }

  // Step 5: Shared Core Contracts or Key Workspace Package
  if (isMonorepo) {
    const sharedPackageCandidates = [
      'packages/shared/src/index.ts',
      'packages/shared/package.json',
      'packages/core/src/index.ts',
      'packages/core/package.json',
      'packages/common/src/index.ts',
      'packages/common/package.json',
    ];
    let addedShared = false;
    for (const sharedCand of sharedPackageCandidates) {
      if (pathsSet.has(sharedCand) && !seenPaths.has(sharedCand)) {
        const pkgDir = sharedCand.substring(0, sharedCand.lastIndexOf('/'));
        let referencingApp: string | null = null;
        for (const [mPath, content] of Object.entries(manifestContents)) {
          if (mPath.endsWith('package.json') && !mPath.startsWith(pkgDir)) {
            if (content.includes('shared') || content.includes('@archlens/shared') || content.includes('workspace:')) {
              referencingApp = mPath.replace('/package.json', '');
              break;
            }
          }
        }

        const evidenceStr = referencingApp
          ? `Workspace package referenced as dependency by ${referencingApp}`
          : `Discovered workspace library package in ${pkgDir}`;
        const source: ReadingGuidanceEvidenceSource = referencingApp ? 'manifest' : 'structure';

        addStep(
          sharedCand,
          'key-package',
          'Domain contracts and shared models consumed across the monorepo.',
          evidenceStr,
          source
        );
        addedShared = true;
        break;
      }
    }

    if (!addedShared) {
      const keyPkgLandmark = keyLandmarks.find(
        (lm) =>
          !seenPaths.has(lm.path) &&
          (lm.path.startsWith('packages/') ||
            lm.path.startsWith('crates/') ||
            lm.path.startsWith('services/'))
      );
      if (keyPkgLandmark) {
        addStep(
          keyPkgLandmark.path,
          'key-package',
          keyPkgLandmark.description ||
            'Core library package providing foundational domain functionality.',
          `Discovered workspace package landmark at ${keyPkgLandmark.path}`,
          'structure'
        );
      }
    }
  } else {
    const dataLandmark = keyLandmarks.find(
      (lm) =>
        !seenPaths.has(lm.path) &&
        (lm.path.includes('schema') ||
          lm.path.includes('db/') ||
          lm.path.includes('models/'))
    );
    if (dataLandmark) {
      addStep(
        dataLandmark.path,
        'configuration',
        'Persistence schema and database models establishing the domain entity structures.',
        `Database persistence schema defining relational data structures (${dataLandmark.name})`,
        'structure'
      );
    }
  }

  // Step 6: Core Configuration or Infrastructure Definition (Docker / tsconfig)
  const configCandidates = [
    'docker-compose.yml',
    'docker-compose.yaml',
    'Dockerfile',
    'apps/api/Dockerfile',
    'apps/web/Dockerfile',
    'tsconfig.json',
    'vite.config.ts',
  ];
  for (const config of configCandidates) {
    if (pathsSet.has(config) && !seenPaths.has(config)) {
      const isDocker = config.includes('docker') || config.includes('Dockerfile');
      addStep(
        config,
        'configuration',
        isDocker
          ? 'Defines containerized environment constraints and service orchestration.'
          : 'Central toolchain configuration establishing compiler rules and resolution boundaries.',
        isDocker
          ? `Container orchestration specification defining runtime services (${config})`
          : `Central compiler and resolution configuration (${config})`,
        'structure'
      );
      break;
    }
  }

  return guidance;
}
