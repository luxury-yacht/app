/**
 * frontend/src/core/refresh/streaming/resourceStreamManager.test.ts
 *
 * The resource stream manager, driven only through its public surface: scopes
 * start and stop as the orchestrator starts them, the server's frames arrive
 * through `handleMessage` or the fake socket, and app-wide changes (a
 * kubeconfig switch, the window hiding or showing) arrive as the app's events.
 * The snapshot client, logging, and error reporting are stubbed at the
 * boundary.
 */

import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';

const fetchSnapshotMock = vi.hoisted(() => vi.fn());
const logAppLogsDebugMock = vi.hoisted(() => vi.fn());
const logAppLogsInfoMock = vi.hoisted(() => vi.fn());
const logAppLogsWarnMock = vi.hoisted(() => vi.fn());
const errorHandlerMock = vi.hoisted(() => ({
  handle: vi.fn(),
}));

const createdSockets: FakeJSONSocket[] = [];

vi.mock('../client', () => ({
  fetchSnapshot: fetchSnapshotMock,
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
  reportOperationalError: vi.fn(),
}));

vi.mock('@/core/logging/appLogsClient', () => ({
  APP_LOG_SOURCES: {
    ResourceStream: 'ResourceStream',
  },
  logAppLogsDebug: logAppLogsDebugMock,
  logAppLogsInfo: logAppLogsInfoMock,
  logAppLogsWarn: logAppLogsWarnMock,
}));

import { testScope } from '@/test-utils/refreshScope';
import {
  makeNamespaceAutoscalingSnapshotPayload,
  makeNamespaceConfigSnapshotPayload,
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '../refreshContractTestBuilders';
import { getScopedDomainState, resetAllScopedDomainStates, setScopedDomainState } from '../store';
import type { DoorbellDomain } from './resourceStreamDomains';
import { ResourceStreamManager } from './resourceStreamManager';

class FakeJSONSocket {
  static OPEN = 1;
  readonly OPEN = 1;
  readyState = FakeJSONSocket.OPEN;
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

const installFakeJSONSocket = (): void => {
  (
    globalThis as typeof globalThis & {
      __wailsJSONStreamFactory?: (name: string) => unknown;
    }
  ).__wailsJSONStreamFactory = (name) => new FakeJSONSocket(name);
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

/**
 * The server answers a subscribe without a resume token, as every fresh or
 * resynced subscription sends: an ACK, then the baseline RESET (backend
 * streammux handler.go).
 */
const answerSubscribe = (manager: ResourceStreamManager, domain: DoorbellDomain, scope: string) => {
  const separator = scope.indexOf('|');
  const frame = { domain, scope: scope.slice(separator + 1), clusterId: scope.slice(0, separator) };
  manager.handleMessage(JSON.stringify({ type: 'ACK', ...frame }));
  manager.handleMessage(JSON.stringify({ type: 'RESET', ...frame }));
};

// A manager's stream connection opens once, with its first subscription.
const openConnections = new WeakSet<ResourceStreamManager>();

/**
 * Subscribes a scope the way the orchestrator does (`start`) on an open
 * connection, and the server answers it. Every stream message the tests
 * deliver arrives in this steady state.
 */
const subscribe = (manager: ResourceStreamManager, domain: DoorbellDomain, scope: string) => {
  manager.start(domain, scope);
  if (!openConnections.has(manager)) {
    openConnections.add(manager);
    manager.handleConnectionOpen();
  }
  answerSubscribe(manager, domain, scope);
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
  fetchSnapshotMock.mockReset();
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
  installFakeJSONSocket();

  resetAllScopedDomainStates('nodes');
  resetAllScopedDomainStates('namespace-workloads');
  resetAllScopedDomainStates('namespace-config');
  resetAllScopedDomainStates('namespace-network');
  resetAllScopedDomainStates('namespace-rbac');
  resetAllScopedDomainStates('namespace-helm');
  resetAllScopedDomainStates('namespace-autoscaling');
  resetAllScopedDomainStates('namespace-quotas');
  resetAllScopedDomainStates('namespace-storage');
  resetAllScopedDomainStates('cluster-rbac');
  resetAllScopedDomainStates('cluster-storage');
  resetAllScopedDomainStates('cluster-config');
  resetAllScopedDomainStates('cluster-crds');
  resetAllScopedDomainStates('catalog');
  resetAllScopedDomainStates('pods');
  resetAllScopedDomainStates('namespaces');
  resetAllScopedDomainStates('namespace-metrics');
});

afterEach(() => {
  // A switch of kubeconfig stops every manager's streams (its public stopAll),
  // so a later test's app-wide events reach no stream this test left open.
  eventBus.emit('kubeconfig:changing', '');
  resetAllScopedDomainStates('nodes');
  resetAllScopedDomainStates('namespace-workloads');
  resetAllScopedDomainStates('namespace-config');
  resetAllScopedDomainStates('namespace-network');
  resetAllScopedDomainStates('namespace-rbac');
  resetAllScopedDomainStates('namespace-helm');
  resetAllScopedDomainStates('namespace-autoscaling');
  resetAllScopedDomainStates('namespace-quotas');
  resetAllScopedDomainStates('namespace-storage');
  resetAllScopedDomainStates('cluster-rbac');
  resetAllScopedDomainStates('cluster-storage');
  resetAllScopedDomainStates('cluster-config');
  resetAllScopedDomainStates('cluster-crds');
  resetAllScopedDomainStates('catalog');
  resetAllScopedDomainStates('pods');
  resetAllScopedDomainStates('namespaces');
  resetAllScopedDomainStates('namespace-metrics');
  Reflect.deleteProperty(globalThis, '__wailsJSONStreamFactory');
  vi.useRealTimers();
});

describe('ResourceStreamManager', () => {
  test('pod delta is signal-only: updates sourceVersion and leaves rows untouched', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', 'namespace:default');
    subscribe(manager, 'pods', storeScope);

    const existing = makePodSnapshotEntry({
      cpuUsageMilli: 50,
      memoryUsageBytes: 40 * 1024 ** 2,
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
        row: { ...existing, status: 'Pending', cpuUsageMilli: 5, memoryUsageBytes: 8 * 1024 ** 2 },
      })
    );

    vi.advanceTimersByTime(200);

    const state = getScopedDomainState('pods', storeScope);
    expect(state.sourceVersion).toBe('object:2');
    expect(state.signalVersions?.object).toBe('object:2');
    expect(state.data?.rows?.[0]?.status).toBe('Running');
    expect(state.data?.rows?.[0]?.cpuUsageMilli).toBe(50);
  });

  test.each([
    { label: 'ACK for another cluster', type: 'ACK', clusterId: 'cluster-b' },
    { label: 'RESET for another cluster', type: 'RESET', clusterId: 'cluster-b' },
    {
      label: 'ERROR for another cluster',
      type: 'ERROR',
      clusterId: 'cluster-b',
      error: 'other cluster failed',
    },
    { label: 'missing cluster identity', type: 'ACK' },
    {
      label: 'conflicting scope identity',
      type: 'ACK',
      clusterId: 'cluster-a',
      scope: 'cluster-b|',
    },
    { label: 'malformed cluster identity', type: 'ACK', clusterId: 7 },
    { label: 'malformed version', type: 'ACK', clusterId: 'cluster-a', version: 7 },
    { label: 'malformed cluster name', type: 'ACK', clusterId: 'cluster-a', clusterName: {} },
  ])(
    'ignores $label on the shared connection while accepting the owning cluster ACK',
    async ({ label: _label, ...frame }) => {
      const manager = new ResourceStreamManager();
      const scope = testScope('cluster-a', '');
      manager.start('cluster-config', scope);
      await flushPromises();
      const socket = createdSockets[0];
      socket.onopen?.(new Event('open'));
      await flushPromises();
      const health = manager.getHealthSnapshot('cluster-config', scope);
      const snapshot = getScopedDomainState('cluster-config', scope);

      expect(() =>
        socket.onmessage?.(
          new MessageEvent('message', {
            data: { domain: 'cluster-config', scope: '', ...frame },
          })
        )
      ).not.toThrow();
      expect(manager.getHealthSnapshot('cluster-config', scope)).toEqual(health);
      expect(getScopedDomainState('cluster-config', scope)).toEqual(snapshot);

      socket.onmessage?.(
        new MessageEvent('message', {
          data: { type: 'ACK', domain: 'cluster-config', scope: '', clusterId: 'cluster-a' },
        })
      );
      expect(manager.getHealthStatus('cluster-config', scope)).toBe('healthy');
    }
  );

  // A QUIET domain (e.g. cluster-config, whose kinds rarely change) must count
  // as healthy once the SERVER CONFIRMS its subscription — deliveries prove
  // liveness but their absence is not unhealth. Without this, the refresher
  // gate ('skip' only when healthy) polls quiet domains forever, defeating
  // streaming-only refresh.
  test('quiet stream is healthy after the server ACKs the subscribe, with zero deliveries', async () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', '');

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

    manager.start('cluster-config', storeScope);
    await flushPromises();

    createdSockets[0].onopen?.(new Event('open'));
    await vi.advanceTimersByTimeAsync(1100);
    await flushPromises();

    // The server confirms the subscribe; no change message ever arrives — the
    // domain is simply quiet.
    manager.handleMessage(
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
    const storeScope = testScope('cluster-a', '');
    manager.start('namespaces', storeScope);
    await flushPromises();

    createdSockets[0].onopen?.(new Event('open'));
    await vi.advanceTimersByTimeAsync(1100);
    await flushPromises();

    // Subscribe sent, server silent: NOT healthy.
    expect(manager.getHealthStatus('namespaces', storeScope)).not.toBe('healthy');

    // Server rejects the domain (e.g. stale backend): unhealthy.
    manager.handleMessage(
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
      JSON.stringify({ type: 'ACK', domain: 'namespaces', scope: '', clusterId: 'cluster-a' })
    );
    expect(manager.getHealthStatus('namespaces', storeScope)).toBe('healthy');
  });

  test('permission denial is terminal until subscription ownership is replaced', async () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', '');
    const permissionDenied = vi.fn();
    const unsubscribe = eventBus.on('refresh:resource-stream-permission-denied', permissionDenied);

    try {
      manager.start('namespaces', storeScope);
      await flushPromises();
      createdSockets[0].onopen?.(new Event('open'));
      await flushPromises();

      const requestCount = () =>
        createdSockets[0].send.mock.calls.filter(([payload]) => payload.type === 'REQUEST').length;
      const requestsBeforeDenial = requestCount();
      const revisionBeforeDenial =
        getScopedDomainState('namespaces', storeScope).streamRevision ?? 0;

      manager.handleMessage(
        JSON.stringify({
          type: 'ERROR',
          clusterId: 'cluster-a',
          domain: 'namespaces',
          scope: '',
          source: 'object',
          signal: 'error',
          version: 'object:2',
          errorDetails: makeErrorStatus(
            'Forbidden',
            'permission denied for domain namespaces (core/namespaces)',
            { details: { domain: 'namespaces', resource: 'core/namespaces' } }
          ),
        })
      );

      expect(permissionDenied).toHaveBeenCalledWith({
        domain: 'namespaces',
        scope: storeScope,
        reason: 'permission denied for domain namespaces (core/namespaces)',
      });
      expect(manager.getHealthStatus('namespaces', storeScope)).toBe('unhealthy');

      manager.handleMessage(
        JSON.stringify({
          type: 'ACK',
          clusterId: 'cluster-a',
          domain: 'namespaces',
          scope: '',
        })
      );
      manager.handleMessage(
        JSON.stringify({
          type: 'MODIFIED',
          clusterId: 'cluster-a',
          domain: 'namespaces',
          scope: '',
          source: 'object',
          signal: 'changed',
          version: 'object:3',
          sequence: '3',
        })
      );
      await vi.advanceTimersByTimeAsync(200);

      expect(requestCount()).toBe(requestsBeforeDenial);
      expect(getScopedDomainState('namespaces', storeScope).streamRevision ?? 0).toBe(
        revisionBeforeDenial
      );
      expect(manager.getHealthStatus('namespaces', storeScope)).toBe('unhealthy');

      manager.stop('namespaces', storeScope, false);
      manager.start('namespaces', storeScope);
      await flushPromises();

      expect(requestCount()).toBeGreaterThan(requestsBeforeDenial);
      manager.handleMessage(
        JSON.stringify({
          type: 'ACK',
          clusterId: 'cluster-a',
          domain: 'namespaces',
          scope: '',
        })
      );
      expect(manager.getHealthStatus('namespaces', storeScope)).toBe('healthy');
    } finally {
      unsubscribe();
    }
  });

  // Pins the namespaces doorbell: a SourceObject signal on the namespaces
  // domain must advance the scoped sourceVersion (NamespaceContext refetches on
  // it), replacing the sidebar's 2s poll.
  test('namespaces doorbell advances the scoped sourceVersion', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', '');
    subscribe(manager, 'namespaces', storeScope);

    // The server's ACK carries the cluster DISPLAY NAME; the subscription
    // captures it so subscription-labeled logging matches the backend half
    // (which logs the name) instead of falling back to the raw composite ID.
    manager.handleMessage(
      JSON.stringify({
        type: 'ACK',
        domain: 'namespaces',
        scope: '',
        clusterId: 'cluster-a',
        clusterName: 'Cluster A',
      })
    );

    manager.handleMessage(
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
    const podsScope = testScope('cluster-a', 'namespace:default');
    const configScope = testScope('cluster-a', 'namespace:default');
    subscribe(manager, 'pods', podsScope);
    subscribe(manager, 'namespace-config', configScope);

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

    manager.handleMessage(doorbell('pods'));
    manager.handleMessage(doorbell('namespace-config'));
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
    const storeScope = testScope('cluster-a', 'namespace:default');
    subscribe(manager, 'namespace-workloads', storeScope);

    // namespace-workloads is signal-only: the backend ships the change signal
    // (Ref/ResourceVersion) without a row. The frontend advances sourceVersion
    // so the query-backed table refetches and leaves the row list untouched.
    manager.handleMessage(
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

  test('a catalog doorbell advances the cluster catalog scope’s catalog clock', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const scope = testScope('cluster-a', '');
    subscribe(manager, 'catalog', scope);

    manager.handleMessage(
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

    expect(getScopedDomainState('catalog', scope)).toMatchObject({
      sourceVersion: 'catalog:42',
      signalVersions: { catalog: 'catalog:42' },
    });
  });

  test('A1 changed signal envelope updates sourceVersion without legacy message type', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', 'namespace:default');
    subscribe(manager, 'pods', storeScope);

    setScopedDomainState('pods', storeScope, () => ({
      status: 'ready',
      data: makePodSnapshotPayload({ rows: [], clusterId: 'cluster-a' }),
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
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
    const storeScope = testScope('cluster-a', 'namespace:default');
    subscribe(manager, 'namespace-config', storeScope);

    manager.handleMessage(
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
    const storeScope = testScope('cluster-a', 'namespace:default');
    subscribe(manager, 'pods', storeScope);

    manager.handleMessage(
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
    const storeScope = testScope('cluster-a', 'namespace:default');
    subscribe(manager, 'namespace-config', storeScope);

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
        clusterId: 'cluster-a',
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

    manager.handleMessage(updateMessage(configRow, '3'));
    vi.advanceTimersByTime(200);

    const afterAdd = getScopedDomainState('namespace-config', storeScope);
    expect(afterAdd.streamRevision).toBe(1);
    // The backend snapshot identity is untouched — only the stream revision moves.
    expect(afterAdd.version).toBe(7);
    expect(afterAdd.checksum).toBe('abc');

    // Notify-only ships no rows to compare, so each coalesced stream batch bumps the
    // revision (the resulting query refetch is debounced and visually silent).
    manager.handleMessage(updateMessage({ ...configRow }, '4'));
    vi.advanceTimersByTime(200);
    expect(getScopedDomainState('namespace-config', storeScope).streamRevision).toBe(2);

    manager.handleMessage(updateMessage({ ...configRow, data: 3 }, '5'));
    vi.advanceTimersByTime(200);
    expect(getScopedDomainState('namespace-config', storeScope).streamRevision).toBe(3);
  });

  test('rejects a legacy update from another cluster even when the scope is unique', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', 'namespace:default');
    subscribe(manager, 'namespace-config', storeScope);

    setScopedDomainState('namespace-config', storeScope, () => ({
      status: 'ready',
      data: makeNamespaceConfigSnapshotPayload({ rows: [], clusterId: 'cluster-a' }),
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    const before = getScopedDomainState('namespace-config', storeScope);
    const update = {
      type: 'ADDED',
      domain: 'namespace-config',
      scope: 'namespace:default',
      resourceVersion: '3',
      name: 'config-a',
      namespace: 'default',
      kind: 'ConfigMap',
      clusterId: 'cluster-a',
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
    };

    manager.handleMessage(JSON.stringify({ ...update, clusterId: 'backend-id' }));

    vi.advanceTimersByTime(200);
    expect(getScopedDomainState('namespace-config', storeScope)).toEqual(before);

    manager.handleMessage(JSON.stringify(update));
    vi.advanceTimersByTime(200);
    expect(getScopedDomainState('namespace-config', storeScope).streamRevision).toBe(1);
  });

  test('applies updates when scope includes a cluster prefix', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', 'namespace:default');
    subscribe(manager, 'namespace-config', storeScope);

    setScopedDomainState('namespace-config', storeScope, () => ({
      status: 'ready',
      data: makeNamespaceConfigSnapshotPayload({ rows: [], clusterId: 'test-cluster' }),
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: storeScope,
    }));

    manager.handleMessage(
      JSON.stringify({
        clusterId: 'cluster-a',
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
    const storeScope = testScope('cluster-a', 'namespace:default');
    subscribe(manager, 'namespace-autoscaling', storeScope);

    const sharedRow = {
      ref: {
        ...resourceRef({
          clusterId: 'cluster-a',
          group: 'autoscaling',
          version: 'v1',
          kind: 'HorizontalPodAutoscaler',
          resource: 'horizontalpodautoscalers',
          namespace: 'default',
          name: 'hpa-a',
        }),
        resource: 'horizontalpodautoscalers',
        namespace: 'default',
      },
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
      JSON.stringify({
        clusterId: 'cluster-a',
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
    const storeScope = testScope('cluster-a', '');
    subscribe(manager, 'cluster-rbac', storeScope);
    // Subscribing (its initial resync and ACK) bumps the revision too.
    const revisionBefore = getScopedDomainState('cluster-rbac', storeScope).streamRevision ?? 0;

    manager.handleMessage(
      JSON.stringify({
        clusterId: 'cluster-a',
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
    expect(state.streamRevision).toBe(revisionBefore + 1);
  });

  test('accepts updates even when resource versions regress if sequences advance', async () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', 'namespace:default');
    subscribe(manager, 'pods', storeScope);
    // Subscribing (its initial resync and ACK) bumps the revision too.
    const revisionBefore = getScopedDomainState('pods', storeScope).streamRevision ?? 0;

    manager.handleMessage(
      JSON.stringify({
        clusterId: 'cluster-a',
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
      JSON.stringify({
        clusterId: 'cluster-a',
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
    expect(state.streamRevision).toBe(revisionBefore + 2);
  });

  test('accepts updates whose resourceVersion exceeds safe integer limits', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', '');
    subscribe(manager, 'cluster-rbac', storeScope);
    // Subscribing (its initial resync and ACK) bumps the revision too.
    const revisionBefore = getScopedDomainState('cluster-rbac', storeScope).streamRevision ?? 0;

    // A resourceVersion past the safe-integer limit is parsed via BigInt, so the
    // signal-only delta is still accepted and bumps the refetch signal.
    manager.handleMessage(
      JSON.stringify({
        clusterId: 'cluster-a',
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
    expect(state.streamRevision).toBe(revisionBefore + 1);
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
  });

  test('resyncs on reset messages', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', 'namespace:default');
    subscribe(manager, 'namespace-config', storeScope);

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
      JSON.stringify({
        clusterId: 'cluster-a',
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
    const storeScope = testScope('cluster-a', 'namespace:default');
    subscribe(manager, 'namespace-config', storeScope);

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

    manager.handleConnectionError('connection lost');

    await flushPromises();

    // Notify-only recovers by re-arming the stream and bumping diagnostic streamRevision.
    const state = getScopedDomainState('namespace-config', storeScope);
    expect(state.streamRevision ?? 0).toBeGreaterThan(0);
  });

  test('does not resync on connection error when resume sequence exists', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', 'namespace:default');
    subscribe(manager, 'namespace-config', storeScope);

    manager.handleMessage(
      JSON.stringify({
        clusterId: 'cluster-a',
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

    manager.handleConnectionError('connection lost');

    await flushPromises();

    expect(fetchSnapshotMock).not.toHaveBeenCalled();
  });

  test('reconnects and resubscribes after socket close', async () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', 'namespace:default');

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

    manager.start('namespace-config', storeScope);
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
    const storeScope = testScope('cluster-a', 'namespace:default');

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

    manager.start('namespace-config', storeScope);
    await flushPromises();

    const firstSocket = createdSockets[0];
    expect(firstSocket).toBeDefined();

    eventBus.emit('app:visibility-hidden');
    expect(firstSocket.close).toHaveBeenCalled();
    expect(manager.getHealthStatus('namespace-config', storeScope)).toBe('unhealthy');

    vi.advanceTimersByTime(1100);
    eventBus.emit('app:visibility-visible');
    await flushPromises();

    // With no retained snapshot, resume only re-opens and re-subscribes the stream.
    expect(createdSockets[1]).toBeDefined();
  });

  test('invalidates a retained namespace snapshot when visibility resume cannot be replayed', async () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', '');

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

    manager.start('namespaces', storeScope);
    await flushPromises();

    const firstSocket = createdSockets[0];
    expect(firstSocket).toBeDefined();
    firstSocket.onopen?.(new Event('open'));
    manager.handleMessage(
      JSON.stringify({ clusterId: 'cluster-a', type: 'ACK', domain: 'namespaces', scope: '' })
    );
    manager.handleMessage(
      JSON.stringify({ clusterId: 'cluster-a', type: 'RESET', domain: 'namespaces', scope: '' })
    );
    const versionBeforeGap = getScopedDomainState('namespaces', storeScope).signalVersions?.object;

    eventBus.emit('app:visibility-hidden');
    vi.advanceTimersByTime(1100);
    eventBus.emit('app:visibility-visible');
    await flushPromises();

    const secondSocket = createdSockets[1];
    expect(secondSocket).toBeDefined();
    secondSocket.onopen?.(new Event('open'));
    manager.handleMessage(
      JSON.stringify({ clusterId: 'cluster-a', type: 'ACK', domain: 'namespaces', scope: '' })
    );
    manager.handleMessage(
      JSON.stringify({ clusterId: 'cluster-a', type: 'RESET', domain: 'namespaces', scope: '' })
    );

    expect(getScopedDomainState('namespaces', storeScope).signalVersions?.object).not.toBe(
      versionBeforeGap
    );
  });

  test('invalidates the declared non-object clock when a retained doorbell snapshot cannot be replayed', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', '');

    setScopedDomainState('namespace-metrics', storeScope, (previous) => ({
      ...previous,
      status: 'ready',
      data: {} as never,
      signalVersions: { metric: 'metric:before-gap' },
    }));

    manager.start('namespace-metrics', storeScope);
    await flushPromises();
    const socket = createdSockets[0];
    expect(socket).toBeDefined();
    socket.onopen?.(new Event('open'));
    manager.handleMessage(
      JSON.stringify({
        clusterId: 'cluster-a',
        type: 'RESET',
        domain: 'namespace-metrics',
        scope: '',
      })
    );

    expect(getScopedDomainState('namespace-metrics', storeScope).signalVersions?.metric).not.toBe(
      'metric:before-gap'
    );
  });

  test('treats the first reset without retained data as an acknowledgement', async () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', 'namespace:default');

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

    manager.start('namespace-config', storeScope);
    await flushPromises();

    manager.handleMessage(
      JSON.stringify({
        clusterId: 'cluster-a',
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
      JSON.stringify({
        clusterId: 'cluster-a',
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
    const storeScope = testScope('cluster-a', 'namespace:default');

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

    manager.start('namespace-config', storeScope);
    await flushPromises();

    vi.advanceTimersByTime(1100);
    setScopedDomainState('namespace-config', storeScope, (previous) => ({
      ...previous,
      sourceVersion: 'object:before-complete',
      signalVersions: { object: 'object:before-complete' },
    }));

    manager.handleMessage(
      JSON.stringify({
        clusterId: 'cluster-a',
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
      JSON.stringify({
        clusterId: 'cluster-a',
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

  test('changes inside the resync cooldown latch exactly one trailing resync', async () => {
    // Helm writes a release's Secrets in a burst (pending, superseded,
    // deployed). Each rings a complete-resync domain; a change that lands in
    // the cooldown of the previous resync must still reach the view.
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', 'namespace:default');
    fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'namespace-helm',
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
    const helmChanged = () =>
      manager.handleMessage(
        JSON.stringify({
          clusterId: 'cluster-a',
          type: 'MODIFIED',
          domain: 'namespace-helm',
          scope: 'namespace:default',
        })
      );
    const streamRevision = () =>
      getScopedDomainState('namespace-helm', storeScope).streamRevision ?? 0;

    manager.start('namespace-helm', storeScope);
    await flushPromises();
    vi.advanceTimersByTime(1100);

    helmChanged();
    await flushPromises();
    const resyncsAfterFirst = manager.getTelemetrySummary().resyncCount;
    const revisionAfterFirst = streamRevision();
    expect(resyncsAfterFirst).toBe(1);

    vi.advanceTimersByTime(20);
    helmChanged();
    helmChanged();
    await flushPromises();
    expect(manager.getTelemetrySummary().resyncCount).toBe(resyncsAfterFirst);

    vi.advanceTimersByTime(1000);
    await flushPromises();
    expect(manager.getTelemetrySummary().resyncCount).toBe(resyncsAfterFirst + 1);
    expect(streamRevision()).toBeGreaterThan(revisionAfterFirst);

    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(manager.getTelemetrySummary().resyncCount).toBe(resyncsAfterFirst + 1);
  });

  test('stops subscriptions and closes the socket on kubeconfig change cleanup', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', '');

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

    manager.start('nodes', storeScope);
    await flushPromises();

    const socket = createdSockets[0];
    expect(socket).toBeDefined();

    eventBus.emit('kubeconfig:changing', '');

    expect(socket.close).toHaveBeenCalled();
    expect(manager.getHealthStatus('nodes', storeScope)).toBe('unhealthy');
    expect(manager.getTelemetrySummary()).toEqual({ resyncCount: 0, fallbackCount: 0 });
  });

  test('counts a stream-down fallback only against a live subscription for that scope', async () => {
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', 'namespace:default');
    manager.start('pods', storeScope);
    await flushPromises();

    manager.recordStreamFallback('pods', storeScope, 'stream not delivering');
    manager.recordStreamFallback('pods', storeScope, 'stream not delivering');
    // No subscription owns this scope, so there is nothing to attribute a
    // fallback to — the counter must not invent a row for it.
    manager.recordStreamFallback('pods', testScope('cluster-a', 'namespace:other'), 'nope');

    const summary = manager.getTelemetrySummary();
    expect(summary.fallbackCount).toBe(2);
    expect(summary.lastFallbackReason).toBe('stream not delivering');
    expect(manager.getTelemetrySummaryByClusterDomain()['cluster-a::pods']).toMatchObject({
      fallbackCount: 2,
    });
  });

  test('groups resync/fallback telemetry by cluster AND domain for per-domain rows', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const nodesScope = testScope('c1', '');
    const podsScope = testScope('c1', 'namespace:default');
    subscribe(manager, 'nodes', nodesScope);
    subscribe(manager, 'pods', podsScope);
    // The server resets a scope (resyncs closer together than the cooldown
    // merge); the client resubscribes, and the server answers it.
    const reset = (domain: DoorbellDomain, scope: string) => {
      vi.advanceTimersByTime(1_100);
      manager.handleMessage(
        JSON.stringify({ type: 'RESET', domain, scope: scope.slice(3), clusterId: 'c1' })
      );
      answerSubscribe(manager, domain, scope);
    };

    reset('nodes', nodesScope);
    reset('nodes', nodesScope);
    for (let count = 0; count < 4; count += 1) {
      reset('pods', podsScope);
    }
    manager.recordStreamFallback('nodes', nodesScope, 'stream not delivering');

    const byClusterDomain = manager.getTelemetrySummaryByClusterDomain();
    expect(byClusterDomain['c1::nodes']).toMatchObject({ resyncCount: 2, fallbackCount: 1 });
    expect(byClusterDomain['c1::pods']).toMatchObject({ resyncCount: 4, fallbackCount: 0 });
  });

  test('counts a reconnect as a resync, but not the first connection', () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const scope = testScope('c1', '');

    subscribe(manager, 'nodes', scope);
    expect(manager.getTelemetrySummary().resyncCount).toBe(0);

    vi.advanceTimersByTime(1_100);
    manager.handleConnectionError('socket closed');
    vi.advanceTimersByTime(1_100);
    manager.handleConnectionOpen();

    expect(manager.getTelemetrySummary().resyncCount).toBeGreaterThan(0);
  });

  test('accepts newer updates after stale resource versions when sequences advance', async () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', 'namespace:default');

    // pods is signal-only: starting the subscription must NOT fetch a full-row
    // baseline (the query-backed table no longer waits on one — that's the
    // load-time win), yet deltas must still be processed.
    manager.start('pods', storeScope);
    await flushPromises();

    vi.advanceTimersByTime(1100);
    manager.handleMessage(
      JSON.stringify({
        clusterId: 'cluster-a',
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
      JSON.stringify({
        clusterId: 'cluster-a',
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
    const storeScope = testScope('cluster-a', '');

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

    manager.start('nodes', storeScope);
    await flushPromises();

    const socket = createdSockets[0];
    expect(socket).toBeDefined();

    const cancelCount = () =>
      socket.send.mock.calls.filter(([payload]) => payload.type === 'CANCEL').length;

    manager.stop('nodes', storeScope, false);
    expect(cancelCount()).toBe(0);

    vi.runOnlyPendingTimers();

    expect(cancelCount()).toBe(1);
  });

  test('cancels pending unsubscribe when resubscribed', async () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const storeScope = testScope('cluster-a', '');

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

    manager.start('nodes', storeScope);
    await flushPromises();

    const socket = createdSockets[0];
    expect(socket).toBeDefined();

    const cancelCount = () =>
      socket.send.mock.calls.filter(([payload]) => payload.type === 'CANCEL').length;

    manager.stop('nodes', storeScope, false);
    expect(cancelCount()).toBe(0);

    manager.start('nodes', storeScope);
    await flushPromises();

    vi.runOnlyPendingTimers();

    expect(cancelCount()).toBe(0);
  });

  test('a closed cluster’s streams end at once, so reopening it subscribes afresh', async () => {
    vi.useFakeTimers();
    installWindowTimers();
    const manager = new ResourceStreamManager();
    const closedScope = testScope('cluster-a', '');
    const siblingScope = testScope('cluster-b', '');

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

    manager.start('nodes', closedScope);
    manager.start('nodes', siblingScope);
    await flushPromises();

    const socket = createdSockets[0];
    expect(socket).toBeDefined();
    const sent = (type: string, clusterId: string) =>
      socket.send.mock.calls.filter(
        ([payload]) => payload.type === type && payload.clusterId === clusterId
      ).length;

    // Both views leave: their streams wait out the unsubscribe debounce.
    manager.stop('nodes', closedScope, false);
    manager.stop('nodes', siblingScope, false);
    expect(sent('CANCEL', 'cluster-a')).toBe(0);

    // cluster-a closes (orchestrator.ts pruneRemovedClusterRuntimes).
    eventBus.emit('refresh:cluster-pruned', { clusterId: 'cluster-a' });

    expect(sent('CANCEL', 'cluster-a')).toBe(1);
    expect(sent('CANCEL', 'cluster-b')).toBe(0);

    // Reopened, its view subscribes again instead of reclaiming the old stream.
    manager.start('nodes', closedScope);
    await flushPromises();
    expect(sent('REQUEST', 'cluster-a')).toBe(2);
  });

  it('rejects streaming for a scope without a cluster prefix', () => {
    const manager = new ResourceStreamManager();

    expect(() => manager.start('pods', 'namespace:default')).toThrow('no cluster prefix');

    expect(fetchSnapshotMock).not.toHaveBeenCalled();
    expect(createdSockets).toHaveLength(0);
  });
});
