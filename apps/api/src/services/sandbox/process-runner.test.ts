import { describe, it, expect, afterAll } from 'vitest';
import { WorkspaceManager } from './workspace-manager.js';
import { ProcessSandboxRunner } from './process-runner.js';

describe('ProcessSandboxRunner (Live Sandbox Integration)', () => {
  const manager = new WorkspaceManager();
  const runner = new ProcessSandboxRunner();

  afterAll(() => {
    manager.destroy();
  });

  it('executes a JavaScript script safely and captures stdout with exit code 0', async () => {
    const executionId = `live_test_ok_${Date.now()}`;
    const ws = await manager.prepareWorkspace({
      executionId,
      files: [
        {
          path: 'index.js',
          content: 'console.log("ARCHLENS_RUNNER_OK"); process.exit(0);',
        },
      ],
    });

    try {
      const result = await runner.execute({
        executionId,
        workspacePath: ws.workspaceDir,
        entrypoint: 'index.js',
        profile: 'node-script',
        args: [],
        timeoutMs: 3000,
      });

      expect(result.status).toBe('success');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('ARCHLENS_RUNNER_OK');
      expect(result.stderr).toBe('');
      expect(result.durationMs).toBeGreaterThan(0);
    } finally {
      await ws.cleanup();
    }
  });

  it('guarantees zero host secret inheritance inside the sandbox process', async () => {
    // Set mock secrets in host process environment
    process.env.TEST_HOST_SECRET = 'SUPER_SECRET_HOST_TOKEN_12345';
    process.env.GITHUB_TOKEN = 'ghp_secret_github_token_host';
    process.env.DATABASE_URL = 'postgres://user:secretpass@localhost:5432/archlens';

    const executionId = `live_test_secrets_${Date.now()}`;
    const ws = await manager.prepareWorkspace({
      executionId,
      files: [
        {
          path: 'check_secrets.js',
          content: `
            console.log('HOST_SECRET_VAL=' + process.env.TEST_HOST_SECRET);
            console.log('GITHUB_TOKEN_VAL=' + process.env.GITHUB_TOKEN);
            console.log('DATABASE_URL_VAL=' + process.env.DATABASE_URL);
          `,
        },
      ],
    });

    try {
      const result = await runner.execute({
        executionId,
        workspacePath: ws.workspaceDir,
        entrypoint: 'check_secrets.js',
        profile: 'node-script',
        args: [],
        timeoutMs: 3000,
      });

      expect(result.status).toBe('success');
      expect(result.stdout).toContain('HOST_SECRET_VAL=undefined');
      expect(result.stdout).toContain('GITHUB_TOKEN_VAL=undefined');
      expect(result.stdout).toContain('DATABASE_URL_VAL=undefined');
    } finally {
      delete process.env.TEST_HOST_SECRET;
      await ws.cleanup();
    }
  });

  it('enforces execution timeout and terminates the process tree', async () => {
    const executionId = `live_test_timeout_${Date.now()}`;
    const ws = await manager.prepareWorkspace({
      executionId,
      files: [
        {
          path: 'infinite.js',
          content: 'console.log("LOOP_START"); setInterval(() => {}, 1000);',
        },
      ],
    });

    try {
      const result = await runner.execute({
        executionId,
        workspacePath: ws.workspaceDir,
        entrypoint: 'infinite.js',
        profile: 'node-script',
        args: [],
        timeoutMs: 600, // 600ms hard timeout
      });

      expect(result.status).toBe('timeout');
      expect(result.refusalReason).toBe('timeout');
      expect(result.exitCode).toBeNull();
      expect(result.stderr).toContain('execution timed out after 600ms and was terminated');
    } finally {
      await ws.cleanup();
    }
  });

  it('enforces bounded 64 KB output buffer and appends truncation indicator', async () => {
    const executionId = `live_test_output_bound_${Date.now()}`;
    const ws = await manager.prepareWorkspace({
      executionId,
      files: [
        {
          path: 'large_output.js',
          content: `
            for (let i = 0; i < 2000; i++) {
              console.log('Line ' + i + ': ' + 'A'.repeat(60));
            }
          `,
        },
      ],
    });

    try {
      const result = await runner.execute({
        executionId,
        workspacePath: ws.workspaceDir,
        entrypoint: 'large_output.js',
        profile: 'node-script',
        args: [],
        timeoutMs: 5000,
      });

      expect(result.status).toBe('success');
      expect(result.stdout).toContain('[ArchLens: stdout truncated at 64 KB limit]');
      expect(Buffer.byteLength(result.stdout, 'utf-8')).toBeLessThanOrEqual(64 * 1024 + 200);
    } finally {
      await ws.cleanup();
    }
  });

  it('accurately captures non-zero failure exit codes', async () => {
    const executionId = `live_test_fail_${Date.now()}`;
    const ws = await manager.prepareWorkspace({
      executionId,
      files: [
        {
          path: 'fail.js',
          content: 'console.error("Critical script error"); process.exit(42);',
        },
      ],
    });

    try {
      const result = await runner.execute({
        executionId,
        workspacePath: ws.workspaceDir,
        entrypoint: 'fail.js',
        profile: 'node-script',
        args: [],
        timeoutMs: 3000,
      });

      expect(result.status).toBe('failed');
      expect(result.exitCode).toBe(42);
      expect(result.stderr).toContain('Critical script error');
    } finally {
      await ws.cleanup();
    }
  });

  it('captures JavaScript syntax errors gracefully with non-zero exit code and stderr', async () => {
    const executionId = `live_test_syntax_${Date.now()}`;
    const ws = await manager.prepareWorkspace({
      executionId,
      files: [
        {
          path: 'syntax_error.js',
          content: 'function broken( { return 42; }',
        },
      ],
    });

    try {
      const result = await runner.execute({
        executionId,
        workspacePath: ws.workspaceDir,
        entrypoint: 'syntax_error.js',
        profile: 'node-script',
        args: [],
        timeoutMs: 3000,
      });

      expect(result.status).toBe('failed');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('SyntaxError');
    } finally {
      await ws.cleanup();
    }
  });
});
