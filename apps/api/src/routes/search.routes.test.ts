import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../server.js';
import {
  RetrievalService,
  RepositoryNotAnalyzedError,
} from '../services/retrieval/retrieval.service.js';
import { AIRateLimitError } from '../services/ai/provider.interface.js';
import type { FastifyInstance } from 'fastify';

describe('Search Fastify Routes', () => {
  let app: FastifyInstance;

  const mockRetrievalService = {
    search: vi.fn(),
  } as unknown as RetrievalService;

  beforeAll(async () => {
    app = buildApp({
      logger: false,
      retrievalService: mockRetrievalService,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/repositories/:owner/:repo/search returns 200 and SearchResponse', async () => {
    const mockResponse = {
      query: 'fastify server',
      results: [
        {
          filePath: 'apps/api/src/server.ts',
          chunkIndex: 0,
          startLine: 1,
          endLine: 35,
          content: 'import Fastify from "fastify";',
          score: 0.92,
          language: 'TypeScript',
          category: 'source' as const,
        },
      ],
      totalMatches: 1,
      durationMs: 15,
      fallback: true,
    };

    (mockRetrievalService.search as any).mockResolvedValueOnce(mockResponse);

    const res = await app.inject({
      method: 'POST',
      url: '/api/repositories/facebook/react/search',
      payload: { query: 'fastify server', limit: 5 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.query).toBe('fastify server');
    expect(body.results).toHaveLength(1);
    expect(body.results[0].filePath).toBe('apps/api/src/server.ts');
    expect(body.results[0].score).toBe(0.92);
    expect(body.fallback).toBe(true);
  });

  it('returns 400 when query is less than 2 characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/repositories/facebook/react/search',
      payload: { query: 'a' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('ValidationError');
    expect(body.isRateLimit).toBe(false);
  });

  it('returns 400 when limit is out of range', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/repositories/facebook/react/search',
      payload: { query: 'valid query', limit: 50 },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('ValidationError');
  });

  it('returns 404 when repository has not been analyzed yet', async () => {
    (mockRetrievalService.search as any).mockRejectedValueOnce(
      new RepositoryNotAnalyzedError('Repository not analyzed yet.')
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/repositories/facebook/react/search',
      payload: { query: 'database' },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('RepositoryNotAnalyzed');
    expect(body.suggestedAction).toContain('POST /api/analyze');
  });

  it('returns 429 when embedding rate limit is exceeded', async () => {
    (mockRetrievalService.search as any).mockRejectedValueOnce(
      new AIRateLimitError('Embedding quota exceeded', 'Retry in a few moments.')
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/repositories/facebook/react/search',
      payload: { query: 'database' },
    });

    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('RateLimitExceeded');
    expect(body.isRateLimit).toBe(true);
  });

  it('sanitizes generic 500 errors and does not expose internal stack traces', async () => {
    (mockRetrievalService.search as any).mockRejectedValueOnce(
      new Error('SECRET_INTERNAL_DB_FAILURE_DO_NOT_LEAK')
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/repositories/facebook/react/search',
      payload: { query: 'database' },
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('InternalError');
    expect(body.message).not.toContain('SECRET_INTERNAL_DB_FAILURE_DO_NOT_LEAK');
    expect(body.message).toBe('An internal error occurred while executing semantic search.');
  });
});
