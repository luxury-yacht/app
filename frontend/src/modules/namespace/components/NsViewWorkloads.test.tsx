/**
 * frontend/src/modules/namespace/components/NsViewWorkloads.test.tsx
 *
 * Test suite for NsViewWorkloads.
 * Covers key behaviors and edge cases for NsViewWorkloads.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';

const { useTableSortMock, requestRefreshDomainStateMock } = vi.hoisted(() => ({
  useTableSortMock: vi.fn(
    (data: unknown[], _defaultKey?: string, _defaultDir?: any, opts?: any) => ({
      sortedData: data,
      sortConfig: opts?.controlledSort ?? { key: '', direction: null },
      handleSort: vi.fn(),
    })
  ),
  requestRefreshDomainStateMock: vi.fn(),
}));

vi.mock('@modules/namespace/components/useNamespaceColumnLink', () => ({
  useNamespaceColumnLink: () => ({
    onClick: vi.fn(),
    getClassName: () => 'object-panel-link',
    isInteractive: () => true,
  }),
}));

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
const navigateToViewMock = vi.fn();
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

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null;
    scopedDomainCallsRef.current = [];
    openWithObjectMock.mockReset();
    navigateToViewMock.mockReset();
    useTableSortMock.mockClear();
    requestRefreshDomainStateMock.mockReset();
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

    expect(gridTablePropsRef.current?.data).toEqual([
      { ...workload, cpuUsage: '-', memUsage: '-' },
    ]);
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

    expect(gridTablePropsRef.current?.data).toEqual([
      { ...queryWorkload, cpuUsage: '-', memUsage: '-' },
    ]);
    expect(gridTablePropsRef.current?.paginationControls?.props).toMatchObject({
      pageIndex: 1,
      pageSize: 50,
      totalCount: 1,
      totalIsExact: true,
      hasPrevious: false,
      hasNext: false,
    });
    expect(requestRefreshDomainStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'namespace-workloads',
        scope: 'path:context|namespace:all?limit=50&sort=name&sortDirection=asc',
      })
    );
  });

  it('overlays all-namespaces workload rows with namespace-workloads-metrics rows', async () => {
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
    };
    requestRefreshDomainStateMock.mockImplementation(({ domain }: { domain: string }) =>
      Promise.resolve({
        status: 'executed',
        data: {
          status: 'ready',
          data:
            domain === 'namespace-workloads-metrics'
              ? {
                  rows: [
                    {
                      rowKey: 'deployment/team-b/api',
                      kind: 'Deployment',
                      namespace: 'team-b',
                      name: 'api',
                      ready: '1/1',
                      cpuUsage: '250m',
                      memUsage: '128Mi',
                    },
                  ],
                  total: 1,
                  totalIsExact: true,
                  namespaces: ['team-b'],
                  kinds: ['Deployment'],
                  facetsExact: true,
                  metrics: { stale: false, collectedAt: 1_700_000_000 },
                }
              : {
                  rows: [queryWorkload],
                  total: 1,
                  totalIsExact: true,
                  namespaces: ['team-b'],
                  kinds: ['Deployment'],
                  facetsExact: true,
                },
        },
      })
    );

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

    expect(gridTablePropsRef.current?.data).toEqual([
      { ...queryWorkload, ready: '1/1', cpuUsage: '250m', memUsage: '128Mi' },
    ]);
    expect(requestRefreshDomainStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'namespace-workloads-metrics',
        scope: expect.stringContaining('namespace:all?'),
      })
    );
    expect(requestRefreshDomainStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'namespace-workloads-metrics',
        scope: expect.stringContaining('predicate.rowKeys=deployment%2Fteam-b%2Fapi'),
      })
    );
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

    expect(scopedDomainCallsRef.current).toContainEqual([
      'namespace-workloads-metrics',
      'path:context|namespace:team-a',
    ]);
    expect(scopedDomainCallsRef.current).not.toContainEqual([
      'namespace-workloads-metrics',
      'clusters=path:context,other:context|namespace:team-a',
    ]);
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
    const workload = {
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      clusterId: 'alpha:ctx',
    } as any;

    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
    });

    const options = useTableSortMock.mock.calls[0]?.[3];
    expect(options?.rowIdentity).toBeTypeOf('function');
    expect(options.rowIdentity(workload, 0)).toBe('alpha:ctx|apps/v1/Deployment/team-a/api');
  });

  it('passes numeric Ready, CPU, and memory sort values into useTableSort', async () => {
    const workload = {
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
    } as any;

    await act(async () => {
      root.render(<NsViewWorkloads namespace="team-a" metrics={null} />);
      await Promise.resolve();
    });

    const options = useTableSortMock.mock.calls[0]?.[3];
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
    const nameColumn = props.columns.find((column: any) => column.key === 'name');
    const cell = nameColumn.render(props.data[0]);

    // Use the name column click handler to verify object panel routing.
    act(() => {
      cell.props.onClick?.({ stopPropagation: () => {} });
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
      gridTablePropsRef.current.data[0]
    );
    const portForwardItem = items.find((item: any) => item.label?.includes('Port Forward'));
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
      const menuItems = props.getCustomContextMenuItems(cronjob);

      const triggerItem = menuItems.find((item: any) => item.label === 'Trigger Now');
      const suspendItem = menuItems.find((item: any) => item.label === 'Suspend');

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
      const menuItems = props.getCustomContextMenuItems(suspendedCronjob);

      const resumeItem = menuItems.find((item: any) => item.label === 'Resume');
      const suspendItem = menuItems.find((item: any) => item.label === 'Suspend');

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
      const menuItems = props.getCustomContextMenuItems(suspendedCronjob);

      const triggerItem = menuItems.find((item: any) => item.label === 'Trigger Now');
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
      const menuItems = props.getCustomContextMenuItems(deployment);

      const triggerItem = menuItems.find((item: any) => item.label === 'Trigger Now');
      const suspendItem = menuItems.find((item: any) => item.label === 'Suspend');

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
        const menuItems = props.getCustomContextMenuItems(workload);
        const scaleItem = menuItems.find((item: any) => item.label === 'Scale');
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
        const menuItems = props.getCustomContextMenuItems(workload);
        const scaleItem = menuItems.find((item: any) => item.label === 'Scale');
        expect(scaleItem).toBeDefined();
      }
    });
  });
});
