import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiAIProvider, GeminiRateLimitError } from './gemini.provider.js';

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        generateContent: vi.fn(),
      },
    })),
  };
});

describe('GeminiAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when apiKey is missing', () => {
    const oldKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    expect(() => new GeminiAIProvider()).toThrow('GEMINI_API_KEY is required');

    if (oldKey) {
      process.env.GEMINI_API_KEY = oldKey;
    }
  });

  it('defaults to gemini-2.0-flash and allows model override', () => {
    const defaultProvider = new GeminiAIProvider({ apiKey: 'test-fake-key' });
    expect(defaultProvider.model).toBe('gemini-2.0-flash');

    const customProvider = new GeminiAIProvider({
      apiKey: 'test-fake-key',
      model: 'gemini-1.5-pro',
    });
    expect(customProvider.model).toBe('gemini-1.5-pro');
  });


  it('successfully parses valid JSON response from Gemini', async () => {
    const provider = new GeminiAIProvider({ apiKey: 'test-fake-key' });
    const mockClient = (provider as any).client;

    const mockOutput = {
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

    mockClient.models.generateContent.mockResolvedValueOnce({
      text: JSON.stringify(mockOutput),
    });

    const result = await provider.explain({
      topic: 'overview',
      repoName: 'test/repo',
      context: 'grounded context',
    });

    expect(result.summary).toBe(mockOutput.summary);
    expect(result.explanation).toBe(mockOutput.explanation);
    expect(result.keyTakeaways).toEqual(mockOutput.keyTakeaways);
    expect(result.evidence).toEqual(mockOutput.evidence);
    expect(result.provider).toBe('gemini');
  });

  it('strips markdown code blocks from Gemini response before parsing', async () => {
    const provider = new GeminiAIProvider({ apiKey: 'test-fake-key' });
    const mockClient = (provider as any).client;

    const mockOutput = {
      summary: 'Code fence test summary.',
      explanation: 'Explanation.',
      keyTakeaways: ['Takeaway 1'],
      evidence: [],
    };

    mockClient.models.generateContent.mockResolvedValueOnce({
      text: `\`\`\`json\n${JSON.stringify(mockOutput)}\n\`\`\``,
    });

    const result = await provider.explain({
      topic: 'overview',
      repoName: 'test/repo',
      context: 'grounded context',
    });

    expect(result.summary).toBe(mockOutput.summary);
  });

  it('maps 429 and quota errors to GeminiRateLimitError', async () => {
    const provider = new GeminiAIProvider({ apiKey: 'test-fake-key' });
    const mockClient = (provider as any).client;

    mockClient.models.generateContent.mockRejectedValue(
      new Error('Resource has been exhausted (e.g. check quota): 429 Too Many Requests')
    );

    await expect(
      provider.explain({
        topic: 'overview',
        repoName: 'test/repo',
        context: 'grounded context',
      })
    ).rejects.toThrow(GeminiRateLimitError);

    try {
      await provider.explain({
        topic: 'overview',
        repoName: 'test/repo',
        context: 'grounded context',
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(GeminiRateLimitError);
      expect(err.isRateLimit).toBe(true);
      expect(err.status).toBe(429);
    }
  });
});

