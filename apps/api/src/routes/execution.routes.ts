import fs from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { ExecutionRequestSchema, type ApiError } from '@archlens/shared';
import { executionService, ExecutionService } from '../services/sandbox/execution.service.js';
import { workspaceManager, WorkspaceManager } from '../services/sandbox/workspace-manager.js';
import { STATIC_PREVIEW_CSP } from '../services/sandbox/policy.js';

export function createExecutionRoutes(
  customService?: ExecutionService,
  customWsManager?: WorkspaceManager
): FastifyPluginAsync {
  const service = customService || executionService;
  const wsManager = customWsManager || workspaceManager;

  return async (fastify) => {
    // 1. GET /api/repositories/:owner/:repo/eligibility
    fastify.get<{
      Params: { owner: string; repo: string };
    }>('/api/repositories/:owner/:repo/eligibility', async (request, reply) => {
      const { owner, repo } = request.params;
      if (!owner || !repo) {
        const errorResponse: ApiError = {
          error: 'ValidationError',
          message: 'Both owner and repo parameters are required.',
          isRateLimit: false,
          suggestedAction: 'Specify a valid repository owner and name in the URL.',
        };
        return reply.status(400).send(errorResponse);
      }

      try {
        const eligibility = await service.getEligibility(owner, repo);
        return reply.status(200).send(eligibility);
      } catch (err: unknown) {
        const errorResponse: ApiError = {
          error: 'InternalError',
          message: (err as Error).message || 'Failed to determine execution eligibility.',
          isRateLimit: false,
          suggestedAction: 'Retry the request or re-analyze the repository.',
        };
        return reply.status(500).send(errorResponse);
      }
    });

    // 2. POST /api/repositories/:owner/:repo/execute
    fastify.post<{
      Params: { owner: string; repo: string };
    }>('/api/repositories/:owner/:repo/execute', async (request, reply) => {
      const { owner, repo } = request.params;
      if (!owner || !repo) {
        const errorResponse: ApiError = {
          error: 'ValidationError',
          message: 'Both owner and repo parameters are required.',
          isRateLimit: false,
          suggestedAction: 'Specify a valid repository owner and name in the URL.',
        };
        return reply.status(400).send(errorResponse);
      }

      let execRequest = {};
      if (request.body) {
        try {
          execRequest = ExecutionRequestSchema.parse(request.body);
        } catch (err: unknown) {
          const message =
            err && typeof err === 'object' && 'issues' in err && Array.isArray((err as any).issues)
              ? (err as any).issues[0]?.message
              : 'Invalid execution request payload.';

          const errorResponse: ApiError = {
            error: 'ValidationError',
            message,
            isRateLimit: false,
            suggestedAction: 'Ensure request body conforms to execution schema.',
          };
          return reply.status(400).send(errorResponse);
        }
      }

      try {
        const result = await service.execute(owner, repo, execRequest);
        return reply.status(200).send(result);
      } catch (err: unknown) {
        const errorResponse: ApiError = {
          error: 'InternalError',
          message: (err as Error).message || 'Execution failed unexpectedly.',
          isRateLimit: false,
          suggestedAction: 'Check repository entrypoints and retry.',
        };
        return reply.status(500).send(errorResponse);
      }
    });

    const servePreview = async (
      executionId: string,
      subPath: string,
      reply: any
    ) => {
      const resolved = await wsManager.resolvePreviewFile(executionId, subPath);
      if (!resolved) {
        return reply.status(404).send({
          error: 'NotFound',
          message: 'Preview file not found, expired, or path traversal rejected.',
        });
      }

      reply
        .header('Content-Type', resolved.mimeType)
        .header('Content-Security-Policy', STATIC_PREVIEW_CSP)
        .header('X-Content-Type-Options', 'nosniff')
        .header('X-Frame-Options', 'SAMEORIGIN')
        .header('Cache-Control', 'no-cache, no-store, must-revalidate');

      const stream = fs.createReadStream(resolved.absolutePath);
      return reply.send(stream);
    };

    // 3. Repository-scoped preview endpoints
    fastify.get<{
      Params: { owner: string; repo: string; executionId: string };
    }>('/api/repositories/:owner/:repo/preview/:executionId', async (request, reply) => {
      const { owner, repo, executionId } = request.params;
      return reply.redirect(
        `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/preview/${encodeURIComponent(executionId)}/index.html`
      );
    });

    fastify.get<{
      Params: { owner: string; repo: string; executionId: string; '*': string };
    }>('/api/repositories/:owner/:repo/preview/:executionId/*', async (request, reply) => {
      const { executionId } = request.params;
      const subPath = request.params['*'] || 'index.html';
      return servePreview(executionId, subPath, reply);
    });

    // 4. Global preview endpoints (aliases for client-agnostic embedding)
    fastify.get<{
      Params: { executionId: string };
    }>('/api/preview/:executionId', async (request, reply) => {
      const { executionId } = request.params;
      return reply.redirect(`/api/preview/${encodeURIComponent(executionId)}/index.html`);
    });

    fastify.get<{
      Params: { executionId: string; '*': string };
    }>('/api/preview/:executionId/*', async (request, reply) => {
      const { executionId } = request.params;
      const subPath = request.params['*'] || 'index.html';
      return servePreview(executionId, subPath, reply);
    });
  };
}

