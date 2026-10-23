import type { FastifyPluginAsync } from 'fastify';
import type { ServerCapabilities } from '@archlens/shared';
import { AIProviderFactory } from '../services/ai/provider.factory.js';
import { isUnsafeDevSandboxEnabled } from '../services/sandbox/policy.js';

export function createCapabilitiesRoutes(options?: {
  enableUnsafeDevSandbox?: boolean;
}): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get('/api/capabilities', async (_request, reply) => {
      const isSandboxActive =
        options?.enableUnsafeDevSandbox !== undefined
          ? options.enableUnsafeDevSandbox
          : isUnsafeDevSandboxEnabled();

      const capabilities: ServerCapabilities = {
        ai: AIProviderFactory.isConfigured(),
        execution: isSandboxActive,
        semanticIndex: Boolean(process.env.GEMINI_API_KEY),
      };

      return reply.status(200).send(capabilities);
    });
  };
}
