import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import { act, type ComponentProps, isValidElement, type ReactNode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPermissionKey } from '@/core/capabilities';
import {
  deriveResourceInventoryRenderState,
  type ResourceInventorySourceState,
} from '@/modules/resource-grid/useResourceInventoryTable';
import { resolveEmptyStateMessage } from '@/utils/emptyState';

const mocks = vi.hoisted(() => ({
  onNamespaceSelect: vi.fn(),
  setSelectedNamespace: vi.fn(),
  setPageSize: vi.fn(),
  tableProps: null as null | Record<string, unknown>,
  resourceGridParams: null as null | Record<string, unknown>,
  persistenceParams: null as null | Record<string, unknown>,
  namespaceLoading: false,
  namespaceRefreshing: false,
  namespacesPermissionDenied: false,
  hasNamespaces: true,
  openWithObject: vi.fn(),
  permissionMap: new Map<string, { allowed: boolean; pending: boolean }>(),
  runObjectAction: vi.fn(),
  confirmation: null as null | ComponentProps<typeof ConfirmationModal>,
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
    namespaceSummaries: mocks.hasNamespaces ? namespacePayload.namespaces : [],
    namespaceMetricsState: namespacePayload.metricsState,
    namespaceError: null,
    namespaceLoading: mocks.namespaceLoading,
    namespaceRefreshing: mocks.namespaceRefreshing,
    namespacesPermissionDenied: mocks.namespacesPermissionDenied,
    setSelectedNamespace: mocks.setSelectedNamespace,
  }),
}));

vi.mock('@/core/cluster-workspace/useClusterWorkspace', () => ({
  useClusterNameResolver: () => (clusterId: string) =>
    ({ 'cluster-a': 'alpha', 'cluster-b': 'beta' })[clusterId] ?? clusterId,
}));

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => ({ onNamespaceSelect: mocks.onNamespaceSelect }),
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: mocks.openWithObject }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ available: false, navigateToView: vi.fn() }),
}));

vi.mock('@/core/capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/capabilities')>()),
  useUserPermissions: () => mocks.permissionMap,
}));

vi.mock('@core/backend-api', () => ({
  RunObjectAction: (...args: unknown[]) => mocks.runObjectAction(...args),
}));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  default: (props: ComponentProps<typeof ConfirmationModal>) => {
    mocks.confirmation = props;
    return null;
  },
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
    const onRowClick = props.onRowClick as ((row: Record<string, unknown>) => void) | undefined;
    const columns = props.columns as Array<{
      key: string;
      render: (row: Record<string, unknown>) => ReactNode;
    }>;
    const kindColumn = columns.find(({ key }) => key === 'kind');
    const nameColumn = columns.find(({ key }) => key === 'name');
    return (
      <div data-testid="namespace-table">
        {source.rows.map((row) => (
          <div key={String(row.name)}>
            <span data-testid={`kind-${String(row.name)}`}>{kindColumn?.render(row)}</span>
            <span data-testid={`name-${String(row.name)}`}>{nameColumn?.render(row)}</span>
            <button
              type="button"
              data-testid={`row-${String(row.name)}`}
              onClick={() => onRowPointerClick?.(row)}
            />
            <button
              type="button"
              data-testid={`row-enter-${String(row.name)}`}
              onClick={() => onRowClick?.(row)}
            />
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
  mocks.namespacesPermissionDenied = false;
  mocks.hasNamespaces = true;
  mocks.permissionMap = new Map();
  mocks.confirmation = null;
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
    expect(columns.find(({ key }) => key === 'unhealthyWorkloads')?.header).toBe('Unhealthy');
    expect(columns.find(({ key }) => key === 'warningEvents')?.header).toBe('Warnings');

    const rows = (tableProps.source as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows[0]).toMatchObject({
      ref: {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Namespace',
        resource: 'namespaces',
        name: 'payments',
      },
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
      usage: 450,
      request: 300,
      limit: 600,
      'data-gridtable-export-text': '450',
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
      usage: 256 * 1024 * 1024,
      request: 512 * 1024 * 1024,
      limit: 1024 * 1024 * 1024,
      'data-gridtable-export-text': '262144',
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
    const quotaCell = columns.find(({ key }) => key === 'quotaPressure')?.render?.(rows[0]);
    if (!isValidElement<{ className?: string }>(quotaCell)) {
      throw new Error('expected quota pressure cell element');
    }
    expect(renderedText(quotaCell)).toBe('92%');
    expect(quotaCell.props.className).toBe('status-text warning');

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

  it('opens the namespace Object Panel from its Kind badge and Name link', async () => {
    const { container, unmount } = await renderView();
    const namespaceRef = expect.objectContaining({
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Namespace',
      name: 'payments',
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="kind-payments"] button')?.click();
    });
    expect(mocks.openWithObject).toHaveBeenLastCalledWith(namespaceRef);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="name-payments"] button')?.click();
    });
    expect(mocks.openWithObject).toHaveBeenCalledTimes(2);
    expect(mocks.openWithObject).toHaveBeenLastCalledWith(namespaceRef);
    expect(mocks.setSelectedNamespace).not.toHaveBeenCalled();
    expect(mocks.onNamespaceSelect).not.toHaveBeenCalled();

    // Both links repeat the row's Enter action, so they leave the Tab order.
    const columns = mocks.tableProps?.columns as Array<{ key: string; rowAction?: boolean }>;
    expect(columns.find((column) => column.key === 'kind')?.rowAction).toBe(true);
    expect(columns.find((column) => column.key === 'name')?.rowAction).toBe(true);

    await unmount();
  });

  // Like every other resource table, a row click only highlights and Enter
  // opens the row's object.
  it('highlights on row click and opens the namespace Object Panel on Enter', async () => {
    const { container, unmount } = await renderView();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="row-payments"]')?.click();
    });
    expect(mocks.openWithObject).not.toHaveBeenCalled();
    expect(mocks.setSelectedNamespace).not.toHaveBeenCalled();
    expect(mocks.onNamespaceSelect).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="row-enter-payments"]')?.click();
    });
    expect(mocks.openWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Namespace',
        name: 'payments',
      })
    );
    expect(mocks.setSelectedNamespace).not.toHaveBeenCalled();
    expect(mocks.onNamespaceSelect).not.toHaveBeenCalled();

    await unmount();
  });

  it('opens nothing on Enter for a configured namespace that is missing or inaccessible', async () => {
    const { unmount } = await renderView();
    const tableProps = mocks.tableProps;
    const onRowClick = tableProps?.onRowClick as
      | ((row: Record<string, unknown>) => void)
      | undefined;
    if (!tableProps || !onRowClick) {
      throw new Error('expected a namespace row Enter handler');
    }
    const row = (tableProps.source as { rows: Array<Record<string, unknown>> }).rows[0];

    act(() => {
      onRowClick({ ...row, scopeStatus: 'no-access' });
    });
    expect(mocks.openWithObject).not.toHaveBeenCalled();
    expect(mocks.setSelectedNamespace).not.toHaveBeenCalled();

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

  // A stream reset after the denial clears the stored failure (no error, still
  // loading) but not the denial: the view must settle on the permission
  // message instead of loading forever.
  it('shows insufficient permissions for a denied scope whose stored failure was cleared', async () => {
    mocks.hasNamespaces = false;
    mocks.namespaceLoading = true;
    mocks.namespacesPermissionDenied = true;
    const { unmount } = await renderView();

    if (!mocks.tableProps) {
      throw new Error('expected namespace table props');
    }
    const render = deriveResourceInventoryRenderState(
      mocks.tableProps.source as ResourceInventorySourceState<unknown>
    );
    expect(render.showLoadingBoundary).toBe(false);
    expect(resolveEmptyStateMessage(render.error, 'Unable to load data')).toBe(
      'Insufficient permissions'
    );

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

  it('offers Open, Go to Namespace, Diff, and permitted Delete for the full namespace identity on right-click', async () => {
    mocks.permissionMap = new Map([
      [
        getPermissionKey('Namespace', 'delete', null, null, 'cluster-a', '', 'v1'),
        { allowed: true, pending: false },
      ],
    ]);
    mocks.runObjectAction.mockResolvedValue(undefined);
    const { unmount } = await renderView();
    const tableProps = mocks.tableProps;
    if (!tableProps) {
      throw new Error('expected namespace table props');
    }
    expect(tableProps.enableContextMenu).toBe(true);
    const getItems = tableProps.getCustomContextMenuItems as
      | ((row: Record<string, unknown>, columnKey: string) => ContextMenuItem[])
      | undefined;
    if (!getItems) {
      throw new Error('expected namespace context menu items');
    }
    const row = (tableProps.source as { rows: Array<Record<string, unknown>> }).rows[0];
    const items = getItems(row, 'name');
    expect(items.flatMap((item) => (item.actionId ? [item.actionId] : []))).toEqual([
      OBJECT_ACTION_IDS.viewDetails,
      OBJECT_ACTION_IDS.goToNamespace,
      OBJECT_ACTION_IDS.diff,
      OBJECT_ACTION_IDS.delete,
    ]);

    act(() => {
      items.find((item) => item.actionId === OBJECT_ACTION_IDS.viewDetails)?.onClick?.();
    });
    expect(mocks.openWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Namespace',
        name: 'payments',
      })
    );
    expect(mocks.setSelectedNamespace).not.toHaveBeenCalled();

    await act(async () => {
      items.find((item) => item.actionId === OBJECT_ACTION_IDS.delete)?.onClick?.();
    });
    expect(mocks.confirmation?.isOpen).toBe(true);
    await act(async () => {
      await mocks.confirmation?.onConfirm();
    });
    expect(mocks.runObjectAction).toHaveBeenCalledWith({
      action: 'delete',
      target: {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Namespace',
        namespace: '',
        name: 'payments',
      },
    });

    await unmount();
  });

  it('goes to the namespace from the context menu, selecting it before opening its default view', async () => {
    const { unmount } = await renderView();
    const tableProps = mocks.tableProps;
    const getItems = tableProps?.getCustomContextMenuItems as
      | ((row: Record<string, unknown>, columnKey: string) => ContextMenuItem[])
      | undefined;
    if (!tableProps || !getItems) {
      throw new Error('expected namespace context menu items');
    }
    const row = (tableProps.source as { rows: Array<Record<string, unknown>> }).rows[0];

    act(() => {
      getItems(row, 'name')
        .find((item) => item.actionId === OBJECT_ACTION_IDS.goToNamespace)
        ?.onClick?.();
    });

    expect(mocks.setSelectedNamespace).toHaveBeenCalledWith('payments', 'cluster-a');
    expect(mocks.onNamespaceSelect).toHaveBeenCalledWith('payments');
    expect(mocks.setSelectedNamespace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.onNamespaceSelect.mock.invocationCallOrder[0]
    );
    expect(mocks.openWithObject).not.toHaveBeenCalled();

    await unmount();
  });

  it('offers no object actions for a configured namespace that is missing or inaccessible', async () => {
    mocks.permissionMap = new Map([
      [
        getPermissionKey('Namespace', 'delete', null, null, 'cluster-a', '', 'v1'),
        { allowed: true, pending: false },
      ],
    ]);
    const { unmount } = await renderView();
    const tableProps = mocks.tableProps;
    const getItems = tableProps?.getCustomContextMenuItems as
      | ((row: Record<string, unknown>, columnKey: string) => ContextMenuItem[])
      | undefined;
    if (!tableProps || !getItems) {
      throw new Error('expected namespace context menu items');
    }
    const row = (tableProps.source as { rows: Array<Record<string, unknown>> }).rows[0];

    expect(getItems({ ...row, scopeStatus: 'no-access' }, 'name')).toEqual([]);
    expect(getItems({ ...row, scopeStatus: 'not-found' }, 'name')).toEqual([]);

    await unmount();
  });
});
