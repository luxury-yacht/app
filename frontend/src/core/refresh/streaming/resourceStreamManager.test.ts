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
  resetAllScopedDomainStates('pods');
});

afterEach(() => {
  resetDomainState('nodes');
  resetDomainState('namespace-workloads');
  resetDomainState('namespace-config');
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

  it('normalizes node scopes', () => {
    expect(normalizeResourceScope('nodes', '')).toBe('');
    expect(normalizeResourceScope('nodes', 'cluster')).toBe('');
    expect(() => normalizeResourceScope('nodes', 'namespace:default')).toThrow();
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
    (manager as unknown as { ensureSubscription: (...args: unknown[]) => void }).ensureSubscription(
      'pods',
      storeScope
    );

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
    (manager as unknown as { ensureSubscription: (...args: unknown[]) => void }).ensureSubscription(
      'namespace-config',
      storeScope
    );

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

  test('resyncs on out-of-order resource versions', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScopeList(['cluster-a'], '');
    (manager as unknown as { ensureSubscription: (...args: unknown[]) => void }).ensureSubscription(
      'nodes',
      storeScope
    );

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
    (manager as unknown as { ensureSubscription: (...args: unknown[]) => void }).ensureSubscription(
      'namespace-workloads',
      storeScope
    );

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
    (manager as unknown as { ensureSubscription: (...args: unknown[]) => void }).ensureSubscription(
      'pods',
      storeScope
    );

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
    vi.advanceTimersByTime(1000);
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
});
