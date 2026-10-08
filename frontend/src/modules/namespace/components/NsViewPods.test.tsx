/**
 * frontend/src/modules/namespace/components/NsViewPods.test.tsx
 *
 * Test suite for NsViewPods.
 * Covers key behaviors and edge cases for NsViewPods.
 */

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import type { GridTableFilterState, GridTableProps } from '@shared/components/tables/GridTable';
import type React from 'react';
import { act } from 'react';
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

const {
  gridTablePropsRef,
  openWithObjectMock,
  navigateToViewMock,
  namespaceColumnLinkMock,
  namespaceColumnLinkTabRef,
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
} = vi.hoisted(() => ({
  gridTablePropsRef: { current: null as unknown as CapturedGridTableProps },
  openWithObjectMock: vi.fn(),
  navigateToViewMock: vi.fn(),
  namespaceColumnLinkTabRef: { current: null as string | null },
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
  gridPersistenceParamsRef: { current: null as { shareNamespaceFilter?: boolean } | null },
  runObjectActionMock: vi.fn().mockResolvedValue(undefined),
  errorHandlerMock: { handle: vi.fn() },
}));

vi.mock('@modules/namespace/components/useNamespaceColumnLink', () => ({
  useNamespaceColumnLink: (tab: string) => {
    namespaceColumnLinkTabRef.current = tab;
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

vi.mock('@ui/favorites/FavToggle', () => ({
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
    useGridTablePersistence: (params: { shareNamespaceFilter?: boolean }) => {
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
  // The main window always has workspace navigation available.
  useNavigateToView: () => ({ available: true, navigateToView: navigateToViewMock }),
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (...args: unknown[]) => useTableSortMock(...(args as [])),
}));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  default: () => null,
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

import NsViewPods from '@modules/namespace/components/NsViewPods';

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
    openWithObjectMock.mockReset();
    navigateToViewMock.mockReset();
    runObjectActionMock.mockClear();
    queryNamespacesPermissionsMock.mockReset();
    requestRefreshDomainStateMock.mockReset();
    scopedLifecycleMock.mockReset();
    setFiltersMock.mockReset();
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
    props: Partial<React.ComponentProps<typeof NsViewPods>> & {
      data?: PodSnapshotEntry[];
      metrics?: PodMetricsInfo | null;
    } = {},
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
    const effectiveMetrics = 'metrics' in props ? (props.metrics ?? null) : defaultMetrics;
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

    // `data` and `metrics` are test-only inputs that seed the query payload above.
    const { data: _seedData, metrics: _seedMetrics, ...viewProps } = props;
    await act(async () => {
      root.render(<NsViewPods namespace="team-a" {...viewProps} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    return effectiveData;
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

  it('shares the All Namespaces namespace selection with the other views', async () => {
    await renderPods({ namespace: ALL_NAMESPACES_SCOPE, showNamespaceColumn: true });

    expect(gridPersistenceParamsRef.current?.shareNamespaceFilter).toBe(true);
  });

  it('omits Status while preserving the backend-owned Node query facet', async () => {
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [createPod()],
          total: 1,
          totalIsExact: true,
          namespaces: ['team-a'],
          kinds: ['Pod'],
          facetValues: [
            {
              key: 'statuses',
              options: [
                { value: 'Pending', label: 'Pending' },
                { value: 'Running', label: 'Running' },
              ],
              exact: true,
            },
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
            {
              key: 'nodes',
              options: [
                { value: 'node-a', label: 'node-a' },
                { value: 'node-b', label: 'node-b' },
              ],
              exact: true,
            },
          ],
          facetsExact: true,
          capabilities: {
            filterableFields: ['kinds', 'namespaces'],
            queryFacets: [
              {
                key: 'statuses',
                label: 'Status',
                placeholder: 'All statuses',
                searchable: false,
                bulkActions: true,
              },
              {
                key: 'owners',
                label: 'Owner',
                placeholder: 'All owners',
                searchable: true,
                bulkActions: true,
              },
              {
                key: 'nodes',
                label: 'Node',
                placeholder: 'All nodes',
                searchable: true,
                bulkActions: true,
              },
            ],
          },
          metrics: { stale: false, successCount: 1, failureCount: 0 },
        },
      },
    });

    await renderPods({}, { skipDefaultQueryMock: true });

    expect(gridTablePropsRef.current.filters?.options?.queryFacets).toEqual([
      expect.objectContaining({
        key: 'owners',
        label: 'Owner',
        options: [
          {
            value: '["owner","Deployment","api","alpha:ctx","apps","v1","team-a"]',
            label: 'Deployment/api',
          },
        ],
      }),
      expect.objectContaining({
        key: 'nodes',
        label: 'Node',
        options: [
          { value: 'node-a', label: 'node-a' },
          { value: 'node-b', label: 'node-b' },
        ],
      }),
    ]);
  });

  it('passes the canonical cluster-scoped pod row identity into useTableSort', async () => {
    const pods = await renderPods();

    expect(useTableSortMock).toHaveBeenCalled();
    const [, , , options] = useTableSortMock.mock.calls[0];
    expect(options.rowIdentity(pods[0], 0)).toBe('alpha:ctx|/v1/Pod/team-a/api');
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

  it('exposes namespace column and prefixed keys when namespace visibility is enabled', async () => {
    const pods = await renderPods({ showNamespaceColumn: true });
    const columns = gridTablePropsRef.current.columns;
    expect(columns.find((col) => col.key === 'namespace')).toBeTruthy();
    // Namespace links open that namespace's Pods view.
    expect(namespaceColumnLinkTabRef.current).toBe('pods');
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
});
