import type { IAIProvider, ProviderLogger } from './provider.interface.js';
import { MockAIProvider } from './providers/mock.provider.js';
import { GeminiAIProvider } from './providers/gemini.provider.js';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider.js';
import {
  ResilientFallbackProvider,
  type ResilientProviderEntry,
} from './providers/resilient-fallback.provider.js';
import { CircuitBreaker } from './circuit-breaker.js';

export interface ProviderFactoryOptions {
  providerType?: 'gemini' | 'openai' | 'mock' | string;
  geminiApiKey?: string;
  model?: string;
  fallbackApiKey?: string;
  fallbackModel?: string;
  tertiaryApiKey?: string;
  tertiaryModel?: string;
  thinkingLevel?: string;
  independentBaseUrl?: string;
  independentApiKey?: string;
  independentModel?: string;
  totalBudgetMs?: number;
  perAttemptTimeoutMs?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  backoffFactor?: number;
  sleepFn?: (ms: number) => Promise<void>;
  logger?: ProviderLogger;
  disableCircuitBreaker?: boolean;
}

export class AIProviderFactory {
  static isConfigured(): boolean {
    if (process.env.AI_DISABLED === 'true' || process.env.AI_PROVIDER === 'none') {
      return false;
    }
    if (process.env.AI_PROVIDER === 'mock') {
      return true;
    }
    const hasGemini = Boolean(process.env.GEMINI_API_KEY);
    const hasIndependent = Boolean(
      process.env.AI_FALLBACK_API_KEY ||
      process.env.OPENAI_API_KEY ||
      (process.env.AI_FALLBACK_BASE_URL && !process.env.AI_FALLBACK_BASE_URL.includes('openai.com'))
    );
    return hasGemini || hasIndependent;
  }

  static create(options: ProviderFactoryOptions = {}): IAIProvider {
    const requestedType = options.providerType || process.env.AI_PROVIDER;

    if (requestedType === 'mock') {
      return new MockAIProvider();
    }

    const geminiKey = options.geminiApiKey || process.env.GEMINI_API_KEY;
    const independentKey =
      options.independentApiKey ||
      process.env.AI_FALLBACK_API_KEY ||
      process.env.OPENAI_API_KEY;
    const independentBaseUrl =
      options.independentBaseUrl ||
      process.env.AI_FALLBACK_BASE_URL ||
      process.env.OPENAI_BASE_URL;
    const independentModel =
      options.independentModel ||
      process.env.AI_FALLBACK_MODEL ||
      process.env.OPENAI_MODEL;

    // Explicit OpenAI-compatible provider requested
    if (requestedType === 'openai') {
      const openAiProvider = new OpenAICompatibleProvider({
        apiKey: independentKey,
        baseUrl: independentBaseUrl,
        model: options.model || independentModel,
        perAttemptTimeoutMs: options.perAttemptTimeoutMs,
        maxRetries: options.maxRetries,
        sleepFn: options.sleepFn,
        logger: options.logger,
      });

      if (options.disableCircuitBreaker) {
        return openAiProvider;
      }
      return new ResilientFallbackProvider([
        { provider: openAiProvider, breaker: new CircuitBreaker({ name: 'openai-compatible' }) },
      ]);
    }

    // Explicit Gemini provider requested
    if (requestedType === 'gemini') {
      if (!geminiKey) {
        throw new Error(
          'GEMINI_API_KEY is required when AI_PROVIDER=gemini is explicitly configured.'
        );
      }
      const geminiProvider = new GeminiAIProvider({
        apiKey: geminiKey,
        model: options.model,
        fallbackApiKey: options.fallbackApiKey || process.env.GEMINI_FALLBACK_API_KEY,
        fallbackModel: options.fallbackModel || process.env.GEMINI_FALLBACK_MODEL,
        tertiaryApiKey: options.tertiaryApiKey || process.env.GEMINI_TERTIARY_API_KEY,
        tertiaryModel: options.tertiaryModel || process.env.GEMINI_TERTIARY_MODEL,
        thinkingLevel: options.thinkingLevel || process.env.GEMINI_THINKING_LEVEL,
        totalBudgetMs: options.totalBudgetMs,
        perAttemptTimeoutMs: options.perAttemptTimeoutMs,
        maxRetries: options.maxRetries,
        initialBackoffMs: options.initialBackoffMs,
        maxBackoffMs: options.maxBackoffMs,
        backoffFactor: options.backoffFactor,
        sleepFn: options.sleepFn,
        logger: options.logger,
      });

      if (options.disableCircuitBreaker) {
        return geminiProvider;
      }
      return new ResilientFallbackProvider([
        { provider: geminiProvider, breaker: new CircuitBreaker({ name: 'gemini' }) },
      ]);
    }

    // Default: Multi-provider resilient chain (Gemini -> OpenAI-compatible fallback)
    const entries: ResilientProviderEntry[] = [];

    if (geminiKey) {
      const gemini = new GeminiAIProvider({
        apiKey: geminiKey,
        model: options.model,
        fallbackApiKey: options.fallbackApiKey || process.env.GEMINI_FALLBACK_API_KEY,
        fallbackModel: options.fallbackModel || process.env.GEMINI_FALLBACK_MODEL,
        tertiaryApiKey: options.tertiaryApiKey || process.env.GEMINI_TERTIARY_API_KEY,
        tertiaryModel: options.tertiaryModel || process.env.GEMINI_TERTIARY_MODEL,
        thinkingLevel: options.thinkingLevel || process.env.GEMINI_THINKING_LEVEL,
        totalBudgetMs: options.totalBudgetMs,
        perAttemptTimeoutMs: options.perAttemptTimeoutMs,
        maxRetries: options.maxRetries,
        initialBackoffMs: options.initialBackoffMs,
        maxBackoffMs: options.maxBackoffMs,
        backoffFactor: options.backoffFactor,
        sleepFn: options.sleepFn,
        logger: options.logger,
      });
      entries.push({ provider: gemini, breaker: new CircuitBreaker({ name: 'gemini' }) });
    }

    if (independentKey || (independentBaseUrl && !independentBaseUrl.includes('openai.com'))) {
      const openAi = new OpenAICompatibleProvider({
        apiKey: independentKey,
        baseUrl: independentBaseUrl,
        model: independentModel,
        perAttemptTimeoutMs: options.perAttemptTimeoutMs,
        maxRetries: options.maxRetries,
        sleepFn: options.sleepFn,
        logger: options.logger,
      });
      entries.push({
        provider: openAi,
        breaker: new CircuitBreaker({ name: 'openai-compatible' }),
      });
    }

    if (entries.length > 0) {
      if (options.disableCircuitBreaker && entries.length === 1) {
        return entries[0].provider;
      }
      return new ResilientFallbackProvider(entries);
    }

    return new MockAIProvider();
  }
}
