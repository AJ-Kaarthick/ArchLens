import os from 'node:os';
import path from 'node:path';

/**
 * Sandbox Execution Policy & Resource Limits
 *
 * NOTE on Security Boundaries:
 * - Isolation, environment sanitization, strict filesystem boundaries, process-group termination,
 *   hard timeouts, bounded output buffers, and a deny-by-default execution policy constitute the primary
 *   security boundaries.
 * - NODE_MAX_OLD_SPACE_SIZE_MB (--max-old-space-size) is an in-process V8 heap safeguard, NOT a kernel-level
 *   cgroup or OS-level memory limit. In a local single-host Node process model without root cgroups, this flag
 *   ensures the V8 runtime triggers Out-Of-Memory termination if the JS heap exceeds this threshold.
 * - All host secrets (GITHUB_TOKEN, GEMINI_API_KEY, DATABASE_URL, host user env) are completely stripped.
 */
export const SANDBOX_LIMITS = {
  /** Maximum number of files permitted in a sandboxed workspace */
  MAX_FILES: 25,
  /** Maximum size in bytes of a single file written to the workspace (500 KB) */
  MAX_FILE_BYTES: 500 * 1024,
  /** Maximum combined total size of all workspace files in bytes (2 MB) */
  MAX_TOTAL_WORKSPACE_BYTES: 2 * 1024 * 1024,
  /** Default execution timeout in milliseconds */
  DEFAULT_TIMEOUT_MS: 5000,
  /** Hard maximum execution timeout in milliseconds */
  MAX_TIMEOUT_MS: 10000,
  /** Minimum execution timeout in milliseconds */
  MIN_TIMEOUT_MS: 500,
  /** Maximum captured stdout/stderr buffer size in bytes (64 KB) */
  MAX_OUTPUT_BYTES: 64 * 1024,
  /** V8 engine heap memory safeguard in megabytes passed to Node child processes */
  NODE_MAX_OLD_SPACE_SIZE_MB: 128,
  /** Time-to-live for ephemeral static web preview workspaces in milliseconds (15 minutes) */
  PREVIEW_TTL_MS: 15 * 60 * 1000,
  /** Maximum command-line arguments permitted */
  MAX_ARGS_COUNT: 10,
  /** Maximum length of a single command-line argument */
  MAX_ARG_LENGTH: 100,
} as const;

/**
 * Base directory under OS temporary storage where isolated workspaces are constructed.
 */
export const BASE_SANDBOX_DIR = path.join(os.tmpdir(), 'archlens-sandboxes');

/**
 * Stripped, safe environment variables provided to child execution processes.
 * Completely isolates the child from host environment variables, ensuring zero host secrets are leaked.
 */
export const SAFE_ENV: Readonly<Record<string, string>> = Object.freeze({
  PATH: '/usr/local/bin:/usr/bin:/bin',
  NODE_ENV: 'production',
  HOME: '/tmp',
  LANG: 'en_US.UTF-8',
});

/**
 * Content Security Policy enforced on live HTML previews.
 * Forbids framing except from self, blocks unsafe connections, and isolates execution.
 */
export const STATIC_PREVIEW_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

/**
 * Validates and clamps requested timeout to bounded policy range.
 */
export function clampTimeout(requestedTimeoutMs?: number): number {
  if (requestedTimeoutMs === undefined || Number.isNaN(requestedTimeoutMs)) {
    return SANDBOX_LIMITS.DEFAULT_TIMEOUT_MS;
  }
  const clamped = Math.floor(requestedTimeoutMs);
  return Math.min(
    Math.max(clamped, SANDBOX_LIMITS.MIN_TIMEOUT_MS),
    SANDBOX_LIMITS.MAX_TIMEOUT_MS
  );
}

/**
 * Verifies that a relative path does not attempt directory traversal and contains no forbidden characters.
 */
export function isPathSafe(relativePath: string): boolean {
  if (!relativePath || typeof relativePath !== 'string') return false;
  if (relativePath.includes('\0')) return false;

  const normalized = path.normalize(relativePath).replace(/\\/g, '/');

  if (
    normalized === '.' ||
    normalized === './' ||
    normalized.startsWith('..') ||
    normalized.includes('/../')
  ) {
    return false;
  }
  if (path.isAbsolute(normalized) || normalized.startsWith('/')) return false;

  return true;
}

/**
 * Validates and cleans command-line arguments.
 */
export function validateArgs(args?: unknown[]): string[] {
  if (!Array.isArray(args)) return [];
  const clean: string[] = [];
  for (const arg of args.slice(0, SANDBOX_LIMITS.MAX_ARGS_COUNT)) {
    if (typeof arg === 'string') {
      clean.push(arg.slice(0, SANDBOX_LIMITS.MAX_ARG_LENGTH));
    }
  }
  return clean;
}

/**
 * Determines whether sandboxed execution is enabled.
 * Default is disabled (safe) in production environments unless ENABLE_SANDBOX=true.
 * In development/test environments, it defaults to enabled unless explicitly set to false/0.
 */
export function isSandboxEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const val = env.ENABLE_SANDBOX?.toLowerCase()?.trim();
  if (val !== undefined) {
    return val === 'true' || val === '1';
  }
  return env.NODE_ENV !== 'production';
}
