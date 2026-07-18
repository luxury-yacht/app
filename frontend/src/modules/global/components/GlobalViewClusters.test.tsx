import type * as React from 'react';
import { act, isValidElement } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setActiveKubeconfig: vi.fn(),
  setClusterNavigationTarget: vi.fn(),
  activateClusterWorkspace: vi.fn(),
  setSidebarSelectionForCluster: vi.fn(),
  requestRefreshDomain: vi.fn(() => Promise.resolve({ status: 'executed' })),
  acquireRefreshDomainLease: vi.fn(),
  releaseRefreshDomainLease: vi.fn(),
  setRefreshDomainEnabled: vi.fn(),
  useStreamSignalRefetch: vi.fn(),
  selectedKubeconfigs: [
    '/kube/config:alpha',
    '/kube/config:beta',
    '/kube/config:gamma',
  ] as string[],
  tableProps: null as null | Record<string, unknown>,
  persistenceParams: null as null | Record<string, unknown>,
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
    cpuRequests: '2400m',
    cpuLimits: '6000m',
    cpuAllocatable: '8000m',
    memoryUsage: '8Gi',
    memoryRequests: '12Gi',
    memoryLimits: '24Gi',
    memoryAllocatable: '32Gi',
    unavailableResources: [],
  },
  metrics: {
    collectedAt: 1_700_001_000,
    stale: false,
    successCount: 2,
    failureCount: 0,
  },
};

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedKubeconfigs: [...mocks.selectedKubeconfigs],
    selectedClusterIds: mocks.selectedKubeconfigs.map((selection) => {
      const parts = selection.split(':');
      const name = parts[parts.length - 1];
      return `cluster-${name === 'alpha' ? 'a' : name === 'beta' ? 'b' : 'c'}`;
    }),
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
  useViewState: () => ({
    setClusterNavigationTarget: mocks.setClusterNavigationTarget,
    activateClusterWorkspace: mocks.activateClusterWorkspace,
  }),
}));

vi.mock('@/core/contexts/SidebarStateContext', () => ({
  useSidebarState: () => ({
    setSidebarSelectionForCluster: mocks.setSidebarSelectionForCluster,
  }),
}));

vi.mock('@/core/data-access', () => ({
  requestRefreshDomain: mocks.requestRefreshDomain,
  acquireRefreshDomainLease: mocks.acquireRefreshDomainLease,
  releaseRefreshDomainLease: mocks.releaseRefreshDomainLease,
  setRefreshDomainEnabled: mocks.setRefreshDomainEnabled,
}));

vi.mock('@/core/data-access/dataAccess', () => ({
  requestRefreshDomain: mocks.requestRefreshDomain,
  acquireRefreshDomainLease: mocks.acquireRefreshDomainLease,
  releaseRefreshDomainLease: mocks.releaseRefreshDomainLease,
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
  useGridTablePersistence: (params: Record<string, unknown>) => {
    mocks.persistenceParams = params;
    return {
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
    };
  },
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
    const name = columns.find((column) => column.key === 'name');
    const attention = columns.find((column) => column.key === 'attention');
    return (
      <div data-testid="global-clusters-table">
        {source.rows.map((row) => (
          <div key={String(row.clusterId)} data-testid={`global-clusters-${row.clusterId}`}>
            {name?.render(row)}
            <span>{String(row.connection)}</span>
            {attention?.render(row)}
          </div>
        ))}
      </div>
    );
  },
}));

const renderGlobalClusters = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  let renderVersion = 0;
  const render = async () => {
    const { default: GlobalViewClusters } = await import('./GlobalViewClusters');
    const TestableGlobalViewClusters = GlobalViewClusters as React.ComponentType<{
      renderVersion: number;
    }>;
    root.render(<TestableGlobalViewClusters renderVersion={renderVersion} />);
  };
  await act(async () => {
    await render();
    await Promise.resolve();
  });
  return {
    container,
    rerender: async () => {
      await act(async () => {
        renderVersion += 1;
        await render();
        await Promise.resolve();
      });
    },
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectedKubeconfigs = ['/kube/config:alpha', '/kube/config:beta', '/kube/config:gamma'];
  mocks.tableProps = null;
  mocks.persistenceParams = null;
});

afterEach(() => {
  document.body.innerHTML = '';
});

const getTableProps = (): Record<string, unknown> => {
  if (!mocks.tableProps) {
    throw new Error('expected Clusters table props');
  }
  return mocks.tableProps;
};

const getPersistenceParams = (): Record<string, unknown> => {
  if (!mocks.persistenceParams) {
    throw new Error('expected Clusters persistence params');
  }
  return mocks.persistenceParams;
};

describe('GlobalViewClusters', () => {
  it('removes only the closed cluster owner and retains the Global table owner', async () => {
    const { rerender, unmount } = await renderGlobalClusters();

    expect(mocks.acquireRefreshDomainLease).toHaveBeenCalledWith({
      domain: 'cluster-overview',
      scope: 'cluster-a|',
      preserveState: true,
    });
    expect(mocks.acquireRefreshDomainLease).toHaveBeenCalledWith({
      domain: 'cluster-overview',
      scope: 'cluster-b|',
      preserveState: true,
    });
    const initialPersistenceIdentity = getPersistenceParams().clusterIdentity;
    const initialCacheKey = (getTableProps().source as { cacheKey?: string }).cacheKey;

    mocks.acquireRefreshDomainLease.mockClear();
    mocks.releaseRefreshDomainLease.mockClear();
    mocks.requestRefreshDomain.mockClear();
    mocks.setRefreshDomainEnabled.mockClear();
    mocks.selectedKubeconfigs = ['/kube/config:alpha', '/kube/config:gamma'];
    await rerender();

    expect(mocks.releaseRefreshDomainLease).toHaveBeenCalledOnce();
    expect(mocks.releaseRefreshDomainLease).toHaveBeenCalledWith({
      domain: 'cluster-overview',
      scope: 'cluster-b|',
      preserveState: true,
    });
    expect(mocks.acquireRefreshDomainLease).not.toHaveBeenCalled();
    expect(mocks.requestRefreshDomain).not.toHaveBeenCalled();
    expect(mocks.setRefreshDomainEnabled).not.toHaveBeenCalled();
    expect(getPersistenceParams().clusterIdentity).toBe(initialPersistenceIdentity);
    expect((getTableProps().source as { cacheKey?: string }).cacheKey).toBe(initialCacheKey);

    mocks.acquireRefreshDomainLease.mockClear();
    mocks.releaseRefreshDomainLease.mockClear();
    mocks.requestRefreshDomain.mockClear();
    mocks.selectedKubeconfigs = ['/kube/config:alpha', '/kube/config:beta', '/kube/config:gamma'];
    await rerender();

    expect(mocks.acquireRefreshDomainLease).toHaveBeenCalledOnce();
    expect(mocks.acquireRefreshDomainLease).toHaveBeenCalledWith({
      domain: 'cluster-overview',
      scope: 'cluster-b|',
      preserveState: true,
    });
    expect(mocks.releaseRefreshDomainLease).not.toHaveBeenCalled();
    expect(mocks.requestRefreshDomain).toHaveBeenCalledOnce();
    expect(mocks.requestRefreshDomain).toHaveBeenCalledWith({
      domain: 'cluster-overview',
      scope: 'cluster-b|',
      reason: 'startup',
      label: 'Clusters overview: beta',
    });
    expect(getPersistenceParams().clusterIdentity).toBe(initialPersistenceIdentity);
    expect((getTableProps().source as { cacheKey?: string }).cacheKey).toBe(initialCacheKey);

    await unmount();
  });

  it('renders complete cluster identity and mixed ready, loading, and auth-failed states', async () => {
    const { container, unmount } = await renderGlobalClusters();

    expect(
      container.querySelector('[data-testid="global-clusters-cluster-a"]')?.textContent
    ).toContain('Ready');
    expect(
      container.querySelector('[data-testid="global-clusters-cluster-b"]')?.textContent
    ).toContain('Loading');
    expect(
      container.querySelector('[data-testid="global-clusters-cluster-c"]')?.textContent
    ).toContain('Authentication required');

    const tableProps = mocks.tableProps;
    if (!tableProps) {
      throw new Error('expected Clusters table props');
    }
    const rows = (tableProps.source as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows.map(({ clusterId, name }) => ({ clusterId, name }))).toEqual([
      { clusterId: 'cluster-a', name: 'alpha' },
      { clusterId: 'cluster-b', name: 'beta' },
      { clusterId: 'cluster-c', name: 'gamma' },
    ]);
    const columns = tableProps.columns as Array<{
      key: string;
      header?: React.ReactNode;
      render?: (row: Record<string, unknown>) => React.ReactNode;
      sortValue?: (row: Record<string, unknown>) => string | number;
    }>;
    expect(columns.map(({ key }) => key)).toEqual([
      'name',
      'connection',
      'metrics',
      'clusterType',
      'clusterVersion',
      'totalNamespaces',
      'nodes',
      'pods',
      'attention',
      'cpu',
      'memory',
    ]);
    expect(Object.fromEntries(columns.map(({ key, header }) => [key, header]))).toMatchObject({
      connection: 'Status',
      nodes: 'Nodes',
      pods: 'Pods',
      totalNamespaces: 'NS',
    });
    const statusColumn = columns.find(({ key }) => key === 'connection');
    expect(statusColumn?.render?.(rows[0])).toBe('Ready');
    for (const row of rows.slice(1)) {
      const statusCell = statusColumn?.render?.(row);
      expect(isValidElement<{ className?: string }>(statusCell)).toBe(true);
      if (!isValidElement<{ className?: string }>(statusCell)) {
        throw new Error('expected warning Status cell');
      }
      expect(statusCell.props.className).toBe('status-text warning');
    }
    const cpuCell = columns.find(({ key }) => key === 'cpu')?.render?.(rows[0]);
    expect(isValidElement<Record<string, unknown>>(cpuCell)).toBe(true);
    if (!isValidElement<Record<string, unknown>>(cpuCell)) {
      throw new Error('expected CPU ResourceBar');
    }
    expect(cpuCell.props).toMatchObject({
      usage: '1200m',
      request: '2400m',
      limit: '6000m',
      allocatable: '8000m',
      type: 'cpu',
      variant: 'compact',
      metricsStale: false,
      metricsLastUpdated: new Date(1_700_001_000 * 1000),
      animationScopeKey: 'cluster:cluster-a:cpu',
    });
    const memoryCell = columns.find(({ key }) => key === 'memory')?.render?.(rows[0]);
    expect(isValidElement<Record<string, unknown>>(memoryCell)).toBe(true);
    if (!isValidElement<Record<string, unknown>>(memoryCell)) {
      throw new Error('expected Memory ResourceBar');
    }
    expect(memoryCell.props).toMatchObject({
      usage: '8Gi',
      request: '12Gi',
      limit: '24Gi',
      allocatable: '32Gi',
      type: 'memory',
      variant: 'compact',
      animationScopeKey: 'cluster:cluster-a:memory',
    });
    expect(columns.find(({ key }) => key === 'cpu')?.render?.(rows[1])).toBe('—');
    expect(columns.find(({ key }) => key === 'memory')?.render?.(rows[1])).toBe('—');
    expect(columns.find(({ key }) => key === 'cpu')?.sortValue?.(rows[0])).toBe(1200);
    expect(columns.find(({ key }) => key === 'memory')?.sortValue?.(rows[0])).toBe(8192);
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
      label: 'Clusters overview: alpha',
    });
    expect(mocks.requestRefreshDomain).toHaveBeenCalledWith({
      domain: 'cluster-overview',
      scope: 'cluster-b|',
      reason: 'startup',
      label: 'Clusters overview: beta',
    });
    expect(mocks.requestRefreshDomain).not.toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'cluster-c|' })
    );
    expect(tableProps.spinnerMessage).toBe('Loading clusters...');
    expect(tableProps.updatingMessage).toBe('Updating clusters…');
    expect(tableProps.emptyMessage).toBe('Open at least one cluster to compare cluster state');
    expect(tableProps.diagnosticsLabel).toBe('Clusters');

    await unmount();
  });

  it('prepares target-cluster navigation before activating the cluster tab', async () => {
    const { container, unmount } = await renderGlobalClusters();
    expect(mocks.tableProps).not.toHaveProperty('onRowClick');
    expect(mocks.tableProps).not.toHaveProperty('onRowPointerClick');
    const cluster = container.querySelector<HTMLButtonElement>(
      '[data-testid="global-clusters-cluster-b"] .object-panel-link'
    );
    expect(cluster?.className).toContain('gridtable-link');

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
    expect(mocks.activateClusterWorkspace).toHaveBeenCalledWith('cluster-b');
    expect(mocks.setClusterNavigationTarget.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.activateClusterWorkspace.mock.invocationCallOrder[0]
    );
    expect(mocks.activateClusterWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setActiveKubeconfig.mock.invocationCallOrder[0]
    );

    const attention = container.querySelector<HTMLElement>(
      '[data-testid="global-clusters-cluster-a"] [data-testid="global-clusters-attention"]'
    );
    expect(attention?.tagName).toBe('SPAN');
    expect(mocks.setClusterNavigationTarget).toHaveBeenCalledTimes(1);

    await unmount();
  });
});
