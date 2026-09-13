import './config/env.js';
import { randomUUID } from 'node:crypto';
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { checkDbConnection, closeDbConnection } from './db/index.js';
import { createHealthRoutes } from './routes/health.routes.js';
import { createRepositoryRoutes } from './routes/repository.routes.js';
import { RepositoryService } from './services/repository.service.js';
import { createAiRoutes } from './routes/ai.routes.js';
import { AIService } from './services/ai/ai.service.js';
import { createSearchRoutes } from './routes/search.routes.js';
import { RetrievalService } from './services/retrieval/retrieval.service.js';
import { createExecutionRoutes } from './routes/execution.routes.js';
import { ExecutionService } from './services/sandbox/execution.service.js';
import { WorkspaceManager, workspaceManager } from './services/sandbox/workspace-manager.js';
import { ProcessSandboxRunner, processSandboxRunner } from './services/sandbox/process-runner.js';
import {
  getRateLimitConfig,
  rateLimitErrorResponseBuilder,
  type RateLimitConfig,
} from './config/rate-limit.js';

/**
 * Creates structured Pino logger configuration with strict security redaction rules.
 * Never leaks API keys, GitHub tokens, cookies, authorization headers, passwords, or secrets.
 */
export function createLoggerConfig(
  env: Record<string, string | undefined> = process.env
): FastifyServerOptions['logger'] {
  const level = env.LOG_LEVEL || (env.NODE_ENV === 'test' ? 'silent' : 'info');

  return {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'req.headers["github-token"]',
        'req.headers["gemini-api-key"]',
        'headers.authorization',
        'headers.cookie',
        'headers["x-api-key"]',
        'headers["github-token"]',
        'headers["gemini-api-key"]',
        'token',
        'apiKey',
        'password',
        'secret',
        'githubToken',
        'geminiApiKey',
        'DATABASE_URL',
        '*.token',
        '*.apiKey',
        '*.password',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req(req: any) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
          path: req.routerPath,
          remoteAddress: req.ip,
        };
      },
      res(res: any) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  };
}

export interface BuildAppOptions {
  logger?: boolean | FastifyServerOptions['logger'];
  rateLimitConfig?: RateLimitConfig;
  repositoryService?: RepositoryService;
  aiService?: AIService;
  retrievalService?: RetrievalService;
  executionService?: ExecutionService;
  workspaceManager?: WorkspaceManager;
  checkDb?: () => Promise<boolean>;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const loggerOption =
    options.logger === undefined
      ? createLoggerConfig()
      : options.logger === true
        ? createLoggerConfig()
        : options.logger === false
          ? false
          : options.logger;

  const app = Fastify({
    logger: loggerOption,
    genReqId(req) {
      return (req.headers['x-request-id'] as string) || randomUUID();
    },
    requestIdHeader: 'x-request-id',
  });

  // Attach correlation ID to every HTTP response
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  const rateLimitCfg = options.rateLimitConfig || getRateLimitConfig();

  // In-memory rate limiter suitable for current single-instance deployment
  app.register(rateLimit, {
    global: true,
    max: rateLimitCfg.generalMax,
    timeWindow: rateLimitCfg.timeWindowMs,
    errorResponseBuilder: rateLimitErrorResponseBuilder,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  // Health check probes (rate limiting disabled on these routes)
  app.register(createHealthRoutes({ checkDb: options.checkDb }));

  // Application domain routes
  app.register(createRepositoryRoutes(options.repositoryService, rateLimitCfg));
  app.register(createAiRoutes(options.aiService, rateLimitCfg));
  app.register(createSearchRoutes(options.retrievalService, rateLimitCfg));
  app.register(
    createExecutionRoutes(options.executionService, options.workspaceManager, rateLimitCfg)
  );

  return app;
}

export interface GracefulShutdownOptions {
  app: FastifyInstance;
  signal?: string;
  timeoutMs?: number;
  wsManager?: WorkspaceManager;
  processRunner?: ProcessSandboxRunner;
  closeDb?: (timeoutSeconds?: number) => Promise<void>;
  exitProcess?: boolean;
}

let isShuttingDown = false;

/**
 * Executes a clean, bounded shutdown procedure.
 * Stops accepting requests, closes Fastify, terminates sandbox processes, cleans workspaces, and closes DB pool.
 */
export async function gracefulShutdown(options: GracefulShutdownOptions): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const {
    app,
    signal = 'SIGTERM',
    timeoutMs = 10000,
    wsManager = workspaceManager,
    processRunner = processSandboxRunner,
    closeDb = closeDbConnection,
    exitProcess = true,
  } = options;

  app.log.info({ signal }, 'Graceful shutdown initiated');

  const forceExitTimer = setTimeout(() => {
    app.log.error({ timeoutMs }, 'Graceful shutdown timed out, forcing exit');
    if (exitProcess) {
      process.exit(1);
    }
  }, timeoutMs);

  if (forceExitTimer.unref) {
    forceExitTimer.unref();
  }

  try {
    // 1. Close HTTP server and wait for in-flight requests to complete
    await app.close();
    app.log.info('HTTP server closed');

    // 2. Clean up active preview workspaces
    await wsManager.cleanupAllWorkspaces();
    app.log.info('Execution workspaces cleaned up');

    // 3. Terminate running sandbox processes
    await processRunner.terminateAllProcesses();
    app.log.info('Active sandbox processes terminated');

    // 4. Close database connection pool
    await closeDb(5);
    app.log.info('Database connection pool closed');

    clearTimeout(forceExitTimer);
    app.log.info('Graceful shutdown completed successfully');

    if (exitProcess) {
      process.exit(0);
    }
  } catch (err) {
    clearTimeout(forceExitTimer);
    app.log.error({ err }, 'Error occurred during graceful shutdown');
    if (exitProcess) {
      process.exit(1);
    }
    throw err;
  } finally {
    isShuttingDown = false;
  }
}

/**
 * Registers OS signal listeners for SIGTERM and SIGINT.
 */
export function registerShutdownHandlers(app: FastifyInstance): void {
  const handler = (signal: string) => {
    gracefulShutdown({ app, signal }).catch(() => {});
  };

  process.once('SIGTERM', () => handler('SIGTERM'));
  process.once('SIGINT', () => handler('SIGINT'));
}

const start = async () => {
  const app = buildApp();

  try {
    await checkDbConnection();
    app.log.info('Database connection verified');

    registerShutdownHandlers(app);

    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || '0.0.0.0';

    await app.listen({ port, host });
    app.log.info(`ArchLens API running on http://${host}:${port}`);
  } catch (err) {
    app.log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
};

// If run directly
if (
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') ||
    process.argv[1].endsWith('server.js') ||
    process.argv[1].includes('tsx'))
) {
  start();
}
