import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GitHubService,
  GitHubRateLimitError,
  GitHubNotFoundError,
  GitHubTreeTooLargeError,
  MAX_TREE_ITEMS,
} from './github.service.js';

describe('GitHubService (Offline / Mocked)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('handles 403 / 429 rate limits and throws GitHubRateLimitError with reset timestamp', async () => {
    const resetTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour in future

    const createMockResponse = () =>
      new Response(
        JSON.stringify({
          message: 'API rate limit exceeded for user. Please check documentation.',
          documentation_url:
            'https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting',
        }),
        {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(resetTimestamp),
            'content-type': 'application/json',
          },
        }
      );

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => createMockResponse());

    const service = new GitHubService({ baseUrl: 'https://api.github.com' });

    await expect(service.getRepositoryMetadata('testowner', 'testrepo')).rejects.toThrow(
      GitHubRateLimitError
    );

    // Verify error properties
    try {
      await service.getRepositoryMetadata('testowner', 'testrepo');
    } catch (err: any) {
      expect(err).toBeInstanceOf(GitHubRateLimitError);
      expect(err.isRateLimit).toBe(true);
      expect(err.message).toContain('API rate limit exceeded');
      expect(err.resetAt).toBeInstanceOf(Date);
      expect(err.suggestedAction).toContain('rate limit');
    }
  });

  it('enforces 10,000-item tree bound and throws GitHubTreeTooLargeError', async () => {
    // Generate mock tree of 10,001 items
    const largeTree = Array.from({ length: MAX_TREE_ITEMS + 1 }, (_, i) => ({
      path: `file_${i}.ts`,
      mode: '100644',
      type: 'blob' as const,
      sha: `sha_${i}`,
      size: 100,
    }));

    const mockResponse = new Response(
      JSON.stringify({
        sha: 'root-sha',
        url: 'https://api.github.com/tree',
        tree: largeTree,
        truncated: false,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

    const service = new GitHubService();

    await expect(service.getGitTree('owner', 'large-repo', 'main')).rejects.toThrow(
      GitHubTreeTooLargeError
    );
  });

  it('handles truncated: true tree flag as exceeding bound', async () => {
    const mockResponse = new Response(
      JSON.stringify({
        sha: 'root-sha',
        url: 'https://api.github.com/tree',
        tree: [],
        truncated: true,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

    const service = new GitHubService();

    await expect(service.getGitTree('owner', 'truncated-repo', 'main')).rejects.toThrow(
      GitHubTreeTooLargeError
    );
  });

  it('enforces landmark content size bound of 256KB and returns truncated flag', async () => {
    const oversizedBytes = 300 * 1024; // 300 KB
    const mockResponse = new Response(
      JSON.stringify({
        name: 'large-file.json',
        path: 'large-file.json',
        size: oversizedBytes,
        encoding: 'base64',
        content: Buffer.from('test').toString('base64'),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

    const service = new GitHubService();
    const result = await service.getFileContent('owner', 'repo', 'large-file.json');

    expect(result.isTruncated).toBe(true);
    expect(result.content).toContain('exceeds display limit');
  });

  it('throws GitHubNotFoundError on 404 response', async () => {
    const mockResponse = new Response(JSON.stringify({ message: 'Not Found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

    const service = new GitHubService();
    await expect(service.getRepositoryMetadata('nonexistent', 'missing')).rejects.toThrow(
      GitHubNotFoundError
    );
  });
});
