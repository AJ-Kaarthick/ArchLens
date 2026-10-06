import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GeminiAIProvider,
  GeminiRateLimitError,
  GeminiTemporaryUnavailableError,
  redactSecrets,
  isNonTransientError,
  isTransientError,
  isRateLimitError,
  extractErrorStatus,
  classifyGeminiError,
} from './gemini.provider.js';

const mockInstances: any[] = [];

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation((opts: any) => {
      const inst = {
        apiKey: opts?.apiKey,
        models: {
          generateContent: vi.fn(),
        },
      };
      mockInstances.push(inst);
      return inst;
    }),
  };
});

describe('GeminiAIProvider', () => {
  const sampleOutput = {
    summary: 'Grounded summary of the repository.',
    explanation: 'Detailed architectural overview.',
    keyTakeaways: ['Point 1', 'Point 2', 'Point 3'],
    evidence: [
      {
        type: 'manifest',
        label: 'Root Manifest',
        reference: 'package.json',
        description: 'Package definition',
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInstances.length = 0;
  });

  it('throws when apiKey is missing', () => {
    const oldKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    expect(() => new GeminiAIProvider()).toThrow('GEMINI_API_KEY is required');

    if (oldKey) {
      process.env.GEMINI_API_KEY = oldKey;
    }
  });

  it('defaults to gemini-3.8-flash and allows model override', () => {
    const defaultProvider = new GeminiAIProvider({ apiKey: 'test-fake-key' });
    expect(defaultProvider.model).toBe('gemini-3.8-flash');
    expect(defaultProvider.fallbackModel).toBe('gemini-3.7-flash');
    expect(defaultProvider.tertiaryModel).toBe('gemini-3.6-flash');
    expect(defaultProvider.thinkingLevel).toBe('LOW');
    expect(defaultProvider.hasFallback).toBe(false);
    expect(defaultProvider.hasTertiary).toBe(false);

    const customProvider = new GeminiAIProvider({
      apiKey: 'test-fake-key',
      model: 'gemini-1.5-pro',
      fallbackApiKey: 'fallback-fake-key',
      fallbackModel: 'gemini-2.5-flash',
      tertiaryApiKey: 'tertiary-fake-key',
      tertiaryModel: 'gemini-3.0-flash',
      thinkingLevel: 'HIGH',
    });
    expect(customProvider.model).toBe('gemini-1.5-pro');
    expect(customProvider.fallbackModel).toBe('gemini-2.5-flash');
    expect(customProvider.tertiaryModel).toBe('gemini-3.0-flash');
    expect(customProvider.thinkingLevel).toBe('HIGH');
    expect(customProvider.hasFallback).toBe(true);
    expect(customProvider.hasTertiary).toBe(true);
  });

  it('primary Gemini success returns result with primary model', async () => {
    const provider = new GeminiAIProvider({
      apiKey: 'primary-key-12345',
      fallbackApiKey: 'fallback-key-67890',
    });
    const primaryClient = mockInstances[0];
    const fallbackClient = mockInstances[1];

    primaryClient.models.generateContent.mockResolvedValueOnce({
      text: JSON.stringify(sampleOutput),
    });

    const result = await provider.explain({
      topic: 'overview',
      repoName: 'test/repo',
      context: 'grounded context',
    });

    expect(result.summary).toBe(sampleOutput.summary);
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-3.8-flash');
    expect(primaryClient.models.generateContent).toHaveBeenCalledTimes(1);
    expect(primaryClient.models.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.8-flash' })
    );
    expect(fallbackClient.models.generateContent).not.toHaveBeenCalled();
  });

  it('transient 503 on primary followed by successful retry does not trigger fallback', async () => {
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const provider = new GeminiAIProvider({
      apiKey: 'primary-key-12345',
      fallbackApiKey: 'fallback-key-67890',
      initialBackoffMs: 10,
      sleepFn: sleepMock,
    });
    const primaryClient = mockInstances[0];
    const fallbackClient = mockInstances[1];

    // Fail first attempt with 503 UNAVAILABLE, succeed on second attempt
    primaryClient.models.generateContent
      .mockRejectedValueOnce(new Error('503 Service Unavailable: The model is overloaded'))
      .mockResolvedValueOnce({ text: JSON.stringify(sampleOutput) });

    const result = await provider.explain({
      topic: 'overview',
      repoName: 'test/repo',
      context: 'grounded context',
    });

    expect(result.summary).toBe(sampleOutput.summary);
    expect(result.model).toBe('gemini-3.8-flash');
    expect(primaryClient.models.generateContent).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sleepMock.mock.calls[0][0]).toBeGreaterThanOrEqual(10);
    expect(sleepMock.mock.calls[0][0]).toBeLessThanOrEqual(100);
    expect(fallbackClient.models.generateContent).not.toHaveBeenCalled();
  });

  it('transient failure on primary after exhausted retries triggers successful fallback on 3.7', async () => {
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const provider = new GeminiAIProvider({
      apiKey: 'primary-key-12345',
      fallbackApiKey: 'fallback-key-67890',
      maxRetries: 2,
      initialBackoffMs: 10,
      sleepFn: sleepMock,
    });
    const primaryClient = mockInstances[0];
    const fallbackClient = mockInstances[1];

    // Primary fails 3 times (1 initial + 2 retries) with 503
    primaryClient.models.generateContent.mockRejectedValue(
      new Error('503 Service Unavailable: High load on cluster')
    );

    // Fallback succeeds with 3.7
    fallbackClient.models.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        ...sampleOutput,
        summary: 'Fallback generated summary from 3.7',
      }),
    });

    const result = await provider.explain({
      topic: 'overview',
      repoName: 'test/repo',
      context: 'grounded context',
    });

    expect(result.summary).toBe('Fallback generated summary from 3.7');
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-3.7-flash');
    expect(primaryClient.models.generateContent).toHaveBeenCalledTimes(3);
    expect(fallbackClient.models.generateContent).toHaveBeenCalledTimes(1);
    expect(fallbackClient.models.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.7-flash' })
    );
  });

  it('transient failure on primary and fallback triggers successful tertiary fallback on 3.6', async () => {
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const provider = new GeminiAIProvider({
      apiKey: 'primary-key-12345',
      fallbackApiKey: 'fallback-key-67890',
      tertiaryApiKey: 'tertiary-key-11223',
      maxRetries: 1,
      initialBackoffMs: 0,
      sleepFn: sleepMock,
    });
    const primaryClient = mockInstances[0];
    const fallbackClient = mockInstances[1];
    const tertiaryClient = mockInstances[2];

    primaryClient.models.generateContent.mockRejectedValue(
      new Error('503 Service Unavailable: Primary down')
    );
    fallbackClient.models.generateContent.mockRejectedValue(
      new Error('503 Service Unavailable: Fallback down')
    );
    tertiaryClient.models.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        ...sampleOutput,
        summary: 'Saved by tertiary gemini-3.6-flash',
      }),
    });

    const result = await provider.explain({
      topic: 'overview',
      repoName: 'test/repo',
      context: 'grounded context',
    });

    expect(result.summary).toBe('Saved by tertiary gemini-3.6-flash');
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-3.6-flash');
    expect(primaryClient.models.generateContent).toHaveBeenCalledTimes(2);
    expect(fallbackClient.models.generateContent).toHaveBeenCalledTimes(2);
    expect(tertiaryClient.models.generateContent).toHaveBeenCalledTimes(1);
    expect(tertiaryClient.models.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.6-flash' })
    );
  });

  it('fallback disabled/not configured throws GeminiTemporaryUnavailableError when primary fails', async () => {
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const provider = new GeminiAIProvider({
      apiKey: 'primary-key-12345',
      maxRetries: 1,
      initialBackoffMs: 0,
      sleepFn: sleepMock,
    });
    const primaryClient = mockInstances[0];

    primaryClient.models.generateContent.mockRejectedValue(
      new Error('503 Service Unavailable: Model temporarily overloaded')
    );

    await expect(
      provider.explain({
        topic: 'overview',
        repoName: 'test/repo',
        context: 'grounded context',
      })
    ).rejects.toThrow(GeminiTemporaryUnavailableError);

    expect(primaryClient.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it('non-transient 400, 401, 403, and safety errors do NOT trigger retries or fallback', async () => {
    const sleepMock = vi.fn();
    const provider = new GeminiAIProvider({
      apiKey: 'primary-key-12345',
      fallbackApiKey: 'fallback-key-67890',
      maxRetries: 2,
      sleepFn: sleepMock,
    });
    const primaryClient = mockInstances[0];
    const fallbackClient = mockInstances[1];

    // Case 1: 400 Bad Request
    primaryClient.models.generateContent.mockRejectedValueOnce(
      new Error('400 Bad Request: Invalid argument supplied')
    );
    await expect(
      provider.explain({ topic: 'overview', repoName: 'test/repo', context: 'grounded context' })
    ).rejects.toThrow('400 Bad Request');
    expect(primaryClient.models.generateContent).toHaveBeenCalledTimes(1);
    expect(fallbackClient.models.generateContent).not.toHaveBeenCalled();

    // Case 2: 401 Unauthorized / Invalid API Key
    primaryClient.models.generateContent.mockRejectedValueOnce(
      new Error('401 Unauthorized: API_KEY_INVALID')
    );
    await expect(
      provider.explain({ topic: 'overview', repoName: 'test/repo', context: 'grounded context' })
    ).rejects.toThrow('401 Unauthorized');
    expect(primaryClient.models.generateContent).toHaveBeenCalledTimes(2);
    expect(fallbackClient.models.generateContent).not.toHaveBeenCalled();

    // Case 3: 403 Forbidden / Permission Denied
    primaryClient.models.generateContent.mockRejectedValueOnce(
      new Error('403 Forbidden: Permission denied for project')
    );
    await expect(
      provider.explain({ topic: 'overview', repoName: 'test/repo', context: 'grounded context' })
    ).rejects.toThrow('403 Forbidden');
    expect(primaryClient.models.generateContent).toHaveBeenCalledTimes(3);
    expect(fallbackClient.models.generateContent).not.toHaveBeenCalled();

    // Case 4: Safety Filter Rejection
    primaryClient.models.generateContent.mockRejectedValueOnce(
      new Error('Candidate was blocked due to SAFETY policy violation')
    );
    await expect(
      provider.explain({ topic: 'overview', repoName: 'test/repo', context: 'grounded context' })
    ).rejects.toThrow('SAFETY');
    expect(primaryClient.models.generateContent).toHaveBeenCalledTimes(4);
    expect(fallbackClient.models.generateContent).not.toHaveBeenCalled();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it('429 rate limit error on primary retries and falls back to secondary project key', async () => {
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const provider = new GeminiAIProvider({
      apiKey: 'primary-key-12345',
      fallbackApiKey: 'fallback-key-67890',
      maxRetries: 1,
      initialBackoffMs: 0,
      sleepFn: sleepMock,
    });
    const primaryClient = mockInstances[0];
    const fallbackClient = mockInstances[1];

    primaryClient.models.generateContent.mockRejectedValue(
      new Error('429 RESOURCE_EXHAUSTED: Quota exceeded for project A')
    );

    fallbackClient.models.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        ...sampleOutput,
        summary: 'Saved by secondary project quota',
      }),
    });

    const result = await provider.explain({
      topic: 'overview',
      repoName: 'test/repo',
      context: 'grounded context',
    });

    expect(result.summary).toBe('Saved by secondary project quota');
    expect(result.model).toBe('gemini-3.7-flash');
    expect(primaryClient.models.generateContent).toHaveBeenCalledTimes(2);
    expect(fallbackClient.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it('throws GeminiRateLimitError when both primary and fallback fail with 429', async () => {
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const provider = new GeminiAIProvider({
      apiKey: 'primary-key-12345',
      fallbackApiKey: 'fallback-key-67890',
      maxRetries: 1,
      initialBackoffMs: 0,
      sleepFn: sleepMock,
    });
    const primaryClient = mockInstances[0];
    const fallbackClient = mockInstances[1];

    primaryClient.models.generateContent.mockRejectedValue(
      new Error('429 RESOURCE_EXHAUSTED: Primary quota exceeded')
    );
    fallbackClient.models.generateContent.mockRejectedValue(
      new Error('429 RESOURCE_EXHAUSTED: Fallback quota exceeded')
    );

    await expect(
      provider.explain({
        topic: 'overview',
        repoName: 'test/repo',
        context: 'grounded context',
      })
    ).rejects.toThrow(GeminiRateLimitError);
  });

  it('both primary and fallback unavailable throws GeminiTemporaryUnavailableError', async () => {
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const provider = new GeminiAIProvider({
      apiKey: 'primary-key-12345',
      fallbackApiKey: 'fallback-key-67890',
      maxRetries: 1,
      initialBackoffMs: 0,
      sleepFn: sleepMock,
    });
    const primaryClient = mockInstances[0];
    const fallbackClient = mockInstances[1];

    primaryClient.models.generateContent.mockRejectedValue(
      new Error('503 Service Unavailable: Primary cluster down')
    );
    fallbackClient.models.generateContent.mockRejectedValue(
      new Error('503 Service Unavailable: Fallback cluster down')
    );

    await expect(
      provider.explain({
        topic: 'overview',
        repoName: 'test/repo',
        context: 'grounded context',
      })
    ).rejects.toThrow(GeminiTemporaryUnavailableError);

    expect(primaryClient.models.generateContent).toHaveBeenCalledTimes(2);
    expect(fallbackClient.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it('API keys are never exposed in logs or thrown error messages', async () => {
    const secretPrimaryKey = 'AIzaSySecretPrimarySuperSecretKey123';
    const secretFallbackKey = 'AIzaSySecretFallbackSuperSecretKey456';
    const secretTertiaryKey = 'AIzaSySecretTertiarySuperSecretKey789';

    const provider = new GeminiAIProvider({
      apiKey: secretPrimaryKey,
      fallbackApiKey: secretFallbackKey,
      tertiaryApiKey: secretTertiaryKey,
      maxRetries: 0,
      initialBackoffMs: 0,
    });
    const primaryClient = mockInstances[0];
    const fallbackClient = mockInstances[1];
    const tertiaryClient = mockInstances[2];

    // Primary leaks keys in error message
    primaryClient.models.generateContent.mockRejectedValue(
      new Error(`503 Call failed at endpoint with key=${secretPrimaryKey}`)
    );
    // Fallback leaks keys in error message
    fallbackClient.models.generateContent.mockRejectedValue(
      new Error(`503 Fallback failed at endpoint with key=${secretFallbackKey}`)
    );
    // Tertiary leaks keys in error message
    tertiaryClient.models.generateContent.mockRejectedValue(
      new Error(`503 Tertiary failed at endpoint with key=${secretTertiaryKey}`)
    );

    try {
      await provider.explain({
        topic: 'overview',
        repoName: 'test/repo',
        context: 'grounded context',
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.message).not.toContain(secretPrimaryKey);
      expect(err.message).not.toContain(secretFallbackKey);
      expect(err.message).not.toContain(secretTertiaryKey);
      expect(err.message).toContain('[REDACTED]');
    }
  });

  it('strips markdown code blocks from Gemini response before parsing', async () => {
    const provider = new GeminiAIProvider({ apiKey: 'test-fake-key' });
    const mockClient = mockInstances[0];

    mockClient.models.generateContent.mockResolvedValueOnce({
      text: `\`\`\`json\n${JSON.stringify(sampleOutput)}\n\`\`\``,
    });

    const result = await provider.explain({
      topic: 'overview',
      repoName: 'test/repo',
      context: 'grounded context',
    });

    expect(result.summary).toBe(sampleOutput.summary);
  });

  it('passes configured thinkingConfig to Gemini generateContent', async () => {
    const provider = new GeminiAIProvider({
      apiKey: 'test-fake-key',
      thinkingLevel: 'LOW',
    });
    const primaryClient = mockInstances[0];
    primaryClient.models.generateContent.mockResolvedValueOnce({
      text: JSON.stringify(sampleOutput),
    });

    await provider.explain({
      topic: 'overview',
      repoName: 'test/repo',
      context: 'grounded context',
    });

    expect(primaryClient.models.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          thinkingConfig: { thinkingLevel: 'LOW' },
        }),
      })
    );
  });

  it('aborts immediately when signal is already aborted', async () => {
    const provider = new GeminiAIProvider({ apiKey: 'test-fake-key' });
    const primaryClient = mockInstances[0];
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.explain({
        topic: 'overview',
        repoName: 'test/repo',
        context: 'grounded context',
        signal: controller.signal,
      })
    ).rejects.toThrow('AI explanation request was aborted.');

    expect(primaryClient.models.generateContent).not.toHaveBeenCalled();
  });

  it('aborts immediately when signal aborts during an in-flight call without retrying', async () => {
    const provider = new GeminiAIProvider({
      apiKey: 'test-fake-key',
      fallbackApiKey: 'fallback-key',
      maxRetries: 1,
    });
    const primaryClient = mockInstances[0];
    const fallbackClient = mockInstances[1];
    const controller = new AbortController();

    primaryClient.models.generateContent.mockImplementation(async ({ config }: any) => {
      return new Promise((_, reject) => {
        config.abortSignal?.addEventListener('abort', () => {
          reject(new DOMException('This operation was aborted', 'AbortError'));
        });
      });
    });

    const explainPromise = provider.explain({
      topic: 'overview',
      repoName: 'test/repo',
      context: 'grounded context',
      signal: controller.signal,
    });

    // Abort in flight
    controller.abort();

    await expect(explainPromise).rejects.toThrow('AI explanation request was aborted.');
    expect(primaryClient.models.generateContent).toHaveBeenCalledTimes(1);
    expect(fallbackClient.models.generateContent).not.toHaveBeenCalled();
  });

  it('terminates retry loop when deadline budget is exhausted', async () => {
    const provider = new GeminiAIProvider({
      apiKey: 'primary-key-12345',
      fallbackApiKey: 'fallback-key-67890',
      totalBudgetMs: 10,
      perAttemptTimeoutMs: 100,
      sleepFn: vi.fn(),
    });
    const primaryClient = mockInstances[0];
    primaryClient.models.generateContent.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      throw new Error('503 Service Unavailable: High load');
    });

    await expect(
      provider.explain({
        topic: 'overview',
        repoName: 'test/repo',
        context: 'grounded context',
      })
    ).rejects.toThrow(GeminiTemporaryUnavailableError);
  });

  it('respects request.deadlineMs for shared overall request deadline', async () => {
    const provider = new GeminiAIProvider({
      apiKey: 'primary-key-12345',
      fallbackApiKey: 'fallback-key-67890',
      totalBudgetMs: 60000,
      perAttemptTimeoutMs: 10000,
      sleepFn: vi.fn(),
    });
    const primaryClient = mockInstances[0];
    primaryClient.models.generateContent.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      throw new Error('503 Service Unavailable: High load');
    });

    const tightDeadline = Date.now() + 10;

    await expect(
      provider.explain({
        topic: 'overview',
        repoName: 'test/repo',
        context: 'grounded context',
        deadlineMs: tightDeadline,
      })
    ).rejects.toThrow(GeminiTemporaryUnavailableError);
  });

  describe('helper functions', () => {
    it('redactSecrets sanitizes multiple secrets', () => {
      const sanitized = redactSecrets('request with key1=SECRET_ABC_123 and key2=SECRET_XYZ_789', [
        'SECRET_ABC_123',
        'SECRET_XYZ_789',
      ]);
      expect(sanitized).toBe('request with key1=[REDACTED] and key2=[REDACTED]');
      expect(sanitized).not.toContain('SECRET_ABC_123');
      expect(sanitized).not.toContain('SECRET_XYZ_789');
    });

    it('isNonTransientError correctly detects client and auth errors', () => {
      expect(isNonTransientError(new Error('400 Bad Request'))).toBe(true);
      expect(isNonTransientError(new Error('401 Unauthorized'))).toBe(true);
      expect(isNonTransientError(new Error('403 Forbidden'))).toBe(true);
      expect(isNonTransientError(new Error('Content policy safety rejection'))).toBe(true);
      expect(isNonTransientError(new Error('503 Service Unavailable'))).toBe(false);
      expect(isNonTransientError(new Error('429 Too Many Requests'))).toBe(false);
    });

    it('isTransientError correctly identifies 503, 500, 429, timeouts, and network issues', () => {
      expect(isTransientError(new Error('503 Service Unavailable'))).toBe(true);
      expect(isTransientError(new Error('500 Internal Server Error'))).toBe(true);
      expect(isTransientError(new Error('502 Bad Gateway'))).toBe(true);
      expect(isTransientError(new Error('504 Gateway Timeout'))).toBe(true);
      expect(isTransientError(new Error('429 Resource Exhausted'))).toBe(true);
      expect(isTransientError(new Error('request timed out after 15000ms'))).toBe(true);
      expect(isTransientError(new Error('fetch failed: connect ECONNRESET'))).toBe(true);
      expect(isTransientError(new Error('AI explanation request was aborted.'))).toBe(false);
      expect(isTransientError(new DOMException('The operation was aborted', 'AbortError'))).toBe(false);
      expect(isTransientError(new Error('400 Bad Request'))).toBe(false);
      expect(isTransientError(new Error('401 Invalid Key'))).toBe(false);
    });

    it('isRateLimitError checks 429 markers specifically', () => {
      expect(isRateLimitError(new Error('429 Too Many Requests'))).toBe(true);
      expect(isRateLimitError(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
      expect(isRateLimitError(new Error('quota exceeded'))).toBe(true);
      expect(isRateLimitError(new Error('503 Service Unavailable'))).toBe(false);
    });

    describe('classifyGeminiError and extractErrorStatus', () => {
      it('never misclassifies duration numbers as HTTP status codes', () => {
        const timeout4030 = new Error('request timed out after 4030ms');
        expect(extractErrorStatus(timeout4030).status).toBeUndefined();
        expect(classifyGeminiError(timeout4030)).toBe('timeout');

        const timeout403 = new Error('request timed out after 403ms');
        expect(extractErrorStatus(timeout403).status).toBeUndefined();
        expect(classifyGeminiError(timeout403)).toBe('timeout');

        // Port numbers in error strings
        const port4001 = new Error('failed connecting to host on port 4001');
        expect(extractErrorStatus(port4001).status).toBeUndefined();
        expect(classifyGeminiError(port4001)).toBe('service_unavailable');
      });

      it('correctly classifies client cancellations as client_cancellation', () => {
        expect(classifyGeminiError(new DOMException('The operation was aborted', 'AbortError'))).toBe('client_cancellation');
        expect(classifyGeminiError(new Error('AI explanation request was aborted.'))).toBe('client_cancellation');
        expect(classifyGeminiError({ code: 'ABORT_ERR', message: 'aborted by caller' })).toBe('client_cancellation');
      });

      it('correctly classifies structured 401 and 403 as auth_or_permission', () => {
        expect(classifyGeminiError({ status: 403, message: 'Forbidden' })).toBe('auth_or_permission');
        expect(classifyGeminiError({ statusCode: 401, message: 'Unauthorized' })).toBe('auth_or_permission');
        expect(classifyGeminiError({ code: 'PERMISSION_DENIED', message: 'The caller does not have permission' })).toBe('auth_or_permission');
        expect(classifyGeminiError(new Error('API key not valid. Please pass a valid API key.'))).toBe('auth_or_permission');
      });

      it('correctly classifies structured 429 and RESOURCE_EXHAUSTED as quota_rate_limit', () => {
        expect(classifyGeminiError({ status: 429, message: 'Too Many Requests' })).toBe('quota_rate_limit');
        expect(classifyGeminiError({ code: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' })).toBe('quota_rate_limit');
        expect(classifyGeminiError(new Error('Resource has been exhausted (e.g. check quota).'))).toBe('quota_rate_limit');
      });

      it('correctly classifies 503 and unavailable as service_unavailable', () => {
        expect(classifyGeminiError({ status: 503, message: 'Service Unavailable' })).toBe('service_unavailable');
        expect(classifyGeminiError({ code: 'UNAVAILABLE', message: 'The model is overloaded' })).toBe('service_unavailable');
        expect(classifyGeminiError(new Error('503 Service Unavailable'))).toBe('service_unavailable');
      });

      it('correctly classifies safety filters as safety_blocked', () => {
        expect(classifyGeminiError(new Error('Candidate was blocked by safety filters (HARM_CATEGORY_DANGEROUS)'))).toBe('safety_blocked');
      });

      it('correctly classifies malformed JSON responses as malformed_response', () => {
        expect(classifyGeminiError(new Error('Failed to parse Gemini output as JSON: { broken ...'))).toBe('malformed_response');
        expect(classifyGeminiError(new Error('Gemini API returned an empty response'))).toBe('malformed_response');
      });
    });

    describe('telemetry and logger integration', () => {
      it('logs structured telemetry on successful attempt with token usage and finishReason', async () => {
        const infoLogs: any[] = [];
        const mockLogger = {
          info: vi.fn((obj) => infoLogs.push(obj)),
          warn: vi.fn(),
          error: vi.fn(),
        };

        const provider = new GeminiAIProvider({
          apiKey: 'test-fake-key-logger',
          logger: mockLogger,
        });

        mockInstances[0].models.generateContent.mockResolvedValueOnce({
          text: JSON.stringify(sampleOutput),
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: {
            promptTokenCount: 1500,
            candidatesTokenCount: 420,
            totalTokenCount: 1920,
          },
        });

        const result = await provider.explain({
          topic: 'overview',
          repoName: 'test/repo',
          context: 'grounded context',
        });

        expect(result.summary).toBe(sampleOutput.summary);
        expect(mockLogger.info).toHaveBeenCalledTimes(1);
        expect(infoLogs[0]).toMatchObject({
          event: 'gemini_provider_attempt',
          provider: 'gemini',
          tier: 'primary',
          model: 'gemini-3.8-flash',
          attempt: 1,
          httpStatus: 200,
          finishReason: 'STOP',
          tokenUsage: {
            promptTokens: 1500,
            candidatesTokens: 420,
            totalTokens: 1920,
          },
        });
        expect(infoLogs[0].latencyMs).toBeGreaterThanOrEqual(0);
        // Secrets must not be in log object
        expect(JSON.stringify(infoLogs[0])).not.toContain('test-fake-key-logger');
      });

      it('logs structured telemetry on failed attempt with error classification and redacted secrets', async () => {
        const warnLogs: any[] = [];
        const mockLogger = {
          info: vi.fn(),
          warn: vi.fn((obj) => warnLogs.push(obj)),
          error: vi.fn(),
        };

        const secretKey = 'SECRET_GEMINI_KEY_999';
        const provider = new GeminiAIProvider({
          apiKey: secretKey,
          logger: mockLogger,
          maxRetries: 0,
        });

        mockInstances[0].models.generateContent.mockRejectedValueOnce(
          new Error(`HTTP 503 Service Unavailable for key ${secretKey}`)
        );

        await expect(
          provider.explain({
            topic: 'overview',
            repoName: 'test/repo',
            context: 'grounded context',
          })
        ).rejects.toThrow();

        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
        expect(warnLogs[0]).toMatchObject({
          event: 'gemini_provider_attempt',
          provider: 'gemini',
          tier: 'primary',
          model: 'gemini-3.8-flash',
          attempt: 1,
          httpStatus: 503,
          errorClass: 'service_unavailable',
        });
        expect(warnLogs[0].latencyMs).toBeGreaterThanOrEqual(0);
        expect(warnLogs[0].errorMessage).toContain('[REDACTED]');
        expect(warnLogs[0].errorMessage).not.toContain(secretKey);
      });
    });
  });
});
