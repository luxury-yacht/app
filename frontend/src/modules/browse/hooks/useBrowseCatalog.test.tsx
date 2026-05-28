import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBrowseCatalog, type UseBrowseCatalogResult } from './useBrowseCatalog';
import type { CatalogItem, CatalogSnapshotPayload } from '@/core/refresh/types';

const mocks = vi.hoisted(() => ({
  setScopedDomainEnabled: vi.fn(),
  useRefreshScopedDomain: vi.fn(),
  requestRefreshDomain: vi.fn(),
  getScopedDomainState: vi.fn(),
  setScopedDomainState: vi.fn(),
  eventUnsubscribe: vi.fn(),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    setScopedDomainEnabled: (...args: unknown[]) => mocks.setScopedDomainEnabled(...args),
  },
  useRefreshScopedDomain: (...args: unknown[]) => mocks.useRefreshScopedDomain(...args),
}));

vi.mock('@/core/data-access', () => ({
  requestRefreshDomain: (...args: unknown[]) => mocks.requestRefreshDomain(...args),
  useScopedRefreshDomainLifecycle: vi.fn(),
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

vi.mock('@/core/settings/appPreferences', () => ({
  getMaxTableRows: () => 2,
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

  const Harness = () => {
    result = useBrowseCatalog({
      clusterId: 'cluster-1',
      pinnedNamespaces,
      filters: { search: '', kinds: [], namespaces: [] },
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
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('appends load-more pages locally without copying paginated data into the base refresh scope', async () => {
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
    mocks.requestRefreshDomain.mockResolvedValue({ status: 'executed' });
    mocks.getScopedDomainState.mockReturnValue(pageState);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(result?.items.map((item) => item.name)).toEqual(['pod-a']);
    expect(result?.continueToken).toBe('2');

    await act(async () => {
      result?.handleLoadMore();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.requestRefreshDomain).toHaveBeenCalledWith({
      domain: 'catalog',
      scope: pageScope,
      reason: 'user',
    });
    expect(mocks.getScopedDomainState).toHaveBeenCalledWith('catalog', pageScope);
    expect(mocks.setScopedDomainEnabled).toHaveBeenCalledWith('catalog', pageScope, true);
    expect(mocks.setScopedDomainEnabled).toHaveBeenCalledWith('catalog', pageScope, false);
    expect(mocks.setScopedDomainState).not.toHaveBeenCalled();
    expect(result?.items.map((item) => item.name)).toEqual(['pod-a', 'pod-b']);
    expect(result?.continueToken).toBeNull();
    expect(result?.isRequestingMore).toBe(false);
  });
});
