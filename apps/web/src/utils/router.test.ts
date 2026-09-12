import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseRoute,
  buildRepoUrl,
  navigateTo,
  subscribeToNavigation,
  VALID_TABS,
} from './router.js';

describe('Router Utilities', () => {
  describe('parseRoute', () => {
    it('parses home route correctly', () => {
      expect(parseRoute('/')).toEqual({ type: 'home' });
      expect(parseRoute('')).toEqual({ type: 'home' });
      expect(parseRoute('   /   ')).toEqual({ type: 'home' });
    });

    it('parses valid repository route with default overview tab', () => {
      const parsed = parseRoute('/repos/fastify/fastify');
      expect(parsed).toEqual({
        type: 'repo',
        owner: 'fastify',
        repo: 'fastify',
        tab: 'overview',
      });
    });

    it('handles trailing slashes on repository route', () => {
      const parsed = parseRoute('/repos/facebook/react/');
      expect(parsed).toEqual({
        type: 'repo',
        owner: 'facebook',
        repo: 'react',
        tab: 'overview',
      });
    });

    it('parses repository route with valid tab query parameters', () => {
      for (const tab of VALID_TABS) {
        const parsed = parseRoute('/repos/owner/my-repo', `?tab=${tab}`);
        expect(parsed).toEqual({
          type: 'repo',
          owner: 'owner',
          repo: 'my-repo',
          tab,
        });
      }
    });

    it('falls back to overview tab when an invalid tab query parameter is passed', () => {
      const parsed = parseRoute('/repos/owner/my-repo', '?tab=invalid-tab');
      expect(parsed).toEqual({
        type: 'repo',
        owner: 'owner',
        repo: 'my-repo',
        tab: 'overview',
      });
    });

    it('identifies invalid or unsupported routes', () => {
      expect(parseRoute('/unknown')).toEqual({ type: 'invalid', path: '/unknown' });
      expect(parseRoute('/repos')).toEqual({ type: 'invalid', path: '/repos' });
      expect(parseRoute('/repos/single-segment')).toEqual({
        type: 'invalid',
        path: '/repos/single-segment',
      });
      expect(parseRoute('/repos/a/b/c/extra')).toEqual({
        type: 'invalid',
        path: '/repos/a/b/c/extra',
      });
    });
  });

  describe('buildRepoUrl', () => {
    it('builds canonical repository URL without query param for overview tab', () => {
      expect(buildRepoUrl('fastify', 'fastify')).toBe('/repos/fastify/fastify');
      expect(buildRepoUrl('fastify', 'fastify', 'overview')).toBe('/repos/fastify/fastify');
    });

    it('builds repository URL with query param for non-default tabs', () => {
      expect(buildRepoUrl('fastify', 'fastify', 'execution')).toBe(
        '/repos/fastify/fastify?tab=execution'
      );
      expect(buildRepoUrl('fastify', 'fastify', 'ai')).toBe('/repos/fastify/fastify?tab=ai');
      expect(buildRepoUrl('fastify', 'fastify', 'search')).toBe(
        '/repos/fastify/fastify?tab=search'
      );
    });

    it('properly encodes special characters in owner and repo names', () => {
      expect(buildRepoUrl('my org', 'special.repo')).toBe(
        '/repos/my%20org/special.repo'
      );
    });
  });

  describe('navigateTo & subscribeToNavigation (History API integration)', () => {
    let mockListeners: Record<string, Function[]> = {};
    let mockLocation = {
      pathname: '/',
      search: '',
    };
    let mockHistory: { pushState: any } = { pushState: vi.fn() };

    beforeEach(() => {
      mockListeners = {};
      mockLocation = { pathname: '/', search: '' };
      mockHistory = {
        pushState: vi.fn((_state, _title, url) => {
          const urlStr = String(url);
          const [p, s = ''] = urlStr.split('?');
          mockLocation.pathname = p;
          mockLocation.search = s ? `?${s}` : '';
        }),
      };

      (globalThis as any).window = {
        location: mockLocation,
        history: mockHistory,
        addEventListener: vi.fn((event: string, cb: Function) => {
          if (!mockListeners[event]) mockListeners[event] = [];
          mockListeners[event].push(cb);
        }),
        removeEventListener: vi.fn((event: string, cb: Function) => {
          if (mockListeners[event]) {
            mockListeners[event] = mockListeners[event].filter((f) => f !== cb);
          }
        }),
        dispatchEvent: vi.fn((event: any) => {
          const cbs = mockListeners[event.type] || [];
          for (const cb of cbs) {
            cb(event);
          }
          return true;
        }),
      };

      (globalThis as any).Event = class {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      };

      (globalThis as any).PopStateEvent = class {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      };
    });

    afterEach(() => {
      delete (globalThis as any).window;
      delete (globalThis as any).Event;
      delete (globalThis as any).PopStateEvent;
      vi.restoreAllMocks();
    });

    it('subscribes to navigateTo events and parses updated route', () => {
      const listener = vi.fn();
      const unsubscribe = subscribeToNavigation(listener);

      navigateTo('/repos/pallets/flask?tab=tree');

      expect(mockHistory.pushState).toHaveBeenCalledWith(
        {},
        '',
        '/repos/pallets/flask?tab=tree'
      );
      expect(listener).toHaveBeenCalledWith({
        type: 'repo',
        owner: 'pallets',
        repo: 'flask',
        tab: 'tree',
      });

      unsubscribe();
    });

    it('handles popstate browser back/forward event', () => {
      const listener = vi.fn();
      const unsubscribe = subscribeToNavigation(listener);

      navigateTo('/repos/facebook/react');
      expect(listener).toHaveBeenLastCalledWith({
        type: 'repo',
        owner: 'facebook',
        repo: 'react',
        tab: 'overview',
      });

      // Simulate browser back to root
      mockLocation.pathname = '/';
      mockLocation.search = '';
      (globalThis as any).window.dispatchEvent(new (globalThis as any).PopStateEvent('popstate'));

      expect(listener).toHaveBeenLastCalledWith({
        type: 'home',
      });

      unsubscribe();
    });
  });
});
