import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadEnv } from './env.js';

describe('Environment Configuration Loader (loadEnv)', () => {
  const testVarKey = 'ARCHLENS_TEST_VAR_123';
  const testPrecedenceKey = 'ARCHLENS_PRECEDENCE_KEY';
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archlens-env-test-'));
    delete process.env[testVarKey];
    delete process.env[testPrecedenceKey];
  });

  afterEach(() => {
    delete process.env[testVarKey];
    delete process.env[testPrecedenceKey];
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('loads variables from specified env file into process.env', () => {
    const envFile = path.join(tempDir, '.env');
    fs.writeFileSync(envFile, `${testVarKey}=loaded_successfully\n`, 'utf-8');

    expect(process.env[testVarKey]).toBeUndefined();
    loadEnv(envFile);
    expect(process.env[testVarKey]).toBe('loaded_successfully');
  });

  it('preserves existing environment variables (does not overwrite)', () => {
    process.env[testPrecedenceKey] = 'existing_value';

    const envFile = path.join(tempDir, '.env');
    fs.writeFileSync(envFile, `${testPrecedenceKey}=new_file_value\n`, 'utf-8');

    loadEnv(envFile);
    expect(process.env[testPrecedenceKey]).toBe('existing_value');
  });

  it('gracefully handles missing env file without throwing', () => {
    const nonExistentPath = path.join(tempDir, 'does-not-exist.env');
    expect(() => loadEnv(nonExistentPath)).not.toThrow();
  });
});
