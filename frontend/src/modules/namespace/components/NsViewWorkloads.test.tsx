/**
 * frontend/src/modules/namespace/components/NsViewWorkloads.test.tsx
 *
 * Test suite for NsViewWorkloads.
 * Covers key behaviors and edge cases for NsViewWorkloads.
 */

import type { WorkloadData } from '@modules/namespace/components/NsViewWorkloads.helpers';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseTableSortOptions } from '@/hooks/useTableSort';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';

type CapturedGridTableProps = GridTableProps<WorkloadData> & {
  getCustomContextMenuItems: NonNullable<GridTableProps<WorkloadData>['getCustomContextMenuItems']>;
  paginationControls?: React.ReactElement<Record<string, unknown>>;
};

const { useTableSortMock, requestRefreshDomainStateMock } = vi.hoisted(() => ({
  useTableSortMock: vi.fn(
    (
      data: WorkloadData[],
      _defaultKey?: string,
      _defaultDir?: unknown,
      opts?: UseTableSortOptions<WorkloadData>
    ) => ({
      sortedData: data,
      sortConfig: opts?.controlledSort ?? { key: '', direction: null },
      handleSort: vi.fn(),
    })
  ),
  requestRefreshDomainStateMock: vi.fn(),
}));

const podsViewPropsRef = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const namespaceClusterIdRef = vi.hoisted(() => ({ current: 'path:context' }));

vi.mock('@modules/namespace/components/NsViewPods', () => ({
  default: (props: Record<string, unknown>) => {
    podsViewPropsRef.current = props;
    return <div data-testid="pods-view" />;
  },
}));

vi.mock('@modules/namespace/components/useNamespaceColumnLink', () => ({
  useNamespaceColumnLink: () => ({
    onClick: vi.fn(),
    getClassName: () => 'object-panel-link',
    isInteractive: () => true,
  }),
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@modules/namespace/contexts/NamespaceContext')>();
  return {
    ...actual,
    useNamespace: () => ({ selectedNamespaceClusterId: namespaceClusterIdRef.current }),
  };
});

import NsViewWorkloads from '@modules/namespace/components/NsViewWorkloads';

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
  FavoritePaneGroup: ({ children }: { children: React.ReactNode }) => children,
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
const openWithObjectMock = vi.fn();
const navigateToViewMock = vi.fn();
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
  useNavigateToView: () => ({ navigateToView: navigateToViewMock }),
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
  useTableSort: (
    data: WorkloadData[],
    defaultKey?: string,
    defaultDirection?: unknown,
    options?: UseTableSortOptions<WorkloadData>
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

vi.mock('@modules/namespace/hooks/useNamespaceGridTablePersistence', () => ({
  useNamespaceGridTablePersistence: vi.fn(() => ({
    sortConfig: { key: 'name', direction: 'asc' },
    onSortChange: vi.fn(),
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
    isNamespaceScoped: true,
  })),
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
}));

vi.mock('@/core/data-access', () => ({
  requestRefreshDomainState: (...args: unknown[]) => requestRefreshDomainStateMock(...args),
  useScopedRefreshDomainLifecycle: vi.fn(),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  RunObjectAction: vi.fn().mockResolvedValue({ name: 'job-123' }),
}));

vi.mock('@/core/capabilities', () => ({
  getPermissionKey: (kind: string, verb: string, ns?: string, subresource?: string) => {
    const suffix = subresource ? `:${subresource}` : '';
    return `${kind}:${verb}:${ns || ''}${suffix}`;
  },
  useUserPermissions: () => {
    // Return permissions allowing all actions for testing
    const map = new Map();
    map.set('Job:create:default', { allowed: true, pending: false });
    map.set('CronJob:patch:default', { allowed: true, pending: false });
    map.set('Deployment:patch:default', { allowed: true, pending: false });
    map.set('Deployment:delete:default', { allowed: true, pending: false });
    map.set('Deployment:update:default:scale', { allowed: true, pending: false });
    map.set('Pod:create:default:portforward', { allowed: true, pending: false });
    map.set('StatefulSet:update:default:scale', { allowed: true, pending: false });
    map.set('ReplicaSet:update:default:scale', { allowed: true, pending: false });
    return map;
  },
}));

describe('NsViewWorkloads', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null as unknown as CapturedGridTableProps;
    scopedDomainCallsRef.current = [];
    openWithObjectMock.mockReset();
    navigateToViewMock.mockReset();
    useTableSortMock.mockClear();
    requestRefreshDomainStateMock.mockReset();
    podsViewPropsRef.current = null;
    namespaceClusterIdRef.current = 'path:context';
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [],
          total: 0,
          totalIsExact: true,
          namespaces: ['team-a', 'team-b'],
          kinds: ['Deployment'],
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
  });

  it('passes persisted state to GridTable', async () => {
    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
    });

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

  it('queries the cluster bound to the namespace selection when it differs from the active tab', async () => {
    namespaceClusterIdRef.current = 'namespace:context';

    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requestRefreshDomainStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'namespace:context|namespace:team-a?limit=50&sort=name&sortDirection=asc',
      })
    );
  });

  it('selects a workload row by populating the Pods table filters without opening the object', async () => {
    const workload: WorkloadData = {
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      status: 'Running',
      clusterId: 'path:context',
      clusterName: 'ctx',
    };
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [workload],
          total: 1,
          totalIsExact: true,
          namespaces: ['team-a'],
          kinds: ['Deployment'],
          facetsExact: true,
        },
      },
    });

    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => gridTablePropsRef.current.onRowPointerClick?.(workload));

    expect(openWithObjectMock).not.toHaveBeenCalled();
    expect(podsViewPropsRef.current).toMatchObject({
      namespace: 'team-a',
      workloadFilterRequest: {
        type: 'set',
        workload: {
          clusterId: 'path:context',
          group: 'apps',
          version: 'v1',
          kind: 'Deployment',
          namespace: 'team-a',
          name: 'api',
        },
      },
    });
    expect(gridTablePropsRef.current.getRowClassName?.(workload, 0)).toContain(
      'gridtable-row--selected'
    );

    act(() => {
      const onWorkloadFilterMismatch = podsViewPropsRef.current?.onWorkloadFilterMismatch;
      if (typeof onWorkloadFilterMismatch !== 'function') {
        throw new Error('Expected the Pods filter mismatch callback');
      }
      onWorkloadFilterMismatch();
    });
    expect(podsViewPropsRef.current?.workloadFilterRequest).toBeUndefined();
    expect(gridTablePropsRef.current.getRowClassName?.(workload, 0)).not.toContain(
      'gridtable-row--selected'
    );

    act(() => gridTablePropsRef.current.onRowPointerClick?.(workload));

    const structuralActions = (
      gridTablePropsRef.current.filters?.options as
        | { beforeNamespaceActions?: Array<{ title: string; onClick: () => void }> }
        | undefined
    )?.beforeNamespaceActions;
    const clearAction = structuralActions?.find(
      (action) => action.title === 'Clear selected workload'
    );
    expect(clearAction).toBeTruthy();
    act(() => clearAction?.onClick());
    expect(podsViewPropsRef.current).toMatchObject({
      namespace: 'team-a',
      workloadFilterRequest: { type: 'clear' },
    });
    expect(gridTablePropsRef.current.getRowClassName?.(workload, 0)).not.toContain(
      'gridtable-row--selected'
    );

    act(() => gridTablePropsRef.current.onRowPointerClick?.(workload));
    expect(
      gridTablePropsRef.current.filters?.options?.beforeNamespaceActions?.find(
        (action) => action.type !== 'separator' && action.title === 'Collapse Pods'
      )
    ).toBeUndefined();
    expect(podsViewPropsRef.current).toMatchObject({
      collapsed: false,
      onPodsCollapsedChange: expect.any(Function),
    });
    act(() => {
      const onPodsCollapsedChange = podsViewPropsRef.current?.onPodsCollapsedChange;
      if (typeof onPodsCollapsedChange !== 'function') {
        throw new Error('Expected the Pods collapse callback');
      }
      onPodsCollapsedChange(true);
    });
    expect(podsViewPropsRef.current).toMatchObject({ collapsed: true });
    act(() => gridTablePropsRef.current.onRowPointerClick?.(workload));
    expect(podsViewPropsRef.current).toMatchObject({ collapsed: false });
  });

  it('clears a workload-owned Pods filter when the namespace scope changes', async () => {
    const workload: WorkloadData = {
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      status: 'Running',
      clusterId: 'path:context',
      clusterName: 'ctx',
    };
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [workload],
          total: 1,
          totalIsExact: true,
          namespaces: ['team-a'],
          kinds: ['Deployment'],
          facetsExact: true,
        },
      },
    });

    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => gridTablePropsRef.current.onRowPointerClick?.(workload));
    expect(podsViewPropsRef.current?.workloadFilterRequest).toMatchObject({ type: 'set' });

    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-b" metrics={null} />);
      await Promise.resolve();
    });

    expect(podsViewPropsRef.current).toMatchObject({
      namespace: 'team-b',
      workloadFilterRequest: { type: 'clear' },
    });

    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
    });

    expect(podsViewPropsRef.current?.workloadFilterRequest).toEqual({ type: 'clear' });
  });

  it('issues a namespace-scoped typed query for a single namespace and renders the query rows', async () => {
    const workload = {
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      status: 'Running',
      ready: '1/1',
      restarts: 0,
      age: '5m',
      clusterId: 'alpha:ctx',
      clusterName: 'alpha',
    };

    // Single-namespace workload tables are query-backed now (not local-complete): the table
    // renders the typed query rows scoped to the namespace, not the local `data` prop. Feed the
    // query the same rows so the table shows them.
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [workload],
          total: 1,
          totalIsExact: true,
          namespaces: ['team-a'],
          kinds: ['Deployment'],
          facetsExact: true,
        },
      },
    });

    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current?.data).toEqual([workload]);
    expect(requestRefreshDomainStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'namespace-workloads',
        scope: 'path:context|namespace:team-a?limit=50&sort=name&sortDirection=asc',
        // The label feeds user-facing error copy ("<label> returned no data");
        // a single namespace must not claim "All Namespaces".
        label: 'Namespace Workloads',
      })
    );
  });

  it('omits the advertised workload Status query facet', async () => {
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [],
          total: 0,
          totalIsExact: true,
          namespaces: ['team-a'],
          kinds: ['Deployment'],
          facetValues: [
            {
              key: 'statuses',
              options: [
                { value: 'Degraded', label: 'Degraded' },
                { value: 'Running', label: 'Running' },
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
            ],
          },
        },
      },
    });

    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.filters?.options?.queryFacets).toBeUndefined();
  });

  it('uses the typed query result for all-namespaces workloads on first render', async () => {
    const localWorkload = {
      kind: 'Deployment',
      name: 'local-provider-row',
      namespace: 'team-a',
      status: 'Running',
      ready: '1/1',
      restarts: 0,
      age: '5m',
      clusterId: 'alpha:ctx',
      clusterName: 'alpha',
    };
    const queryWorkload = {
      ...localWorkload,
      name: 'query-row',
      namespace: 'team-b',
    };
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [queryWorkload],
          total: 1,
          totalIsExact: true,
          namespaces: ['team-a', 'team-b'],
          kinds: ['Deployment'],
          facetsExact: true,
        },
      },
    });

    await act(async () => {
      root.render(
        <NsViewWorkloads
          namespace={ALL_NAMESPACES_SCOPE}
          showNamespaceColumn={true}
          metrics={null}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current?.data).toEqual([queryWorkload]);
    expect(gridTablePropsRef.current?.paginationControls).toBeNull();
    expect(requestRefreshDomainStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'namespace-workloads',
        scope: 'path:context|namespace:all?limit=50&sort=name&sortDirection=asc',
      })
    );
  });

  it('renders all-namespaces workload rows with usage joined at serve by the single base query', async () => {
    const queryWorkload = {
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-b',
      status: 'Running',
      ready: '1/1',
      restarts: 0,
      age: '5m',
      clusterId: 'path:context',
      clusterName: 'ctx',
      cpuUsage: '250m',
      memUsage: '128Mi',
    };
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [queryWorkload],
          total: 1,
          totalIsExact: true,
          namespaces: ['team-b'],
          kinds: ['Deployment'],
          facetsExact: true,
          metrics: { stale: false, collectedAt: 1_700_000_000 },
        },
      },
    });

    await act(async () => {
      root.render(
        <NsViewWorkloads
          namespace={ALL_NAMESPACES_SCOPE}
          showNamespaceColumn={true}
          metrics={null}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current?.data).toEqual([queryWorkload]);
    // Exactly one domain serves the table: no metric-domain query and no
    // rowKeys hydration leg ride alongside the base query.
    const queriedRequests = requestRefreshDomainStateMock.mock.calls.map(
      (call) => call[0] as { domain?: string; scope?: string } | undefined
    );
    expect(new Set(queriedRequests.map((request) => request?.domain))).toEqual(
      new Set(['namespace-workloads'])
    );
    expect(
      queriedRequests.some((request) => (request?.scope ?? '').includes('predicate.rowKeys='))
    ).toBe(false);
  });

  it('renders the backend-published kind vocabulary even when facets collapse to the selection', async () => {
    // The Kinds dropdown options are the family's capabilities-published
    // vocabulary. Facets collapse to the active selection by design; selecting
    // a kind must never remove the other options.
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [],
          total: 0,
          totalIsExact: true,
          namespaces: ['team-a'],
          kinds: ['Deployment'],
          facetsExact: true,
          capabilities: {
            kindVocabulary: ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'],
          },
        },
      },
    });

    await act(async () => {
      root.render(
        <NsViewWorkloads
          namespace={ALL_NAMESPACES_SCOPE}
          showNamespaceColumn={true}
          metrics={null}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current?.filters?.options?.kinds).toEqual([
      'Pod',
      'Deployment',
      'StatefulSet',
      'DaemonSet',
      'Job',
      'CronJob',
    ]);
  });

  it('renders a settled-empty query on remount without retaining stale rows (dynamic table)', async () => {
    // The second dynamic query-backed table covered by the remount lifecycle
    // regression (Nodes is the first). The controller trusts a settled query, so
    // a definitive empty result on remount renders empty rather than resurrecting
    // stale rows; the transient empty-while-loading protection lives in the
    // controller (see useResourceInventoryTable / backendQuerySource tests).
    const queryRow = {
      kind: 'Deployment',
      name: 'web',
      namespace: 'team-a',
      status: 'Running',
      ready: '1/1',
      restarts: 0,
      age: '1h',
      clusterId: 'path:context',
      clusterName: 'ctx',
    };
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [queryRow],
          total: 1,
          totalIsExact: true,
          namespaces: ['team-a'],
          kinds: ['Deployment'],
          facetsExact: true,
        },
      },
    });

    await act(async () => {
      root.render(<NsViewWorkloads namespace={ALL_NAMESPACES_SCOPE} metrics={null} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(gridTablePropsRef.current?.data).toHaveLength(1);

    // Remount with the query now settling empty.
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [],
          total: 0,
          totalIsExact: true,
          namespaces: [],
          kinds: [],
          facetsExact: true,
        },
      },
    });
    act(() => {
      root.unmount();
    });
    root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(<NsViewWorkloads namespace={ALL_NAMESPACES_SCOPE} metrics={null} />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(gridTablePropsRef.current?.data).toEqual([]);
  });

  it('resolves workload metrics from the active namespace cluster scope only', async () => {
    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
    });

    // Metrics ride the namespace-workloads domain now; the lease must stay
    // pinned to the active cluster scope.
    expect(scopedDomainCallsRef.current).toContainEqual([
      'namespace-workloads',
      'path:context|namespace:team-a',
    ]);
    expect(scopedDomainCallsRef.current).not.toContainEqual([
      'namespace-workloads',
      'clusters=path:context,other:context|namespace:team-a',
    ]);
  });

  it('keeps metrics availability out of the Workloads table surface', async () => {
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [],
          total: 0,
          totalIsExact: true,
          namespaces: ['team-a'],
          kinds: ['Deployment'],
          facetsExact: true,
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

    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('.metrics-warning-banner')).toBeNull();
  });

  it('preserves the column definitions across rerenders with unchanged inputs', async () => {
    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
    });

    const firstColumnsRef = gridTablePropsRef.current?.columns;

    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current?.columns).toBe(firstColumnsRef);
  });

  it('passes rowIdentity into useTableSort for workload reuse', async () => {
    const workload: WorkloadData = {
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      clusterId: 'alpha:ctx',
      status: 'Running',
    };

    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
    });

    const options = requireValue(
      useTableSortMock.mock.calls[0]?.[3],
      'expected workload table sort options'
    );
    const rowIdentity = requireValue(options.rowIdentity, 'expected workload table row identity');
    expect(rowIdentity(workload, 0)).toBe('alpha:ctx|apps/v1/Deployment/team-a/api');
  });

  it('passes numeric Ready, CPU, and memory sort values into useTableSort', async () => {
    const workload: WorkloadData = {
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      status: 'Running',
      ready: '1/1',
      restarts: 0,
      cpuUsage: '10m',
      memUsage: '20Mi',
      clusterId: 'alpha:ctx',
      clusterName: 'alpha',
    };

    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
    });

    const options = requireValue(
      useTableSortMock.mock.calls[0]?.[3],
      'expected workload table sort options'
    );
    const columns = options.columns as Array<{
      key: string;
      sortValue?: (item: typeof workload) => unknown;
    }>;
    const readyColumn = columns.find((column) => column.key === 'ready');
    const cpuColumn = columns.find((column) => column.key === 'cpu');
    const memoryColumn = columns.find((column) => column.key === 'memory');

    expect(readyColumn?.sortValue?.({ ...workload, ready: '2/10' })).toBe(2000010);
    expect(cpuColumn?.sortValue?.(workload)).toBe(10);
    expect(memoryColumn?.sortValue?.(workload)).toBe(20);
  });

  it('routes workload clicks through the object panel with cluster metadata', async () => {
    const workload = {
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      status: 'Running',
      ready: '1/1',
      restarts: 0,
      cpuUsage: '10m',
      memUsage: '20Mi',
      age: '5m',
      clusterId: 'alpha:ctx',
      clusterName: 'alpha',
    };

    // Query-backed single-namespace table: feed the typed query the row so it renders in the table.
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [workload],
          total: 1,
          totalIsExact: true,
          namespaces: ['team-a'],
          kinds: ['Deployment'],
          facetsExact: true,
        },
      },
    });

    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    const nameColumn = requireValue(
      props.columns.find((column) => column.key === 'name'),
      'expected the workload name column'
    );
    const cell = requireReactElement<{
      onClick?: (event: { stopPropagation: () => void }) => void;
    }>(nameColumn.render(props.data[0]), 'expected the workload name cell element');

    // Use the name column click handler to verify object panel routing.
    act(() => {
      cell.props.onClick?.({ stopPropagation: () => undefined });
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Deployment',
        name: 'api',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
        clusterName: 'alpha',
      })
    );
  });

  it('disables port forward in the context menu when the workload exposes no forwardable ports', async () => {
    const workload = {
      kind: 'Deployment',
      name: 'api',
      namespace: 'default',
      status: 'Running',
      ready: '1/1',
      restarts: 0,
      age: '5m',
      portForwardAvailable: false,
      clusterId: 'test:ctx',
      clusterName: 'test',
    };

    // Query-backed single-namespace table: feed the typed query the row so it renders in the table.
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          rows: [workload],
          total: 1,
          totalIsExact: true,
          namespaces: ['default'],
          kinds: ['Deployment'],
          facetsExact: true,
        },
      },
    });

    await act(async () => {
      root.render(<NsViewWorkloads namespace="default" metrics={null} />);
      await Promise.resolve();
      await Promise.resolve();
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

  describe('CronJob context menu', () => {
    const cronjob = {
      kind: 'CronJob',
      name: 'backup',
      namespace: 'default',
      status: 'Idle',
      ready: '0',
      restarts: 0,
      age: '5m',
      clusterId: 'test:ctx',
      clusterName: 'test',
    };

    it('includes Trigger Now and Suspend items for CronJob', async () => {
      await act(async () => {
        root.render(<NsViewWorkloads namespace="default" metrics={null} />);
        await Promise.resolve();
      });

      const props = gridTablePropsRef.current;
      const menuItems = props.getCustomContextMenuItems(cronjob, 'name');

      const triggerItem = menuItems.find((item) => item.label === 'Trigger Now');
      const suspendItem = menuItems.find((item) => item.label === 'Suspend');

      expect(triggerItem).toBeDefined();
      expect(suspendItem).toBeDefined();
    });

    it('shows Resume instead of Suspend when CronJob is suspended', async () => {
      const suspendedCronjob = { ...cronjob, status: 'Suspended' };

      await act(async () => {
        root.render(<NsViewWorkloads namespace="default" metrics={null} />);
        await Promise.resolve();
      });

      const props = gridTablePropsRef.current;
      const menuItems = props.getCustomContextMenuItems(suspendedCronjob, 'name');

      const resumeItem = menuItems.find((item) => item.label === 'Resume');
      const suspendItem = menuItems.find((item) => item.label === 'Suspend');

      expect(resumeItem).toBeDefined();
      expect(suspendItem).toBeUndefined();
    });

    it('disables Trigger Now when CronJob is suspended', async () => {
      const suspendedCronjob = { ...cronjob, status: 'Suspended' };

      await act(async () => {
        root.render(<NsViewWorkloads namespace="default" metrics={null} />);
        await Promise.resolve();
      });

      const props = gridTablePropsRef.current;
      const menuItems = props.getCustomContextMenuItems(suspendedCronjob, 'name');

      const triggerItem = menuItems.find((item) => item.label === 'Trigger Now');
      expect(triggerItem?.disabled).toBe(true);
    });

    it('does not include CronJob actions for Deployments', async () => {
      const deployment = {
        kind: 'Deployment',
        name: 'api',
        namespace: 'default',
        status: 'Running',
        ready: '1/1',
        restarts: 0,
        age: '5m',
        clusterId: 'test:ctx',
        clusterName: 'test',
      };

      await act(async () => {
        root.render(<NsViewWorkloads namespace="default" metrics={null} />);
        await Promise.resolve();
      });

      const props = gridTablePropsRef.current;
      const menuItems = props.getCustomContextMenuItems(deployment, 'name');

      const triggerItem = menuItems.find((item) => item.label === 'Trigger Now');
      const suspendItem = menuItems.find((item) => item.label === 'Suspend');

      expect(triggerItem).toBeUndefined();
      expect(suspendItem).toBeUndefined();
    });

    it('does not include Scale for CronJobs, Jobs, or DaemonSets', async () => {
      const workloads = [
        { kind: 'CronJob', name: 'backup', namespace: 'default', status: 'Idle' },
        { kind: 'Job', name: 'migrate', namespace: 'default', status: 'Running' },
        { kind: 'DaemonSet', name: 'agent', namespace: 'default', status: 'Running' },
      ];

      await act(async () => {
        root.render(<NsViewWorkloads namespace="default" metrics={null} />);
        await Promise.resolve();
      });

      const props = gridTablePropsRef.current;

      for (const workload of workloads) {
        const menuItems = props.getCustomContextMenuItems(workload as WorkloadData, 'name');
        const scaleItem = menuItems.find((item) => item.label === 'Scale');
        expect(scaleItem).toBeUndefined();
      }
    });

    it('includes Scale for Deployments and StatefulSets', async () => {
      const workloads = [
        {
          kind: 'Deployment',
          name: 'api',
          namespace: 'default',
          status: 'Running',
          hpaManaged: false,
        },
        {
          kind: 'StatefulSet',
          name: 'db',
          namespace: 'default',
          status: 'Running',
          hpaManaged: false,
        },
      ];

      await act(async () => {
        root.render(<NsViewWorkloads namespace="default" metrics={null} />);
        await Promise.resolve();
      });

      const props = gridTablePropsRef.current;

      for (const workload of workloads) {
        const menuItems = props.getCustomContextMenuItems(workload as WorkloadData, 'name');
        const scaleItem = menuItems.find((item) => item.label === 'Scale');
        expect(scaleItem).toBeDefined();
      }
    });
  });
});
