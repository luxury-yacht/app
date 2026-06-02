/**
 * frontend/src/modules/cluster/components/ClusterViewNodes.test.tsx
 *
 * Test suite for ClusterViewNodes.
 * Covers key behaviors and edge cases for ClusterViewNodes.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterViewNodes from '@modules/cluster/components/ClusterViewNodes';
import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';

const { latestTableRowsRef, typedQueryRowsRef, requestRefreshDomainStateMock, useTableSortMock } =
  vi.hoisted(() => {
    const latestRows: { current: unknown[] } = { current: [] };
    const typedQueryRows: { current: unknown[] } = { current: [] };

    return {
      latestTableRowsRef: latestRows,
      typedQueryRowsRef: typedQueryRows,
      requestRefreshDomainStateMock: vi.fn((_request?: unknown) =>
        Promise.resolve({
          status: 'executed',
          data: {
            status: 'ready',
            data: {
              nodes: typedQueryRows.current,
              total: typedQueryRows.current.length,
              totalIsExact: true,
              kinds: ['Node'],
              facetsExact: true,
            },
          },
        })
      ),
      useTableSortMock: vi.fn(
        (data: unknown[], _defaultKey?: string, _defaultDir?: any, opts?: any) => {
          latestRows.current = data;
          return {
            sortedData: data,
            sortConfig: opts?.controlledSort ?? { key: '', direction: null },
            handleSort: vi.fn(),
          };
        }
      ),
    };
  });

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
    onClick: () => {},
    title: 'Save as favorite',
  }),
}));

const gridTablePropsRef: { current: any } = { current: null };
const openWithObjectMock = vi.fn();
const scopedDomainCallsRef: { current: Array<[string, string]> } = { current: [] };

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: any) => {
      gridTablePropsRef.current = props;
      return <div data-testid="grid-table" />;
    },
  };
});

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedKubeconfig: 'path:context',
    selectedClusterId: 'path:context',
    selectedClusterIds: ['path:context', 'other:context'],
  }),
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (...args: any[]) => (useTableSortMock as any)(...args),
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    sortConfig: { key: 'name', direction: 'asc' },
    setSortConfig: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
    setFilters: vi.fn(),
    resetState: vi.fn(),
  }),
}));

vi.mock('@/core/refresh', () => ({
  useRefreshScopedDomain: (domain: string, scope: string) => {
    scopedDomainCallsRef.current.push([domain, scope]);
    return {
      data: { metrics: null, nodes: [] },
      status: 'idle',
      isManual: false,
    };
  },
  refreshManager: { triggerManualRefresh: vi.fn() },
  refreshOrchestrator: {
    setScopedDomainEnabled: vi.fn(),
    resetScopedDomain: vi.fn(),
    fetchScopedDomain: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/core/data-access', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requestRefreshDomain: vi.fn().mockResolvedValue(undefined),
    requestRefreshDomainState: (request: unknown) => requestRefreshDomainStateMock(request),
  };
});

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

const baseNode = {
  name: 'node-1',
  status: 'Ready',
  roles: 'worker',
  version: 'v1.28.0',
  internalIP: '10.0.0.1',
  externalIP: '',
  cpuCapacity: '4',
  cpuAllocatable: '4',
  cpuUsage: '1',
  memoryCapacity: '8Gi',
  memoryAllocatable: '8Gi',
  memoryUsage: '2Gi',
  pods: 3,
  podsAllocatable: 50,
  podsCapacity: 50,
  taints: [],
  labels: {},
  restarts: 0,
  clusterId: 'alpha:ctx',
  clusterName: 'alpha',
};

describe('ClusterViewNodes', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null;
    scopedDomainCallsRef.current = [];
    latestTableRowsRef.current = [];
    typedQueryRowsRef.current = [];
    openWithObjectMock.mockReset();
    requestRefreshDomainStateMock.mockClear();
    useTableSortMock.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderNodes = async (nodes: Array<typeof baseNode | Record<string, unknown>>) => {
    typedQueryRowsRef.current = nodes;
    await act(async () => {
      root.render(<ClusterViewNodes data={nodes as any} loaded={true} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('passes persisted state to GridTable', async () => {
    await renderNodes([baseNode]);

    const props = gridTablePropsRef.current;
    expect(props).toBeTruthy();
    expect(props.sortConfig).toEqual({ key: 'name', direction: 'asc' });
    expect(props.filters?.value).toEqual({
      search: '',
      kinds: [],
      namespaces: [],
      caseSensitive: false,
    });
    expect(props.columnVisibility).toBe(null);
    expect(props.columnWidths).toBe(null);
  });

  it('passes numeric CPU and memory sort values into useTableSort', async () => {
    await renderNodes([baseNode]);

    expect(useTableSortMock).toHaveBeenCalled();
    const options = useTableSortMock.mock.calls[0]?.[3];
    const columns = options.columns as Array<{
      key: string;
      sortValue?: (item: typeof baseNode) => unknown;
    }>;
    const cpuColumn = columns.find((column) => column.key === 'cpu');
    const memoryColumn = columns.find((column) => column.key === 'memory');

    expect(cpuColumn?.sortValue?.(baseNode)).toBe(1000);
    expect(memoryColumn?.sortValue?.(baseNode)).toBe(2048);
  });

  it('renders the backend node status without reinterpreting cordon state', async () => {
    const node = {
      ...baseNode,
      status: 'Ready',
      statusState: 'True',
      statusPresentation: 'ready',
      unschedulable: true,
      taints: [{ key: 'node.kubernetes.io/unschedulable', effect: 'NoSchedule' }],
    };

    await renderNodes([node]);

    const props = gridTablePropsRef.current;
    const statusColumn = props.columns.find((column: any) => column.key === 'status');
    const statusCell = statusColumn.render(props.data[0]);
    const badge = statusCell.props.children[0];

    expect(badge.props.children).toBe('Ready');
    expect(badge.props.className).toBe('status-text ready');
  });

  it('uses backend statusPresentation for node status styling', async () => {
    const node = {
      ...baseNode,
      status: 'Ready (Cordoned)',
      statusState: 'True',
      statusPresentation: 'cordoned',
      unschedulable: true,
    };

    await renderNodes([node]);

    const props = gridTablePropsRef.current;
    const statusColumn = props.columns.find((column: any) => column.key === 'status');
    const statusCell = statusColumn.render(props.data[0]);
    const badge = statusCell.props.children[0];

    expect(badge.props.children).toBe('Ready (Cordoned)');
    expect(badge.props.className).toBe('status-text cordoned');
  });

  it('styles terminating from backend presentation without changing raw ready state', async () => {
    const node = {
      ...baseNode,
      status: 'Terminating',
      statusState: 'True',
      statusPresentation: 'terminating',
    };

    await renderNodes([node]);

    const props = gridTablePropsRef.current;
    const statusColumn = props.columns.find((column: any) => column.key === 'status');
    const statusCell = statusColumn.render(props.data[0]);
    const badge = statusCell.props.children[0];

    expect(badge.props.children).toBe('Terminating');
    expect(badge.props.className).toBe('status-text terminating');
  });

  it('does not use statusState as a node status class fallback', async () => {
    const node = {
      ...baseNode,
      status: 'Ready',
      statusState: 'True',
      statusPresentation: undefined,
    };

    await renderNodes([node]);

    const props = gridTablePropsRef.current;
    const statusColumn = props.columns.find((column: any) => column.key === 'status');
    const statusCell = statusColumn.render(props.data[0]);
    const badge = statusCell.props.children[0];

    expect(badge.props.children).toBe('Ready');
    expect(badge.props.className).toBe('status-text unknown');
  });

  it('opens the object panel with cluster metadata when clicking a node name', async () => {
    await renderNodes([baseNode]);

    const props = gridTablePropsRef.current;
    const nameColumn = props.columns.find((column: any) => column.key === 'name');
    const cell = nameColumn.render(props.data[0]);

    // Trigger the column click handler to exercise object navigation.
    act(() => {
      cell.props.onClick?.({ stopPropagation: () => {} });
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Node',
        name: 'node-1',
        clusterId: 'alpha:ctx',
        clusterName: 'alpha',
      })
    );
  });

  it('opens the Map from the node context menu', async () => {
    await renderNodes([baseNode]);

    const props = gridTablePropsRef.current;
    const objectMapItem = props
      .getCustomContextMenuItems(baseNode, 'name')
      .find((item: any) => item.actionId === OBJECT_ACTION_IDS.viewMap);
    expect(objectMapItem).toBeTruthy();

    act(() => {
      objectMapItem?.onClick?.();
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Node',
        name: 'node-1',
        clusterId: 'alpha:ctx',
        clusterName: 'alpha',
        group: '',
        version: 'v1',
      }),
      { initialTab: 'map' }
    );
  });

  it('resolves node metrics from the active cluster scope only', async () => {
    await renderNodes([baseNode]);

    expect(scopedDomainCallsRef.current).toContainEqual(['nodes', 'path:context|']);
    expect(scopedDomainCallsRef.current).not.toContainEqual([
      'nodes',
      'clusters=path:context,other:context|',
    ]);
  });
});
