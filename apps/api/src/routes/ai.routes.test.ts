import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../server.js';
import { AIService, RepositoryNotAnalyzedError } from '../services/ai/ai.service.js';
import {
  AIRateLimitError,
  AITemporaryUnavailableError,
} from '../services/ai/provider.interface.js';
import type { ExplainResponse } from '@archlens/shared';

describe('AI Fastify Routes', () => {
  const mockResponse: ExplainResponse = {
    topic: 'overview',
    target: null,
    summary: 'Mock repository summary',
    explanation: 'Mock technical explanation with markdown.',
    keyTakeaways: ['Takeaway 1', 'Takeaway 2'],
    evidence: [
      {
        type: 'manifest',
        label: 'Root Manifest',
        reference: 'package.json',
        description: 'Package definition',
      },
    ],
    generatedAt: new Date().toISOString(),
    provider: 'mock',
    model: 'mock-model',
    cached: false,
  };

  it('POST /api/repositories/:owner/:repo/explain returns 200 and ExplainResponse', async () => {
    const mockAiService = {
      explain: vi.fn().mockResolvedValue(mockResponse),
    } as unknown as AIService;

    const app = buildApp({ aiService: mockAiService });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/facebook/react/explain',
      payload: { topic: 'overview' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.topic).toBe('overview');
    expect(body.summary).toBe('Mock repository summary');
    expect(body.keyTakeaways).toHaveLength(2);
    expect(body.evidence).toHaveLength(1);
    expect(mockAiService.explain).toHaveBeenCalledWith(
      'facebook',
      'react',
      expect.objectContaining({
        topic: 'overview',
      }),
      expect.any(Object)
    );
  });

  it('defaults topic to overview when body is empty', async () => {
    const mockAiService = {
      explain: vi.fn().mockResolvedValue(mockResponse),
    } as unknown as AIService;

    const app = buildApp({ aiService: mockAiService });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/facebook/react/explain',
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(mockAiService.explain).toHaveBeenCalledWith(
      'facebook',
      'react',
      expect.objectContaining({
        topic: 'overview',
      }),
      expect.any(Object)
    );
  });

  it('returns 400 when invalid topic is requested', async () => {
    const mockAiService = {
      explain: vi.fn(),
    } as unknown as AIService;

    const app = buildApp({ aiService: mockAiService });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/facebook/react/explain',
      payload: { topic: 'invalid-topic-xyz' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('ValidationError');
    expect(mockAiService.explain).not.toHaveBeenCalled();
  });

  it('returns 404 when repository has not been analyzed yet', async () => {
    const mockAiService = {
      explain: vi.fn().mockRejectedValue(new RepositoryNotAnalyzedError('test', 'repo')),
    } as unknown as AIService;

    const app = buildApp({ aiService: mockAiService });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/test/repo/explain',
      payload: { topic: 'overview' },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('RepositoryNotAnalyzed');
    expect(body.suggestedAction).toContain('POST /api/analyze');
  });

  it('returns 429 based on provider-agnostic AIRateLimitError', async () => {
    const mockAiService = {
      explain: vi.fn().mockRejectedValue(new AIRateLimitError('Quota exhausted')),
    } as unknown as AIService;

    const app = buildApp({ aiService: mockAiService });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/test/repo/explain',
      payload: { topic: 'overview' },
    });

    expect(response.statusCode).toBe(429);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('RateLimitExceeded');
    expect(body.isRateLimit).toBe(true);
  });

  it('sanitizes generic 500 errors and does not expose internal exception details', async () => {
    const sensitiveError = new Error(
      'DATABASE CONNECTION CRASH: pass=supersecretpassword host=internal.db.corp'
    );
    const mockAiService = {
      explain: vi.fn().mockRejectedValue(sensitiveError),
    } as unknown as AIService;

    const app = buildApp({ aiService: mockAiService });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/test/repo/explain',
      payload: { topic: 'overview' },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('AIExplanationError');
    expect(body.isRateLimit).toBe(false);

    // Verify raw exception details/passwords are NOT leaked in response
    expect(body.message).not.toContain('supersecretpassword');
    expect(body.message).not.toContain('internal.db.corp');
    expect(body.message).toBe('An internal error occurred while generating the AI explanation.');
  });

  it('returns 503 based on provider-agnostic AITemporaryUnavailableError', async () => {
    const mockAiService = {
      explain: vi
        .fn()
        .mockRejectedValue(
          new AITemporaryUnavailableError('Gemini AI service temporarily unavailable')
        ),
    } as unknown as AIService;

    const app = buildApp({ aiService: mockAiService });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/test/repo/explain',
      payload: { topic: 'overview' },
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('AITemporarilyUnavailable');
    expect(body.isRateLimit).toBe(false);
    expect(body.message).toBe('Gemini AI service temporarily unavailable');
    expect(body.suggestedAction).toContain('Retry');
  });

  it('returns 400 when AI provider reports invalid client request', async () => {
    const err = new Error('Invalid prompt structure');
    (err as any).status = 400;
    const mockAiService = {
      explain: vi.fn().mockRejectedValue(err),
    } as unknown as AIService;

    const app = buildApp({ aiService: mockAiService });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/test/repo/explain',
      payload: { topic: 'overview' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('InvalidAIRequest');
  });

  it('returns 401 when AI provider authentication fails', async () => {
    const err = new Error('Invalid API key');
    (err as any).status = 401;
    const mockAiService = {
      explain: vi.fn().mockRejectedValue(err),
    } as unknown as AIService;

    const app = buildApp({ aiService: mockAiService });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/test/repo/explain',
      payload: { topic: 'overview' },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('AIAuthenticationError');
  });

  it('returns 403 when AI provider permissions are denied or safety filters trigger', async () => {
    const err = new Error('Safety policy block');
    (err as any).status = 403;
    const mockAiService = {
      explain: vi.fn().mockRejectedValue(err),
    } as unknown as AIService;

    const app = buildApp({ aiService: mockAiService });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/test/repo/explain',
      payload: { topic: 'overview' },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('AIPermissionError');
  });

  it('returns 499 when AI explanation request was aborted', async () => {
    const mockAiService = {
      explain: vi.fn().mockRejectedValue(new Error('AI explanation request was aborted.')),
    } as unknown as AIService;

    const app = buildApp({ aiService: mockAiService });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/test/repo/explain',
      payload: { topic: 'overview' },
    });

    expect(response.statusCode).toBe(499);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('ClientClosedRequest');
    expect(body.message).toBe('AI explanation request was cancelled.');
  });
});
