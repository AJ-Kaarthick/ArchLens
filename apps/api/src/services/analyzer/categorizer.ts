import type { FileCategory, FileTreeItem, LandmarkInfo } from '@archlens/shared';
import type { RawGitTreeItem } from '../github.service.js';

const TEST_PATTERNS = [
  /\.(test|spec)\.[a-zA-Z0-9]+$/,
  /(^|\/)__tests__\//,
  /(^|\/)test(s)?\//,
  /_test\.go$/,
  /test_[a-zA-Z0-9_]+\.py$/,
  /[a-zA-Z0-9_]+_test\.py$/,
];

const CI_PATTERNS = [
  /(^|\/)\.github\/workflows\//,
  /(^|\/)\.gitlab-ci\.ya?ml$/,
  /(^|\/)\.circleci\//,
  /(^|\/)Jenkinsfile/,
  /(^|\/)azure-pipelines\.ya?ml$/,
  /(^|\/)\.travis\.ya?ml$/,
];

const DOC_PATTERNS = [
  /\.(md|markdown|rst|adoc|txt)$/i,
  /(^|\/)docs?\//i,
  /(^|\/)(LICENSE|LICENCE|COPYING|NOTICE)(\.[a-zA-Z0-9]+)?$/i,
  /(^|\/)(CONTRIBUTING|CHANGELOG|HISTORY|AUTHORS|SECURITY|CODE_OF_CONDUCT)(\.[a-zA-Z0-9]+)?$/i,
];

const CONFIG_PATTERNS = [
  /(^|\/)\.[a-zA-Z0-9._-]+rc(\.[a-zA-Z0-9]+)?$/,
  /(^|\/)[a-zA-Z0-9._-]+\.config\.[a-zA-Z0-9]+$/,
  /(^|\/)(tsconfig|jsconfig)(\.[a-zA-Z0-9]+)?\.json$/,
  /(^|\/)(\.env|\.env\.[a-zA-Z0-9._-]+)$/,
  /(^|\/)(Dockerfile|docker-compose(\.[a-zA-Z0-9]+)?\.ya?ml)$/i,
  /(^|\/)(Makefile|CMakeLists\.txt|Rakefile|Vagrantfile)$/i,
  /\.(ya?ml|toml|ini|env|editorconfig)$/i,
  /(^|\/)pnpm-workspace\.ya?ml$/,
];

const MANIFEST_NAMES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'cargo.toml',
  'cargo.lock',
  'go.mod',
  'go.sum',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'pipfile',
  'pipfile.lock',
  'gemfile',
  'gemfile.lock',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'mix.exs',
]);

const ASSET_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'ico',
  'webp',
  'avif',
  'bmp',
  'tiff',
  'ttf',
  'woff',
  'woff2',
  'eot',
  'otf',
  'mp3',
  'wav',
  'ogg',
  'mp4',
  'webm',
  'pdf',
  'zip',
  'tar',
  'gz',
]);

const SOURCE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'go',
  'rs',
  'java',
  'kt',
  'scala',
  'c',
  'cpp',
  'h',
  'hpp',
  'cc',
  'cs',
  'rb',
  'php',
  'swift',
  'dart',
  'sh',
  'bash',
  'html',
  'css',
  'scss',
  'sass',
  'less',
  'vue',
  'svelte',
  'sql',
  'graphql',
  'proto',
  'lua',
  'r',
  'zig',
]);

export function categorizePath(path: string): FileCategory {
  const normalized = path.replace(/\\/g, '/');

  // Check CI first
  if (CI_PATTERNS.some((p) => p.test(normalized))) {
    return 'ci';
  }

  // Check Tests
  if (TEST_PATTERNS.some((p) => p.test(normalized))) {
    return 'test';
  }

  // Check Docs
  if (DOC_PATTERNS.some((p) => p.test(normalized))) {
    return 'doc';
  }

  // Check Config
  if (CONFIG_PATTERNS.some((p) => p.test(normalized))) {
    return 'config';
  }

  const parts = normalized.split('/');
  const fileName = parts[parts.length - 1].toLowerCase();

  if (MANIFEST_NAMES.has(fileName)) {
    return 'config';
  }

  const ext = fileName.includes('.') ? fileName.split('.').pop() || '' : '';
  if (ASSET_EXTENSIONS.has(ext)) {
    return 'asset';
  }

  if (SOURCE_EXTENSIONS.has(ext)) {
    return 'source';
  }

  if (fileName.startsWith('.') || ext === 'json' || ext === 'lock') {
    return 'config';
  }

  return 'other';
}

export function detectLandmark(path: string): LandmarkInfo | null {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const fileName = parts[parts.length - 1];
  const lowerName = fileName.toLowerCase();

  // Root or primary README
  if (/^readme(\.[a-zA-Z0-9]+)?$/i.test(fileName)) {
    return {
      path: normalized,
      name: fileName,
      type: 'doc',
      description: 'Primary repository documentation',
    };
  }

  // Root LICENSE
  if (/^license(\.[a-zA-Z0-9]+)?$/i.test(fileName) && parts.length <= 2) {
    return {
      path: normalized,
      name: fileName,
      type: 'doc',
      description: 'Project license and terms',
    };
  }

  // Root Manifests
  if (MANIFEST_NAMES.has(lowerName)) {
    return {
      path: normalized,
      name: fileName,
      type: 'manifest',
      description: `Project manifest (${fileName})`,
    };
  }

  // Monorepo config or Docker
  if (
    lowerName === 'pnpm-workspace.yaml' ||
    lowerName === 'turbo.json' ||
    lowerName === 'lerna.json' ||
    lowerName === 'nx.json' ||
    lowerName === 'dockerfile' ||
    lowerName === 'docker-compose.yml' ||
    lowerName === 'docker-compose.yaml'
  ) {
    return {
      path: normalized,
      name: fileName,
      type: 'config',
      description: `Core infrastructure / workspace configuration (${fileName})`,
    };
  }

  // Key Entrypoints
  if (
    parts.length <= 4 &&
    (fileName === 'main.ts' ||
      fileName === 'index.ts' ||
      fileName === 'main.tsx' ||
      fileName === 'App.tsx' ||
      fileName === 'server.ts' ||
      fileName === 'main.go' ||
      fileName === 'main.py' ||
      fileName === 'app.py' ||
      fileName === 'index.js')
  ) {
    return {
      path: normalized,
      name: fileName,
      type: 'entry',
      description: `Primary application entrypoint (${fileName})`,
    };
  }

  return null;
}

export function buildFileTreeItems(rawItems: RawGitTreeItem[]): FileTreeItem[] {
  return rawItems.map((item) => {
    const isDir = item.type === 'tree';
    const parts = item.path.split('/');
    const name = parts[parts.length - 1];
    const extension = !isDir && name.includes('.') ? `.${name.split('.').pop()}` : '';
    const category = isDir ? 'other' : categorizePath(item.path);
    const landmark = !isDir ? detectLandmark(item.path) : null;

    return {
      path: item.path,
      name,
      type: isDir ? 'dir' : 'file',
      size: item.size ?? 0,
      extension,
      category,
      isLandmark: Boolean(landmark),
    };
  });
}
