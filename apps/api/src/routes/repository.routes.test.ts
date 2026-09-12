import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../server.js';
import { RepositoryService } from '../services/repository.service.js';
import { GitHubRateLimitError } from '../services/github.service.js';
import type { AnalysisResult, LandmarkContent } from '@archlens/shared';

describe('Repository Fastify Routes', () => {
  const mockAnalysis: AnalysisResult = {
    repository: {
      id: '42',
      owner: 'mock-owner',
      name: 'mock-repo',
      url: 'https://github.com/mock-owner/mock-repo',
      defaultBranch: 'main',
      description: 'Mock repo description',
      stars: 120,
      forks: 15,
      primaryLanguage: 'TypeScript',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    },
    commitSha: 'sha-abc',
    techStack: [
      {
        category: 'framework',
        name: 'React',
        version: '18.2.0',
        confidence: 'high',
        evidence: 'package.json',
      },
    ],
    architecture: {
      isMonorepo: false,
      monorepoTool: null,
      workspaces: [],
      detectedPatterns: ['Client-Server'],
      primaryEntrypoints: ['src/index.ts'],
      keyLandmarks: [],
    },
    metrics: {
      totalFiles: 5,
      totalBytes: 2500,
      languages: {
        TypeScript: { bytes: 2000, percentage: 80, fileCount: 4 },
      },
      categories: {
        source: { bytes: 2000, percentage: 80, fileCount: 4 },
      },
      largestFiles: [{ path: 'src/index.ts', size: 1000 }],
    },
    tree: [
      {
        path: 'src/index.ts',
        name: 'index.ts',
        type: 'file',
        size: 1000,
        extension: '.ts',
        category: 'source',
        isLandmark: false,
      },
    ],
    analyzedAt: '2024-01-02T12:00:00Z',
  };

  const mockLandmark: LandmarkContent = {
    path: 'README.md',
    name: 'README.md',
    size: 45,
    content: '# ArchLens\n\nFast deterministic code analysis',
    encoding: 'utf-8',
    isTruncated: false,
  };

  it('POST /api/analyze returns 200 and AnalysisResult on valid repository', async () => {
    const mockService = {
      analyze: vi.fn().mockResolvedValue(mockAnalysis),
      getLatestAnalysis: vi.fn(),
      getLandmarkContent: vi.fn(),
    } as unknown as RepositoryService;

    const app = buildApp({ logger: false, repositoryService: mockService });

    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      payload: { url: 'https://github.com/mock-owner/mock-repo' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.repository.name).toBe('mock-repo');
    expect(body.techStack[0].name).toBe('React');
  });

  it('POST /api/analyze returns 429 with ApiError schema when GitHub is rate-limited', async () => {
    const resetDate = new Date(Date.now() + 600000);
    const mockService = {
      analyze: vi
        .fn()
        .mockRejectedValue(new GitHubRateLimitError('Rate limit exceeded', resetDate)),
      getLatestAnalysis: vi.fn(),
      getLandmarkContent: vi.fn(),
    } as unknown as RepositoryService;

    const app = buildApp({ logger: false, repositoryService: mockService });

    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      payload: { url: 'mock-owner/mock-repo' },
    });

    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('RateLimitExceeded');
    expect(body.isRateLimit).toBe(true);
    expect(body.suggestedAction).toBeDefined();
  });

  it('POST /api/analyze returns 400 on invalid repository input', async () => {
    const app = buildApp({ logger: false });

    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      payload: { url: 'not-a-valid-github-url' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('ValidationError');
    expect(body.suggestedAction).toBeDefined();
  });

  it('GET /api/repository/latest-analysis returns 200 with latest analysis', async () => {
    const mockService = {
      analyze: vi.fn(),
      getLatestAnalysis: vi.fn().mockResolvedValue(mockAnalysis),
      getLandmarkContent: vi.fn(),
    } as unknown as RepositoryService;

    const app = buildApp({ logger: false, repositoryService: mockService });

    const res = await app.inject({
      method: 'GET',
      url: '/api/repository/latest-analysis?owner=mock-owner&repo=mock-repo',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.repository.name).toBe('mock-repo');
  });

  it('GET /api/repositories/:owner/:repo/landmark-content returns 200 with LandmarkContent', async () => {
    const mockService = {
      analyze: vi.fn(),
      getLatestAnalysis: vi.fn(),
      getLandmarkContent: vi.fn().mockResolvedValue(mockLandmark),
    } as unknown as RepositoryService;

    const app = buildApp({ logger: false, repositoryService: mockService });

    const res = await app.inject({
      method: 'GET',
      url: '/api/repositories/mock-owner/mock-repo/landmark-content?path=README.md',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('README.md');
    expect(body.content).toContain('# ArchLens');
  });

  it('GET /api/repositories/recent returns 200 with recent repositories list', async () => {
    const mockRecents = [
      {
        owner: 'fastify',
        name: 'fastify',
        language: 'TypeScript',
        analyzedAt: '2026-09-12T10:00:00Z',
        stars: 32000,
      },
      {
        owner: 'facebook',
        name: 'react',
        language: 'JavaScript',
        analyzedAt: '2026-09-12T09:00:00Z',
        stars: 220000,
      },
    ];

    const mockService = {
      analyze: vi.fn(),
      getLatestAnalysis: vi.fn(),
      getLandmarkContent: vi.fn(),
      getRecentRepositories: vi.fn().mockResolvedValue(mockRecents),
    } as unknown as RepositoryService;

    const app = buildApp({ logger: false, repositoryService: mockService });

    const res = await app.inject({
      method: 'GET',
      url: '/api/repositories/recent?limit=5',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0].owner).toBe('fastify');
    expect(body[0].stars).toBe(32000);
  });

  it('GET /api/repositories/recent returns 200 with empty array when no repositories analyzed', async () => {
    const mockService = {
      analyze: vi.fn(),
      getLatestAnalysis: vi.fn(),
      getLandmarkContent: vi.fn(),
      getRecentRepositories: vi.fn().mockResolvedValue([]),
    } as unknown as RepositoryService;

    const app = buildApp({ logger: false, repositoryService: mockService });

    const res = await app.inject({
      method: 'GET',
      url: '/api/repositories/recent',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual([]);
  });

  it('GET /api/repositories/:owner/:repo/latest returns 404 when unanalyzed', async () => {
    const mockService = {
      analyze: vi.fn(),
      getLatestAnalysis: vi.fn().mockResolvedValue(null),
      getLandmarkContent: vi.fn(),
      getRecentRepositories: vi.fn(),
    } as unknown as RepositoryService;

    const app = buildApp({ logger: false, repositoryService: mockService });

    const res = await app.inject({
      method: 'GET',
      url: '/api/repositories/unknown-owner/unknown-repo/latest',
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('NotFound');
  });
});
