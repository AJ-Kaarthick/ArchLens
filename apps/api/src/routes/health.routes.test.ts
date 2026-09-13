import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { ARCHLENS_VERSION } from '@archlens/shared';
import { createHealthRoutes } from './health.routes.js';

describe('Health Routes', () => {
  it('GET /health returns 200 with status ok and version', async () => {
    const app = Fastify();
    await app.register(createHealthRoutes());

    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      status: 'ok',
      version: ARCHLENS_VERSION,
    });
  });

  it('GET /health/liveness returns 200 and does not require database', async () => {
    // Failing db check should not affect liveness
    const app = Fastify();
    await app.register(
      createHealthRoutes({
        checkDb: async () => {
          throw new Error('Database connection failed');
        },
      })
    );

    const res = await app.inject({
      method: 'GET',
      url: '/health/liveness',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.check).toBe('liveness');
    expect(body.version).toBe(ARCHLENS_VERSION);
    expect(typeof body.uptime).toBe('number');
  });

  it('GET /health/readiness returns 200 when database connection check succeeds', async () => {
    const app = Fastify();
    await app.register(
      createHealthRoutes({
        checkDb: async () => true,
      })
    );

    const res = await app.inject({
      method: 'GET',
      url: '/health/readiness',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      status: 'ready',
      check: 'readiness',
      database: 'connected',
      version: ARCHLENS_VERSION,
    });
  });

  it('GET /health/readiness returns 503 when database check returns false', async () => {
    const app = Fastify();
    await app.register(
      createHealthRoutes({
        checkDb: async () => false,
      })
    );

    const res = await app.inject({
      method: 'GET',
      url: '/health/readiness',
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body).toEqual({
      status: 'unavailable',
      check: 'readiness',
      database: 'disconnected',
      error: 'Database unavailable',
    });
    // Ensure no stack trace or sensitive info leaked
    expect(body.stack).toBeUndefined();
    expect(body.message).toBeUndefined();
  });

  it('GET /health/readiness returns 503 when database check throws an error without leaking details', async () => {
    const app = Fastify();
    await app.register(
      createHealthRoutes({
        checkDb: async () => {
          throw new Error('FATAL: password authentication failed for user "postgres"');
        },
      })
    );

    const res = await app.inject({
      method: 'GET',
      url: '/health/readiness',
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body).toEqual({
      status: 'unavailable',
      check: 'readiness',
      database: 'disconnected',
      error: 'Database unavailable',
    });
    expect(JSON.stringify(body)).not.toContain('password authentication');
  });

  it('preserves existing application version "0.1.0" consistently across health endpoints', async () => {
    expect(ARCHLENS_VERSION).toBe('0.1.0');
    const app = Fastify();
    await app.register(
      createHealthRoutes({
        checkDb: async () => true,
      })
    );

    const resHealth = await app.inject({ method: 'GET', url: '/health' });
    expect(resHealth.statusCode).toBe(200);
    expect(resHealth.json().version).toBe('0.1.0');

    const resLiveness = await app.inject({ method: 'GET', url: '/health/liveness' });
    expect(resLiveness.statusCode).toBe(200);
    expect(resLiveness.json().version).toBe('0.1.0');

    const resReadiness = await app.inject({ method: 'GET', url: '/health/readiness' });
    expect(resReadiness.statusCode).toBe(200);
    expect(resReadiness.json().version).toBe('0.1.0');
  });
});
