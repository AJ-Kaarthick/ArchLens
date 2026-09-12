import { describe, it, expect } from 'vitest';
import {
  clampTimeout,
  isPathSafe,
  validateArgs,
  SANDBOX_LIMITS,
  SAFE_ENV,
} from './policy.js';

describe('Sandbox Policy & Limit Enforcement', () => {
  describe('clampTimeout', () => {
    it('uses default timeout when undefined or NaN', () => {
      expect(clampTimeout(undefined)).toBe(SANDBOX_LIMITS.DEFAULT_TIMEOUT_MS);
      expect(clampTimeout(NaN)).toBe(SANDBOX_LIMITS.DEFAULT_TIMEOUT_MS);
    });

    it('enforces MIN_TIMEOUT_MS (500ms)', () => {
      expect(clampTimeout(100)).toBe(500);
      expect(clampTimeout(-50)).toBe(500);
    });

    it('enforces MAX_TIMEOUT_MS (10000ms)', () => {
      expect(clampTimeout(15000)).toBe(10000);
      expect(clampTimeout(60000)).toBe(10000);
    });

    it('accepts valid timeouts within range', () => {
      expect(clampTimeout(3000)).toBe(3000);
      expect(clampTimeout(7500)).toBe(7500);
    });
  });

  describe('isPathSafe', () => {
    it('accepts safe relative paths', () => {
      expect(isPathSafe('index.js')).toBe(true);
      expect(isPathSafe('src/main.js')).toBe(true);
      expect(isPathSafe('public/assets/style.css')).toBe(true);
      expect(isPathSafe('nested/dir/file.txt')).toBe(true);
    });

    it('rejects directory traversal attempts', () => {
      expect(isPathSafe('../etc/passwd')).toBe(false);
      expect(isPathSafe('../../secret.env')).toBe(false);
      expect(isPathSafe('foo/../../bar')).toBe(false);
      expect(isPathSafe('src/../..')).toBe(false);
    });

    it('rejects absolute paths', () => {
      expect(isPathSafe('/etc/passwd')).toBe(false);
      expect(isPathSafe('/root')).toBe(false);
    });

    it('rejects paths with null bytes or empty strings', () => {
      expect(isPathSafe('')).toBe(false);
      expect(isPathSafe('.')).toBe(false);
      expect(isPathSafe('./')).toBe(false);
      expect(isPathSafe('index.js\0.png')).toBe(false);
    });
  });

  describe('validateArgs', () => {
    it('bounds arg count and arg string length', () => {
      const longArg = 'a'.repeat(200);
      const args = Array.from({ length: 20 }, () => longArg);
      const cleaned = validateArgs(args);

      expect(cleaned.length).toBe(SANDBOX_LIMITS.MAX_ARGS_COUNT);
      for (const arg of cleaned) {
        expect(arg.length).toBe(SANDBOX_LIMITS.MAX_ARG_LENGTH);
      }
    });

    it('handles non-array inputs safely', () => {
      expect(validateArgs(undefined)).toEqual([]);
      expect(validateArgs(null as any)).toEqual([]);
      expect(validateArgs('not-an-array' as any)).toEqual([]);
    });
  });

  describe('SAFE_ENV', () => {
    it('does not contain any host secrets or user environment variables', () => {
      expect(SAFE_ENV).not.toHaveProperty('GITHUB_TOKEN');
      expect(SAFE_ENV).not.toHaveProperty('GEMINI_API_KEY');
      expect(SAFE_ENV).not.toHaveProperty('DATABASE_URL');
      expect(SAFE_ENV.NODE_ENV).toBe('production');
      expect(SAFE_ENV.PATH).toBeDefined();
    });
  });
});
