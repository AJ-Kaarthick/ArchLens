import type { IAIProvider } from './provider.interface.js';
import { MockAIProvider } from './providers/mock.provider.js';
import { GeminiAIProvider } from './providers/gemini.provider.js';

export interface ProviderFactoryOptions {
  providerType?: 'gemini' | 'mock' | string;
  geminiApiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export class AIProviderFactory {
  static create(options: ProviderFactoryOptions = {}): IAIProvider {
    const requestedType = options.providerType || process.env.AI_PROVIDER;

    if (requestedType === 'mock') {
      return new MockAIProvider();
    }

    const geminiKey = options.geminiApiKey || process.env.GEMINI_API_KEY;

    if (requestedType === 'gemini') {
      if (!geminiKey) {
        throw new Error(
          'GEMINI_API_KEY is required when AI_PROVIDER=gemini is explicitly configured.'
        );
      }
      return new GeminiAIProvider({
        apiKey: geminiKey,
        model: options.model,
        timeoutMs: options.timeoutMs,
      });
    }

    // Default heuristic: If GEMINI_API_KEY is set, use Gemini. Otherwise, gracefully fallback to Mock.
    if (geminiKey) {
      return new GeminiAIProvider({
        apiKey: geminiKey,
        model: options.model,
        timeoutMs: options.timeoutMs,
      });
    }

    return new MockAIProvider();
  }
}
