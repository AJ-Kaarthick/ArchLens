import { describe, it, expect, afterEach } from 'vitest';
import { isSandboxEnabled, isUnsafeDevSandboxEnabled } from './policy.js';
import { ExecutionService } from './execution.service.js';
import { buildApp } from '../../server.js';
import type { RepositoryService } from '../repository.service.js';

describe('Sandbox Containment & Default Route Omission', () => {
  const originalEnvUnsafe = process.env.ENABLE_UNSAFE_DEV_SANDBOX;
  const originalEnvLegacy = process.env.ENABLE_SANDBOX;

  afterEach(() => {
    if (originalEnvUnsafe === undefined) {
      delete process.env.ENABLE_UNSAFE_DEV_SANDBOX;
    } else {
      process.env.ENABLE_UNSAFE_DEV_SANDBOX = originalEnvUnsafe;
    }
    if (originalEnvLegacy === undefined) {
      delete process.env.ENABLE_SANDBOX;
    } else {
      process.env.ENABLE_SANDBOX = originalEnvLegacy;
    }
  });

  describe('isUnsafeDevSandboxEnabled helper', () => {
    it('returns false by default in ALL environments (production, development, test)', () => {
      expect(isUnsafeDevSandboxEnabled({ NODE_ENV: 'production' })).toBe(false);
      expect(isUnsafeDevSandboxEnabled({ NODE_ENV: 'development' })).toBe(false);
      expect(isUnsafeDevSandboxEnabled({ NODE_ENV: 'test' })).toBe(false);
      expect(isUnsafeDevSandboxEnabled({})).toBe(false);
    });

    it('returns true only when ENABLE_UNSAFE_DEV_SANDBOX is explicitly "yes", "true", or "1"', () => {
      expect(isUnsafeDevSandboxEnabled({ ENABLE_UNSAFE_DEV_SANDBOX: 'yes' })).toBe(true);
      expect(isUnsafeDevSandboxEnabled({ ENABLE_UNSAFE_DEV_SANDBOX: 'true' })).toBe(true);
      expect(isUnsafeDevSandboxEnabled({ ENABLE_UNSAFE_DEV_SANDBOX: '1' })).toBe(true);
      expect(isUnsafeDevSandboxEnabled({ ENABLE_UNSAFE_DEV_SANDBOX: 'YES' })).toBe(true);
      expect(isUnsafeDevSandboxEnabled({ ENABLE_UNSAFE_DEV_SANDBOX: 'no' })).toBe(false);
      expect(isUnsafeDevSandboxEnabled({ ENABLE_UNSAFE_DEV_SANDBOX: 'false' })).toBe(false);
    });

    it('supports legacy ENABLE_SANDBOX if explicitly enabled', () => {
      expect(isSandboxEnabled({ ENABLE_SANDBOX: 'true' })).toBe(true);
      expect(isSandboxEnabled({ ENABLE_SANDBOX: 'yes' })).toBe(true);
      expect(isSandboxEnabled({ ENABLE_SANDBOX: 'false' })).toBe(false);
    });
  });

  describe('HTTP endpoints when sandbox is disabled (Default Normal Product)', () => {
    it('execution and preview routes are NOT registered by default and return 404', async () => {
      const app = buildApp({ logger: false });

      const eligibilityRes = await app.inject({
        method: 'GET',
        url: '/api/repositories/testowner/testrepo/eligibility',
      });
      expect(eligibilityRes.statusCode).toBe(404);

      const execRes = await app.inject({
        method: 'POST',
        url: '/api/repositories/testowner/testrepo/execute',
        payload: {},
      });
      expect(execRes.statusCode).toBe(404);

      const previewRes = await app.inject({
        method: 'GET',
        url: '/api/preview/test_123/index.html',
      });
      expect(previewRes.statusCode).toBe(404);
    });
  });

  describe('HTTP endpoints when unsafe dev sandbox is explicitly enabled', () => {
    it('registers execution routes and serves eligibility when enableUnsafeDevSandbox is true', async () => {
      process.env.ENABLE_UNSAFE_DEV_SANDBOX = 'yes';
      const mockRepoService = {
        getLatestAnalysis: async () => null,
      } as unknown as RepositoryService;

      const executionService = new ExecutionService(mockRepoService);
      const app = buildApp({
        logger: false,
        enableUnsafeDevSandbox: true,
        executionService,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/repositories/testowner/testrepo/eligibility',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.eligible).toBe(false);
      expect(body.refusalReason).toBe('missing_entrypoint');
    });
  });

  describe('ExecutionService inlineCode rejection', () => {
    it('rejects arbitrary inlineCode even if service execute is called', async () => {
      process.env.ENABLE_UNSAFE_DEV_SANDBOX = 'yes';
      const service = new ExecutionService();
      const result = await service.execute('test', 'repo', {
        inlineCode: 'console.log("malicious")',
      } as any);

      expect(result.status).toBe('refused');
      expect(result.refusalReason).toBe('unsafe_project');
      expect(result.stderr).toContain('inlineCode');
    });
  });
});
