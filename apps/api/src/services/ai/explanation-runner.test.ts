import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ExplanationRunner,
  calculateBackoffMs,
  type ExplanationJob,
} from './explanation-runner.js';
import type { AIService } from './ai.service.js';

// Mock DB interactions for runner unit tests
vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ attemptCount: 1 }]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

describe('ExplanationRunner', () => {
  let runner: ExplanationRunner;

  beforeEach(() => {
    runner = new ExplanationRunner(2);
  });

  describe('calculateBackoffMs', () => {
    it('returns 1m for first attempt', () => {
      expect(calculateBackoffMs(0)).toBe(60_000);
      expect(calculateBackoffMs(1)).toBe(60_000);
    });

    it('returns 2m for second attempt', () => {
      expect(calculateBackoffMs(2)).toBe(120_000);
    });

    it('returns 5m for third attempt', () => {
      expect(calculateBackoffMs(3)).toBe(300_000);
    });

    it('returns 10m for fourth and further attempts', () => {
      expect(calculateBackoffMs(4)).toBe(600_000);
      expect(calculateBackoffMs(5)).toBe(600_000);
    });
  });

  describe('getLogicalKey & Deduplication', () => {
    it('constructs consistent logical key', () => {
      const key = runner.getLogicalKey(42, 'sha123', 'overview', 'src/server.ts', 1);
      expect(key).toBe('42:sha123:overview:src/server.ts:1');
    });

    it('handles null target in key', () => {
      const key = runner.getLogicalKey(42, 'sha123', 'overview', null, 1);
      expect(key).toBe('42:sha123:overview::1');
    });

    it('rejects duplicate jobs for same key when already active or queued', () => {
      // Mock aiService that does not finish immediately
      const mockAiService = {
        generateExplanation: vi.fn().mockReturnValue(new Promise(() => {})),
      } as unknown as AIService;
      runner.setAiService(mockAiService);

      const job: Omit<ExplanationJob, 'key' | 'abortController'> = {
        repoId: 1,
        commitSha: 'sha1',
        owner: 'test',
        repo: 'repo',
        topic: 'overview',
        target: null,
        promptVersion: 1,
      };

      const first = runner.enqueue(job);
      const duplicate = runner.enqueue(job);

      expect(first).toBe(true);
      expect(duplicate).toBe(false);
      expect(runner.getActiveJobsCount()).toBe(1);
    });
  });

  describe('Concurrency Bounding', () => {
    it('limits concurrent job execution to concurrencyLimit', () => {
      const mockAiService = {
        generateExplanation: vi.fn().mockReturnValue(new Promise(() => {})),
      } as unknown as AIService;
      runner.setAiService(mockAiService);

      // Enqueue 3 different jobs
      runner.enqueue({
        repoId: 1,
        commitSha: 'sha1',
        owner: 'test',
        repo: 'repo',
        topic: 'overview',
        target: null,
        promptVersion: 1,
      });

      runner.enqueue({
        repoId: 1,
        commitSha: 'sha1',
        owner: 'test',
        repo: 'repo',
        topic: 'architecture',
        target: null,
        promptVersion: 1,
      });

      runner.enqueue({
        repoId: 1,
        commitSha: 'sha1',
        owner: 'test',
        repo: 'repo',
        topic: 'tech-stack',
        target: null,
        promptVersion: 1,
      });

      expect(runner.getActiveJobsCount()).toBe(2);
      expect(runner.getQueueLength()).toBe(1);
    });
  });

  describe('Cancellation', () => {
    it('cancels active job and triggers its AbortController', () => {
      let aborted = false;
      const mockAiService = {
        generateExplanation: vi.fn().mockImplementation((_o, _r, _t, _tg, _pv, signal: AbortSignal) => {
          signal.addEventListener('abort', () => {
            aborted = true;
          });
          return new Promise(() => {});
        }),
      } as unknown as AIService;
      runner.setAiService(mockAiService);

      const job = {
        repoId: 99,
        commitSha: 'sha99',
        owner: 'test',
        repo: 'repo',
        topic: 'overview' as const,
        target: null,
        promptVersion: 1,
      };

      runner.enqueue(job);
      expect(runner.getActiveJobsCount()).toBe(1);

      const key = runner.getLogicalKey(job.repoId, job.commitSha, job.topic, job.target, job.promptVersion);
      runner.cancel(key);

      expect(aborted).toBe(true);
      expect(runner.getActiveJobsCount()).toBe(0);
    });
  });
});
