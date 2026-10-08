import type { FastifyPluginAsync } from 'fastify';
import {
  ExplainRequestSchema,
  ExplainTopicSchema,
  InsightQuerySchema,
  InsightRetryBodySchema,
  type ApiError,
} from '@archlens/shared';
import { aiService, AIService, RepositoryNotAnalyzedError } from '../services/ai/ai.service.js';
import {
  AIRateLimitError,
  AITemporaryUnavailableError,
} from '../services/ai/provider.interface.js';
import { getRateLimitConfig, type RateLimitConfig } from '../config/rate-limit.js';
import { sanitizeErrorMessage } from '../services/ai/sanitize-error.js';

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
        const clientAbortController = new AbortController();
        const onClientClose = () => {
          if (!reply.raw.writableEnded && !reply.sent) {
            clientAbortController.abort();
          }
        };

        reply.raw.on('close', onClientClose);
        request.raw.socket?.on('close', onClientClose);

        try {
          const response = await service.explain(
            owner,
            repo,
            parsedRequest,
            clientAbortController.signal,
            request.log
          );
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
          const isAborted =
            clientAbortController.signal.aborted ||
            (err instanceof Error &&
              (err.name === 'AbortError' || err.message.toLowerCase().includes('aborted')));

          if (isAborted) {
            request.log.info(
              {
                event: 'ai_explanation_aborted',
                owner,
                repo,
                topic: parsedRequest.topic,
                durationMs: Date.now() - startTime,
              },
              'AI explanation request was aborted by client'
            );

            if (reply.raw.writableEnded || reply.sent) {
              return;
            }

            const errorResponse: ApiError = {
              error: 'ClientClosedRequest',
              message: 'AI explanation request was cancelled.',
              isRateLimit: false,
              suggestedAction: 'Request was cancelled due to topic switch or navigation.',
            };
            return reply.status(499).send(errorResponse);
          }

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
            message: sanitizeErrorMessage((err as any).message || 'AI provider rate limit or quota exceeded.'),
            isRateLimit: true,
            suggestedAction:
              (err as any).suggestedAction ||
              'Wait a moment before requesting another AI explanation, or switch to MockAIProvider.',
          };
          return reply.status(429).send(errorResponse);
        }

        if (
          err instanceof AITemporaryUnavailableError ||
          (err &&
            typeof err === 'object' &&
            'isTemporaryUnavailable' in err &&
            (err as any).isTemporaryUnavailable === true) ||
          (err && typeof err === 'object' && (err as any).status === 503)
        ) {
          const errorResponse: ApiError = {
            error: 'AITemporarilyUnavailable',
            message: sanitizeErrorMessage(
              (err as any).message ||
                'The AI explanation service is temporarily unavailable. Please try again shortly.'
            ),
            isRateLimit: false,
            suggestedAction:
              (err as any).suggestedAction ||
              'Wait a moment and click Refresh, or switch to MockAIProvider.',
          };
          return reply.status(503).send(errorResponse);
        }

        const clientStatus = (err as any)?.status;
        if (clientStatus === 400) {
          const errorResponse: ApiError = {
            error: 'InvalidAIRequest',
            message: sanitizeErrorMessage((err as any).message || 'Invalid AI request parameters.'),
            isRateLimit: false,
            suggestedAction: 'Check the repository structure or request parameters.',
          };
          return reply.status(400).send(errorResponse);
        }

        if (clientStatus === 401) {
          const errorResponse: ApiError = {
            error: 'AIAuthenticationError',
            message: 'AI provider authentication failed.',
            isRateLimit: false,
            suggestedAction: 'Verify that GEMINI_API_KEY is configured correctly.',
          };
          return reply.status(401).send(errorResponse);
        }

        if (clientStatus === 403) {
          const errorResponse: ApiError = {
            error: 'AIPermissionError',
            message: 'AI provider permission denied or content blocked by safety filters.',
            isRateLimit: false,
            suggestedAction: 'Check API key permissions or safety policy constraints.',
          };
          return reply.status(403).send(errorResponse);
        }

        fastify.log.error(err);

        const errorResponse: ApiError = {
          error: 'AIExplanationError',
          message: 'An internal error occurred while generating the AI explanation.',
          isRateLimit: false,
          suggestedAction: 'Please try again shortly or inspect server logs for details.',
        };
        return reply.status(500).send(errorResponse);
      } finally {
        reply.raw.removeListener('close', onClientClose);
        request.raw.socket?.removeListener('close', onClientClose);
      }
    });

    // GET /api/repositories/:owner/:repo/insights/:topic
    fastify.get(
      '/api/repositories/:owner/:repo/insights/:topic',
      {
        config: {
          rateLimit: {
            max: rateLimits.generalMax,
            timeWindow: rateLimits.timeWindowMs,
          },
        },
      },
      async (request, reply) => {
        const { owner, repo, topic } = request.params as {
          owner: string;
          repo: string;
          topic: string;
        };

        if (!owner || !repo || !topic) {
          const errorResponse: ApiError = {
            error: 'ValidationError',
            message: 'owner, repo, and topic path parameters are required.',
            isRateLimit: false,
            suggestedAction: 'Ensure URL matches /api/repositories/:owner/:repo/insights/:topic',
          };
          return reply.status(400).send(errorResponse);
        }

        const validTopic = ExplainTopicSchema.safeParse(topic);
        if (!validTopic.success) {
          const errorResponse: ApiError = {
            error: 'ValidationError',
            message: `Invalid topic '${topic}'.`,
            isRateLimit: false,
            suggestedAction:
              "Valid topics are 'overview', 'architecture', 'tech-stack', 'entrypoints'.",
          };
          return reply.status(400).send(errorResponse);
        }

        const parsedQuery = InsightQuerySchema.safeParse(request.query || {});
        if (!parsedQuery.success) {
          const firstIssue = parsedQuery.error.issues[0];
          const errorResponse: ApiError = {
            error: 'ValidationError',
            message: firstIssue
              ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
              : 'Invalid query parameters.',
            isRateLimit: false,
            suggestedAction: 'Ensure target does not exceed 200 chars and promptVersion is valid (1-5).',
          };
          return reply.status(400).send(errorResponse);
        }

        const target = parsedQuery.data.target ?? null;
        const { promptVersion, forceRetry } = parsedQuery.data;

        try {
          const response = await service.getOrEnqueueInsight(
            owner,
            repo,
            validTopic.data,
            target,
            promptVersion,
            forceRetry
          );
          return reply.status(200).send(response);
        } catch (err: unknown) {
          if (err instanceof RepositoryNotAnalyzedError) {
            const errorResponse: ApiError = {
              error: 'RepositoryNotAnalyzed',
              message: sanitizeErrorMessage(err.message),
              isRateLimit: false,
              suggestedAction:
                'Run POST /api/analyze for this repository before requesting AI insights.',
            };
            return reply.status(404).send(errorResponse);
          }

          fastify.log.error(err);
          const errorResponse: ApiError = {
            error: 'AIInsightError',
            message: sanitizeErrorMessage(
              err instanceof Error
                ? err.message
                : 'An internal error occurred while resolving AI insights.'
            ),
            isRateLimit: false,
            suggestedAction: 'Please try again shortly or inspect server logs for details.',
          };
          return reply.status(500).send(errorResponse);
        }
      }
    );

    // POST /api/repositories/:owner/:repo/insights/:topic/retry
    fastify.post(
      '/api/repositories/:owner/:repo/insights/:topic/retry',
      {
        config: {
          rateLimit: {
            max: rateLimits.explainMax,
            timeWindow: rateLimits.timeWindowMs,
          },
        },
      },
      async (request, reply) => {
        const { owner, repo, topic } = request.params as {
          owner: string;
          repo: string;
          topic: string;
        };

        const validTopic = ExplainTopicSchema.safeParse(topic);
        if (!validTopic.success) {
          const errorResponse: ApiError = {
            error: 'ValidationError',
            message: `Invalid topic '${topic}'.`,
            isRateLimit: false,
            suggestedAction:
              "Valid topics are 'overview', 'architecture', 'tech-stack', 'entrypoints'.",
          };
          return reply.status(400).send(errorResponse);
        }

        const parsedBody = InsightRetryBodySchema.safeParse(request.body || {});
        if (!parsedBody.success) {
          const firstIssue = parsedBody.error.issues[0];
          const errorResponse: ApiError = {
            error: 'ValidationError',
            message: firstIssue
              ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
              : 'Invalid request payload.',
            isRateLimit: false,
            suggestedAction: 'Ensure target does not exceed 200 chars and promptVersion is valid (1-5).',
          };
          return reply.status(400).send(errorResponse);
        }

        const target = parsedBody.data.target ?? null;
        const { promptVersion } = parsedBody.data;

        try {
          const response = await service.getOrEnqueueInsight(
            owner,
            repo,
            validTopic.data,
            target,
            promptVersion,
            true
          );
          return reply.status(200).send(response);
        } catch (err: unknown) {
          if (err instanceof RepositoryNotAnalyzedError) {
            const errorResponse: ApiError = {
              error: 'RepositoryNotAnalyzed',
              message: sanitizeErrorMessage(err.message),
              isRateLimit: false,
              suggestedAction:
                'Run POST /api/analyze for this repository before requesting AI insights.',
            };
            return reply.status(404).send(errorResponse);
          }

          fastify.log.error(err);
          const errorResponse: ApiError = {
            error: 'AIInsightError',
            message: sanitizeErrorMessage(
              err instanceof Error
                ? err.message
                : 'An internal error occurred while retrying AI insight.'
            ),
            isRateLimit: false,
            suggestedAction: 'Please try again shortly.',
          };
          return reply.status(500).send(errorResponse);
        }
      }
    );
  };
}
