import type { FastifyPluginAsync } from 'fastify';
import {
  SearchQuerySchema,
  IndexRequestSchema,
  type ApiError,
} from '@archlens/shared';
import {
  RetrievalService,
  RepositoryNotAnalyzedError,
} from '../services/retrieval/retrieval.service.js';
import { AIRateLimitError } from '../services/ai/provider.interface.js';
import { getRateLimitConfig, type RateLimitConfig } from '../config/rate-limit.js';
import { sanitizeErrorMessage } from '../services/ai/sanitize-error.js';

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
            message: sanitizeErrorMessage(message),
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
              event: 'search_completed',
              owner,
              repo,
              resultCount: response.results.length,
              durationMs: response.durationMs,
              fallback: response.fallback,
              mode: response.mode,
            },
            'Repository search completed'
          );
          return reply.status(200).send(response);
        } catch (err: unknown) {
          if (err instanceof RepositoryNotAnalyzedError) {
            const errorResponse: ApiError = {
              error: 'RepositoryNotAnalyzed',
              message: sanitizeErrorMessage(err.message),
              isRateLimit: false,
              suggestedAction:
                'Run POST /api/analyze for this repository before executing search.',
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
              message: sanitizeErrorMessage(
                (err as any).message || 'Embedding provider rate limit or quota exceeded.'
              ),
              isRateLimit: true,
              suggestedAction:
                (err as any).suggestedAction ||
                'Wait a moment before retrying search, or use lexical search mode.',
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
      }
    );

    // POST /api/repositories/:owner/:repo/index
    fastify.post(
      '/api/repositories/:owner/:repo/index',
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
            suggestedAction: 'Ensure URL matches /api/repositories/:owner/:repo/index',
          };
          return reply.status(400).send(errorResponse);
        }

        let parsedBody;
        try {
          parsedBody = IndexRequestSchema.parse(request.body || {});
        } catch (err: unknown) {
          const message =
            err && typeof err === 'object' && 'issues' in err && Array.isArray((err as any).issues)
              ? (err as any).issues[0]?.message
              : 'Invalid index request payload.';

          const errorResponse: ApiError = {
            error: 'ValidationError',
            message: sanitizeErrorMessage(message),
            isRateLimit: false,
            suggestedAction: 'Provide a valid index request payload such as { "force": true }.',
          };
          return reply.status(400).send(errorResponse);
        }

        try {
          const statusResponse = await service.startIndexing(owner, repo, parsedBody);
          request.log.info(
            {
              event: 'indexing_requested',
              owner,
              repo,
              status: statusResponse.status,
              indexedChunks: statusResponse.indexedChunks,
            },
            'Repository indexing requested'
          );

          const statusCode = statusResponse.status === 'ready' ? 200 : 202;
          return reply.status(statusCode).send(statusResponse);
        } catch (err: unknown) {
          if (err instanceof RepositoryNotAnalyzedError) {
            const errorResponse: ApiError = {
              error: 'RepositoryNotAnalyzed',
              message: sanitizeErrorMessage(err.message),
              isRateLimit: false,
              suggestedAction:
                'Run POST /api/analyze for this repository before indexing.',
            };
            return reply.status(404).send(errorResponse);
          }

          fastify.log.error(err);

          const errorResponse: ApiError = {
            error: 'InternalError',
            message: sanitizeErrorMessage(
              err instanceof Error ? err.message : 'An internal error occurred while indexing.'
            ),
            isRateLimit: false,
            suggestedAction: 'Please retry shortly or inspect server logs for details.',
          };
          return reply.status(500).send(errorResponse);
        }
      }
    );

    // GET /api/repositories/:owner/:repo/index-status
    fastify.get(
      '/api/repositories/:owner/:repo/index-status',
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
            suggestedAction: 'Ensure URL matches /api/repositories/:owner/:repo/index-status',
          };
          return reply.status(400).send(errorResponse);
        }

        try {
          const statusResponse = await service.getIndexStatus(owner, repo);
          return reply.status(200).send(statusResponse);
        } catch (err: unknown) {
          if (err instanceof RepositoryNotAnalyzedError) {
            const errorResponse: ApiError = {
              error: 'RepositoryNotAnalyzed',
              message: sanitizeErrorMessage(err.message),
              isRateLimit: false,
              suggestedAction:
                'Run POST /api/analyze for this repository before checking index status.',
            };
            return reply.status(404).send(errorResponse);
          }

          fastify.log.error(err);

          const errorResponse: ApiError = {
            error: 'InternalError',
            message: sanitizeErrorMessage(
              err instanceof Error
                ? err.message
                : 'An internal error occurred while checking index status.'
            ),
            isRateLimit: false,
            suggestedAction: 'Please retry shortly or inspect server logs for details.',
          };
          return reply.status(500).send(errorResponse);
        }
      }
    );
  };
}

export const searchRoutes = createSearchRoutes();
