import type { FastifyPluginAsync } from 'fastify';
import { SearchQuerySchema, type ApiError } from '@archlens/shared';
import {
  RetrievalService,
  RepositoryNotAnalyzedError,
} from '../services/retrieval/retrieval.service.js';
import { AIRateLimitError } from '../services/ai/provider.interface.js';
import { getRateLimitConfig, type RateLimitConfig } from '../config/rate-limit.js';

export function createSearchRoutes(
  customService?: RetrievalService,
  customRateLimitConfig?: RateLimitConfig
): FastifyPluginAsync {
  const service = customService || new RetrievalService();
  const rateLimits = customRateLimitConfig || getRateLimitConfig();

  return async (fastify) => {
    // POST /api/repositories/:owner/:repo/search
    fastify.post(
      '/api/repositories/:owner/:repo/search',
      {
        config: {
          rateLimit: {
            max: rateLimits.searchMax,
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
            suggestedAction: 'Ensure URL matches /api/repositories/:owner/:repo/search',
          };
          return reply.status(400).send(errorResponse);
        }

        let parsedQuery;
        try {
          parsedQuery = SearchQuerySchema.parse(request.body || {});
        } catch (err: unknown) {
          const message =
            err && typeof err === 'object' && 'issues' in err && Array.isArray((err as any).issues)
              ? (err as any).issues[0]?.message
              : 'Invalid search request payload.';

          const errorResponse: ApiError = {
            error: 'ValidationError',
            message,
            isRateLimit: false,
            suggestedAction:
              'Provide a query string of at least 2 characters and optional limit between 1 and 20.',
          };
          return reply.status(400).send(errorResponse);
        }

        try {
          const response = await service.search(owner, repo, parsedQuery);
          request.log.info(
            {
              event: 'semantic_search_completed',
              owner,
              repo,
              resultCount: response.results.length,
              durationMs: response.durationMs,
            },
            'Semantic search completed'
          );
          return reply.status(200).send(response);
      } catch (err: unknown) {
        if (err instanceof RepositoryNotAnalyzedError) {
          const errorResponse: ApiError = {
            error: 'RepositoryNotAnalyzed',
            message: err.message,
            isRateLimit: false,
            suggestedAction:
              'Run POST /api/analyze for this repository before executing semantic search.',
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
            message: (err as any).message || 'Embedding provider rate limit or quota exceeded.',
            isRateLimit: true,
            suggestedAction:
              (err as any).suggestedAction ||
              'Wait a moment before retrying semantic search, or switch to MockEmbeddingProvider.',
          };
          return reply.status(429).send(errorResponse);
        }

        fastify.log.error(err);

        const errorResponse: ApiError = {
          error: 'InternalError',
          message: 'An internal error occurred while executing semantic search.',
          isRateLimit: false,
          suggestedAction: 'Please retry shortly or inspect server logs for details.',
        };
        return reply.status(500).send(errorResponse);
      }
    });
  };
}

export const searchRoutes = createSearchRoutes();
