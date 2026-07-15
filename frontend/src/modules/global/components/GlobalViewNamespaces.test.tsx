import type * as React from 'react';
import { act, isValidElement, type ReactNode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setActiveKubeconfig: vi.fn(),
  setClusterNavigationTarget: vi.fn(),
  activateClusterWorkspace: vi.fn(),
  setSidebarSelectionForCluster: vi.fn(),
  setSelectedNamespace: vi.fn(),
  tableProps: null as null | Record<string, unknown>,
  resourceGridParams: null as null | Record<string, unknown>,
  persistenceParams: null as null | Record<string, unknown>,
  openWithObject: vi.fn(),
  selectedKubeconfigs: [
    '/kube/config:alpha',
    '/kube/config:beta',
    '/kube/config:gamma',
  ] as string[],
}));

const namespace = (clusterId: string, clusterName: string, name: string) => ({
  clusterId,
  clusterName,
  ref: {
    clusterId,
    group: '',
    version: 'v1',
    kind: 'Namespace',
    resource: 'namespaces',
    name,
  },
  name,
  phase: 'Active',
  status: 'Active',
  statusState: 'active',
  statusPresentation: 'success',
  resourceVersion: '12',
  creationTimestamp: 1_700_000_000,
  hasWorkloads: true,
  unhealthyWorkloads: 0,
  warningEvents: 0,
  warningEventsState: 'available',
  cpuUsageMilli: 100,
  cpuRequestsMilli: 250,
  cpuLimitsMilli: 500,
  memoryUsageBytes: 128 * 1024 * 1024,
  memoryRequestsBytes: 256 * 1024 * 1024,
  memoryLimitsBytes: 512 * 1024 * 1024,
  quotaCount: 0,
  quotaHighestUsedPercentage: 0,
  quotaPressure: '',
  quotaPressureState: 'available',
});

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedKubeconfigs: [...mocks.selectedKubeconfigs],
    selectedClusterIds: mocks.selectedKubeconfigs.map((selection) => {
      const parts = selection.split(':');
      const name = parts[parts.length - 1];
      return `cluster-${name === 'alpha' ? 'a' : name === 'beta' ? 'b' : 'c'}`;
    }),
    getClusterMeta: (selection: string) => {
      const parts = selection.split(':');
      const name = parts[parts.length - 1] ?? '';
      const suffix = name === 'alpha' ? 'a' : name === 'beta' ? 'b' : 'c';
      return { id: `cluster-${suffix}`, name };
    },
    setActiveKubeconfig: mocks.setActiveKubeconfig,
  }),
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  isNamespaceRefreshAvailable: () => true,
  useNamespace: () => ({ setSelectedNamespace: mocks.setSelectedNamespace }),
  useNamespaceStatesByScope: () => ({
    'cluster-a|': {
      status: 'ready',
      data: {
        clusterId: 'cluster-a',
        clusterName: 'alpha',
        namespaces: [namespace('cluster-a', 'alpha', 'payments')],
        metrics: { successCount: 1, failureCount: 0 },
        metricsState: 'available',
      },
      error: null,
      permissionDenied: false,
    },
    'cluster-b|': {
      status: 'ready',
      data: {
        clusterId: 'cluster-b',
        clusterName: 'beta',
        namespaces: [namespace('cluster-b', 'beta', 'payments')],
        metrics: { successCount: 0, failureCount: 1 },
        metricsState: 'unavailable',
      },
      error: null,
      permissionDenied: false,
    },
    'cluster-c|': {
      status: 'error',
      data: null,
      error: 'forbidden',
      permissionDenied: true,
    },
  }),
}));

vi.mock('@core/contexts/ClusterLifecycleContext', () => ({
  useClusterLifecycle: () => ({ getClusterState: () => 'ready' }),
}));

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => ({
    setClusterNavigationTarget: mocks.setClusterNavigationTarget,
    activateClusterWorkspace: mocks.activateClusterWorkspace,
  }),
}));

vi.mock('@core/contexts/SidebarStateContext', () => ({
  useSidebarState: () => ({
    setSidebarSelectionForCluster: mocks.setSidebarSelectionForCluster,
  }),
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: mocks.openWithObject }),
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
  useClusterResourceGridTable: (params: Record<string, unknown>) => {
    mocks.resourceGridParams = params;
    return {
      gridTableProps: { data: params.data, keyExtractor: params.keyExtractor },
      favModal: null,
    };
  },
}));

vi.mock('@modules/resource-grid/ResourceInventoryTable', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.tableProps = props;
    const source = props.source as { rows: Array<Record<string, unknown>> };
    const columns = props.columns as Array<{
      key: string;
      render: (row: Record<string, unknown>) => ReactNode;
    }>;
    const namespaceColumn = columns.find(({ key }) => key === 'name');
    const clusterColumn = columns.find(({ key }) => key === 'cluster');
    const kindColumn = columns.find(({ key }) => key === 'kind');
    return (
      <div data-testid="global-namespace-table">
        {source.rows.map((row) => (
          <div
            key={`${String(row.clusterId)}:${String(row.name)}`}
            data-testid={`namespace-row-${String(row.clusterId)}-${String(row.name)}`}
          >
            <span data-testid={`kind-${String(row.clusterId)}-${String(row.name)}`}>
              {kindColumn?.render(row)}
            </span>
            <span data-testid={`namespace-link-${String(row.clusterId)}-${String(row.name)}`}>
              {namespaceColumn?.render(row)}
            </span>
            <span data-testid={`cluster-link-${String(row.clusterId)}-${String(row.name)}`}>
              {clusterColumn?.render(row)}
            </span>
          </div>
        ))}
      </div>
    );
  },
}));

const renderView = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  let renderVersion = 0;
  const render = async () => {
    const { default: GlobalViewNamespaces } = await import('./GlobalViewNamespaces');
    const TestableGlobalViewNamespaces = GlobalViewNamespaces as React.ComponentType<{
      renderVersion: number;
    }>;
    root.render(<TestableGlobalViewNamespaces renderVersion={renderVersion} />);
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
  mocks.resourceGridParams = null;
  mocks.persistenceParams = null;
});

afterEach(() => {
  document.body.innerHTML = '';
});

const renderedText = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return renderedText(node.props.children);
  }
  return '';
};

const getTableProps = (): Record<string, unknown> => {
  if (!mocks.tableProps) {
    throw new Error('expected global namespace table props');
  }
  return mocks.tableProps;
};

const getPersistenceParams = (): Record<string, unknown> => {
  if (!mocks.persistenceParams) {
    throw new Error('expected global namespace persistence params');
  }
  return mocks.persistenceParams;
};

describe('GlobalViewNamespaces', () => {
  it('retains its Global table owner when cluster membership changes', async () => {
    const { rerender, unmount } = await renderView();
    const initialPersistenceIdentity = getPersistenceParams().clusterIdentity;
    const initialCacheKey = (getTableProps().source as { cacheKey?: string }).cacheKey;
    const initialPaginationId = (getTableProps().localPagination as { idPrefix?: string }).idPrefix;

    mocks.selectedKubeconfigs = ['/kube/config:alpha', '/kube/config:gamma'];
    await rerender();

    expect(getPersistenceParams().clusterIdentity).toBe(initialPersistenceIdentity);
    expect((getTableProps().source as { cacheKey?: string }).cacheKey).toBe(initialCacheKey);
    expect((getTableProps().localPagination as { idPrefix?: string }).idPrefix).toBe(
      initialPaginationId
    );

    await unmount();
  });

  it('combines namespace snapshots with complete cluster identity and a Cluster column', async () => {
    const { container, unmount } = await renderView();
    if (!mocks.tableProps) {
      throw new Error('expected global namespace table props');
    }

    const columns = mocks.tableProps.columns as Array<{
      key: string;
      render?: (row: Record<string, unknown>) => ReactNode;
    }>;
    expect(columns.map(({ key }) => key)).toEqual([
      'kind',
      'name',
      'cluster',
      'status',
      'workloads',
      'unhealthyWorkloads',
      'warningEvents',
      'cpu',
      'memory',
      'quotaPressure',
      'age',
    ]);

    const source = mocks.tableProps.source as {
      rows: Array<Record<string, unknown>>;
      completeness: string;
      partialLabel: string | null;
    };
    expect(source.rows).toHaveLength(2);
    expect(
      source.rows.map(({ clusterId, clusterName, name, metricsState }) => ({
        clusterId,
        clusterName,
        name,
        metricsState,
      }))
    ).toEqual([
      { clusterId: 'cluster-a', clusterName: 'alpha', name: 'payments', metricsState: 'available' },
      {
        clusterId: 'cluster-b',
        clusterName: 'beta',
        name: 'payments',
        metricsState: 'unavailable',
      },
    ]);
    const keyExtractor = (
      mocks.tableProps.gridTableProps as {
        keyExtractor: (row: Record<string, unknown>) => string;
      }
    ).keyExtractor;
    expect(source.rows.map(keyExtractor)).toEqual([
      'cluster-a|/v1/Namespace//payments',
      'cluster-b|/v1/Namespace//payments',
    ]);
    expect(
      renderedText(columns.find(({ key }) => key === 'cluster')?.render?.(source.rows[1]))
    ).toBe('beta');
    const cpuCell = columns.find(({ key }) => key === 'cpu')?.render?.(source.rows[0]);
    expect(isValidElement<Record<string, unknown>>(cpuCell)).toBe(true);
    if (!isValidElement<Record<string, unknown>>(cpuCell)) {
      throw new Error('expected global namespace CPU ResourceBar');
    }
    expect(cpuCell.props).toMatchObject({
      usage: '100m',
      request: '250m',
      limit: '500m',
    });
    expect(source.completeness).toBe('partial');
    expect(source.partialLabel).toBe('Showing namespace data from 2 of 3 clusters');

    const resourceGridParams = mocks.resourceGridParams as {
      filterAccessors: { getCluster: (row: Record<string, unknown>) => string };
      filterOptionOverrides: {
        clusters: Array<{ value: string; label: string }>;
        showClusterDropdown: boolean;
      };
    };
    expect(resourceGridParams.filterAccessors.getCluster(source.rows[1])).toBe('cluster-b');
    expect(resourceGridParams.filterOptionOverrides).toMatchObject({
      clusters: [
        { value: 'cluster-a', label: 'alpha' },
        { value: 'cluster-b', label: 'beta' },
        { value: 'cluster-c', label: 'gamma' },
      ],
      showClusterDropdown: true,
    });
    expect(mocks.persistenceParams).toMatchObject({
      filterOptions: { clusters: ['cluster-a', 'cluster-b', 'cluster-c'] },
      pageSizeOptions: [25, 50, 100, 250, 500, 1000],
    });
    expect(mocks.tableProps.localPagination).toMatchObject({
      idPrefix: 'global-namespaces-global:namespaces',
      pageSize: 50,
      pageSizeOptions: [25, 50, 100, 250, 500, 1000],
    });
    expect(mocks.tableProps).not.toHaveProperty('onRowClick');
    expect(mocks.tableProps).not.toHaveProperty('onRowPointerClick');
    const namespaceLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="namespace-link-cluster-b-payments"] button'
    );
    const clusterLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="cluster-link-cluster-b-payments"] button'
    );
    expect(namespaceLink?.className.split(' ')).toEqual(
      expect.arrayContaining(['gridtable-link', 'object-panel-link'])
    );
    expect(clusterLink?.className.split(' ')).toEqual(
      expect.arrayContaining(['gridtable-link', 'object-panel-link'])
    );

    await unmount();
  });

  it('stages the target namespace navigation before activating its cluster', async () => {
    const { container, unmount } = await renderView();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="namespace-link-cluster-b-payments"] button'
        )
        ?.click();
    });

    expect(mocks.setSelectedNamespace).toHaveBeenCalledWith('payments', 'cluster-b');
    expect(mocks.setClusterNavigationTarget).toHaveBeenCalledWith('cluster-b', {
      viewType: 'namespace',
      activeNamespaceView: 'browse',
    });
    expect(mocks.setSidebarSelectionForCluster).toHaveBeenCalledWith('cluster-b', {
      type: 'namespace',
      value: 'payments',
    });
    expect(mocks.setActiveKubeconfig).toHaveBeenCalledWith('/kube/config:beta');
    expect(mocks.activateClusterWorkspace).toHaveBeenCalledWith('cluster-b');
    expect(mocks.setSelectedNamespace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setActiveKubeconfig.mock.invocationCallOrder[0]
    );
    expect(mocks.setClusterNavigationTarget.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setActiveKubeconfig.mock.invocationCallOrder[0]
    );
    expect(mocks.setSidebarSelectionForCluster.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.activateClusterWorkspace.mock.invocationCallOrder[0]
    );
    expect(mocks.activateClusterWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setActiveKubeconfig.mock.invocationCallOrder[0]
    );

    await unmount();
  });

  it('opens the namespace Object Panel from Kind without staging navigation', async () => {
    const { container, unmount } = await renderView();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="kind-cluster-b-payments"] button')
        ?.click();
    });

    expect(mocks.openWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'cluster-b',
        group: '',
        version: 'v1',
        kind: 'Namespace',
        resource: 'namespaces',
        name: 'payments',
      })
    );
    expect(mocks.setSelectedNamespace).not.toHaveBeenCalled();
    expect(mocks.setClusterNavigationTarget).not.toHaveBeenCalled();
    expect(mocks.setSidebarSelectionForCluster).not.toHaveBeenCalled();
    expect(mocks.setActiveKubeconfig).not.toHaveBeenCalled();

    await unmount();
  });

  it('opens a cluster from its explicit link without selecting the namespace', async () => {
    const { container, unmount } = await renderView();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="cluster-link-cluster-b-payments"] button')
        ?.click();
    });

    expect(mocks.setSelectedNamespace).not.toHaveBeenCalled();
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
      mocks.setActiveKubeconfig.mock.invocationCallOrder[0]
    );
    expect(mocks.setSidebarSelectionForCluster.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.activateClusterWorkspace.mock.invocationCallOrder[0]
    );
    expect(mocks.activateClusterWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setActiveKubeconfig.mock.invocationCallOrder[0]
    );

    await unmount();
  });
});
