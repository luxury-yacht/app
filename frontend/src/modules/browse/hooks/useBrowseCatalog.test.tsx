/**
 * frontend/src/modules/browse/hooks/useBrowseCatalog.test.tsx
 *
 * Verifies Browse catalog hook behavior for scoped refresh-domain lifecycle,
 * catalog paging, metadata loading, and filter-driven scope changes.
 */

import React from 'react';
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

const defaultTablePageSizeMock = vi.hoisted(() => vi.fn(() => 50));

vi.mock('@/hooks/useDefaultTablePageSize', () => ({
  useDefaultTablePageSize: () => defaultTablePageSizeMock(),
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

const defaultPinnedNamespaces = ['default'];

describe('useBrowseCatalog', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let result: UseBrowseCatalogResult | null;

  const Harness = ({
    search = '',
    kinds = [],
    namespaces = [],
    pinnedNamespaces = defaultPinnedNamespaces,
    clusterScopedOnly = false,
    customOnly = false,
    enabled = true,
    initialPageLimit = 2,
    onPageLimitChange,
  }: {
    // initialPageLimit seeds the harness's controlled pageLimit state, which
    // feeds accepted changes back to the hook the way persistence does in
    // production (the hook holds no page-size state of its own).
    search?: string;
    kinds?: string[];
    namespaces?: string[];
    pinnedNamespaces?: string[];
    clusterScopedOnly?: boolean;
    customOnly?: boolean;
    enabled?: boolean;
    initialPageLimit?: number;
    onPageLimitChange?: (value: 25 | 50 | 100 | 250 | 500 | 1000) => void;
  }) => {
    // Model the persistence owner: the prop supplies the value (hydration can
    // change it across renders) and accepted user changes override it.
    const [pageLimitOverride, setHarnessPageLimit] = React.useState<number | null>(null);
    result = useBrowseCatalog({
      enabled,
      clusterId: 'cluster-1',
      pinnedNamespaces,
      clusterScopedOnly,
      customOnly,
      pageLimit: pageLimitOverride ?? initialPageLimit,
      onPageLimitChange: (value) => {
        setHarnessPageLimit(value);
        onPageLimitChange?.(value);
      },
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
    defaultTablePageSizeMock.mockReturnValue(50);
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('uses the app-wide Default Page Size preference when the view has no persisted page size', async () => {
    defaultTablePageSizeMock.mockReturnValue(250);

    const UnpersistedHarness = () => {
      result = useBrowseCatalog({
        enabled: true,
        clusterId: 'cluster-1',
        pinnedNamespaces: defaultPinnedNamespaces,
        clusterScopedOnly: false,
        customOnly: false,
        pageLimit: undefined,
        onPageLimitChange: () => {},
        filters: { search: '', kinds: [], namespaces: [] },
        diagnosticLabel: 'test browse',
      });
      return null;
    };

    mocks.useRefreshScopedDomain.mockImplementation((_domain: string, scope: string) => ({
      status: 'idle',
      data: null,
      scope,
    }));

    await act(async () => {
      root.render(<UnpersistedHarness />);
      await Promise.resolve();
    });

    expect(result?.pageLimit).toBe(250);
  });

  it('holds the last filter options while a filter-change scope swap has no data yet', async () => {
    const baseScope = 'cluster-1|limit=2&namespace=default';
    const first = makeItem({ uid: 'pod-a', name: 'pod-a' });
    const baseState = {
      status: 'ready',
      data: makePayload({ items: [first], total: 1, batchSize: 1 }),
      scope: baseScope,
    };

    mocks.useRefreshScopedDomain.mockImplementation((_domain: string, scope: string) =>
      scope === baseScope ? baseState : { status: 'idle', data: null, scope }
    );

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    expect(result?.filterOptions.kinds).toEqual(['Pod']);

    // Selecting a kind swaps to a scope with no state yet; the dropdown options
    // must hold their last derived value instead of blanking (the dropdown
    // disables itself on empty options — the "flash").
    await act(async () => {
      root.render(<Harness kinds={['Pod']} />);
      await Promise.resolve();
    });
    expect(result?.filterOptions.kinds).toEqual(['Pod']);
  });

  it('stays quiet (no loading) when the catalog refreshes after the first load', async () => {
    const baseScope = 'cluster-1|limit=2&namespace=default';
    const metadataScope = 'cluster-1|limit=1&namespace=default';
    const first = makeItem({ uid: 'pod-a', name: 'pod-a' });
    const readyState = {
      status: 'ready',
      data: makePayload({ items: [first], total: 1, batchSize: 1 }),
      scope: baseScope,
    };
    const metadataState = {
      status: 'ready',
      data: makePayload({ items: [], total: 1, batchSize: 0 }),
      scope: metadataScope,
    };
    let scopeState = readyState;

    mocks.useRefreshScopedDomain.mockImplementation((_domain: string, scope: string) => {
      if (scope === baseScope) {
        return scopeState;
      }
      if (scope === metadataScope) {
        return metadataState;
      }
      return { status: 'idle', data: null, scope };
    });

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(result?.items.map((item) => item.name)).toEqual(['pod-a']);
    expect(result?.hasLoadedOnce).toBe(true);
    expect(result?.loading).toBe(false);

    // A refresh in flight after the first load (filter change, manual refresh)
    // must stay visually silent: the rows stay up and no overlay/spinner shows.
    scopeState = { ...readyState, status: 'loading' };
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(result?.items.map((item) => item.name)).toEqual(['pod-a']);
    expect(result?.loading).toBe(false);
  });

  it('refetches the current catalog query when a catalog doorbell advances its signal clock', async () => {
    const baseScope = 'cluster-1|limit=2&namespace=default';
    const metadataScope = 'cluster-1|limit=1&namespace=default';
    const first = makeItem({ uid: 'pod-a', name: 'pod-a' });
    // Doorbells write signalVersions (never touched by payload applies) plus
    // the folded sourceVersion — bumpSourceVersionOnly's exact shape.
    let baseState = {
      status: 'ready',
      data: makePayload({ items: [first], total: 1, batchSize: 1 }),
      scope: baseScope,
      sourceVersion: 'catalog:1',
      signalVersions: { catalog: 'catalog:1' },
    };
    const metadataState = {
      status: 'ready',
      data: makePayload({ items: [], total: 1, batchSize: 0 }),
      scope: metadataScope,
      sourceVersion: 'catalog:1',
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

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(result?.items.map((item) => item.name)).toEqual(['pod-a']);
    mocks.requestRefreshDomain.mockClear();

    baseState = {
      ...baseState,
      sourceVersion: 'catalog:2',
      signalVersions: { catalog: 'catalog:2' },
    };

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    // 'stream-signal' is load-bearing: a 'background' fetch is skipped by the
    // stream-healthy gate, silently swallowing the doorbell.
    expect(mocks.requestRefreshDomain).toHaveBeenCalledWith({
      domain: 'catalog',
      scope: baseScope,
      reason: 'stream-signal',
    });
  });

  it('payload validator churn must NOT refire the doorbell effect (no echo refetch)', async () => {
    const baseScope = 'cluster-1|limit=2&namespace=default';
    const metadataScope = 'cluster-1|limit=1&namespace=default';
    const first = makeItem({ uid: 'pod-a', name: 'pod-a' });
    let baseState = {
      status: 'ready',
      data: makePayload({ items: [first], total: 1, batchSize: 1 }),
      scope: baseScope,
      sourceVersion: 'validator-1',
      signalVersions: { catalog: 'catalog:1' },
    };
    const metadataState = {
      status: 'ready',
      data: makePayload({ items: [], total: 1, batchSize: 0 }),
      scope: metadataScope,
      sourceVersion: 'validator-1',
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

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    mocks.requestRefreshDomain.mockClear();

    // A fetch response applies: the folded validator changes but the doorbell
    // clock does not. Keying on the folded sourceVersion turned every fetch
    // response into another "signal" — an echo refetch per doorbell.
    baseState = {
      ...baseState,
      sourceVersion: 'validator-2',
    };

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(mocks.requestRefreshDomain).not.toHaveBeenCalled();
  });

  it('refetches on the FIRST doorbell after mount (no pre-doorbell signal value exists)', async () => {
    const baseScope = 'cluster-1|limit=2&namespace=default';
    const metadataScope = 'cluster-1|limit=1&namespace=default';
    const first = makeItem({ uid: 'pod-a', name: 'pod-a' });
    // Fresh mount: the scope has data (payload apply) but NO signalVersions —
    // doorbell values exist only after the first doorbell rings.
    let baseState = {
      status: 'ready',
      data: makePayload({ items: [first], total: 1, batchSize: 1 }),
      scope: baseScope,
      sourceVersion: 'validator-1',
    };
    const metadataState = {
      status: 'ready',
      data: makePayload({ items: [], total: 1, batchSize: 0 }),
      scope: metadataScope,
      sourceVersion: 'validator-1',
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

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    mocks.requestRefreshDomain.mockClear();

    // The FIRST doorbell arrives. An empty-string "previous" sentinel would
    // swallow it — the doorbell effect must key on has-observed, not
    // non-emptiness of the prior value.
    baseState = {
      ...baseState,
      sourceVersion: 'catalog:1',
      signalVersions: { catalog: 'catalog:1' },
    } as typeof baseState;

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(mocks.requestRefreshDomain).toHaveBeenCalledWith({
      domain: 'catalog',
      scope: baseScope,
      reason: 'stream-signal',
    });
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

  it('fetchAllRows rejects when a page fails instead of returning a partial result', async () => {
    const first = makeItem({ uid: 'pod-a', name: 'pod-a' });
    mocks.useRefreshScopedDomain.mockReturnValue({
      status: 'ready',
      data: makePayload({ items: [first], total: 2, batchSize: 1 }),
      scope: 'cluster-1|limit=2&namespace=default',
    });
    // First export page succeeds with a cursor; the follow-up page is blocked.
    mocks.requestRefreshDomainState
      .mockResolvedValueOnce({
        status: 'executed',
        data: {
          status: 'ready',
          data: makePayload({ items: [first], continue: 'page-2', total: 2, batchSize: 1 }),
        },
      })
      .mockResolvedValueOnce({ status: 'blocked' });

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    await expect(result!.fetchAllRows()).rejects.toThrow(/page 2/);
  });

  it('fetchAllRows pages at the backend max page size', async () => {
    const first = makeItem({ uid: 'pod-a', name: 'pod-a' });
    mocks.useRefreshScopedDomain.mockReturnValue({
      status: 'ready',
      data: makePayload({ items: [first], total: 1, batchSize: 1 }),
      scope: 'cluster-1|limit=2&namespace=default',
    });
    mocks.requestRefreshDomainState.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready', data: makePayload({ items: [first], total: 1, batchSize: 1 }) },
    });

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    await result!.fetchAllRows();

    const exportCall = mocks.requestRefreshDomainState.mock.calls.find((call: unknown[]) =>
      String((call[0] as { scope: string }).scope).includes('limit=')
    );
    expect(exportCall).toBeDefined();
    // The backend caps catalog query limits at 10000; paging below that
    // multiplies the number of full catalog scans per export.
    expect((exportCall![0] as { scope: string }).scope).toContain('limit=10000');
  });

  it('keeps the selected Cluster Browse cursor page when the base scope refreshes', async () => {
    const baseScope = 'cluster-1|limit=2&namespace=cluster';
    const metadataScope = 'cluster-1|limit=1&namespace=cluster';
    const pageScope = 'cluster-1|limit=2&namespace=cluster&continue=page-2';
    const first = makeItem({
      kind: 'Node',
      resource: 'nodes',
      namespace: undefined,
      uid: 'node-a',
      name: 'node-a',
      scope: 'Cluster',
    });
    const refreshedFirst = makeItem({
      kind: 'Node',
      resource: 'nodes',
      namespace: undefined,
      uid: 'node-a',
      name: 'node-a-refreshed',
      scope: 'Cluster',
    });
    const second = makeItem({
      kind: 'Node',
      resource: 'nodes',
      namespace: undefined,
      uid: 'node-b',
      name: 'node-b',
      scope: 'Cluster',
    });
    const refreshedSecond = makeItem({
      kind: 'Node',
      resource: 'nodes',
      namespace: undefined,
      uid: 'node-b',
      name: 'node-b-refreshed',
      scope: 'Cluster',
    });
    let basePayload = makePayload({
      items: [first],
      continue: 'page-2',
      total: 3,
      batchSize: 1,
      kinds: [{ kind: 'Node', namespaced: false }],
      namespaces: [],
    });
    const baseState = {
      status: 'ready',
      data: basePayload,
      scope: baseScope,
    };
    const metadataState = {
      status: 'ready',
      data: makePayload({
        items: [],
        total: 3,
        batchSize: 0,
        kinds: [{ kind: 'Node', namespaced: false }],
        namespaces: [],
      }),
      scope: metadataScope,
    };
    const pageState = {
      status: 'ready',
      data: makePayload({
        items: [second],
        previous: 'page-1',
        continue: 'page-3',
        total: 3,
        batchSize: 1,
        kinds: [{ kind: 'Node', namespaced: false }],
        namespaces: [],
      }),
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
      root.render(<Harness pinnedNamespaces={[]} clusterScopedOnly />);
      await Promise.resolve();
    });

    expect(result?.items.map((item) => item.name)).toEqual(['node-a']);
    expect(result?.continueToken).toBe('page-2');
    expect(result?.pageIndex).toBe(1);

    await act(async () => {
      result?.handleLoadMore();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result?.items.map((item) => item.name)).toEqual(['node-b']);
    expect(result?.previousToken).toBe('page-1');
    expect(result?.continueToken).toBe('page-3');
    expect(result?.pageIndex).toBe(2);

    basePayload = makePayload({
      items: [refreshedFirst],
      continue: 'page-2-refreshed',
      total: 4,
      batchSize: 1,
      kinds: [{ kind: 'Node', namespaced: false }],
      namespaces: [],
    });
    baseState.data = basePayload;

    await act(async () => {
      root.render(<Harness pinnedNamespaces={[]} clusterScopedOnly />);
      await Promise.resolve();
    });

    expect(result?.items.map((item) => item.name)).toEqual(['node-b']);
    expect(result?.previousToken).toBe('page-1');
    expect(result?.continueToken).toBe('page-3');
    expect(result?.pageIndex).toBe(2);
    expect(result?.totalCount).toBe(4);

    pageState.data = makePayload({
      items: [refreshedSecond],
      previous: 'page-1',
      continue: 'page-3',
      total: 5,
      batchSize: 1,
      kinds: [{ kind: 'Node', namespaced: false }],
      namespaces: [],
    });
    mocks.requestRefreshDomain.mockClear();
    mocks.requestRefreshDomainState.mockClear();

    await act(async () => {
      result?.refresh();
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
    expect(mocks.requestRefreshDomain).not.toHaveBeenCalled();
    expect(result?.items.map((item) => item.name)).toEqual(['node-b-refreshed']);
    expect(result?.previousToken).toBe('page-1');
    expect(result?.continueToken).toBe('page-3');
    expect(result?.pageIndex).toBe(2);
    expect(result?.totalCount).toBe(5);
  });

  it('uses the persisted initial page size and publishes page size changes', async () => {
    const onPageLimitChange = vi.fn();
    const baseScope = 'cluster-1|limit=250&namespace=default';
    const metadataScope = 'cluster-1|limit=1&namespace=default';
    mocks.useRefreshScopedDomain.mockImplementation((_domain: string, scope: string) => {
      if (scope === baseScope || scope === metadataScope) {
        return {
          status: 'ready',
          data: makePayload({ items: [], total: 0, batchSize: 0 }),
          scope,
        };
      }
      return { status: 'idle', data: null, scope };
    });

    await act(async () => {
      root.render(<Harness initialPageLimit={250} onPageLimitChange={onPageLimitChange} />);
      await Promise.resolve();
    });

    expect(result?.pageLimit).toBe(250);

    act(() => {
      result?.setPageLimit(500);
    });

    expect(result?.pageLimit).toBe(500);
    expect(onPageLimitChange).toHaveBeenCalledWith(500);
  });

  it('does not request catalog scopes before owning persisted table state is hydrated', async () => {
    const defaultScope = 'cluster-1|limit=2&namespace=default';
    const persistedScope = 'cluster-1|limit=250&namespace=default';
    const metadataScope = 'cluster-1|limit=1&namespace=default';

    mocks.useRefreshScopedDomain.mockImplementation((_domain: string, scope: string) => {
      if (scope === persistedScope || scope === metadataScope) {
        return {
          status: 'ready',
          data: makePayload({ items: [], total: 0, batchSize: 0 }),
          scope,
        };
      }
      return { status: 'idle', data: null, scope };
    });

    await act(async () => {
      root.render(<Harness enabled={false} />);
      await Promise.resolve();
    });

    expect(mocks.requestRefreshDomain).not.toHaveBeenCalledWith({
      domain: 'catalog',
      scope: defaultScope,
      reason: 'startup',
    });

    await act(async () => {
      root.render(<Harness enabled initialPageLimit={250} />);
      await Promise.resolve();
    });

    expect(mocks.requestRefreshDomain).toHaveBeenCalledWith({
      domain: 'catalog',
      scope: persistedScope,
      reason: 'startup',
    });
    expect(mocks.requestRefreshDomain).not.toHaveBeenCalledWith({
      domain: 'catalog',
      scope: defaultScope,
      reason: 'startup',
    });
  });

  it('keeps Cluster Browse loading for empty non-final catalog snapshots', async () => {
    const clusterScope = 'cluster-1|limit=2&namespace=cluster';
    const metadataScope = 'cluster-1|limit=1&namespace=cluster';
    mocks.useRefreshScopedDomain.mockImplementation((_domain: string, scope: string) => {
      if (scope === clusterScope) {
        return {
          status: 'updating',
          data: makePayload({ items: [], total: 826, batchSize: 0, isFinal: false }),
          scope,
        };
      }
      if (scope === metadataScope) {
        return {
          status: 'updating',
          data: makePayload({ items: [], total: 826, batchSize: 0, isFinal: false }),
          scope,
        };
      }
      return { status: 'idle', data: null, scope };
    });

    await act(async () => {
      root.render(<Harness pinnedNamespaces={[]} clusterScopedOnly />);
      await Promise.resolve();
    });

    expect(result?.items).toEqual([]);
    expect(result?.hasLoadedOnce).toBe(false);
    expect(result?.loading).toBe(true);
    expect(mocks.requestRefreshDomain).toHaveBeenCalledWith({
      domain: 'catalog',
      scope: clusterScope,
      reason: 'startup',
    });
  });

  it('resets loaded state when switching into Cluster Browse and then accepts cluster rows', async () => {
    const namespaceScope = 'cluster-1|limit=2&namespace=default';
    const namespaceMetadataScope = 'cluster-1|limit=1&namespace=default';
    const clusterScope = 'cluster-1|limit=2&namespace=cluster';
    const clusterMetadataScope = 'cluster-1|limit=1&namespace=cluster';
    const pod = makeItem({ uid: 'pod-a', name: 'pod-a' });
    const node = makeItem({
      kind: 'Node',
      resource: 'nodes',
      namespace: undefined,
      uid: 'node-a',
      name: 'node-a',
      scope: 'Cluster',
    });
    let clusterReady = false;

    mocks.useRefreshScopedDomain.mockImplementation((_domain: string, scope: string) => {
      if (scope === namespaceScope) {
        return {
          status: 'ready',
          data: makePayload({ items: [pod], total: 1, batchSize: 1, isFinal: true }),
          scope,
        };
      }
      if (scope === namespaceMetadataScope) {
        return {
          status: 'ready',
          data: makePayload({ items: [], total: 1, batchSize: 0, isFinal: true }),
          scope,
        };
      }
      if (scope === clusterScope) {
        return clusterReady
          ? {
              status: 'ready',
              data: makePayload({
                items: [node],
                total: 1,
                batchSize: 1,
                isFinal: true,
                kinds: [{ kind: 'Node', namespaced: false }],
              }),
              scope,
            }
          : { status: 'idle', data: null, scope };
      }
      if (scope === clusterMetadataScope) {
        return {
          status: 'idle',
          data: null,
          scope,
        };
      }
      return { status: 'idle', data: null, scope };
    });

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(result?.items.map((item) => item.name)).toEqual(['pod-a']);
    expect(result?.hasLoadedOnce).toBe(true);

    await act(async () => {
      root.render(<Harness pinnedNamespaces={[]} clusterScopedOnly />);
      await Promise.resolve();
    });

    expect(result?.items).toEqual([]);
    expect(result?.hasLoadedOnce).toBe(false);
    expect(result?.loading).toBe(true);

    clusterReady = true;
    await act(async () => {
      root.render(<Harness pinnedNamespaces={[]} clusterScopedOnly />);
      await Promise.resolve();
    });

    expect(result?.items.map((item) => item.name)).toEqual(['node-a']);
    expect(result?.hasLoadedOnce).toBe(true);
    expect(result?.loading).toBe(false);
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

  it('refetches with the kind in scope when the kind filter changes on a cluster-scoped custom query', async () => {
    const baseScope = 'cluster-1|limit=2&customOnly=true&namespace=cluster';
    const metadataScope = 'cluster-1|limit=1&customOnly=true&namespace=cluster';
    const filteredScope = 'cluster-1|limit=2&customOnly=true&kind=Widget&namespace=cluster';

    mocks.useRefreshScopedDomain.mockImplementation((_domain: string, scope: string) => {
      if (scope === baseScope || scope === metadataScope || scope === filteredScope) {
        return { status: 'ready', data: makePayload({ items: [], total: 0, batchSize: 0 }), scope };
      }
      return { status: 'idle', data: null, scope };
    });

    await act(async () => {
      root.render(<Harness pinnedNamespaces={[]} clusterScopedOnly customOnly />);
      await Promise.resolve();
    });

    mocks.requestRefreshDomain.mockClear();

    // Selecting a Kind must issue a NEW backend query whose scope carries the kind.
    await act(async () => {
      root.render(
        <Harness pinnedNamespaces={[]} clusterScopedOnly customOnly kinds={['Widget']} />
      );
      await Promise.resolve();
    });

    expect(mocks.requestRefreshDomain).toHaveBeenCalledWith({
      domain: 'catalog',
      scope: filteredScope,
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

describe('doorbell refetch quietness on a paged catalog', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let result: UseBrowseCatalogResult | null;

  beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
  });
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    result = null;
    vi.clearAllMocks();
    mocks.refreshFns.clear();
    defaultTablePageSizeMock.mockReturnValue(2);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const Harness: React.FC = () => {
    const [pageLimit, setPageLimit] = React.useState(2 as const);
    result = useBrowseCatalog({
      enabled: true,
      clusterId: 'cluster-1',
      filters: { search: '', kinds: [], namespaces: [] },
      pinnedNamespaces: defaultPinnedNamespaces,
      clusterScopedOnly: false,
      customOnly: false,
      pageLimit,
      onPageLimitChange: setPageLimit as never,
    } as never);
    return null;
  };

  // A doorbell-driven current-page refetch is a QUIET refetch: it must not
  // flip the user-facing busy flag (which disables prev/next and spins the
  // footer). On a churning cluster doorbells ring continuously — a busy flag
  // per ring means a permanently dead footer (the reported bug).
  it('keeps isRequestingMore false during doorbell-driven current-page refetches', async () => {
    const baseScope = 'cluster-1|limit=2&namespace=default';
    const metadataScope = 'cluster-1|limit=1&namespace=default';
    const pageOne = [makeItem({ uid: 'a', name: 'a' }), makeItem({ uid: 'b', name: 'b' })];
    let baseState = {
      status: 'ready',
      data: makePayload({
        items: pageOne,
        total: 4,
        batchSize: 2,
        continue: 'tok-2',
        isFinal: false,
      }),
      scope: baseScope,
      sourceVersion: 'catalog:1',
      signalVersions: { catalog: 'catalog:1' },
    };
    const metadataState = {
      status: 'ready',
      data: makePayload({ items: [], total: 4, batchSize: 0 }),
      scope: metadataScope,
      sourceVersion: 'catalog:1',
    };
    mocks.useRefreshScopedDomain.mockImplementation((_domain: string, scope: string) => {
      if (scope === baseScope) return baseState;
      if (scope === metadataScope) return metadataState;
      return { status: 'idle', data: null, scope };
    });

    const pageTwo = makePayload({
      items: [makeItem({ uid: 'c', name: 'c' }), makeItem({ uid: 'd', name: 'd' })],
      total: 4,
      batchSize: 2,
      previous: 'tok-1-prev',
      isFinal: false,
    });

    // User navigation: resolves page 2; the busy flag is EXPECTED while a
    // user-initiated fetch is in flight.
    let resolveUserFetch: (value: unknown) => void = () => {};
    mocks.requestRefreshDomainState.mockImplementationOnce(
      () => new Promise((resolve) => (resolveUserFetch = resolve))
    );

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    expect(result?.items.map((item) => item.name)).toEqual(['a', 'b']);

    await act(async () => {
      result?.pagination.onRequestMore();
      await Promise.resolve();
    });
    expect(result?.pagination.isRequestingMore).toBe(true);

    await act(async () => {
      resolveUserFetch({ status: 'executed', data: { status: 'ready', data: pageTwo } });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result?.items.map((item) => item.name)).toEqual(['c', 'd']);
    expect(result?.pagination.isRequestingMore).toBe(false);

    // Doorbell ring: hold the quiet current-page refetch in flight and assert
    // the busy flag stays FALSE the whole time.
    let resolveQuietFetch: (value: unknown) => void = () => {};
    mocks.requestRefreshDomainState.mockImplementationOnce(
      () => new Promise((resolve) => (resolveQuietFetch = resolve))
    );
    baseState = {
      ...baseState,
      sourceVersion: 'catalog:2',
      signalVersions: { catalog: 'catalog:2' },
    };
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(mocks.requestRefreshDomainState).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'stream-signal' })
    );
    expect(result?.pagination.isRequestingMore).toBe(false);

    await act(async () => {
      resolveQuietFetch({ status: 'executed', data: { status: 'ready', data: pageTwo } });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result?.pagination.isRequestingMore).toBe(false);
    expect(result?.items.map((item) => item.name)).toEqual(['c', 'd']);
  });
});
