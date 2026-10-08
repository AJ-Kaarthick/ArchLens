import { AIExplanationResultSchema } from '@archlens/shared';
import {
  AIExplanationRequest,
  AIExplanationResult,
  IAIProvider,
  AIRateLimitError,
  AITemporaryUnavailableError,
  type ProviderLogger,
} from '../provider.interface.js';
import { sanitizeErrorMessage } from '../sanitize-error.js';

export interface OpenAICompatibleProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  perAttemptTimeoutMs?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  backoffFactor?: number;
  sleepFn?: (ms: number) => Promise<void>;
  logger?: ProviderLogger;
}

/**
 * Independent OpenAI-compatible AI provider.
 * Works with any OpenAI-compatible completions API:
 * - Direct OpenAI (api.openai.com)
 * - Hosted routers (OpenRouter, Groq, Together, DeepInfra)
 * - Local self-hosted LLMs (Ollama, vLLM, LocalAI)
 *
 * Provides genuine provider independence from Google Gemini.
 */
export class OpenAICompatibleProvider implements IAIProvider {
  readonly name = 'openai-compatible';
  readonly model: string;
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly perAttemptTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly backoffFactor: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly logger: ProviderLogger;

  constructor(options: OpenAICompatibleProviderOptions = {}) {
    this.apiKey =
      options.apiKey ||
      process.env.AI_FALLBACK_API_KEY ||
      process.env.OPENAI_API_KEY;

    this.baseUrl = (
      options.baseUrl ||
      process.env.AI_FALLBACK_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      'https://api.openai.com/v1'
    ).replace(/\/+$/, '');

    this.model =
      options.model ||
      process.env.AI_FALLBACK_MODEL ||
      process.env.OPENAI_MODEL ||
      'gpt-4o-mini';

    this.perAttemptTimeoutMs = options.perAttemptTimeoutMs ?? 10_000;
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

  private sanitize(text: unknown): string {
    let sanitized = sanitizeErrorMessage(text);
    if (this.apiKey && this.apiKey.trim().length > 4) {
      sanitized = sanitized.split(this.apiKey.trim()).join('[REDACTED]');
    }
    return sanitized;
  }

  async explain(request: AIExplanationRequest): Promise<AIExplanationResult> {
    if (request.signal?.aborted) {
      throw new Error('AI explanation request was aborted.');
    }

    const log = request.logger || this.logger;
    const url = `${this.baseUrl}/chat/completions`;
    const maxAttempts = this.maxRetries + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (request.signal?.aborted) {
        throw new Error('AI explanation request was aborted.');
      }

      const abortController = new AbortController();
      let parentListener: (() => void) | undefined;

      if (request.signal) {
        parentListener = () => abortController.abort();
        request.signal.addEventListener('abort', parentListener, { once: true });
      }

      const timer = setTimeout(() => {
        abortController.abort(new Error(`Request timed out after ${this.perAttemptTimeoutMs}ms`));
      }, this.perAttemptTimeoutMs);

      if (typeof timer.unref === 'function') {
        timer.unref();
      }

      const callStart = Date.now();

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        if (this.apiKey) {
          headers['Authorization'] = `Bearer ${this.apiKey.trim()}`;
        }

        const body = JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content:
                'You are ArchLens AI, an expert software architecture analyst. Respond ONLY with a valid JSON object matching the requested schema: {"summary": string, "explanation": string, "keyTakeaways": string[], "evidence": [{"type": "file"|"manifest"|"entrypoint"|"dependency"|"metric"|"pattern", "label": string, "reference": string, "description": string}]}',
            },
            {
              role: 'user',
              content: request.context,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        });

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: abortController.signal,
        });

        clearTimeout(timer);
        if (request.signal && parentListener) {
          request.signal.removeEventListener('abort', parentListener);
        }

        const latencyMs = Date.now() - callStart;

        if (res.status === 429) {
          throw new AIRateLimitError('OpenAI-compatible provider rate limit exceeded.');
        }

        if (res.status >= 500) {
          throw new AITemporaryUnavailableError(
            `OpenAI-compatible provider returned server error HTTP ${res.status}.`
          );
        }

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          throw new Error(
            `OpenAI-compatible provider failed with HTTP ${res.status}: ${this.sanitize(errBody)}`
          );
        }

        const data = (await res.json()) as any;
        const content = data.choices?.[0]?.message?.content;

        if (!content || typeof content !== 'string') {
          throw new Error('OpenAI-compatible provider returned an empty or malformed message.');
        }

        const cleaned = content
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();

        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          throw new Error(`Failed to parse response as JSON: ${cleaned.slice(0, 100)}...`);
        }

        const validated = AIExplanationResultSchema.parse(parsed);

        log.info(
          {
            event: 'openai_compatible_provider_success',
            provider: this.name,
            model: this.model,
            attempt,
            latencyMs,
            tokenUsage: data.usage,
          },
          'OpenAI-compatible provider request succeeded'
        );

        return {
          summary: validated.summary,
          explanation: validated.explanation,
          keyTakeaways: validated.keyTakeaways,
          evidence: validated.evidence,
          provider: this.name,
          model: this.model,
        };
      } catch (err: unknown) {
        clearTimeout(timer);
        if (request.signal && parentListener) {
          request.signal.removeEventListener('abort', parentListener);
        }

        lastError = err;

        if (
          request.signal?.aborted ||
          (err instanceof Error &&
            (err.name === 'AbortError' || err.message.toLowerCase().includes('aborted')))
        ) {
          throw new Error('AI explanation request was aborted.');
        }

        const isTransient =
          err instanceof AITemporaryUnavailableError ||
          err instanceof AIRateLimitError ||
          (err instanceof Error &&
            (err.message.includes('timed out') ||
              err.message.includes('fetch failed') ||
              err.message.includes('econnreset') ||
              err.message.includes('etimedout')));

        // If non-transient, fail immediately
        if (!isTransient || attempt >= maxAttempts) {
          break;
        }

        // Backoff and retry
        const delay = Math.min(
          this.initialBackoffMs * Math.pow(this.backoffFactor, attempt - 1),
          this.maxBackoffMs
        );
        await this.sleepFn(delay);
      }
    }

    if (lastError instanceof AIRateLimitError || lastError instanceof AITemporaryUnavailableError) {
      throw lastError;
    }

    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    throw new AITemporaryUnavailableError(
      `OpenAI-compatible AI provider temporarily unavailable: ${this.sanitize(msg)}`
    );
  }
}
