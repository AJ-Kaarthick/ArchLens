import './config/env.js';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { ARCHLENS_VERSION } from '@archlens/shared';
import { initDb } from './db/index.js';
import { createRepositoryRoutes } from './routes/repository.routes.js';
import { RepositoryService } from './services/repository.service.js';
import { createAiRoutes } from './routes/ai.routes.js';
import { AIService } from './services/ai/ai.service.js';
import { createSearchRoutes } from './routes/search.routes.js';
import { RetrievalService } from './services/retrieval/retrieval.service.js';
import { createExecutionRoutes } from './routes/execution.routes.js';
import { ExecutionService } from './services/sandbox/execution.service.js';
import { WorkspaceManager } from './services/sandbox/workspace-manager.js';

export function buildApp(
  options: {
    logger?: boolean;
    repositoryService?: RepositoryService;
    aiService?: AIService;
    retrievalService?: RetrievalService;
    executionService?: ExecutionService;
    workspaceManager?: WorkspaceManager;
  } = {}
): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  app.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.get('/health', async () => {
    return { status: 'ok', version: ARCHLENS_VERSION };
  });

  app.register(createRepositoryRoutes(options.repositoryService));
  app.register(createAiRoutes(options.aiService));
  app.register(createSearchRoutes(options.retrievalService));
  app.register(createExecutionRoutes(options.executionService, options.workspaceManager));

  return app;
}

const start = async () => {
  try {
    await initDb();
    console.log('Database initialized successfully');

    const app = buildApp({ logger: true });
    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || '0.0.0.0';

    await app.listen({ port, host });
    console.log(`ArchLens API running on http://${host}:${port}`);
  } catch (err) {
    console.error('Failed to start server:', err);
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
