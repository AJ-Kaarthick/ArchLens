import { GoogleGenAI } from '@google/genai';
import { AIExplanationResultSchema } from '@archlens/shared';
import {
  AIExplanationRequest,
  AIExplanationResult,
  IAIProvider,
  AIRateLimitError,
  AITemporaryUnavailableError,
} from '../provider.interface.js';

export class GeminiRateLimitError extends AIRateLimitError {
  constructor(
    message = 'Gemini API rate limit or quota exceeded. Please try again shortly.',
    suggestedAction = 'Please wait a moment before requesting another AI explanation.'
  ) {
    super(message, suggestedAction);
    this.name = 'GeminiRateLimitError';
  }
}

export class GeminiTemporaryUnavailableError extends AITemporaryUnavailableError {
  constructor(
    message = 'Gemini AI service is temporarily unavailable after retry and fallback attempts.',
    suggestedAction = 'Please wait a moment and click Retry.'
  ) {
    super(message, suggestedAction);
    this.name = 'GeminiTemporaryUnavailableError';
  }
}

/**
 * Strips sensitive keys from error messages or logs to prevent secret leakage.
 */
export function redactSecrets(message: string, keys: (string | undefined)[]): string {
  let redacted = message;
  for (const key of keys) {
    if (key && typeof key === 'string' && key.trim().length > 5) {
      redacted = redacted.split(key.trim()).join('[REDACTED]');
    }
  }
  return redacted;
}

/**
 * Returns true if the error indicates a permanent client/auth/config failure that should NOT be retried.
 */
export function isNonTransientError(err: unknown): boolean {
  if (!err) return false;
  const status = (err as any)?.status ?? (err as any)?.statusCode;
  if (status === 400 || status === 401 || status === 403) {
    return true;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  return (
    msg.includes('400') ||
    msg.includes('invalid argument') ||
    msg.includes('invalid_argument') ||
    msg.includes('bad request') ||
    msg.includes('401') ||
    msg.includes('unauthenticated') ||
    msg.includes('api_key_invalid') ||
    msg.includes('api key not valid') ||
    msg.includes('invalid api key') ||
    msg.includes('403') ||
    msg.includes('permission_denied') ||
    msg.includes('permission denied') ||
    msg.includes('safety') ||
    msg.includes('content-policy') ||
    msg.includes('content policy') ||
    msg.includes('harm_category') ||
    msg.includes('blocked')
  );
}

/**
 * Returns true if the error indicates a transient service/network failure suitable for retry or fallback.
 */
export function isTransientError(err: unknown): boolean {
  if (!err) return false;
  if (isNonTransientError(err)) return false;

  // Abort / cancellation must NEVER be treated as a retryable transient error
  if (
    err instanceof Error &&
    (err.name === 'AbortError' || err.message.toLowerCase().includes('aborted'))
  ) {
    return false;
  }

  const status = (err as any)?.status ?? (err as any)?.statusCode;
  if (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return true;
  }

  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('500') ||
    msg.includes('internal error') ||
    msg.includes('502') ||
    msg.includes('bad gateway') ||
    msg.includes('504') ||
    msg.includes('gateway timeout') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed') ||
    msg.includes('socket hang up') ||
    msg.includes('network')
  );
}

/**
 * Returns true specifically for rate limit / quota exhaustion errors (429).
 */
export function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  const status = (err as any)?.status ?? (err as any)?.statusCode;
  if (status === 429) return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit')
  );
}

export interface GeminiAIProviderOptions {
  apiKey?: string;
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
}

export class GeminiAIProvider implements IAIProvider {
  readonly name = 'gemini';
  readonly model: string;
  readonly fallbackModel: string;
  readonly tertiaryModel: string;
  readonly thinkingLevel: string;
  private primaryApiKey: string;
  private fallbackApiKey?: string;
  private tertiaryApiKey?: string;
  private client: GoogleGenAI;
  private fallbackClient?: GoogleGenAI;
  private tertiaryClient?: GoogleGenAI;
  private totalBudgetMs: number;
  private perAttemptTimeoutMs: number;
  private maxRetries: number;
  private initialBackoffMs: number;
  private maxBackoffMs: number;
  private backoffFactor: number;
  private sleepFn: (ms: number) => Promise<void>;

  constructor(options: GeminiAIProviderOptions = {}) {
    const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required for GeminiAIProvider');
    }
    this.primaryApiKey = apiKey;
    this.model = options.model || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    this.client = new GoogleGenAI({ apiKey });

    // Fallback model & API key configuration (first fallback: 3.7-flash)
    const fallbackKey = options.fallbackApiKey || process.env.GEMINI_FALLBACK_API_KEY;
    this.fallbackApiKey = fallbackKey;
    this.fallbackModel =
      options.fallbackModel || process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.7-flash';
    if (fallbackKey) {
      this.fallbackClient = new GoogleGenAI({ apiKey: fallbackKey });
    }

    // Tertiary model & API key configuration (tertiary fallback: 3.6-flash)
    const tertiaryKey =
      options.tertiaryApiKey ||
      process.env.GEMINI_TERTIARY_API_KEY ||
      (options.tertiaryModel ? fallbackKey || apiKey : undefined);
    this.tertiaryApiKey = tertiaryKey;
    this.tertiaryModel =
      options.tertiaryModel || process.env.GEMINI_TERTIARY_MODEL || 'gemini-3.6-flash';
    if (tertiaryKey) {
      this.tertiaryClient = new GoogleGenAI({ apiKey: tertiaryKey });
    }

    // Thinking configuration for Gemini 3.x (defaults to 'LOW' for fast, grounded JSON synthesis)
    this.thinkingLevel = options.thinkingLevel || process.env.GEMINI_THINKING_LEVEL || 'LOW';

    // Bounded latency budget & exponential backoff configuration
    this.totalBudgetMs = options.totalBudgetMs ?? 18000;
    this.perAttemptTimeoutMs = options.perAttemptTimeoutMs ?? 6000;
    this.maxRetries = options.maxRetries ?? 1;
    this.initialBackoffMs = options.initialBackoffMs ?? 250;
    this.maxBackoffMs = options.maxBackoffMs ?? 1500;
    this.backoffFactor = options.backoffFactor ?? 2;
    this.sleepFn = options.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get hasFallback(): boolean {
    return !!this.fallbackClient;
  }

  get hasTertiary(): boolean {
    return !!this.tertiaryClient;
  }

  private sanitize(message: string): string {
    return redactSecrets(message, [this.primaryApiKey, this.fallbackApiKey, this.tertiaryApiKey]);
  }

  async explain(request: AIExplanationRequest): Promise<AIExplanationResult> {
    if (request.signal?.aborted) {
      throw new Error('AI explanation request was aborted.');
    }

    const deadline = request.deadlineMs
      ? Math.min(request.deadlineMs, Date.now() + this.totalBudgetMs)
      : Date.now() + this.totalBudgetMs;
    const errors: { tier: string; model: string; error: unknown }[] = [];
    const getRemainingBudget = () => deadline - Date.now();

    interface TierConfig {
      name: string;
      client: GoogleGenAI;
      model: string;
      maxRetries: number;
    }

    const tiers: TierConfig[] = [
      { name: 'primary', client: this.client, model: this.model, maxRetries: this.maxRetries },
    ];

    if (this.fallbackClient) {
      tiers.push({
        name: 'fallback',
        client: this.fallbackClient,
        model: this.fallbackModel,
        maxRetries: 1,
      });
    }

    if (this.tertiaryClient) {
      tiers.push({
        name: 'tertiary',
        client: this.tertiaryClient,
        model: this.tertiaryModel,
        maxRetries: 0,
      });
    }

    for (let tIndex = 0; tIndex < tiers.length; tIndex++) {
      const tier = tiers[tIndex];
      const maxAttempts = tier.maxRetries + 1;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (request.signal?.aborted) {
          throw new Error('AI explanation request was aborted.');
        }

        const remainingMs = getRemainingBudget();
        if (remainingMs < 1000) {
          break;
        }

        const timeoutMs = Math.min(this.perAttemptTimeoutMs, remainingMs);

        try {
          return await this.executeCall(
            tier.client,
            tier.model,
            request.context,
            timeoutMs,
            request.signal
          );
        } catch (err: unknown) {
          // If request was aborted by client or caller, terminate immediately without retry or fallback
          if (
            request.signal?.aborted ||
            (err instanceof Error &&
              (err.name === 'AbortError' || err.message.toLowerCase().includes('aborted')))
          ) {
            throw new Error('AI explanation request was aborted.');
          }

          errors.push({ tier: tier.name, model: tier.model, error: err });

          // Non-transient errors (400, 401, 403, safety filters) must fail immediately without retries or fallback
          if (isNonTransientError(err) || !isTransientError(err)) {
            if (err instanceof Error) {
              err.message = this.sanitize(err.message);
              throw err;
            }
            throw new Error(this.sanitize(String(err)));
          }

          // If retries remain in this tier, wait with exponential backoff + jitter
          if (attempt < maxAttempts - 1) {
            const jitter = Math.floor(Math.random() * 75);
            const delay = Math.min(
              this.initialBackoffMs * Math.pow(this.backoffFactor, attempt) + jitter,
              this.maxBackoffMs
            );
            if (Date.now() + delay < deadline - 1000) {
              await this.sleepFn(delay);
            }
          }
        }
      }
    }

    // All attempted tiers failed
    const lastError = errors[errors.length - 1]?.error;
    const allRateLimits = errors.length > 0 && errors.every((e) => isRateLimitError(e.error));

    if (allRateLimits) {
      throw new GeminiRateLimitError(
        this.sanitize(
          lastError instanceof Error
            ? lastError.message
            : 'Gemini API rate limit or quota exceeded across configured providers.'
        )
      );
    }

    const attemptedModels = tiers.map((t) => t.model).join(', ');
    throw new GeminiTemporaryUnavailableError(
      this.sanitize(
        `Gemini AI service temporarily unavailable after attempts across models (${attemptedModels}): ` +
          (lastError instanceof Error ? lastError.message : String(lastError))
      )
    );
  }

  private async executeCall(
    client: GoogleGenAI,
    model: string,
    context: string,
    timeoutMs: number,
    parentSignal?: AbortSignal
  ): Promise<AIExplanationResult> {
    const abortController = new AbortController();

    let parentListener: (() => void) | undefined;
    if (parentSignal) {
      if (parentSignal.aborted) {
        abortController.abort();
      } else {
        parentListener = () => abortController.abort();
        parentSignal.addEventListener('abort', parentListener, { once: true });
      }
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        abortController.abort();
        reject(new Error(`Gemini AI provider request timed out after ${timeoutMs}ms (${model})`));
      }, timeoutMs);

      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    });

    const executionPromise = (async () => {
      try {
        const response = await client.models.generateContent({
          model,
          contents: context,
          config: {
            temperature: 0.2,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
            thinkingConfig: {
              thinkingLevel: this.thinkingLevel as any,
            },
            abortSignal: abortController.signal,
            httpOptions: {
              retryOptions: { attempts: 1 },
            },
          },
        });

        const text = response.text;
        if (!text) {
          throw new Error('Gemini API returned an empty response');
        }

        const cleaned = text
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();

        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          throw new Error(`Failed to parse Gemini output as JSON: ${cleaned.slice(0, 100)}...`);
        }

        const validated = AIExplanationResultSchema.parse(parsed);

        return {
          summary: validated.summary,
          explanation: validated.explanation,
          keyTakeaways: validated.keyTakeaways,
          evidence: validated.evidence,
          provider: this.name,
          model,
        };
      } finally {
        if (parentSignal && parentListener) {
          parentSignal.removeEventListener('abort', parentListener);
        }
      }
    })();

    return Promise.race([executionPromise, timeoutPromise]);
  }
}
