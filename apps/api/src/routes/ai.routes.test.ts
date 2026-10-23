import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../server.js';
import { AIService, RepositoryNotAnalyzedError } from '../services/ai/ai.service.js';
import {
  AIRateLimitError,
  AITemporaryUnavailableError,
} from '../services/ai/provider.interface.js';
import type { ExplainResponse, InsightResponse } from '@archlens/shared';

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
      expect.any(Object),
      expect.anything()
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
      expect.any(Object),
      expect.anything()
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

  describe('GET /api/repositories/:owner/:repo/insights/:topic', () => {
    it('returns 200 and InsightResponse when insight is ready', async () => {
      const mockInsight: InsightResponse = {
        status: 'ready',
        topic: 'overview',
        target: null,
        result: mockResponse,
        isStale: false,
        promptVersion: 1,
      };
      const mockAiService = {
        getOrEnqueueInsight: vi.fn().mockResolvedValue(mockInsight),
      } as unknown as AIService;

      const app = buildApp({ aiService: mockAiService });
      const response = await app.inject({
        method: 'GET',
        url: '/api/repositories/facebook/react/insights/overview',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ready');
      expect(body.result.summary).toBe('Mock repository summary');
      expect(mockAiService.getOrEnqueueInsight).toHaveBeenCalledWith(
        'facebook',
        'react',
        'overview',
        null,
        1,
        false
      );
    });

    it('returns 200 with pending status when generation is queued or running', async () => {
      const mockInsight: InsightResponse = {
        status: 'pending',
        topic: 'architecture',
        target: null,
        result: null,
        isStale: false,
        promptVersion: 1,
      };
      const mockAiService = {
        getOrEnqueueInsight: vi.fn().mockResolvedValue(mockInsight),
      } as unknown as AIService;

      const app = buildApp({ aiService: mockAiService });
      const response = await app.inject({
        method: 'GET',
        url: '/api/repositories/facebook/react/insights/architecture',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('pending');
      expect(body.isStale).toBe(false);
    });

    it('returns 200 with disabled status when AI provider is not configured', async () => {
      const mockInsight: InsightResponse = {
        status: 'disabled',
        topic: 'tech-stack',
        target: null,
        result: null,
        isStale: false,
        promptVersion: 1,
      };
      const mockAiService = {
        getOrEnqueueInsight: vi.fn().mockResolvedValue(mockInsight),
      } as unknown as AIService;

      const app = buildApp({ aiService: mockAiService });
      const response = await app.inject({
        method: 'GET',
        url: '/api/repositories/facebook/react/insights/tech-stack',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('disabled');
    });

    it('returns 400 for invalid topic', async () => {
      const mockAiService = {
        getOrEnqueueInsight: vi.fn(),
      } as unknown as AIService;

      const app = buildApp({ aiService: mockAiService });
      const response = await app.inject({
        method: 'GET',
        url: '/api/repositories/facebook/react/insights/invalid-topic',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('ValidationError');
    });

    it('returns 404 when repository has not been analyzed yet', async () => {
      const mockAiService = {
        getOrEnqueueInsight: vi.fn().mockRejectedValue(new RepositoryNotAnalyzedError('test', 'repo')),
      } as unknown as AIService;

      const app = buildApp({ aiService: mockAiService });
      const response = await app.inject({
        method: 'GET',
        url: '/api/repositories/test/repo/insights/overview',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('RepositoryNotAnalyzed');
    });
  });

  describe('POST /api/repositories/:owner/:repo/insights/:topic/retry', () => {
    it('returns 200 and invokes getOrEnqueueInsight with forceRetry=true', async () => {
      const mockInsight: InsightResponse = {
        status: 'pending',
        topic: 'overview',
        target: null,
        result: null,
        isStale: false,
        promptVersion: 1,
      };
      const mockAiService = {
        getOrEnqueueInsight: vi.fn().mockResolvedValue(mockInsight),
      } as unknown as AIService;

      const app = buildApp({ aiService: mockAiService });
      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories/facebook/react/insights/overview/retry',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('pending');
      expect(mockAiService.getOrEnqueueInsight).toHaveBeenCalledWith(
        'facebook',
        'react',
        'overview',
        null,
        1,
        true
      );
    });

    it('returns 400 when target is excessively long (>200 chars)', async () => {
      const mockAiService = { getOrEnqueueInsight: vi.fn() } as unknown as AIService;
      const app = buildApp({ aiService: mockAiService });

      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories/facebook/react/insights/overview/retry',
        payload: { target: 'a'.repeat(201) },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('ValidationError');
      expect(mockAiService.getOrEnqueueInsight).not.toHaveBeenCalled();
    });

    it('returns 400 when target contains control characters', async () => {
      const mockAiService = { getOrEnqueueInsight: vi.fn() } as unknown as AIService;
      const app = buildApp({ aiService: mockAiService });

      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories/facebook/react/insights/overview/retry',
        payload: { target: 'some\0nullbyte' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('ValidationError');
      expect(mockAiService.getOrEnqueueInsight).not.toHaveBeenCalled();
    });

    it('returns 400 when promptVersion is invalid', async () => {
      const mockAiService = { getOrEnqueueInsight: vi.fn() } as unknown as AIService;
      const app = buildApp({ aiService: mockAiService });

      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories/facebook/react/insights/overview/retry',
        payload: { promptVersion: 99 },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('ValidationError');
      expect(mockAiService.getOrEnqueueInsight).not.toHaveBeenCalled();
    });

    it('enforces rate limits on retry route', async () => {
      const mockAiService = {
        getOrEnqueueInsight: vi.fn().mockResolvedValue({
          status: 'pending',
          topic: 'overview',
          target: null,
          result: null,
          isStale: false,
          promptVersion: 1,
        }),
      } as unknown as AIService;

      const app = buildApp({
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

      // 1st request succeeds
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/repositories/facebook/react/insights/overview/retry',
        payload: {},
      });
      expect(res1.statusCode).toBe(200);

      // 2nd request exceeds explainMax limit
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/repositories/facebook/react/insights/overview/retry',
        payload: {},
      });
      expect(res2.statusCode).toBe(429);
      expect(JSON.parse(res2.body).error).toBe('RateLimitExceeded');
    });
  });

  describe('Abuse controls on GET /api/repositories/:owner/:repo/insights/:topic', () => {
    it('returns 400 when target in query string exceeds 200 chars', async () => {
      const mockAiService = { getOrEnqueueInsight: vi.fn() } as unknown as AIService;
      const app = buildApp({ aiService: mockAiService });

      const response = await app.inject({
        method: 'GET',
        url: `/api/repositories/facebook/react/insights/overview?target=${'x'.repeat(201)}`,
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('ValidationError');
    });

    it('returns 400 when promptVersion in query string is invalid', async () => {
      const mockAiService = { getOrEnqueueInsight: vi.fn() } as unknown as AIService;
      const app = buildApp({ aiService: mockAiService });

      const response = await app.inject({
        method: 'GET',
        url: '/api/repositories/facebook/react/insights/overview?promptVersion=999',
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('ValidationError');
    });
  });
});
