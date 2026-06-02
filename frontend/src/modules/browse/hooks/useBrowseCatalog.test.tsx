/**
 * frontend/src/modules/browse/hooks/useBrowseCatalog.test.tsx
 *
 * Verifies Browse catalog hook behavior for scoped refresh-domain lifecycle,
 * catalog paging, metadata loading, and filter-driven scope changes.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBrowseCatalog, type UseBrowseCatalogResult } from './useBrowseCatalog';
import type { CatalogItem, CatalogSnapshotPayload } from '@/core/refresh/types';

const mocks = vi.hoisted(() => ({
  setScopedDomainEnabled: vi.fn(),
  useRefreshScopedDomain: vi.fn(),
  requestRefreshDomain: vi.fn(),
  requestRefreshDomainState: vi.fn(),
  getScopedDomainState: vi.fn(),
  setScopedDomainState: vi.fn(),
  eventUnsubscribe: vi.fn(),
  refreshFns: new Map<string, (reason?: string) => Promise<unknown>>(),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    setScopedDomainEnabled: (...args: unknown[]) => mocks.setScopedDomainEnabled(...args),
  },
  useRefreshScopedDomain: (...args: unknown[]) => mocks.useRefreshScopedDomain(...args),
}));

vi.mock('@/core/data-access', () => ({
  requestRefreshDomain: (...args: unknown[]) => mocks.requestRefreshDomain(...args),
  requestRefreshDomainState: (...args: unknown[]) => mocks.requestRefreshDomainState(...args),
  readRefreshDomainState: (...args: unknown[]) => mocks.getScopedDomainState(...args),
  useScopedRefreshDomainLifecycle: vi.fn(),
  useRefreshDomainHandle: ({ domain, scope }: { domain: string | null; scope: string | null }) => {
    const key = `${domain ?? ''}:${scope ?? ''}`;
    let refresh = mocks.refreshFns.get(key);
    if (!refresh) {
      refresh = (reason = 'user') =>
        domain && scope
          ? mocks.requestRefreshDomain({ domain, scope, reason })
          : Promise.resolve({ status: 'blocked' });
      mocks.refreshFns.set(key, refresh);
    }
    return {
      state: domain && scope ? mocks.useRefreshScopedDomain(domain, scope) : { status: 'idle' },
      refresh,
    };
  },
}));

vi.mock('@/core/refresh/store', () => ({
  getScopedDomainState: (...args: unknown[]) => mocks.getScopedDomainState(...args),
  setScopedDomainState: (...args: unknown[]) => mocks.setScopedDomainState(...args),
}));

vi.mock('@/core/events', () => ({
  eventBus: {
    on: vi.fn(() => mocks.eventUnsubscribe),
  },
}));

vi.mock('@/core/refresh/diagnostics/useCatalogDiagnostics', () => ({
  useCatalogDiagnostics: vi.fn(),
}));

vi.mock('@/core/refresh/hooks/useAutoRefreshLoadingState', () => ({
  useAutoRefreshLoadingState: () => ({ isPaused: false, isManualRefreshActive: false }),
}));

vi.mock('@/core/refresh/loadingPolicy', () => ({
  applyPassiveLoadingPolicy: ({ loading }: { loading: boolean }) => ({ loading }),
}));

const makeItem = (overrides: Partial<CatalogItem>): CatalogItem => ({
  clusterId: 'cluster-1',
  clusterName: 'Cluster 1',
  kind: 'Pod',
  group: '',
  version: 'v1',
  resource: 'pods',
  namespace: 'default',
  name: 'pod-a',
  uid: 'pod-a',
  resourceVersion: '1',
  creationTimestamp: '2026-01-01T00:00:00Z',
  scope: 'Namespace',
  ...overrides,
});

const makePayload = (overrides: Partial<CatalogSnapshotPayload>): CatalogSnapshotPayload => ({
  clusterId: 'cluster-1',
  clusterName: 'Cluster 1',
  items: [],
  continue: '',
  total: 0,
  resourceCount: 0,
  kinds: [{ kind: 'Pod', namespaced: true }],
  namespaces: ['default'],
  batchIndex: 0,
  batchSize: 0,
  totalBatches: 1,
  isFinal: true,
  ...overrides,
});

describe('useBrowseCatalog', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let result: UseBrowseCatalogResult | null;
  const pinnedNamespaces = ['default'];

  const Harness = ({
    search = '',
    kinds = [],
    namespaces = [],
    customOnly = false,
  }: {
    search?: string;
    kinds?: string[];
    namespaces?: string[];
    customOnly?: boolean;
  }) => {
    result = useBrowseCatalog({
      clusterId: 'cluster-1',
      pinnedNamespaces,
      customOnly,
      initialPageLimit: 2,
      filters: { search, kinds, namespaces },
      diagnosticLabel: 'test browse',
    });
    return null;
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    result = null;
    vi.clearAllMocks();
    mocks.refreshFns.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('replaces the current row window with the next cursor page', async () => {
    const baseScope = 'cluster-1|limit=2&namespace=default';
    const metadataScope = 'cluster-1|limit=1&namespace=default';
    const pageScope = 'cluster-1|limit=2&namespace=default&continue=2';
    const first = makeItem({ uid: 'pod-a', name: 'pod-a' });
    const second = makeItem({ uid: 'pod-b', name: 'pod-b' });
    const baseState = {
      status: 'ready',
      data: makePayload({ items: [first], continue: '2', total: 2, batchSize: 1 }),
      scope: baseScope,
    };
    const metadataState = {
      status: 'ready',
      data: makePayload({ items: [], total: 2, batchSize: 0 }),
      scope: metadataScope,
    };
    const pageState = {
      status: 'ready',
      data: makePayload({ items: [second], continue: '', total: 2, batchSize: 1 }),
      scope: pageScope,
    };

    mocks.useRefreshScopedDomain.mockImplementation((_domain: string, scope: string) => {
      if (scope === baseScope) {
        return baseState;
      }
      if (scope === metadataScope) {
        return metadataState;
      }
      return { status: 'idle', data: null, scope };
    });
    mocks.requestRefreshDomainState.mockResolvedValue({ status: 'executed', data: pageState });

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(result?.items.map((item) => item.name)).toEqual(['pod-a']);
    expect(result?.continueToken).toBe('2');
    expect(result?.pageIndex).toBe(1);

    await act(async () => {
      result?.handleLoadMore();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.requestRefreshDomainState).toHaveBeenCalledWith({
      domain: 'catalog',
      scope: pageScope,
      reason: 'user',
    });
    expect(mocks.getScopedDomainState).not.toHaveBeenCalledWith('catalog', pageScope);
    expect(mocks.setScopedDomainEnabled).not.toHaveBeenCalledWith('catalog', pageScope, true);
    expect(mocks.setScopedDomainEnabled).not.toHaveBeenCalledWith('catalog', pageScope, false);
    expect(mocks.setScopedDomainState).not.toHaveBeenCalled();
    expect(result?.items.map((item) => item.name)).toEqual(['pod-b']);
    expect(result?.continueToken).toBeNull();
    expect(result?.isRequestingMore).toBe(false);
    expect(result?.pageIndex).toBe(2);
  });

  it('replaces the current row window with the previous cursor page', async () => {
    const baseScope = 'cluster-1|limit=2&namespace=default';
    const metadataScope = 'cluster-1|limit=1&namespace=default';
    const pageScope = 'cluster-1|limit=2&namespace=default&continue=prev';
    const first = makeItem({ uid: 'pod-a', name: 'pod-a' });
    const second = makeItem({ uid: 'pod-b', name: 'pod-b' });
    const baseState = {
      status: 'ready',
      data: makePayload({
        items: [second],
        previous: 'prev',
        continue: '',
        total: 2,
        batchSize: 1,
      }),
      scope: baseScope,
    };
    const metadataState = {
      status: 'ready',
      data: makePayload({ items: [], total: 2, batchSize: 0 }),
      scope: metadataScope,
    };
    const pageState = {
      status: 'ready',
      data: makePayload({ items: [first], previous: '', continue: 'next', total: 2, batchSize: 1 }),
      scope: pageScope,
    };

    mocks.useRefreshScopedDomain.mockImplementation((_domain: string, scope: string) => {
      if (scope === baseScope) {
        return baseState;
      }
      if (scope === metadataScope) {
        return metadataState;
      }
      return { status: 'idle', data: null, scope };
    });
    mocks.requestRefreshDomainState.mockResolvedValue({ status: 'executed', data: pageState });

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(result?.items.map((item) => item.name)).toEqual(['pod-b']);
    expect(result?.previousToken).toBe('prev');

    await act(async () => {
      result?.handleLoadPrevious();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.requestRefreshDomainState).toHaveBeenCalledWith({
      domain: 'catalog',
      scope: pageScope,
      reason: 'user',
    });
    expect(result?.items.map((item) => item.name)).toEqual(['pod-a']);
    expect(result?.previousToken).toBeNull();
    expect(result?.continueToken).toBe('next');
    expect(result?.pageIndex).toBe(1);
  });

  it('refreshes the first page when the backend reports an invalid cursor', async () => {
    const baseScope = 'cluster-1|limit=2&namespace=default';
    const metadataScope = 'cluster-1|limit=1&namespace=default';
    const pageScope = 'cluster-1|limit=2&namespace=default&continue=bad-cursor';
    const first = makeItem({ uid: 'pod-a', name: 'pod-a' });
    const baseState = {
      status: 'ready',
      data: makePayload({ items: [first], continue: 'bad-cursor', total: 2, batchSize: 1 }),
      scope: baseScope,
    };
    const metadataState = {
      status: 'ready',
      data: makePayload({ items: [], total: 2, batchSize: 0 }),
      scope: metadataScope,
    };
    const pageState = {
      status: 'ready',
      data: makePayload({ items: [], cursorInvalid: true, total: 2, batchSize: 0 }),
      scope: pageScope,
    };

    mocks.useRefreshScopedDomain.mockImplementation((_domain: string, scope: string) => {
      if (scope === baseScope) {
        return baseState;
      }
      if (scope === metadataScope) {
        return metadataState;
      }
      return { status: 'idle', data: null, scope };
    });
    mocks.requestRefreshDomainState.mockResolvedValue({ status: 'executed', data: pageState });

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    await act(async () => {
      result?.handleLoadMore();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result?.items).toEqual([]);
    expect(result?.continueToken).toBeNull();
    expect(result?.pageIndex).toBe(1);
    expect(mocks.requestRefreshDomain).toHaveBeenCalledWith({
      domain: 'catalog',
      scope: baseScope,
      reason: 'user',
    });
  });

  it('debounces backend search scope refreshes', async () => {
    vi.useFakeTimers();
    const baseScope = 'cluster-1|limit=2&namespace=default';
    const searchScope = 'cluster-1|limit=2&search=api&namespace=default';
    const metadataScope = 'cluster-1|limit=1&namespace=default';

    mocks.useRefreshScopedDomain.mockImplementation((_domain: string, scope: string) => {
      if (scope === baseScope || scope === searchScope || scope === metadataScope) {
        return {
          status: 'ready',
          data: makePayload({ items: [], total: 0, batchSize: 0 }),
          scope,
        };
      }
      return { status: 'idle', data: null, scope };
    });

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    mocks.requestRefreshDomain.mockClear();

    await act(async () => {
      root.render(<Harness search="api" />);
      await Promise.resolve();
    });

    expect(mocks.requestRefreshDomain).not.toHaveBeenCalledWith({
      domain: 'catalog',
      scope: searchScope,
      reason: 'startup',
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(mocks.requestRefreshDomain).toHaveBeenCalledWith({
      domain: 'catalog',
      scope: searchScope,
      reason: 'startup',
    });
    vi.useRealTimers();
  });

  it('threads custom-resource-only queries into catalog scopes', async () => {
    const customScope = 'cluster-1|limit=2&customOnly=true&namespace=default';
    const metadataScope = 'cluster-1|limit=1&customOnly=true&namespace=default';

    mocks.useRefreshScopedDomain.mockImplementation((_domain: string, scope: string) => {
      if (scope === customScope || scope === metadataScope) {
        return {
          status: 'ready',
          data: makePayload({ items: [], total: 0, batchSize: 0 }),
          scope,
        };
      }
      return { status: 'idle', data: null, scope };
    });

    await act(async () => {
      root.render(<Harness customOnly />);
      await Promise.resolve();
    });

    expect(mocks.requestRefreshDomain).toHaveBeenCalledWith({
      domain: 'catalog',
      scope: customScope,
      reason: 'startup',
    });
    expect(mocks.requestRefreshDomain).toHaveBeenCalledWith({
      domain: 'catalog',
      scope: metadataScope,
      reason: 'startup',
    });
  });

  it('keeps only the current page window across repeated page navigation', async () => {
    const baseScope = 'cluster-1|limit=2&namespace=default';
    const metadataScope = 'cluster-1|limit=1&namespace=default';
    const first = makeItem({ uid: 'pod-0', name: 'pod-0' });
    const baseState = {
      status: 'ready',
      data: makePayload({ items: [first], continue: 'page-1', total: 21, batchSize: 1 }),
      scope: baseScope,
    };
    const metadataState = {
      status: 'ready',
      data: makePayload({ items: [], total: 21, batchSize: 0 }),
      scope: metadataScope,
    };

    mocks.useRefreshScopedDomain.mockImplementation((_domain: string, scope: string) => {
      if (scope === baseScope) {
        return baseState;
      }
      if (scope === metadataScope) {
        return metadataState;
      }
      return { status: 'idle', data: null, scope };
    });
    mocks.requestRefreshDomainState.mockImplementation(async ({ scope }: { scope: string }) => {
      const token = new URLSearchParams(scope.split('|')[1] ?? '').get('continue') ?? '';
      const pageNumber = Number(token.replace('page-', ''));
      const nextToken = pageNumber < 20 ? `page-${pageNumber + 1}` : '';
      return {
        status: 'executed',
        data: {
          status: 'ready',
          data: makePayload({
            items: [makeItem({ uid: `pod-${pageNumber}`, name: `pod-${pageNumber}` })],
            continue: nextToken,
            total: 21,
            batchSize: 1,
          }),
          scope,
        },
      };
    });

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    for (let page = 1; page <= 20; page += 1) {
      await act(async () => {
        result?.handleLoadMore();
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(result?.items.map((item) => item.name)).toEqual([`pod-${page}`]);
      expect(result?.items).toHaveLength(1);
      expect(result?.pageIndex).toBe(page + 1);
    }
  });
});
