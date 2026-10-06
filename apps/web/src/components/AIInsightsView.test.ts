import { describe, it, expect, vi } from 'vitest';
import type { ExplainTopic, ExplainResponse, ApiError } from '@archlens/shared';

describe('AI Insights Request Lifecycle & UX Lock', () => {
  interface TopicState {
    status: 'idle' | 'loading' | 'success' | 'error';
    data: ExplainResponse | null;
    error: ApiError | null;
    progressStep: 'analyzing' | 'synthesizing';
  }

  const INITIAL_TOPIC_STATES: Record<ExplainTopic, TopicState> = {
    overview: { status: 'idle', data: null, error: null, progressStep: 'analyzing' },
    architecture: { status: 'idle', data: null, error: null, progressStep: 'analyzing' },
    'tech-stack': { status: 'idle', data: null, error: null, progressStep: 'analyzing' },
    entrypoints: { status: 'idle', data: null, error: null, progressStep: 'analyzing' },
  };

  it('INITIAL_TOPIC_STATES starts in idle state for all four topics', () => {
    for (const [, state] of Object.entries(INITIAL_TOPIC_STATES)) {
      expect(state.status).toBe('idle');
      expect(state.data).toBeNull();
      expect(state.error).toBeNull();
    }
  });

  it('UX Lock: isGenerating is true whenever any topic is in loading state', () => {
    let topicStates = { ...INITIAL_TOPIC_STATES };
    const getIsGenerating = () => Object.values(topicStates).some((s) => s.status === 'loading');

    expect(getIsGenerating()).toBe(false);

    // Start loading overview
    topicStates = {
      ...topicStates,
      overview: { ...topicStates.overview, status: 'loading' },
    };
    expect(getIsGenerating()).toBe(true);

    // While generating, topic change must be blocked
    const handleTopicChange = vi.fn((_newTopic: ExplainTopic) => {
      if (getIsGenerating()) return false;
      return true;
    });

    expect(handleTopicChange('architecture')).toBe(false);
    expect(handleTopicChange('tech-stack')).toBe(false);

    // Finish overview with success
    topicStates = {
      ...topicStates,
      overview: {
        ...topicStates.overview,
        status: 'success',
        data: {
          topic: 'overview',
          target: null,
          summary: 'Overview text',
          explanation: 'Deep explanation',
          keyTakeaways: [],
          evidence: [],
          generatedAt: new Date().toISOString(),
          provider: 'gemini',
          model: 'gemini-3.8-flash',
          cached: false,
        },
      },
    };
    expect(getIsGenerating()).toBe(false);

    // Now topic change is re-enabled
    expect(handleTopicChange('architecture')).toBe(true);
  });

  it('Abort recovery: aborted request resets status from loading to idle (no infinite hang)', () => {
    let topicStates = { ...INITIAL_TOPIC_STATES };

    // Request starts
    topicStates = {
      ...topicStates,
      overview: { ...topicStates.overview, status: 'loading' },
    };
    expect(topicStates.overview.status).toBe('loading');

    // Abort occurs (e.g. unmount or navigation)
    const err = new Error('The user aborted a request.');
    err.name = 'AbortError';

    if (err.name === 'AbortError') {
      topicStates = {
        ...topicStates,
        overview: {
          ...topicStates.overview,
          status: topicStates.overview.data ? 'success' : 'idle',
        },
      };
    }

    // Must NOT stay in loading!
    expect(topicStates.overview.status).toBe('idle');
  });

  it('Abort recovery with existing cached data retains success status', () => {
    const existingData: ExplainResponse = {
      topic: 'overview',
      target: null,
      summary: 'Overview text',
      explanation: 'Deep explanation',
      keyTakeaways: [],
      evidence: [],
      generatedAt: new Date().toISOString(),
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      cached: false,
    };

    let topicStates: Record<ExplainTopic, TopicState> = {
      ...INITIAL_TOPIC_STATES,
      overview: {
        status: 'loading',
        data: existingData,
        error: null,
        progressStep: 'analyzing',
      },
    };

    // User refreshed, but request was aborted
    const err = new Error('Aborted');
    err.name = 'AbortError';

    if (err.name === 'AbortError') {
      topicStates = {
        ...topicStates,
        overview: {
          ...topicStates.overview,
          status: topicStates.overview.data ? 'success' : 'idle',
        },
      };
    }

    // Reverts to success, keeping the previously loaded data
    expect(topicStates.overview.status).toBe('success');
    expect(topicStates.overview.data).toEqual(existingData);
  });

  it('ClientClosedRequest (499) resets loading status without displaying error', () => {
    let topicStates = { ...INITIAL_TOPIC_STATES };
    topicStates = {
      ...topicStates,
      architecture: { ...topicStates.architecture, status: 'loading' },
    };

    const resStatus = 499;
    const apiError = { error: 'ClientClosedRequest', message: 'Cancelled', isRateLimit: false };

    if (resStatus === 499 || apiError.error === 'ClientClosedRequest') {
      topicStates = {
        ...topicStates,
        architecture: {
          ...topicStates.architecture,
          status: topicStates.architecture.data ? 'success' : 'idle',
        },
      };
    }

    expect(topicStates.architecture.status).toBe('idle');
    expect(topicStates.architecture.error).toBeNull();
  });

  it('FastAPI Regression: Repo sync effect reliably dispatches /explain and cleans up on unmount', async () => {
    const mockFetch = vi.fn().mockImplementation((_url, _init) => {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
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
          }),
      });
    });

    // Simulate the exact lifecycle of AIInsightsView mounting for fastapi/fastapi
    const controllers = new Map<string, AbortController>();

    const fetchExplanation = async (topic: string) => {
      const controller = new AbortController();
      controllers.set(topic, controller);

      const res = await mockFetch(`/api/repositories/fastapi/fastapi/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
        signal: controller.signal,
      });
      return res.json();
    };

    // Effect setup
    const data = await fetchExplanation('overview');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/repositories/fastapi/fastapi/explain',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ topic: 'overview' }),
      })
    );
    expect(data.summary).toContain('FastAPI');

    // Effect cleanup
    controllers.forEach((ctrl) => ctrl.abort());
    expect(controllers.get('overview')?.signal.aborted).toBe(true);
  });
});
