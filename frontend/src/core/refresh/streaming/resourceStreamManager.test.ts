/**
 * frontend/src/core/refresh/streaming/resourceStreamManager.test.ts
 *
 * Test suite for resource stream helpers.
 */

import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';

const ensureRefreshBaseURLMock = vi.hoisted(() => vi.fn(async () => 'http://127.0.0.1:0'));
const fetchSnapshotMock = vi.hoisted(() => vi.fn());
const invalidateRefreshBaseURLMock = vi.hoisted(() => vi.fn());
const logAppLogsInfoMock = vi.hoisted(() => vi.fn());
const logAppLogsWarnMock = vi.hoisted(() => vi.fn());
const errorHandlerMock = vi.hoisted(() => ({
  handle: vi.fn(),
}));

const createdSockets: FakeWebSocket[] = [];

vi.mock('../client', () => ({
  ensureRefreshBaseURL: ensureRefreshBaseURLMock,
  fetchSnapshot: fetchSnapshotMock,
  invalidateRefreshBaseURL: invalidateRefreshBaseURLMock,
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

vi.mock('@/core/logging/appLogsClient', () => ({
  APP_LOG_SOURCES: {
    ResourceStream: 'ResourceStream',
  },
  logAppLogsInfo: logAppLogsInfoMock,
  logAppLogsWarn: logAppLogsWarnMock,
}));

import { buildClusterScope } from '../clusterScope';
import { getScopedDomainState, resetAllScopedDomainStates, setScopedDomainState } from '../store';
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

const resourceRef = ({
  clusterId = 'cluster-a',
  group = '',
  version = 'v1',
  kind,
  resource,
  namespace,
  name,
}: {
  clusterId?: string;
  group?: string;
  version?: string;
  kind: string;
  resource?: string;
  namespace?: string;
  name: string;
}) => ({
  clusterId,
  group,
  version,
  kind,
  resource,
  namespace,
  name,
});

beforeEach(() => {
  ensureRefreshBaseURLMock.mockReset();
  ensureRefreshBaseURLMock.mockResolvedValue('http://127.0.0.1:0');
  fetchSnapshotMock.mockReset();
  invalidateRefreshBaseURLMock.mockReset();
  logAppLogsInfoMock.mockClear();
  logAppLogsWarnMock.mockClear();
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

  resetAllScopedDomainStates('nodes');
  resetAllScopedDomainStates('namespace-workloads');
  resetAllScopedDomainStates('namespace-config');
  resetAllScopedDomainStates('namespace-network');
  resetAllScopedDomainStates('namespace-rbac');
  resetAllScopedDomainStates('namespace-custom');
  resetAllScopedDomainStates('namespace-helm');
  resetAllScopedDomainStates('namespace-autoscaling');
  resetAllScopedDomainStates('namespace-quotas');
  resetAllScopedDomainStates('namespace-storage');
  resetAllScopedDomainStates('cluster-rbac');
  resetAllScopedDomainStates('cluster-storage');
  resetAllScopedDomainStates('cluster-config');
  resetAllScopedDomainStates('cluster-crds');
  resetAllScopedDomainStates('cluster-custom');
  resetAllScopedDomainStates('pods');
});

afterEach(() => {
  resetAllScopedDomainStates('nodes');
  resetAllScopedDomainStates('namespace-workloads');
  resetAllScopedDomainStates('namespace-config');
  resetAllScopedDomainStates('namespace-network');
  resetAllScopedDomainStates('namespace-rbac');
  resetAllScopedDomainStates('namespace-custom');
  resetAllScopedDomainStates('namespace-helm');
  resetAllScopedDomainStates('namespace-autoscaling');
  resetAllScopedDomainStates('namespace-quotas');
  resetAllScopedDomainStates('namespace-storage');
  resetAllScopedDomainStates('cluster-rbac');
  resetAllScopedDomainStates('cluster-storage');
  resetAllScopedDomainStates('cluster-config');
  resetAllScopedDomainStates('cluster-crds');
  resetAllScopedDomainStates('cluster-custom');
  resetAllScopedDomainStates('pods');
  delete (globalThis as any).WebSocket;
  vi.useRealTimers();
});

describe('resourceStreamManager helpers', () => {
  it('normalizes pod scopes', () => {
    expect(normalizeResourceScope('pods', 'namespace:default')).toBe('namespace:default');
    expect(normalizeResourceScope('pods', 'namespace:*')).toBe('namespace:all');
    expect(normalizeResourceScope('pods', 'node:node-a')).toBe('node:node-a');
    expect(normalizeResourceScope('pods', 'workload:default:apps:v1:Deployment:web')).toBe(
      'workload:default:apps:v1:Deployment:web'
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
      clusterId: 'test-cluster',
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
      clusterId: 'test-cluster',
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

  it('uses incoming HPA-managed workload state when preserving metrics', () => {
    const existing = {
      clusterId: 'test-cluster',
      kind: 'Deployment',
      name: 'web',
      namespace: 'default',
      ready: '2/3',
      status: 'Healthy',
      restarts: 0,
      age: '1m',
      cpuUsage: '60m',
      memUsage: '40Mi',
      hpaManaged: true,
    };
    const incoming = {
      clusterId: existing.clusterId,
      kind: existing.kind,
      name: existing.name,
      namespace: existing.namespace,
      ready: '3/3',
      status: existing.status,
      restarts: existing.restarts,
      age: existing.age,
      cpuUsage: '5m',
      memUsage: '8Mi',
      hpaManaged: false,
    };
    const merged = mergeWorkloadMetricsRow(existing, incoming, true);

    expect(merged.ready).toBe('3/3');
    expect(merged.hpaManaged).toBe(false);
  });

  it('reuses the existing workload row when an incoming update is unchanged', () => {
    const existing = {
      clusterId: 'test-cluster',
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
    const merged = mergeWorkloadMetricsRow(existing, { ...existing }, false);
    expect(merged).toBe(existing);
  });

  it('merges node metrics when requested', () => {
    const existing = {
      clusterId: 'test-cluster',
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
  test('pod delta is notify-only: bumps streamRevision and leaves rows untouched', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
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
      data: { rows: [existing], clusterId: 'test-cluster' },
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
        ref: resourceRef({ kind: 'Pod', namespace: 'default', name: 'pod-a' }),
        // The backend ships no row for notify-only pods; even if one slipped through
        // the frontend must not apply it. The query-backed table refetches instead.
        row: { ...existing, status: 'Pending', cpuUsage: '5m', memUsage: '8Mi' },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getScopedDomainState('pods', storeScope);
    // streamRevision bumps (refetch trigger); the seeded row is left untouched.
    expect(state.streamRevision).toBe(1);
    expect(state.data?.rows?.[0]?.status).toBe('Running');
    expect(state.data?.rows?.[0]?.cpuUsage).toBe('50m');
  });

  test('notify-only domain delta bumps streamRevision and never retains rows', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-workloads', storeScope);

    // namespace-workloads is notify-only: the backend ships the change signal
    // (Ref/ResourceVersion) without a row. The frontend must bump streamRevision
    // — so the query-backed table refetches — and leave the row list untouched.
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'MODIFIED',
        domain: 'namespace-workloads',
        scope: 'namespace:default',
        resourceVersion: '7',
        name: 'web',
        namespace: 'default',
        kind: 'Deployment',
        ref: resourceRef({ group: 'apps', kind: 'Deployment', namespace: 'default', name: 'web' }),
      })
    );

    vi.advanceTimersByTime(200);

    const state = getScopedDomainState('namespace-workloads', storeScope);
    expect(state.streamRevision).toBe(1);
    expect(state.data?.rows ?? []).toEqual([]);
  });

  test('ignores unchanged workload update messages without replacing the workload list', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-workloads', storeScope);

    const existingWorkload = {
      clusterId: 'cluster-a',
      kind: 'Deployment',
      name: 'web',
      namespace: 'default',
      status: 'Healthy',
      ready: '1/1',
      restarts: 0,
      age: '2m',
    };

    setScopedDomainState('namespace-workloads', storeScope, (previous) => ({
      ...previous,
      status: 'ready',
      data: {
        clusterId: 'cluster-a',
        rows: [existingWorkload],
      },
      scope: storeScope,
      error: null,
    }));

    const previousState = getScopedDomainState('namespace-workloads', storeScope);
    const previousRows = previousState.data?.rows;

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
        ref: resourceRef({
          group: 'apps',
          kind: 'Deployment',
          namespace: 'default',
          name: 'web',
        }),
        row: { ...existingWorkload },
      })
    );

    await flushPromises();

    const nextState = getScopedDomainState('namespace-workloads', storeScope);
    expect(nextState).toBe(previousState);
    expect(nextState.data?.rows).toBe(previousRows);
    expect(nextState.data?.rows?.[0]).toBe(existingWorkload);
  });

  test('reuses workload rows when an identical workload snapshot is applied', () => {
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    const existingWorkload = {
      clusterId: 'cluster-a',
      kind: 'Deployment',
      name: 'web',
      namespace: 'default',
      status: 'Healthy',
      ready: '1/1',
      restarts: 0,
      age: '2m',
    };

    setScopedDomainState('namespace-workloads', storeScope, (previous) => ({
      ...previous,
      status: 'ready',
      data: {
        clusterId: 'cluster-a',
        rows: [existingWorkload],
      },
      scope: storeScope,
      error: null,
    }));

    const previousRows = getScopedDomainState('namespace-workloads', storeScope).data?.rows;

    (
      manager as unknown as {
        applySnapshot: (
          subscription: Record<string, unknown>,
          snapshot: Record<string, unknown>
        ) => void;
      }
    ).applySnapshot(
      {
        domain: 'namespace-workloads',
        reportScope: storeScope,
        clusterId: 'cluster-a',
      },
      {
        generatedAt: Date.now(),
        version: 9,
        checksum: 'etag-identical',
        payload: {
          clusterId: 'cluster-a',
          rows: [{ ...existingWorkload }],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      }
    );

    const nextState = getScopedDomainState('namespace-workloads', storeScope);
    expect(nextState.data?.rows).toBe(previousRows);
    expect(nextState.data?.rows?.[0]).toBe(existingWorkload);
  });

  test('applies namespace config updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-config', storeScope);

    setScopedDomainState('namespace-config', storeScope, () => ({
      status: 'ready',
      data: { rows: [], clusterId: 'test-cluster' },
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
        ref: resourceRef({ kind: 'ConfigMap', namespace: 'default', name: 'config-a' }),
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

    const state = getScopedDomainState('namespace-config', storeScope);
    expect(state.data?.rows?.[0]?.name).toBe('config-a');
  });

  // The typed query refetches only when the live-data identity
  // (version/checksum/streamRevision) changes. Streamed row updates do not carry
  // a new backend snapshot version, so they must bump streamRevision or the
  // query-backed views never see streamed changes.
  test('streamed row updates bump streamRevision; identical updates do not', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-config', storeScope);

    setScopedDomainState('namespace-config', storeScope, () => ({
      status: 'ready',
      data: { rows: [], clusterId: 'cluster-a' },
      stats: null,
      version: 7,
      checksum: 'abc',
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    const configRow = {
      clusterId: 'cluster-a',
      clusterName: 'cluster-a',
      kind: 'ConfigMap',
      typeAlias: 'CM',
      name: 'config-a',
      namespace: 'default',
      data: 2,
      age: '1m',
    };
    const updateMessage = (row: typeof configRow, resourceVersion: string) =>
      JSON.stringify({
        type: 'MODIFIED',
        domain: 'namespace-config',
        scope: 'namespace:default',
        resourceVersion,
        name: 'config-a',
        namespace: 'default',
        kind: 'ConfigMap',
        ref: resourceRef({ kind: 'ConfigMap', namespace: 'default', name: 'config-a' }),
        row,
      });

    manager.handleMessage('cluster-a', updateMessage(configRow, '3'));
    vi.advanceTimersByTime(200);

    const afterAdd = getScopedDomainState('namespace-config', storeScope);
    expect(afterAdd.streamRevision).toBe(1);
    // The backend snapshot identity is untouched — only the stream revision moves.
    expect(afterAdd.version).toBe(7);
    expect(afterAdd.checksum).toBe('abc');

    // An identical update changes nothing, so the revision must not churn.
    manager.handleMessage('cluster-a', updateMessage({ ...configRow }, '4'));
    vi.advanceTimersByTime(200);
    expect(getScopedDomainState('namespace-config', storeScope).streamRevision).toBe(1);

    // A real change bumps it again.
    manager.handleMessage('cluster-a', updateMessage({ ...configRow, data: 3 }, '5'));
    vi.advanceTimersByTime(200);
    expect(getScopedDomainState('namespace-config', storeScope).streamRevision).toBe(2);
  });

  test('applies updates when cluster id mismatches but scope is unique', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-config', storeScope);

    setScopedDomainState('namespace-config', storeScope, () => ({
      status: 'ready',
      data: { rows: [], clusterId: 'test-cluster' },
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
        clusterId: 'backend-id',
        ref: resourceRef({ kind: 'ConfigMap', namespace: 'default', name: 'config-a' }),
        row: {
          clusterId: 'backend-id',
          clusterName: 'backend-id',
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

    const state = getScopedDomainState('namespace-config', storeScope);
    expect(state.data?.rows?.[0]?.clusterId).toBe('cluster-a');
  });

  test('applies updates when scope includes a cluster prefix', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-config', storeScope);

    setScopedDomainState('namespace-config', storeScope, () => ({
      status: 'ready',
      data: { rows: [], clusterId: 'test-cluster' },
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
        scope: 'cluster-a|namespace:default',
        resourceVersion: '3',
        name: 'config-a',
        namespace: 'default',
        kind: 'ConfigMap',
        ref: resourceRef({ kind: 'ConfigMap', namespace: 'default', name: 'config-a' }),
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

    const state = getScopedDomainState('namespace-config', storeScope);
    expect(state.data?.rows?.[0]?.name).toBe('config-a');
  });

  test('applies namespace network updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-network', storeScope);

    setScopedDomainState('namespace-network', storeScope, () => ({
      status: 'ready',
      data: { rows: [], clusterId: 'test-cluster' },
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
        ref: resourceRef({ kind: 'Service', namespace: 'default', name: 'svc-a' }),
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

    const state = getScopedDomainState('namespace-network', storeScope);
    expect(state.data?.rows?.[0]?.name).toBe('svc-a');
  });

  test('applies namespace rbac updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-rbac', storeScope);

    setScopedDomainState('namespace-rbac', storeScope, () => ({
      status: 'ready',
      data: { rows: [], clusterId: 'test-cluster' },
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
        ref: resourceRef({
          group: 'rbac.authorization.k8s.io',
          kind: 'Role',
          namespace: 'default',
          name: 'role-a',
        }),
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

    const state = getScopedDomainState('namespace-rbac', storeScope);
    expect(state.data?.rows?.[0]?.name).toBe('role-a');
  });

  test('applies namespace custom updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-custom', storeScope);

    setScopedDomainState('namespace-custom', storeScope, () => ({
      status: 'ready',
      data: { resources: [], clusterId: 'test-cluster' },
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
        ref: resourceRef({
          group: 'example.com',
          version: 'v1',
          kind: 'Widget',
          namespace: 'default',
          name: 'widget-a',
        }),
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

    const state = getScopedDomainState('namespace-custom', storeScope);
    expect(state.data?.resources?.[0]?.name).toBe('widget-a');
  });

  test('keeps same-kind namespace custom resources from different API groups distinct', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-custom', storeScope);

    setScopedDomainState('namespace-custom', storeScope, () => ({
      status: 'ready',
      data: { resources: [], clusterId: 'cluster-a' },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    const common = {
      type: 'ADDED',
      domain: 'namespace-custom',
      scope: 'namespace:default',
      namespace: 'default',
      kind: 'Widget',
      name: 'shared',
    };
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        ...common,
        resourceVersion: '4',
        apiGroup: 'alpha.example.com',
        apiVersion: 'v1',
        ref: resourceRef({
          group: 'alpha.example.com',
          version: 'v1',
          kind: 'Widget',
          namespace: 'default',
          name: 'shared',
        }),
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          namespace: 'default',
          apiGroup: 'alpha.example.com',
          apiVersion: 'v1',
          kind: 'Widget',
          name: 'shared',
          age: '1m',
        },
      })
    );
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        ...common,
        resourceVersion: '5',
        apiGroup: 'beta.example.com',
        apiVersion: 'v1',
        ref: resourceRef({
          group: 'beta.example.com',
          version: 'v1',
          kind: 'Widget',
          namespace: 'default',
          name: 'shared',
        }),
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          namespace: 'default',
          apiGroup: 'beta.example.com',
          apiVersion: 'v1',
          kind: 'Widget',
          name: 'shared',
          age: '1m',
        },
      })
    );

    vi.advanceTimersByTime(200);

    const rows = getScopedDomainState('namespace-custom', storeScope).data?.resources ?? [];
    expect(rows.map((row) => row.apiGroup).sort()).toEqual([
      'alpha.example.com',
      'beta.example.com',
    ]);
  });

  test('reuses namespace custom rows when an unchanged update is applied', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-custom', storeScope);

    const existingResource = {
      clusterId: 'cluster-a',
      clusterName: 'cluster-a',
      kind: 'Widget',
      name: 'widget-a',
      namespace: 'default',
      apiGroup: 'example.com',
      apiVersion: 'v1alpha1',
      age: '1m',
      labels: { app: 'demo' },
    };

    setScopedDomainState('namespace-custom', storeScope, (previous) => ({
      ...previous,
      status: 'ready',
      data: {
        clusterId: 'cluster-a',
        resources: [existingResource],
      },
      scope: storeScope,
      error: null,
    }));

    const previousState = getScopedDomainState('namespace-custom', storeScope);
    const previousRows = previousState.data?.resources;

    vi.advanceTimersByTime(1100);
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'MODIFIED',
        domain: 'namespace-custom',
        scope: 'namespace:default',
        resourceVersion: '1',
        name: 'widget-a',
        namespace: 'default',
        kind: 'Widget',
        ref: resourceRef({
          group: 'example.com',
          version: 'v1alpha1',
          kind: 'Widget',
          namespace: 'default',
          name: 'widget-a',
        }),
        row: { ...existingResource },
      })
    );

    await flushPromises();

    const nextState = getScopedDomainState('namespace-custom', storeScope);
    expect(nextState).toBe(previousState);
    expect(nextState.data?.resources).toBe(previousRows);
    expect(nextState.data?.resources?.[0]).toBe(existingResource);
  });

  test('reuses namespace custom rows when an identical custom snapshot is applied', () => {
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    const existingResource = {
      clusterId: 'cluster-a',
      clusterName: 'cluster-a',
      kind: 'Widget',
      name: 'widget-a',
      namespace: 'default',
      apiGroup: 'example.com',
      apiVersion: 'v1alpha1',
      age: '1m',
      labels: { app: 'demo' },
    };

    setScopedDomainState('namespace-custom', storeScope, (previous) => ({
      ...previous,
      status: 'ready',
      data: {
        clusterId: 'cluster-a',
        resources: [existingResource],
      },
      scope: storeScope,
      error: null,
    }));

    const previousRows = getScopedDomainState('namespace-custom', storeScope).data?.resources;

    (
      manager as unknown as {
        applySnapshot: (
          subscription: Record<string, unknown>,
          snapshot: Record<string, unknown>
        ) => void;
      }
    ).applySnapshot(
      {
        domain: 'namespace-custom',
        reportScope: storeScope,
        clusterId: 'cluster-a',
      },
      {
        generatedAt: Date.now(),
        version: 9,
        checksum: 'etag-identical',
        payload: {
          clusterId: 'cluster-a',
          resources: [{ ...existingResource }],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      }
    );

    const nextState = getScopedDomainState('namespace-custom', storeScope);
    expect(nextState.data?.resources).toBe(previousRows);
    expect(nextState.data?.resources?.[0]).toBe(existingResource);
  });

  test('resyncs namespace helm updates instead of mutating rows directly', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-helm', storeScope);

    const existingRow = {
      clusterId: 'cluster-a',
      clusterName: 'cluster-a',
      name: 'release-a',
      namespace: 'default',
      chart: 'demo-1.0.0',
      appVersion: '1.0.0',
      status: 'deployed',
      revision: 1,
      updated: '2024-01-01T00:00:00Z',
      age: '2m',
    };
    const snapshotRow = {
      ...existingRow,
      status: 'superseded',
      revision: 2,
      age: '1m',
    };
    const rowUpdate = {
      ...existingRow,
      status: 'targeted-row-update',
      revision: 3,
    };

    setScopedDomainState('namespace-helm', storeScope, () => ({
      status: 'ready',
      data: { rows: [existingRow], clusterId: 'cluster-a' },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'namespace-helm',
        scope: 'namespace:default',
        version: 5,
        checksum: 'helm-resync',
        generatedAt: Date.now(),
        payload: {
          rows: [snapshotRow],
          clusterId: 'cluster-a',
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      notModified: false,
    });

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'MODIFIED',
        domain: 'namespace-helm',
        scope: 'namespace:default',
        resourceVersion: '4',
        name: 'release-a',
        namespace: 'default',
        ref: resourceRef({
          group: 'helm.sh',
          version: 'v3',
          kind: 'HelmRelease',
          namespace: 'default',
          name: 'release-a',
        }),
        row: rowUpdate,
      })
    );

    await flushPromises();

    const state = getScopedDomainState('namespace-helm', storeScope);
    expect(fetchSnapshotMock).toHaveBeenCalledTimes(1);
    expect(state.data?.rows?.[0]?.status).toBe('superseded');
    expect(state.data?.rows?.[0]?.revision).toBe(2);
    expect(state.data?.rows?.[0]?.status).not.toBe('targeted-row-update');
  });

  test('resyncs namespace helm COMPLETE messages as scope-level changes', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-helm', storeScope);

    const existingRow = {
      clusterId: 'cluster-a',
      clusterName: 'cluster-a',
      name: 'release-a',
      namespace: 'default',
      chart: 'demo-1.0.0',
      appVersion: '1.0.0',
      status: 'deployed',
      revision: 1,
      updated: '2024-01-01T00:00:00Z',
      age: '2m',
    };
    const snapshotRow = {
      ...existingRow,
      status: 'failed',
      revision: 4,
      age: '1m',
    };

    setScopedDomainState('namespace-helm', storeScope, () => ({
      status: 'ready',
      data: { rows: [existingRow], clusterId: 'cluster-a' },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'namespace-helm',
        scope: 'namespace:default',
        version: 6,
        checksum: 'helm-complete',
        generatedAt: Date.now(),
        payload: {
          rows: [snapshotRow],
          clusterId: 'cluster-a',
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      notModified: false,
    });

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'COMPLETE',
        domain: 'namespace-helm',
        scope: 'namespace:default',
        resourceVersion: '6',
        ref: resourceRef({
          group: 'helm.sh',
          version: 'v3',
          kind: 'HelmRelease',
          namespace: 'default',
          name: 'release-a',
        }),
      })
    );

    await flushPromises();

    const state = getScopedDomainState('namespace-helm', storeScope);
    expect(fetchSnapshotMock).toHaveBeenCalledTimes(1);
    expect(state.data?.rows?.[0]?.status).toBe('failed');
    expect(state.data?.rows?.[0]?.revision).toBe(4);
  });

  test('reuses namespace helm rows when an identical helm snapshot is applied', () => {
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-helm', storeScope);

    const sharedRow = {
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
    };

    setScopedDomainState('namespace-helm', storeScope, () => ({
      status: 'ready',
      data: { rows: [sharedRow], clusterId: 'cluster-a' },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));
    const previousRows = getScopedDomainState('namespace-helm', storeScope).data?.rows;

    (
      manager as unknown as {
        applySnapshot: (
          subscription: Record<string, unknown>,
          snapshot: Record<string, unknown>
        ) => void;
      }
    ).applySnapshot(
      {
        domain: 'namespace-helm',
        reportScope: storeScope,
        clusterId: 'cluster-a',
      },
      {
        generatedAt: Date.now(),
        version: 7,
        checksum: 'helm-checksum',
        payload: {
          rows: [{ ...sharedRow }],
          clusterId: 'cluster-a',
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      }
    );

    const state = getScopedDomainState('namespace-helm', storeScope);
    expect(state.data?.rows).toBe(previousRows);
    expect(state.data?.rows?.[0]).toBe(sharedRow);
  });

  test('applies namespace autoscaling updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-autoscaling', storeScope);

    setScopedDomainState('namespace-autoscaling', storeScope, () => ({
      status: 'ready',
      data: { rows: [], clusterId: 'test-cluster' },
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
        ref: resourceRef({
          group: 'autoscaling',
          version: 'v2',
          kind: 'HorizontalPodAutoscaler',
          namespace: 'default',
          name: 'hpa-a',
        }),
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

    const state = getScopedDomainState('namespace-autoscaling', storeScope);
    expect(state.data?.rows?.[0]?.name).toBe('hpa-a');
  });

  test('reuses namespace autoscaling rows when an unchanged update is applied', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-autoscaling', storeScope);

    const sharedRow = {
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
    };

    setScopedDomainState('namespace-autoscaling', storeScope, () => ({
      status: 'ready',
      data: { rows: [sharedRow], clusterId: 'cluster-a' },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));
    const previousRows = getScopedDomainState('namespace-autoscaling', storeScope).data?.rows;

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'MODIFIED',
        domain: 'namespace-autoscaling',
        scope: 'namespace:default',
        resourceVersion: '5',
        name: 'hpa-a',
        namespace: 'default',
        kind: 'HorizontalPodAutoscaler',
        ref: resourceRef({
          group: 'autoscaling',
          version: 'v2',
          kind: 'HorizontalPodAutoscaler',
          namespace: 'default',
          name: 'hpa-a',
        }),
        row: { ...sharedRow },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getScopedDomainState('namespace-autoscaling', storeScope);
    expect(state.data?.rows).toBeDefined();
    expect(state.data?.rows).toHaveLength(1);
    expect(state.data?.rows).toBe(previousRows);
    expect(state.data?.rows?.[0]).toBe(sharedRow);
  });

  test('reuses namespace autoscaling rows when an identical autoscaling snapshot is applied', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-autoscaling', storeScope);

    const sharedRow = {
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
    };

    setScopedDomainState('namespace-autoscaling', storeScope, () => ({
      status: 'ready',
      data: {
        rows: [sharedRow],
        kinds: ['HorizontalPodAutoscaler'],
        clusterId: 'cluster-a',
      },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    const previousRows = getScopedDomainState('namespace-autoscaling', storeScope).data?.rows;

    await (
      manager as unknown as {
        applySnapshot: (
          subscription: Record<string, unknown>,
          snapshot: Record<string, unknown>
        ) => Promise<void>;
      }
    ).applySnapshot(
      {
        domain: 'namespace-autoscaling',
        reportScope: storeScope,
        clusterId: 'cluster-a',
      },
      {
        payload: {
          rows: [{ ...sharedRow }],
          kinds: ['HorizontalPodAutoscaler'],
          clusterId: 'cluster-a',
        },
        stats: { total: 1, returned: 1, totalAvailable: 1 },
        version: 7,
        checksum: 'autoscaling-checksum',
        generatedAt: Date.now(),
      }
    );

    const state = getScopedDomainState('namespace-autoscaling', storeScope);
    expect(state.data?.rows).toBe(previousRows);
    expect(state.data?.rows?.[0]).toBe(sharedRow);
  });

  test('applies namespace quotas updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-quotas', storeScope);

    setScopedDomainState('namespace-quotas', storeScope, () => ({
      status: 'ready',
      data: { rows: [], clusterId: 'test-cluster' },
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
        ref: resourceRef({ kind: 'ResourceQuota', namespace: 'default', name: 'quota-a' }),
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

    const state = getScopedDomainState('namespace-quotas', storeScope);
    expect(state.data?.rows?.[0]?.name).toBe('quota-a');
  });

  test('applies namespace storage updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-storage', storeScope);

    setScopedDomainState('namespace-storage', storeScope, () => ({
      status: 'ready',
      data: { rows: [], clusterId: 'test-cluster' },
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
        ref: resourceRef({
          kind: 'PersistentVolumeClaim',
          namespace: 'default',
          name: 'pvc-a',
        }),
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

    const state = getScopedDomainState('namespace-storage', storeScope);
    expect(state.data?.rows?.[0]?.name).toBe('pvc-a');
  });

  test('applies cluster rbac updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('cluster-rbac', storeScope);

    setScopedDomainState('cluster-rbac', storeScope, () => ({
      status: 'ready',
      data: { rows: [], clusterId: 'test-cluster' },
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
        ref: resourceRef({
          group: 'rbac.authorization.k8s.io',
          kind: 'ClusterRole',
          name: 'cluster-role',
        }),
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

    const state = getScopedDomainState('cluster-rbac', storeScope);
    expect(state.data?.rows?.[0]?.name).toBe('cluster-role');
  });

  test('preserves rows with missing clusterId when merging cluster rbac updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('cluster-rbac', storeScope);

    setScopedDomainState('cluster-rbac', storeScope, () => ({
      status: 'ready',
      data: {
        rows: [
          {
            kind: 'ClusterRole',
            name: 'legacy-row',
            details: 'Rules: 1',
            age: '2m',
            typeAlias: 'CR',
          } as any,
        ],
        clusterId: 'test-cluster',
      },
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
        resourceVersion: '8',
        name: 'cluster-role',
        kind: 'ClusterRole',
        ref: resourceRef({
          group: 'rbac.authorization.k8s.io',
          kind: 'ClusterRole',
          name: 'cluster-role',
        }),
        row: {
          clusterId: 'cluster-a',
          clusterName: 'cluster-a',
          kind: 'ClusterRole',
          name: 'cluster-role',
          details: 'Rules: 2',
          age: '1m',
          typeAlias: 'CR',
        },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getScopedDomainState('cluster-rbac', storeScope);
    expect(state.data?.rows?.map((row) => row.name)).toEqual(['cluster-role', 'legacy-row']);
  });

  test('applies cluster storage updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('cluster-storage', storeScope);

    setScopedDomainState('cluster-storage', storeScope, () => ({
      status: 'ready',
      data: { rows: [], clusterId: 'test-cluster' },
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
        ref: resourceRef({ kind: 'PersistentVolume', name: 'pv-a' }),
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

    const state = getScopedDomainState('cluster-storage', storeScope);
    expect(state.data?.rows?.[0]?.name).toBe('pv-a');
  });

  test('applies cluster config updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('cluster-config', storeScope);

    setScopedDomainState('cluster-config', storeScope, () => ({
      status: 'ready',
      data: { rows: [], clusterId: 'test-cluster' },
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
        ref: resourceRef({
          group: 'storage.k8s.io',
          kind: 'StorageClass',
          name: 'standard',
        }),
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

    const state = getScopedDomainState('cluster-config', storeScope);
    expect(state.data?.rows?.[0]?.name).toBe('standard');
  });

  test('applies cluster crds updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('cluster-crds', storeScope);

    setScopedDomainState('cluster-crds', storeScope, () => ({
      status: 'ready',
      data: { rows: [], clusterId: 'test-cluster' },
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
        ref: resourceRef({
          group: 'apiextensions.k8s.io',
          kind: 'CustomResourceDefinition',
          resource: 'customresourcedefinitions',
          name: 'widgets.example.com',
        }),
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

    const state = getScopedDomainState('cluster-crds', storeScope);
    expect(state.data?.rows?.[0]?.name).toBe('widgets.example.com');
  });

  test('applies cluster custom updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('cluster-custom', storeScope);

    setScopedDomainState('cluster-custom', storeScope, () => ({
      status: 'ready',
      data: { resources: [], clusterId: 'test-cluster' },
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
        ref: resourceRef({
          group: 'example.com',
          kind: 'Widget',
          name: 'cluster-widget',
        }),
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

    const state = getScopedDomainState('cluster-custom', storeScope);
    expect(state.data?.resources?.[0]?.name).toBe('cluster-widget');
  });

  test('applies cluster updates when scope is omitted', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('cluster-rbac', storeScope);

    setScopedDomainState('cluster-rbac', storeScope, () => ({
      status: 'ready',
      data: { rows: [], clusterId: 'test-cluster' },
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
        resourceVersion: '11',
        ref: resourceRef({ kind: 'ClusterRole', name: 'role-a' }),
        row: { name: 'role-a', status: 'Ready', clusterId: 'cluster-a' },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getScopedDomainState('cluster-rbac', storeScope);
    expect(state.data?.rows?.[0]?.name).toBe('role-a');
  });

  test('does not create an initial empty payload from pre-baseline stream updates', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('cluster-rbac', storeScope);

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'DELETED',
        domain: 'cluster-rbac',
        resourceVersion: '11',
        ref: resourceRef({ kind: 'ClusterRole', name: 'role-a' }),
      })
    );

    vi.advanceTimersByTime(200);

    const state = getScopedDomainState('cluster-rbac', storeScope);
    expect(state.status).toBe('idle');
    expect(state.data).toBeNull();
  });

  test('accepts updates even when resource versions regress if sequences advance', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('pods', storeScope);

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'pods',
        scope: 'namespace:default',
        name: 'pod-a',
        namespace: 'default',
        resourceVersion: '10',
        sequence: 1,
        ref: resourceRef({ kind: 'Pod', namespace: 'default', name: 'pod-a' }),
        row: { name: 'pod-a', namespace: 'default', status: 'Ready', clusterId: 'cluster-a' },
      })
    );
    vi.advanceTimersByTime(200);

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'MODIFIED',
        domain: 'pods',
        scope: 'namespace:default',
        name: 'pod-a',
        namespace: 'default',
        resourceVersion: '5',
        sequence: 2,
        ref: resourceRef({ kind: 'Pod', namespace: 'default', name: 'pod-a' }),
        row: { name: 'pod-a', namespace: 'default', status: 'NotReady', clusterId: 'cluster-a' },
      })
    );

    vi.advanceTimersByTime(200);

    // pods is notify-only: both deltas are accepted (sequence advances despite the
    // resourceVersion regressing), so each flush bumps streamRevision — and the
    // regression does not trigger a resync.
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
    const state = getScopedDomainState('pods', storeScope);
    expect(state.streamRevision).toBe(2);
  });

  test('accepts updates when snapshot version exceeds safe integer limits', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('cluster-rbac', storeScope);

    // Use an unsafe integer to mirror large resourceVersion values from the backend.
    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'cluster-rbac',
        scope: '',
        version: Number.MAX_SAFE_INTEGER + 2,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { rows: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });

    await manager.refreshOnce('cluster-rbac', storeScope);

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'cluster-rbac',
        scope: '',
        resourceVersion: '1',
        ref: resourceRef({ kind: 'ClusterRole', name: 'role-a' }),
        row: { name: 'role-a', status: 'Ready', clusterId: 'cluster-a' },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getScopedDomainState('cluster-rbac', storeScope);
    expect(state.data?.rows?.[0]?.name).toBe('role-a');
  });

  test('resyncs on reset messages', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-config', storeScope);

    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'namespace-config',
        scope: 'namespace:default',
        version: 9,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { rows: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'RESET',
        domain: 'namespace-config',
        scope: 'namespace:default',
      })
    );

    await flushPromises();

    expect(fetchSnapshotMock).toHaveBeenCalled();
  });

  test('resyncs after connection errors', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-config', storeScope);

    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'namespace-config',
        scope: 'namespace:default',
        version: 4,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { rows: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });

    manager.handleConnectionError('cluster-a', 'connection lost');

    await flushPromises();

    expect(fetchSnapshotMock).toHaveBeenCalled();
    const state = getScopedDomainState('namespace-config', storeScope);
    expect(state.status).toBe('ready');
  });

  test('does not resync on connection error when resume sequence exists', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-config', storeScope);

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'namespace-config',
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
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');

    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'namespace-config',
        scope: 'namespace:default',
        version: 1,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { rows: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });
    fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'namespace-config',
        scope: 'namespace:default',
        version: 2,
        checksum: 'etag-2',
        generatedAt: Date.now(),
        sequence: 2,
        payload: { rows: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });

    await manager.start('namespace-config', storeScope);
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

  test('suspends and resumes streams for visibility changes', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');

    fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'namespace-config',
        scope: 'namespace:default',
        version: 1,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { rows: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });

    await manager.start('namespace-config', storeScope);
    await flushPromises();

    const firstSocket = createdSockets[0];
    expect(firstSocket).toBeDefined();

    (manager as unknown as { suspendForVisibility: () => void }).suspendForVisibility();
    expect(firstSocket.close).toHaveBeenCalled();
    expect(manager.getHealthStatus('namespace-config', storeScope)).toBe('unhealthy');

    vi.advanceTimersByTime(1100);
    (manager as unknown as { resumeFromVisibility: () => void }).resumeFromVisibility();
    await flushPromises();

    expect(createdSockets[1]).toBeDefined();
    expect(fetchSnapshotMock).toHaveBeenCalledTimes(2);
  });

  test('treats the first reset after subscribe as an acknowledgement', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');

    fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'namespace-config',
        scope: 'namespace:default',
        version: 1,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { rows: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });

    await manager.start('namespace-config', storeScope);
    await flushPromises();

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'RESET',
        domain: 'namespace-config',
        scope: 'namespace:default',
      })
    );
    await flushPromises();

    expect(fetchSnapshotMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1100);
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'RESET',
        domain: 'namespace-config',
        scope: 'namespace:default',
      })
    );
    await flushPromises();

    expect(fetchSnapshotMock).toHaveBeenCalledTimes(2);
  });

  test('resyncs on complete and error stream messages', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');

    fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'namespace-config',
        scope: 'namespace:default',
        version: 1,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { rows: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });

    await manager.start('namespace-config', storeScope);
    await flushPromises();

    vi.advanceTimersByTime(1100);

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'COMPLETE',
        domain: 'namespace-config',
        scope: 'namespace:default',
      })
    );
    await flushPromises();

    expect(fetchSnapshotMock).toHaveBeenCalledTimes(2);

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ERROR',
        domain: 'namespace-config',
        scope: 'namespace:default',
        error: 'watch closed',
      })
    );
    await flushPromises();

    expect(fetchSnapshotMock).toHaveBeenCalledTimes(3);
    expect(manager.getHealthStatus('pods', storeScope)).not.toBe('healthy');
  });

  test('stops subscriptions and closes the socket on kubeconfig change cleanup', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');

    fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'nodes',
        scope: '',
        version: 1,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { rows: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      notModified: false,
    });

    await manager.start('nodes', storeScope);
    await flushPromises();

    const socket = createdSockets[0];
    expect(socket).toBeDefined();

    (manager as unknown as { stopAll: (reset: boolean) => void }).stopAll(true);

    expect(socket.close).toHaveBeenCalled();
    expect(manager.getHealthStatus('nodes', storeScope)).toBe('unhealthy');
    expect(manager.getTelemetrySummary()).toEqual({ resyncCount: 0, fallbackCount: 0 });
  });

  test('groups resync/fallback telemetry by cluster AND domain for per-domain rows', () => {
    const manager = new ResourceStreamManager();
    const internal = manager as unknown as {
      streamTelemetry: Map<string, Record<string, unknown>>;
    };
    internal.streamTelemetry.set('c1::nodes::path:c1|', {
      clusterId: 'c1',
      domain: 'nodes',
      resyncCount: 2,
      fallbackCount: 1,
    });
    internal.streamTelemetry.set('c1::pods::path:c1|', {
      clusterId: 'c1',
      domain: 'pods',
      resyncCount: 4,
      fallbackCount: 0,
    });

    const byClusterDomain = manager.getTelemetrySummaryByClusterDomain();
    expect(byClusterDomain['c1::nodes']).toMatchObject({ resyncCount: 2, fallbackCount: 1 });
    expect(byClusterDomain['c1::pods']).toMatchObject({ resyncCount: 4, fallbackCount: 0 });
  });

  test('accepts newer updates after stale resource versions when sequences advance', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');

    // pods is notify-only: starting the subscription must NOT fetch a full-row
    // baseline (the query-backed table no longer waits on one — that's the
    // load-time win), yet deltas must still be processed.
    await manager.start('pods', storeScope);
    await flushPromises();

    vi.advanceTimersByTime(1100);
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'MODIFIED',
        domain: 'pods',
        scope: 'namespace:default',
        resourceVersion: '5',
        sequence: 1,
        name: 'pod-a',
        namespace: 'default',
        ref: resourceRef({ kind: 'Pod', namespace: 'default', name: 'pod-a' }),
        row: { name: 'pod-a', namespace: 'default', status: 'Unknown', clusterId: 'cluster-a' },
      })
    );

    await flushPromises();

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'MODIFIED',
        domain: 'pods',
        scope: 'namespace:default',
        resourceVersion: '12',
        sequence: 2,
        name: 'pod-a',
        namespace: 'default',
        ref: resourceRef({ kind: 'Pod', namespace: 'default', name: 'pod-a' }),
        row: { name: 'pod-a', namespace: 'default', status: 'Ready', clusterId: 'cluster-a' },
      })
    );

    vi.advanceTimersByTime(200);

    // The stale-then-newer deltas (sequence advancing) are accepted and bump
    // streamRevision; a notify-only start/resync never fetches a snapshot.
    const state = getScopedDomainState('pods', storeScope);
    expect(state.streamRevision ?? 0).toBeGreaterThanOrEqual(1);
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
  });

  test('debounces unsubscribe before sending cancel', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');

    fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'nodes',
        scope: '',
        version: 1,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { rows: [] },
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
    const storeScope = buildClusterScope('cluster-a', '');

    fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'nodes',
        scope: '',
        version: 1,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { rows: [] },
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

  it('rejects node streaming for multi-cluster scopes', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = 'clusters=cluster-a,cluster-b|';

    await expect(manager.start('nodes', storeScope)).rejects.toThrow('single cluster');

    expect(fetchSnapshotMock).not.toHaveBeenCalled();
    expect(createdSockets).toHaveLength(0);
  });

  test('rejects pod streaming for multi-cluster scopes', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = 'clusters=cluster-a,cluster-b|namespace:default';

    await expect(manager.start('pods', storeScope)).rejects.toThrow('single cluster');

    expect(fetchSnapshotMock).not.toHaveBeenCalled();
    expect(createdSockets).toHaveLength(0);
  });

  test('rejects namespace workload streaming for multi-cluster scopes', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = 'clusters=cluster-a,cluster-b|namespace:default';

    await expect(manager.start('namespace-workloads', storeScope)).rejects.toThrow(
      'single cluster'
    );

    expect(fetchSnapshotMock).not.toHaveBeenCalled();
    expect(createdSockets).toHaveLength(0);
  });
});
