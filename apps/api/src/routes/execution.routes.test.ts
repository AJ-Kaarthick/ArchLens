import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server.js';
import type { ExecutionService } from '../services/sandbox/execution.service.js';
import { WorkspaceManager } from '../services/sandbox/workspace-manager.js';

describe('Execution Fastify Routes', () => {
  let app: FastifyInstance;
  const mockWsManager = new WorkspaceManager();

  const mockExecutionService = {
    getEligibility: vi.fn(),
    execute: vi.fn(),
  } as unknown as ExecutionService;

  beforeAll(async () => {
    app = buildApp({
      logger: false,
      executionService: mockExecutionService,
      workspaceManager: mockWsManager,
    });
    await app.ready();
  });

  afterAll(async () => {
    mockWsManager.destroy();
    await app.close();
  });

  describe('GET /api/repositories/:owner/:repo/eligibility', () => {
    it('returns 200 and eligibility details', async () => {
      const mockEligibility = {
        eligible: true,
        recommendedProfile: 'node-script',
        detectedEntrypoints: ['index.js'],
        supportedProfiles: ['node-script'],
        warnings: [],
      };

      (mockExecutionService.getEligibility as any).mockResolvedValueOnce(mockEligibility);

      const res = await app.inject({
        method: 'GET',
        url: '/api/repositories/test-owner/test-repo/eligibility',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.eligible).toBe(true);
      expect(body.recommendedProfile).toBe('node-script');
    });

    it('handles service errors with 500 status', async () => {
      (mockExecutionService.getEligibility as any).mockRejectedValueOnce(
        new Error('Database unavailable')
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/repositories/test-owner/test-repo/eligibility',
      });

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('InternalError');
    });
  });

  describe('POST /api/repositories/:owner/:repo/execute', () => {
    it('returns 200 and ExecutionResult for valid execution', async () => {
      const mockResult = {
        executionId: 'exec_123',
        status: 'success',
        exitCode: 0,
        stdout: 'Hello World',
        stderr: '',
        durationMs: 120,
        profile: 'node-script',
        timestamp: new Date().toISOString(),
      };

      (mockExecutionService.execute as any).mockResolvedValueOnce(mockResult);

      const res = await app.inject({
        method: 'POST',
        url: '/api/repositories/test-owner/test-repo/execute',
        payload: {
          profile: 'node-script',
          entrypoint: 'index.js',
          timeoutMs: 3000,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.executionId).toBe('exec_123');
      expect(body.status).toBe('success');
      expect(body.stdout).toBe('Hello World');
    });

    it('returns 400 for invalid request payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/repositories/test-owner/test-repo/execute',
        payload: {
          profile: 'invalid-profile',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('ValidationError');
    });
  });

  describe('GET /api/preview/:executionId/*', () => {
    it('returns 404 for non-existent preview workspace', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/preview/non_existent_exec/index.html',
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('NotFound');
    });

    it('serves preview files with strict CSP and security isolation headers', async () => {
      const executionId = `preview_test_${Date.now()}`;
      const ws = await mockWsManager.prepareWorkspace({
        executionId,
        files: [
          {
            path: 'index.html',
            content: '<!DOCTYPE html><html><body><h1>ArchLens Preview</h1></body></html>',
          },
        ],
      });
      mockWsManager.registerPreviewWorkspace(ws);

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/preview/${executionId}/index.html`,
        });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
        expect(res.headers['content-security-policy']).toContain("default-src 'self'");
        expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(res.body).toContain('<h1>ArchLens Preview</h1>');
      } finally {
        await ws.cleanup();
      }
    });

    it('rejects path traversal attempts with 404', async () => {
      const executionId = `preview_traversal_${Date.now()}`;
      const ws = await mockWsManager.prepareWorkspace({
        executionId,
        files: [{ path: 'index.html', content: '<h1>OK</h1>' }],
      });
      mockWsManager.registerPreviewWorkspace(ws);

      try {
        const res = await app.inject({
          method: 'GET',
          url: `/api/preview/${executionId}/../../etc/passwd`,
        });

        expect(res.statusCode).toBe(404);
      } finally {
        await ws.cleanup();
      }
    });
  });
});
