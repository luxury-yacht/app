/**
 * frontend/src/core/refresh/streaming/resourceStreamManager.test.ts
 *
 * Test suite for resource stream helpers.
 */

import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';

const ensureRefreshBaseURLMock = vi.hoisted(() => vi.fn(async () => 'http://127.0.0.1:0'));
const fetchSnapshotMock = vi.hoisted(() => vi.fn());
const logAppInfoMock = vi.hoisted(() => vi.fn());
const logAppWarnMock = vi.hoisted(() => vi.fn());
const errorHandlerMock = vi.hoisted(() => ({
  handle: vi.fn(),
}));

const createdSockets: FakeWebSocket[] = [];

vi.mock('../client', () => ({
  ensureRefreshBaseURL: ensureRefreshBaseURLMock,
  fetchSnapshot: fetchSnapshotMock,
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

vi.mock('@/core/logging/appLogClient', () => ({
  logAppInfo: logAppInfoMock,
  logAppWarn: logAppWarnMock,
}));

import { buildClusterScopeList } from '../clusterScope';
import {
  getDomainState,
  getScopedDomainState,
  resetAllScopedDomainStates,
  resetDomainState,
  resetScopedDomainState,
  setDomainState,
  setScopedDomainState,
} from '../store';
import {
  ResourceStreamManager,
  mergeNodeMetricsRow,
  mergePodMetricsRow,
  mergeWorkloadMetricsRow,
  normalizeResourceScope,
  sortNodeRows,
  sortPodRows,
  sortWorkloadRows,
} from './resourceStreamManager';

class FakeWebSocket {
  static OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  onopen: ((event?: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  url: string;
  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    createdSockets.push(this);
  }
}

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  ensureRefreshBaseURLMock.mockReset();
  ensureRefreshBaseURLMock.mockResolvedValue('http://127.0.0.1:0');
  fetchSnapshotMock.mockReset();
  logAppInfoMock.mockClear();
  logAppWarnMock.mockClear();
  errorHandlerMock.handle.mockClear();
  createdSockets.length = 0;

  if (!globalThis.window) {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      writable: true,
    });
  }
  (window as any).setTimeout = globalThis.setTimeout;
  (window as any).clearTimeout = globalThis.clearTimeout;
  (globalThis as any).WebSocket = FakeWebSocket;

  resetDomainState('nodes');
  resetDomainState('namespace-workloads');
  resetDomainState('namespace-config');
  resetDomainState('namespace-network');
  resetDomainState('namespace-rbac');
  resetDomainState('namespace-custom');
  resetDomainState('namespace-helm');
  resetDomainState('namespace-autoscaling');
  resetDomainState('namespace-quotas');
  resetDomainState('namespace-storage');
  resetDomainState('cluster-rbac');
  resetDomainState('cluster-storage');
  resetDomainState('cluster-config');
  resetDomainState('cluster-crds');
  resetDomainState('cluster-custom');
  resetAllScopedDomainStates('pods');
});

afterEach(() => {
  resetDomainState('nodes');
  resetDomainState('namespace-workloads');
  resetDomainState('namespace-config');
  resetDomainState('namespace-network');
  resetDomainState('namespace-rbac');
  resetDomainState('namespace-custom');
  resetDomainState('namespace-helm');
  resetDomainState('namespace-autoscaling');
  resetDomainState('namespace-quotas');
  resetDomainState('namespace-storage');
  resetDomainState('cluster-rbac');
  resetDomainState('cluster-storage');
  resetDomainState('cluster-config');
  resetDomainState('cluster-crds');
  resetDomainState('cluster-custom');
  resetAllScopedDomainStates('pods');
  resetScopedDomainState('pods', 'cluster-a|namespace:default');
  delete (globalThis as any).WebSocket;
  vi.useRealTimers();
});

describe('resourceStreamManager helpers', () => {
  it('normalizes pod scopes', () => {
    expect(normalizeResourceScope('pods', 'namespace:default')).toBe('namespace:default');
    expect(normalizeResourceScope('pods', 'namespace:*')).toBe('namespace:all');
    expect(normalizeResourceScope('pods', 'node:node-a')).toBe('node:node-a');
    expect(normalizeResourceScope('pods', 'workload:default:Deployment:web')).toBe(
      'workload:default:Deployment:web'
    );
  });

  it('normalizes namespace workload scopes', () => {
    expect(normalizeResourceScope('namespace-workloads', 'default')).toBe('namespace:default');
    expect(normalizeResourceScope('namespace-workloads', 'namespace:all')).toBe('namespace:all');
  });

  it('normalizes namespace config scopes', () => {
    expect(normalizeResourceScope('namespace-config', 'default')).toBe('namespace:default');
    expect(normalizeResourceScope('namespace-config', 'namespace:all')).toBe('namespace:all');
  });

  it('normalizes namespace network scopes', () => {
    expect(normalizeResourceScope('namespace-network', 'default')).toBe('namespace:default');
    expect(normalizeResourceScope('namespace-network', 'namespace:all')).toBe('namespace:all');
  });

  it('normalizes namespace rbac scopes', () => {
    expect(normalizeResourceScope('namespace-rbac', 'default')).toBe('namespace:default');
    expect(normalizeResourceScope('namespace-rbac', 'namespace:all')).toBe('namespace:all');
  });

  it('normalizes namespace custom scopes', () => {
    expect(normalizeResourceScope('namespace-custom', 'default')).toBe('namespace:default');
    expect(normalizeResourceScope('namespace-custom', 'namespace:all')).toBe('namespace:all');
  });

  it('normalizes namespace helm scopes', () => {
    expect(normalizeResourceScope('namespace-helm', 'default')).toBe('namespace:default');
    expect(normalizeResourceScope('namespace-helm', 'namespace:all')).toBe('namespace:all');
  });

  it('normalizes namespace autoscaling scopes', () => {
    expect(normalizeResourceScope('namespace-autoscaling', 'default')).toBe('namespace:default');
    expect(normalizeResourceScope('namespace-autoscaling', 'namespace:all')).toBe('namespace:all');
  });

  it('normalizes namespace quotas scopes', () => {
    expect(normalizeResourceScope('namespace-quotas', 'default')).toBe('namespace:default');
    expect(normalizeResourceScope('namespace-quotas', 'namespace:all')).toBe('namespace:all');
  });

  it('normalizes namespace storage scopes', () => {
    expect(normalizeResourceScope('namespace-storage', 'default')).toBe('namespace:default');
    expect(normalizeResourceScope('namespace-storage', 'namespace:all')).toBe('namespace:all');
  });

  it('normalizes node scopes', () => {
    expect(normalizeResourceScope('nodes', '')).toBe('');
    expect(normalizeResourceScope('nodes', 'cluster')).toBe('');
    expect(() => normalizeResourceScope('nodes', 'namespace:default')).toThrow();
  });

  it('normalizes cluster scopes', () => {
    expect(normalizeResourceScope('cluster-rbac', '')).toBe('');
    expect(normalizeResourceScope('cluster-storage', 'cluster')).toBe('');
    expect(normalizeResourceScope('cluster-config', '')).toBe('');
    expect(normalizeResourceScope('cluster-crds', 'cluster')).toBe('');
    expect(normalizeResourceScope('cluster-custom', '')).toBe('');
  });

  it('preserves pod metrics when requested', () => {
    const existing = {
      name: 'pod-a',
      namespace: 'default',
      node: 'node-a',
      status: 'Running',
      ready: '1/1',
      restarts: 0,
      age: '1m',
      ownerKind: 'Deployment',
      ownerName: 'web',
      cpuRequest: '10m',
      cpuLimit: '20m',
      cpuUsage: '50m',
      memRequest: '10Mi',
      memLimit: '20Mi',
      memUsage: '40Mi',
    };
    const incoming = { ...existing, cpuUsage: '5m', memUsage: '8Mi' };
    const merged = mergePodMetricsRow(existing, incoming, true);
    expect(merged.cpuUsage).toBe('50m');
    expect(merged.memUsage).toBe('40Mi');
  });

  it('merges workload metrics when requested', () => {
    const existing = {
      kind: 'Deployment',
      name: 'web',
      namespace: 'default',
      ready: '1/1',
      status: 'Healthy',
      restarts: 0,
      age: '1m',
      cpuUsage: '60m',
      memUsage: '40Mi',
    };
    const incoming = { ...existing, cpuUsage: '5m', memUsage: '8Mi' };
    const merged = mergeWorkloadMetricsRow(existing, incoming, true);
    expect(merged.cpuUsage).toBe('60m');
    expect(merged.memUsage).toBe('40Mi');
  });

  it('merges node metrics when requested', () => {
    const existing = {
      name: 'node-a',
      status: 'Ready',
      roles: 'worker',
      age: '1d',
      version: 'v1.30.0',
      cpuCapacity: '2',
      cpuAllocatable: '2',
      cpuRequests: '0',
      cpuLimits: '0',
      cpuUsage: '200m',
      memoryCapacity: '1Gi',
      memoryAllocatable: '1Gi',
      memRequests: '0',
      memLimits: '0',
      memoryUsage: '200Mi',
      pods: '1/10',
      podsCapacity: '10',
      podsAllocatable: '10',
      restarts: 0,
      kind: 'Node',
      cpu: '2',
      memory: '1Gi',
      unschedulable: false,
    };
    const incoming = { ...existing, cpuUsage: '10m', memoryUsage: '5Mi' };
    const merged = mergeNodeMetricsRow(existing, incoming, true);
    expect(merged.cpuUsage).toBe('200m');
    expect(merged.memoryUsage).toBe('200Mi');
  });

  it('sorts pod rows by namespace and name', () => {
    const rows = [
      { name: 'b', namespace: 'ns-b' },
      { name: 'a', namespace: 'ns-b' },
      { name: 'c', namespace: 'ns-a' },
    ] as Array<{ name: string; namespace: string }>;
    sortPodRows(rows as any);
    expect(rows.map((row) => `${row.namespace}/${row.name}`)).toEqual([
      'ns-a/c',
      'ns-b/a',
      'ns-b/b',
    ]);
  });

  it('sorts workload rows by kind, name, namespace, and status', () => {
    const rows = [
      { kind: 'StatefulSet', name: 'b', namespace: 'ns-a', status: 'Healthy' },
      { kind: 'Deployment', name: 'a', namespace: 'ns-b', status: 'Healthy' },
      { kind: 'Deployment', name: 'a', namespace: 'ns-a', status: 'Pending' },
    ] as Array<{ kind: string; name: string; namespace: string; status: string }>;
    sortWorkloadRows(rows as any);
    expect(rows.map((row) => `${row.kind}/${row.name}/${row.namespace}/${row.status}`)).toEqual([
      'Deployment/a/ns-a/Pending',
      'Deployment/a/ns-b/Healthy',
      'StatefulSet/b/ns-a/Healthy',
    ]);
  });

  it('sorts node rows by name', () => {
    const rows = [{ name: 'node-b' }, { name: 'node-a' }];
    sortNodeRows(rows as any);
    expect(rows.map((row) => row.name)).toEqual(['node-a', 'node-b']);
  });
});

describe('ResourceStreamManager', () => {
  test('applies pod updates and preserves metrics', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('pods', storeScope);

    const existing = {
      clusterId: 'cluster-a',
      name: 'pod-a',
      namespace: 'default',
      node: 'node-a',
      status: 'Running',
      ready: '1/1',
      restarts: 0,
      age: '1m',
      ownerKind: 'Deployment',
      ownerName: 'web',
      cpuRequest: '10m',
      cpuLimit: '20m',
      cpuUsage: '50m',
      memRequest: '10Mi',
      memLimit: '20Mi',
      memUsage: '40Mi',
    };

    setScopedDomainState('pods', storeScope, () => ({
      status: 'ready',
      data: { pods: [existing] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'MODIFIED',
        domain: 'pods',
        scope: 'namespace:default',
        resourceVersion: '2',
        name: 'pod-a',
        namespace: 'default',
        row: { ...existing, status: 'Pending', cpuUsage: '5m', memUsage: '8Mi' },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getScopedDomainState('pods', storeScope);
    expect(state.data?.pods?.[0]?.cpuUsage).toBe('50m');
    expect(state.data?.pods?.[0]?.memUsage).toBe('40Mi');
    expect(state.data?.pods?.[0]?.status).toBe('Pending');
  });

  test('applies namespace config updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-config', storeScope);

    setDomainState('namespace-config', () => ({
      status: 'ready',
      data: { resources: [] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'namespace-config',
        scope: 'namespace:default',
        resourceVersion: '3',
        name: 'config-a',
        namespace: 'default',
        kind: 'ConfigMap',
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          kind: 'ConfigMap',
          typeAlias: 'CM',
          name: 'config-a',
          namespace: 'default',
          data: 2,
          age: '1m',
        },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getDomainState('namespace-config');
    expect(state.data?.resources?.[0]?.name).toBe('config-a');
  });

  test('applies namespace network updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-network', storeScope);

    setDomainState('namespace-network', () => ({
      status: 'ready',
      data: { resources: [] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'namespace-network',
        scope: 'namespace:default',
        resourceVersion: '4',
        name: 'svc-a',
        namespace: 'default',
        kind: 'Service',
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          kind: 'Service',
          name: 'svc-a',
          namespace: 'default',
          details: 'Type: ClusterIP',
          age: '1m',
        },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getDomainState('namespace-network');
    expect(state.data?.resources?.[0]?.name).toBe('svc-a');
  });

  test('applies namespace rbac updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-rbac', storeScope);

    setDomainState('namespace-rbac', () => ({
      status: 'ready',
      data: { resources: [] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'namespace-rbac',
        scope: 'namespace:default',
        resourceVersion: '4',
        name: 'role-a',
        namespace: 'default',
        kind: 'Role',
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          kind: 'Role',
          name: 'role-a',
          namespace: 'default',
          details: 'Rules: 1',
          age: '1m',
        },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getDomainState('namespace-rbac');
    expect(state.data?.resources?.[0]?.name).toBe('role-a');
  });

  test('applies namespace custom updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-custom', storeScope);

    setDomainState('namespace-custom', () => ({
      status: 'ready',
      data: { resources: [] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'namespace-custom',
        scope: 'namespace:default',
        resourceVersion: '4',
        name: 'widget-a',
        namespace: 'default',
        kind: 'Widget',
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          kind: 'Widget',
          name: 'widget-a',
          namespace: 'default',
          apiGroup: 'example.com',
          age: '1m',
          labels: { app: 'demo' },
        },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getDomainState('namespace-custom');
    expect(state.data?.resources?.[0]?.name).toBe('widget-a');
  });

  test('applies namespace helm updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-helm', storeScope);

    setDomainState('namespace-helm', () => ({
      status: 'ready',
      data: { releases: [] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'namespace-helm',
        scope: 'namespace:default',
        resourceVersion: '4',
        name: 'release-a',
        namespace: 'default',
        kind: 'HelmRelease',
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          name: 'release-a',
          namespace: 'default',
          chart: 'demo-1.0.0',
          appVersion: '1.0.0',
          status: 'deployed',
          revision: 1,
          updated: '2024-01-01T00:00:00Z',
          age: '1m',
        },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getDomainState('namespace-helm');
    expect(state.data?.releases?.[0]?.name).toBe('release-a');
  });

  test('applies namespace autoscaling updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-autoscaling', storeScope);

    setDomainState('namespace-autoscaling', () => ({
      status: 'ready',
      data: { resources: [] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'namespace-autoscaling',
        scope: 'namespace:default',
        resourceVersion: '4',
        name: 'hpa-a',
        namespace: 'default',
        kind: 'HorizontalPodAutoscaler',
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          kind: 'HorizontalPodAutoscaler',
          name: 'hpa-a',
          namespace: 'default',
          target: 'Deployment/web',
          min: 1,
          max: 4,
          current: 2,
          age: '1m',
        },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getDomainState('namespace-autoscaling');
    expect(state.data?.resources?.[0]?.name).toBe('hpa-a');
  });

  test('applies namespace quotas updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-quotas', storeScope);

    setDomainState('namespace-quotas', () => ({
      status: 'ready',
      data: { resources: [] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'namespace-quotas',
        scope: 'namespace:default',
        resourceVersion: '5',
        name: 'quota-a',
        namespace: 'default',
        kind: 'ResourceQuota',
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          kind: 'ResourceQuota',
          name: 'quota-a',
          namespace: 'default',
          details: 'Hard: 0, Used: 0',
          age: '1m',
        },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getDomainState('namespace-quotas');
    expect(state.data?.resources?.[0]?.name).toBe('quota-a');
  });

  test('applies namespace storage updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-storage', storeScope);

    setDomainState('namespace-storage', () => ({
      status: 'ready',
      data: { resources: [] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'namespace-storage',
        scope: 'namespace:default',
        resourceVersion: '6',
        name: 'pvc-a',
        namespace: 'default',
        kind: 'PersistentVolumeClaim',
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          kind: 'PersistentVolumeClaim',
          name: 'pvc-a',
          namespace: 'default',
          capacity: '1Gi',
          status: 'Bound',
          storageClass: 'standard',
          age: '1m',
        },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getDomainState('namespace-storage');
    expect(state.data?.resources?.[0]?.name).toBe('pvc-a');
  });

  test('applies cluster rbac updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('cluster-rbac', storeScope);

    setDomainState('cluster-rbac', () => ({
      status: 'ready',
      data: { resources: [] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'cluster-rbac',
        scope: '',
        resourceVersion: '7',
        name: 'cluster-role',
        kind: 'ClusterRole',
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          kind: 'ClusterRole',
          name: 'cluster-role',
          details: 'Rules: 1',
          age: '1m',
          typeAlias: 'CR',
        },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getDomainState('cluster-rbac');
    expect(state.data?.resources?.[0]?.name).toBe('cluster-role');
  });

  test('applies cluster storage updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('cluster-storage', storeScope);

    setDomainState('cluster-storage', () => ({
      status: 'ready',
      data: { volumes: [] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'cluster-storage',
        scope: '',
        resourceVersion: '7',
        name: 'pv-a',
        kind: 'PersistentVolume',
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          kind: 'PersistentVolume',
          name: 'pv-a',
          capacity: '1Gi',
          accessModes: 'ReadWriteOnce',
          status: 'Bound',
          claim: 'default/app',
          age: '1m',
        },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getDomainState('cluster-storage');
    expect(state.data?.volumes?.[0]?.name).toBe('pv-a');
  });

  test('applies cluster config updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('cluster-config', storeScope);

    setDomainState('cluster-config', () => ({
      status: 'ready',
      data: { resources: [] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'cluster-config',
        scope: '',
        resourceVersion: '7',
        name: 'standard',
        kind: 'StorageClass',
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          kind: 'StorageClass',
          name: 'standard',
          details: 'kubernetes.io/aws-ebs',
          isDefault: true,
          age: '1m',
        },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getDomainState('cluster-config');
    expect(state.data?.resources?.[0]?.name).toBe('standard');
  });

  test('applies cluster crds updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('cluster-crds', storeScope);

    setDomainState('cluster-crds', () => ({
      status: 'ready',
      data: { definitions: [] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'cluster-crds',
        scope: '',
        resourceVersion: '7',
        name: 'widgets.example.com',
        kind: 'CustomResourceDefinition',
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          kind: 'CustomResourceDefinition',
          name: 'widgets.example.com',
          group: 'example.com',
          scope: 'Namespaced',
          details: 'Versions: v1',
          age: '1m',
          typeAlias: 'CRD',
        },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getDomainState('cluster-crds');
    expect(state.data?.definitions?.[0]?.name).toBe('widgets.example.com');
  });

  test('applies cluster custom updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('cluster-custom', storeScope);

    setDomainState('cluster-custom', () => ({
      status: 'ready',
      data: { resources: [] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'cluster-custom',
        scope: '',
        resourceVersion: '7',
        name: 'cluster-widget',
        kind: 'Widget',
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          kind: 'Widget',
          name: 'cluster-widget',
          apiGroup: 'example.com',
          age: '1m',
        },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getDomainState('cluster-custom');
    expect(state.data?.resources?.[0]?.name).toBe('cluster-widget');
  });

  test('resyncs on out-of-order resource versions', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('nodes', storeScope);

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'nodes',
        scope: '',
        resourceVersion: '10',
        row: { name: 'node-a', status: 'Ready', clusterId: 'cluster-a' },
      })
    );
    vi.advanceTimersByTime(200);

    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'nodes',
        scope: '',
        version: 11,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { nodes: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'MODIFIED',
        domain: 'nodes',
        scope: '',
        resourceVersion: '5',
        row: { name: 'node-a', status: 'Ready', clusterId: 'cluster-a' },
      })
    );

    await flushPromises();

    expect(fetchSnapshotMock).toHaveBeenCalled();
    const state = getDomainState('nodes');
    expect(state.status).toBe('ready');
    expect(state.data?.nodes).toEqual([]);
  });

  test('resyncs on reset messages', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-workloads', storeScope);

    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'namespace-workloads',
        scope: 'namespace:default',
        version: 9,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { workloads: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'RESET',
        domain: 'namespace-workloads',
        scope: 'namespace:default',
      })
    );

    await flushPromises();

    expect(fetchSnapshotMock).toHaveBeenCalled();
  });

  test('resyncs after connection errors', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('pods', storeScope);

    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'pods',
        scope: 'namespace:default',
        version: 4,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { pods: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });

    manager.handleConnectionError('cluster-a', 'connection lost');

    await flushPromises();

    expect(fetchSnapshotMock).toHaveBeenCalled();
    const state = getScopedDomainState('pods', storeScope);
    expect(state.status).toBe('ready');
  });

  test('does not resync on connection error when resume sequence exists', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('pods', storeScope);

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'pods',
        scope: 'namespace:default',
        resourceVersion: '1',
        sequence: '1',
        uid: 'pod-1',
        name: 'pod-1',
        namespace: 'default',
        kind: 'Pod',
        row: {
          name: 'pod-1',
          namespace: 'default',
        },
      })
    );

    manager.handleConnectionError('cluster-a', 'connection lost');

    await flushPromises();

    expect(fetchSnapshotMock).not.toHaveBeenCalled();
  });

  test('reconnects and resubscribes after socket close', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], 'namespace:default');

    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'pods',
        scope: 'namespace:default',
        version: 1,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { pods: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });
    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'pods',
        scope: 'namespace:default',
        version: 2,
        checksum: 'etag-2',
        generatedAt: Date.now(),
        sequence: 2,
        payload: { pods: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });

    await manager.start('pods', storeScope);
    await flushPromises();

    const firstSocket = createdSockets[0];
    expect(firstSocket).toBeDefined();
    firstSocket.onopen?.(new Event('open'));
    expect(firstSocket.send).toHaveBeenCalled();

    // Advance time so the resync cooldown elapses before simulating a disconnect.
    vi.advanceTimersByTime(1100);
    firstSocket.onclose?.();

    await flushPromises();
    // Allow jittered reconnect delay to elapse.
    vi.advanceTimersByTime(1500);
    await flushPromises();

    const secondSocket = createdSockets[1];
    expect(secondSocket).toBeDefined();
    secondSocket.onopen?.(new Event('open'));
    expect(secondSocket.send).toHaveBeenCalled();
    expect(fetchSnapshotMock).toHaveBeenCalledTimes(2);
  });

  test('recovers from stale updates after a resync', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], '');

    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'nodes',
        scope: '',
        version: 10,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { nodes: [{ name: 'node-a', status: 'NotReady', clusterId: 'cluster-a' }] },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      notModified: false,
    });
    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'nodes',
        scope: '',
        version: 11,
        checksum: 'etag-2',
        generatedAt: Date.now(),
        sequence: 2,
        payload: { nodes: [{ name: 'node-a', status: 'NotReady', clusterId: 'cluster-a' }] },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      notModified: false,
    });

    await manager.start('nodes', storeScope);
    await flushPromises();

    vi.advanceTimersByTime(1100);
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'MODIFIED',
        domain: 'nodes',
        scope: '',
        resourceVersion: '5',
        name: 'node-a',
        row: { name: 'node-a', status: 'Unknown', clusterId: 'cluster-a' },
      })
    );

    await flushPromises();

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'MODIFIED',
        domain: 'nodes',
        scope: '',
        resourceVersion: '12',
        name: 'node-a',
        row: { name: 'node-a', status: 'Ready', clusterId: 'cluster-a' },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getDomainState('nodes');
    expect(state.data?.nodes?.[0]?.status).toBe('Ready');
    expect(fetchSnapshotMock).toHaveBeenCalledTimes(2);
  });

  test('debounces unsubscribe before sending cancel', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], '');

    fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'nodes',
        scope: '',
        version: 1,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { nodes: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });

    await manager.start('nodes', storeScope);
    await flushPromises();

    const socket = createdSockets[0];
    expect(socket).toBeDefined();

    const cancelCount = () =>
      socket.send.mock.calls.filter(([payload]) => JSON.parse(payload).type === 'CANCEL').length;

    manager.stop('nodes', storeScope, false);
    expect(cancelCount()).toBe(0);

    vi.runOnlyPendingTimers();

    expect(cancelCount()).toBe(1);
  });

  test('cancels pending unsubscribe when resubscribed', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], '');

    fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'nodes',
        scope: '',
        version: 1,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { nodes: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });

    await manager.start('nodes', storeScope);
    await flushPromises();

    const socket = createdSockets[0];
    expect(socket).toBeDefined();

    const cancelCount = () =>
      socket.send.mock.calls.filter(([payload]) => JSON.parse(payload).type === 'CANCEL').length;

    manager.stop('nodes', storeScope, false);
    expect(cancelCount()).toBe(0);

    await manager.start('nodes', storeScope);
    await flushPromises();

    vi.runOnlyPendingTimers();

    expect(cancelCount()).toBe(0);
  });

  it('starts node streaming for each cluster in a multi-cluster scope', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a', 'cluster-b'], '');

    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'nodes',
        scope: '',
        version: 1,
        checksum: 'etag-a',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { nodes: [{ name: 'node-a', status: 'Ready', clusterId: 'cluster-a' }] },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      notModified: false,
    });
    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'nodes',
        scope: '',
        version: 1,
        checksum: 'etag-b',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { nodes: [{ name: 'node-b', status: 'Ready', clusterId: 'cluster-b' }] },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      notModified: false,
    });

    await manager.start('nodes', storeScope);
    await flushPromises();

    expect(fetchSnapshotMock).toHaveBeenCalledTimes(2);
    expect(createdSockets).toHaveLength(1);
    const socket = createdSockets[0];
    expect(socket).toBeDefined();
    socket.onopen?.(new Event('open'));
    const requests = socket.send.mock.calls
      .map(([payload]) => JSON.parse(payload))
      .filter((message) => message.type === 'REQUEST');
    const scopesByCluster = new Map(requests.map((message) => [message.clusterId, message.scope]));
    expect(scopesByCluster.get('cluster-a')).toBe('cluster-a|');
    expect(scopesByCluster.get('cluster-b')).toBe('cluster-b|');
  });

  test('merges pod updates from multiple clusters into a multi-cluster scope', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a', 'cluster-b'], 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('pods', storeScope);

    setScopedDomainState('pods', storeScope, () => ({
      status: 'ready',
      data: { pods: [] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'pods',
        scope: 'namespace:default',
        resourceVersion: '2',
        name: 'pod-a',
        namespace: 'default',
        row: {
          clusterId: 'cluster-a',
          name: 'pod-a',
          namespace: 'default',
          status: 'Running',
          ready: '1/1',
          restarts: 0,
          age: '1m',
          ownerKind: 'Deployment',
          ownerName: 'web',
          node: 'node-a',
        },
      })
    );

    manager.handleMessage(
      'cluster-b',
      JSON.stringify({
        type: 'ADDED',
        domain: 'pods',
        scope: 'namespace:default',
        resourceVersion: '3',
        name: 'pod-b',
        namespace: 'default',
        row: {
          clusterId: 'cluster-b',
          name: 'pod-b',
          namespace: 'default',
          status: 'Pending',
          ready: '0/1',
          restarts: 0,
          age: '2m',
          ownerKind: 'Deployment',
          ownerName: 'api',
          node: 'node-b',
        },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getScopedDomainState('pods', storeScope);
    expect(state.data?.pods).toHaveLength(2);
    const clusterIds = (state.data?.pods ?? []).map((pod) => pod.clusterId).sort();
    expect(clusterIds).toEqual(['cluster-a', 'cluster-b']);
  });

  test('resyncs a single cluster workload without dropping other clusters', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a', 'cluster-b'], 'namespace:default');

    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'namespace-workloads',
        scope: 'namespace:default',
        version: 5,
        checksum: 'etag-a',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          workloads: [
            {
              clusterId: 'cluster-a',
              kind: 'Deployment',
              name: 'web',
              namespace: 'default',
              status: 'Healthy',
              pods: '1/1',
              age: '2m',
            },
          ],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      notModified: false,
    });
    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'namespace-workloads',
        scope: 'namespace:default',
        version: 6,
        checksum: 'etag-b',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          workloads: [
            {
              clusterId: 'cluster-b',
              kind: 'Deployment',
              name: 'api',
              namespace: 'default',
              status: 'Healthy',
              pods: '2/2',
              age: '3m',
            },
          ],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      notModified: false,
    });
    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'namespace-workloads',
        scope: 'namespace:default',
        version: 7,
        checksum: 'etag-a-2',
        generatedAt: Date.now(),
        sequence: 2,
        payload: {
          workloads: [
            {
              clusterId: 'cluster-a',
              kind: 'Deployment',
              name: 'web',
              namespace: 'default',
              status: 'Degraded',
              pods: '0/1',
              age: '4m',
            },
          ],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      notModified: false,
    });

    await manager.start('namespace-workloads', storeScope);
    await flushPromises();

    const initialState = getDomainState('namespace-workloads');
    expect(initialState.data?.workloads).toHaveLength(2);

    vi.advanceTimersByTime(1100);
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'MODIFIED',
        domain: 'namespace-workloads',
        scope: 'namespace:default',
        resourceVersion: '1',
        name: 'web',
        namespace: 'default',
        kind: 'Deployment',
        row: {
          clusterId: 'cluster-a',
          kind: 'Deployment',
          name: 'web',
          namespace: 'default',
          status: 'Degraded',
          pods: '0/1',
          age: '4m',
        },
      })
    );

    await flushPromises();

    const state = getDomainState('namespace-workloads');
    const names = (state.data?.workloads ?? []).map((row) => row.name).sort();
    expect(names).toEqual(['api', 'web']);
  });
});
