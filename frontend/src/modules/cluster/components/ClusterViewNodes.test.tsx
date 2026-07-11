/**
 * frontend/src/modules/cluster/components/ClusterViewNodes.test.tsx
 *
 * Test suite for ClusterViewNodes.
 * Covers key behaviors and edge cases for ClusterViewNodes.
 */

import ClusterViewNodes from '@modules/cluster/components/ClusterViewNodes';
import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type ResourceLoadingBoundary from '@shared/components/ResourceLoadingBoundary';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterNodeRow } from '@/core/refresh/types';
import type { SortConfig, UseTableSortOptions } from '@/hooks/useTableSort';
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

vi.mock('@ui/favorites/FavToggle', () => ({
  // Matches the real hook's shape: { item, modal }.
  useFavToggle: () => ({
    item: {
      type: 'toggle',
      id: 'favorite',
      icon: null,
      active: false,
      onClick: () => undefined,
      title: 'Save as favorite',
    },
    modal: null,
  }),
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
      caseSensitive: false,
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
  name: 'node-1',
  status: 'Ready',
  roles: 'worker',
  version: 'v1.28.0',
  internalIP: '10.0.0.1',
  externalIP: '',
  cpuCapacity: '4',
  cpuAllocatable: '4',
  cpuRequests: '1',
  cpuLimits: '2',
  cpuUsage: '1',
  memoryCapacity: '8Gi',
  memoryAllocatable: '8Gi',
  memRequests: '1Gi',
  memLimits: '2Gi',
  memoryUsage: '2Gi',
  pods: '3',
  podsAllocatable: '50',
  podsCapacity: '50',
  taints: [],
  labels: {},
  restarts: 0,
  kind: 'Node',
  cpu: '1',
  memory: '2Gi',
  unschedulable: false,
  clusterId: 'alpha:ctx',
  clusterName: 'alpha',
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
      includeMetadata: false,
    });
    expect(props.columnVisibility).toBe(null);
    expect(props.columnWidths).toBe(null);
  });

  it('wires the Include metadata search toggle for the query-backed nodes table', async () => {
    await renderNodes([baseNode]);

    const preActions = gridTablePropsRef.current?.filters?.options?.preActions ?? [];
    expect(preActions.some((item) => 'id' in item && item.id === 'include-metadata')).toBe(true);
  });

  it('places the favorite with the filter pre-actions (left), not the export cluster', async () => {
    await renderNodes([baseNode]);

    const options = gridTablePropsRef.current?.filters?.options;
    const preActions = options?.preActions ?? [];
    expect(preActions.some((item) => 'id' in item && item.id === 'favorite')).toBe(true);
    const postActions = options?.postActions ?? [];
    expect(postActions.some((item) => 'id' in item && item.id === 'favorite')).toBe(false);
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
    expect(memoryColumn?.sortValue?.(baseNode)).toBe(2048);
    expect(
      Number(ageColumn?.sortValue?.({ ...baseNode, ageTimestamp: 1_700_000_000_000 }))
    ).toBeGreaterThan(
      Number(ageColumn?.sortValue?.({ ...baseNode, ageTimestamp: 1_700_003_600_000 }))
    );
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
