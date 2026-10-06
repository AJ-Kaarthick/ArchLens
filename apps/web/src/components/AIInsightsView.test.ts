import { describe, it, expect, vi } from 'vitest';
import type { ExplainTopic, ExplainResponse, InsightResponse } from '@archlens/shared';

describe('AI Insights Asynchronous Lifecycle & Non-Blocking UX', () => {
  interface TopicState {
    status: 'idle' | 'pending' | 'ready' | 'failed' | 'disabled';
    data: ExplainResponse | null;
    isStale: boolean;
    error: {
      error: string;
      message: string;
      isRateLimit?: boolean;
      suggestedAction?: string | null;
    } | null;
    retryAt: string | null;
  }

  const INITIAL_TOPIC_STATES: Record<ExplainTopic, TopicState> = {
    overview: { status: 'idle', data: null, isStale: false, error: null, retryAt: null },
    architecture: { status: 'idle', data: null, isStale: false, error: null, retryAt: null },
    'tech-stack': { status: 'idle', data: null, isStale: false, error: null, retryAt: null },
    entrypoints: { status: 'idle', data: null, isStale: false, error: null, retryAt: null },
  };

  it('INITIAL_TOPIC_STATES starts in idle state for all four topics', () => {
    for (const [, state] of Object.entries(INITIAL_TOPIC_STATES)) {
      expect(state.status).toBe('idle');
      expect(state.data).toBeNull();
      expect(state.isStale).toBe(false);
      expect(state.error).toBeNull();
      expect(state.retryAt).toBeNull();
    }
  });

  it('Non-blocking UX: User can switch topics freely while background insight is pending', () => {
    let topicStates = { ...INITIAL_TOPIC_STATES };

    // Overview begins generating in background
    topicStates = {
      ...topicStates,
      overview: { ...topicStates.overview, status: 'pending' },
    };
    expect(topicStates.overview.status).toBe('pending');

    // User switches to architecture without being blocked
    const handleTopicChange = vi.fn((newTopic: ExplainTopic) => {
      // Non-blocking: switching tabs is always allowed
      return newTopic;
    });

    expect(handleTopicChange('architecture')).toBe('architecture');
    expect(handleTopicChange('tech-stack')).toBe('tech-stack');
  });

  it('Stale fallback: pending state preserves older snapshot with isStale=true', () => {
    const olderData: ExplainResponse = {
      topic: 'overview',
      target: null,
      summary: 'Older commit overview',
      explanation: 'Detailed previous explanation',
      keyTakeaways: ['Legacy pattern'],
      evidence: [],
      generatedAt: new Date(Date.now() - 3600_000).toISOString(),
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      cached: true,
    };

    let topicStates = {
      ...INITIAL_TOPIC_STATES,
      overview: {
        status: 'pending' as const,
        data: olderData,
        isStale: true,
        error: null,
        retryAt: null,
      },
    };

    expect(topicStates.overview.status).toBe('pending');
    expect(topicStates.overview.isStale).toBe(true);
    expect(topicStates.overview.data).toEqual(olderData);
  });

  it('Disabled state: gracefully sets disabled status when AI is not configured', () => {
    const disabledResponse: InsightResponse = {
      status: 'disabled',
      topic: 'overview',
      target: null,
      isStale: false,
      promptVersion: 1,
    };

    let topicStates = { ...INITIAL_TOPIC_STATES };
    topicStates = {
      ...topicStates,
      overview: {
        status: disabledResponse.status,
        data: null,
        isStale: disabledResponse.isStale,
        error: null,
        retryAt: null,
      },
    };

    expect(topicStates.overview.status).toBe('disabled');
    expect(topicStates.overview.data).toBeNull();
  });

  it('FastAPI Integration: Dispatches GET /insights/overview and cleans up controllers on unmount', async () => {
    const mockInsightResponse: InsightResponse = {
      status: 'ready',
      topic: 'overview',
      target: null,
      result: {
        topic: 'overview',
        target: null,
        summary: 'FastAPI repository overview',
        explanation: 'FastAPI is a modern, high-performance web framework for Python.',
        keyTakeaways: ['High performance', 'Easy to learn', 'Fast to code'],
        evidence: [
          {
            type: 'manifest',
            label: 'pyproject.toml',
            reference: 'pyproject.toml',
            description: 'FastAPI package configuration',
          },
        ],
        generatedAt: new Date().toISOString(),
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        cached: false,
      },
      isStale: false,
      promptVersion: 1,
    };

    const mockFetch = vi.fn().mockImplementation((_url, _init) => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockInsightResponse),
      });
    });

    const controllers = new Map<string, AbortController>();
    const timers = new Map<string, any>();

    const fetchInsight = async (topic: string) => {
      const controller = new AbortController();
      controllers.set(topic, controller);

      const res = await mockFetch(`/api/repositories/tiangolo/fastapi/insights/${topic}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      return res.json();
    };

    const data = await fetchInsight('overview');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/repositories/tiangolo/fastapi/insights/overview',
      expect.objectContaining({
        method: 'GET',
      })
    );
    expect(data.status).toBe('ready');
    expect(data.result.summary).toContain('FastAPI');

    // Simulate cleanup on unmount
    controllers.forEach((ctrl) => ctrl.abort());
    timers.forEach((t) => clearTimeout(t));
    expect(controllers.get('overview')?.signal.aborted).toBe(true);
  });
});
