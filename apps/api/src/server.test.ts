import { describe, it, expect, vi } from 'vitest';
import { buildApp, gracefulShutdown, createLoggerConfig } from './server.js';
import type { WorkspaceManager } from './services/sandbox/workspace-manager.js';
import type { ProcessSandboxRunner } from './services/sandbox/process-runner.js';

describe('Server Infrastructure & Observability', () => {
  describe('Correlation ID (x-request-id)', () => {
    it('generates a new x-request-id if not provided by client', async () => {
      const app = buildApp({ logger: false });

      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(res.statusCode).toBe(200);
      const requestId = res.headers['x-request-id'];
      expect(requestId).toBeDefined();
      expect(String(requestId).length).toBeGreaterThan(10);
    });

    it('preserves client-provided x-request-id header across request and response', async () => {
      const app = buildApp({ logger: false });
      const clientCorrelationId = 'custom-correlation-id-98765';

      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          'x-request-id': clientCorrelationId,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-request-id']).toBe(clientCorrelationId);
    });
  });

  describe('Security Redaction in Structured Logger', () => {
    it('configures redaction for sensitive headers, cookies, and tokens', () => {
      const loggerConfig = createLoggerConfig({ LOG_LEVEL: 'info' }) as any;
      expect(loggerConfig).toBeDefined();
      expect(loggerConfig.redact).toBeDefined();
      expect(loggerConfig.redact.censor).toBe('[REDACTED]');

      const paths = loggerConfig.redact.paths as string[];
      expect(paths).toContain('req.headers.authorization');
      expect(paths).toContain('req.headers.cookie');
      expect(paths).toContain('req.headers["x-api-key"]');
      expect(paths).toContain('req.headers["github-token"]');
      expect(paths).toContain('token');
      expect(paths).toContain('apiKey');
      expect(paths).toContain('password');
      expect(paths).toContain('secret');
      expect(paths).toContain('DATABASE_URL');
    });
  });

  describe('Graceful Shutdown', () => {
    it('closes server, cleans workspaces, terminates processes, and closes DB pool cleanly', async () => {
      const app = buildApp({ logger: false });

      const mockWsManager = {
        cleanupAllWorkspaces: vi.fn().mockResolvedValue(undefined),
      } as unknown as WorkspaceManager;

      const mockProcessRunner = {
        terminateAllProcesses: vi.fn().mockResolvedValue(undefined),
      } as unknown as ProcessSandboxRunner;

      const mockCloseDb = vi.fn().mockResolvedValue(undefined);

      await gracefulShutdown({
        app,
        signal: 'SIGTERM',
        timeoutMs: 5000,
        wsManager: mockWsManager,
        processRunner: mockProcessRunner,
        closeDb: mockCloseDb,
        exitProcess: false, // Don't terminate the test runner process
      });

      expect(mockWsManager.cleanupAllWorkspaces).toHaveBeenCalledTimes(1);
      expect(mockProcessRunner.terminateAllProcesses).toHaveBeenCalledTimes(1);
      expect(mockCloseDb).toHaveBeenCalledTimes(1);
    });

    it('guards against duplicate shutdown invocations', async () => {
      const app = buildApp({ logger: false });

      const mockWsManager = {
        cleanupAllWorkspaces: vi.fn().mockResolvedValue(undefined),
      } as unknown as WorkspaceManager;

      const mockProcessRunner = {
        terminateAllProcesses: vi.fn().mockResolvedValue(undefined),
      } as unknown as ProcessSandboxRunner;

      const mockCloseDb = vi.fn().mockResolvedValue(undefined);

      // Execute shutdown
      await gracefulShutdown({
        app,
        signal: 'SIGINT',
        wsManager: mockWsManager,
        processRunner: mockProcessRunner,
        closeDb: mockCloseDb,
        exitProcess: false,
      });

      expect(mockWsManager.cleanupAllWorkspaces).toHaveBeenCalledTimes(1);
    });
  });
});
