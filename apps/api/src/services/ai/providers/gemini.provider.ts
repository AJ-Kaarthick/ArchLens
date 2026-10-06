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

export interface ProviderLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export type GeminiErrorCategory =
  | 'auth_or_permission'
  | 'quota_rate_limit'
  | 'service_unavailable'
  | 'client_cancellation'
  | 'timeout'
  | 'bad_request'
  | 'malformed_response'
  | 'safety_blocked'
  | 'unknown';

export interface ExtractedErrorStatus {
  status?: number;
  code?: string;
  isTimeout?: boolean;
  isAbort?: boolean;
}

/**
 * Extracts structured HTTP status, error codes, and flags from provider or SDK errors.
 * Avoids misclassifying timeout durations (e.g. 4030ms) or ports as HTTP statuses.
 */
export function extractErrorStatus(err: unknown): ExtractedErrorStatus {
  if (!err) return {};

  const anyErr = err as any;
  let status: number | undefined =
    typeof anyErr.status === 'number'
      ? anyErr.status
      : typeof anyErr.statusCode === 'number'
        ? anyErr.statusCode
        : typeof anyErr.response?.status === 'number'
          ? anyErr.response.status
          : undefined;

  let code: string | undefined =
    typeof anyErr.code === 'string'
      ? anyErr.code
      : typeof anyErr.statusText === 'string'
        ? anyErr.statusText
        : undefined;

  const isAbort =
    (err instanceof Error && (err.name === 'AbortError' || anyErr.code === 'ABORT_ERR')) ||
    (typeof anyErr.message === 'string' &&
      /\b(?:request was aborted|aborted by caller|client aborted)\b/i.test(anyErr.message));

  const isTimeout =
    (err instanceof Error && (err.name === 'TimeoutError' || anyErr.isTimeout === true)) ||
    (typeof anyErr.message === 'string' &&
      /\b(?:timed out|timeout)\b/i.test(anyErr.message) &&
      !isAbort);

  // If status was not directly numeric on the error object, parse bounded status patterns from message
  if (status === undefined && typeof anyErr.message === 'string') {
    // Only match patterns like [403], status: 403, HTTP 429, 503 Service Unavailable, 500 Internal Server Error
    // Avoids misinterpreting milliseconds (e.g. 4030ms) or ports (e.g. 4001) as HTTP status
    const match = anyErr.message.match(
      /(?:\[\s*([45]\d{2})\s*\]|\b(?:status|code|http|error)\s*[:=]?\s*([45]\d{2})\b|\b([45]\d{2})\s+(?:forbidden|unauthorized|bad request|too many requests|resource exhausted|internal (?:server )?error|bad gateway|service unavailable|gateway timeout|not found)\b)/i
    );
    const parsedStr = match ? match[1] || match[2] || match[3] : undefined;
    if (parsedStr) {
      const parsed = parseInt(parsedStr, 10);
      if ([400, 401, 403, 404, 408, 429, 500, 502, 503, 504].includes(parsed)) {
        status = parsed;
      }
    }
  }

  return { status, code, isTimeout, isAbort };
}

/**
 * Classifies an error into specific semantic categories based on structured metadata first.
 */
export function classifyGeminiError(err: unknown): GeminiErrorCategory {
  if (!err) return 'unknown';

  const { status, code, isTimeout, isAbort } = extractErrorStatus(err);
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  // 1. Client cancellation takes highest precedence
  if (isAbort) {
    return 'client_cancellation';
  }

  // 2. Timeout (ArchLens timer or socket timeout)
  if (isTimeout) {
    return 'timeout';
  }

  // 3. Auth & permissions (401, 403, permission denied, invalid api key)
  if (
    status === 401 ||
    status === 403 ||
    code === 'PERMISSION_DENIED' ||
    code === 'UNAUTHENTICATED' ||
    msg.includes('api_key_invalid') ||
    msg.includes('api key not valid') ||
    msg.includes('invalid api key') ||
    msg.includes('permission_denied')
  ) {
    return 'auth_or_permission';
  }

  // 4. Rate limit & quota exhaustion (429, resource exhausted)
  if (
    status === 429 ||
    code === 'RESOURCE_EXHAUSTED' ||
    msg.includes('resource_exhausted') ||
    msg.includes('resource exhausted') ||
    msg.includes('resource has been exhausted') ||
    msg.includes('quota exceeded') ||
    msg.includes('rate limit exceeded') ||
    msg.includes('too many requests')
  ) {
    return 'quota_rate_limit';
  }

  // 5. Service unavailability & capacity (503, 502, 504, unavailable)
  if (
    status === 503 ||
    status === 502 ||
    status === 504 ||
    code === 'UNAVAILABLE' ||
    msg.includes('service unavailable') ||
    msg.includes('model is overloaded')
  ) {
    return 'service_unavailable';
  }

  // 6. Safety & content policy blocks
  if (
    msg.includes('safety') ||
    msg.includes('harm_category') ||
    msg.includes('content policy') ||
    msg.includes('blocked by safety')
  ) {
    return 'safety_blocked';
  }

  // 7. Malformed / unparseable response
  if (
    msg.includes('failed to parse gemini output as json') ||
    msg.includes('returned an empty response') ||
    msg.includes('unexpected token')
  ) {
    return 'malformed_response';
  }

  // 8. Bad request / invalid argument (400)
  if (
    status === 400 ||
    code === 'INVALID_ARGUMENT' ||
    msg.includes('invalid argument') ||
    msg.includes('invalid_argument')
  ) {
    return 'bad_request';
  }

  // 9. Internal server error & network disconnects
  if (
    status === 500 ||
    code === 'INTERNAL' ||
    msg.includes('internal error') ||
    msg.includes('internal server error') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('connecting') ||
    msg.includes('connection')
  ) {
    return 'service_unavailable';
  }

  return 'unknown';
}

/**
 * Returns true if the error indicates a permanent client/auth/config failure that should NOT be retried.
 */
export function isNonTransientError(err: unknown): boolean {
  const category = classifyGeminiError(err);
  return (
    category === 'auth_or_permission' ||
    category === 'bad_request' ||
    category === 'safety_blocked'
  );
}

/**
 * Returns true if the error indicates a transient service/network failure suitable for retry or fallback.
 */
export function isTransientError(err: unknown): boolean {
  const category = classifyGeminiError(err);
  return (
    category === 'service_unavailable' ||
    category === 'quota_rate_limit' ||
    category === 'timeout'
  );
}

/**
 * Returns true specifically for rate limit / quota exhaustion errors (429).
 */
export function isRateLimitError(err: unknown): boolean {
  return classifyGeminiError(err) === 'quota_rate_limit';
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
  logger?: ProviderLogger;
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
  private logger: ProviderLogger;

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
    this.logger = options.logger ?? {
      info: (obj, msg) => {
        if (process.env.NODE_ENV !== 'test') {
          console.log(JSON.stringify({ level: 'info', ...obj, msg }));
        }
      },
      warn: (obj, msg) => {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(JSON.stringify({ level: 'warn', ...obj, msg }));
        }
      },
      error: (obj, msg) => {
        if (process.env.NODE_ENV !== 'test') {
          console.error(JSON.stringify({ level: 'error', ...obj, msg }));
        }
      },
    };
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

    const log = request.logger || this.logger;
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
        const attemptNumber = attempt + 1;

        try {
          return await this.executeCall(
            tier.client,
            tier.model,
            request.context,
            timeoutMs,
            tier.name,
            attemptNumber,
            request.signal,
            log
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
    tierName: string,
    attemptNumber: number,
    parentSignal?: AbortSignal,
    logger?: ProviderLogger
  ): Promise<AIExplanationResult> {
    const log = logger || this.logger;
    const callStart = Date.now();
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

        const latencyMs = Date.now() - callStart;
        const finishReason = response.candidates?.[0]?.finishReason ?? 'STOP';
        const usage = response.usageMetadata;

        log.info(
          {
            event: 'gemini_provider_attempt',
            provider: this.name,
            tier: tierName,
            model,
            attempt: attemptNumber,
            httpStatus: 200,
            latencyMs,
            finishReason,
            tokenUsage: usage
              ? {
                  promptTokens: usage.promptTokenCount,
                  candidatesTokens: usage.candidatesTokenCount,
                  totalTokens: usage.totalTokenCount,
                  thinkingTokens: (usage as any).candidatesTokensDetails?.[0]?.thinkingTokenCount,
                }
              : undefined,
          },
          'Gemini provider attempt succeeded'
        );

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

    try {
      return await Promise.race([executionPromise, timeoutPromise]);
    } catch (err: unknown) {
      const callDuration = Date.now() - callStart;
      const { status, code, isTimeout, isAbort } = extractErrorStatus(err);
      const errorCategory = classifyGeminiError(err);
      const httpStatus = status ?? (isTimeout ? 408 : isAbort ? 499 : undefined);

      log.warn(
        {
          event: 'gemini_provider_attempt',
          provider: this.name,
          tier: tierName,
          model,
          attempt: attemptNumber,
          httpStatus,
          latencyMs: callDuration,
          errorClass: errorCategory,
          errorCode: code,
          errorMessage: this.sanitize(err instanceof Error ? err.message : String(err)),
        },
        'Gemini provider attempt failed'
      );

      throw err;
    }
  }
}
