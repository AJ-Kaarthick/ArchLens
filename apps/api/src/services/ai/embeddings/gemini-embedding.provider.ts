import { GoogleGenAI } from '@google/genai';
import type { IEmbeddingProvider } from './embedding.interface.js';
import { AIRateLimitError } from '../provider.interface.js';

export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'gemini-embedding';
  readonly dimension = 768;
  readonly model: string;
  private client: GoogleGenAI;
  private timeoutMs: number;

  constructor(options: { apiKey?: string; model?: string; timeoutMs?: number } = {}) {
    const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required for GeminiEmbeddingProvider');
    }
    this.model = options.model || process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.client = new GoogleGenAI({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const batchSize = 20;
    const allVectors: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchVectors = await this.embedBatchWithTimeout(batch);
      allVectors.push(...batchVectors);
    }

    if (allVectors.length !== texts.length) {
      throw new Error(
        `Gemini embedding invariant violated: expected ${texts.length} vectors for ${texts.length} texts, but received ${allVectors.length}`
      );
    }

    return allVectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const vectors = await this.embedBatchWithTimeout([text]);
    if (!vectors[0] || vectors[0].length !== this.dimension) {
      throw new Error(
        `Gemini embedding provider returned invalid vector for query (expected dimension ${this.dimension}, got ${vectors[0]?.length ?? 0})`
      );
    }
    return vectors[0];
  }

  private async embedBatchWithTimeout(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const abortController = new AbortController();

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        abortController.abort();
        reject(new Error(`Gemini embedding provider request timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    });

    const executionPromise = (async () => {
      try {
        // Send each input as an independent Content object so @google/genai creates
        // distinct batch request items, yielding N independent vectors for N texts.
        const contents = texts.map((text) => ({
          role: 'user',
          parts: [{ text }],
        }));

        const response = await this.client.models.embedContent({
          model: this.model,
          contents,
          config: {
            outputDimensionality: this.dimension,
            abortSignal: abortController.signal,
          },
        });

        let extractedVectors: number[][] = [];

        if (response.embeddings && response.embeddings.length > 0) {
          extractedVectors = response.embeddings.map((e) => e.values || []);
        } else if ((response as any).embedding?.values) {
          extractedVectors = [(response as any).embedding.values];
        }

        if (extractedVectors.length !== texts.length) {
          throw new Error(
            `Gemini embedding provider returned ${extractedVectors.length} vectors for batch of ${texts.length} texts`
          );
        }

        for (let i = 0; i < extractedVectors.length; i++) {
          const vec = extractedVectors[i];
          if (!Array.isArray(vec) || vec.length !== this.dimension) {
            throw new Error(
              `Gemini embedding dimension mismatch at index ${i}: expected ${this.dimension}, got ${vec?.length ?? 'undefined'}`
            );
          }
          if (vec.some((v) => typeof v !== 'number' || Number.isNaN(v))) {
            throw new Error(
              `Gemini embedding contains invalid numeric values (NaN or non-number) at index ${i}`
            );
          }
        }

        return extractedVectors;
      } catch (err: any) {
        const errorMsg = String(err?.message || err);
        if (
          errorMsg.includes('429') ||
          errorMsg.includes('quota') ||
          errorMsg.includes('RESOURCE_EXHAUSTED')
        ) {
          throw new AIRateLimitError(
            `Gemini embedding rate limit exceeded: ${errorMsg}`,
            'Wait a moment before retrying semantic search or switch to MockEmbeddingProvider.'
          );
        }
        throw err;
      }
    })();

    return Promise.race([executionPromise, timeoutPromise]);
  }
}
