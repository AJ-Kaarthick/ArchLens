import type { FastifyRequest } from 'fastify';
import type { ApiError } from '@archlens/shared';

export interface RateLimitConfig {
  analyzeMax: number;
  executeMax: number;
  explainMax: number;
  searchMax: number;
  generalMax: number;
  timeWindowMs: number;
}

/**
 * Reads rate-limit configuration from environment variables with sensible production defaults.
 */
export function getRateLimitConfig(
  env: Record<string, string | undefined> = process.env
): RateLimitConfig {
  const parsePositiveInt = (value: string | undefined, defaultValue: number): number => {
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
  };

  return {
    analyzeMax: parsePositiveInt(env.RATE_LIMIT_ANALYZE_MAX, 10),
    executeMax: parsePositiveInt(env.RATE_LIMIT_EXECUTE_MAX, 10),
    explainMax: parsePositiveInt(env.RATE_LIMIT_EXPLAIN_MAX, 20),
    searchMax: parsePositiveInt(env.RATE_LIMIT_SEARCH_MAX, 30),
    generalMax: parsePositiveInt(env.RATE_LIMIT_GENERAL_MAX, 120),
    timeWindowMs: parsePositiveInt(env.RATE_LIMIT_TIME_WINDOW_MS, 60 * 1000), // default 1 minute
  };
}

/**
 * Standardized rate limit error response builder matching the ArchLens ApiError schema.
 * Note: statusCode: 429 must be present on the thrown object for Fastify to send HTTP 429.
 */
export function rateLimitErrorResponseBuilder(
  _req: FastifyRequest,
  context: { ttl: number; max: number; statusCode?: number }
): ApiError & { statusCode: number } {
  const retrySeconds = Math.max(1, Math.ceil(context.ttl / 1000));
  return {
    statusCode: context.statusCode || 429,
    error: 'RateLimitExceeded',
    message: `Rate limit of ${context.max} requests per window exceeded. Please retry in ${retrySeconds} seconds.`,
    isRateLimit: true,
    suggestedAction: 'Please reduce request frequency or wait for the rate limit window to reset.',
  };
}
