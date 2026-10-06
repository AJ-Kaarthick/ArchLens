import type { IAIProvider, ProviderLogger } from './provider.interface.js';
import { MockAIProvider } from './providers/mock.provider.js';
import { GeminiAIProvider } from './providers/gemini.provider.js';

export interface ProviderFactoryOptions {
  providerType?: 'gemini' | 'mock' | string;
  geminiApiKey?: string;
  model?: string;
  fallbackApiKey?: string;
  fallbackModel?: string;
  tertiaryApiKey?: string;
  tertiaryModel?: string;
  thinkingLevel?: string;
  totalBudgetMs?: number;
  perAttemptTimeoutMs?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  backoffFactor?: number;
  sleepFn?: (ms: number) => Promise<void>;
  logger?: ProviderLogger;
}

export class AIProviderFactory {
  static create(options: ProviderFactoryOptions = {}): IAIProvider {
    const requestedType = options.providerType || process.env.AI_PROVIDER;

    if (requestedType === 'mock') {
      return new MockAIProvider();
    }

    const geminiKey = options.geminiApiKey || process.env.GEMINI_API_KEY;
    const fallbackKey = options.fallbackApiKey || process.env.GEMINI_FALLBACK_API_KEY;
    const fallbackModel = options.fallbackModel || process.env.GEMINI_FALLBACK_MODEL;
    const tertiaryKey = options.tertiaryApiKey || process.env.GEMINI_TERTIARY_API_KEY;
    const tertiaryModel = options.tertiaryModel || process.env.GEMINI_TERTIARY_MODEL;
    const thinkingLevel = options.thinkingLevel || process.env.GEMINI_THINKING_LEVEL;

    if (requestedType === 'gemini') {
      if (!geminiKey) {
        throw new Error(
          'GEMINI_API_KEY is required when AI_PROVIDER=gemini is explicitly configured.'
        );
      }
      return new GeminiAIProvider({
        apiKey: geminiKey,
        model: options.model,
        fallbackApiKey: fallbackKey,
        fallbackModel: fallbackModel,
        tertiaryApiKey: tertiaryKey,
        tertiaryModel: tertiaryModel,
        thinkingLevel,
        totalBudgetMs: options.totalBudgetMs,
        perAttemptTimeoutMs: options.perAttemptTimeoutMs,
        maxRetries: options.maxRetries,
        initialBackoffMs: options.initialBackoffMs,
        maxBackoffMs: options.maxBackoffMs,
        backoffFactor: options.backoffFactor,
        sleepFn: options.sleepFn,
        logger: options.logger,
      });
    }

    // Default heuristic: If GEMINI_API_KEY is set, use Gemini. Otherwise, gracefully fallback to Mock.
    if (geminiKey) {
      return new GeminiAIProvider({
        apiKey: geminiKey,
        model: options.model,
        fallbackApiKey: fallbackKey,
        fallbackModel: fallbackModel,
        tertiaryApiKey: tertiaryKey,
        tertiaryModel: tertiaryModel,
        thinkingLevel,
        totalBudgetMs: options.totalBudgetMs,
        perAttemptTimeoutMs: options.perAttemptTimeoutMs,
        maxRetries: options.maxRetries,
        initialBackoffMs: options.initialBackoffMs,
        maxBackoffMs: options.maxBackoffMs,
        backoffFactor: options.backoffFactor,
        sleepFn: options.sleepFn,
        logger: options.logger,
      });
    }

    return new MockAIProvider();
  }
}
