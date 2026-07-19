/**
 * frontend/src/core/refresh/streaming/resourceStreamManager.test.ts
 *
 * Test suite for resource stream helpers.
 */

import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';

const ensureRefreshBaseURLMock = vi.hoisted(() => vi.fn(async () => 'http://127.0.0.1:0'));
const fetchSnapshotMock = vi.hoisted(() => vi.fn());
const invalidateRefreshBaseURLMock = vi.hoisted(() => vi.fn());
const logAppLogsDebugMock = vi.hoisted(() => vi.fn());
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
  logAppLogsDebug: logAppLogsDebugMock,
  logAppLogsInfo: logAppLogsInfoMock,
  logAppLogsWarn: logAppLogsWarnMock,
}));

import { buildClusterScope } from '../clusterScope';
import {
  makeNamespaceAutoscalingSnapshotPayload,
  makeNamespaceConfigSnapshotPayload,
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '../refreshContractTestBuilders';
import { getScopedDomainState, resetAllScopedDomainStates, setScopedDomainState } from '../store';
import { normalizeResourceScope, ResourceStreamManager } from './resourceStreamManager';

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

const installWindowTimers = (): void => {
  Object.defineProperties(window, {
    setTimeout: { configurable: true, writable: true, value: globalThis.setTimeout },
    clearTimeout: { configurable: true, writable: true, value: globalThis.clearTimeout },
  });
};

const installFakeWebSocket = (): void => {
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: FakeWebSocket,
  });
};

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
  logAppLogsDebugMock.mockClear();
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
  installWindowTimers();
  installFakeWebSocket();

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
  resetAllScopedDomainStates('catalog');
  resetAllScopedDomainStates('pods');
  resetAllScopedDomainStates('namespaces');
  resetAllScopedDomainStates('namespace-metrics');
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
  resetAllScopedDomainStates('catalog');
  resetAllScopedDomainStates('pods');
  resetAllScopedDomainStates('namespaces');
  resetAllScopedDomainStates('namespace-metrics');
  Reflect.deleteProperty(globalThis, 'WebSocket');
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
});

describe('ResourceStreamManager', () => {
  test('pod delta is signal-only: updates sourceVersion and leaves rows untouched', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('pods', storeScope);

    const existing = makePodSnapshotEntry({
      cpuUsage: '50m',
      memUsage: '40Mi',
    });

    setScopedDomainState('pods', storeScope, () => ({
      status: 'ready',
      data: makePodSnapshotPayload({ rows: [existing], clusterId: 'test-cluster' }),
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        clusterId: 'cluster-a',
        type: 'MODIFIED',
        domain: 'pods',
        scope: 'namespace:default',
        source: 'object',
        version: 'object:2',
        signal: 'changed',
        resourceVersion: '2',
        name: 'pod-a',
        namespace: 'default',
        ref: resourceRef({ kind: 'Pod', namespace: 'default', name: 'pod-a' }),
        // The backend ships no row for signal-only pods; even if one slipped through
        // the frontend must not apply it. The query-backed table refetches instead.
        row: { ...existing, status: 'Pending', cpuUsage: '5m', memUsage: '8Mi' },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getScopedDomainState('pods', storeScope);
    expect(state.sourceVersion).toBe('object:2');
    expect(state.signalVersions?.object).toBe('object:2');
    expect(state.data?.rows?.[0]?.status).toBe('Running');
    expect(state.data?.rows?.[0]?.cpuUsage).toBe('50m');
  });

  // A QUIET domain (e.g. cluster-config, whose kinds rarely change) must count
  // as healthy once the SERVER CONFIRMS its subscription — deliveries prove
  // liveness but their absence is not unhealth. Without this, the refresher
  // gate ('skip' only when healthy) polls quiet domains forever, defeating
  // streaming-only refresh.
  test('quiet stream is healthy after the server ACKs the subscribe, with zero deliveries', async () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');

    fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'cluster-config',
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

    await manager.start('cluster-config', storeScope);
    await flushPromises();

    createdSockets[0].onopen?.(new Event('open'));
    await vi.advanceTimersByTimeAsync(1100);
    await flushPromises();

    // The server confirms the subscribe; no change message ever arrives — the
    // domain is simply quiet.
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({ type: 'ACK', domain: 'cluster-config', scope: '', clusterId: 'cluster-a' })
    );
    expect(manager.getHealthStatus('cluster-config', storeScope)).toBe('healthy');
  });

  // The inverse guard (found live: a backend without the namespaces selector
  // ignored/rejected the subscribe while the client claimed healthy and froze):
  // a subscription the server never confirms must NOT report healthy, so the
  // refresher keeps polling as the fallback.
  test('unconfirmed subscribe stays degraded so polling falls back; ERROR stays unhealthy', async () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');
    await manager.start('namespaces', storeScope);
    await flushPromises();

    createdSockets[0].onopen?.(new Event('open'));
    await vi.advanceTimersByTimeAsync(1100);
    await flushPromises();

    // Subscribe sent, server silent: NOT healthy.
    expect(manager.getHealthStatus('namespaces', storeScope)).not.toBe('healthy');

    // Server rejects the domain (e.g. stale backend): unhealthy.
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ERROR',
        domain: 'namespaces',
        scope: '',
        clusterId: 'cluster-a',
        error: 'unsupported resource stream domain "namespaces"',
      })
    );
    await vi.advanceTimersByTimeAsync(1100);
    expect(manager.getHealthStatus('namespaces', storeScope)).not.toBe('healthy');

    // Server later confirms (backend restarted with the new selector): healthy.
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({ type: 'ACK', domain: 'namespaces', scope: '', clusterId: 'cluster-a' })
    );
    expect(manager.getHealthStatus('namespaces', storeScope)).toBe('healthy');
  });

  // Pins the namespaces doorbell: a SourceObject signal on the namespaces
  // domain must advance the scoped sourceVersion (NamespaceContext refetches on
  // it), replacing the sidebar's 2s poll.
  test('namespaces doorbell advances the scoped sourceVersion', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespaces', storeScope);

    // The server's ACK carries the cluster DISPLAY NAME; the subscription
    // captures it so subscription-labeled logging matches the backend half
    // (which logs the name) instead of falling back to the raw composite ID.
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ACK',
        domain: 'namespaces',
        scope: '',
        clusterId: 'cluster-a',
        clusterName: 'Cluster A',
      })
    );

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        clusterId: 'cluster-a',
        type: 'MODIFIED',
        domain: 'namespaces',
        scope: '',
        source: 'object',
        version: 'ns-3',
        signal: 'changed',
      })
    );
    vi.advanceTimersByTime(200);

    const state = getScopedDomainState('namespaces', storeScope);
    expect(state.sourceVersion).toBe('ns-3');
    expect(state.signalVersions?.object).toBe('ns-3');
    // The applied doorbell logs at DEBUG — the runtime counterpart of the
    // backend's "namespaces doorbell <v>: <reason> — signaling ..." line. It
    // must carry the subscription's cluster label (the backend half is
    // per-cluster labeled; a [Global] frontend half can't be attributed when
    // several clusters are connected) — including the display name captured
    // from the ACK, so both halves render the same bracket.
    const doorbellLog = logAppLogsDebugMock.mock.calls.find((call) =>
      String(call[0]).includes('namespaces doorbell ns-3 received')
    );
    expect(doorbellLog).toBeDefined();
    expect(doorbellLog?.[2]).toEqual(
      expect.objectContaining({ clusterId: 'cluster-a', clusterName: 'Cluster A' })
    );
  });

  // Pins the metric doorbell contract: the backend poller fans a SourceMetric
  // doorbell after each collection; on the metric-clock domains it must advance
  // the scoped sourceVersion (the typed-query refetch trigger) with NO client-side
  // polling involved. Non-metric domains must drop it at parse time.
  test('metric doorbell advances sourceVersion on metric-clock domains and is dropped elsewhere', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const podsScope = buildClusterScope('cluster-a', 'namespace:default');
    const configScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('pods', podsScope);
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-config', configScope);

    const doorbell = (domain: string) =>
      JSON.stringify({
        clusterId: 'cluster-a',
        type: 'MODIFIED',
        domain,
        scope: 'namespace:default',
        source: 'metric',
        version: '1700000000000000042',
        signal: 'changed',
      });

    manager.handleMessage('cluster-a', doorbell('pods'));
    manager.handleMessage('cluster-a', doorbell('namespace-config'));
    vi.advanceTimersByTime(200);

    const podsState = getScopedDomainState('pods', podsScope);
    expect(podsState.sourceVersion).toBe('1700000000000000042');
    expect(podsState.signalVersions?.metric).toBe('1700000000000000042');

    // namespace-config declares no metric source clock: the doorbell is dropped
    // at parse time and its state stays untouched.
    const configState = getScopedDomainState('namespace-config', configScope);
    expect(configState.sourceVersion).toBeUndefined();
    expect(configState.signalVersions?.metric).toBeUndefined();
  });

  test('signal-only domain delta updates sourceVersion and never retains rows', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-workloads', storeScope);

    // namespace-workloads is signal-only: the backend ships the change signal
    // (Ref/ResourceVersion) without a row. The frontend advances sourceVersion
    // so the query-backed table refetches and leaves the row list untouched.
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        clusterId: 'cluster-a',
        type: 'MODIFIED',
        domain: 'namespace-workloads',
        scope: 'namespace:default',
        source: 'object',
        version: 'object:7',
        signal: 'changed',
        resourceVersion: '7',
        name: 'web',
        namespace: 'default',
        kind: 'Deployment',
        ref: resourceRef({ group: 'apps', kind: 'Deployment', namespace: 'default', name: 'web' }),
      })
    );

    vi.advanceTimersByTime(200);

    const state = getScopedDomainState('namespace-workloads', storeScope);
    expect(state.sourceVersion).toBe('object:7');
    expect(state.signalVersions?.object).toBe('object:7');
    expect(state.data?.rows ?? []).toEqual([]);
  });

  test('catalog doorbell updates each active catalog query report scope', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const pageScope = buildClusterScope(
      'cluster-a',
      'limit=1000&customOnly=true&sort=name&sortDirection=asc&namespace=team-a'
    );
    const metadataScope = buildClusterScope(
      'cluster-a',
      'limit=1&customOnly=true&namespace=team-a'
    );

    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('catalog', pageScope);
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('catalog', metadataScope);

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        clusterId: 'cluster-a',
        domain: 'catalog',
        scope: '',
        source: 'catalog',
        version: 'catalog:42',
        signal: 'changed',
      })
    );

    vi.advanceTimersByTime(200);

    expect(getScopedDomainState('catalog', pageScope).sourceVersion).toBe('catalog:42');
    expect(getScopedDomainState('catalog', pageScope).signalVersions?.catalog).toBe('catalog:42');
    expect(getScopedDomainState('catalog', metadataScope).sourceVersion).toBe('catalog:42');
    expect(getScopedDomainState('catalog', metadataScope).signalVersions?.catalog).toBe(
      'catalog:42'
    );
  });

  test('A1 changed signal envelope updates sourceVersion without legacy message type', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('pods', storeScope);

    setScopedDomainState('pods', storeScope, () => ({
      status: 'ready',
      data: makePodSnapshotPayload({ rows: [], clusterId: 'cluster-a' }),
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        clusterId: 'cluster-a',
        domain: 'pods',
        scope: 'namespace:default',
        source: 'object',
        version: 'objects:2',
        signal: 'changed',
      })
    );

    vi.advanceTimersByTime(200);

    expect(getScopedDomainState('pods', storeScope).sourceVersion).toBe('objects:2');
    expect(getScopedDomainState('pods', storeScope).signalVersions?.object).toBe('objects:2');
  });

  test('A1 reset signal envelope forces a resync without legacy message type', async () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-config', storeScope);

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        clusterId: 'cluster-a',
        domain: 'namespace-config',
        scope: 'namespace:default',
        source: 'object',
        version: 'object:11',
        signal: 'reset',
      })
    );
    await flushPromises();

    expect(getScopedDomainState('namespace-config', storeScope).sourceVersion).toBe('object:11');
    expect(getScopedDomainState('namespace-config', storeScope).signalVersions?.object).toBe(
      'object:11'
    );
  });

  test('A1 signal envelope does not fall back across cluster ids', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('pods', storeScope);

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        clusterId: 'cluster-b',
        domain: 'pods',
        scope: 'namespace:default',
        source: 'object',
        version: 'object:3',
        signal: 'changed',
      })
    );

    vi.advanceTimersByTime(200);

    expect(getScopedDomainState('pods', storeScope).sourceVersion).toBeUndefined();
  });

  // The typed query refetches from sourceVersion. streamRevision is retained as
  // diagnostic/backward-compatible state for legacy signal-only messages.
  test('legacy streamed updates bump diagnostic streamRevision', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-config', storeScope);

    setScopedDomainState('namespace-config', storeScope, () => ({
      status: 'ready',
      data: makeNamespaceConfigSnapshotPayload({ rows: [], clusterId: 'cluster-a' }),
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

    // Notify-only ships no rows to compare, so each coalesced stream batch bumps the
    // revision (the resulting query refetch is debounced and visually silent).
    manager.handleMessage('cluster-a', updateMessage({ ...configRow }, '4'));
    vi.advanceTimersByTime(200);
    expect(getScopedDomainState('namespace-config', storeScope).streamRevision).toBe(2);

    manager.handleMessage('cluster-a', updateMessage({ ...configRow, data: 3 }, '5'));
    vi.advanceTimersByTime(200);
    expect(getScopedDomainState('namespace-config', storeScope).streamRevision).toBe(3);
  });

  test('applies updates when cluster id mismatches but scope is unique', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-config', storeScope);

    setScopedDomainState('namespace-config', storeScope, () => ({
      status: 'ready',
      data: makeNamespaceConfigSnapshotPayload({ rows: [], clusterId: 'test-cluster' }),
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

    // The update routes to the matching subscription (unique scope despite the
    // cluster-id mismatch) and, being signal-only, bumps the refetch signal.
    const state = getScopedDomainState('namespace-config', storeScope);
    expect(state.streamRevision).toBe(1);
  });

  test('applies updates when scope includes a cluster prefix', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('namespace-config', storeScope);

    setScopedDomainState('namespace-config', storeScope, () => ({
      status: 'ready',
      data: makeNamespaceConfigSnapshotPayload({ rows: [], clusterId: 'test-cluster' }),
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

    // A cluster-prefixed scope still routes to the subscription; signal-only bumps
    // the refetch signal.
    const state = getScopedDomainState('namespace-config', storeScope);
    expect(state.streamRevision).toBe(1);
  });

  test('reuses namespace autoscaling rows when an unchanged update is applied', () => {
    vi.useFakeTimers();
    installWindowTimers();
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
      data: makeNamespaceAutoscalingSnapshotPayload({
        rows: [sharedRow],
        clusterId: 'cluster-a',
      }),
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

  test('does not create an initial empty payload from pre-baseline stream updates', () => {
    vi.useFakeTimers();
    installWindowTimers();
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

    // Notify-only: a pre-baseline update bumps the refetch signal (status→ready)
    // without ever materializing a row payload.
    const state = getScopedDomainState('cluster-rbac', storeScope);
    expect(state.status).toBe('ready');
    expect(state.data).toBeNull();
    expect(state.streamRevision).toBe(1);
  });

  test('accepts updates even when resource versions regress if sequences advance', async () => {
    vi.useFakeTimers();
    installWindowTimers();
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

    // pods is signal-only: both deltas are accepted (sequence advances despite the
    // resourceVersion regressing), so each flush advances the sourceVersion refetch
    // signal while streamRevision remains diagnostic/backward-compatible state.
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
    const state = getScopedDomainState('pods', storeScope);
    expect(state.streamRevision).toBe(2);
  });

  test('accepts updates whose resourceVersion exceeds safe integer limits', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');
    (
      manager as unknown as { ensureSubscriptions: (...args: unknown[]) => void }
    ).ensureSubscriptions('cluster-rbac', storeScope);

    // A resourceVersion past the safe-integer limit is parsed via BigInt, so the
    // signal-only delta is still accepted and bumps the refetch signal.
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'ADDED',
        domain: 'cluster-rbac',
        scope: '',
        resourceVersion: `${String(Number.MAX_SAFE_INTEGER)}2`,
        ref: resourceRef({ kind: 'ClusterRole', name: 'role-a' }),
        row: { name: 'role-a', status: 'Ready', clusterId: 'cluster-a' },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getScopedDomainState('cluster-rbac', storeScope);
    expect(state.streamRevision).toBe(1);
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
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

    // Notify-only resync re-arms the stream and bumps diagnostic streamRevision.
    expect(
      getScopedDomainState('namespace-config', storeScope).streamRevision ?? 0
    ).toBeGreaterThan(0);
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

    // Notify-only recovers by re-arming the stream and bumping diagnostic streamRevision.
    const state = getScopedDomainState('namespace-config', storeScope);
    expect(state.streamRevision ?? 0).toBeGreaterThan(0);
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
    installWindowTimers();
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
    // Reconnect re-subscribes the stream; signal-only needs no snapshot fetch.
    expect(secondSocket.send).toHaveBeenCalled();
  });

  test('suspends and resumes streams for visibility changes', async () => {
    vi.useFakeTimers();
    installWindowTimers();
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

    // With no retained snapshot, resume only re-opens and re-subscribes the stream.
    expect(createdSockets[1]).toBeDefined();
  });

  test('invalidates a retained namespace snapshot when visibility resume cannot be replayed', async () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');

    setScopedDomainState('namespaces', storeScope, (previous) => ({
      ...previous,
      status: 'ready',
      data: {
        clusterId: 'cluster-a',
        clusterName: 'Cluster A',
        namespaces: [],
      },
      sourceVersion: 'object:before-gap',
      signalVersions: { object: 'object:before-gap' },
    }));

    await manager.start('namespaces', storeScope);
    await flushPromises();

    const firstSocket = createdSockets[0];
    expect(firstSocket).toBeDefined();
    firstSocket.onopen?.(new Event('open'));
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({ type: 'ACK', domain: 'namespaces', scope: '' })
    );
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({ type: 'RESET', domain: 'namespaces', scope: '' })
    );
    const versionBeforeGap = getScopedDomainState('namespaces', storeScope).signalVersions?.object;

    (manager as unknown as { suspendForVisibility: () => void }).suspendForVisibility();
    vi.advanceTimersByTime(1100);
    (manager as unknown as { resumeFromVisibility: () => void }).resumeFromVisibility();
    await flushPromises();

    const secondSocket = createdSockets[1];
    expect(secondSocket).toBeDefined();
    secondSocket.onopen?.(new Event('open'));
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({ type: 'ACK', domain: 'namespaces', scope: '' })
    );
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({ type: 'RESET', domain: 'namespaces', scope: '' })
    );

    expect(getScopedDomainState('namespaces', storeScope).signalVersions?.object).not.toBe(
      versionBeforeGap
    );
  });

  test('invalidates the declared non-object clock when a retained doorbell snapshot cannot be replayed', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', '');

    setScopedDomainState('namespace-metrics', storeScope, (previous) => ({
      ...previous,
      status: 'ready',
      data: {} as never,
      signalVersions: { metric: 'metric:before-gap' },
    }));

    await manager.start('namespace-metrics', storeScope);
    await flushPromises();
    const socket = createdSockets[0];
    expect(socket).toBeDefined();
    socket.onopen?.(new Event('open'));
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({ type: 'RESET', domain: 'namespace-metrics', scope: '' })
    );

    expect(getScopedDomainState('namespace-metrics', storeScope).signalVersions?.metric).not.toBe(
      'metric:before-gap'
    );
  });

  test('treats the first reset without retained data as an acknowledgement', async () => {
    vi.useFakeTimers();
    installWindowTimers();
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

    // With no retained snapshot to reconcile, the first reset only acknowledges the subscription.
    expect(getScopedDomainState('namespace-config', storeScope).streamRevision ?? 0).toBe(1);

    vi.advanceTimersByTime(1100);
    setScopedDomainState('namespace-config', storeScope, (previous) => ({
      ...previous,
      sourceVersion: 'object:before-reset',
      signalVersions: { object: 'object:before-reset' },
    }));
    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'RESET',
        domain: 'namespace-config',
        scope: 'namespace:default',
      })
    );
    await flushPromises();

    // A later reset is a real resync: it re-arms the stream and advances query identity.
    const resetState = getScopedDomainState('namespace-config', storeScope);
    expect(resetState.sourceVersion).not.toBe('object:before-reset');
    expect(resetState.signalVersions?.object).toBe(resetState.sourceVersion);
    expect(resetState.streamRevision ?? 0).toBeGreaterThan(0);
  });

  test('resyncs on complete and error stream messages', async () => {
    vi.useFakeTimers();
    installWindowTimers();
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
    setScopedDomainState('namespace-config', storeScope, (previous) => ({
      ...previous,
      sourceVersion: 'object:before-complete',
      signalVersions: { object: 'object:before-complete' },
    }));

    manager.handleMessage(
      'cluster-a',
      JSON.stringify({
        type: 'COMPLETE',
        domain: 'namespace-config',
        scope: 'namespace:default',
      })
    );
    await flushPromises();

    // COMPLETE triggers a scope-level resync and advances query identity.
    const completeState = getScopedDomainState('namespace-config', storeScope);
    expect(completeState.sourceVersion).not.toBe('object:before-complete');
    expect(completeState.signalVersions?.object).toBe(completeState.sourceVersion);
    expect(completeState.streamRevision ?? 0).toBeGreaterThan(0);
    const sourceVersionAfterComplete = completeState.sourceVersion;

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

    // ERROR also re-arms and updates the health for the affected subscription.
    const errorState = getScopedDomainState('namespace-config', storeScope);
    expect(errorState.sourceVersion).toBe(sourceVersionAfterComplete);
    expect(errorState.streamRevision ?? 0).toBeGreaterThan(0);
    expect(manager.getHealthStatus('namespace-config', storeScope)).not.toBe('healthy');
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
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = buildClusterScope('cluster-a', 'namespace:default');

    // pods is signal-only: starting the subscription must NOT fetch a full-row
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
    // diagnostic streamRevision; a signal-only start/resync never fetches a snapshot.
    const state = getScopedDomainState('pods', storeScope);
    expect(state.streamRevision ?? 0).toBeGreaterThanOrEqual(1);
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
  });

  test('debounces unsubscribe before sending cancel', async () => {
    vi.useFakeTimers();
    installWindowTimers();
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
    installWindowTimers();
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
