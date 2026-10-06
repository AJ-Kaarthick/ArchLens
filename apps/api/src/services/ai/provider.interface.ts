import type { ExplainTopic, EvidenceCitation, AnalysisResult } from '@archlens/shared';

export class AIRateLimitError extends Error {
  readonly status = 429;
  readonly isRateLimit = true;
  readonly suggestedAction: string;

  constructor(
    message = 'AI provider rate limit or quota exceeded. Please try again shortly.',
    suggestedAction = 'Please wait a moment before requesting another AI explanation.'
  ) {
    super(message);
    this.name = 'AIRateLimitError';
    this.suggestedAction = suggestedAction;
  }
}

export class AITemporaryUnavailableError extends Error {
  readonly status = 503;
  readonly isRateLimit = false;
  readonly isTemporaryUnavailable = true;
  readonly suggestedAction: string;

  constructor(
    message = 'The AI explanation service is temporarily unavailable. Please try again shortly.',
    suggestedAction = 'Please wait a moment and click Retry.'
  ) {
    super(message);
    this.name = 'AITemporaryUnavailableError';
    this.suggestedAction = suggestedAction;
  }
}

export interface AIExplanationRequest {
  topic: ExplainTopic;
  target?: string | null;
  context: string;
  repoName: string;
  analysis?: AnalysisResult;
  signal?: AbortSignal;
  deadlineMs?: number;
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
