import type { ExplainTopic, EvidenceCitation, AnalysisResult } from '@archlens/shared';

export class AIRateLimitError extends Error {
  readonly status = 429;
  readonly isRateLimit = true;
  readonly suggestedAction: string;

  constructor(
    message = 'AI provider rate limit or quota exceeded. Please try again shortly.',
    suggestedAction = 'Wait a moment before requesting another AI explanation, or switch to MockAIProvider.'
  ) {
    super(message);
    this.name = 'AIRateLimitError';
    this.suggestedAction = suggestedAction;
  }
}

export interface AIExplanationRequest {
  topic: ExplainTopic;
  target?: string | null;
  context: string;
  repoName: string;
  analysis?: AnalysisResult;
}

export interface AIExplanationResult {
  summary: string;
  explanation: string;
  keyTakeaways: string[];
  evidence: EvidenceCitation[];
  provider: string;
  model: string;
}

export interface IAIProvider {
  readonly name: string;
  readonly model: string;
  explain(request: AIExplanationRequest): Promise<AIExplanationResult>;
}

