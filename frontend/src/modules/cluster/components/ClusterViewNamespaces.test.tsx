import { act, isValidElement, type ReactNode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onNamespaceSelect: vi.fn(),
  setSelectedNamespace: vi.fn(),
  setPageSize: vi.fn(),
  tableProps: null as null | Record<string, unknown>,
  resourceGridParams: null as null | Record<string, unknown>,
  persistenceParams: null as null | Record<string, unknown>,
  namespaceLoading: false,
  namespaceRefreshing: false,
  openWithObject: vi.fn(),
}));

const namespacePayload = {
  clusterId: 'cluster-a',
  clusterName: 'alpha',
  metrics: { successCount: 1, failureCount: 0 },
  metricsState: 'available',
  namespaces: [
    {
      clusterId: 'cluster-a',
      clusterName: 'alpha',
      ref: {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Namespace',
        resource: 'namespaces',
        name: 'payments',
      },
      name: 'payments',
      phase: 'Active',
      status: 'Active',
      statusState: 'active',
      statusPresentation: 'success',
      resourceVersion: '12',
      creationTimestamp: 1_700_000_000,
      hasWorkloads: true,
      workloadsUnknown: false,
      unhealthyWorkloads: 3,
      warningEvents: 5,
      warningEventsState: 'available',
      cpuUsageMilli: 450,
      cpuRequestsMilli: 300,
      cpuLimitsMilli: 600,
      memoryUsageBytes: 256 * 1024 * 1024,
      memoryRequestsBytes: 512 * 1024 * 1024,
      memoryLimitsBytes: 1024 * 1024 * 1024,
      quotaCount: 2,
      quotaHighestUsedPercentage: 92,
      quotaPressure: 'warning',
      quotaPressureState: 'available',
    },
  ],
};

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: 'cluster-a' }),
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => ({
    namespaceSummaries: namespacePayload.namespaces,
    namespaceMetricsState: namespacePayload.metricsState,
    namespaceError: null,
    namespaceLoading: mocks.namespaceLoading,
    namespaceRefreshing: mocks.namespaceRefreshing,
    namespacesPermissionDenied: false,
    setSelectedNamespace: mocks.setSelectedNamespace,
  }),
}));

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => ({ onNamespaceSelect: mocks.onNamespaceSelect }),
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
      setPageSize: mocks.setPageSize,
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
    const onRowPointerClick = props.onRowPointerClick as
      | ((row: Record<string, unknown>) => void)
      | undefined;
    const columns = props.columns as Array<{
      key: string;
      render: (row: Record<string, unknown>) => ReactNode;
    }>;
    const kindColumn = columns.find(({ key }) => key === 'kind');
    return (
      <div data-testid="namespace-table">
        {source.rows.map((row) => (
          <div key={String(row.name)}>
            <span data-testid={`kind-${String(row.name)}`}>{kindColumn?.render(row)}</span>
            <button
              type="button"
              data-testid={`namespace-${row.name}`}
              onClick={() => onRowPointerClick?.(row)}
            >
              {String(row.name)}
            </button>
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
  await act(async () => {
    const { default: ClusterViewNamespaces } = await import('./ClusterViewNamespaces');
    root.render(<ClusterViewNamespaces />);
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
  mocks.resourceGridParams = null;
  mocks.persistenceParams = null;
  mocks.namespaceLoading = false;
  mocks.namespaceRefreshing = false;
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

describe('ClusterViewNamespaces', () => {
  it('projects namespace health, workload, event, utilization, quota, and age columns', async () => {
    const { unmount } = await renderView();
    const tableProps = mocks.tableProps;
    if (!tableProps) {
      throw new Error('expected namespace table props');
    }

    const columns = tableProps.columns as Array<{
      key: string;
      header?: ReactNode;
      sortValue?: (row: Record<string, unknown>) => unknown;
      render?: (row: Record<string, unknown>) => ReactNode;
    }>;
    expect(columns.map(({ key }) => key)).toEqual([
      'kind',
      'name',
      'status',
      'workloads',
      'unhealthyWorkloads',
      'warningEvents',
      'cpu',
      'memory',
      'quotaPressure',
      'age',
    ]);
    expect(mocks.resourceGridParams).toMatchObject({ filterOptionOverrides: undefined });
    expect(mocks.persistenceParams).toMatchObject({
      pageSizeOptions: [25, 50, 100, 250, 500, 1000],
    });
    expect(tableProps.localPagination).toMatchObject({
      idPrefix: 'cluster-namespaces-cluster-a',
      pageSize: 50,
      pageSizeOptions: [25, 50, 100, 250, 500, 1000],
    });
    const localPagination = tableProps.localPagination as {
      onPageSizeChange: (value: number) => void;
    };
    localPagination.onPageSizeChange(100);
    expect(mocks.setPageSize).toHaveBeenCalledWith(100);
    expect(columns.find(({ key }) => key === 'unhealthyWorkloads')?.header).toBe('Attn');
    expect(columns.find(({ key }) => key === 'warningEvents')?.header).toBe('Warn');

    const rows = (tableProps.source as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows[0]).toMatchObject({
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Namespace',
      name: 'payments',
      ageTimestamp: 1_700_000_000_000,
    });
    const keyExtractor = (
      tableProps.gridTableProps as {
        keyExtractor: (row: Record<string, unknown>) => string;
      }
    ).keyExtractor;
    expect(keyExtractor(rows[0])).toBe('cluster-a|/v1/Namespace//payments');
    expect(columns.find(({ key }) => key === 'cpu')?.sortValue?.(rows[0])).toBe(450);
    expect(columns.find(({ key }) => key === 'memory')?.sortValue?.(rows[0])).toBe(
      256 * 1024 * 1024
    );
    const cpuCell = columns.find(({ key }) => key === 'cpu')?.render?.(rows[0]);
    expect(isValidElement<Record<string, unknown>>(cpuCell)).toBe(true);
    if (!isValidElement<Record<string, unknown>>(cpuCell)) {
      throw new Error('expected CPU ResourceBar');
    }
    expect(cpuCell.props).toMatchObject({
      usage: '450m',
      request: '300m',
      limit: '600m',
      type: 'cpu',
      variant: 'compact',
      animationScopeKey: 'cluster-a|/v1/Namespace//payments:cpu',
    });
    const memoryCell = columns.find(({ key }) => key === 'memory')?.render?.(rows[0]);
    expect(isValidElement<Record<string, unknown>>(memoryCell)).toBe(true);
    if (!isValidElement<Record<string, unknown>>(memoryCell)) {
      throw new Error('expected Memory ResourceBar');
    }
    expect(memoryCell.props).toMatchObject({
      usage: '256Mi',
      request: '512Mi',
      limit: '1.0Gi',
      type: 'memory',
      variant: 'compact',
      animationScopeKey: 'cluster-a|/v1/Namespace//payments:memory',
    });
    const workloadsColumn = columns.find(({ key }) => key === 'workloads');
    expect(renderedText(workloadsColumn?.render?.(rows[0]))).toBe('✓');
    expect(renderedText(workloadsColumn?.render?.({ ...rows[0], hasWorkloads: false }))).toBe('-');
    expect(renderedText(workloadsColumn?.render?.({ ...rows[0], workloadsUnknown: true }))).toBe(
      'Unknown'
    );
    const warningCell = columns.find(({ key }) => key === 'warningEvents')?.render?.(rows[0]);
    expect(isValidElement<{ className?: string }>(warningCell)).toBe(true);
    if (!isValidElement<{ className?: string }>(warningCell)) {
      throw new Error('expected warning events cell element');
    }
    expect(warningCell.props.className).toBe('status-text warning');

    const zeroSignalRow = {
      ...rows[0],
      unhealthyWorkloads: 0,
      warningEvents: 0,
      cpuUsageMilli: 0,
      cpuRequestsMilli: 0,
      cpuLimitsMilli: 0,
      memoryUsageBytes: 0,
      memoryRequestsBytes: 0,
      memoryLimitsBytes: 0,
    };
    expect(
      renderedText(columns.find(({ key }) => key === 'unhealthyWorkloads')?.render?.(zeroSignalRow))
    ).toBe('-');
    expect(
      renderedText(columns.find(({ key }) => key === 'warningEvents')?.render?.(zeroSignalRow))
    ).toBe('-');
    expect(renderedText(columns.find(({ key }) => key === 'cpu')?.render?.(zeroSignalRow))).toBe(
      '-'
    );
    expect(renderedText(columns.find(({ key }) => key === 'memory')?.render?.(zeroSignalRow))).toBe(
      '-'
    );
    expect(columns.find(({ key }) => key === 'cpu')?.sortValue?.(zeroSignalRow)).toBe(0);
    expect(columns.find(({ key }) => key === 'memory')?.sortValue?.(zeroSignalRow)).toBe(0);

    const reservationOnlyRow = {
      ...rows[0],
      cpuUsageMilli: 0,
      memoryUsageBytes: 0,
    };
    expect(
      isValidElement(columns.find(({ key }) => key === 'cpu')?.render?.(reservationOnlyRow))
    ).toBe(true);
    expect(
      isValidElement(columns.find(({ key }) => key === 'memory')?.render?.(reservationOnlyRow))
    ).toBe(true);

    await unmount();
  });

  it('selects and expands the namespace before opening its default view', async () => {
    const { container, unmount } = await renderView();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="namespace-payments"]')?.click();
    });

    expect(mocks.setSelectedNamespace).toHaveBeenCalledWith('payments', 'cluster-a');
    expect(mocks.onNamespaceSelect).toHaveBeenCalledWith('payments');
    expect(mocks.setSelectedNamespace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.onNamespaceSelect.mock.invocationCallOrder[0]
    );

    await unmount();
  });

  it('opens the namespace Object Panel from Kind without activating row navigation', async () => {
    const { container, unmount } = await renderView();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="kind-payments"] button')?.click();
    });

    expect(mocks.openWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Namespace',
        resource: 'namespaces',
        name: 'payments',
      })
    );
    expect(mocks.setSelectedNamespace).not.toHaveBeenCalled();
    expect(mocks.onNamespaceSelect).not.toHaveBeenCalled();

    await unmount();
  });

  it('keeps resident namespace rows quiet while their domain refreshes', async () => {
    mocks.namespaceRefreshing = true;
    const { unmount } = await renderView();

    if (!mocks.tableProps) {
      throw new Error('expected namespace table props');
    }
    expect((mocks.tableProps.source as { loading: boolean }).loading).toBe(false);

    await unmount();
  });

  it('keeps the loading state for the initial namespace request', async () => {
    mocks.namespaceLoading = true;
    const { unmount } = await renderView();

    if (!mocks.tableProps) {
      throw new Error('expected namespace table props');
    }
    expect((mocks.tableProps.source as { loading: boolean }).loading).toBe(true);

    await unmount();
  });
});
