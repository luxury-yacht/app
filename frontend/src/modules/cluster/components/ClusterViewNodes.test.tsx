/**
 * frontend/src/modules/cluster/components/ClusterViewNodes.test.tsx
 *
 * Test suite for ClusterViewNodes.
 * Covers key behaviors and edge cases for ClusterViewNodes.
 */

import ClusterViewNodes from '@modules/cluster/components/ClusterViewNodes';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import { getTextContent } from '@shared/components/tables/GridTable.utils';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterNodeRow } from '@/core/refresh/types';
import type { SortConfig, UseTableSortOptions } from '@/hooks/useTableSort';
import { makeResourceRef } from '@/test-utils/makeResourceRef';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';

type CapturedGridTableProps = GridTableProps<ClusterNodeRow> & {
  getCustomContextMenuItems: NonNullable<
    GridTableProps<ClusterNodeRow>['getCustomContextMenuItems']
  >;
};
type LoadingBoundaryProps = React.ComponentProps<typeof ResourceLoadingBoundary>;

const {
  latestTableRowsRef,
  typedQueryRowsRef,
  scopedDomainStateRef,
  requestRefreshDomainStateMock,
  useTableSortMock,
} = vi.hoisted(() => {
  const latestRows: { current: ClusterNodeRow[] } = { current: [] };
  const typedQueryRows: { current: ClusterNodeRow[] } = { current: [] };
  const scopedDomainState: { current: Record<string, unknown> } = {
    current: {
      data: { metrics: null, rows: [] },
      status: 'idle',
      isManual: false,
    },
  };

  return {
    latestTableRowsRef: latestRows,
    typedQueryRowsRef: typedQueryRows,
    scopedDomainStateRef: scopedDomainState,
    requestRefreshDomainStateMock: vi.fn((_request?: unknown) =>
      Promise.resolve({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: typedQueryRows.current,
            total: typedQueryRows.current.length,
            totalIsExact: true,
            kinds: ['Node'],
            facetsExact: true,
          },
        },
      })
    ),
    useTableSortMock: vi.fn(
      (
        data: ClusterNodeRow[],
        _defaultKey?: string,
        _defaultDir?: SortConfig['direction'],
        opts?: UseTableSortOptions<ClusterNodeRow>
      ) => {
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

const podsPanePropsRef = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const favToggleStatesRef = vi.hoisted(() => ({ current: [] as Array<Record<string, unknown>> }));

vi.mock('@modules/namespace/components/NsViewPods', () => ({
  PodsTable: (props: Record<string, unknown>) => {
    podsPanePropsRef.current = props;
    return <div data-testid="pods-pane" />;
  },
}));

vi.mock('@ui/favorites/FavToggle', () => ({
  // Matches the real hook's shape: { item, modal }.
  useFavToggle: (state: Record<string, unknown>) => {
    favToggleStatesRef.current.push(state);
    return {
      item: {
        type: 'toggle',
        id: 'favorite',
        icon: null,
        active: false,
        onClick: () => undefined,
        title: 'Save as favorite',
      },
      modal: null,
    };
  },
}));

const gridTablePropsRef: { current: CapturedGridTableProps } = {
  current: null as unknown as CapturedGridTableProps,
};
const loadingBoundaryPropsRef: { current: LoadingBoundaryProps } = {
  current: null as unknown as LoadingBoundaryProps,
};
const openWithObjectMock = vi.fn();
const scopedDomainCallsRef: { current: Array<[string, string]> } = { current: [] };

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: CapturedGridTableProps) => {
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
    selectedClusterName: 'alpha',
    selectedClusterIds: ['path:context', 'other:context'],
  }),
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: (props: LoadingBoundaryProps) => {
    loadingBoundaryPropsRef.current = props;
    return <>{props.children}</>;
  },
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (
    data: ClusterNodeRow[],
    defaultKey?: string,
    defaultDirection?: SortConfig['direction'],
    options?: UseTableSortOptions<ClusterNodeRow>
  ) => useTableSortMock(data, defaultKey, defaultDirection, options),
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
      includeMetadata: false,
    },
    setFilters: vi.fn(),
    pageSize: null,
    setPageSize: vi.fn(),
    hydrated: true,
    resetState: vi.fn(),
  }),
}));

vi.mock('@/core/refresh', () => ({
  useRefreshScopedDomain: (domain: string, scope: string) => {
    scopedDomainCallsRef.current.push([domain, scope]);
    return scopedDomainStateRef.current;
  },
  refreshManager: { triggerManualRefresh: vi.fn() },
  refreshOrchestrator: {
    setScopedDomainEnabled: vi.fn(),
    acquireScopedDomainLease: vi.fn(),
    releaseScopedDomainLease: vi.fn(),
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

const baseNode: ClusterNodeRow = {
  ref: {
    ...makeResourceRef({ kind: 'Node', resource: 'nodes', name: 'node-1' }),
    name: 'node-1',
    kind: 'Node',
    clusterId: 'alpha:ctx',
  },

  status: 'Ready',
  roles: 'worker',
  version: 'v1.28.0',
  internalIP: '10.0.0.1',
  externalIP: '',
  cpuCapacityMilli: 4000,
  cpuAllocatableMilli: 4000,
  cpuRequestsMilli: 1000,
  cpuLimitsMilli: 2000,
  cpuUsageMilli: 1000,
  memoryCapacityBytes: 8 * 1024 ** 3,
  memoryAllocatableBytes: 8 * 1024 ** 3,
  memoryRequestsBytes: 1024 ** 3,
  memoryLimitsBytes: 2 * 1024 ** 3,
  memoryUsageBytes: 2 * 1024 ** 3,
  pods: '3',
  podsAllocatable: '50',
  podsCapacity: '50',
  taints: [],
  labels: {},
  restarts: 0,

  unschedulable: false,

  age: '2h',
  ageTimestamp: 1_700_000_000_000,
};

describe('ClusterViewNodes', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null as unknown as CapturedGridTableProps;
    loadingBoundaryPropsRef.current = null as unknown as LoadingBoundaryProps;
    scopedDomainCallsRef.current = [];
    latestTableRowsRef.current = [];
    typedQueryRowsRef.current = [];
    scopedDomainStateRef.current = {
      data: { metrics: null, rows: [] },
      status: 'idle',
      isManual: false,
    };
    openWithObjectMock.mockReset();
    podsPanePropsRef.current = null;
    favToggleStatesRef.current = [];
    requestRefreshDomainStateMock.mockReset();
    requestRefreshDomainStateMock.mockImplementation(() =>
      Promise.resolve({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: typedQueryRowsRef.current,
            total: typedQueryRowsRef.current.length,
            totalIsExact: true,
            kinds: ['Node'],
            facetsExact: true,
          },
        },
      })
    );
    useTableSortMock.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderNodes = async (nodes: ClusterNodeRow[]) => {
    typedQueryRowsRef.current = nodes;
    await act(async () => {
      root.render(<ClusterViewNodes />);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const refreshStateCallsForDomain = (domain: string) =>
    requestRefreshDomainStateMock.mock.calls.filter(
      ([request]) => (request as { domain?: string } | undefined)?.domain === domain
    );

  const rowDetail = () =>
    requireValue(gridTablePropsRef.current.rowDetail, 'expected the Nodes row detail');
  const attachedPods = (node: ClusterNodeRow) =>
    requireReactElement<Record<string, unknown>>(
      rowDetail().render(node),
      'expected the attached Pods table'
    ).props;
  // Renders the Pods cell on its own to read or click its toggle.
  const withPodsCount = <R,>(node: ClusterNodeRow, use: (button: HTMLButtonElement) => R): R => {
    const column = requireValue(
      gridTablePropsRef.current.columns.find((candidate) => candidate.key === 'pods'),
      'expected the Pods column'
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    const cellRoot = ReactDOM.createRoot(host);
    act(() => cellRoot.render(<>{column.render(node)}</>));
    try {
      return use(requireValue(host.querySelector('button'), 'expected the Pods count toggle'));
    } finally {
      act(() => cellRoot.unmount());
      host.remove();
    }
  };

  it('shows only the Nodes table until a node opens its pods', async () => {
    await renderNodes([baseNode]);

    expect(rowDetail().openRowKey).toBeNull();
    expect(podsPanePropsRef.current).toBeNull();
  });

  it("opens a node's pods under its row from the Pods count without opening the node", async () => {
    await renderNodes([baseNode]);
    const rowKey = gridTablePropsRef.current.keyExtractor(baseNode, 0);
    expect(withPodsCount(baseNode, (button) => button.getAttribute('aria-expanded'))).toBe('false');

    withPodsCount(baseNode, (button) => act(() => button.click()));

    expect(openWithObjectMock).not.toHaveBeenCalled();
    expect(rowDetail().openRowKey).toBe(rowKey);
    expect(gridTablePropsRef.current.isRowSelected?.(baseNode, 0)).toBe(true);
    expect(rowDetail().getLabel(baseNode)).toBe('Pods for node-1');
    expect(attachedPods(baseNode)).toMatchObject({
      namespace: ALL_NAMESPACES_SCOPE,
      clusterId: 'path:context',
      viewId: 'cluster-node-pods',
      showNamespaceColumn: true,
      namespaceLinkView: 'pods',
      attachedTo: expect.objectContaining({
        clusterId: 'alpha:ctx',
        group: '',
        version: 'v1',
        kind: 'Node',
        name: 'node-1',
      }),
    });

    // Enter on the focused row still opens the node.
    act(() => gridTablePropsRef.current.onRowClick?.(baseNode));
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'Node', name: 'node-1' })
    );

    withPodsCount(baseNode, (button) => act(() => button.click()));
    expect(rowDetail().openRowKey).toBeNull();

    // The attached table's own Close closes it too; the node stays highlighted.
    withPodsCount(baseNode, (button) => act(() => button.click()));
    const close = requireValue(
      attachedPods(baseNode).onClose as (() => void) | undefined,
      'expected the attached table Close'
    );
    act(() => close());
    expect(rowDetail().openRowKey).toBeNull();
    expect(gridTablePropsRef.current.isRowSelected?.(baseNode, 0)).toBe(true);
  });

  it('highlights a node on a row click, opens its pods with Space, and clears the highlight on an unused-body click', async () => {
    await renderNodes([baseNode]);
    const rowKey = gridTablePropsRef.current.keyExtractor(baseNode, 0);

    act(() => gridTablePropsRef.current.onRowPointerClick?.(baseNode));
    expect(gridTablePropsRef.current.isRowSelected?.(baseNode, 0)).toBe(true);
    expect(rowDetail().openRowKey).toBeNull();

    act(() => gridTablePropsRef.current.onRowSelectionToggle?.(baseNode));
    expect(rowDetail().openRowKey).toBe(rowKey);

    act(() => requireValue(gridTablePropsRef.current.onRowSelectionClear, 'clear')());
    expect(gridTablePropsRef.current.isRowSelected?.(baseNode, 0)).toBe(false);
  });

  it('opens nothing for a node the settled table does not show', async () => {
    await renderNodes([baseNode]);
    const gone = { ...baseNode, ref: { ...baseNode.ref, name: 'gone' } };

    act(() => gridTablePropsRef.current.onRowSelectionToggle?.(gone));

    expect(rowDetail().openRowKey).toBeNull();
    expect(gridTablePropsRef.current.isRowSelected?.(gone, 0)).toBe(false);
  });

  it('wires the Include metadata search toggle for the query-backed nodes table', async () => {
    await renderNodes([baseNode]);

    const preActions = gridTablePropsRef.current?.filters?.options?.preActions ?? [];
    expect(preActions.some((item) => 'id' in item && item.id === 'include-metadata')).toBe(true);
  });

  it('omits the advertised Node Status query facet', async () => {
    const response = {
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [baseNode],
          total: 1,
          totalIsExact: true,
          kinds: ['Node'],
          facetValues: [
            {
              key: 'statuses',
              options: [
                { value: 'NotReady', label: 'NotReady' },
                { value: 'Ready', label: 'Ready' },
              ],
              exact: true,
            },
          ],
          facetsExact: true,
          capabilities: {
            queryFacets: [
              {
                key: 'statuses',
                label: 'Status',
                placeholder: 'All statuses',
                searchable: false,
                bulkActions: true,
              },
            ],
          },
        },
      },
    };
    requestRefreshDomainStateMock.mockResolvedValue(response);

    await act(async () => {
      root.render(<ClusterViewNodes />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.filters?.options?.queryFacets).toBeUndefined();
  });

  it('places the favorite with the filter pre-actions (left), not the export cluster', async () => {
    await renderNodes([baseNode]);

    const options = gridTablePropsRef.current?.filters?.options;
    const preActions = options?.preActions ?? [];
    expect(preActions.some((item) => 'id' in item && item.id === 'favorite')).toBe(true);
  });

  it('threads fetchAllRows so the table can offer the all-matching-rows scope', async () => {
    await renderNodes([baseNode]);

    expect(typeof gridTablePropsRef.current?.fetchAllRows).toBe('function');
  });

  it('keeps initial empty query-backed nodes behind the loading boundary', async () => {
    requestRefreshDomainStateMock.mockImplementation(() => new Promise(() => undefined));

    await act(async () => {
      root.render(<ClusterViewNodes />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadingBoundaryPropsRef.current).toEqual(
      expect.objectContaining({
        loading: true,
        hasLoaded: false,
        dataLength: 0,
        spinnerMessage: 'Loading nodes...',
      })
    );
  });

  it('leads with the identity columns followed by Status', async () => {
    await renderNodes([baseNode]);

    expect(gridTablePropsRef.current.columns.map((column) => column.key)).toEqual([
      'kind',
      'name',
      'status',
      'version',
      'pods',
      'restarts',
      'cpu',
      'memory',
      'age',
    ]);
  });

  it('keeps node metric animation history separate for equal names in different clusters', async () => {
    await renderNodes([baseNode]);
    for (const key of ['cpu', 'memory']) {
      const column = requireValue(
        gridTablePropsRef.current.columns.find((item) => item.key === key),
        'expected metric column'
      );
      const first = requireReactElement<{ animationScopeKey: string }>(
        column.render(baseNode),
        'expected node metric'
      );
      const second = requireReactElement<{ animationScopeKey: string }>(
        column.render({ ...baseNode, ref: { ...baseNode.ref, clusterId: 'other:context' } }),
        'expected other node metric'
      );
      expect(first.props.animationScopeKey).not.toBe(second.props.animationScopeKey);
    }
  });

  it('passes numeric Pods, CPU, memory, and age sort values into useTableSort', async () => {
    await renderNodes([baseNode]);

    expect(useTableSortMock).toHaveBeenCalled();
    const options = requireValue(
      useTableSortMock.mock.calls[0]?.[3],
      'expected node table sort options'
    );
    const columns = options.columns as Array<{
      key: string;
      sortValue?: (item: typeof baseNode) => unknown;
    }>;
    const podsColumn = columns.find((column) => column.key === 'pods');
    const cpuColumn = columns.find((column) => column.key === 'cpu');
    const memoryColumn = columns.find((column) => column.key === 'memory');
    const ageColumn = columns.find((column) => column.key === 'age');

    expect(podsColumn?.sortValue?.({ ...baseNode, pods: '3', podsAllocatable: '50' })).toBe(3);
    expect(cpuColumn?.sortValue?.(baseNode)).toBe(1000);
    expect(memoryColumn?.sortValue?.(baseNode)).toBe(2 * 1024 ** 3);
    expect(
      Number(ageColumn?.sortValue?.({ ...baseNode, ageTimestamp: 1_700_000_000_000 }))
    ).toBeGreaterThan(
      Number(ageColumn?.sortValue?.({ ...baseNode, ageTimestamp: 1_700_003_600_000 }))
    );
  });

  it('renders zero node restarts as no value without changing numeric sorting', async () => {
    await renderNodes([baseNode]);

    const column = requireValue(
      gridTablePropsRef.current.columns.find(({ key }) => key === 'restarts'),
      'expected node restarts column'
    );
    expect(getTextContent(column.render(baseNode))).toBe('-');
    expect(getTextContent(column.render({ ...baseNode, restarts: 4 }))).toBe('4');
    expect(column.sortValue?.(baseNode)).toBe(0);
    expect(column.sortValue?.({ ...baseNode, restarts: 4 })).toBe(4);
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
    const statusColumn = requireValue(
      props.columns.find((column) => column.key === 'status'),
      'expected the node status column'
    );
    const statusCell = requireReactElement<{ children: React.ReactNode[] }>(
      statusColumn.render(props.data[0]),
      'expected the node status cell element'
    );
    const badge = requireReactElement<{ children?: React.ReactNode; className?: string }>(
      statusCell.props.children[0],
      'expected the node status badge element'
    );

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
    const statusColumn = requireValue(
      props.columns.find((column) => column.key === 'status'),
      'expected the node status column'
    );
    const statusCell = requireReactElement<{ children: React.ReactNode[] }>(
      statusColumn.render(props.data[0]),
      'expected the node status cell element'
    );
    const badge = requireReactElement<{ children?: React.ReactNode; className?: string }>(
      statusCell.props.children[0],
      'expected the node status badge element'
    );

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
    const statusColumn = requireValue(
      props.columns.find((column) => column.key === 'status'),
      'expected the node status column'
    );
    const statusCell = requireReactElement<{ children: React.ReactNode[] }>(
      statusColumn.render(props.data[0]),
      'expected the node status cell element'
    );
    const badge = requireReactElement<{ children?: React.ReactNode; className?: string }>(
      statusCell.props.children[0],
      'expected the node status badge element'
    );

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
    const statusColumn = requireValue(
      props.columns.find((column) => column.key === 'status'),
      'expected the node status column'
    );
    const statusCell = requireReactElement<{ children: React.ReactNode[] }>(
      statusColumn.render(props.data[0]),
      'expected the node status cell element'
    );
    const badge = requireReactElement<{ children?: React.ReactNode; className?: string }>(
      statusCell.props.children[0],
      'expected the node status badge element'
    );

    expect(badge.props.children).toBe('Ready');
    expect(badge.props.className).toBe('status-text unknown');
  });

  it('opens the object panel with cluster metadata when clicking a node name', async () => {
    await renderNodes([baseNode]);

    const props = gridTablePropsRef.current;
    const nameColumn = requireValue(
      props.columns.find((column) => column.key === 'name'),
      'expected the node name column'
    );
    const cell = requireReactElement<{
      onClick?: (event: { stopPropagation: () => void }) => void;
    }>(nameColumn.render(props.data[0]), 'expected the node name cell element');

    // Trigger the column click handler to exercise object navigation.
    act(() => {
      cell.props.onClick?.({ stopPropagation: () => undefined });
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
      .find((item) => item.actionId === OBJECT_ACTION_IDS.viewMap);
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

    // Metrics ride the nodes domain now — there is no separate metric domain
    // lease, and the scope must stay pinned to the active cluster.
    expect(scopedDomainCallsRef.current).toContainEqual(['nodes', 'path:context|']);
    expect(scopedDomainCallsRef.current).not.toContainEqual([
      'nodes',
      'clusters=path:context,other:context|',
    ]);
    expect(scopedDomainCallsRef.current.every(([domain]) => domain === 'nodes')).toBe(true);
  });

  it('loads fresh query rows on revisit after the live nodes domain advances', async () => {
    const initialQueryNode = { ...baseNode, name: 'query-node-1' };
    const updatedQueryNode = { ...baseNode, name: 'query-node-2' };
    typedQueryRowsRef.current = [initialQueryNode];

    await act(async () => {
      root.render(<ClusterViewNodes />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refreshStateCallsForDomain('nodes')).toHaveLength(1);
    expect(latestTableRowsRef.current).toEqual([initialQueryNode]);

    typedQueryRowsRef.current = [updatedQueryNode];
    // The live nodes domain advances (new data → new version/checksum) and the view is
    // revisited. That a version bump — not a timestamp tick — is what re-invalidates the
    // typed query is asserted at the wrapper level (useQueryBackedResourceGridTable.test
    // "passes cluster scoped live refresh revisions"); here we assert the revisited view
    // issues a fresh query and renders the updated rows.
    scopedDomainStateRef.current = {
      data: { metrics: null, rows: [updatedQueryNode] },
      status: 'ready',
      isManual: false,
      version: 2,
      checksum: 'updated',
      lastUpdated: 2,
    };

    act(() => {
      root.unmount();
    });
    root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(<ClusterViewNodes />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refreshStateCallsForDomain('nodes')).toHaveLength(2);
    expect(latestTableRowsRef.current).toEqual([updatedQueryNode]);
  });

  it('renders a settled-empty query on remount without retaining stale local rows', async () => {
    // The retain-on-empty symptom patch is gone. The resource-inventory
    // controller trusts a settled query: a definitive empty result renders the
    // empty state rather than resurrecting stale local rows. The transient
    // empty-while-loading protection (the actual false-empty guard) lives in the
    // controller's refreshing→loading rule, covered by the controller unit tests.
    const localNode = { ...baseNode, clusterId: 'path:context' };
    const initialQueryNode = { ...localNode, name: 'node-1' };

    const baseResponses = [[initialQueryNode], []];
    let baseResponseIndex = 0;
    requestRefreshDomainStateMock.mockImplementation((request?: unknown) => {
      const domain = (request as { domain?: string } | undefined)?.domain;
      const rows =
        domain === 'nodes'
          ? (baseResponses[Math.min(baseResponseIndex++, baseResponses.length - 1)] ?? [])
          : [];
      return Promise.resolve({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows,
            total: rows.length,
            totalIsExact: true,
            kinds: rows.length > 0 ? ['Node'] : [],
            facetsExact: true,
          },
        },
      });
    });

    await act(async () => {
      root.render(<ClusterViewNodes />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latestTableRowsRef.current).toEqual([initialQueryNode]);

    act(() => {
      root.unmount();
    });
    root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(<ClusterViewNodes />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refreshStateCallsForDomain('nodes')).toHaveLength(2);
    expect(latestTableRowsRef.current).toEqual([]);
    expect(loadingBoundaryPropsRef.current).toEqual(
      expect.objectContaining({
        loading: false,
        hasLoaded: true,
        dataLength: 0,
      })
    );
  });
});
