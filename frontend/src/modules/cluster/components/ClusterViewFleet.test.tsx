import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setActiveKubeconfig: vi.fn(),
  setClusterNavigationTarget: vi.fn(),
  setSidebarSelectionForCluster: vi.fn(),
  requestRefreshDomain: vi.fn(() => Promise.resolve({ status: 'executed' })),
  setRefreshDomainEnabled: vi.fn(),
  useStreamSignalRefetch: vi.fn(),
  tableProps: null as null | Record<string, unknown>,
}));

const overview = {
  clusterId: 'cluster-a',
  clusterName: 'alpha',
  overview: {
    clusterVersion: 'v1.32.1',
    clusterType: 'EKS',
    readyNodes: 3,
    totalNodes: 4,
    notReadyNodes: 1,
    readyPods: 25,
    totalPods: 30,
    failingPods: 2,
    pendingPods: 1,
    totalNamespaces: 8,
    cpuUsage: '1200m',
    cpuAllocatable: '8000m',
    memoryUsage: '8Gi',
    memoryAllocatable: '32Gi',
    unavailableResources: [],
  },
  metrics: {
    stale: false,
    successCount: 2,
    failureCount: 0,
  },
};

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedKubeconfigs: ['/kube/config:alpha', '/kube/config:beta', '/kube/config:gamma'],
    selectedClusterIds: ['cluster-a', 'cluster-b', 'cluster-c'],
    selectedClusterId: 'cluster-a',
    kubeconfigsLoading: false,
    getClusterMeta: (selection: string) => {
      const parts = selection.split(':');
      const name = parts[parts.length - 1] ?? '';
      const suffix = name === 'alpha' ? 'a' : name === 'beta' ? 'b' : 'c';
      return { id: `cluster-${suffix}`, name };
    },
    setActiveKubeconfig: mocks.setActiveKubeconfig,
  }),
}));

vi.mock('@/core/contexts/ClusterLifecycleContext', () => ({
  useClusterLifecycle: () => ({
    getClusterState: (clusterId: string) =>
      ({ 'cluster-a': 'ready', 'cluster-b': 'loading', 'cluster-c': 'auth_failed' })[clusterId],
  }),
}));

vi.mock('@/core/contexts/AuthErrorContext', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/contexts/AuthErrorContext')>();
  return {
    ...original,
    useAuthError: () => ({
      getClusterAuthState: (clusterId: string) => ({
        hasError: clusterId === 'cluster-c',
        reason: clusterId === 'cluster-c' ? 'token expired' : '',
        clusterName: clusterId,
        isRecovering: false,
        secondsUntilRetry: 0,
        errorClass: clusterId === 'cluster-c' ? 'auth' : '',
        execCommand: '',
        diagnosticKind: '',
        diagnosticSummary: '',
      }),
    }),
  };
});

vi.mock('@/core/contexts/ViewStateContext', () => ({
  useViewState: () => ({ setClusterNavigationTarget: mocks.setClusterNavigationTarget }),
}));

vi.mock('@/core/contexts/SidebarStateContext', () => ({
  useSidebarState: () => ({
    setSidebarSelectionForCluster: mocks.setSidebarSelectionForCluster,
  }),
}));

vi.mock('@/core/data-access', () => ({
  requestRefreshDomain: mocks.requestRefreshDomain,
  setRefreshDomainEnabled: mocks.setRefreshDomainEnabled,
}));

vi.mock('@/core/refresh', () => ({
  useRefreshScopedDomainStates: () => ({
    'cluster-a|': {
      status: 'ready',
      data: overview,
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
    },
  }),
}));

vi.mock('@/core/refresh/hooks/useStreamSignalRefetch', () => ({
  useStreamSignalRefetch: mocks.useStreamSignalRefetch,
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    sortConfig: { key: 'name', direction: 'asc' },
    setSortConfig: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: {
      search: '',
      kinds: [],
      namespaces: [],
      caseSensitive: false,
      includeMetadata: false,
    },
    setFilters: vi.fn(),
    pageSize: null,
    setPageSize: vi.fn(),
    resetState: vi.fn(),
    hydrated: true,
  }),
}));

vi.mock('@modules/resource-grid/useResourceGridTable', () => ({
  useClusterResourceGridTable: ({ data, keyExtractor }: Record<string, unknown>) => ({
    gridTableProps: { data, keyExtractor },
    favModal: null,
  }),
}));

vi.mock('@modules/resource-grid/ResourceInventoryTable', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.tableProps = props;
    const source = props.source as { rows: Array<Record<string, unknown>> };
    const columns = props.columns as Array<{
      key: string;
      render: (row: Record<string, unknown>) => React.ReactNode;
    }>;
    const attention = columns.find((column) => column.key === 'attention');
    const onRowPointerClick = props.onRowPointerClick as
      | ((row: Record<string, unknown>) => void)
      | undefined;
    return (
      <div data-testid="fleet-table">
        {source.rows.map((row) => (
          <div key={String(row.clusterId)} data-testid={`fleet-${row.clusterId}`}>
            <button type="button" onClick={() => onRowPointerClick?.(row)}>
              {String(row.name)}
            </button>
            <span>{String(row.connection)}</span>
            {attention?.render(row)}
          </div>
        ))}
      </div>
    );
  },
}));

const renderFleet = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  await act(async () => {
    const { default: ClusterViewFleet } = await import('./ClusterViewFleet');
    root.render(<ClusterViewFleet />);
    await Promise.resolve();
  });
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tableProps = null;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ClusterViewFleet', () => {
  it('renders complete cluster identity and mixed ready, loading, and auth-failed states', async () => {
    const { container, unmount } = await renderFleet();

    expect(container.querySelector('[data-testid="fleet-cluster-a"]')?.textContent).toContain(
      'Ready'
    );
    expect(container.querySelector('[data-testid="fleet-cluster-b"]')?.textContent).toContain(
      'Loading'
    );
    expect(container.querySelector('[data-testid="fleet-cluster-c"]')?.textContent).toContain(
      'Authentication required'
    );

    const tableProps = mocks.tableProps;
    if (!tableProps) {
      throw new Error('expected Fleet table props');
    }
    const rows = (tableProps.source as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows.map(({ clusterId, name }) => ({ clusterId, name }))).toEqual([
      { clusterId: 'cluster-a', name: 'alpha' },
      { clusterId: 'cluster-b', name: 'beta' },
      { clusterId: 'cluster-c', name: 'gamma' },
    ]);
    const keyExtractor = (
      tableProps.gridTableProps as {
        keyExtractor: (row: Record<string, unknown>) => string;
      }
    ).keyExtractor;
    expect(keyExtractor(rows[0])).toBe('cluster-a|cluster-a');
    expect(mocks.requestRefreshDomain).toHaveBeenCalledWith({
      domain: 'cluster-overview',
      scope: 'cluster-a|',
      reason: 'startup',
      label: 'Fleet overview: alpha',
    });
    expect(mocks.requestRefreshDomain).toHaveBeenCalledWith({
      domain: 'cluster-overview',
      scope: 'cluster-b|',
      reason: 'startup',
      label: 'Fleet overview: beta',
    });
    expect(mocks.requestRefreshDomain).not.toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'cluster-c|' })
    );

    await unmount();
  });

  it('prepares target-cluster navigation before activating the cluster tab', async () => {
    const { container, unmount } = await renderFleet();
    const cluster = container.querySelector<HTMLButtonElement>(
      '[data-testid="fleet-cluster-b"] button'
    );

    await act(async () => cluster?.click());

    expect(mocks.setClusterNavigationTarget).toHaveBeenCalledWith('cluster-b', {
      viewType: 'overview',
      activeClusterView: null,
    });
    expect(mocks.setSidebarSelectionForCluster).toHaveBeenCalledWith('cluster-b', {
      type: 'overview',
      value: 'overview',
    });
    expect(mocks.setActiveKubeconfig).toHaveBeenCalledWith('/kube/config:beta');
    expect(mocks.setClusterNavigationTarget.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setActiveKubeconfig.mock.invocationCallOrder[0]
    );

    const attention = container.querySelector<HTMLButtonElement>(
      '[data-testid="fleet-cluster-a"] [data-testid="fleet-attention"]'
    );
    await act(async () => attention?.click());

    expect(mocks.setClusterNavigationTarget).toHaveBeenLastCalledWith('cluster-a', {
      viewType: 'cluster',
      activeClusterView: 'attention',
    });
    expect(mocks.setSidebarSelectionForCluster).toHaveBeenLastCalledWith('cluster-a', {
      type: 'cluster',
      value: 'cluster',
    });

    await unmount();
  });
});
