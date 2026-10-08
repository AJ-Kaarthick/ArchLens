import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResilientFallbackProvider } from './resilient-fallback.provider.js';
import { CircuitBreaker } from '../circuit-breaker.js';
import {
  type IAIProvider,
  AIRateLimitError,
  AITemporaryUnavailableError,
} from '../provider.interface.js';

describe('ResilientFallbackProvider', () => {
  let primaryMock: IAIProvider;
  let fallbackMock: IAIProvider;
  let primaryBreaker: CircuitBreaker;
  let fallbackBreaker: CircuitBreaker;
  let resilientProvider: ResilientFallbackProvider;

  beforeEach(() => {
    primaryMock = {
      name: 'gemini',
      model: 'gemini-3.8-flash',
      explain: vi.fn(),
    };

    fallbackMock = {
      name: 'openai-compatible',
      model: 'gpt-4o-mini',
      explain: vi.fn(),
    };

    primaryBreaker = new CircuitBreaker({ name: 'gemini', failureThreshold: 3, cooldownMs: 60_000 });
    fallbackBreaker = new CircuitBreaker({ name: 'openai', failureThreshold: 3, cooldownMs: 60_000 });

    resilientProvider = new ResilientFallbackProvider([
      { provider: primaryMock, breaker: primaryBreaker },
      { provider: fallbackMock, breaker: fallbackBreaker },
    ]);
  });

  it('routes to primary provider when healthy', async () => {
    const successResult = {
      summary: 'Primary summary',
      explanation: 'Primary explanation',
      keyTakeaways: ['T1'],
      evidence: [],
      provider: 'gemini',
      model: 'gemini-3.8-flash',
    };

    (primaryMock.explain as any).mockResolvedValue(successResult);

    const result = await resilientProvider.explain({
      topic: 'overview',
      context: 'context',
      repoName: 'test/repo',
    });

    expect(result.summary).toBe('Primary summary');
    expect(primaryMock.explain).toHaveBeenCalledTimes(1);
    expect(fallbackMock.explain).not.toHaveBeenCalled();
    expect(primaryBreaker.getState()).toBe('CLOSED');
  });

  it('falls back to secondary provider when primary returns 503 unavailable', async () => {
    (primaryMock.explain as any).mockRejectedValue(
      new AITemporaryUnavailableError('Gemini capacity overloaded')
    );

    const fallbackResult = {
      summary: 'Fallback summary',
      explanation: 'Fallback explanation',
      keyTakeaways: ['T2'],
      evidence: [],
      provider: 'openai-compatible',
      model: 'gpt-4o-mini',
    };

    (fallbackMock.explain as any).mockResolvedValue(fallbackResult);

    const result = await resilientProvider.explain({
      topic: 'overview',
      context: 'context',
      repoName: 'test/repo',
    });

    expect(result.summary).toBe('Fallback summary');
    expect(primaryMock.explain).toHaveBeenCalledTimes(1);
    expect(fallbackMock.explain).toHaveBeenCalledTimes(1);
    expect(primaryBreaker.getStatus().consecutiveFailures).toBe(1);
    expect(fallbackBreaker.getState()).toBe('CLOSED');
  });

  it('trips primary circuit breaker to OPEN after 3 consecutive failures', async () => {
    (primaryMock.explain as any).mockRejectedValue(
      new AITemporaryUnavailableError('503 Service Unavailable')
    );
    (fallbackMock.explain as any).mockResolvedValue({
      summary: 'Fallback summary',
      explanation: 'Explanation',
      keyTakeaways: [],
      evidence: [],
      provider: 'openai-compatible',
      model: 'gpt-4o-mini',
    });

    // 1st failure
    await resilientProvider.explain({ topic: 'overview', context: 'c', repoName: 'r' });
    expect(primaryBreaker.getState()).toBe('CLOSED');

    // 2nd failure
    await resilientProvider.explain({ topic: 'overview', context: 'c', repoName: 'r' });
    expect(primaryBreaker.getState()).toBe('CLOSED');

    // 3rd failure
    await resilientProvider.explain({ topic: 'overview', context: 'c', repoName: 'r' });
    expect(primaryBreaker.getState()).toBe('OPEN');
    expect(primaryBreaker.isOpen()).toBe(true);

    // 4th request: primary is skipped directly!
    vi.clearAllMocks();
    (fallbackMock.explain as any).mockResolvedValue({
      summary: 'Fast fallback',
      explanation: 'Explanation',
      keyTakeaways: [],
      evidence: [],
      provider: 'openai-compatible',
      model: 'gpt-4o-mini',
    });

    const fourthResult = await resilientProvider.explain({
      topic: 'overview',
      context: 'c',
      repoName: 'r',
    });

    expect(fourthResult.summary).toBe('Fast fallback');
    expect(primaryMock.explain).not.toHaveBeenCalled();
    expect(fallbackMock.explain).toHaveBeenCalledTimes(1);
  });

  it('recovers to CLOSED after half-open probe succeeds', async () => {
    let now = 1000;
    const testBreaker = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 60_000,
      nowFn: () => now,
    });

    const testResilient = new ResilientFallbackProvider([
      { provider: primaryMock, breaker: testBreaker },
      { provider: fallbackMock, breaker: fallbackBreaker },
    ]);

    (primaryMock.explain as any).mockRejectedValue(new Error('timeout'));
    (fallbackMock.explain as any).mockResolvedValue({
      summary: 'FB',
      explanation: '',
      keyTakeaways: [],
      evidence: [],
      provider: 'fallback',
      model: 'm',
    });

    await testResilient.explain({ topic: 'overview', context: 'c', repoName: 'r' });
    expect(testBreaker.getState()).toBe('OPEN');

    // Advance time past cooldown
    now += 61_000;
    expect(testBreaker.getState()).toBe('HALF_OPEN');

    // Primary now succeeds
    (primaryMock.explain as any).mockResolvedValue({
      summary: 'Recovered',
      explanation: '',
      keyTakeaways: [],
      evidence: [],
      provider: 'gemini',
      model: 'm',
    });

    const recovered = await testResilient.explain({ topic: 'overview', context: 'c', repoName: 'r' });
    expect(recovered.summary).toBe('Recovered');
    expect(testBreaker.getState()).toBe('CLOSED');
  });

  it('throws AITemporaryUnavailableError when both providers fail', async () => {
    (primaryMock.explain as any).mockRejectedValue(new AITemporaryUnavailableError('Gemini 503'));
    (fallbackMock.explain as any).mockRejectedValue(new AITemporaryUnavailableError('OpenAI 500'));

    await expect(
      resilientProvider.explain({ topic: 'overview', context: 'c', repoName: 'r' })
    ).rejects.toThrow(AITemporaryUnavailableError);
  });

  it('throws AIRateLimitError when all providers fail with 429 rate limit', async () => {
    (primaryMock.explain as any).mockRejectedValue(new AIRateLimitError('Gemini 429'));
    (fallbackMock.explain as any).mockRejectedValue(new AIRateLimitError('OpenAI 429'));

    await expect(
      resilientProvider.explain({ topic: 'overview', context: 'c', repoName: 'r' })
    ).rejects.toThrow(AIRateLimitError);
  });

  it('aborts immediately and does not call fallback when client signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      resilientProvider.explain({
        topic: 'overview',
        context: 'c',
        repoName: 'r',
        signal: controller.signal,
      })
    ).rejects.toThrow(/aborted/i);

    expect(primaryMock.explain).not.toHaveBeenCalled();
    expect(fallbackMock.explain).not.toHaveBeenCalled();
  });
});
