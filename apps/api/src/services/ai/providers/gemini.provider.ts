import { GoogleGenAI } from '@google/genai';
import { AIExplanationResultSchema } from '@archlens/shared';
import {
  AIExplanationRequest,
  AIExplanationResult,
  IAIProvider,
  AIRateLimitError,
} from '../provider.interface.js';

export class GeminiRateLimitError extends AIRateLimitError {
  constructor(
    message: string,
    suggestedAction = 'Wait a moment before requesting another AI explanation, or switch to MockAIProvider.'
  ) {
    super(message, suggestedAction);
    this.name = 'GeminiRateLimitError';
  }
}

export class GeminiAIProvider implements IAIProvider {
  readonly name = 'gemini';
  readonly model: string;
  private client: GoogleGenAI;
  private timeoutMs: number;

  constructor(options: { apiKey?: string; model?: string; timeoutMs?: number } = {}) {
    const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required for GeminiAIProvider');
    }
    this.model = options.model || process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.client = new GoogleGenAI({ apiKey });
  }


  async explain(request: AIExplanationRequest): Promise<AIExplanationResult> {
    const abortController = new AbortController();

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        abortController.abort();
        reject(new Error(`Gemini AI provider request timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      // Prevent timer from keeping the event loop alive if done early
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    });

    const executionPromise = (async () => {
      try {
        const response = await this.client.models.generateContent({
          model: this.model,
          contents: request.context,
          config: {
            temperature: 0.2,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
            abortSignal: abortController.signal,
          },
        });

        const text = response.text;
        if (!text) {
          throw new Error('Gemini API returned an empty response');
        }

        // Strip markdown fences if the LLM outputted ```json ... ```
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
          model: this.model,
        };
      } catch (err: unknown) {
        if (err instanceof Error) {
          const lower = err.message.toLowerCase();
          if (
            lower.includes('429') ||
            lower.includes('quota') ||
            lower.includes('resource_exhausted') ||
            lower.includes('rate limit')
          ) {
            throw new GeminiRateLimitError(
              'Gemini API rate limit or quota exceeded. Please try again shortly.'
            );
          }
        }
        throw err;
      }
    })();

    return Promise.race([executionPromise, timeoutPromise]);
  }
}
