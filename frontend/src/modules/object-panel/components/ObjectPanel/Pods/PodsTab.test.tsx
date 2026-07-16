/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.test.tsx
 *
 * The object-panel Pods tab is query-backed: it issues a workload/node-scoped
 * typed pods query (gated to the active tab) and renders the returned page,
 * using the panel-scoped clusterId — never the global sidebar selection.
 */

import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import { getTextContent } from '@shared/components/tables/GridTable.utils';
import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PodSnapshotEntry } from '@/core/refresh/types';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';

const {
  gridTablePropsRef,
  mockOpenWithObject,
  objectPanelRef,
  navigateToViewMock,
  useTableSortMock,
  requestRefreshDomainStateMock,
  useGridTablePersistenceMock,
  queryNamespacesPermissionsMock,
  POD_PERMISSIONS_SENTINEL,
} = vi.hoisted(() => ({
  gridTablePropsRef: { current: null as GridTableProps<PodSnapshotEntry> | null },
  mockOpenWithObject: vi.fn(),
  objectPanelRef: { current: null as unknown },
  navigateToViewMock: vi.fn(),
  useTableSortMock: vi.fn(),
  requestRefreshDomainStateMock: vi.fn(),
  useGridTablePersistenceMock: vi.fn(),
  queryNamespacesPermissionsMock: vi.fn(),
  POD_PERMISSIONS_SENTINEL: { feature: 'namespace-pods', specs: [] },
}));

const PANEL_CLUSTER_ID = 'panel-cluster-A';
const SIDEBAR_CLUSTER_ID = 'sidebar-cluster-B';

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: mockOpenWithObject,
    objectData: objectPanelRef.current,
  }),
}));

// Provide a DIFFERENT global clusterId to prove PodsTab uses the panel scope, not this one.
vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: SIDEBAR_CLUSTER_ID,
    selectedClusterName: 'Sidebar Cluster B',
  }),
}));

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => ({
    onNamespaceSelect: vi.fn(),
    setActiveNamespaceTab: vi.fn(),
  }),
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  // The query-backed grid reads `namespaces` off this context via
  // useNamespaceFilterOptions, so it must be a real context.
  NamespaceContext: React.createContext({ namespaces: [] }),
  useNamespace: () => ({
    setSelectedNamespace: vi.fn(),
  }),
}));

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

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@shared/components/tables/GridTable', () => ({
  default: (props: GridTableProps<PodSnapshotEntry>) => {
    gridTablePropsRef.current = props;
    return (
      <table data-testid="grid-table">
        <tbody>
          {props.data.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
  GRIDTABLE_VIRTUALIZATION_DEFAULT: {},
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: navigateToViewMock }),
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (...args: unknown[]) => useTableSortMock(...args),
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: (...args: unknown[]) => useGridTablePersistenceMock(...args),
}));

vi.mock('@/core/data-access', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requestRefreshDomain: vi.fn().mockResolvedValue(undefined),
    requestRefreshDomainState: (...args: unknown[]) => requestRefreshDomainStateMock(...args),
    useScopedRefreshDomainLifecycle: vi.fn(),
  };
});

vi.mock('@/core/refresh', () => ({
  useRefreshScopedDomain: () => ({
    status: 'ready',
    data: { rows: [] },
    stats: null,
    version: 1,
    checksum: '',
    lastUpdated: 1,
    droppedAutoRefreshes: 0,
  }),
  refreshManager: { triggerManualRefresh: vi.fn() },
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  RunObjectAction: vi.fn(),
  FindCatalogObjectByUID: vi.fn(),
}));

vi.mock('@/core/capabilities', () => ({
  getPermissionKey: (kind: string, verb: string, ns?: string) => `${kind}:${verb}:${ns ?? ''}`,
  queryNamespacesPermissions: (...args: unknown[]) => queryNamespacesPermissionsMock(...args),
  POD_PERMISSIONS: POD_PERMISSIONS_SENTINEL,
  useUserPermissions: () => {
    // Grant every permission so menu assertions exercise handler wiring,
    // not permission state.
    const map = new Map();
    map.get = () => ({ allowed: true, pending: false });
    return map;
  },
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: { handle: vi.fn() },
}));

vi.mock('../shared.css', () => ({}));

import { PodsTab } from './PodsTab';

const getGridTableProps = () =>
  requireValue(gridTablePropsRef.current, 'expected captured GridTable props in PodsTab.test.tsx');

const getGridColumn = (key: string) =>
  requireValue(
    getGridTableProps().columns.find((column) => column.key === key),
    `expected ${key} column in PodsTab.test.tsx`
  );

const getContextMenuItems = (row: PodSnapshotEntry) =>
  requireValue(
    getGridTableProps().getCustomContextMenuItems,
    'expected context-menu factory in PodsTab.test.tsx'
  )(row, 'name');

const DEPLOYMENT_OBJECT_DATA = {
  clusterId: PANEL_CLUSTER_ID,
  clusterName: 'Panel Cluster A',
  group: 'apps',
  kind: 'Deployment',
  name: 'my-deploy',
  namespace: 'default',
  version: 'v1',
};

const NODE_OBJECT_DATA = {
  clusterId: PANEL_CLUSTER_ID,
  clusterName: 'Panel Cluster A',
  kind: 'Node',
  name: 'worker-a',
};

const createPod = (override: Partial<PodSnapshotEntry> = {}): PodSnapshotEntry =>
  ({
    name: 'api',
    namespace: 'team-a',
    clusterId: PANEL_CLUSTER_ID,
    clusterName: 'Panel Cluster A',
    ownerKind: 'Deployment',
    ownerName: 'api',
    node: 'node-a',
    status: 'Running',
    statusPresentation: 'ready',
    ready: '1/1',
    restarts: 0,
    age: '1m',
    ...override,
  }) as PodSnapshotEntry;

const mockQueryRows = (rows: PodSnapshotEntry[]) => {
  requestRefreshDomainStateMock.mockResolvedValue({
    status: 'executed',
    data: {
      status: 'ready',
      data: {
        rows,
        total: rows.length,
        totalIsExact: true,
        namespaces: ['team-a'],
        kinds: ['Pod'],
        facetsExact: true,
      },
    },
  });
};

describe('PodsTab (query-backed)', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null;
    objectPanelRef.current = DEPLOYMENT_OBJECT_DATA;
    mockOpenWithObject.mockReset();
    navigateToViewMock.mockReset();
    requestRefreshDomainStateMock.mockReset();
    useTableSortMock.mockReset();
    useGridTablePersistenceMock.mockReset();
    queryNamespacesPermissionsMock.mockReset();
    queryNamespacesPermissionsMock.mockResolvedValue(undefined);

    useTableSortMock.mockImplementation((data: unknown[]) => ({
      sortedData: data,
      sortConfig: { key: 'name', direction: 'asc' },
      handleSort: vi.fn(),
    }));
    useGridTablePersistenceMock.mockReturnValue({
      storageKey: 'gridtable:v1:object-panel-pods',
      sortConfig: { key: 'name', direction: 'asc' },
      setSortConfig: vi.fn(),
      columnWidths: null,
      setColumnWidths: vi.fn(),
      columnVisibility: null,
      setColumnVisibility: vi.fn(),
      filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
      setFilters: vi.fn(),
      pageSize: null,
      setPageSize: vi.fn(),
      resetState: vi.fn(),
      hydrated: true,
    });
    mockQueryRows([createPod()]);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderPods = async (props: Partial<React.ComponentProps<typeof PodsTab>> = {}) => {
    await act(async () => {
      root.render(<PodsTab isActive={true} {...props} />);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('issues a workload-scoped pods query and renders the returned page when active', async () => {
    mockQueryRows([createPod({ name: 'query-pod' })]);

    await renderPods();

    expect(requestRefreshDomainStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'pods',
        scope: expect.stringContaining('workload:default:apps:v1:Deployment:my-deploy'),
      })
    );
    expect(getGridTableProps().data.map((pod: PodSnapshotEntry) => pod.name)).toEqual([
      'query-pod',
    ]);
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
          facetValues: [
            {
              key: 'statuses',
              options: [{ value: 'Running', label: 'Running' }],
              exact: true,
            },
            {
              key: 'nodes',
              options: [{ value: 'node-a', label: 'node-a' }],
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
        },
      },
    });

    await renderPods();

    expect(getGridTableProps().filters?.options?.queryFacets).toEqual([
      expect.objectContaining({
        key: 'nodes',
        label: 'Node',
        options: [{ value: 'node-a', label: 'node-a' }],
      }),
    ]);
  });

  it('issues a node-scoped pods query for Node panels', async () => {
    objectPanelRef.current = NODE_OBJECT_DATA;
    mockQueryRows([createPod({ name: 'node-pod' })]);

    await renderPods();

    expect(requestRefreshDomainStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'pods',
        scope: expect.stringContaining('node:worker-a'),
      })
    );
    expect(getGridTableProps().data.map((pod: PodSnapshotEntry) => pod.name)).toEqual(['node-pod']);
  });

  it('does not issue a pods query when the tab is inactive', async () => {
    await renderPods({ isActive: false });

    expect(requestRefreshDomainStateMock).not.toHaveBeenCalled();
  });

  it('does not issue a workload-scoped pods query when the panel object omits group identity', async () => {
    objectPanelRef.current = {
      clusterId: PANEL_CLUSTER_ID,
      clusterName: 'Panel Cluster A',
      kind: 'Deployment',
      name: 'my-deploy',
      namespace: 'default',
      version: 'v1',
    };

    await renderPods();

    expect(requestRefreshDomainStateMock).not.toHaveBeenCalled();
  });

  it('passes the panel-scoped clusterId to persistence, not the global sidebar selection', async () => {
    await renderPods();

    expect(useGridTablePersistenceMock).toHaveBeenCalled();
    const calls = useGridTablePersistenceMock.mock.calls;
    const params = calls[calls.length - 1][0];
    expect(params.clusterIdentity).toBe(PANEL_CLUSTER_ID);
    expect(params.clusterIdentity).not.toBe(SIDEBAR_CLUSTER_ID);
  });

  it('uses canonical pod row keys scoped to the pod cluster', async () => {
    const pod = createPod({ name: 'api', namespace: 'team-a' });
    mockQueryRows([pod]);

    await renderPods();

    expect(getGridTableProps().keyExtractor(pod, 0)).toBe('panel-cluster-A|/v1/Pod/team-a/api');
  });

  it('uses backend statusPresentation for the pod status class', async () => {
    const pod = createPod({ statusPresentation: 'warning' });
    mockQueryRows([pod]);

    await renderPods();

    const podRow = requireValue(getGridTableProps().data[0], 'expected pod row');
    const cell = requireReactElement<{ className?: string }>(
      getGridColumn('status').render(podRow),
      'expected status cell element in PodsTab.test.tsx'
    );
    expect(cell.props.className).toBe('status-text warning');
  });

  it('renders zero pod restarts as no value without changing numeric sorting', async () => {
    const pods = [createPod(), createPod({ name: 'restarted', restarts: 2 })];
    mockQueryRows(pods);
    await renderPods();

    const column = getGridColumn('restarts');
    expect(getTextContent(column.render(pods[0]))).toBe('-');
    expect(getTextContent(column.render(pods[1]))).toBe('2');
    expect(column.sortValue?.(pods[0])).toBe(0);
    expect(column.sortValue?.(pods[1])).toBe(2);
  });

  it('opens the Map from the pod context menu using the pod identity', async () => {
    const pod = createPod({ name: 'api', namespace: 'team-a' });
    mockQueryRows([pod]);

    await renderPods();

    const podRow = requireValue(getGridTableProps().data[0], 'expected pod row');
    const objectMapItem = getContextMenuItems(podRow).find(
      (item) => item.actionId === OBJECT_ACTION_IDS.viewMap
    );
    expect(objectMapItem).toBeTruthy();

    act(() => {
      objectMapItem?.onClick?.();
    });

    expect(mockOpenWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
        clusterId: PANEL_CLUSTER_ID,
        group: '',
        version: 'v1',
      }),
      { initialTab: 'map' }
    );
  });

  it('shows enabled Port Forward and Delete in the pod row context menu when permitted', async () => {
    const pod = createPod({ name: 'api', namespace: 'team-a', portForwardAvailable: true });
    mockQueryRows([pod]);

    await renderPods();

    const podRow = requireValue(getGridTableProps().data[0], 'expected pod row');
    const items = getContextMenuItems(podRow);
    const portForwardItem = requireValue(
      items.find((item) => item.actionId === OBJECT_ACTION_IDS.portForward),
      'expected port-forward item in PodsTab.test.tsx'
    );
    const deleteItem = items.find((item) => item.actionId === OBJECT_ACTION_IDS.delete);

    expect(portForwardItem).toBeTruthy();
    expect(portForwardItem.disabled).toBeFalsy();
    expect(deleteItem).toBeTruthy();
  });

  it('shows Port Forward disabled when the pod has no forwardable ports', async () => {
    const pod = createPod({ name: 'api', namespace: 'team-a', portForwardAvailable: false });
    mockQueryRows([pod]);

    await renderPods();

    const podRow = requireValue(getGridTableProps().data[0], 'expected pod row');
    const portForwardItem = requireValue(
      getContextMenuItems(podRow).find((item) => item.actionId === OBJECT_ACTION_IDS.portForward),
      'expected port-forward item in PodsTab.test.tsx'
    );

    expect(portForwardItem).toBeTruthy();
    expect(portForwardItem.disabled).toBe(true);
  });

  it('queries pod permissions for the namespaces of visible pods using the pod cluster', async () => {
    const pod = createPod({ name: 'api', namespace: 'team-a' });
    mockQueryRows([pod]);

    await renderPods();

    expect(queryNamespacesPermissionsMock).toHaveBeenCalledWith(
      [{ namespace: 'team-a', clusterId: PANEL_CLUSTER_ID }],
      { specLists: [POD_PERMISSIONS_SENTINEL] }
    );
  });

  it('keeps metrics availability out of the object-panel Pods table surface', async () => {
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [createPod()],
          total: 1,
          totalIsExact: true,
          metrics: {
            stale: false,
            lastError: 'metrics api unavailable',
            collectedAt: 1700000000,
            successCount: 0,
            failureCount: 1,
          },
        },
      },
    });

    await renderPods();

    expect(container.querySelector('.metrics-warning-banner')).toBeNull();
  });
});
