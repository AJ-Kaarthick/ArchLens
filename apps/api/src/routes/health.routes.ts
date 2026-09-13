import type { FastifyPluginAsync } from 'fastify';
import { ARCHLENS_VERSION } from '@archlens/shared';
import { checkDbConnection } from '../db/index.js';

export interface HealthCheckOptions {
  checkDb?: () => Promise<boolean>;
}

export function createHealthRoutes(options: HealthCheckOptions = {}): FastifyPluginAsync {
  const checkDb = options.checkDb || checkDbConnection;

  return async (fastify) => {
    // 1. Backward-compatible /health endpoint
    fastify.get(
      '/health',
      { config: { rateLimit: false } },
      async () => {
        return {
          status: 'ok',
          version: ARCHLENS_VERSION,
        };
      }
    );

    // 2. Liveness probe: verifies only that the Node process is running
    fastify.get(
      '/health/liveness',
      { config: { rateLimit: false } },
      async () => {
        return {
          status: 'ok',
          check: 'liveness',
          version: ARCHLENS_VERSION,
          uptime: process.uptime(),
        };
      }
    );

    // 3. Readiness probe: verifies database connectivity
    fastify.get(
      '/health/readiness',
      { config: { rateLimit: false } },
      async (_request, reply) => {
        try {
          const isConnected = await checkDb();
          if (!isConnected) {
            return reply.status(503).send({
              status: 'unavailable',
              check: 'readiness',
              database: 'disconnected',
              error: 'Database unavailable',
            });
          }

          return reply.status(200).send({
            status: 'ready',
            check: 'readiness',
            database: 'connected',
            version: ARCHLENS_VERSION,
          });
        } catch {
          // Strictly avoid leaking raw database error or connection string details to clients
          return reply.status(503).send({
            status: 'unavailable',
            check: 'readiness',
            database: 'disconnected',
            error: 'Database unavailable',
          });
        }
      }
    );
  };
}
