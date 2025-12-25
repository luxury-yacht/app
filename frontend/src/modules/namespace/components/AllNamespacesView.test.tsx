/**
 * frontend/src/modules/namespace/components/AllNamespacesView.test.tsx
 *
 * Tests for AllNamespacesView.
 */
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import AllNamespacesView from '@modules/namespace/components/AllNamespacesView';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import type { NamespaceViewType } from '@/types/navigation/views';
import type { PodsResourceDataReturn } from '@modules/namespace/contexts/NsResourcesContext';
import type { PodMetricsInfo } from '@/core/refresh/types';

const clientMocks = vi.hoisted(() => ({
  fetchSnapshotMock: vi.fn(),
}));

vi.mock('@/core/refresh/client', () => ({
  fetchSnapshot: clientMocks.fetchSnapshotMock,
}));

type ViewRenderer = ReturnType<typeof vi.fn>;

const hoistedMocks = vi.hoisted(() => {
  const renderers: Record<string, ViewRenderer> = {};
  const makeMock = (id: string) => {
    const renderer = vi.fn();
    renderers[id] = renderer;
    return {
      __esModule: true,
      default: (props: any) => {
        renderer(props);
        return null;
      },
    };
  };
  return { renderers, makeMock };
});

const viewRenderers = hoistedMocks.renderers;
vi.mock('@modules/namespace/components/NsViewPods', () => hoistedMocks.makeMock('pods-view'));
vi.mock('@modules/namespace/components/NsViewWorkloads', () =>
  hoistedMocks.makeMock('workloads-view')
);
vi.mock('@modules/namespace/components/NsViewConfig', () => hoistedMocks.makeMock('config-view'));
vi.mock('@modules/namespace/components/NsViewAutoscaling', () =>
  hoistedMocks.makeMock('autoscaling-view')
);
vi.mock('@modules/namespace/components/NsViewNetwork', () => hoistedMocks.makeMock('network-view'));
vi.mock('@modules/namespace/components/NsViewQuotas', () => hoistedMocks.makeMock('quotas-view'));
vi.mock('@modules/namespace/components/NsViewRBAC', () => hoistedMocks.makeMock('rbac-view'));
vi.mock('@modules/namespace/components/NsViewStorage', () => hoistedMocks.makeMock('storage-view'));
vi.mock('@modules/namespace/components/NsViewCustom', () => hoistedMocks.makeMock('custom-view'));
vi.mock('@modules/namespace/components/NsViewHelm', () => hoistedMocks.makeMock('helm-view'));
vi.mock('@modules/namespace/components/NsViewEvents', () => hoistedMocks.makeMock('events-view'));

const namespaceResourcesMocks = vi.hoisted(() => {
  const createPodsResource = (): PodsResourceDataReturn => ({
    data: [],
    loading: false,
    refreshing: false,
    hasLoaded: false,
    error: null,
    load: vi.fn(),
    refresh: vi.fn(),
    reset: vi.fn(),
    cancel: vi.fn(),
    lastFetchTime: null,
    metrics: null,
  });

  return {
    providerProps: [] as Array<Record<string, unknown>>,
    useNamespaceResourceMock: vi.fn(),
    useNamespaceResourcesMock: vi.fn<() => { pods: PodsResourceDataReturn }>(() => ({
      pods: createPodsResource(),
    })),
  };
});

vi.mock('@modules/namespace/contexts/NsResourcesContext', () => ({
  NamespaceResourcesProvider: ({ children, ...props }: any) => {
    namespaceResourcesMocks.providerProps.push(props);
    return children;
  },
  useNamespaceResource: (resourceKey: string) =>
    namespaceResourcesMocks.useNamespaceResourceMock(resourceKey),
  useNamespaceResources: () => namespaceResourcesMocks.useNamespaceResourcesMock(),
}));

describe('AllNamespacesView', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    clientMocks.fetchSnapshotMock.mockReset();
    Object.values(viewRenderers).forEach((mock) => mock.mockReset());
    namespaceResourcesMocks.providerProps.length = 0;
    namespaceResourcesMocks.useNamespaceResourceMock.mockReset();
    namespaceResourcesMocks.useNamespaceResourcesMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderView = async (tab: NamespaceViewType) => {
    await act(async () => {
      root.render(<AllNamespacesView activeTab={tab} />);
      await Promise.resolve();
    });
  };

  const getLatestProps = (rendererKey: string) => {
    const mock = viewRenderers[rendererKey];
    if (!mock) {
      return undefined;
    }
    const calls = mock.mock.calls;
    if (!calls.length) {
      return undefined;
    }
    return calls[calls.length - 1]?.[0];
  };

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('renders pods view using namespace resources provider with metrics', async () => {
    const samplePods = [
      {
        name: 'api-123',
        namespace: 'team-a',
        status: 'Running',
        ready: '1/1',
        restarts: 0,
        ownerKind: 'Deployment',
        ownerName: 'api',
        node: 'node-a',
        cpuUsage: '10m',
        cpuRequest: '50m',
        cpuLimit: '200m',
        memUsage: '40Mi',
        memRequest: '128Mi',
        memLimit: '256Mi',
        age: '5m',
      },
    ];
    const metrics: PodMetricsInfo = {
      stale: false,
      lastError: undefined,
      collectedAt: Date.now(),
      successCount: 1,
      failureCount: 0,
    };

    const podsResource: PodsResourceDataReturn = {
      data: samplePods,
      loading: false,
      refreshing: false,
      hasLoaded: true,
      error: null,
      load: vi.fn(),
      refresh: vi.fn(),
      reset: vi.fn(),
      cancel: vi.fn(),
      lastFetchTime: null,
      metrics,
    };

    namespaceResourcesMocks.useNamespaceResourcesMock.mockReturnValue({
      pods: podsResource,
    });

    await renderView('pods');
    await flush();

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
    expect(namespaceResourcesMocks.useNamespaceResourcesMock).toHaveBeenCalled();
    expect(namespaceResourcesMocks.providerProps).toContainEqual(
      expect.objectContaining({ namespace: ALL_NAMESPACES_SCOPE, activeView: 'pods' })
    );

    const props = getLatestProps('pods-view');
    expect(props.namespace).toBe(ALL_NAMESPACES_SCOPE);
    expect(props.data).toBe(samplePods);
    expect(props.metrics).toEqual(metrics);
    expect(props.showNamespaceColumn).toBe(true);
  });

  it('renders workloads view using namespace resources provider', async () => {
    const workloadsData = [
      {
        kind: 'Deployment',
        name: 'api',
        namespace: 'team-a',
        status: 'Running',
        ready: '3/3',
        cpuUsage: '100m',
        memUsage: '200Mi',
        age: '10m',
      },
    ];
    namespaceResourcesMocks.useNamespaceResourceMock.mockImplementation((resourceKey: string) => {
      if (resourceKey === 'workloads') {
        return {
          data: workloadsData,
          loading: false,
          hasLoaded: true,
          error: new Error('load failed'),
        };
      }
      return { data: [], loading: false, hasLoaded: false, error: null };
    });

    await renderView('workloads');
    await flush();

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
    expect(namespaceResourcesMocks.useNamespaceResourceMock).toHaveBeenCalledWith('workloads');
    expect(namespaceResourcesMocks.providerProps).toContainEqual(
      expect.objectContaining({ namespace: ALL_NAMESPACES_SCOPE, activeView: 'workloads' })
    );
    expect(container.textContent).toContain('Failed to load workload resources: load failed');
    expect(getLatestProps('workloads-view')?.data).toBe(workloadsData);
  });

  it('renders helm view using namespace resources provider', async () => {
    const helmData = [
      {
        name: 'chart-one',
        namespace: 'system',
        chart: 'demo-1.0.0',
        appVersion: '1.2.3',
        status: 'deployed',
        revision: '5',
        updated: '2024-05-01T10:00:00Z',
        description: 'Upgrade complete',
        notes: 'All good',
        age: '2h',
      },
    ];
    namespaceResourcesMocks.useNamespaceResourceMock.mockImplementation((resourceKey: string) => {
      if (resourceKey === 'helm') {
        return {
          data: helmData,
          loading: false,
          hasLoaded: true,
          error: new Error('helm down'),
        };
      }
      return { data: [], loading: false, hasLoaded: false, error: null };
    });

    await renderView('helm');
    await flush();

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
    expect(namespaceResourcesMocks.useNamespaceResourceMock).toHaveBeenCalledWith('helm');
    expect(namespaceResourcesMocks.providerProps).toContainEqual(
      expect.objectContaining({ namespace: ALL_NAMESPACES_SCOPE, activeView: 'helm' })
    );
    expect(container.textContent).toContain('Failed to load Helm releases: helm down');

    const helmCalls = viewRenderers['helm-view'].mock.calls;
    const props = helmCalls[helmCalls.length - 1][0];
    expect(props.data).toBe(helmData);
    expect(props.namespace).toBe(ALL_NAMESPACES_SCOPE);
    expect(props.showNamespaceColumn).toBe(true);
  });

  it('renders config view using namespace resources provider', async () => {
    const configData = [
      {
        kind: 'ConfigMap',
        name: 'settings',
        namespace: 'team-a',
        data: { key: 'value' },
        age: '5m',
      },
    ];
    namespaceResourcesMocks.useNamespaceResourceMock.mockReturnValue({
      data: configData,
      loading: false,
      hasLoaded: true,
      error: null,
    });

    await renderView('config');
    await flush();

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
    expect(namespaceResourcesMocks.useNamespaceResourceMock).toHaveBeenCalledWith('config');
    expect(namespaceResourcesMocks.providerProps).toContainEqual(
      expect.objectContaining({ namespace: ALL_NAMESPACES_SCOPE, activeView: 'config' })
    );
    const calls = viewRenderers['config-view'].mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const props = calls[calls.length - 1][0];
    expect(props.loaded).toBe(true);
    expect(props.data).toBe(configData);
  });

  it('renders autoscaling view using namespace resources provider and shows errors', async () => {
    const autoscalingData = [
      {
        kind: 'HorizontalPodAutoscaler',
        name: 'api-hpa',
        namespace: 'team-a',
        scaleTargetRef: { kind: 'Deployment', name: 'api' },
      },
    ];
    namespaceResourcesMocks.useNamespaceResourceMock.mockImplementation((resourceKey: string) => {
      if (resourceKey === 'autoscaling') {
        return {
          data: autoscalingData,
          loading: false,
          hasLoaded: true,
          error: new Error('load failed'),
        };
      }
      return { data: [], loading: false, hasLoaded: false, error: null };
    });

    await renderView('autoscaling');
    await flush();

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
    expect(namespaceResourcesMocks.useNamespaceResourceMock).toHaveBeenCalledWith('autoscaling');
    expect(namespaceResourcesMocks.providerProps).toContainEqual(
      expect.objectContaining({ namespace: ALL_NAMESPACES_SCOPE, activeView: 'autoscaling' })
    );
    expect(container.textContent).toContain('Failed to load autoscaling resources: load failed');

    const props = getLatestProps('autoscaling-view');
    expect(props.data).toBe(autoscalingData);
    expect(props.namespace).toBe(ALL_NAMESPACES_SCOPE);
    expect(props.showNamespaceColumn).toBe(true);
  });

  it('renders network view using namespace resources provider', async () => {
    const networkData = [
      { kind: 'Service', name: 'api', namespace: 'team-a', details: 'ClusterIP', age: '1h' },
    ];
    namespaceResourcesMocks.useNamespaceResourceMock.mockImplementation((resourceKey: string) => {
      if (resourceKey === 'network') {
        return {
          data: networkData,
          loading: false,
          hasLoaded: true,
          error: new Error('network down'),
        };
      }
      return { data: [], loading: false, hasLoaded: false, error: null };
    });

    await renderView('network');
    await flush();

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
    expect(namespaceResourcesMocks.useNamespaceResourceMock).toHaveBeenCalledWith('network');
    expect(namespaceResourcesMocks.providerProps).toContainEqual(
      expect.objectContaining({ namespace: ALL_NAMESPACES_SCOPE, activeView: 'network' })
    );
    expect(container.textContent).toContain('Failed to load network resources: network down');

    const props = getLatestProps('network-view');
    expect(props.data).toBe(networkData);
    expect(props.namespace).toBe(ALL_NAMESPACES_SCOPE);
    expect(props.showNamespaceColumn).toBe(true);
  });

  it('renders quotas view using namespace resources provider', async () => {
    const quotasData = [
      { kind: 'ResourceQuota', name: 'compute', namespace: 'team-a', details: 'cpu=10', age: '6h' },
    ];
    namespaceResourcesMocks.useNamespaceResourceMock.mockImplementation((resourceKey: string) => {
      if (resourceKey === 'quotas') {
        return {
          data: quotasData,
          loading: false,
          hasLoaded: true,
          error: new Error('quotas down'),
        };
      }
      return { data: [], loading: false, hasLoaded: false, error: null };
    });

    await renderView('quotas');
    await flush();

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
    expect(namespaceResourcesMocks.useNamespaceResourceMock).toHaveBeenCalledWith('quotas');
    expect(namespaceResourcesMocks.providerProps).toContainEqual(
      expect.objectContaining({ namespace: ALL_NAMESPACES_SCOPE, activeView: 'quotas' })
    );
    expect(container.textContent).toContain('Failed to load quota resources: quotas down');
    expect(getLatestProps('quotas-view')?.data).toBe(quotasData);
  });

  it('renders RBAC view using namespace resources provider', async () => {
    const rbacData = [
      {
        kind: 'RoleBinding',
        name: 'devs',
        namespace: 'team-a',
        details: 'binds to role dev',
        age: '4h',
      },
    ];
    namespaceResourcesMocks.useNamespaceResourceMock.mockImplementation((resourceKey: string) => {
      if (resourceKey === 'rbac') {
        return {
          data: rbacData,
          loading: false,
          hasLoaded: true,
          error: new Error('rbac down'),
        };
      }
      return { data: [], loading: false, hasLoaded: false, error: null };
    });

    await renderView('rbac');
    await flush();

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
    expect(namespaceResourcesMocks.useNamespaceResourceMock).toHaveBeenCalledWith('rbac');
    expect(namespaceResourcesMocks.providerProps).toContainEqual(
      expect.objectContaining({ namespace: ALL_NAMESPACES_SCOPE, activeView: 'rbac' })
    );
    expect(container.textContent).toContain('Failed to load RBAC resources: rbac down');
    expect(getLatestProps('rbac-view')?.data).toBe(rbacData);
  });

  it('renders storage view using namespace resources provider', async () => {
    const storageData = [
      {
        kind: 'PersistentVolumeClaim',
        name: 'data',
        namespace: 'team-a',
        status: 'Bound',
        capacity: '10Gi',
        storageClass: 'fast',
        age: '1d',
      },
    ];
    namespaceResourcesMocks.useNamespaceResourceMock.mockImplementation((resourceKey: string) => {
      if (resourceKey === 'storage') {
        return {
          data: storageData,
          loading: false,
          hasLoaded: true,
          error: new Error('storage down'),
        };
      }
      return { data: [], loading: false, hasLoaded: false, error: null };
    });

    await renderView('storage');
    await flush();

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
    expect(namespaceResourcesMocks.useNamespaceResourceMock).toHaveBeenCalledWith('storage');
    expect(namespaceResourcesMocks.providerProps).toContainEqual(
      expect.objectContaining({ namespace: ALL_NAMESPACES_SCOPE, activeView: 'storage' })
    );
    expect(container.textContent).toContain('Failed to load storage resources: storage down');
    expect(getLatestProps('storage-view')?.data).toBe(storageData);
  });

  it('renders custom view using namespace resources provider', async () => {
    const customData = [
      { kind: 'Widget', name: 'alpha', namespace: 'team-a', apiGroup: 'example.com/v1', age: '2h' },
    ];
    namespaceResourcesMocks.useNamespaceResourceMock.mockImplementation((resourceKey: string) => {
      if (resourceKey === 'custom') {
        return {
          data: customData,
          loading: false,
          hasLoaded: true,
          error: new Error('custom down'),
        };
      }
      return { data: [], loading: false, hasLoaded: false, error: null };
    });

    await renderView('custom');
    await flush();

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
    expect(namespaceResourcesMocks.useNamespaceResourceMock).toHaveBeenCalledWith('custom');
    expect(namespaceResourcesMocks.providerProps).toContainEqual(
      expect.objectContaining({ namespace: ALL_NAMESPACES_SCOPE, activeView: 'custom' })
    );
    expect(container.textContent).toContain('Failed to load custom resources: custom down');
    expect(getLatestProps('custom-view')?.data).toBe(customData);
  });

  it('renders events view using namespace resources provider', async () => {
    const eventsData = [
      {
        kind: 'Pod',
        kindAlias: 'pod',
        name: 'api',
        namespace: 'default',
        type: 'Warning',
        source: 'kubelet',
        reason: 'Failed',
        object: 'api-123',
        message: 'CrashLoop',
        objectNamespace: 'default',
        age: '1m',
        ageTimestamp: 1700000000,
      },
    ];
    namespaceResourcesMocks.useNamespaceResourceMock.mockImplementation((resourceKey: string) => {
      if (resourceKey === 'events') {
        return {
          data: eventsData,
          loading: false,
          hasLoaded: true,
          error: new Error('events down'),
        };
      }
      return { data: [], loading: false, hasLoaded: false, error: null };
    });

    await renderView('events');
    await flush();

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
    expect(namespaceResourcesMocks.useNamespaceResourceMock).toHaveBeenCalledWith('events');
    expect(namespaceResourcesMocks.providerProps).toContainEqual(
      expect.objectContaining({ namespace: ALL_NAMESPACES_SCOPE, activeView: 'events' })
    );
    expect(container.textContent).toContain('Failed to load events: events down');
    expect(getLatestProps('events-view')?.data).toBe(eventsData);
  });

  it('renders placeholder message for unsupported views', async () => {
    clientMocks.fetchSnapshotMock.mockResolvedValue({ snapshot: null });
    await renderView('overview' as NamespaceViewType);
    await flush();

    expect(container.textContent).toContain(
      'The overview view is not yet available for the “All” namespace.'
    );
  });
});
