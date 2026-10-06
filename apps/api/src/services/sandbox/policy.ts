import os from 'node:os';
import path from 'node:path';

/**
 * Sandbox Execution Policy & Resource Limits
 *
 * SECURITY WARNING & ARCHITECTURAL LIMITATIONS:
 * - This execution subsystem uses a host-process Node.js runner executing under the API process's OS user.
 * - It is NOT a kernel-isolated container, Linux cgroup/namespace, or microVM sandbox.
 * - It CANNOT safely contain malicious, hostile, or adversarial code.
 * - For production deployments and default product workflows, execution and preview routes MUST
 *   remain disabled.
 * - An unsafe development mode is available solely for local testing via ENABLE_UNSAFE_DEV_SANDBOX=yes.
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
 * Determines whether unsafe development sandbox execution is enabled.
 * Default is STRICTLY DISABLED across all environments (production, development, test).
 * To enable in local development, caller must explicitly set ENABLE_UNSAFE_DEV_SANDBOX=yes (or true/1).
 *
 * SECURITY NOTE:
 * The execution subsystem runs Node.js as the host API user and is NOT kernel-isolated.
 * It is unsafe for hostile or untrusted code and must remain gated from the normal product path.
 */
export function isUnsafeDevSandboxEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const explicitOptIn = env.ENABLE_UNSAFE_DEV_SANDBOX?.toLowerCase()?.trim();
  if (explicitOptIn !== undefined) {
    return explicitOptIn === 'true' || explicitOptIn === 'yes' || explicitOptIn === '1';
  }
  const legacyVal = env.ENABLE_SANDBOX?.toLowerCase()?.trim();
  if (legacyVal !== undefined) {
    return legacyVal === 'true' || legacyVal === 'yes' || legacyVal === '1';
  }
  return false;
}

export const isSandboxEnabled = isUnsafeDevSandboxEnabled;
