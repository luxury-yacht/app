import { act, isValidElement, type ReactNode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onNamespaceSelect: vi.fn(),
  setSelectedNamespace: vi.fn(),
  tableProps: null as null | Record<string, unknown>,
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
      memoryUsageBytes: 256 * 1024 * 1024,
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
    namespaceLoading: false,
    namespaceRefreshing: false,
    namespacesPermissionDenied: false,
    setSelectedNamespace: mocks.setSelectedNamespace,
  }),
}));

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => ({ onNamespaceSelect: mocks.onNamespaceSelect }),
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
    const onRowPointerClick = props.onRowPointerClick as
      | ((row: Record<string, unknown>) => void)
      | undefined;
    return (
      <div data-testid="namespace-table">
        {source.rows.map((row) => (
          <button
            key={String(row.name)}
            type="button"
            data-testid={`namespace-${row.name}`}
            onClick={() => onRowPointerClick?.(row)}
          >
            {String(row.name)}
          </button>
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
    expect(columns.find(({ key }) => key === 'unhealthyWorkloads')?.header).toBe('Attn');
    expect(columns.find(({ key }) => key === 'warningEvents')?.header).toBe('Warnings');

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
      memoryUsageBytes: 0,
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
});
