import '../config/env.js';
import type { RepositoryMetadata, LandmarkContent } from '@archlens/shared';

export class GitHubRateLimitError extends Error {
  readonly isRateLimit = true;
  readonly resetAt: Date | null;
  readonly suggestedAction: string;

  constructor(message: string, resetAt: Date | null = null) {
    super(message);
    this.name = 'GitHubRateLimitError';
    this.resetAt = resetAt;
    const timeStr = resetAt ? ` at ${resetAt.toLocaleTimeString()}` : '';
    this.suggestedAction = process.env.GITHUB_TOKEN
      ? `Rate limit reached. Please retry${timeStr}.`
      : `GitHub API rate limit exceeded for unauthenticated requests. Set the GITHUB_TOKEN environment variable on the server to increase your limit, or retry${timeStr}.`;
  }
}

export class GitHubNotFoundError extends Error {
  readonly notFound = true;
  constructor(owner: string, repo: string) {
    super(`GitHub repository '${owner}/${repo}' was not found or is private.`);
    this.name = 'GitHubNotFoundError';
  }
}

export class GitHubPrivateRepositoryError extends Error {
  readonly isPrivate = true;
  constructor(owner: string, repo: string) {
    super(
      `GitHub repository '${owner}/${repo}' is private. ArchLens currently supports public repositories only.`
    );
    this.name = 'GitHubPrivateRepositoryError';
  }
}

export class GitHubTimeoutError extends Error {
  readonly isTimeout = true;
  constructor(endpoint: string, timeoutMs: number) {
    super(`GitHub request to '${endpoint}' timed out after ${timeoutMs}ms.`);
    this.name = 'GitHubTimeoutError';
  }
}

export class GitHubTreeTooLargeError extends Error {
  readonly tooLarge = true;
  constructor(count: number, max: number) {
    super(
      `Repository tree has ${count} items, exceeding the maximum bounded limit of ${max} items. Full repository cloning is disabled.`
    );
    this.name = 'GitHubTreeTooLargeError';
  }
}

export class GitHubApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

export interface RawGitTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url?: string;
}

export interface RawGitTreeResponse {
  sha: string;
  url: string;
  tree: RawGitTreeItem[];
  truncated: boolean;
}

export interface HeadCommitInfo {
  commitSha: string;
  treeSha?: string;
}

export const MAX_TREE_ITEMS = 10000;
export const MAX_FILE_SIZE_BYTES = 256 * 1024; // 256 KB

export class GitHubService {
  private readonly baseUrl: string;
  private readonly token: string | undefined;

  constructor(options: { baseUrl?: string; token?: string } = {}) {
    this.baseUrl = options.baseUrl || 'https://api.github.com';
    this.token = options.token !== undefined ? options.token : process.env.GITHUB_TOKEN;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'ArchLens-Engine/1.0',
    };
    if (this.token && this.token.trim().length > 0) {
      headers.Authorization = `Bearer ${this.token.trim()}`;
    }
    return headers;
  }

  private handleRateLimit(res: Response, bodyText: string): void {
    const resetHeader = res.headers.get('x-ratelimit-reset');
    let resetDate: Date | null = null;
    if (resetHeader) {
      const resetEpoch = parseInt(resetHeader, 10);
      if (!isNaN(resetEpoch)) {
        resetDate = new Date(resetEpoch * 1000);
      }
    }

    let parsedMsg = 'GitHub API rate limit exceeded.';
    try {
      const json = JSON.parse(bodyText);
      if (json.message) {
        parsedMsg = json.message;
      }
    } catch {
      // ignore json parse error
    }

    throw new GitHubRateLimitError(parsedMsg, resetDate);
  }

  private async fetchGitHub(
    endpoint: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<Response> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    const timeoutMs = options.timeoutMs ?? 10000;
    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new GitHubTimeoutError(endpoint, timeoutMs));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    let combinedSignal: AbortSignal;
    if (options.signal) {
      if ('any' in AbortSignal && typeof (AbortSignal as any).any === 'function') {
        combinedSignal = (AbortSignal as any).any([options.signal, timeoutController.signal]);
      } else {
        const callerSignal = options.signal;
        callerSignal.addEventListener(
          'abort',
          () => timeoutController.abort(callerSignal.reason),
          { once: true }
        );
        combinedSignal = timeoutController.signal;
      }
    } else {
      combinedSignal = timeoutController.signal;
    }

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: combinedSignal,
      });

      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        const text = await res.text();
        if (remaining === '0' || text.toLowerCase().includes('rate limit')) {
          this.handleRateLimit(res, text);
        }
        throw new GitHubApiError(`GitHub API error (${res.status}): ${text}`, res.status);
      }

      return res;
    } catch (err: unknown) {
      if (timeoutController.signal.aborted && !options.signal?.aborted) {
        throw new GitHubTimeoutError(endpoint, timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async getRepositoryMetadata(
    owner: string,
    repo: string,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<RepositoryMetadata> {
    const res = await this.fetchGitHub(`/repos/${owner}/${repo}`, options);

    if (res.status === 404) {
      throw new GitHubNotFoundError(owner, repo);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new GitHubApiError(
        `Failed to fetch repository metadata (${res.status}): ${text}`,
        res.status
      );
    }

    const data = (await res.json()) as any;
    if (data.private) {
      throw new GitHubPrivateRepositoryError(owner, repo);
    }
    return {
      id: String(data.id),
      owner: data.owner?.login || owner,
      name: data.name || repo,
      url: data.html_url || `https://github.com/${owner}/${repo}`,
      defaultBranch: data.default_branch || 'main',
      description: data.description || null,
      stars: data.stargazers_count ?? 0,
      forks: data.forks_count ?? 0,
      primaryLanguage: data.language || null,
      createdAt: data.created_at || new Date().toISOString(),
      updatedAt: data.updated_at || new Date().toISOString(),
    };
  }

  async getHeadCommit(
    owner: string,
    repo: string,
    ref = 'HEAD',
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<HeadCommitInfo> {
    const res = await this.fetchGitHub(`/repos/${owner}/${repo}/commits/${ref}`, options);

    if (res.status === 404) {
      throw new GitHubNotFoundError(owner, repo);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new GitHubApiError(
        `Failed to fetch commit info (${res.status}): ${text}`,
        res.status
      );
    }

    const data = (await res.json()) as any;
    if (!data?.sha) {
      throw new GitHubApiError(`Malformed commit response: missing commit SHA`, res.status);
    }

    return {
      commitSha: data.sha,
      treeSha: data.commit?.tree?.sha || undefined,
    };
  }

  async getGitTree(
    owner: string,
    repo: string,
    branchOrSha: string
  ): Promise<{ sha: string; tree: RawGitTreeItem[]; truncated: boolean }> {
    const res = await this.fetchGitHub(
      `/repos/${owner}/${repo}/git/trees/${branchOrSha}?recursive=1`
    );

    if (res.status === 404) {
      throw new GitHubNotFoundError(owner, repo);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new GitHubApiError(`Failed to fetch git tree (${res.status}): ${text}`, res.status);
    }

    const data = (await res.json()) as RawGitTreeResponse;

    if (data.truncated || (data.tree && data.tree.length > MAX_TREE_ITEMS)) {
      throw new GitHubTreeTooLargeError(data.tree?.length ?? MAX_TREE_ITEMS + 1, MAX_TREE_ITEMS);
    }

    return {
      sha: data.sha,
      tree: data.tree || [],
      truncated: Boolean(data.truncated),
    };
  }

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<LandmarkContent> {
    // Sanitize path against directory traversal
    const normalizedPath = path.replace(/^\/+/, '').replace(/\.\.\//g, '');
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const res = await this.fetchGitHub(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(normalizedPath)}${query}`
    );

    if (res.status === 404) {
      throw new GitHubNotFoundError(owner, `${repo}/${normalizedPath}`);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new GitHubApiError(`Failed to fetch file content (${res.status}): ${text}`, res.status);
    }

    const data = (await res.json()) as any;
    const size = typeof data.size === 'number' ? data.size : 0;
    const name = data.name || normalizedPath.split('/').pop() || 'file';

    if (size > MAX_FILE_SIZE_BYTES) {
      return {
        path: normalizedPath,
        name,
        size,
        content: `[File size (${(size / 1024).toFixed(1)} KB) exceeds display limit of ${MAX_FILE_SIZE_BYTES / 1024} KB]`,
        encoding: 'utf-8',
        isTruncated: true,
      };
    }

    let content = '';
    if (data.encoding === 'base64' && typeof data.content === 'string') {
      content = Buffer.from(data.content, 'base64').toString('utf-8');
    } else if (typeof data.content === 'string') {
      content = data.content;
    } else if (data.download_url) {
      // Fallback: fetch raw if content not returned directly with bounded timeout
      const fallbackController = new AbortController();
      const timer = setTimeout(() => fallbackController.abort(), 10000);
      if (typeof timer.unref === 'function') timer.unref();
      try {
        const rawRes = await fetch(data.download_url, { signal: fallbackController.signal });
        if (rawRes.ok) {
          content = await rawRes.text();
        }
      } finally {
        clearTimeout(timer);
      }
    }

    return {
      path: normalizedPath,
      name,
      size,
      content,
      encoding: 'utf-8',
      isTruncated: false,
    };
  }
}

export const githubService = new GitHubService();
