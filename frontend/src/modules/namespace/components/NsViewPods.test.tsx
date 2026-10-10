/**
 * frontend/src/modules/namespace/components/NsViewPods.test.tsx
 *
 * Test suite for NsViewPods.
 * Covers key behaviors and edge cases for NsViewPods.
 */

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { resetResourceInventoryRowCache } from '@modules/resource-grid/useResourceInventoryTable';
import type ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import type { GridTableFilterState, GridTableProps } from '@shared/components/tables/GridTable';
import { getTextContent } from '@shared/components/tables/GridTable.utils';
import type React from 'react';
import { act, isValidElement } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanonicalRowTestOverrides,
  PodMetricsInfo,
  PodSnapshotEntry,
} from '@/core/refresh/types';
import { makeResourceRef } from '@/test-utils/makeResourceRef';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';

type CapturedGridTableProps = GridTableProps<PodSnapshotEntry> & {
  getCustomContextMenuItems: NonNullable<
    GridTableProps<PodSnapshotEntry>['getCustomContextMenuItems']
  >;
  onColumnWidthsChange: NonNullable<GridTableProps<PodSnapshotEntry>['onColumnWidthsChange']>;
  paginationControls?: React.ReactElement<{
    pageIndex: number;
    pageSize: number;
    totalCount: number;
    totalIsExact: boolean;
    hasPrevious: boolean;
    hasNext: boolean;
  }>;
};

type ConfirmationProps = React.ComponentProps<typeof ConfirmationModal>;

const {
  gridTablePropsRef,
  confirmationPropsRef,
  openWithObjectMock,
  navigateToViewMock,
  namespaceColumnLinkMock,
  useTableSortMock,
  useUserPermissionsMock,
  queryNamespacesPermissionsMock,
  requestRefreshDomainStateMock,
  scopedLifecycleMock,
  setFiltersMock,
  persistedFiltersRef,
  gridPersistenceParamsRef,
  runObjectActionMock,
  errorHandlerMock,
  namespaceLinkTabsRef,
} = vi.hoisted(() => ({
  gridTablePropsRef: { current: null as unknown as CapturedGridTableProps },
  confirmationPropsRef: { current: null as unknown as ConfirmationProps },
  openWithObjectMock: vi.fn(),
  navigateToViewMock: vi.fn(),
  namespaceColumnLinkMock: {
    onClick: vi.fn(),
    getClassName: () => 'object-panel-link',
    isInteractive: () => true,
  },
  useTableSortMock: vi.fn(),
  useUserPermissionsMock: vi.fn(),
  queryNamespacesPermissionsMock: vi.fn(),
  requestRefreshDomainStateMock: vi.fn(),
  scopedLifecycleMock: vi.fn(),
  setFiltersMock: vi.fn(),
  persistedFiltersRef: {
    current: {
      search: '',
      kinds: { mode: 'all' },
      namespaces: { mode: 'all' },
      clusters: { mode: 'all' },
      includeMetadata: false,
    } as GridTableFilterState,
  },
  gridPersistenceParamsRef: {
    current: null as { shareNamespaceFilter?: boolean; viewId?: string } | null,
  },
  namespaceLinkTabsRef: { current: [] as string[] },
  runObjectActionMock: vi.fn().mockResolvedValue(undefined),
  errorHandlerMock: { handle: vi.fn() },
}));

vi.mock('@modules/namespace/components/useNamespaceColumnLink', () => ({
  useNamespaceColumnLink: (tab: string) => {
    namespaceLinkTabsRef.current.push(tab);
    return namespaceColumnLinkMock;
  },
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@modules/namespace/contexts/NamespaceContext')>();
  return {
    ...actual,
    useNamespace: () => ({
      namespaces: [
        { name: 'All Namespaces', scope: ALL_NAMESPACES_SCOPE, isSynthetic: true },
        { name: 'team-a', scope: 'team-a' },
        { name: 'team-b', scope: 'team-b' },
      ],
      selectedNamespace: ALL_NAMESPACES_SCOPE,
      selectedNamespaceClusterId: 'alpha:ctx',
      namespaceLoading: false,
      namespaceRefreshing: false,
      namespaceReady: true,
      setSelectedNamespace: vi.fn(),
      loadNamespaces: vi.fn(),
      refreshNamespaces: vi.fn(),
      getClusterNamespace: vi.fn(),
    }),
  };
});

const clusterMetricsMock = vi.hoisted(() => ({ current: null as PodMetricsInfo | null }));

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

const favToggleStateRef = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock('@ui/favorites/FavToggle', () => ({
  useFavToggle: (state: Record<string, unknown>) => {
    favToggleStateRef.current = state;
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

vi.mock('@shared/components/tables/GridTable', () => ({
  default: (props: CapturedGridTableProps) => {
    gridTablePropsRef.current = props;
    const preActions = props.filters?.options?.preActions ?? [];
    return (
      <div>
        <div data-testid="mock-gridtable-filters">
          {preActions.map((item, index) => {
            if (!item || item.type === 'separator') {
              return null;
            }
            return (
              <button
                key={item.id ?? `action-${index}`}
                type="button"
                title={item.title}
                aria-label={item.ariaLabel ?? item.title}
                aria-pressed={item.type === 'toggle' ? item.active : undefined}
                onClick={item.type === 'menu' ? undefined : item.onClick}
              >
                {item.icon}
              </button>
            );
          })}
        </div>
        <table data-testid="grid-table">
          <tbody>
            {props.data.map((row) => (
              <tr key={row.ref.name}>
                <td>{row.ref.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  },
  GRIDTABLE_VIRTUALIZATION_DEFAULT: 'virtualization-default',
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@modules/namespace/hooks/useNamespaceGridTablePersistence', () => {
  return {
    useNamespaceGridTablePersistence: () => ({
      sortConfig: { key: 'name', direction: 'asc' },
      onSortChange: vi.fn(),
      columnWidths: {},
      setColumnWidths: vi.fn(),
      columnVisibility: null,
      setColumnVisibility: vi.fn(),
      filters: persistedFiltersRef.current,
      setFilters: setFiltersMock,
      pageSize: null,
      setPageSize: vi.fn(),
      isNamespaceScoped: true,
      resetState: vi.fn(),
      hydrated: true,
    }),
  };
});

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => {
  return {
    useGridTablePersistence: (params: { shareNamespaceFilter?: boolean; viewId?: string }) => {
      gridPersistenceParamsRef.current = params;
      return {
        storageKey: 'gridtable:v1:alpha:namespace-pods',
        sortConfig: { key: 'name', direction: 'asc' },
        setSortConfig: vi.fn(),
        columnWidths: {},
        setColumnWidths: vi.fn(),
        columnVisibility: null,
        setColumnVisibility: vi.fn(),
        filters: persistedFiltersRef.current,
        setFilters: setFiltersMock,
        pageSize: null,
        setPageSize: vi.fn(),
        resetState: vi.fn(),
        hydrated: true,
      };
    },
  };
});

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: navigateToViewMock }),
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (...args: unknown[]) => useTableSortMock(...(args as [])),
}));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  default: (props: ConfirmationProps) => {
    confirmationPropsRef.current = props;
    return null;
  },
}));

vi.mock('@/core/data-access', () => ({
  requestRefreshDomainState: (...args: unknown[]) => requestRefreshDomainStateMock(...(args as [])),
  useScopedRefreshDomainLifecycle: (...args: unknown[]) => scopedLifecycleMock(...args),
}));

vi.mock('@/core/refresh', () => ({
  useRefreshScopedDomain: (_domain: string, scope: string) =>
    scope.includes('?')
      ? {
          status: 'idle',
          data: null,
          stats: null,
          droppedAutoRefreshes: 0,
        }
      : {
          status: 'ready',
          data: { rows: [] },
          stats: null,
          version: 1,
          checksum: '',
          lastUpdated: 1,
          droppedAutoRefreshes: 0,
        },
  refreshManager: { triggerManualRefresh: vi.fn() },
}));

vi.mock('@core/backend-api', () => ({
  RunObjectAction: (...args: unknown[]) => runObjectActionMock(...(args as [])),
}));

vi.mock('@/core/capabilities', () => ({
  POD_PERMISSIONS: { feature: 'namespacePods', specs: [{ kind: 'Pod', verb: 'list' }] },
  getPermissionKey: (kind: string, action: string, ns?: string) => `${kind}:${action}:${ns ?? ''}`,
  queryNamespacesPermissions: (...args: unknown[]) =>
    queryNamespacesPermissionsMock(...(args as [])),
  useUserPermissions: () => useUserPermissionsMock(),
}));

vi.mock('@/core/refresh/hooks/useMetricsAvailability', () => ({
  useClusterMetricsAvailability: () => clusterMetricsMock.current,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedKubeconfig: 'mock-path:mock-context',
    selectedClusterId: 'alpha:ctx',
    selectedClusterName: 'alpha',
  }),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

import NsViewPods, { PodsTable } from '@modules/namespace/components/NsViewPods';

const createPod = (
  override: CanonicalRowTestOverrides<PodSnapshotEntry> = {}
): PodSnapshotEntry => {
  const { ref, ...row } = override;
  return {
    ref: {
      ...makeResourceRef({
        clusterId: 'alpha:ctx',
        kind: 'Pod',
        resource: 'pods',
        namespace: 'team-a',
        name: 'pod-default',
      }),
      ...ref,
    },
    node: 'node-a',
    status: 'Running',
    statusPresentation: 'ready',
    ready: '1/1',
    restarts: 0,
    age: '1h',
    ownerKind: 'Deployment',
    ownerName: 'owner',
    portForwardAvailable: true,
    cpuUsageMilli: 0,
    cpuRequestMilli: 0,
    cpuLimitMilli: 0,
    memoryUsageBytes: 0,
    memoryRequestBytes: 0,
    memoryLimitBytes: 0,
    ...row,
  };
};

describe('NsViewPods', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null as unknown as CapturedGridTableProps;
    confirmationPropsRef.current = null as unknown as ConfirmationProps;
    openWithObjectMock.mockReset();
    navigateToViewMock.mockReset();
    runObjectActionMock.mockClear();
    queryNamespacesPermissionsMock.mockReset();
    requestRefreshDomainStateMock.mockReset();
    scopedLifecycleMock.mockReset();
    setFiltersMock.mockReset();
    namespaceLinkTabsRef.current = [];
    persistedFiltersRef.current = {
      search: '',
      kinds: { mode: 'all' },
      namespaces: { mode: 'all' },
      clusters: { mode: 'all' },
      includeMetadata: false,
    };
    useTableSortMock.mockReset();
    useUserPermissionsMock.mockReset();
    errorHandlerMock.handle.mockClear();

    useTableSortMock.mockImplementation((data) => ({
      sortedData: data,
      sortConfig: { key: 'name', direction: 'asc' },
      handleSort: vi.fn(),
    }));
    useUserPermissionsMock.mockReturnValue(
      new Map([
        ['Pod:delete:team-a', { allowed: true, pending: false }],
        ['Pod:delete:', { allowed: true, pending: false }],
        ['Pod:create:team-a', { allowed: true, pending: false }],
      ])
    );
    clusterMetricsMock.current = null;
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [],
          total: 0,
          totalIsExact: true,
          namespaces: ['team-a', 'team-b'],
          kinds: ['Pod'],
          facetsExact: true,
        },
      },
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.sessionStorage.clear();
  });

  const renderPods = async (
    props: Partial<React.ComponentProps<typeof PodsTable>> & { data?: PodSnapshotEntry[] } = {},
    { skipDefaultQueryMock = false }: { skipDefaultQueryMock?: boolean } = {}
  ) => {
    // Include cluster metadata so GridTable key extraction stays cluster-scoped.
    const defaultPods: PodSnapshotEntry[] = [
      createPod({
        ref: { name: 'api', namespace: 'team-a' },

        node: 'node-a',
        status: 'Running',
        ready: '2/2',
        restarts: 0,
        age: '1h',
        ownerKind: 'Deployment',
        ownerName: 'api',
        cpuUsageMilli: 500,
        cpuRequestMilli: 1000,
        cpuLimitMilli: 1500,
        memoryUsageBytes: 200 * 1024 ** 2,
        memoryRequestBytes: 512 * 1024 ** 2,
        memoryLimitBytes: 1024 ** 3,
      }),
    ];

    const defaultMetrics: PodMetricsInfo = {
      stale: false,
      lastError: '',
      collectedAt: Math.floor(Date.now() / 1000),
      successCount: 1,
      failureCount: 0,
    };

    // Single-namespace pod tables are query-backed now (not local-complete), so the table renders
    // the typed query rows. Feed the query whatever rows the test supplies as `data` so existing
    // single-namespace assertions still see their pods. All-namespaces tests set their own mock.
    const effectiveNamespace = (props.namespace as string | undefined) ?? 'team-a';
    const effectiveData = (props.data as PodSnapshotEntry[] | undefined) ?? defaultPods;
    const effectiveMetrics =
      'metrics' in props ? (props.metrics ?? clusterMetricsMock.current ?? null) : defaultMetrics;
    if (effectiveNamespace !== ALL_NAMESPACES_SCOPE && !skipDefaultQueryMock) {
      requestRefreshDomainStateMock.mockImplementation(() => {
        const rows = effectiveData;
        return Promise.resolve({
          status: 'executed',
          data: {
            status: 'ready',
            data: {
              rows,
              total: rows.length,
              totalIsExact: true,
              namespaces: [effectiveNamespace],
              kinds: ['Pod'],
              facetsExact: true,
              // Usage rides the pod rows; the base payload carries the poller
              // freshness block joined at serve.
              metrics: effectiveMetrics,
            },
          },
        });
      });
    }

    // `data` is a test-only input that seeds the query mock above; pod rows are
    // query-backed now, so it is not a NsViewPods prop.
    const { data: _seedData, ...viewProps } = props;
    await act(async () => {
      root.render(
        <PodsTable
          namespace="team-a"
          clusterId="alpha:ctx"
          viewId="namespace-workload-pods"
          namespaceLinkView="workloads"
          metrics={defaultMetrics}
          {...viewProps}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    return effectiveData;
  };

  it.each(['Deployment', 'Widget'])(
    'preserves the API group and row cluster for a %s owner link',
    async (ownerKind) => {
      const pod = createPod({
        ref: { clusterId: 'OwnerCluster:Case', namespace: 'team-a' },
        ownerKind,
        ownerName: 'custom-owner',
        ownerApiVersion: 'operators.example.io/v1beta2',
      });
      await renderPods({ data: [pod] });
      const cell = requireReactElement<{
        onClick: (event: {
          altKey: boolean;
          preventDefault: () => void;
          stopPropagation: () => void;
        }) => void;
      }>(
        requireValue(
          gridTablePropsRef.current.columns.find((column) => column.key === 'owner'),
          'expected owner column'
        ).render(pod),
        'expected owner link'
      );
      act(() =>
        cell.props.onClick({ altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() })
      );
      expect(openWithObjectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          clusterId: 'OwnerCluster:Case',
          namespace: 'team-a',
          kind: ownerKind,
          name: 'custom-owner',
          group: 'operators.example.io',
          version: 'v1beta2',
        })
      );
      act(() =>
        cell.props.onClick({ altKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn() })
      );
      expect(navigateToViewMock).toHaveBeenCalledWith(
        expect.objectContaining({
          clusterId: 'OwnerCluster:Case',
          namespace: 'team-a',
          kind: ownerKind,
          name: 'custom-owner',
          group: 'operators.example.io',
          version: 'v1beta2',
        })
      );
    }
  );

  it('opens and navigates to a pod node in the pod cluster', async () => {
    const pod = createPod({ ref: { clusterId: 'NodeCluster:Case', namespace: 'team-a' } });
    await renderPods({ data: [pod] });
    const nodeColumn = requireValue(
      gridTablePropsRef.current.columns.find((column) => column.key === 'node'),
      'expected node column'
    );
    const cell = requireReactElement<{
      onClick: (event: {
        altKey: boolean;
        preventDefault: () => void;
        stopPropagation: () => void;
      }) => void;
    }>(nodeColumn.render(pod), 'expected node link');
    const nodeIdentity = {
      clusterId: 'NodeCluster:Case',
      group: '',
      version: 'v1',
      kind: 'Node',
      name: 'node-a',
    };

    act(() =>
      cell.props.onClick({ altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    );
    expect(openWithObjectMock).toHaveBeenCalledWith(expect.objectContaining(nodeIdentity));
    act(() =>
      cell.props.onClick({ altKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    );
    expect(navigateToViewMock).toHaveBeenCalledWith(expect.objectContaining(nodeIdentity));

    // An unscheduled pod has no node to open.
    const unscheduledCell = nodeColumn.render(createPod({ node: '' }));
    expect(
      isValidElement<{ onClick?: unknown }>(unscheduledCell)
        ? unscheduledCell.props.onClick
        : undefined
    ).toBeUndefined();
  });

  it.each([
    { ownerKind: 'None', ownerName: 'None' },
    { ownerKind: 'Deployment', ownerName: 'missing-version' },
    { ownerKind: 'Widget', ownerName: 'missing-version' },
  ])('keeps incomplete owner identity display-only: $ownerKind/$ownerName', async (owner) => {
    const pod = createPod({ ...owner, ownerApiVersion: undefined });
    await renderPods({ data: [pod] });
    const cell = requireValue(
      gridTablePropsRef.current.columns.find((column) => column.key === 'owner'),
      'expected owner column'
    ).render(pod);
    expect(
      isValidElement<{ onClick?: unknown }>(cell) ? cell.props.onClick : undefined
    ).toBeUndefined();
    expect(openWithObjectMock).not.toHaveBeenCalled();
    expect(navigateToViewMock).not.toHaveBeenCalled();
  });

  const openDeleteConfirmation = () => {
    const deleteItem = gridTablePropsRef.current
      .getCustomContextMenuItems(gridTablePropsRef.current.data[0], 'name')
      .find((item) => item.label === 'Delete');
    act(() => {
      requireValue(deleteItem, 'expected Delete context menu item').onClick?.();
    });
    if (!confirmationPropsRef.current?.isOpen) {
      throw new Error('Expected delete confirmation to open');
    }
  };

  it('uses the typed query result for all-namespaces pods on first render', async () => {
    const localPod = createPod({ ref: { name: 'local-provider-row', namespace: 'team-a' } });
    const queryPod = createPod({ ref: { name: 'query-row', namespace: 'team-b' } });
    requestRefreshDomainStateMock.mockImplementation(() =>
      Promise.resolve({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: [queryPod],
            total: 1,
            totalIsExact: true,
            namespaces: ['team-a', 'team-b'],
            kinds: ['Pod'],
            facetsExact: true,
            metrics: { stale: false, successCount: 1, failureCount: 0 },
          },
        },
      })
    );

    await renderPods({
      namespace: ALL_NAMESPACES_SCOPE,
      data: [localPod],
      showNamespaceColumn: true,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.data).toEqual([queryPod]);
    expect(gridTablePropsRef.current.paginationControls).toBeNull();
    expect(requestRefreshDomainStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'pods',
        scope: 'alpha:ctx|namespace:all?limit=50&sort=name&sortDirection=asc',
      })
    );
    expect(queryNamespacesPermissionsMock).toHaveBeenCalledWith(
      [{ namespace: 'team-b', clusterId: 'alpha:ctx' }],
      expect.objectContaining({ specLists: expect.any(Array) })
    );
  });

  const lastQueryParams = () => {
    const calls = requestRefreshDomainStateMock.mock.calls;
    const request = calls[calls.length - 1]?.[0] as { scope?: string } | undefined;
    const scope = request?.scope ?? '';
    return new URLSearchParams(scope.slice(scope.indexOf('?') + 1));
  };
  const selectedDeployment = {
    clusterId: 'alpha:ctx',
    group: 'apps',
    version: 'v1',
    kind: 'Deployment',
    namespace: 'team-a',
    name: 'api',
  };

  it('shows only the selected workload pods without saving the selection as a filter', async () => {
    await renderPods({
      namespace: ALL_NAMESPACES_SCOPE,
      attachedTo: selectedDeployment,
    });

    expect(lastQueryParams().getAll('facet.owners')).toEqual([
      '["owner","Deployment","api","alpha:ctx","apps","v1","team-a"]',
    ]);
    expect(lastQueryParams().get('namespaces')).toBeNull();
    expect(setFiltersMock).not.toHaveBeenCalled();
  });

  it("never shows another parent's pods while a newly attached table loads", async () => {
    resetResourceInventoryRowCache();
    const apiPod = createPod({ ref: { name: 'api-1', namespace: 'team-a' } });
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [apiPod],
          total: 1,
          totalIsExact: true,
          namespaces: ['team-a'],
          kinds: ['Pod'],
          facetsExact: true,
        },
      },
    });
    await renderPods({ namespace: ALL_NAMESPACES_SCOPE, attachedTo: selectedDeployment });
    expect(gridTablePropsRef.current.data).toEqual([apiPod]);

    // Close api's pods, then open web's: its first query is still in flight.
    act(() => root.render(null));
    requestRefreshDomainStateMock.mockReturnValue(new Promise(() => undefined));
    await renderPods({
      namespace: ALL_NAMESPACES_SCOPE,
      attachedTo: { ...selectedDeployment, name: 'web' },
    });

    expect(gridTablePropsRef.current.data).toEqual([]);
  });

  it('shows only the selected node pods', async () => {
    await renderPods({
      namespace: ALL_NAMESPACES_SCOPE,
      attachedTo: {
        clusterId: 'alpha:ctx',
        group: '',
        version: 'v1',
        kind: 'Node',
        name: 'node-a',
      },
    });

    expect(lastQueryParams().getAll('facet.nodes')).toEqual(['node-a']);
    expect(lastQueryParams().getAll('facet.owners')).toEqual([]);
  });

  it('drops the column that only repeats the parent row', async () => {
    const columnKeys = () => gridTablePropsRef.current.columns.map((column) => column.key);

    await renderPods({ namespace: ALL_NAMESPACES_SCOPE, attachedTo: selectedDeployment });
    // Every pod under a workload has that Owner.
    expect(columnKeys()).not.toContain('owner');
    expect(columnKeys()).toContain('node');

    await renderPods({
      namespace: ALL_NAMESPACES_SCOPE,
      attachedTo: {
        clusterId: 'alpha:ctx',
        group: '',
        version: 'v1',
        kind: 'Node',
        name: 'node-a',
      },
    });
    // Every pod under a node runs on that Node.
    expect(columnKeys()).not.toContain('node');
    expect(columnKeys()).toContain('owner');

    await renderPods({ namespace: ALL_NAMESPACES_SCOPE });
    expect(columnKeys()).toEqual(expect.arrayContaining(['owner', 'node']));
  });

  it('ignores a selection from another cluster', async () => {
    await renderPods({
      namespace: ALL_NAMESPACES_SCOPE,
      attachedTo: { ...selectedDeployment, clusterId: 'beta:ctx' },
    });

    expect(lastQueryParams().getAll('facet.owners')).toEqual([]);
  });

  it('keeps an attached table in memory and out of favorites, with no hidden Namespaces, Owner, or Node filter', async () => {
    persistedFiltersRef.current = {
      search: 'web',
      kinds: { mode: 'all' },
      namespaces: { mode: 'some', values: ['team-b'] },
      clusters: { mode: 'all' },
      queryFacets: {
        nodes: { mode: 'some', values: ['node-a'] },
        owners: {
          mode: 'some',
          values: ['["owner","Deployment","api","alpha:ctx","apps","v1","team-a"]'],
        },
      },
      includeMetadata: false,
    };

    await renderPods({ namespace: ALL_NAMESPACES_SCOPE, attachedTo: selectedDeployment });

    // It starts fresh every time, is never saved or offered as a favorite, and
    // neither reads nor writes the Namespaces selection All Namespaces views share.
    expect(gridPersistenceParamsRef.current).toMatchObject({ transient: true });
    expect(gridPersistenceParamsRef.current?.shareNamespaceFilter ?? false).toBe(false);
    expect(favToggleStateRef.current).toMatchObject({ enabled: false });
    expect(setFiltersMock).toHaveBeenCalledWith({
      search: 'web',
      kinds: { mode: 'all' },
      namespaces: { mode: 'all' },
      clusters: { mode: 'all' },
      includeMetadata: false,
    });
    expect(lastQueryParams().get('namespaces')).toBeNull();
    // Only the attached workload narrows the pods, never a saved Owner or Node.
    expect(lastQueryParams().getAll('facet.owners')).toEqual([
      '["owner","Deployment","api","alpha:ctx","apps","v1","team-a"]',
    ]);
    expect(lastQueryParams().getAll('facet.nodes')).toEqual([]);
  });

  it('closes an attached table from its own filter bar', async () => {
    const onClose = vi.fn();
    await renderPods({ namespace: ALL_NAMESPACES_SCOPE, attachedTo: selectedDeployment, onClose });

    const close = requireValue(
      gridTablePropsRef.current?.filters?.options?.trailingActions?.find(
        (item) => item.type === 'action' && item.title === 'Close pods'
      ),
      'expected the attached table Close'
    );
    if (close.type === 'action') {
      close.onClick();
    }
    expect(onClose).toHaveBeenCalledTimes(1);

    // The Pods view has nothing to close.
    await renderPods({ namespace: ALL_NAMESPACES_SCOPE });
    expect(gridTablePropsRef.current?.filters?.options?.trailingActions ?? []).toEqual([]);
  });

  it('offers no Status, Owner, Node, or Namespaces dropdowns', async () => {
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [createPod()],
          total: 1,
          totalIsExact: true,
          namespaces: ['team-a', 'team-b'],
          kinds: ['Pod'],
          facetValues: [
            { key: 'statuses', options: [{ value: 'Running', label: 'Running' }], exact: true },
            {
              key: 'owners',
              options: [
                {
                  value: '["owner","Deployment","api","alpha:ctx","apps","v1","team-a"]',
                  label: 'Deployment/api',
                },
              ],
              exact: true,
            },
            { key: 'nodes', options: [{ value: 'node-a', label: 'node-a' }], exact: true },
          ],
          facetsExact: true,
          capabilities: {
            filterableFields: ['kinds', 'namespaces'],
            queryFacets: [
              { key: 'statuses', label: 'Status', placeholder: 'All statuses' },
              { key: 'owners', label: 'Owner', placeholder: 'All owners', searchable: true },
              { key: 'nodes', label: 'Node', placeholder: 'All nodes', searchable: true },
            ],
          },
          metrics: { stale: false, successCount: 1, failureCount: 0 },
        },
      },
    });

    await renderPods({ namespace: ALL_NAMESPACES_SCOPE, attachedTo: selectedDeployment });

    const options = gridTablePropsRef.current.filters?.options;
    expect(options?.queryFacets ?? []).toEqual([]);
    expect(options?.showNamespaceDropdown ?? false).toBe(false);
  });

  const facetedPodsResponse = () => ({
    status: 'executed',
    data: {
      status: 'ready',
      data: {
        rows: [createPod()],
        total: 1,
        totalIsExact: true,
        namespaces: ['team-a', 'team-b'],
        kinds: ['Pod'],
        facetValues: [
          { key: 'statuses', options: [{ value: 'Running', label: 'Running' }], exact: true },
          {
            key: 'owners',
            options: [{ value: 'owner:api', label: 'Deployment/api' }],
            exact: true,
          },
          { key: 'nodes', options: [{ value: 'node-a', label: 'node-a' }], exact: true },
        ],
        facetsExact: true,
        capabilities: {
          filterableFields: ['kinds', 'namespaces'],
          queryFacets: [
            { key: 'statuses', label: 'Status', placeholder: 'All statuses' },
            { key: 'owners', label: 'Owner', placeholder: 'All owners', searchable: true },
            { key: 'nodes', label: 'Node', placeholder: 'All nodes', searchable: true },
          ],
        },
        metrics: { stale: false, successCount: 1, failureCount: 0 },
      },
    },
  });

  it('offers the Pods view every filter and saves its own table state', async () => {
    requestRefreshDomainStateMock.mockResolvedValue(facetedPodsResponse());

    await act(async () => {
      root.render(<NsViewPods namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const options = gridTablePropsRef.current.filters?.options;
    expect((options?.queryFacets ?? []).map((facet) => facet.key)).toEqual(['owners', 'nodes']);
    expect(options?.showNamespaceDropdown).toBe(true);
    // Like every All Namespaces view, it shares the cluster's Namespaces selection.
    expect(gridPersistenceParamsRef.current).toMatchObject({
      viewId: 'namespace-pods',
      shareNamespaceFilter: true,
    });
  });

  it('opens a pod namespace in the Pods view from the Namespace column', async () => {
    await act(async () => {
      root.render(<NsViewPods namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />);
      await Promise.resolve();
    });

    expect(namespaceLinkTabsRef.current[namespaceLinkTabsRef.current.length - 1]).toBe('pods');
  });

  it('uses backend statusPresentation for the pod status class', async () => {
    const pods = [
      createPod({
        ref: { name: 'api' },

        status: 'Running',
        statusState: 'Running',
        statusPresentation: 'warning',
      }),
    ];
    await renderPods({ data: pods });

    const statusColumn = requireValue(
      gridTablePropsRef.current.columns.find((col) => col.key === 'status'),
      'expected the pod status column'
    );
    const cell = requireReactElement<{ className?: string }>(
      statusColumn.render(gridTablePropsRef.current.data[0]),
      'expected the pod status cell element'
    );
    expect(cell.props.className).toBe('status-text warning');
  });

  it('renders zero pod restarts as no value without changing numeric sorting', async () => {
    const pods = [createPod(), createPod({ ref: { name: 'restarted' }, restarts: 2 })];
    await renderPods({ data: pods });

    const column = requireValue(
      gridTablePropsRef.current.columns.find(({ key }) => key === 'restarts'),
      'expected pod restarts column'
    );
    expect(getTextContent(column.render(pods[0]))).toBe('-');
    expect(getTextContent(column.render(pods[1]))).toBe('2');
    expect(column.sortValue?.(pods[0])).toBe(0);
    expect(column.sortValue?.(pods[1])).toBe(2);
  });

  it('passes keyed sort reuse and numeric pod sort values into useTableSort', async () => {
    const pods = await renderPods();

    expect(useTableSortMock).toHaveBeenCalled();
    const [, , , options] = useTableSortMock.mock.calls[0];
    expect(options.rowIdentity(pods[0], 0)).toBe('alpha:ctx|/v1/Pod/team-a/api');

    const columns = options.columns as Array<{
      key: string;
      sortValue?: (item: PodSnapshotEntry) => unknown;
    }>;
    const cpuColumn = columns.find((column) => column.key === 'cpu');
    const memoryColumn = columns.find((column) => column.key === 'memory');
    const readyColumn = columns.find((column) => column.key === 'ready');
    expect(cpuColumn?.sortValue?.(pods[0])).toBe(500);
    expect(memoryColumn?.sortValue?.(pods[0])).toBe(200 * 1024 ** 2);
    expect(readyColumn?.sortValue?.(pods[0])).toBe(2000002);
  });

  it('opens the object panel when a row name is clicked', async () => {
    await renderPods();
    const gridProps = gridTablePropsRef.current;

    const nameColumn = requireValue(
      gridProps.columns.find((col) => col.key === 'name'),
      'expected the pod name column'
    );
    const cell = requireReactElement<{
      onClick?: (event: { stopPropagation: () => void }) => void;
    }>(nameColumn.render(gridProps.data[0]), 'expected the pod name cell element');

    act(() => {
      cell.props.onClick?.({ stopPropagation: () => undefined });
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'alpha:ctx',
        clusterName: 'alpha',
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
      })
    );
  });

  it('treats a missing query payload as warm-up without adding table-level metrics status', async () => {
    // A null query payload is a backend warm-up condition, not a failure: the
    // table stays in its loading presentation with no error surface, and the
    // next live-data identity change retries.
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready', data: null },
    });
    await renderPods(
      {
        metrics: {
          stale: true,
          lastError: '',
          collectedAt: 1700000000,
          successCount: 0,
          failureCount: 1,
        },
      },
      { skipDefaultQueryMock: true }
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('.resource-inventory-error')).toBeNull();
    expect(container.textContent).not.toContain('returned no data');
  });

  it('keeps metrics errors out of the Pods table surface', async () => {
    await renderPods({
      metrics: {
        stale: false,
        lastError: '  metrics api unavailable  ',
        collectedAt: 1700000001,
        successCount: 0,
        failureCount: 1,
      },
    });

    expect(container.querySelector('.metrics-warning-banner')).toBeNull();
  });

  it('falls back to cluster metrics when pod metrics are unavailable', async () => {
    clusterMetricsMock.current = {
      stale: false,
      lastError: 'metrics api unavailable',
      collectedAt: 1700000002,
      successCount: 0,
      failureCount: 1,
    };

    act(() => {
      root.unmount();
    });
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null as unknown as CapturedGridTableProps;
    await renderPods({
      namespace: 'team-b',
      data: [createPod({ ref: { name: 'other', namespace: 'team-b' } })],
      metrics: null,
    });

    const cpuColumn = requireValue(
      gridTablePropsRef.current.columns.find((col) => col.key === 'cpu'),
      'expected the pod CPU column'
    );
    const cpuElement = requireReactElement<{ metricsError?: string }>(
      cpuColumn.render(gridTablePropsRef.current.data[0]),
      'expected the pod CPU cell element'
    );
    expect(cpuElement.props.metricsError).toBe('metrics api unavailable');
  });

  it('omits delete context action when permission data is unavailable', async () => {
    useUserPermissionsMock.mockReturnValue(new Map());
    await renderPods();

    const items = gridTablePropsRef.current.getCustomContextMenuItems(
      gridTablePropsRef.current.data[0],
      'name'
    );
    expect(items.find((item) => item.label === 'Delete')).toBeUndefined();
  });

  it('disables port forward in the context menu when the pod exposes no forwardable ports', async () => {
    await renderPods({
      data: [createPod({ ref: { name: 'no-ports' }, portForwardAvailable: false })],
    });

    const items = gridTablePropsRef.current.getCustomContextMenuItems(
      gridTablePropsRef.current.data[0],
      'name'
    );
    const portForwardItem = items.find((item) => item.label?.includes('Port Forward'));
    expect(portForwardItem).toMatchObject({
      label: 'Port Forward',
      disabled: true,
    });
  });

  it('suppresses delete action when permission is pending or denied', async () => {
    useUserPermissionsMock.mockReturnValue(
      new Map([['Pod:delete:team-a', { allowed: true, pending: true }]])
    );
    await renderPods();
    const pendingItems = gridTablePropsRef.current.getCustomContextMenuItems(
      gridTablePropsRef.current.data[0],
      'name'
    );
    expect(pendingItems.find((item) => item.label === 'Delete')).toBeUndefined();

    useUserPermissionsMock.mockReturnValue(
      new Map([['Pod:delete:team-a', { allowed: false, pending: false }]])
    );
    await renderPods();
    const deniedItems = gridTablePropsRef.current.getCustomContextMenuItems(
      gridTablePropsRef.current.data[0],
      'name'
    );
    expect(deniedItems.find((item) => item.label === 'Delete')).toBeUndefined();
  });

  it('exposes namespace column and prefixed keys when namespace visibility is enabled', async () => {
    const pods = await renderPods({ showNamespaceColumn: true });
    const columns = gridTablePropsRef.current.columns;
    expect(columns.find((col) => col.key === 'namespace')).toBeTruthy();
    const key = gridTablePropsRef.current.keyExtractor(pods[0], 0);
    expect(key).toBe('alpha:ctx|/v1/Pod/team-a/api');
  });

  it('derives metric freshness values for resource columns', async () => {
    await renderPods({
      metrics: {
        stale: true,
        lastError: 'cpu metrics unavailable',
        collectedAt: 1700001000,
        successCount: 1,
        failureCount: 0,
      },
    });

    const cpuColumn = requireValue(
      gridTablePropsRef.current.columns.find((col) => col.key === 'cpu'),
      'expected the pod CPU column'
    );
    const cpuElement = requireReactElement<{
      metricsStale?: boolean;
      metricsError?: string;
    }>(cpuColumn.render(gridTablePropsRef.current.data[0]), 'expected the pod CPU cell element');
    expect(cpuElement.props.metricsStale).toBe(true);
    expect(cpuElement.props.metricsError).toBe('cpu metrics unavailable');
  });

  it('keeps the column definitions stable across metric interval rerenders', async () => {
    await renderPods({
      metrics: {
        stale: false,
        lastError: '',
        collectedAt: 1700001000,
        successCount: 1,
        failureCount: 0,
      },
    });

    const firstColumnsRef = gridTablePropsRef.current.columns;

    await renderPods({
      metrics: {
        stale: true,
        lastError: 'metrics stale',
        collectedAt: 1700001001,
        successCount: 1,
        failureCount: 1,
      },
    });

    expect(gridTablePropsRef.current.columns).toBe(firstColumnsRef);
  });

  it('does not render a competing unhealthy-pods filter action', async () => {
    await renderPods({
      data: [
        createPod({ ref: { name: 'healthy' }, statusPresentation: 'ready' }),
        createPod({ ref: { name: 'failing' }, statusPresentation: 'error', restarts: 2 }),
      ],
    });

    expect(container.querySelector('[title^="Show unhealthy pods"]')).toBeNull();
    expect(container.querySelector('[title="Show all pods"]')).toBeNull();
  });

  it('deletes a pod when confirmation succeeds', async () => {
    await renderPods();
    openDeleteConfirmation();

    await act(async () => {
      await confirmationPropsRef.current?.onConfirm?.();
    });

    expect(runObjectActionMock).toHaveBeenCalledWith({
      action: 'delete',
      target: {
        clusterId: 'alpha:ctx',
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'team-a',
        name: 'api',
      },
    });
  });

  it('handles delete failure with errorHandler and resets confirmation state', async () => {
    runObjectActionMock.mockRejectedValueOnce(new Error('boom'));

    await renderPods();
    openDeleteConfirmation();

    await act(async () => {
      await confirmationPropsRef.current?.onConfirm?.();
    });

    expect(errorHandlerMock.handle).toHaveBeenCalledWith(expect.any(Error), {
      action: 'delete',
      kind: 'Pod',
      name: 'api',
    });
    expect(confirmationPropsRef.current?.isOpen).toBe(false);
  });
});
