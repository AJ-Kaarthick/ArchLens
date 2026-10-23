import {
  AIExplanationRequest,
  AIExplanationResult,
  IAIProvider,
  AIRateLimitError,
  AITemporaryUnavailableError,
} from '../provider.interface.js';
import { CircuitBreaker } from '../circuit-breaker.js';
import { sanitizeErrorMessage } from '../sanitize-error.js';

export interface ResilientProviderEntry {
  provider: IAIProvider;
  breaker: CircuitBreaker;
}

/**
 * Resilient multi-provider fallback coordinator with per-provider circuit breakers.
 *
 * Execution flow:
 * 1. Tries primary provider (e.g. Gemini).
 * 2. If provider circuit breaker is OPEN, skips directly to fallback provider.
 * 3. If provider fails with 5xx/503/timeout, records failure on circuit breaker and attempts fallback.
 * 4. Circuit breaker trips to OPEN after 3 consecutive failures, avoiding repeated calls to a down service.
 * 5. After 60s cooldown, allows a single half-open probe request.
 *
 * Guarantees that neither Gemini nor any external AI disruption blocks core deterministic ArchLens workflows.
 */
export class ResilientFallbackProvider implements IAIProvider {
  readonly name: string;
  readonly model: string;
  private readonly entries: ResilientProviderEntry[];

  constructor(entries: ResilientProviderEntry[]) {
    if (!entries || entries.length === 0) {
      throw new Error('ResilientFallbackProvider requires at least one provider entry.');
    }
    this.entries = entries;
    this.name = entries[0].provider.name;
    this.model = entries[0].provider.model;
  }

  getEntries(): ResilientProviderEntry[] {
    return this.entries;
  }

  getBreakers(): CircuitBreaker[] {
    return this.entries.map((e) => e.breaker);
  }

  async explain(request: AIExplanationRequest): Promise<AIExplanationResult> {
    if (request.signal?.aborted) {
      throw new Error('AI explanation request was aborted.');
    }

    const log = request.logger;
    const errors: Array<{ provider: string; model: string; error: unknown }> = [];

    for (const { provider, breaker } of this.entries) {
      if (request.signal?.aborted) {
        throw new Error('AI explanation request was aborted.');
      }

      const circuitState = breaker.getState();

      if (circuitState === 'OPEN') {
        log?.warn(
          {
            event: 'circuit_breaker_skip',
            provider: provider.name,
            model: provider.model,
            circuitState,
          },
          `Skipping ${provider.name} because its circuit breaker is OPEN.`
        );
        continue;
      }

      try {
        const result = await provider.explain(request);
        breaker.recordSuccess();

        if (errors.length > 0) {
          log?.info(
            {
              event: 'fallback_provider_success',
              provider: result.provider,
              model: result.model,
              previousErrorsCount: errors.length,
            },
            `Fallback provider ${result.provider} succeeded after earlier provider failures.`
          );
        }

        return result;
      } catch (err: unknown) {
        // Cancellation must terminate immediately without probing fallback providers
        if (
          request.signal?.aborted ||
          (err instanceof Error &&
            (err.name === 'AbortError' || err.message.toLowerCase().includes('aborted')))
        ) {
          throw new Error('AI explanation request was aborted.');
        }

        const isRateLimit =
          err instanceof AIRateLimitError ||
          (err as any)?.status === 429 ||
          (err as any)?.statusCode === 429;

        const isUnavailable =
          err instanceof AITemporaryUnavailableError ||
          (err as any)?.status === 503 ||
          (err as any)?.statusCode === 503 ||
          (err as any)?.status >= 500;

        const isTimeout =
          (err instanceof Error &&
            (err.name === 'TimeoutError' ||
              err.message.toLowerCase().includes('timeout') ||
              err.message.toLowerCase().includes('deadline'))) ||
          (err as any)?.isTimeout === true;

        const isTransient = isRateLimit || isUnavailable || isTimeout;

        breaker.recordFailure(isTransient);

        errors.push({
          provider: provider.name,
          model: provider.model,
          error: err,
        });

        log?.warn(
          {
            event: 'provider_failure',
            provider: provider.name,
            model: provider.model,
            circuitState: breaker.getState(),
            consecutiveFailures: breaker.getStatus().consecutiveFailures,
            error: sanitizeErrorMessage(err),
          },
          `Provider ${provider.name} failed. Attempting next provider in fallback chain.`
        );
      }
    }

    // All configured providers failed or had open circuit breakers
    if (errors.length === 0) {
      throw new AITemporaryUnavailableError(
        'All configured AI providers are temporarily unavailable due to open circuit breakers.'
      );
    }

    const allRateLimits = errors.every(
      (e) =>
        e.error instanceof AIRateLimitError ||
        (e.error as any)?.status === 429 ||
        (e.error as any)?.statusCode === 429
    );

    if (allRateLimits) {
      throw new AIRateLimitError(
        'All configured AI providers exceeded rate limits or quotas. Please try again shortly.'
      );
    }

    const lastError = errors[errors.length - 1].error;
    const lastMsg = sanitizeErrorMessage(
      lastError instanceof Error ? lastError.message : String(lastError)
    );

    throw new AITemporaryUnavailableError(
      `All configured AI providers are temporarily unavailable: ${lastMsg}`
    );
  }
}
