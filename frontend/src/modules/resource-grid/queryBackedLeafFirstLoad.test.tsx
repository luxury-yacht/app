import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';

const { gridTablePropsRef, requestRefreshDomainStateMock } = vi.hoisted(() => ({
  gridTablePropsRef: { current: null as any },
  requestRefreshDomainStateMock: vi.fn(),
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
    type: 'toggle',
    id: 'favorite',
    icon: null,
    active: false,
    onClick: () => {},
    title: 'Save as favorite',
  }),
}));

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

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedKubeconfig: 'path:context',
    selectedClusterId: 'cluster-a',
    selectedClusterIds: ['cluster-a'],
  }),
}));

vi.mock('@/core/data-access', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requestRefreshDomain: vi.fn().mockResolvedValue(undefined),
    requestRefreshDomainState: (request: unknown) => requestRefreshDomainStateMock(request),
    useScopedRefreshDomainLifecycle: vi.fn(),
  };
});

vi.mock('@/core/refresh', () => ({
  useRefreshScopedDomain: () => ({
    data: { metrics: null, nodes: [] },
    status: 'idle',
    isManual: false,
  }),
  refreshManager: { triggerManualRefresh: vi.fn() },
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (data: unknown[], _defaultKey?: string, _defaultDir?: any, opts?: any) => ({
    sortedData: data,
    sortConfig: opts?.controlledSort ?? { key: 'name', direction: 'asc' },
    handleSort: vi.fn(),
  }),
}));

vi.mock('@modules/namespace/hooks/useNamespaceGridTablePersistence', () => ({
  useNamespaceGridTablePersistence: () => ({
    sortConfig: { key: 'name', direction: 'asc' },
    onSortChange: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
    setFilters: vi.fn(),
    isNamespaceScoped: true,
    resetState: vi.fn(),
  }),
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
    hydrated: true,
    storageKey: 'gridtable:v1:test',
  }),
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@modules/namespace/components/useNamespaceColumnLink', () => ({
  useNamespaceColumnLink: () => ({
    onClick: vi.fn(),
    getClassName: () => 'object-panel-link',
    isInteractive: () => true,
  }),
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: vi.fn() }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@shared/hooks/useObjectActionController', () => ({
  useObjectActionController: () => ({
    getMenuItems: () => [],
    modals: null,
  }),
}));

vi.mock('@shared/hooks/useNodeMaintenanceActions', () => ({
  useNodeMaintenanceActions: () => ({
    activeDrainFor: () => null,
    openDrainFor: vi.fn(),
    openCordonFor: vi.fn(),
    modals: null,
  }),
}));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  RunObjectAction: vi.fn(),
  FindCatalogObjectByUID: vi.fn(),
}));

vi.mock('@/core/capabilities', () => ({
  getPermissionKey: (kind: string, verb: string, namespace?: string) =>
    `${kind}:${verb}:${namespace ?? ''}`,
  useUserPermissions: () => new Map(),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

vi.mock('@/utils/ageFormatter', () => ({
  formatAge: (value: unknown) => String(value ?? ''),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: { handle: vi.fn() },
}));

vi.mock('@shared/components/icons/SharedIcons', () => ({
  DeleteIcon: () => <span>delete</span>,
  DiffIcon: () => <span>diff</span>,
  DrainIcon: () => <span>drain</span>,
  MetadataIcon: () => <span>metadata</span>,
  ObjectMapIcon: () => <span>map</span>,
  OpenIcon: () => <span>open</span>,
}));

import NsViewAutoscaling from '@modules/namespace/components/NsViewAutoscaling';
import NsViewConfig from '@modules/namespace/components/NsViewConfig';
import NsViewEvents from '@modules/namespace/components/NsViewEvents';
import NsViewHelm from '@modules/namespace/components/NsViewHelm';
import NsViewNetwork from '@modules/namespace/components/NsViewNetwork';
import NsViewQuotas from '@modules/namespace/components/NsViewQuotas';
import NsViewRBAC from '@modules/namespace/components/NsViewRBAC';
import NsViewStorage from '@modules/namespace/components/NsViewStorage';
import ClusterViewConfig from '@modules/cluster/components/ClusterViewConfig';
import ClusterViewCRDs from '@modules/cluster/components/ClusterViewCRDs';
import ClusterViewEvents from '@modules/cluster/components/ClusterViewEvents';
import ClusterViewNodes from '@modules/cluster/components/ClusterViewNodes';
import ClusterViewRBAC from '@modules/cluster/components/ClusterViewRBAC';
import ClusterViewStorage from '@modules/cluster/components/ClusterViewStorage';

const typedQueryPayload = (data: Record<string, unknown>) => ({
  status: 'executed',
  data: {
    status: 'ready',
    data: {
      ...data,
      total: 1,
      totalIsExact: true,
      kinds: ['QueryKind'],
      namespaces: ['team-b'],
      facetsExact: true,
    },
  },
});

const nodeRow = (name: string, age: string) => ({
  kind: 'Node',
  name,
  status: 'Ready',
  roles: 'worker',
  version: 'v1.29.0',
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
  memLimits: '4Gi',
  memoryUsage: '2Gi',
  pods: '3',
  podsAllocatable: '50',
  podsCapacity: '50',
  taints: [],
  labels: {},
  annotations: {},
  restarts: 0,
  cpu: '1',
  memory: '2Gi',
  unschedulable: false,
  clusterId: 'cluster-a',
  clusterName: 'alpha',
  age,
});

const flushQueryEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('query-backed leaf first load', () => {
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
    requestRefreshDomainStateMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const render = async (element: React.ReactElement, payload: Record<string, unknown>) => {
    requestRefreshDomainStateMock.mockResolvedValue(typedQueryPayload(payload));
    await act(async () => {
      root.render(element);
      await Promise.resolve();
    });
    await flushQueryEffects();
    return gridTablePropsRef.current;
  };

  const expectQueryFirstLoad = async ({
    element,
    payload,
    domain,
    expectedName,
    expectedScope,
  }: {
    element: React.ReactElement;
    payload: Record<string, unknown>;
    domain: string;
    expectedName: string;
    expectedScope: string;
  }) => {
    const props = await render(element, payload);

    expect(props.data).toHaveLength(1);
    expect(props.data[0]).toEqual(expect.objectContaining({ name: expectedName }));
    expect(requestRefreshDomainStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain,
        scope: expectedScope,
      })
    );
  };

  const expectSingleNamespaceLocalFirstLoad = async ({
    element,
    expectedName,
  }: {
    element: React.ReactElement;
    expectedName: string;
  }) => {
    requestRefreshDomainStateMock.mockResolvedValue(typedQueryPayload({ resources: [] }));
    await act(async () => {
      root.render(element);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.data).toHaveLength(1);
    expect(gridTablePropsRef.current.data[0]).toEqual(
      expect.objectContaining({ name: expectedName })
    );
    expect(requestRefreshDomainStateMock).not.toHaveBeenCalled();
  };

  it.each([
    {
      label: 'namespace config',
      domain: 'namespace-config',
      expectedScope: 'cluster-a|namespace:all?limit=50&sort=name&sortDirection=asc',
      local: {
        kind: 'ConfigMap',
        name: 'local-config',
        namespace: 'team-a',
        clusterId: 'cluster-a',
        data: 1,
        age: '1h',
      },
      query: {
        kind: 'ConfigMap',
        name: 'query-config',
        namespace: 'team-b',
        clusterId: 'cluster-a',
        data: 2,
        age: '2h',
      },
      payloadField: 'resources',
      Component: NsViewConfig,
    },
    {
      label: 'namespace network',
      domain: 'namespace-network',
      expectedScope: 'cluster-a|namespace:all?limit=50&sort=name&sortDirection=asc',
      local: {
        kind: 'Ingress',
        name: 'local-network',
        namespace: 'team-a',
        clusterId: 'cluster-a',
        details: 'local',
        age: '1h',
      },
      query: {
        kind: 'Ingress',
        name: 'query-network',
        namespace: 'team-b',
        clusterId: 'cluster-a',
        details: 'query',
        age: '2h',
      },
      payloadField: 'resources',
      Component: NsViewNetwork,
    },
    {
      label: 'namespace storage',
      domain: 'namespace-storage',
      expectedScope: 'cluster-a|namespace:all?limit=50&sort=name&sortDirection=asc',
      local: {
        kind: 'PersistentVolumeClaim',
        name: 'local-storage',
        namespace: 'team-a',
        clusterId: 'cluster-a',
        status: 'Bound',
        capacity: '1Gi',
        age: '1h',
      },
      query: {
        kind: 'PersistentVolumeClaim',
        name: 'query-storage',
        namespace: 'team-b',
        clusterId: 'cluster-a',
        status: 'Bound',
        capacity: '2Gi',
        age: '2h',
      },
      payloadField: 'resources',
      Component: NsViewStorage,
    },
    {
      label: 'namespace quotas',
      domain: 'namespace-quotas',
      expectedScope: 'cluster-a|namespace:all?limit=50&sort=name&sortDirection=asc',
      local: {
        kind: 'ResourceQuota',
        name: 'local-quota',
        namespace: 'team-a',
        clusterId: 'cluster-a',
        hard: { pods: '1' },
        used: { pods: '0' },
        age: '1h',
      },
      query: {
        kind: 'ResourceQuota',
        name: 'query-quota',
        namespace: 'team-b',
        clusterId: 'cluster-a',
        hard: { pods: '2' },
        used: { pods: '1' },
        age: '2h',
      },
      payloadField: 'resources',
      Component: NsViewQuotas,
    },
    {
      label: 'namespace RBAC',
      domain: 'namespace-rbac',
      expectedScope: 'cluster-a|namespace:all?limit=50&sort=name&sortDirection=asc',
      local: {
        kind: 'Role',
        name: 'local-rbac',
        namespace: 'team-a',
        clusterId: 'cluster-a',
        rulesCount: 1,
        age: '1h',
      },
      query: {
        kind: 'Role',
        name: 'query-rbac',
        namespace: 'team-b',
        clusterId: 'cluster-a',
        rulesCount: 2,
        age: '2h',
      },
      payloadField: 'resources',
      Component: NsViewRBAC,
    },
    {
      label: 'namespace events',
      domain: 'namespace-events',
      expectedScope: 'cluster-a|namespace:all?limit=50&sort=name&sortDirection=asc',
      local: {
        kind: 'Event',
        name: 'local-event',
        reason: 'LocalReason',
        namespace: 'team-a',
        clusterId: 'cluster-a',
        object: 'Pod/local',
        objectApiVersion: 'v1',
        ageTimestamp: 1,
      },
      query: {
        kind: 'Event',
        name: 'query-event',
        reason: 'QueryReason',
        namespace: 'team-b',
        clusterId: 'cluster-a',
        object: 'Pod/query',
        objectApiVersion: 'v1',
        ageTimestamp: 2,
      },
      payloadField: 'events',
      Component: NsViewEvents,
    },
  ])('uses the typed query result on first load for $label', async (testCase) => {
    await expectQueryFirstLoad({
      element: (
        <testCase.Component
          namespace={ALL_NAMESPACES_SCOPE}
          data={[testCase.local] as any}
          loading={false}
          loaded={true}
          showNamespaceColumn={true}
        />
      ),
      payload: { [testCase.payloadField]: [testCase.query] },
      domain: testCase.domain,
      expectedName: testCase.query.name,
      expectedScope: testCase.expectedScope,
    });
  });

  it('uses the typed query result on first load for namespace autoscaling', async () => {
    await expectQueryFirstLoad({
      element: (
        <NsViewAutoscaling
          namespace={ALL_NAMESPACES_SCOPE}
          data={[
            {
              kind: 'HorizontalPodAutoscaler',
              name: 'local-autoscaling',
              namespace: 'team-a',
              clusterId: 'cluster-a',
              target: 'Deployment/local',
              minReplicas: 1,
              maxReplicas: 2,
              currentReplicas: 1,
              age: '1h',
            },
          ]}
          loading={false}
          loaded={true}
          showNamespaceColumn={true}
        />
      ),
      payload: {
        resources: [
          {
            kind: 'HorizontalPodAutoscaler',
            name: 'query-autoscaling',
            namespace: 'team-b',
            clusterId: 'cluster-a',
            target: 'Deployment/query',
            targetApiVersion: 'apps/v1',
            min: 1,
            max: 3,
            current: 2,
            age: '2h',
          },
        ],
      },
      domain: 'namespace-autoscaling',
      expectedName: 'query-autoscaling',
      expectedScope: 'cluster-a|namespace:all?limit=50&sort=name&sortDirection=asc',
    });
  });

  it('uses the typed query result on first load for namespace Helm', async () => {
    await expectQueryFirstLoad({
      element: (
        <NsViewHelm
          namespace={ALL_NAMESPACES_SCOPE}
          data={[
            {
              kind: 'HelmRelease',
              name: 'local-release',
              namespace: 'team-a',
              clusterId: 'cluster-a',
              chart: 'local-1.0.0',
              status: 'deployed',
              revision: 1,
              age: '1h',
            },
          ]}
          loading={false}
          loaded={true}
          showNamespaceColumn={true}
        />
      ),
      payload: {
        releases: [
          {
            name: 'query-release',
            namespace: 'team-b',
            clusterId: 'cluster-a',
            chart: 'query-1.0.0',
            status: 'deployed',
            revision: 2,
            age: '2h',
          },
        ],
      },
      domain: 'namespace-helm',
      expectedName: 'query-release',
      expectedScope: 'cluster-a|namespace:all?limit=50&sort=name&sortDirection=asc',
    });
  });

  it.each([
    {
      label: 'namespace config',
      local: {
        kind: 'ConfigMap',
        name: 'local-config',
        namespace: 'team-a',
        clusterId: 'cluster-a',
        data: 1,
        age: '1h',
      },
      Component: NsViewConfig,
    },
    {
      label: 'namespace network',
      local: {
        kind: 'Ingress',
        name: 'local-network',
        namespace: 'team-a',
        clusterId: 'cluster-a',
        details: 'local',
        age: '1h',
      },
      Component: NsViewNetwork,
    },
    {
      label: 'namespace storage',
      local: {
        kind: 'PersistentVolumeClaim',
        name: 'local-storage',
        namespace: 'team-a',
        clusterId: 'cluster-a',
        status: 'Bound',
        capacity: '1Gi',
        age: '1h',
      },
      Component: NsViewStorage,
    },
    {
      label: 'namespace quotas',
      local: {
        kind: 'ResourceQuota',
        name: 'local-quota',
        namespace: 'team-a',
        clusterId: 'cluster-a',
        hard: { pods: '1' },
        used: { pods: '0' },
        age: '1h',
      },
      Component: NsViewQuotas,
    },
    {
      label: 'namespace RBAC',
      local: {
        kind: 'Role',
        name: 'local-rbac',
        namespace: 'team-a',
        clusterId: 'cluster-a',
        rulesCount: 1,
        age: '1h',
      },
      Component: NsViewRBAC,
    },
    {
      label: 'namespace events',
      local: {
        kind: 'Event',
        name: 'local-event',
        reason: 'LocalReason',
        namespace: 'team-a',
        clusterId: 'cluster-a',
        object: 'Pod/local',
        objectApiVersion: 'v1',
        ageTimestamp: 1,
      },
      Component: NsViewEvents,
    },
  ])('uses local rows without a typed query on first load for $label', async (testCase) => {
    await expectSingleNamespaceLocalFirstLoad({
      element: (
        <testCase.Component
          namespace="team-a"
          data={[testCase.local] as any}
          loading={false}
          loaded={true}
          showNamespaceColumn={false}
        />
      ),
      expectedName: testCase.local.name,
    });
  });

  it('uses local rows without a typed query on first load for namespace autoscaling', async () => {
    await expectSingleNamespaceLocalFirstLoad({
      element: (
        <NsViewAutoscaling
          namespace="team-a"
          data={[
            {
              kind: 'HorizontalPodAutoscaler',
              name: 'local-autoscaling',
              namespace: 'team-a',
              clusterId: 'cluster-a',
              target: 'Deployment/local',
              minReplicas: 1,
              maxReplicas: 2,
              currentReplicas: 1,
              age: '1h',
            },
          ]}
          loading={false}
          loaded={true}
          showNamespaceColumn={false}
        />
      ),
      expectedName: 'local-autoscaling',
    });
  });

  it('uses local rows without a typed query on first load for namespace Helm', async () => {
    await expectSingleNamespaceLocalFirstLoad({
      element: (
        <NsViewHelm
          namespace="team-a"
          data={[
            {
              kind: 'HelmRelease',
              name: 'local-release',
              namespace: 'team-a',
              clusterId: 'cluster-a',
              chart: 'local-1.0.0',
              status: 'deployed',
              revision: 1,
              age: '1h',
            },
          ]}
          loading={false}
          loaded={true}
          showNamespaceColumn={false}
        />
      ),
      expectedName: 'local-release',
    });
  });

  it.each([
    {
      label: 'cluster config',
      domain: 'cluster-config',
      expectedScope: 'cluster-a|?limit=50&sort=name&sortDirection=asc',
      local: { kind: 'StorageClass', name: 'local-config', clusterId: 'cluster-a', age: '1h' },
      query: { kind: 'StorageClass', name: 'query-config', clusterId: 'cluster-a', age: '2h' },
      payloadField: 'resources',
      Component: ClusterViewConfig,
    },
    {
      label: 'cluster storage',
      domain: 'cluster-storage',
      expectedScope: 'cluster-a|?limit=50&sort=name&sortDirection=asc',
      local: {
        kind: 'PersistentVolume',
        name: 'local-volume',
        clusterId: 'cluster-a',
        capacity: '1Gi',
        status: 'Bound',
        age: '1h',
      },
      query: {
        kind: 'PersistentVolume',
        name: 'query-volume',
        clusterId: 'cluster-a',
        capacity: '2Gi',
        status: 'Bound',
        age: '2h',
      },
      payloadField: 'volumes',
      Component: ClusterViewStorage,
    },
    {
      label: 'cluster RBAC',
      domain: 'cluster-rbac',
      expectedScope: 'cluster-a|?limit=50&sort=name&sortDirection=asc',
      local: {
        kind: 'ClusterRole',
        name: 'local-rbac',
        clusterId: 'cluster-a',
        rulesCount: 1,
        age: '1h',
      },
      query: {
        kind: 'ClusterRole',
        name: 'query-rbac',
        clusterId: 'cluster-a',
        rulesCount: 2,
        age: '2h',
      },
      payloadField: 'resources',
      Component: ClusterViewRBAC,
    },
    {
      label: 'cluster CRDs',
      domain: 'cluster-crds',
      expectedScope: 'cluster-a|?limit=50&sort=name&sortDirection=asc',
      local: {
        kind: 'CustomResourceDefinition',
        name: 'locals.example.com',
        group: 'example.com',
        scope: 'Namespaced',
        clusterId: 'cluster-a',
        age: '1h',
      },
      query: {
        kind: 'CustomResourceDefinition',
        name: 'queries.example.com',
        group: 'example.com',
        scope: 'Namespaced',
        clusterId: 'cluster-a',
        age: '2h',
      },
      payloadField: 'definitions',
      Component: ClusterViewCRDs,
    },
  ])('uses the typed query result on first load for $label', async (testCase) => {
    await expectQueryFirstLoad({
      element: <testCase.Component data={[testCase.local] as any} loading={false} loaded={true} />,
      payload: { [testCase.payloadField]: [testCase.query] },
      domain: testCase.domain,
      expectedName: testCase.query.name,
      expectedScope: testCase.expectedScope,
    });
  });

  it('uses the typed query result on first load for cluster events', async () => {
    await expectQueryFirstLoad({
      element: (
        <ClusterViewEvents
          data={[
            {
              kind: 'Event',
              name: 'local-event',
              namespace: 'team-a',
              type: 'Warning',
              source: 'kubelet',
              reason: 'LocalReason',
              message: 'local message',
              clusterId: 'cluster-a',
              object: 'Pod/local',
              objectApiVersion: 'v1',
              ageTimestamp: 1,
            },
          ]}
          loading={false}
          loaded={true}
        />
      ),
      payload: {
        events: [
          {
            kind: 'Event',
            name: 'query-event',
            namespace: 'team-b',
            type: 'Warning',
            source: 'kubelet',
            reason: 'QueryReason',
            message: 'query message',
            clusterId: 'cluster-a',
            object: 'Pod/query',
            objectApiVersion: 'v1',
            ageTimestamp: 2,
          },
        ],
      },
      domain: 'cluster-events',
      expectedName: 'query-event',
      expectedScope: 'cluster-a|cluster?limit=50&sort=name&sortDirection=asc',
    });
  });

  it('uses the typed query result on first load for cluster nodes', async () => {
    await expectQueryFirstLoad({
      element: (
        <ClusterViewNodes data={[nodeRow('local-node', '1h')]} loading={false} loaded={true} />
      ),
      payload: {
        nodes: [nodeRow('query-node', '2h')],
      },
      domain: 'nodes',
      expectedName: 'query-node',
      expectedScope: 'cluster-a|?limit=50&sort=name&sortDirection=asc',
    });
  });
});
