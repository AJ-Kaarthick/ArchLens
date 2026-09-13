import { describe, it, expect } from 'vitest';
import { getRateLimitConfig, rateLimitErrorResponseBuilder } from './rate-limit.js';

describe('Rate Limit Config', () => {
  it('returns default limits when environment variables are not set', () => {
    const config = getRateLimitConfig({});
    expect(config.analyzeMax).toBe(10);
    expect(config.executeMax).toBe(10);
    expect(config.explainMax).toBe(20);
    expect(config.searchMax).toBe(30);
    expect(config.generalMax).toBe(120);
    expect(config.timeWindowMs).toBe(60000);
  });

  it('respects custom environment variable overrides', () => {
    const config = getRateLimitConfig({
      RATE_LIMIT_ANALYZE_MAX: '5',
      RATE_LIMIT_EXECUTE_MAX: '3',
      RATE_LIMIT_EXPLAIN_MAX: '15',
      RATE_LIMIT_SEARCH_MAX: '25',
      RATE_LIMIT_GENERAL_MAX: '200',
      RATE_LIMIT_TIME_WINDOW_MS: '30000',
    });
    expect(config.analyzeMax).toBe(5);
    expect(config.executeMax).toBe(3);
    expect(config.explainMax).toBe(15);
    expect(config.searchMax).toBe(25);
    expect(config.generalMax).toBe(200);
    expect(config.timeWindowMs).toBe(30000);
  });

  it('falls back to defaults if environment variables are invalid numbers', () => {
    const config = getRateLimitConfig({
      RATE_LIMIT_ANALYZE_MAX: 'invalid',
      RATE_LIMIT_EXECUTE_MAX: '-5',
      RATE_LIMIT_TIME_WINDOW_MS: '0',
    });
    expect(config.analyzeMax).toBe(10);
    expect(config.executeMax).toBe(10);
    expect(config.timeWindowMs).toBe(60000);
  });

  it('builds a standardized ApiError response shape for 429 errors', () => {
    const res = rateLimitErrorResponseBuilder({} as any, { ttl: 5500, max: 10 });
    expect(res.error).toBe('RateLimitExceeded');
    expect(res.isRateLimit).toBe(true);
    expect(res.message).toContain('10 requests');
    expect(res.message).toContain('6 seconds');
    expect(res.suggestedAction).toBeDefined();
  });
});
