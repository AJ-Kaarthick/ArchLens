import { describe, it, expect } from 'vitest';
import { buildApp } from '../server.js';
import type { RepositoryService } from '../services/repository.service.js';
import type { AIService } from '../services/ai/ai.service.js';
import type { RetrievalService } from '../services/retrieval/retrieval.service.js';
import type { ExecutionService } from '../services/sandbox/execution.service.js';

describe('Rate Limiting', () => {
  it('enforces analyze limit and returns 429 when threshold is exceeded', async () => {
    const mockRepoService = {
      analyze: async () => ({
        repository: { owner: 'test', name: 'repo', defaultBranch: 'main' },
        techStack: [],
        metrics: { totalFiles: 5, totalBytes: 1000, languages: {}, categories: {}, largestFiles: [] },
        architecture: { patterns: [], primaryEntrypoints: [] },
        tree: [],
        analyzedAt: new Date().toISOString(),
      }),
    } as unknown as RepositoryService;

    const app = buildApp({
      logger: false,
      repositoryService: mockRepoService,
      rateLimitConfig: {
        analyzeMax: 2,
        executeMax: 2,
        explainMax: 2,
        searchMax: 2,
        generalMax: 5,
        timeWindowMs: 60000,
      },
    });

    // 1st request - should succeed
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      payload: { url: 'https://github.com/test/repo' },
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.headers['x-ratelimit-limit']).toBe('2');
    expect(res1.headers['x-ratelimit-remaining']).toBe('1');

    // 2nd request - should succeed
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      payload: { url: 'https://github.com/test/repo' },
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.headers['x-ratelimit-remaining']).toBe('0');

    // 3rd request - should be rate-limited with HTTP 429
    const res3 = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      payload: { url: 'https://github.com/test/repo' },
    });
    expect(res3.statusCode).toBe(429);
    expect(res3.headers['retry-after']).toBeDefined();

    const body3 = res3.json();
    expect(body3.error).toBe('RateLimitExceeded');
    expect(body3.isRateLimit).toBe(true);
    expect(body3.message).toContain('Rate limit of 2 requests per window exceeded');
    expect(body3.suggestedAction).toBeDefined();
  });

  it('enforces execution limit on POST /api/repositories/:owner/:repo/execute', async () => {
    const mockExecService = {
      execute: async () => ({
        executionId: 'exec_123',
        status: 'success',
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        durationMs: 10,
        profile: 'node-script',
        timestamp: new Date().toISOString(),
      }),
    } as unknown as ExecutionService;

    const app = buildApp({
      logger: false,
      executionService: mockExecService,
      rateLimitConfig: {
        analyzeMax: 10,
        executeMax: 1,
        explainMax: 10,
        searchMax: 10,
        generalMax: 10,
        timeWindowMs: 60000,
      },
    });

    // 1st request succeeds
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/repositories/testowner/testrepo/execute',
      payload: {},
    });
    expect(res1.statusCode).toBe(200);

    // 2nd request hits 429
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/repositories/testowner/testrepo/execute',
      payload: {},
    });
    expect(res2.statusCode).toBe(429);
    const body2 = res2.json();
    expect(body2.error).toBe('RateLimitExceeded');
    expect(body2.isRateLimit).toBe(true);
  });

  it('enforces explain limit on POST /api/repositories/:owner/:repo/explain', async () => {
    const mockAiService = {
      explain: async () => ({
        topic: 'overview',
        summary: 'test summary',
        details: 'test details',
        evidence: [],
        confidenceScore: 0.95,
        confidenceRationale: 'high',
        cached: false,
      }),
    } as unknown as AIService;

    const app = buildApp({
      logger: false,
      aiService: mockAiService,
      rateLimitConfig: {
        analyzeMax: 10,
        executeMax: 10,
        explainMax: 1,
        searchMax: 10,
        generalMax: 10,
        timeWindowMs: 60000,
      },
    });

    // 1st request
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/repositories/testowner/testrepo/explain',
      payload: { topic: 'overview' },
    });
    expect(res1.statusCode).toBe(200);

    // 2nd request hits 429
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/repositories/testowner/testrepo/explain',
      payload: { topic: 'overview' },
    });
    expect(res2.statusCode).toBe(429);
    expect(res2.json().error).toBe('RateLimitExceeded');
  });

  it('enforces search limit on POST /api/repositories/:owner/:repo/search', async () => {
    const mockRetrievalService = {
      search: async () => ({
        query: 'auth',
        results: [],
        totalMatches: 0,
        durationMs: 5,
        fallback: false,
      }),
    } as unknown as RetrievalService;

    const app = buildApp({
      logger: false,
      retrievalService: mockRetrievalService,
      rateLimitConfig: {
        analyzeMax: 10,
        executeMax: 10,
        explainMax: 10,
        searchMax: 1,
        generalMax: 10,
        timeWindowMs: 60000,
      },
    });

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/repositories/testowner/testrepo/search',
      payload: { query: 'auth' },
    });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/repositories/testowner/testrepo/search',
      payload: { query: 'auth' },
    });
    expect(res2.statusCode).toBe(429);
  });

  it('bypasses rate limiting for health endpoints', async () => {
    const app = buildApp({
      logger: false,
      checkDb: async () => true,
      rateLimitConfig: {
        analyzeMax: 1,
        executeMax: 1,
        explainMax: 1,
        searchMax: 1,
        generalMax: 1,
        timeWindowMs: 60000,
      },
    });

    // Make multiple consecutive health calls - none should be 429
    for (let i = 0; i < 5; i++) {
      const resLiveness = await app.inject({ method: 'GET', url: '/health/liveness' });
      expect(resLiveness.statusCode).toBe(200);

      const resReadiness = await app.inject({ method: 'GET', url: '/health/readiness' });
      expect(resReadiness.statusCode).toBe(200);

      const resHealth = await app.inject({ method: 'GET', url: '/health' });
      expect(resHealth.statusCode).toBe(200);
    }
  });
});
