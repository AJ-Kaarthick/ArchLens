import type { IEmbeddingProvider } from './embedding.interface.js';
import { MockEmbeddingProvider } from './mock-embedding.provider.js';
import { GeminiEmbeddingProvider } from './gemini-embedding.provider.js';

export interface EmbeddingProviderFactoryOptions {
  providerType?: 'gemini' | 'mock' | string;
  geminiApiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export class EmbeddingProviderFactory {
  static create(options: EmbeddingProviderFactoryOptions = {}): IEmbeddingProvider {
    const requestedType = options.providerType || process.env.EMBEDDING_PROVIDER;

    if (requestedType === 'mock') {
      return new MockEmbeddingProvider();
    }

    const geminiKey = options.geminiApiKey || process.env.GEMINI_API_KEY;

    if (requestedType === 'gemini') {
      if (!geminiKey) {
        throw new Error(
          'GEMINI_API_KEY is required when EMBEDDING_PROVIDER=gemini is explicitly configured.'
        );
      }
      return new GeminiEmbeddingProvider({
        apiKey: geminiKey,
        model: options.model,
        timeoutMs: options.timeoutMs,
      });
    }

    // Default heuristic: If GEMINI_API_KEY is set, use Gemini. Otherwise fallback to Mock.
    if (geminiKey) {
      return new GeminiEmbeddingProvider({
        apiKey: geminiKey,
        model: options.model,
        timeoutMs: options.timeoutMs,
      });
    }

    return new MockEmbeddingProvider();
  }
}
