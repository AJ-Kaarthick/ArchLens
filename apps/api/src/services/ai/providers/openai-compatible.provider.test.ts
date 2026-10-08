import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAICompatibleProvider } from './openai-compatible.provider.js';
import { AIRateLimitError, AITemporaryUnavailableError } from '../provider.interface.js';

describe('OpenAICompatibleProvider', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('successfully generates explanation from OpenAI-compatible endpoint', async () => {
    const mockPayload = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: 'Architecture summary of repository',
              explanation: 'Detailed walkthrough of the architectural modules',
              keyTakeaways: ['Key takeaway 1', 'Key takeaway 2'],
              evidence: [
                {
                  type: 'file',
                  label: 'src/main.ts',
                  reference: 'src/main.ts',
                  description: 'Application entrypoint',
                },
              ],
            }),
          },
        },
      ],
      usage: {
        total_tokens: 150,
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockPayload,
    } as any);

    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-secret-key-12345',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });

    const result = await provider.explain({
      topic: 'overview',
      context: 'repo context',
      repoName: 'test/repo',
    });

    expect(result.summary).toBe('Architecture summary of repository');
    expect(result.keyTakeaways).toHaveLength(2);
    expect(result.evidence).toHaveLength(1);
    expect(result.provider).toBe('openai-compatible');
    expect(result.model).toBe('gpt-4o-mini');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-secret-key-12345',
        }),
      })
    );
  });

  it('translates HTTP 429 to AIRateLimitError', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded',
    } as any);

    const provider = new OpenAICompatibleProvider({
      apiKey: 'key',
      maxRetries: 0,
    });

    await expect(
      provider.explain({
        topic: 'overview',
        context: 'context',
        repoName: 'test/repo',
      })
    ).rejects.toThrow(AIRateLimitError);
  });

  it('translates HTTP 503 to AITemporaryUnavailableError', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    } as any);

    const provider = new OpenAICompatibleProvider({
      apiKey: 'key',
      maxRetries: 0,
    });

    await expect(
      provider.explain({
        topic: 'overview',
        context: 'context',
        repoName: 'test/repo',
      })
    ).rejects.toThrow(AITemporaryUnavailableError);
  });

  it('redacts sensitive API keys from error messages', async () => {
    const sensitiveKey = 'sk-sensitive-1234567890abcdef';
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => `Invalid parameter with token ${sensitiveKey}`,
    } as any);

    const provider = new OpenAICompatibleProvider({
      apiKey: sensitiveKey,
      maxRetries: 0,
    });

    try {
      await provider.explain({
        topic: 'overview',
        context: 'context',
        repoName: 'test/repo',
      });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).not.toContain(sensitiveKey);
      expect(err.message).toContain('[REDACTED');
    }
  });

  it('aborts immediately when AbortSignal is already triggered', async () => {
    const provider = new OpenAICompatibleProvider();
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.explain({
        topic: 'overview',
        context: 'context',
        repoName: 'test/repo',
        signal: controller.signal,
      })
    ).rejects.toThrow(/aborted/i);
  });
});
