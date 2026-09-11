import { describe, it, expect, vi } from 'vitest';
import { MockEmbeddingProvider } from './mock-embedding.provider.js';
import { GeminiEmbeddingProvider } from './gemini-embedding.provider.js';
import { EmbeddingProviderFactory } from './embedding-provider.factory.js';
import { AIRateLimitError } from '../provider.interface.js';

// Cosine similarity helper for testing vectors
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

describe('Embedding Providers', () => {
  describe('MockEmbeddingProvider', () => {
    const provider = new MockEmbeddingProvider();

    it('returns vectors of exact dimension 768', async () => {
      const vectors = await provider.embed(['hello world', 'fastify server setup']);
      expect(vectors).toHaveLength(2);
      expect(vectors[0]).toHaveLength(768);
      expect(vectors[1]).toHaveLength(768);
    });

    it('produces deterministic output for identical text', async () => {
      const v1 = await provider.embedQuery('authentication token verification');
      const v2 = await provider.embedQuery('authentication token verification');
      expect(v1).toEqual(v2);
    });

    it('matches embed() and embedQuery() for the same text', async () => {
      const text = 'database connection pool settings';
      const [v1] = await provider.embed([text]);
      const v2 = await provider.embedQuery(text);
      expect(v1).toEqual(v2);
    });

    it('calculates higher cosine similarity for related texts than unrelated texts', async () => {
      const q = await provider.embedQuery('fastify http router');
      const related = await provider.embedQuery('fastify http web framework routing routes');
      const unrelated = await provider.embedQuery('quantum physics particle physics cosmology');

      const scoreRelated = cosineSimilarity(q, related);
      const scoreUnrelated = cosineSimilarity(q, unrelated);

      expect(scoreRelated).toBeGreaterThan(scoreUnrelated);
    });

    it('handles empty text gracefully without NaN', async () => {
      const v = await provider.embedQuery('');
      expect(v).toHaveLength(768);
      expect(v.every((n) => !isNaN(n))).toBe(true);
    });
  });

  describe('GeminiEmbeddingProvider', () => {
    it('throws when apiKey is missing', () => {
      expect(() => new GeminiEmbeddingProvider({ apiKey: '' })).toThrow(
        'GEMINI_API_KEY is required for GeminiEmbeddingProvider'
      );
    });

    it('defaults model to text-embedding-004', () => {
      const provider = new GeminiEmbeddingProvider({ apiKey: 'fake-key' });
      expect(provider.model).toBe('text-embedding-004');
      expect(provider.dimension).toBe(768);
    });

    it('calls client.models.embedContent and parses embeddings', async () => {
      const provider = new GeminiEmbeddingProvider({ apiKey: 'fake-key' });
      const mockVector = new Array(768).fill(0.01);
      const mockClient = (provider as any).client;

      mockClient.models.embedContent = vi.fn().mockResolvedValue({
        embeddings: [{ values: mockVector }, { values: mockVector }],
      });

      const res = await provider.embed(['text 1', 'text 2']);
      expect(res).toHaveLength(2);
      expect(res[0]).toEqual(mockVector);
      expect(mockClient.models.embedContent).toHaveBeenCalledWith({
        model: 'text-embedding-004',
        contents: ['text 1', 'text 2'],
      });
    });

    it('maps quota and 429 errors to AIRateLimitError', async () => {
      const provider = new GeminiEmbeddingProvider({ apiKey: 'fake-key' });
      const mockClient = (provider as any).client;

      mockClient.models.embedContent = vi
        .fn()
        .mockRejectedValue(new Error('Resource has been exhausted: 429 Too Many Requests'));

      await expect(provider.embedQuery('test')).rejects.toThrow(AIRateLimitError);
    });
  });

  describe('EmbeddingProviderFactory', () => {
    it('creates MockEmbeddingProvider when no apiKey is provided', () => {
      const provider = EmbeddingProviderFactory.create({});
      expect(provider.name).toBe('mock-embedding');
    });

    it('creates GeminiEmbeddingProvider when apiKey is provided', () => {
      const provider = EmbeddingProviderFactory.create({ geminiApiKey: 'test-key' });
      expect(provider.name).toBe('gemini-embedding');
    });

    it('throws when gemini is requested without key', () => {
      expect(() =>
        EmbeddingProviderFactory.create({ providerType: 'gemini', geminiApiKey: '' })
      ).toThrow('GEMINI_API_KEY is required');
    });

    it('forces MockEmbeddingProvider when providerType is mock even if key exists', () => {
      const provider = EmbeddingProviderFactory.create({
        providerType: 'mock',
        geminiApiKey: 'test-key',
      });
      expect(provider.name).toBe('mock-embedding');
    });
  });
});
