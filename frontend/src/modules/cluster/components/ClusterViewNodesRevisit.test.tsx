/**
 * Integration smoke test: the real ClusterViewNodes, rendered through the REAL
 * loading boundary with a GridTable mock that mirrors the real empty rendering
 * (default "No data available"), shows its rows on revisit rather than an empty
 * state. The precise reproduction of the production flash — a transient refetch
 * error blanking the table — lives at the controller level in
 * `useResourceInventoryTable.cache.test.tsx` ("keeps the last rows through a
 * transient refetch error").
 */
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestRefreshDomainStateMock, gridRenders } = vi.hoisted(() => ({
  requestRefreshDomainStateMock: vi.fn(),
  gridRenders: [] as Array<{ rows: number; loading: boolean; emptyMessage: unknown }>,
}));

// Faithful GridTable: mirrors the real component's empty/loading rendering
// (GridTable.tsx — default emptyMessage "No data available"; a loading overlay
// only while loading with zero rows).
vi.mock('@shared/components/tables/GridTable', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    __esModule: true,
    default: (props: { data?: unknown[]; loading?: boolean; emptyMessage?: string }) => {
      const rows = props.data?.length ?? 0;
      gridRenders.push({ rows, loading: Boolean(props.loading), emptyMessage: props.emptyMessage });
      if (props.loading && rows === 0) {
        return <div>updating…</div>;
      }
      if (rows === 0) {
        return <div>{props.emptyMessage ?? 'No data available'}</div>;
      }
      return <div data-testid="grid">{rows} rows</div>;
    },
  };
});

// Real ResourceLoadingBoundary is used (NOT mocked). Stub only its refresh-state hook.
vi.mock('@/core/refresh/hooks/useAutoRefreshLoadingState', () => ({
  useAutoRefreshLoadingState: () => ({ isPaused: false, isManualRefreshActive: false }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: 'cluster-a', selectedClusterIds: ['cluster-a'] }),
}));

vi.mock('@/core/data-access', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requestRefreshDomain: vi.fn().mockResolvedValue(undefined),
    requestRefreshDomainState: (request: unknown) => requestRefreshDomainStateMock(request),
    useScopedRefreshDomainLifecycle: vi.fn(),
  };
});

// Live domain on revisit: idle and empty (the foreground domain has not delivered yet).
vi.mock('@/core/refresh', () => ({
  useRefreshScopedDomain: () => ({
    data: { metrics: null, rows: [] },
    status: 'idle',
    isManual: false,
  }),
  refreshManager: { triggerManualRefresh: vi.fn() },
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    sortConfig: null,
    setSortConfig: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
    setFilters: vi.fn(),
    setPageSize: vi.fn(),
    resetState: vi.fn(),
    hydrated: true,
    storageKey: 'gridtable:v1:test',
  }),
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (
    data: unknown[],
    defaultKey?: string,
    defaultDir?: string,
    opts?: { controlledSort?: { key: string; direction: string | null } | null }
  ) => ({
    sortedData: data,
    sortConfig: opts?.controlledSort ?? {
      key: defaultKey ?? 'name',
      direction: defaultDir ?? 'asc',
    },
    handleSort: vi.fn(),
  }),
}));

vi.mock('@core/contexts/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: [],
    addFavorite: vi.fn(),
    updateFavorite: vi.fn(),
    deleteFavorite: vi.fn(),
    reorderFavorites: vi.fn(),
  }),
  FavoritesProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@ui/favorites/FavToggle', () => ({
  useFavToggle: () => ({
    type: 'toggle',
    id: 'favorite',
    icon: null,
    active: false,
    onClick: () => undefined,
    title: 'fav',
  }),
}));
vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: vi.fn() }),
}));
vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));
vi.mock('@shared/hooks/useObjectActionController', () => ({
  useObjectActionController: () => ({ getMenuItems: () => [], modals: null }),
}));
vi.mock('@shared/hooks/useNodeMaintenanceActions', () => ({
  useNodeMaintenanceActions: () => ({
    activeDrainFor: () => null,
    openDrainFor: vi.fn(),
    openCordonFor: vi.fn(),
    modals: null,
  }),
}));
vi.mock('@/hooks/useShortNames', () => ({ useShortNames: () => false }));
vi.mock('@/core/refresh/hooks/useMetricsAvailability', () => ({
  useClusterMetricsAvailability: () => ({
    available: true,
    stale: false,
    lastError: null,
    collectedAt: 1,
  }),
}));

import ClusterViewNodes from '@modules/cluster/components/ClusterViewNodes';

const nodePayload = {
  status: 'executed',
  data: {
    status: 'ready',
    data: {
      rows: [{ kind: 'Node', name: 'node-1', clusterId: 'cluster-a', status: 'Ready', age: '1d' }],
      total: 1,
      totalIsExact: true,
    },
  },
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('Nodes view revisit', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridRenders.length = 0;
    requestRefreshDomainStateMock.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('does not flash an empty/no-data state on revisit once data was loaded before', async () => {
    // First visit: the query resolves with a node.
    requestRefreshDomainStateMock.mockResolvedValue(nodePayload);
    await act(async () => {
      root.render(<ClusterViewNodes />);
    });
    await flush();
    expect(container.textContent).toContain('1 rows');

    // Navigate away.
    act(() => root.unmount());
    root = ReactDOM.createRoot(container);
    gridRenders.length = 0;

    // Revisit: the query is in flight (unresolved) on the way back in.
    requestRefreshDomainStateMock.mockReturnValue(new Promise(() => undefined));
    await act(async () => {
      root.render(<ClusterViewNodes />);
    });
    await flush();

    // It must show the prior rows (or at worst a spinner) — never the empty
    // "No data available" / "No nodes found" state.
    expect(container.textContent ?? '').not.toContain('No data available');
    expect(container.textContent ?? '').not.toContain('No nodes found');
  });
});
