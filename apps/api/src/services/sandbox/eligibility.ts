import type { AnalysisResult } from '@archlens/shared';
import type { ExecutionEligibility, ExecutionProfile } from './types.js';
import { SANDBOX_LIMITS } from './policy.js';

const UNSUPPORTED_ECOSYSTEMS = new Set([
  'python',
  'go',
  'golang',
  'rust',
  'java',
  'kotlin',
  'scala',
  'c',
  'cpp',
  'c++',
  'c#',
  'dotnet',
  'ruby',
  'php',
  'swift',
  'dart',
  'elixir',
  'erlang',
  'haskell',
]);

const NODE_ENTRYPOINT_NAMES = [
  'index.js',
  'index.mjs',
  'main.js',
  'main.mjs',
  'cli.js',
  'app.js',
  'src/index.js',
  'src/main.js',
  'bin/index.js',
  'dist/index.js',
];

const STATIC_WEB_ENTRYPOINT_NAMES = [
  'index.html',
  'public/index.html',
  'dist/index.html',
];

export function detectExecutionEligibility(analysis: AnalysisResult): ExecutionEligibility {
  const warnings: string[] = [];
  const detectedEntrypoints: string[] = [];
  const supportedProfiles: ExecutionProfile[] = [];

  // 1. Gather all repository file paths from the analysis tree
  const filePaths = new Set<string>();
  for (const item of analysis.tree) {
    if (item.type === 'file') {
      filePaths.add(item.path);
    }
  }

  // 2. Check for static-web entrypoints
  for (const name of STATIC_WEB_ENTRYPOINT_NAMES) {
    if (filePaths.has(name)) {
      detectedEntrypoints.push(name);
      if (!supportedProfiles.includes('static-web')) {
        supportedProfiles.push('static-web');
      }
    }
  }

  // Also check if any root/top-level html file exists
  for (const path of filePaths) {
    if (path.endsWith('.html') && !detectedEntrypoints.includes(path) && !path.includes('/')) {
      detectedEntrypoints.push(path);
      if (!supportedProfiles.includes('static-web')) {
        supportedProfiles.push('static-web');
      }
    }
  }

  // 3. Check for node-script entrypoints
  for (const name of NODE_ENTRYPOINT_NAMES) {
    if (filePaths.has(name)) {
      detectedEntrypoints.push(name);
      if (!supportedProfiles.includes('node-script')) {
        supportedProfiles.push('node-script');
      }
    }
  }

  // Also check entrypoints detected during architecture analysis
  if (analysis.architecture?.primaryEntrypoints) {
    for (const p of analysis.architecture.primaryEntrypoints) {
      if (filePaths.has(p) && (p.endsWith('.js') || p.endsWith('.mjs'))) {
        if (!detectedEntrypoints.includes(p)) {
          detectedEntrypoints.push(p);
        }
        if (!supportedProfiles.includes('node-script')) {
          supportedProfiles.push('node-script');
        }
      }
    }
  }

  // 4. Inspect tech stack for unsupported runtimes if no supported profiles were found
  const primaryLang = (analysis.repository.primaryLanguage || '').toLowerCase();
  const unsupportedDetected = analysis.techStack.find((tech) =>
    UNSUPPORTED_ECOSYSTEMS.has(tech.name.toLowerCase())
  );

  if (supportedProfiles.length === 0) {
    if (UNSUPPORTED_ECOSYSTEMS.has(primaryLang) || unsupportedDetected) {
      const runtimeName = unsupportedDetected ? unsupportedDetected.name : analysis.repository.primaryLanguage;
      return {
        eligible: false,
        recommendedProfile: null,
        detectedEntrypoints: [],
        supportedProfiles: [],
        refusalReason: 'unsupported_runtime',
        reasonMessage: `Repository is identified as a ${runtimeName} project. ArchLens Phase 6 sandbox currently supports Node.js scripts (node-script) and static web previews (static-web).`,
        warnings,
      };
    }

    return {
      eligible: false,
      recommendedProfile: null,
      detectedEntrypoints: [],
      supportedProfiles: [],
      refusalReason: 'missing_entrypoint',
      reasonMessage:
        'No executable entrypoints (such as index.js, cli.js, or index.html) were detected in the repository.',
      warnings,
    };
  }

  // 5. Determine recommended profile
  let recommendedProfile: ExecutionProfile = supportedProfiles[0];
  if (supportedProfiles.includes('static-web') && (primaryLang === 'html' || filePaths.has('index.html'))) {
    recommendedProfile = 'static-web';
  } else if (supportedProfiles.includes('node-script')) {
    recommendedProfile = 'node-script';
  }

  if (analysis.metrics.totalFiles > SANDBOX_LIMITS.MAX_FILES) {
    warnings.push(
      `Repository has ${analysis.metrics.totalFiles} files. Sandboxed execution workspace is strictly bounded to the primary entrypoint snapshot.`
    );
  }

  return {
    eligible: true,
    recommendedProfile,
    detectedEntrypoints,
    supportedProfiles,
    warnings,
  };
}
