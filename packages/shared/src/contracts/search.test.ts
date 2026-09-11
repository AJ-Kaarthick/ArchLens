import { describe, it, expect } from 'vitest';
import { SearchQuerySchema, SearchResultItemSchema, SearchResponseSchema } from './search.js';

describe('Search Contracts', () => {
  describe('SearchQuerySchema', () => {
    it('validates a correct search query with defaults', () => {
      const parsed = SearchQuerySchema.parse({ query: 'rate limiting middleware' });
      expect(parsed.query).toBe('rate limiting middleware');
      expect(parsed.limit).toBe(5);
      expect(parsed.pathPrefix).toBeUndefined();
      expect(parsed.category).toBeUndefined();
    });

    it('trims whitespace and accepts valid limit and filters', () => {
      const parsed = SearchQuerySchema.parse({
        query: '   database connection pool   ',
        limit: 10,
        pathPrefix: 'apps/api/src',
        category: 'source',
      });
      expect(parsed.query).toBe('database connection pool');
      expect(parsed.limit).toBe(10);
      expect(parsed.pathPrefix).toBe('apps/api/src');
      expect(parsed.category).toBe('source');
    });

    it('rejects query with fewer than 2 characters', () => {
      expect(() => SearchQuerySchema.parse({ query: 'a' })).toThrow();
      expect(() => SearchQuerySchema.parse({ query: '' })).toThrow();
    });

    it('rejects query exceeding 300 characters', () => {
      expect(() => SearchQuerySchema.parse({ query: 'a'.repeat(301) })).toThrow();
    });

    it('rejects limit out of range (< 1 or > 20)', () => {
      expect(() => SearchQuerySchema.parse({ query: 'valid', limit: 0 })).toThrow();
      expect(() => SearchQuerySchema.parse({ query: 'valid', limit: 21 })).toThrow();
    });

    it('rejects invalid file category', () => {
      expect(() =>
        SearchQuerySchema.parse({ query: 'valid', category: 'invalid-category' as any })
      ).toThrow();
    });
  });

  describe('SearchResultItemSchema', () => {
    it('validates a valid search result item', () => {
      const item = {
        filePath: 'apps/api/src/server.ts',
        chunkIndex: 0,
        startLine: 1,
        endLine: 45,
        content: 'import Fastify from "fastify";',
        score: 0.89,
        language: 'TypeScript',
        category: 'source' as const,
      };
      const parsed = SearchResultItemSchema.parse(item);
      expect(parsed.filePath).toBe('apps/api/src/server.ts');
      expect(parsed.score).toBe(0.89);
      expect(parsed.language).toBe('TypeScript');
    });

    it('rejects score out of range (< 0 or > 1)', () => {
      expect(() =>
        SearchResultItemSchema.parse({
          filePath: 'file.ts',
          chunkIndex: 0,
          startLine: 1,
          endLine: 10,
          content: 'test',
          score: 1.5,
          language: null,
          category: 'source',
        })
      ).toThrow();
    });
  });

  describe('SearchResponseSchema', () => {
    it('validates a complete search response', () => {
      const response = {
        query: 'authentication',
        results: [
          {
            filePath: 'src/auth.ts',
            chunkIndex: 0,
            startLine: 10,
            endLine: 35,
            content: 'function verifyToken() {}',
            score: 0.95,
            language: 'TypeScript',
            category: 'source' as const,
          },
        ],
        totalMatches: 1,
        durationMs: 42,
        fallback: false,
      };
      const parsed = SearchResponseSchema.parse(response);
      expect(parsed.query).toBe('authentication');
      expect(parsed.results.length).toBe(1);
      expect(parsed.totalMatches).toBe(1);
      expect(parsed.durationMs).toBe(42);
      expect(parsed.fallback).toBe(false);
    });
  });
});
