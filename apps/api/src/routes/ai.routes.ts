import type { FastifyPluginAsync } from 'fastify';
import { ExplainRequestSchema, type ApiError } from '@archlens/shared';
import { aiService, AIService, RepositoryNotAnalyzedError } from '../services/ai/ai.service.js';
import { AIRateLimitError } from '../services/ai/provider.interface.js';
import { getRateLimitConfig, type RateLimitConfig } from '../config/rate-limit.js';

export function createAiRoutes(
  customService?: AIService,
  customRateLimitConfig?: RateLimitConfig
): FastifyPluginAsync {
  const service = customService || aiService;
  const rateLimits = customRateLimitConfig || getRateLimitConfig();

  return async (fastify) => {
    // POST /api/repositories/:owner/:repo/explain
    fastify.post(
      '/api/repositories/:owner/:repo/explain',
      {
        config: {
          rateLimit: {
            max: rateLimits.explainMax,
            timeWindow: rateLimits.timeWindowMs,
          },
        },
      },
      async (request, reply) => {
        const { owner, repo } = request.params as { owner: string; repo: string };

        if (!owner || !repo) {
          const errorResponse: ApiError = {
            error: 'ValidationError',
            message: 'Both owner and repo path parameters are required.',
            isRateLimit: false,
            suggestedAction: 'Ensure URL matches /api/repositories/:owner/:repo/explain',
          };
          return reply.status(400).send(errorResponse);
        }

        let parsedRequest;
        try {
          parsedRequest = ExplainRequestSchema.parse(request.body || {});
        } catch (err: unknown) {
          const message =
            err && typeof err === 'object' && 'issues' in err && Array.isArray((err as any).issues)
              ? (err as any).issues[0]?.message
              : 'Invalid explanation request payload.';

          const errorResponse: ApiError = {
            error: 'ValidationError',
            message,
            isRateLimit: false,
            suggestedAction:
              "Valid topics are 'overview', 'architecture', 'tech-stack', 'entrypoints'.",
          };
          return reply.status(400).send(errorResponse);
        }

        const startTime = Date.now();
        try {
          const response = await service.explain(owner, repo, parsedRequest);
          request.log.info(
            {
              event: 'ai_explanation_completed',
              owner,
              repo,
              topic: parsedRequest.topic,
              cached: response.cached,
              durationMs: Date.now() - startTime,
            },
            'AI explanation completed'
          );
          return reply.status(200).send(response);
      } catch (err: unknown) {
        if (err instanceof RepositoryNotAnalyzedError) {
          const errorResponse: ApiError = {
            error: 'RepositoryNotAnalyzed',
            message: err.message,
            isRateLimit: false,
            suggestedAction:
              'Run POST /api/analyze for this repository before requesting AI explanations.',
          };
          return reply.status(404).send(errorResponse);
        }

        if (
          err instanceof AIRateLimitError ||
          (err &&
            typeof err === 'object' &&
            'isRateLimit' in err &&
            (err as any).isRateLimit === true)
        ) {
          const errorResponse: ApiError = {
            error: 'RateLimitExceeded',
            message: (err as any).message || 'AI provider rate limit or quota exceeded.',
            isRateLimit: true,
            suggestedAction:
              (err as any).suggestedAction ||
              'Wait a moment before requesting another AI explanation, or switch to MockAIProvider.',
          };
          return reply.status(429).send(errorResponse);
        }

        fastify.log.error(err);

        const errorResponse: ApiError = {
          error: 'AIExplanationError',
          message: 'An internal error occurred while generating the AI explanation.',
          isRateLimit: false,
          suggestedAction: 'Please try again shortly or inspect server logs for details.',
        };
        return reply.status(500).send(errorResponse);
      }
    });
  };
}
