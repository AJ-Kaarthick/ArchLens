import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { ServerCapabilitiesSchema } from '@archlens/shared';
import { createCapabilitiesRoutes } from './capabilities.routes.js';

describe('Capabilities Routes', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.ENABLE_UNSAFE_DEV_SANDBOX;
    delete process.env.ENABLE_SANDBOX;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('GET /api/capabilities returns 200 and matches ServerCapabilitiesSchema', async () => {
    const app = Fastify();
    await app.register(createCapabilitiesRoutes());

    const res = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const parsed = ServerCapabilitiesSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it('reports execution disabled by default', async () => {
    const app = Fastify();
    await app.register(createCapabilitiesRoutes());

    const res = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.execution).toBe(false);
  });

  it('reports execution enabled when enableUnsafeDevSandbox option is true', async () => {
    const app = Fastify();
    await app.register(createCapabilitiesRoutes({ enableUnsafeDevSandbox: true }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.execution).toBe(true);
  });

  it('reports execution enabled when ENABLE_UNSAFE_DEV_SANDBOX env var is set', async () => {
    process.env.ENABLE_UNSAFE_DEV_SANDBOX = 'yes';
    const app = Fastify();
    await app.register(createCapabilitiesRoutes());

    const res = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.execution).toBe(true);
  });

  it('reports execution disabled when explicit option is false even if env is set', async () => {
    process.env.ENABLE_UNSAFE_DEV_SANDBOX = 'yes';
    const app = Fastify();
    await app.register(createCapabilitiesRoutes({ enableUnsafeDevSandbox: false }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/capabilities',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.execution).toBe(false);
  });
});
