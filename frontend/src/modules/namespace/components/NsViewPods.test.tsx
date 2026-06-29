/**
 * frontend/src/modules/namespace/components/NsViewPods.test.tsx
 *
 * Test suite for NsViewPods.
 * Covers key behaviors and edge cases for NsViewPods.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PodSnapshotEntry, PodMetricsInfo } from '@/core/refresh/types';
import { getPodsUnhealthyStorageKey } from '@modules/namespace/components/podsFilterSignals';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { eventBus } from '@/core/events';

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
  runObjectActionMock,
  errorHandlerMock,
} = vi.hoisted(() => ({
  gridTablePropsRef: { current: null as any },
  confirmationPropsRef: { current: null as any },
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
  runObjectActionMock: vi.fn().mockResolvedValue(undefined),
  errorHandlerMock: { handle: vi.fn() },
}));

vi.mock('@modules/namespace/components/useNamespaceColumnLink', () => ({
  useNamespaceColumnLink: () => namespaceColumnLinkMock,
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

const clusterMetricsMock = vi.hoisted(() => ({ current: null as any }));

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
      onClick: () => {},
      title: 'Save as favorite',
    },
    modal: null,
  }),
}));

vi.mock('@shared/components/tables/GridTable', () => ({
  default: (props: any) => {
    gridTablePropsRef.current = props;
    const preActions = props.filters?.options?.preActions ?? [];
    return (
      <div>
        <div data-testid="mock-gridtable-filters">
          {preActions.map((item: any, index: number) => {
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
                onClick={item.onClick}
              >
                {item.icon}
              </button>
            );
          })}
          {props.filters?.options?.customActions ?? null}
        </div>
        <table data-testid="grid-table">
          <tbody>
            {props.data.map((row: any) => (
              <tr key={row.name}>
                <td>{row.name}</td>
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
  const state = { columnWidths: {} as Record<string, any> };
  return {
    useNamespaceGridTablePersistence: () => ({
      sortConfig: { key: 'name', direction: 'asc' },
      onSortChange: vi.fn(),
      columnWidths: state.columnWidths,
      setColumnWidths: (next: any) => {
        state.columnWidths = next;
        if (gridTablePropsRef.current) {
          gridTablePropsRef.current = { ...gridTablePropsRef.current, columnWidths: next };
        }
      },
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
      isNamespaceScoped: true,
      resetState: vi.fn(),
      hydrated: true,
    }),
  };
});

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => {
  const state = { columnWidths: {} as Record<string, any> };
  return {
    useGridTablePersistence: () => ({
      storageKey: 'gridtable:v1:alpha:namespace-pods',
      sortConfig: { key: 'name', direction: 'asc' },
      setSortConfig: vi.fn(),
      columnWidths: state.columnWidths,
      setColumnWidths: (next: any) => {
        state.columnWidths = next;
        if (gridTablePropsRef.current) {
          gridTablePropsRef.current = { ...gridTablePropsRef.current, columnWidths: next };
        }
      },
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
  default: (props: any) => {
    confirmationPropsRef.current = props;
    return null;
  },
}));

vi.mock('@/core/data-access', () => ({
  requestRefreshDomainState: (...args: unknown[]) => requestRefreshDomainStateMock(...(args as [])),
  useScopedRefreshDomainLifecycle: vi.fn(),
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

vi.mock('@wailsjs/go/backend/App', () => ({
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
  }),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

import NsViewPods, { matchesPodsFilter } from '@modules/namespace/components/NsViewPods';

const createPod = (override: Partial<PodSnapshotEntry> = {}): PodSnapshotEntry => ({
  name: 'pod-default',
  namespace: 'team-a',
  clusterId: 'alpha:ctx',
  clusterName: 'alpha',
  node: 'node-a',
  status: 'Running',
  statusPresentation: 'ready',
  ready: '1/1',
  restarts: 0,
  age: '1h',
  ownerKind: 'Deployment',
  ownerName: 'owner',
  portForwardAvailable: true,
  cpuUsage: '0m',
  cpuRequest: '0m',
  cpuLimit: '0m',
  memUsage: '0Mi',
  memRequest: '0Mi',
  memLimit: '0Mi',
  ...override,
});

const podMetricRows = (rows: PodSnapshotEntry[]) =>
  rows.map((pod) => ({
    clusterId: pod.clusterId,
    group: '',
    version: 'v1',
    kind: 'Pod',
    resource: 'pods',
    namespace: pod.namespace,
    name: pod.name,
    rowKey: `${pod.namespace}/${pod.name}`,
    cpuUsage: pod.cpuUsage,
    memUsage: pod.memUsage,
  }));

describe('NsViewPods', () => {
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
    confirmationPropsRef.current = null;
    openWithObjectMock.mockReset();
    navigateToViewMock.mockReset();
    runObjectActionMock.mockClear();
    queryNamespacesPermissionsMock.mockReset();
    requestRefreshDomainStateMock.mockReset();
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
    props: Partial<React.ComponentProps<typeof NsViewPods>> & { data?: PodSnapshotEntry[] } = {},
    { skipDefaultQueryMock = false }: { skipDefaultQueryMock?: boolean } = {}
  ) => {
    // Include cluster metadata so GridTable key extraction stays cluster-scoped.
    const defaultPods: PodSnapshotEntry[] = [
      createPod({
        name: 'api',
        namespace: 'team-a',
        node: 'node-a',
        status: 'Running',
        ready: '2/2',
        restarts: 0,
        age: '1h',
        ownerKind: 'Deployment',
        ownerName: 'api',
        cpuUsage: '500m',
        cpuRequest: '1000m',
        cpuLimit: '1500m',
        memUsage: '200Mi',
        memRequest: '512Mi',
        memLimit: '1Gi',
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
      requestRefreshDomainStateMock.mockImplementation((request?: unknown) => {
        const args = request as { domain?: string; scope?: string } | undefined;
        // Mirror the backend: apply the health predicate carried in the query scope, so the
        // unhealthy/restarts/not-ready toggle (a server-side predicate now) yields filtered rows.
        const healthMatch = /predicate\.health=([^&]+)/.exec(args?.scope ?? '');
        const rows = healthMatch
          ? effectiveData.filter((pod) =>
              matchesPodsFilter(healthMatch[1] as Parameters<typeof matchesPodsFilter>[0], pod)
            )
          : effectiveData;
        const isMetricDomain = args?.domain === 'pods-metrics';
        return Promise.resolve({
          status: 'executed',
          data: {
            status: 'ready',
            data: {
              rows: isMetricDomain ? podMetricRows(rows) : rows,
              total: rows.length,
              totalIsExact: true,
              namespaces: [effectiveNamespace],
              kinds: ['Pod'],
              facetsExact: true,
              metrics: isMetricDomain ? effectiveMetrics : undefined,
              // Scope counts mirror the backend: over all scope pods (effectiveData),
              // not the health-filtered page, so the unhealthy badge stays correct.
              totalCount: effectiveData.length,
              healthCounts: {
                unhealthy: effectiveData.filter((pod) => matchesPodsFilter('unhealthy', pod))
                  .length,
                restarts: effectiveData.filter((pod) => matchesPodsFilter('restarts', pod)).length,
                'not-ready': effectiveData.filter((pod) => matchesPodsFilter('not-ready', pod))
                  .length,
              },
            },
          },
        });
      });
    }

    // `data` is a test-only input that seeds the query mock above; pod rows are
    // query-backed now, so it is not a NsViewPods prop.
    const { data: _seedData, ...viewProps } = props;
    await act(async () => {
      root.render(<NsViewPods namespace="team-a" metrics={defaultMetrics} {...viewProps} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    return effectiveData;
  };

  const openDeleteConfirmation = () => {
    const deleteItem = gridTablePropsRef.current
      .getCustomContextMenuItems(gridTablePropsRef.current.data[0])
      .find((item: any) => item.label === 'Delete');
    expect(deleteItem).toBeTruthy();
    act(() => {
      deleteItem?.onClick?.();
    });
    expect(confirmationPropsRef.current?.isOpen).toBe(true);
  };

  it('passes pod data to GridTable and exposes key columns', async () => {
    const pods = await renderPods();

    const gridProps = gridTablePropsRef.current;
    expect(gridProps.data).toEqual(pods);
    expect(gridProps.enableContextMenu).toBe(true);
    expect(gridProps.columns.map((col: any) => col.key)).toEqual(
      expect.arrayContaining(['name', 'status', 'cpu', 'memory'])
    );
    // Single-namespace pod tables are query-backed now, so they issue a typed query.
    expect(requestRefreshDomainStateMock).toHaveBeenCalled();
  });

  it('uses the typed query result for all-namespaces pods on first render', async () => {
    const localPod = createPod({ name: 'local-provider-row', namespace: 'team-a' });
    const queryPod = createPod({ name: 'query-row', namespace: 'team-b' });
    requestRefreshDomainStateMock.mockImplementation((args: { domain?: string }) =>
      Promise.resolve({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: args?.domain === 'pods-metrics' ? podMetricRows([queryPod]) : [queryPod],
            total: 1,
            totalIsExact: true,
            namespaces: ['team-a', 'team-b'],
            kinds: ['Pod'],
            facetsExact: true,
            metrics:
              args?.domain === 'pods-metrics'
                ? { stale: false, successCount: 1, failureCount: 0 }
                : undefined,
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
    expect(gridTablePropsRef.current.paginationControls?.props).toMatchObject({
      pageIndex: 1,
      pageSize: 50,
      totalCount: 1,
      totalIsExact: true,
      hasPrevious: false,
      hasNext: false,
    });
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

  it('uses backend statusPresentation for the pod status class', async () => {
    const pods = [
      createPod({
        name: 'api',
        status: 'Running',
        statusState: 'Running',
        statusPresentation: 'warning',
      }),
    ];
    await renderPods({ data: pods });

    const statusColumn = gridTablePropsRef.current.columns.find((col: any) => col.key === 'status');
    const cell = statusColumn.render(gridTablePropsRef.current.data[0]);
    expect(React.isValidElement(cell)).toBe(true);
    expect(cell.props.className).toBe('status-text warning');
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
    expect(memoryColumn?.sortValue?.(pods[0])).toBe(200);
    expect(readyColumn?.sortValue?.(pods[0])).toBe(2000002);
  });

  it('opens the object panel when a row name is clicked', async () => {
    await renderPods();
    const gridProps = gridTablePropsRef.current;

    const nameColumn = gridProps.columns.find((col: any) => col.key === 'name');
    const cell = nameColumn.render(gridProps.data[0]);
    expect(React.isValidElement(cell)).toBe(true);

    act(() => {
      cell.props.onClick?.({ stopPropagation: () => {} });
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

  it('treats a missing query payload as warm-up and still renders the metrics banner', async () => {
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
    expect(container.querySelector('.metrics-warning-banner')?.textContent).toContain(
      'Awaiting metrics data...'
    );
  });

  it('prefers trimmed metrics error messages over stale warnings', async () => {
    await renderPods({
      metrics: {
        stale: false,
        lastError: '  metrics api unavailable  ',
        collectedAt: 1700000001,
        successCount: 0,
        failureCount: 1,
      },
    });

    expect(container.querySelector('.metrics-warning-banner')?.textContent).toContain(
      'Metrics API not found'
    );
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
    gridTablePropsRef.current = null;
    await renderPods({
      namespace: 'team-b',
      data: [createPod({ name: 'other', namespace: 'team-b' })],
      metrics: null,
    });

    expect(container.querySelector('.metrics-warning-banner')?.textContent).toContain(
      'Metrics API not found'
    );
  });

  it('toggles namespace styling when the column is shown', async () => {
    await renderPods();
    expect(gridTablePropsRef.current.tableClassName).toBe('gridtable-pods');

    await renderPods({ showNamespaceColumn: true });
    expect(gridTablePropsRef.current.tableClassName).toBe(
      'gridtable-pods gridtable-pods--namespaced'
    );
  });

  it('updates column widths when resized', async () => {
    await renderPods();
    const nextWidths = { name: { width: 280 } };

    await act(async () => {
      gridTablePropsRef.current.onColumnWidthsChange(nextWidths);
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.columnWidths).toEqual(nextWidths);
  });

  it('wires the "updating pods" loading message for the query-backed table', async () => {
    // The view owns the updating message; whether the overlay is shown (re-fetch in flight over
    // existing rows) is the controller's behavior, covered by ResourceInventoryTable's own tests.
    await renderPods();
    expect(gridTablePropsRef.current.loadingOverlay?.message).toBe('Updating pods…');
  });

  it('omits delete context action when permission data is unavailable', async () => {
    useUserPermissionsMock.mockReturnValue(new Map());
    await renderPods();

    const items = gridTablePropsRef.current.getCustomContextMenuItems(
      gridTablePropsRef.current.data[0]
    );
    expect(items.find((item: any) => item.label === 'Delete')).toBeUndefined();
  });

  it('disables port forward in the context menu when the pod exposes no forwardable ports', async () => {
    await renderPods({
      data: [createPod({ name: 'no-ports', portForwardAvailable: false })],
    });

    const items = gridTablePropsRef.current.getCustomContextMenuItems(
      gridTablePropsRef.current.data[0]
    );
    const portForwardItem = items.find((item: any) => item.label?.includes('Port Forward'));
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
      gridTablePropsRef.current.data[0]
    );
    expect(pendingItems.find((item: any) => item.label === 'Delete')).toBeUndefined();

    useUserPermissionsMock.mockReturnValue(
      new Map([['Pod:delete:team-a', { allowed: false, pending: false }]])
    );
    await renderPods();
    const deniedItems = gridTablePropsRef.current.getCustomContextMenuItems(
      gridTablePropsRef.current.data[0]
    );
    expect(deniedItems.find((item: any) => item.label === 'Delete')).toBeUndefined();
  });

  it('exposes namespace column and prefixed keys when namespace visibility is enabled', async () => {
    const pods = await renderPods({ showNamespaceColumn: true });
    const columns = gridTablePropsRef.current.columns;
    expect(columns.find((col: any) => col.key === 'namespace')).toBeTruthy();
    const key = gridTablePropsRef.current.keyExtractor(pods[0]);
    expect(key).toBe('alpha:ctx|/v1/Pod/team-a/api');
  });

  it('derives metrics helper values for resource columns', async () => {
    await renderPods({
      metrics: {
        stale: true,
        lastError: 'cpu metrics unavailable',
        collectedAt: 1700001000,
        successCount: 1,
        failureCount: 0,
      },
    });

    const cpuColumn = gridTablePropsRef.current.columns.find((col: any) => col.key === 'cpu');
    expect(cpuColumn).toBeTruthy();
    const cpuElement = cpuColumn.render(gridTablePropsRef.current.data[0]);
    expect(React.isValidElement(cpuElement)).toBe(true);
    expect(cpuElement.props.metricsStale).toBe(true);
    expect(cpuElement.props.metricsError).toBe('cpu metrics unavailable');
    expect(cpuElement.props.metricsLastUpdated).toEqual(new Date(1700001000 * 1000));
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

  it('filters pods when the unhealthy toggle is enabled', async () => {
    const pods = [
      createPod({ name: 'healthy', status: 'Running', ready: '1/1', restarts: 0 }),
      createPod({
        name: 'pending',
        status: 'Pending',
        statusPresentation: 'warning',
        ready: '0/1',
        restarts: 0,
      }),
      createPod({
        name: 'failing',
        status: 'CrashLoopBackOff',
        statusPresentation: 'error',
        ready: '0/1',
        restarts: 2,
      }),
    ];

    await renderPods({ data: pods });

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[title="Show unhealthy pods (2/3)"]'
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    expect(gridTablePropsRef.current.data).toEqual(pods);

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    expect(gridTablePropsRef.current.data).toEqual([pods[1], pods[2]]);
    const activeToggle = container.querySelector<HTMLButtonElement>(
      'button[title="Show all pods"]'
    );
    expect(activeToggle).not.toBeNull();
    expect(activeToggle?.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      activeToggle?.click();
      await Promise.resolve();
    });
    expect(gridTablePropsRef.current.data).toEqual(pods);
  });

  it('uses backend statusPresentation for the unhealthy filter', async () => {
    const pods = [
      createPod({ name: 'healthy', status: 'Running', ready: '1/1', restarts: 0 }),
      createPod({
        name: 'frontend-mismatch-only',
        status: 'Pending',
        statusPresentation: 'ready',
        ready: '0/1',
        restarts: 5,
      }),
      createPod({
        name: 'pending',
        status: 'Running',
        statusPresentation: 'warning',
        ready: '1/1',
        restarts: 0,
      }),
    ];

    await renderPods({ data: pods });

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[title="Show unhealthy pods (1/3)"]'
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    expect(gridTablePropsRef.current.data).toEqual([pods[2]]);
  });

  it('enables the unhealthy filter when an event targets the namespace and cluster', async () => {
    const pods = [
      createPod({ name: 'healthy', status: 'Running', ready: '1/1', restarts: 0 }),
      createPod({
        name: 'pending',
        status: 'Pending',
        statusPresentation: 'warning',
        ready: '0/1',
        restarts: 0,
      }),
    ];

    await renderPods({ data: pods });

    await act(async () => {
      // Event must include clusterId to match the current cluster context.
      eventBus.emit('pods:show-unhealthy', { clusterId: 'alpha:ctx', scope: 'team-a' });
      // The filter is a backend predicate now → re-query; let it resolve.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.data).toEqual([pods[1]]);
  });

  it('enables the unhealthy filter when an event targets all namespaces', async () => {
    const pods = [
      createPod({ name: 'healthy', namespace: 'team-a', status: 'Running', ready: '1/1' }),
      createPod({
        name: 'pending',
        namespace: 'team-b',
        status: 'Pending',
        statusPresentation: 'warning',
        ready: '0/1',
      }),
    ];
    requestRefreshDomainStateMock.mockImplementation((request?: unknown) => {
      const { domain, scope = '' } = (request as { domain?: string; scope?: string }) ?? {};
      const rows = scope.includes('predicate.health=unhealthy') ? [pods[1]] : [];
      return Promise.resolve({
        status: 'executed',
        data: {
          status: 'ready',
          data: {
            rows: domain === 'pods-metrics' ? podMetricRows(pods) : rows,
            total: rows.length,
            totalIsExact: true,
            namespaces: ['team-a', 'team-b'],
            kinds: ['Pod'],
            facetsExact: true,
            metrics:
              domain === 'pods-metrics'
                ? { stale: false, successCount: 1, failureCount: 0 }
                : undefined,
          },
        },
      });
    });

    await renderPods({
      namespace: ALL_NAMESPACES_SCOPE,
      data: pods,
      showNamespaceColumn: true,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.data).toEqual([]);

    await act(async () => {
      eventBus.emit('pods:show-unhealthy', {
        clusterId: 'alpha:ctx',
        scope: ALL_NAMESPACES_SCOPE,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.data).toEqual([pods[1]]);
    expect(requestRefreshDomainStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'pods',
        scope: expect.stringContaining('predicate.health=unhealthy'),
      })
    );
  });

  it('filters restarted pods when a restart signal targets the namespace and cluster', async () => {
    const pods = [
      createPod({ name: 'healthy', status: 'Running', ready: '1/1', restarts: 0 }),
      createPod({ name: 'restarted', status: 'Running', ready: '1/1', restarts: 2 }),
      createPod({
        name: 'pending',
        status: 'Pending',
        statusPresentation: 'warning',
        ready: '0/1',
        restarts: 0,
      }),
    ];

    await renderPods({ data: pods });

    await act(async () => {
      eventBus.emit('pods:show-unhealthy', {
        clusterId: 'alpha:ctx',
        scope: 'team-a',
        filter: 'restarts',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.data).toEqual([pods[1]]);
  });

  it('filters not-ready pods when a not-ready signal targets the namespace and cluster', async () => {
    const pods = [
      createPod({ name: 'healthy', status: 'Running', ready: '1/1', restarts: 0 }),
      createPod({ name: 'not-ready', status: 'Running', ready: '0/1', restarts: 0 }),
      createPod({
        name: 'completed',
        status: 'Completed',
        statusState: 'Succeeded',
        statusPresentation: 'ready',
        ready: '0/1',
        restarts: 0,
      }),
      createPod({
        name: 'pending',
        status: 'Pending',
        statusPresentation: 'warning',
        ready: '0/1',
        restarts: 0,
      }),
    ];

    await renderPods({ data: pods });

    await act(async () => {
      eventBus.emit('pods:show-unhealthy', {
        clusterId: 'alpha:ctx',
        scope: 'team-a',
        filter: 'not-ready',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.data).toEqual([pods[1], pods[3]]);
  });

  it('ignores unhealthy filter events for other clusters', async () => {
    const pods = [
      createPod({ name: 'healthy', status: 'Running', ready: '1/1', restarts: 0 }),
      createPod({
        name: 'pending',
        status: 'Pending',
        statusPresentation: 'warning',
        ready: '0/1',
        restarts: 0,
      }),
    ];

    await renderPods({ data: pods });

    act(() => {
      // Event for a different cluster should be ignored.
      eventBus.emit('pods:show-unhealthy', { clusterId: 'other-cluster', scope: 'team-a' });
    });

    // Should still show all pods since the event was for a different cluster.
    expect(gridTablePropsRef.current.data).toEqual(pods);
  });

  it('applies pending unhealthy filter requests from session storage', async () => {
    // Use the cluster-specific storage key.
    const storageKey = getPodsUnhealthyStorageKey('alpha:ctx');
    window.sessionStorage.setItem(storageKey, 'team-a');
    const pods = [
      createPod({ name: 'healthy', status: 'Running', ready: '1/1', restarts: 0 }),
      createPod({
        name: 'failing',
        status: 'CrashLoopBackOff',
        statusPresentation: 'error',
        ready: '0/1',
        restarts: 5,
      }),
    ];

    await renderPods({ data: pods });

    expect(gridTablePropsRef.current.data).toEqual([pods[1]]);
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('keeps the unhealthy toggle visible while active when no unhealthy pods remain', async () => {
    const pods = [
      createPod({ name: 'healthy', status: 'Running', ready: '1/1' }),
      createPod({
        name: 'pending',
        status: 'Pending',
        statusPresentation: 'warning',
        ready: '0/1',
      }),
    ];

    await renderPods({ data: pods });

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[title="Show unhealthy pods (1/2)"]'
    );
    expect(toggle).not.toBeNull();

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    expect(gridTablePropsRef.current.data).toEqual([pods[1]]);

    await renderPods({
      data: [
        createPod({ name: 'healthy', status: 'Running', ready: '1/1' }),
        createPod({
          name: 'recovered',
          status: 'Running',
          statusPresentation: 'ready',
          ready: '1/1',
        }),
      ],
    });

    // The toggle stays active and visible even though the live snapshot now has no unhealthy
    // pods — its count comes from the live snapshot, while the filtered table is query-backed.
    const activeToggle = container.querySelector<HTMLButtonElement>(
      'button[title="Show all pods"]'
    );
    expect(activeToggle).not.toBeNull();
    expect(activeToggle?.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      activeToggle?.click();
      await Promise.resolve();
    });
    expect(gridTablePropsRef.current.data.map((pod: PodSnapshotEntry) => pod.name)).toEqual([
      'healthy',
      'recovered',
    ]);
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
