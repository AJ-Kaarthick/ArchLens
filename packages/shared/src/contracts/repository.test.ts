import { describe, it, expect } from 'vitest';
import {
  parseGitHubRepo,
  RepoInputSchema,
  AnalysisResultSchema,
  LandmarkContentSchema,
  ApiErrorSchema,
} from './repository.js';

describe('Shared Contracts - repository', () => {
  describe('parseGitHubRepo', () => {
    it('parses owner/repo shorthand', () => {
      const res = parseGitHubRepo('facebook/react');
      expect(res).toEqual({ owner: 'facebook', repo: 'react' });
    });

    it('parses https github URLs', () => {
      const res = parseGitHubRepo('https://github.com/facebook/react');
      expect(res).toEqual({ owner: 'facebook', repo: 'react' });
    });

    it('parses https github URLs with .git suffix', () => {
      const res = parseGitHubRepo('https://github.com/facebook/react.git');
      expect(res).toEqual({ owner: 'facebook', repo: 'react' });
    });

    it('parses github.com/owner/repo without protocol', () => {
      const res = parseGitHubRepo('github.com/facebook/react');
      expect(res).toEqual({ owner: 'facebook', repo: 'react' });
    });

    it('parses ssh format', () => {
      const res = parseGitHubRepo('git@github.com:facebook/react.git');
      expect(res).toEqual({ owner: 'facebook', repo: 'react' });
    });

    it('handles trailing slash and subpaths', () => {
      const res = parseGitHubRepo('https://github.com/facebook/react/tree/main');
      expect(res).toEqual({ owner: 'facebook', repo: 'react' });
    });

    it('returns null for invalid inputs', () => {
      expect(parseGitHubRepo('')).toBeNull();
      expect(parseGitHubRepo('just-a-string')).toBeNull();
      expect(parseGitHubRepo('https://gitlab.com/foo/bar')).toBeNull();
    });
  });

  describe('RepoInputSchema', () => {
    it('transforms url input to owner and repo', () => {
      const result = RepoInputSchema.parse({ url: 'https://github.com/facebook/react' });
      expect(result).toEqual({ owner: 'facebook', repo: 'react' });
    });

    it('transforms owner and repo fields', () => {
      const result = RepoInputSchema.parse({ owner: 'facebook', repo: 'react' });
      expect(result).toEqual({ owner: 'facebook', repo: 'react' });
    });

    it('fails on invalid url', () => {
      expect(() => RepoInputSchema.parse({ url: 'invalid' })).toThrow();
    });
  });

  describe('AnalysisResultSchema', () => {
    it('validates valid analysis result object', () => {
      const validData = {
        repository: {
          id: '12345',
          owner: 'test-owner',
          name: 'test-repo',
          url: 'https://github.com/test-owner/test-repo',
          defaultBranch: 'main',
          description: 'A test repo',
          stars: 42,
          forks: 5,
          primaryLanguage: 'TypeScript',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
        },
        commitSha: 'abcdef1234567890',
        techStack: [
          {
            category: 'framework',
            name: 'React',
            version: '^18.2.0',
            confidence: 'high',
            evidence: 'package.json dependencies',
          },
        ],
        architecture: {
          isMonorepo: false,
          monorepoTool: null,
          workspaces: [],
          detectedPatterns: ['Client-Server'],
          primaryEntrypoints: ['src/index.ts'],
          keyLandmarks: [
            {
              path: 'README.md',
              name: 'README.md',
              type: 'doc',
            },
          ],
        },
        metrics: {
          totalFiles: 10,
          totalBytes: 5000,
          languages: {
            TypeScript: {
              bytes: 4000,
              percentage: 80,
              fileCount: 8,
            },
          },
          categories: {
            source: {
              bytes: 4000,
              percentage: 80,
              fileCount: 8,
            },
          },
          largestFiles: [
            {
              path: 'src/index.ts',
              size: 1500,
            },
          ],
        },
        tree: [
          {
            path: 'src/index.ts',
            name: 'index.ts',
            type: 'file',
            size: 1500,
            extension: '.ts',
            category: 'source',
            isLandmark: false,
          },
        ],
        analyzedAt: '2024-01-02T12:00:00Z',
      };

      const parsed = AnalysisResultSchema.parse(validData);
      expect(parsed.repository.name).toBe('test-repo');
      expect(parsed.techStack).toHaveLength(1);
    });
  });

  describe('LandmarkContentSchema', () => {
    it('validates landmark content payload', () => {
      const data = {
        path: 'README.md',
        name: 'README.md',
        size: 120,
        content: '# Test Project\n\nHello world',
        encoding: 'utf-8',
        isTruncated: false,
      };
      const parsed = LandmarkContentSchema.parse(data);
      expect(parsed.path).toBe('README.md');
      expect(parsed.content).toContain('# Test Project');
    });
  });

  describe('ApiErrorSchema', () => {
    it('validates api error payload with default fields', () => {
      const parsed = ApiErrorSchema.parse({
        error: 'RateLimitExceeded',
        message: 'API rate limit reached',
      });
      expect(parsed.isRateLimit).toBe(false);
      expect(parsed.suggestedAction).toBeNull();
    });
  });
});
