import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isSandboxEnabled } from './policy.js';
import { ExecutionService } from './execution.service.js';
import { buildApp } from '../../server.js';
import type { RepositoryService } from '../repository.service.js';

describe('Sandbox Disabled Toggle (ENABLE_SANDBOX)', () => {
  const originalEnv = process.env.ENABLE_SANDBOX;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ENABLE_SANDBOX;
    } else {
      process.env.ENABLE_SANDBOX = originalEnv;
    }
  });

  describe('isSandboxEnabled helper', () => {
    it('returns false when ENABLE_SANDBOX is "false" or "0"', () => {
      expect(isSandboxEnabled({ ENABLE_SANDBOX: 'false' })).toBe(false);
      expect(isSandboxEnabled({ ENABLE_SANDBOX: '0' })).toBe(false);
      expect(isSandboxEnabled({ ENABLE_SANDBOX: 'FALSE' })).toBe(false);
    });

    it('returns true when ENABLE_SANDBOX is "true" or "1"', () => {
      expect(isSandboxEnabled({ ENABLE_SANDBOX: 'true' })).toBe(true);
      expect(isSandboxEnabled({ ENABLE_SANDBOX: '1' })).toBe(true);
      expect(isSandboxEnabled({ ENABLE_SANDBOX: 'TRUE' })).toBe(true);
    });

    it('defaults to safe/off in production environment when unset', () => {
      expect(isSandboxEnabled({ NODE_ENV: 'production' })).toBe(false);
    });

    it('defaults to enabled in development/test environments when unset', () => {
      expect(isSandboxEnabled({ NODE_ENV: 'development' })).toBe(true);
      expect(isSandboxEnabled({ NODE_ENV: 'test' })).toBe(true);
    });
  });

  describe('ExecutionService when sandbox is disabled', () => {
    beforeEach(() => {
      process.env.ENABLE_SANDBOX = 'false';
    });

    it('refuses eligibility with refusalReason "disabled"', async () => {
      const mockRepoService = {
        getLatestAnalysis: async () => ({
          repository: { owner: 'test', name: 'repo', defaultBranch: 'main' },
          tree: [{ path: 'index.js', type: 'file', size: 100 }],
          techStack: [],
          metrics: { totalFiles: 1, totalBytes: 100, languages: {}, categories: {}, largestFiles: [] },
        }),
      } as unknown as RepositoryService;

      const service = new ExecutionService(mockRepoService);
      const eligibility = await service.getEligibility('test', 'repo');

      expect(eligibility.eligible).toBe(false);
      expect(eligibility.refusalReason).toBe('disabled');
      expect(eligibility.reasonMessage).toContain('disabled by deployment policy');
    });

    it('refuses execution with status "refused" and refusalReason "disabled"', async () => {
      const service = new ExecutionService();
      const result = await service.execute('test', 'repo', {});

      expect(result.status).toBe('refused');
      expect(result.refusalReason).toBe('disabled');
      expect(result.refusalMessage).toContain('disabled on this server deployment');
    });
  });

  describe('HTTP endpoints when sandbox is disabled', () => {
    beforeEach(() => {
      process.env.ENABLE_SANDBOX = 'false';
    });

    it('GET /api/repositories/:owner/:repo/eligibility returns disabled refusal', async () => {
      const mockRepoService = {
        getLatestAnalysis: async () => null,
      } as unknown as RepositoryService;

      const app = buildApp({
        logger: false,
        repositoryService: mockRepoService,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/repositories/testowner/testrepo/eligibility',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.eligible).toBe(false);
      expect(body.refusalReason).toBe('disabled');
    });

    it('POST /api/repositories/:owner/:repo/execute returns refused status', async () => {
      const app = buildApp({ logger: false });

      const res = await app.inject({
        method: 'POST',
        url: '/api/repositories/testowner/testrepo/execute',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('refused');
      expect(body.refusalReason).toBe('disabled');
    });

    it('GET /api/preview/:executionId returns 403 Forbidden', async () => {
      const app = buildApp({ logger: false });

      const res = await app.inject({
        method: 'GET',
        url: '/api/preview/test_123/index.html',
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('Forbidden');
      expect(body.message).toContain('disabled by deployment policy');
    });
  });
});
