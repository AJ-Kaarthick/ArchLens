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
    this.model = options.model || process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';
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

    return allVectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const vectors = await this.embedBatchWithTimeout([text]);
    if (!vectors[0] || vectors[0].length === 0) {
      throw new Error('Gemini embedding provider returned empty vector for query');
    }
    return vectors[0];
  }

  private async embedBatchWithTimeout(texts: string[]): Promise<number[][]> {
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
        const response = await this.client.models.embedContent({
          model: this.model,
          contents: texts,
        });

        if (response.embeddings && response.embeddings.length > 0) {
          return response.embeddings.map((e) => e.values || []);
        }

        // Single content fallback
        const singleEmb = (response as any).embedding?.values;
        if (singleEmb) {
          return [singleEmb];
        }

        throw new Error('No embeddings returned by Gemini API');
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
