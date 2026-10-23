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
import { ExplanationRunner, explanationRunner } from './services/ai/explanation-runner.js';
import { createSearchRoutes } from './routes/search.routes.js';
import { RetrievalService } from './services/retrieval/retrieval.service.js';
import { createExecutionRoutes } from './routes/execution.routes.js';
import { ExecutionService } from './services/sandbox/execution.service.js';
import { WorkspaceManager, workspaceManager } from './services/sandbox/workspace-manager.js';
import { ProcessSandboxRunner, processSandboxRunner } from './services/sandbox/process-runner.js';
import { createCapabilitiesRoutes } from './routes/capabilities.routes.js';
import {
  getRateLimitConfig,
  rateLimitErrorResponseBuilder,
  type RateLimitConfig,
} from './config/rate-limit.js';
import { isUnsafeDevSandboxEnabled } from './services/sandbox/policy.js';

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
        'geminiFallbackApiKey',
        'fallbackApiKey',
        'geminiTertiaryApiKey',
        'tertiaryApiKey',
        'aiFallbackApiKey',
        'openaiApiKey',
        'DATABASE_URL',
        '*.token',
        '*.apiKey',
        '*.password',
        '*.secret',
        '*.geminiFallbackApiKey',
        '*.fallbackApiKey',
        '*.tertiaryApiKey',
        '*.aiFallbackApiKey',
        '*.openaiApiKey',
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

/**
 * Safely parses the trustProxy configuration for Fastify.
 *
 * Security & Network Boundary Design:
 * - When unset: Defaults to ['loopback', 'linklocal', 'uniquelocal'].
 *   This trusts reverse proxies running on localhost, private Docker bridge networks (172.16.0.0/12),
 *   and internal subnets (10.0.0.0/8, 192.168.0.0/16).
 *   If exposed directly to the public internet, requests from public client IPs are NOT trusted proxies,
 *   so spoofed X-Forwarded-For headers from untrusted clients are safely ignored.
 * - When behind Nginx (as in docker-compose.yml): Fastify trusts Nginx's internal container IP, extracts
 *   the true client IP from X-Forwarded-For, and isolates rate limits per client.
 * - Explicit override: TRUST_PROXY can be set to 'false' (disabled), 'true' (trust all hops),
 *   a number (e.g. 1 hop), or a custom comma-separated list of CIDR subnets.
 */
export function parseTrustProxy(
  envVal: string | undefined = process.env.TRUST_PROXY
): FastifyServerOptions['trustProxy'] {
  if (envVal === undefined || envVal === '') {
    return ['loopback', 'linklocal', 'uniquelocal'];
  }

  const trimmed = envVal.trim().toLowerCase();
  if (trimmed === 'false' || trimmed === '0' || trimmed === 'off' || trimmed === 'no') {
    return false;
  }
  if (trimmed === 'true' || trimmed === 'yes' || trimmed === 'on') {
    return true;
  }

  const num = parseInt(trimmed, 10);
  if (!Number.isNaN(num) && String(num) === trimmed && num >= 0) {
    return num;
  }

  return envVal
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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
  trustProxy?: FastifyServerOptions['trustProxy'];
  enableUnsafeDevSandbox?: boolean;
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

  const trustProxy =
    options.trustProxy !== undefined ? options.trustProxy : parseTrustProxy();

  const app = Fastify({
    logger: loggerOption,
    trustProxy,
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
  app.register(createCapabilitiesRoutes({ enableUnsafeDevSandbox: options.enableUnsafeDevSandbox }));

  // Gating of execution and preview routes (disabled by default in all environments)
  const isSandboxActive =
    options.enableUnsafeDevSandbox !== undefined
      ? options.enableUnsafeDevSandbox
      : isUnsafeDevSandboxEnabled();

  if (isSandboxActive) {
    app.log.warn(
      '⚠️ CRITICAL SECURITY WARNING: Unsafe development sandbox is ENABLED (ENABLE_UNSAFE_DEV_SANDBOX=yes). ' +
        'Host-process Node execution is active without kernel-level container/cgroup isolation. ' +
        'DO NOT execute untrusted or hostile code in this environment!'
    );
    app.register(
      createExecutionRoutes(options.executionService, options.workspaceManager, rateLimitCfg)
    );
  } else {
    app.log.info(
      'Host sandbox execution and preview routes are disabled (default secure containment).'
    );
  }

  return app;
}

export interface GracefulShutdownOptions {
  app: FastifyInstance;
  signal?: string;
  timeoutMs?: number;
  wsManager?: WorkspaceManager;
  processRunner?: ProcessSandboxRunner;
  explanationRunner?: ExplanationRunner;
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
    explanationRunner: expRunner = explanationRunner,
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

    // 2. Abort active explanation generation jobs and clear queue
    expRunner.abortAll();
    app.log.info('In-flight explanation jobs aborted');

    // 3. Clean up active preview workspaces
    await wsManager.cleanupAllWorkspaces();
    app.log.info('Execution workspaces cleaned up');

    // 4. Terminate running sandbox processes
    await processRunner.terminateAllProcesses();
    app.log.info('Active sandbox processes terminated');

    // 5. Close database connection pool
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

    // Recover stale pending explanation jobs interrupted by previous server runs
    try {
      const recoveredCount = await explanationRunner.recoverStalePendingJobs();
      if (recoveredCount > 0) {
        app.log.info({ recoveredCount }, 'Recovered stale pending explanation jobs');
      }
    } catch (recoverErr) {
      app.log.warn({ err: recoverErr }, 'Failed to recover stale pending explanation jobs');
    }

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
