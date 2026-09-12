import type { FastifyPluginAsync } from 'fastify';
import { RepoInputSchema, parseGitHubRepo, type ApiError } from '@archlens/shared';
import { repositoryService, RepositoryService } from '../services/repository.service.js';
import {
  GitHubRateLimitError,
  GitHubNotFoundError,
  GitHubTreeTooLargeError,
} from '../services/github.service.js';

export function createRepositoryRoutes(customService?: RepositoryService): FastifyPluginAsync {
  const service = customService || repositoryService;

  return async (fastify) => {
    // 1. POST /api/analyze
    fastify.post('/api/analyze', async (request, reply) => {
      let owner: string;
      let repo: string;

      try {
        const parsed = RepoInputSchema.parse(request.body);
        owner = parsed.owner;
        repo = parsed.repo;
      } catch (err: unknown) {
        const message =
          err && typeof err === 'object' && 'issues' in err && Array.isArray((err as any).issues)
            ? (err as any).issues[0]?.message
            : "Invalid request payload. Expected 'url' or 'owner' and 'repo'.";

        const errorResponse: ApiError = {
          error: 'ValidationError',
          message,
          isRateLimit: false,
          suggestedAction:
            "Provide a valid repository format like 'owner/repo' or 'https://github.com/owner/repo'",
        };
        return reply.status(400).send(errorResponse);
      }

      try {
        const result = await service.analyze(owner, repo);
        return reply.status(200).send(result);
      } catch (err: unknown) {
        if (err instanceof GitHubRateLimitError) {
          const errorResponse: ApiError = {
            error: 'RateLimitExceeded',
            message: err.message,
            isRateLimit: true,
            suggestedAction: err.suggestedAction,
          };
          return reply.status(429).send(errorResponse);
        }

        if (err instanceof GitHubNotFoundError) {
          const errorResponse: ApiError = {
            error: 'NotFound',
            message: err.message,
            isRateLimit: false,
            suggestedAction:
              'Ensure the repository exists, is public, and the name is spelled correctly.',
          };
          return reply.status(404).send(errorResponse);
        }

        if (err instanceof GitHubTreeTooLargeError) {
          const errorResponse: ApiError = {
            error: 'TreeTooLarge',
            message: err.message,
            isRateLimit: false,
            suggestedAction: 'Repository exceeds bounded limit of 10,000 files.',
          };
          return reply.status(400).send(errorResponse);
        }

        const msg = err instanceof Error ? err.message : 'Internal analysis error';
        fastify.log.error(err);
        return reply.status(500).send({
          error: 'AnalysisError',
          message: msg,
          isRateLimit: false,
          suggestedAction: null,
        });
      }
    });

    // 2. GET /api/repository/latest-analysis
    fastify.get('/api/repository/latest-analysis', async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      let owner = query.owner;
      let repo = query.repo || query.name;

      if (!owner || !repo) {
        if (query.url) {
          const parsed = parseGitHubRepo(query.url);
          if (parsed) {
            owner = parsed.owner;
            repo = parsed.repo;
          }
        }
      }

      if (!owner || !repo) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: "Query parameters 'owner' and 'repo' (or 'url') are required.",
          isRateLimit: false,
          suggestedAction: null,
        });
      }

      try {
        const result = await service.getLatestAnalysis(owner, repo);
        if (!result) {
          return reply.status(404).send({
            error: 'NotFound',
            message: `No analysis found for repository '${owner}/${repo}'.`,
            isRateLimit: false,
            suggestedAction: 'Run POST /api/analyze first to ingest and analyze this repository.',
          });
        }
        return reply.status(200).send(result);
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({
          error: 'ServerError',
          message: 'Failed to retrieve analysis record.',
          isRateLimit: false,
          suggestedAction: null,
        });
      }
    });

    // 3. GET /api/repositories/recent
    fastify.get('/api/repositories/recent', async (request, reply) => {
      const query = request.query as { limit?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 10;

      try {
        const recents = await service.getRecentRepositories(Number.isNaN(limit) ? 10 : limit);
        return reply.status(200).send(recents);
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({
          error: 'ServerError',
          message: 'Failed to retrieve recent repositories.',
          isRateLimit: false,
          suggestedAction: null,
        });
      }
    });

    // 4. GET /api/repositories/:owner/:repo/latest
    fastify.get('/api/repositories/:owner/:repo/latest', async (request, reply) => {
      const { owner, repo } = request.params as { owner: string; repo: string };

      try {
        const result = await service.getLatestAnalysis(owner, repo);
        if (!result) {
          return reply.status(404).send({
            error: 'NotFound',
            message: `No analysis found for repository '${owner}/${repo}'.`,
            isRateLimit: false,
            suggestedAction: 'Run POST /api/analyze first to ingest and analyze this repository.',
          });
        }
        return reply.status(200).send(result);
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({
          error: 'ServerError',
          message: 'Failed to retrieve analysis record.',
          isRateLimit: false,
          suggestedAction: null,
        });
      }
    });

    // 4. GET /api/repositories/:owner/:repo/landmark-content
    fastify.get('/api/repositories/:owner/:repo/landmark-content', async (request, reply) => {
      const { owner, repo } = request.params as { owner: string; repo: string };
      const { path, ref } = request.query as { path?: string; ref?: string };

      if (!path) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: "Query parameter 'path' is required.",
          isRateLimit: false,
          suggestedAction: null,
        });
      }

      try {
        const content = await service.getLandmarkContent(owner, repo, path, ref);
        return reply.status(200).send(content);
      } catch (err: unknown) {
        if (err instanceof GitHubRateLimitError) {
          return reply.status(429).send({
            error: 'RateLimitExceeded',
            message: err.message,
            isRateLimit: true,
            suggestedAction: err.suggestedAction,
          });
        }

        if (err instanceof GitHubNotFoundError) {
          return reply.status(404).send({
            error: 'NotFound',
            message: err.message,
            isRateLimit: false,
            suggestedAction: null,
          });
        }

        const msg = err instanceof Error ? err.message : 'Failed to fetch landmark content';
        return reply.status(500).send({
          error: 'ContentFetchError',
          message: msg,
          isRateLimit: false,
          suggestedAction: null,
        });
      }
    });
  };
}
