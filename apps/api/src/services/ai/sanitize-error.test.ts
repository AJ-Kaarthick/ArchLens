import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sanitizeErrorMessage } from './sanitize-error.js';

describe('sanitizeErrorMessage', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'AIzaSyA_TEST_GEMINI_KEY_SECRET_987654';
    process.env.GITHUB_TOKEN = 'ghp_TEST_GITHUB_SECRET_TOKEN_1234567890';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('redacts active env secrets', () => {
    const raw = `Request failed using key ${process.env.GEMINI_API_KEY} and token ${process.env.GITHUB_TOKEN}`;
    const sanitized = sanitizeErrorMessage(raw);
    expect(sanitized).not.toContain(process.env.GEMINI_API_KEY);
    expect(sanitized).not.toContain(process.env.GITHUB_TOKEN);
    expect(sanitized).toContain('[REDACTED]');
  });

  it('redacts Google API key patterns (AIza...)', () => {
    const raw = 'Failed to fetch from https://generativelanguage.googleapis.com?key=AIzaSyD1234567890123456789012345678901';
    const sanitized = sanitizeErrorMessage(raw);
    expect(sanitized).not.toContain('AIzaSyD1234567890123456789012345678901');
    expect(sanitized).toContain('[REDACTED');
  });

  it('redacts GitHub token patterns (ghp_ and github_pat_)', () => {
    const raw1 = 'Authentication failed with ghp_111122223333444455556666777788889999';
    expect(sanitizeErrorMessage(raw1)).not.toContain('ghp_111122223333444455556666777788889999');
    expect(sanitizeErrorMessage(raw1)).toContain('[REDACTED_TOKEN]');

    const raw2 = 'Pat error: github_pat_11AAAAAAA22222222333333334444444455555555666666667777777788888888999999990000000011';
    expect(sanitizeErrorMessage(raw2)).not.toContain('github_pat_');
    expect(sanitizeErrorMessage(raw2)).toContain('[REDACTED_TOKEN]');
  });

  it('redacts Bearer authorization tokens', () => {
    const raw = 'Failed upstream request: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz';
    const sanitized = sanitizeErrorMessage(raw);
    expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz');
    expect(sanitized).toContain('Bearer [REDACTED]');
  });

  it('redacts secret query parameters in URLs', () => {
    const raw = 'Error communicating with https://api.example.com/v1?apiKey=mysecretkey123&other=val';
    const sanitized = sanitizeErrorMessage(raw);
    expect(sanitized).not.toContain('mysecretkey123');
    expect(sanitized).toContain('apiKey=[REDACTED]');
  });

  it('gracefully handles non-string or empty errors', () => {
    expect(sanitizeErrorMessage(null)).toBe('Unknown error');
    expect(sanitizeErrorMessage(undefined)).toBe('Unknown error');
    expect(sanitizeErrorMessage(new Error('Normal operational timeout'))).toBe('Normal operational timeout');
  });
});
