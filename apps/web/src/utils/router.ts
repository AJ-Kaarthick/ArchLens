export type TabId =
  | 'overview'
  | 'ai'
  | 'search'
  | 'tech'
  | 'metrics'
  | 'tree'
  | 'execution';

export const VALID_TABS: readonly TabId[] = [
  'overview',
  'ai',
  'search',
  'tech',
  'metrics',
  'tree',
  'execution',
] as const;

export type ParsedRoute =
  | { type: 'home' }
  | { type: 'repo'; owner: string; repo: string; tab: TabId }
  | { type: 'invalid'; path: string };

/**
 * Parses current pathname and search query string into a structured route.
 * Supported routes:
 * - /
 * - /repos/:owner/:repo
 * - /repos/:owner/:repo?tab=overview|ai|search|tech|metrics|tree|execution
 */
export function parseRoute(pathname: string, search: string = ''): ParsedRoute {
  const cleanPath = (pathname || '/').trim();
  const normalizedPath = cleanPath === '/' ? '/' : cleanPath.replace(/\/+$/, '');

  if (normalizedPath === '' || normalizedPath === '/') {
    return { type: 'home' };
  }

  const match = normalizedPath.match(/^\/repos\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (match) {
    const owner = match[1];
    const repo = match[2];

    const params = new URLSearchParams(search);
    const rawTab = params.get('tab');
    const tab: TabId =
      rawTab && VALID_TABS.includes(rawTab as TabId) ? (rawTab as TabId) : 'overview';

    return {
      type: 'repo',
      owner,
      repo,
      tab,
    };
  }

  return { type: 'invalid', path: pathname };
}

/**
 * Builds the canonical relative URL for a repository and optional tab.
 */
export function buildRepoUrl(owner: string, repo: string, tab?: TabId): string {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  if (tab && tab !== 'overview' && VALID_TABS.includes(tab)) {
    return `${base}?tab=${tab}`;
  }
  return base;
}

/**
 * Navigates to a target relative URL without a full page reload,
 * updating the browser history and notifying navigation subscribers.
 */
export function navigateTo(url: string): void {
  if (typeof window === 'undefined') return;

  const current = window.location.pathname + window.location.search;
  if (current === url) return;

  window.history.pushState({}, '', url);
  window.dispatchEvent(new Event('archlens-navigation'));
}

/**
 * Subscribes to browser history navigation (back/forward popstate and programmatic navigateTo).
 * Returns an unsubscribe cleanup function.
 */
export function subscribeToNavigation(callback: (route: ParsedRoute) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = () => {
    callback(parseRoute(window.location.pathname, window.location.search));
  };

  window.addEventListener('popstate', handler);
  window.addEventListener('archlens-navigation', handler);

  return () => {
    window.removeEventListener('popstate', handler);
    window.removeEventListener('archlens-navigation', handler);
  };
}
