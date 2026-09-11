import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

let isLoaded = false;

/**
 * Loads environment variables from `.env` file if present.
 * Searches candidate paths:
 * 1. apps/api/.env (relative to this module)
 * 2. apps/api/.env (relative to current working directory)
 * 3. Current working directory .env
 *
 * Existing environment variables (e.g. in CI or Docker) take precedence.
 */
export function loadEnv(customPath?: string): void {
  if (customPath) {
    if (fs.existsSync(customPath)) {
      dotenv.config({ path: customPath, quiet: true });
    }
    return;
  }

  if (isLoaded) {
    return;
  }
  isLoaded = true;

  try {
    const candidatePaths: string[] = [
      path.resolve(process.cwd(), '.env'),
      path.resolve(process.cwd(), 'apps/api/.env'),
    ];

    // Search upwards from cwd for apps/api/.env or .env
    let dir = process.cwd();
    for (let i = 0; i < 5; i++) {
      candidatePaths.push(path.join(dir, 'apps/api/.env'));
      candidatePaths.push(path.join(dir, '.env'));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    for (const envPath of candidatePaths) {
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath, quiet: true });
        break;
      }
    }
  } catch {
    // Gracefully ignore filesystem errors in restricted environments
  }
}

// Auto-load on module evaluation
loadEnv();
