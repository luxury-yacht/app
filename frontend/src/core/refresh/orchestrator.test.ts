/**
 * frontend/src/core/refresh/orchestrator.test.ts
 *
 * Test suite for orchestrator.
 * Covers key behaviors and edge cases for orchestrator.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
  setAutoRefreshEnabled,
} from '@/core/settings/appPreferences';
import type { PodSnapshotEntry, RefreshDomain } from './types';
import {
  getRefreshState,
  getScopedDomainState,
  markPendingRequest,
  resetAllScopedDomainStates,
  setScopedDomainState,
} from './store';
import { refreshOrchestrator } from './orchestrator';
import {
  CLUSTER_REFRESHERS,
  NAMESPACE_REFRESHERS,
  SYSTEM_REFRESHERS,
  type SystemRefresherName,
} from './refresherTypes';
import { buildClusterScope } from './clusterScope';
import { clusterReadiness } from './clusterReadiness';
import { eventBus } from '@/core/events';

const refreshManagerMocks = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  disableMock: vi.fn(),
  enableMock: vi.fn(),
  registerMock: vi.fn(),
  updateContextMock: vi.fn(),
  triggerManualRefreshForContextMock: vi.fn(),
}));

vi.mock('./RefreshManager', () => ({
  refreshManager: {
    subscribe: refreshManagerMocks.subscribeMock,
    disable: refreshManagerMocks.disableMock,
    enable: refreshManagerMocks.enableMock,
    register: refreshManagerMocks.registerMock,
    updateContext: refreshManagerMocks.updateContextMock,
    triggerManualRefreshForContext: refreshManagerMocks.triggerManualRefreshForContextMock,
  },
}));

const clientMocks = vi.hoisted(() => ({
  fetchSnapshotMock: vi.fn(),
  ensureRefreshBaseURLMock: vi.fn().mockResolvedValue('http://localhost'),
  invalidateRefreshBaseURLMock: vi.fn(),
  setMetricsActiveMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./client', () => ({
  fetchSnapshot: clientMocks.fetchSnapshotMock,
  ensureRefreshBaseURL: clientMocks.ensureRefreshBaseURLMock,
  invalidateRefreshBaseURL: clientMocks.invalidateRefreshBaseURLMock,
  setMetricsActive: clientMocks.setMetricsActiveMock,
}));

const containerLogsStreamMocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  refreshOnce: vi.fn(),
}));

vi.mock('./streaming/containerLogsStreamManager', () => ({
  containerLogsStreamManager: containerLogsStreamMocks,
}));

const eventStreamMocks = vi.hoisted(() => ({
  startNamespace: vi.fn(),
  stopNamespace: vi.fn(),
  startCluster: vi.fn(),
  stopCluster: vi.fn(),
  refreshNamespace: vi.fn(),
  refreshOnce: vi.fn(),
  refreshCluster: vi.fn(),
}));

const resourceStreamMocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  refreshOnce: vi.fn(),
  isHealthy: vi.fn(() => false),
}));

vi.mock('./streaming/resourceStreamManager', () => ({
  resourceStreamManager: resourceStreamMocks,
}));

const catalogStreamMocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  refreshOnce: vi.fn(),
  isHealthy: vi.fn(() => false),
}));

const errorHandlerMock = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

const orchestratorInternals = refreshOrchestrator as unknown as Record<string, any>;
const makeTestInFlightKey = (domain: string, scope?: string) => `${domain}::${scope ?? '*'}`;

describe('refreshOrchestrator', () => {
  let subscriber: ((isManual: boolean, signal?: AbortSignal) => Promise<void>) | undefined;
  const scopedFetch = vi.spyOn(refreshOrchestrator, 'fetchScopedDomain');

  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
    setAppPreferencesForTesting({ autoRefreshEnabled: true });
    refreshManagerMocks.subscribeMock.mockReset();
    refreshManagerMocks.subscribeMock.mockImplementation((_name, callback) => {
      subscriber = callback;
      return vi.fn();
    });
    refreshManagerMocks.disableMock.mockReset();
    refreshManagerMocks.enableMock.mockReset();
    refreshManagerMocks.registerMock.mockReset();
    refreshManagerMocks.updateContextMock.mockReset();
    refreshManagerMocks.triggerManualRefreshForContextMock.mockReset();
    resourceStreamMocks.start.mockReset();
    resourceStreamMocks.stop.mockReset();
    resourceStreamMocks.refreshOnce.mockReset();
    resourceStreamMocks.isHealthy.mockReset();
    resourceStreamMocks.isHealthy.mockReturnValue(false);
    catalogStreamMocks.start.mockReset();
    catalogStreamMocks.stop.mockReset();
    catalogStreamMocks.refreshOnce.mockReset();
    catalogStreamMocks.isHealthy.mockReset();
    catalogStreamMocks.isHealthy.mockReturnValue(false);
    clientMocks.fetchSnapshotMock.mockReset();
    clientMocks.ensureRefreshBaseURLMock.mockClear();
    clientMocks.invalidateRefreshBaseURLMock.mockClear();
    clientMocks.setMetricsActiveMock.mockClear();
    errorHandlerMock.handle.mockReset();

    orchestratorInternals.configs?.clear?.();
    orchestratorInternals.unsubscriptions?.clear?.();
    orchestratorInternals.registeredRefreshers?.clear?.();
    orchestratorInternals.coordinatorRuntime?.scopedEnabledState?.clear?.();
    orchestratorInternals.coordinatorRuntime?.streamingCleanup?.clear?.();
    orchestratorInternals.coordinatorRuntime?.pendingStreaming?.clear?.();
    orchestratorInternals.coordinatorRuntime?.streamingReady?.clear?.();
    orchestratorInternals.coordinatorRuntime?.cancelledStreaming?.clear?.();
    orchestratorInternals.coordinatorRuntime?.inFlight?.clear?.();
    orchestratorInternals.coordinatorRuntime?.streamHealth?.clear?.();
    orchestratorInternals.coordinatorRuntime?.blockedStreaming?.clear?.();
    orchestratorInternals.coordinatorRuntime?.lastMetricsRefreshAt?.clear?.();
    orchestratorInternals.clusterRuntimes?.clear?.();
    orchestratorInternals.suspendedDomains?.clear?.();
    orchestratorInternals.lastNotifiedErrors?.clear?.();
    orchestratorInternals.contextVersion = 0;
    orchestratorInternals.metricsDemandActive = false;
    orchestratorInternals.context = {
      currentView: 'namespace',
      objectPanel: { isOpen: false },
    };

    resetAllScopedDomainStates('cluster-config');
    const { pendingRequests } = getRefreshState();
    if (pendingRequests !== 0) {
      markPendingRequest(-pendingRequests);
    }
  });

  afterEach(() => {
    subscriber = undefined;
    scopedFetch.mockReset();
  });

  const registerStreamingClusterConfigDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: CLUSTER_REFRESHERS.config,
      category: 'cluster',

      streaming: {
        start: (scope: string) => resourceStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          resourceStreamMocks.stop(scope, options),
        refreshOnce: (scope: string) => resourceStreamMocks.refreshOnce(scope),
        pauseRefresherWhenStreaming: true,
      },
    });
  };

  const markResourceStreamActive = (domain: RefreshDomain, scope: string) => {
    // Simulate an active resource stream so polling gating is deterministic in tests.
    const runtime = orchestratorInternals.getRuntimeForScope(domain, scope);
    runtime.streamingCleanup.set(makeTestInFlightKey(domain, scope), () => undefined);
  };

  const setRuntimeScopeEnabled = (domain: RefreshDomain, scope: string, enabled: boolean) => {
    const runtime = orchestratorInternals.getRuntimeForScope(domain, scope);
    const scopedMap = runtime.scopedEnabledState.get(domain) ?? new Map<string, boolean>();
    scopedMap.set(scope, enabled);
    runtime.scopedEnabledState.set(domain, scopedMap);
  };

  const registerObjectMaintenanceDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'object-maintenance',
      refresherName: SYSTEM_REFRESHERS.objectMaintenance,
      category: 'system',
    });
  };

  const registerCatalogDiffDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'catalog-diff',
      refresherName: CLUSTER_REFRESHERS.catalogDiff,
      category: 'cluster',
    });
  };

  const registerCatalogDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      refresherName: CLUSTER_REFRESHERS.browse,
      category: 'cluster',

      streaming: {
        start: (scope: string) => catalogStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => catalogStreamMocks.refreshOnce(scope),
        pauseRefresherWhenStreaming: true,
      },
    });
  };

  it('normalizes object panel kind casing before updating refresh context', () => {
    refreshOrchestrator.updateContext({
      objectPanel: {
        isOpen: true,
        objectKind: 'Pod',
        objectName: 'demo',
        objectNamespace: 'default',
      },
    });

    expect(refreshManagerMocks.updateContextMock).toHaveBeenCalledWith({
      objectPanel: {
        isOpen: true,
        objectKind: 'pod',
        objectName: 'demo',
        objectNamespace: 'default',
      },
    });
  });

  const registerPodsDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'pods',
      refresherName: SYSTEM_REFRESHERS.unifiedPods,
      category: 'system',
    });
  };

  const registerStreamingPodsDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'pods',
      refresherName: SYSTEM_REFRESHERS.unifiedPods,
      category: 'system',
      streaming: {
        start: (scope: string) => resourceStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          resourceStreamMocks.stop(scope, options),
        refreshOnce: (scope: string) => resourceStreamMocks.refreshOnce(scope),
        metricsOnly: true,
      },
    });
  };

  const registerStreamingNodesDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'nodes',
      refresherName: CLUSTER_REFRESHERS.nodes,
      category: 'cluster',
      streaming: {
        start: (scope: string) => resourceStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          resourceStreamMocks.stop(scope, options),
        refreshOnce: (scope: string) => resourceStreamMocks.refreshOnce(scope),
        metricsOnly: true,
      },
    });
  };

  const makePodRow = (overrides: Partial<PodSnapshotEntry> = {}): PodSnapshotEntry => ({
    clusterId: 'cluster-a',
    namespace: 'default',
    name: 'pod-a',
    node: 'node-a',
    status: 'Running',
    ready: '1/1',
    restarts: 0,
    age: '1m',
    ownerKind: 'ReplicaSet',
    ownerName: 'pod-a-rs',
    cpuRequest: '10m',
    cpuLimit: '20m',
    cpuUsage: '10m',
    memRequest: '10Mi',
    memLimit: '20Mi',
    memUsage: '20Mi',
    ...overrides,
  });

  it('applies a metric interval nodes refresh through the normal snapshot path', async () => {
    registerStreamingNodesDomain();
    const scope = buildClusterScope('cluster-a', '');
    resetAllScopedDomainStates('nodes');
    setRuntimeScopeEnabled('nodes', scope, true);
    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'nodes',
        scope,
        version: 1,
        checksum: 'etag-node-metrics',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          clusterId: 'cluster-a',
          rows: [],
          metrics: { stale: false, successCount: 1, failureCount: 0 },
        },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      etag: 'etag-node-metrics',
      notModified: false,
    });

    await orchestratorInternals.performFetch('nodes', scope, {
      isManual: false,
      metricsOnly: true,
    });

    const state = getScopedDomainState('nodes', scope);
    expect(state.status).toBe('ready');
    expect(state.data?.rows).toEqual([]);
    expect(
      orchestratorInternals
        .getRuntimeForScope('nodes', scope)
        .isMetricsRefreshFresh('nodes', scope, Number.POSITIVE_INFINITY)
    ).toBe(true);

    resetAllScopedDomainStates('nodes');
  });

  it('holds scoped fetches for an initializing cluster and dispatches once it becomes serviceable', async () => {
    clusterReadiness.resetForTests();
    registerStreamingClusterConfigDomain();
    const scope = buildClusterScope('cluster-init', 'cluster');
    resetAllScopedDomainStates('cluster-config');
    setRuntimeScopeEnabled('cluster-config', scope, true);
    clientMocks.fetchSnapshotMock.mockClear();
    errorHandlerMock.handle.mockClear();

    // The backend registers this cluster's services only at the 'loading'
    // transition; until then every request would 500 with "no active
    // clusters available".
    eventBus.emit('cluster:lifecycle', {
      clusterId: 'cluster-init',
      state: 'connecting',
      previousState: '',
    });

    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { isManual: false });
    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
    expect(errorHandlerMock.handle).not.toHaveBeenCalled();

    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'cluster-config',
        scope,
        version: 1,
        checksum: 'etag-init',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { clusterId: 'cluster-init', rows: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      etag: 'etag-init',
      notModified: false,
    });

    eventBus.emit('cluster:lifecycle', {
      clusterId: 'cluster-init',
      state: 'loading',
      previousState: 'connected',
    });

    await vi.waitFor(() => {
      expect(clientMocks.fetchSnapshotMock).toHaveBeenCalled();
    });

    clusterReadiness.resetForTests();
    resetAllScopedDomainStates('cluster-config');
  });

  it('classifies "no active clusters available" as warm-up instead of toasting', () => {
    clusterReadiness.resetForTests();
    errorHandlerMock.handle.mockClear();

    orchestratorInternals.notifyRefreshError(
      'cluster-config',
      buildClusterScope('cluster-init', 'cluster'),
      'no active clusters available (requested: [cluster-init:cluster-init])'
    );

    expect(errorHandlerMock.handle).not.toHaveBeenCalled();
    clusterReadiness.resetForTests();
  });

  it('refreshes namespaces domain alongside context targets during manual refresh', async () => {
    refreshManagerMocks.triggerManualRefreshForContextMock.mockResolvedValue(
      undefined as unknown as void
    );
    scopedFetch.mockResolvedValue(undefined as unknown as void);

    // Register namespaces as scoped and enable a scope so refreshEnabledScopes fires.
    refreshOrchestrator.registerDomain({
      domain: 'namespaces',
      refresherName: SYSTEM_REFRESHERS.namespaces,
      category: 'system',
    });
    refreshOrchestrator.setScopedDomainEnabled('namespaces', 'cluster:cluster-a', true);

    await refreshOrchestrator.triggerManualRefreshForContext();

    expect(refreshManagerMocks.triggerManualRefreshForContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentView: expect.any(String),
      })
    );
    expect(scopedFetch).toHaveBeenCalledWith(
      'namespaces',
      'cluster:cluster-a',
      expect.objectContaining({ isManual: true })
    );
  });

  it('refreshes pods scope when namespace pods view is active during manual refresh', async () => {
    refreshManagerMocks.triggerManualRefreshForContextMock.mockResolvedValue(
      undefined as unknown as void
    );
    scopedFetch.mockResolvedValue(undefined as unknown as void);

    registerPodsDomain();
    refreshOrchestrator.updateContext({
      currentView: 'namespace',
      activeNamespaceView: 'pods',
      selectedNamespace: 'team-a',
      selectedClusterId: 'cluster-a',
    });
    refreshOrchestrator.setScopedDomainEnabled('pods', 'namespace:team-a', true);

    await refreshOrchestrator.triggerManualRefreshForContext();

    expect(scopedFetch).toHaveBeenCalledWith(
      'pods',
      'cluster-a|namespace:team-a',
      expect.objectContaining({ isManual: true })
    );
  });

  it('enables and disables scoped refreshers when pods scopes change', () => {
    refreshManagerMocks.enableMock.mockReset();
    refreshManagerMocks.disableMock.mockReset();

    registerPodsDomain();
    refreshOrchestrator.updateContext({ selectedClusterId: 'cluster-a' });

    refreshOrchestrator.setScopedDomainEnabled('pods', 'namespace:team-a', true);
    expect(refreshManagerMocks.enableMock).toHaveBeenCalledWith(SYSTEM_REFRESHERS.unifiedPods);

    refreshOrchestrator.setScopedDomainEnabled('pods', 'namespace:team-a', false);
    expect(refreshManagerMocks.disableMock).toHaveBeenCalledWith(SYSTEM_REFRESHERS.unifiedPods);
  });

  it('keeps a leased scope enabled across an old instance unmount (remount race)', () => {
    refreshManagerMocks.enableMock.mockReset();
    refreshManagerMocks.disableMock.mockReset();

    registerPodsDomain();
    refreshOrchestrator.updateContext({ selectedClusterId: 'cluster-a' });

    // Old table instance leases the scope; the refresher turns on once.
    refreshOrchestrator.acquireScopedDomainLease('pods', 'namespace:team-a');
    expect(refreshManagerMocks.enableMock).toHaveBeenCalledWith(SYSTEM_REFRESHERS.unifiedPods);
    expect(
      orchestratorInternals.isScopedDomainEnabledInternal('pods', 'cluster-a|namespace:team-a')
    ).toBe(true);

    // New instance leases the same scope before the old instance unmounts.
    refreshOrchestrator.acquireScopedDomainLease('pods', 'namespace:team-a');

    // Ignore the disable that domain registration issues at startup.
    refreshManagerMocks.disableMock.mockReset();

    // Old instance unmounts: its release must NOT disable the still-leased scope.
    refreshOrchestrator.releaseScopedDomainLease('pods', 'namespace:team-a');
    expect(refreshManagerMocks.disableMock).not.toHaveBeenCalledWith(SYSTEM_REFRESHERS.unifiedPods);
    expect(
      orchestratorInternals.isScopedDomainEnabledInternal('pods', 'cluster-a|namespace:team-a')
    ).toBe(true);

    // Final lease released: only now does the scope disable.
    refreshOrchestrator.releaseScopedDomainLease('pods', 'namespace:team-a');
    expect(refreshManagerMocks.disableMock).toHaveBeenCalledWith(SYSTEM_REFRESHERS.unifiedPods);
    expect(
      orchestratorInternals.isScopedDomainEnabledInternal('pods', 'cluster-a|namespace:team-a')
    ).toBe(false);
  });

  it('ignores a direct disable while a lease is held so coexisting consumers cannot clobber it', () => {
    refreshManagerMocks.disableMock.mockReset();

    registerPodsDomain();
    refreshOrchestrator.updateContext({ selectedClusterId: 'cluster-a' });

    refreshOrchestrator.acquireScopedDomainLease('pods', 'namespace:team-a');

    // Ignore the disable that domain registration issues at startup.
    refreshManagerMocks.disableMock.mockReset();

    // A coexisting direct consumer disabling the same scope must be ignored
    // while the lease is held.
    refreshOrchestrator.setScopedDomainEnabled('pods', 'namespace:team-a', false);
    expect(
      orchestratorInternals.isScopedDomainEnabledInternal('pods', 'cluster-a|namespace:team-a')
    ).toBe(true);
    expect(refreshManagerMocks.disableMock).not.toHaveBeenCalledWith(SYSTEM_REFRESHERS.unifiedPods);

    refreshOrchestrator.releaseScopedDomainLease('pods', 'namespace:team-a');
  });

  it('refreshes all enabled scoped pods when the refresher fires', async () => {
    scopedFetch.mockReset();

    registerPodsDomain();
    refreshOrchestrator.updateContext({ selectedClusterId: 'cluster-a' });

    refreshOrchestrator.setScopedDomainEnabled('pods', 'namespace:team-a', true);
    refreshOrchestrator.setScopedDomainEnabled('pods', 'namespace:team-b', true);

    const podsCalls = refreshManagerMocks.subscribeMock.mock.calls;
    const podsSubscriber = podsCalls[podsCalls.length - 1]?.[1] ?? (() => Promise.resolve());

    const controller = new AbortController();
    await podsSubscriber(false, controller.signal);

    expect(scopedFetch).toHaveBeenCalledWith(
      'pods',
      'cluster-a|namespace:team-a',
      expect.objectContaining({ isManual: false })
    );
    expect(scopedFetch).toHaveBeenCalledWith(
      'pods',
      'cluster-a|namespace:team-b',
      expect.objectContaining({ isManual: false })
    );
  });

  it('normalizes unprefixed resource stream fetches to the active cluster', async () => {
    registerPodsDomain();
    refreshOrchestrator.updateContext({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
      allConnectedClusterIds: ['cluster-a', 'cluster-b'],
    });

    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'pods',
        scope: 'cluster-a|namespace:team-a',
        version: 1,
        checksum: 'etag-a',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          clusterId: 'cluster-a',
          rows: [],
        },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      etag: 'etag-a',
      notModified: false,
    });

    await refreshOrchestrator.fetchScopedDomain('pods', 'namespace:team-a', { isManual: true });

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'pods',
      expect.objectContaining({ scope: 'cluster-a|namespace:team-a' })
    );
  });

  it('keeps unprefixed resource stream scopes tied to the active cluster after tab switches', async () => {
    registerPodsDomain();

    clientMocks.fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'pods',
        scope: 'namespace:team-a',
        version: 1,
        checksum: 'etag',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          clusterId: 'cluster-a',
          rows: [],
        },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      etag: 'etag',
      notModified: false,
    });

    refreshOrchestrator.updateContext({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a'],
      allConnectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    await refreshOrchestrator.fetchScopedDomain('pods', 'namespace:team-a', { isManual: true });

    refreshOrchestrator.updateContext({
      selectedClusterId: 'cluster-b',
      selectedClusterIds: ['cluster-b'],
      allConnectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    await refreshOrchestrator.fetchScopedDomain('pods', 'namespace:team-a', { isManual: true });

    const scopes = clientMocks.fetchSnapshotMock.mock.calls.map((call) => call[1]?.scope);
    expect(scopes).toEqual(['cluster-a|namespace:team-a', 'cluster-b|namespace:team-a']);
  });

  it('normalizes namespaces against the active cluster only', async () => {
    refreshOrchestrator.registerDomain({
      domain: 'namespaces',
      refresherName: SYSTEM_REFRESHERS.namespaces,
      category: 'system',
    });
    refreshOrchestrator.updateContext({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a'],
      allConnectedClusterIds: ['cluster-a', 'cluster-b'],
    });

    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'namespaces',
        scope: 'cluster-a|all',
        version: 1,
        checksum: 'etag-namespaces',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          clusterId: 'cluster-a',
          namespaces: [],
        },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      etag: 'etag-namespaces',
      notModified: false,
    });

    await refreshOrchestrator.fetchScopedDomain('namespaces', 'all', { isManual: true });

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'namespaces',
      expect.objectContaining({ scope: 'cluster-a|all' })
    );
  });

  it('stores single-cluster resource enablement in the cluster runtime', () => {
    registerPodsDomain();
    refreshOrchestrator.updateContext({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a'],
      allConnectedClusterIds: ['cluster-a', 'cluster-b'],
    });

    refreshOrchestrator.setScopedDomainEnabled('pods', 'namespace:team-a', true);

    const scope = 'cluster-a|namespace:team-a';
    expect(orchestratorInternals.coordinatorRuntime.scopedEnabledState.get('pods')).toBeUndefined();
    expect(
      orchestratorInternals.clusterRuntimes
        .get('cluster-a')
        ?.scopedEnabledState.get('pods')
        ?.get(scope)
    ).toBe(true);
  });

  it('resets leaked snapshot/stream scoped state for a removed cluster, keeping connected clusters', () => {
    // cluster-events is snapshot/stream-driven (polling disabled), so its scope is never
    // tracked as an enabled polling lease and lives only in the global scoped store. When
    // its cluster is closed, prune must still reset it — otherwise it orphans in the
    // diagnostics domain list (a closed cluster's domain lingering forever). The stored
    // scope for a cluster-scoped, empty-tail domain is "<clusterId>|" (buildClusterScope).
    const removedScope = 'cluster-b|';
    const keptScope = 'cluster-a|';
    setScopedDomainState('cluster-events', removedScope, (prev) => ({ ...prev, status: 'ready' }));
    setScopedDomainState('cluster-events', keptScope, (prev) => ({ ...prev, status: 'ready' }));

    const eventScopes = () =>
      (getRefreshState().scopedDomainEntries['cluster-events'] ?? []).map(([scope]) => scope);
    expect(eventScopes()).toEqual(expect.arrayContaining([removedScope, keptScope]));

    refreshOrchestrator.updateContext({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a'],
      allConnectedClusterIds: ['cluster-a'],
    });

    expect(eventScopes()).toContain(keptScope);
    expect(eventScopes()).not.toContain(removedScope);
  });

  it('stores namespaces enablement in the active cluster runtime', () => {
    refreshOrchestrator.registerDomain({
      domain: 'namespaces',
      refresherName: SYSTEM_REFRESHERS.namespaces,
      category: 'system',
    });
    refreshOrchestrator.updateContext({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a'],
      allConnectedClusterIds: ['cluster-a', 'cluster-b'],
    });

    refreshOrchestrator.setScopedDomainEnabled('namespaces', 'all', true);

    const scope = 'cluster-a|all';
    expect(
      orchestratorInternals.coordinatorRuntime.scopedEnabledState.get('namespaces')
    ).toBeUndefined();
    expect(
      orchestratorInternals.clusterRuntimes
        .get('cluster-a')
        ?.scopedEnabledState.get('namespaces')
        ?.get(scope)
    ).toBe(true);
  });

  it('applies snapshots fetched during manual refresh callbacks', async () => {
    const snapshotPayload = {
      resources: [
        {
          kind: 'StorageClass',
          name: 'standard',
          details: 'Default class',
          age: '5m',
        },
      ],
    };

    const scope = 'cluster-a';
    clientMocks.fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'cluster-config',
        version: 1,
        checksum: 'etag-1',
        generatedAt: Date.now(),
        sequence: 1,
        payload: snapshotPayload,
        stats: { itemCount: 1, buildDurationMs: 12 },
      },
      etag: 'etag-1',
      notModified: false,
    });

    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: 'cluster-config',
      category: 'cluster',
    });
    refreshOrchestrator.setScopedDomainEnabled('cluster-config', scope, true);

    expect(refreshManagerMocks.registerMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'cluster-config' })
    );
    expect(subscriber).toBeDefined();

    const abortController = new AbortController();
    await subscriber?.(true, abortController.signal);

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'cluster-config',
      expect.objectContaining({ scope })
    );

    const state = getScopedDomainState('cluster-config', scope);
    expect(state.status).toBe('ready');
    expect(state.data).toEqual(snapshotPayload);
    expect(state.etag).toBe('etag-1');
    expect(state.isManual).toBe(true);
    expect(getRefreshState().pendingRequests).toBe(0);
  });

  it('reuses cached namespace rows when polling snapshots are unchanged', async () => {
    const scope = 'cluster-a';
    const cachedNamespace = {
      clusterId: 'cluster-a',
      ref: {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Namespace',
        resource: 'namespaces',
        name: 'alpha',
      },
      name: 'alpha',
      phase: 'Active',
      resourceVersion: '1',
      creationTimestamp: 100,
      hasWorkloads: false,
    };
    const changedNamespace = {
      clusterId: 'cluster-a',
      ref: {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Namespace',
        resource: 'namespaces',
        name: 'beta',
      },
      name: 'beta',
      phase: 'Active',
      resourceVersion: '2',
      creationTimestamp: 200,
      hasWorkloads: false,
    };

    setScopedDomainState('namespaces', scope, (prev) => ({
      ...prev,
      status: 'ready',
      data: { namespaces: [cachedNamespace, changedNamespace], clusterId: 'test-cluster' },
      stats: { itemCount: 2, buildDurationMs: 0 },
    }));

    clientMocks.fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'namespaces',
        version: 2,
        checksum: 'etag-2',
        generatedAt: Date.now(),
        sequence: 2,
        payload: {
          namespaces: [{ ...cachedNamespace }, { ...changedNamespace, phase: 'Terminating' }],
          clusterId: 'test-cluster',
        },
        stats: { itemCount: 2, buildDurationMs: 0 },
      },
      etag: 'etag-2',
      notModified: false,
    });

    refreshOrchestrator.registerDomain({
      domain: 'namespaces',
      refresherName: SYSTEM_REFRESHERS.namespaces,
      category: 'system',
    });
    refreshOrchestrator.setScopedDomainEnabled('namespaces', scope, true);

    const abortController = new AbortController();
    await subscriber?.(true, abortController.signal);

    const nextNamespaces = getScopedDomainState('namespaces', scope).data?.namespaces ?? [];
    expect(nextNamespaces[0]).toBe(cachedNamespace);
    expect(nextNamespaces[1]).not.toBe(changedNamespace);
  });

  it('reuses cached node maintenance drains when polling snapshots are unchanged', async () => {
    const sharedOptions = {
      gracePeriodSeconds: 30,
      ignoreDaemonSets: true,
      deleteEmptyDirData: false,
      force: false,
      disableEviction: false,
      skipWaitForPodsToTerminate: false,
    };
    const sharedEvents = [
      {
        id: 'evt-1',
        timestamp: 1000,
        kind: 'info' as const,
        message: 'Draining',
      },
    ];
    const cachedDrain = {
      clusterId: 'cluster-a',
      id: 'drain-1',
      nodeName: 'node-a',
      status: 'running' as const,
      startedAt: 1000,
      options: sharedOptions,
      events: sharedEvents,
    };
    const changedDrain = {
      clusterId: 'cluster-a',
      id: 'drain-2',
      nodeName: 'node-b',
      status: 'failed' as const,
      startedAt: 2000,
      completedAt: 3000,
      message: 'Failed',
      options: sharedOptions,
      events: sharedEvents,
    };

    const scope = 'node:node-a';
    setScopedDomainState('object-maintenance', scope, (prev) => ({
      ...prev,
      status: 'ready',
      data: { drains: [cachedDrain, changedDrain], clusterId: 'test-cluster' },
      stats: { itemCount: 2, buildDurationMs: 0 },
    }));

    clientMocks.fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'object-maintenance',
        version: 2,
        checksum: 'etag-3',
        generatedAt: Date.now(),
        sequence: 2,
        payload: {
          drains: [
            { ...cachedDrain, options: sharedOptions, events: sharedEvents },
            { ...changedDrain, status: 'succeeded' as const },
          ],
          clusterId: 'test-cluster',
        },
        stats: { itemCount: 2, buildDurationMs: 0 },
      },
      etag: 'etag-3',
      notModified: false,
    });

    registerObjectMaintenanceDomain();

    await refreshOrchestrator.fetchScopedDomain('object-maintenance', scope, { isManual: true });

    const nextDrains = getScopedDomainState('object-maintenance', scope).data?.drains ?? [];
    expect(nextDrains[0]).toBe(cachedDrain);
    expect(nextDrains[1]).not.toBe(changedDrain);
  });

  it('reuses cached catalog diff items when polling snapshots are unchanged', async () => {
    const cachedItem = {
      clusterId: 'cluster-a',
      kind: 'Deployment',
      group: 'apps',
      version: 'v1',
      resource: 'deployments',
      namespace: 'default',
      name: 'web',
      uid: 'uid-1',
      resourceVersion: '10',
      creationTimestamp: '2024-01-01T00:00:00Z',
      scope: 'Namespace' as const,
    };
    const changedItem = {
      clusterId: 'cluster-a',
      kind: 'ConfigMap',
      group: '',
      version: 'v1',
      resource: 'configmaps',
      namespace: 'default',
      name: 'settings',
      uid: 'uid-2',
      resourceVersion: '5',
      creationTimestamp: '2024-01-01T00:00:00Z',
      scope: 'Namespace' as const,
    };

    const scope = 'limit=50';
    setScopedDomainState('catalog-diff', scope, (prev) => ({
      ...prev,
      status: 'ready',
      data: {
        clusterId: 'cluster-a',
        items: [cachedItem, changedItem],
        total: 2,
        resourceCount: 2,
        batchIndex: 0,
        batchSize: 2,
        totalBatches: 1,
        isFinal: true,
      },
      stats: { itemCount: 2, buildDurationMs: 0 },
    }));

    clientMocks.fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'catalog-diff',
        version: 2,
        checksum: 'etag-4',
        generatedAt: Date.now(),
        sequence: 2,
        payload: {
          clusterId: 'cluster-a',
          items: [{ ...cachedItem }, { ...changedItem, resourceVersion: '6' }],
          total: 2,
          resourceCount: 2,
          batchIndex: 0,
          batchSize: 2,
          totalBatches: 1,
          isFinal: true,
        },
        stats: { itemCount: 2, buildDurationMs: 0 },
      },
      etag: 'etag-4',
      notModified: false,
    });

    registerCatalogDiffDomain();

    await refreshOrchestrator.fetchScopedDomain('catalog-diff', scope, { isManual: true });

    const nextItems = getScopedDomainState('catalog-diff', scope).data?.items ?? [];
    expect(nextItems[0]).toBe(cachedItem);
    expect(nextItems[1]).not.toBe(changedItem);
  });

  it('records errors and surfaces them via the error handler', async () => {
    const scope = 'cluster-a';
    clientMocks.fetchSnapshotMock.mockRejectedValue(new Error('offline'));

    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: 'cluster-config',
      category: 'cluster',
    });
    refreshOrchestrator.setScopedDomainEnabled('cluster-config', scope, true);

    await subscriber?.(true, new AbortController().signal);

    const state = getScopedDomainState('cluster-config', scope);
    expect(state.status).toBe('error');
    expect(state.error).toBe('offline');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'offline' }),
      expect.objectContaining({
        source: 'refresh-orchestrator',
        domain: 'cluster-config',
        scope,
      })
    );
    expect(getRefreshState().pendingRequests).toBe(0);
  });

  it('clears cached refresh errors gracefully even when no entry exists', () => {
    const orchestratorWithInternals = refreshOrchestrator as unknown as {
      notifyRefreshError: (domain: string, scope: string | undefined, message: string) => void;
      clearRefreshError: (domain: string, scope?: string) => void;
    };

    errorHandlerMock.handle.mockClear();
    orchestratorWithInternals.notifyRefreshError('cluster-config', undefined, 'temporary failure');
    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(1);

    orchestratorWithInternals.clearRefreshError('cluster-config');
    orchestratorWithInternals.notifyRefreshError('cluster-config', undefined, 'temporary failure');
    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(2);

    orchestratorWithInternals.clearRefreshError('cluster-config');
    expect(() => orchestratorWithInternals.clearRefreshError('cluster-config')).not.toThrow();
  });

  it('deduplicates identical refresh error notifications per scope', () => {
    const orchestratorWithInternals = refreshOrchestrator as unknown as {
      notifyRefreshError: (domain: string, scope: string | undefined, message: string) => void;
      clearRefreshError: (domain: string, scope?: string) => void;
    };

    orchestratorWithInternals.clearRefreshError('cluster-config');
    errorHandlerMock.handle.mockClear();

    orchestratorWithInternals.notifyRefreshError('cluster-config', undefined, 'already failing');
    orchestratorWithInternals.notifyRefreshError('cluster-config', undefined, 'already failing');
    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(1);

    orchestratorWithInternals.clearRefreshError('cluster-config');
    orchestratorWithInternals.notifyRefreshError('cluster-config', undefined, 'already failing');
    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(2);
  });

  it('disables namespace domains when leaving the namespace context', () => {
    const disableSpy = vi.spyOn(
      refreshOrchestrator as unknown as { disableNamespaceDomains: () => void },
      'disableNamespaceDomains'
    );

    refreshOrchestrator.updateContext({ currentView: 'namespace', selectedNamespace: 'team-a' });
    disableSpy.mockClear();

    refreshOrchestrator.updateContext({ currentView: 'cluster', selectedNamespace: undefined });

    expect(disableSpy).toHaveBeenCalledTimes(1);
    disableSpy.mockRestore();
  });

  it('clears suspended scoped enablement when kubeconfig changes', async () => {
    refreshOrchestrator.registerDomain({
      domain: 'namespace-events',
      refresherName: NAMESPACE_REFRESHERS.events,
      category: 'namespace',

      streaming: {
        start: (scope: string) => eventStreamMocks.startNamespace(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopNamespace(scope, options?.reset ?? false),
      },
    });

    await refreshOrchestrator.setScopedDomainEnabled('namespace-events', 'team-a', true);
    expect(
      orchestratorInternals.coordinatorRuntime.scopedEnabledState
        .get('namespace-events')
        ?.get('team-a')
    ).toBe(true);

    orchestratorInternals.handleKubeconfigChanging();
    expect(
      orchestratorInternals.coordinatorRuntime.scopedEnabledState.has('namespace-events')
    ).toBe(false);
    expect(orchestratorInternals.suspendedDomains.get('namespace-events')).toBe(true);

    orchestratorInternals.handleKubeconfigChanged();
    expect(orchestratorInternals.suspendedDomains.size).toBe(0);
  });

  it('retains existing data when the backend responds with not-modified', async () => {
    const scope = 'cluster-a';
    const payload = {
      resources: [{ kind: 'StorageClass', name: 'gold', details: 'premium', age: '10m' }],
    };

    clientMocks.fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'cluster-config',
        version: 1,
        checksum: 'etag-initial',
        generatedAt: Date.now(),
        sequence: 11,
        payload,
        stats: { itemCount: 1, buildDurationMs: 8 },
      },
      etag: 'etag-initial',
      notModified: false,
    });

    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: 'cluster-config',
      category: 'cluster',
    });
    refreshOrchestrator.setScopedDomainEnabled('cluster-config', scope, true);
    await subscriber?.(true, new AbortController().signal);

    clientMocks.fetchSnapshotMock.mockReset();
    clientMocks.fetchSnapshotMock.mockResolvedValue({
      notModified: true,
      snapshot: undefined,
      etag: undefined,
    });

    await subscriber?.(false, new AbortController().signal);

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'cluster-config',
      expect.objectContaining({ ifNoneMatch: 'etag-initial' })
    );

    const state = getScopedDomainState('cluster-config', scope);
    expect(state.status).toBe('ready');
    expect(state.data).toEqual(payload);
    expect(state.isManual).toBe(false);
    expect(getRefreshState().pendingRequests).toBe(0);
  });

  it('updates metrics demand when metrics domains toggle', () => {
    refreshOrchestrator.registerDomain({
      domain: 'cluster-overview',
      refresherName: SYSTEM_REFRESHERS.clusterOverview,
      category: 'cluster',
    });

    // Metrics demand should follow the visibility of metrics-driven domains.
    refreshOrchestrator.setScopedDomainEnabled('cluster-overview', 'cluster-a', true);
    expect(clientMocks.setMetricsActiveMock).toHaveBeenCalledWith(true);

    refreshOrchestrator.setScopedDomainEnabled('cluster-overview', 'cluster-a', false);
    expect(clientMocks.setMetricsActiveMock).toHaveBeenLastCalledWith(false);
    expect(clientMocks.setMetricsActiveMock).toHaveBeenCalledTimes(2);
  });

  it('keeps single-scope system domains isolated by cluster runtime', () => {
    refreshOrchestrator.registerDomain({
      domain: 'cluster-overview',
      refresherName: SYSTEM_REFRESHERS.clusterOverview,
      category: 'system',
    });

    const scopeA = buildClusterScope('cluster-a', '');
    const scopeB = buildClusterScope('cluster-b', '');

    refreshOrchestrator.setScopedDomainEnabled('cluster-overview', scopeA, true);
    setScopedDomainState('cluster-overview', scopeA, (previous) => ({
      ...previous,
      status: 'ready',
      data: { overview: { totalNodes: 1 } } as any,
      stats: { itemCount: 1, buildDurationMs: 0 },
      scope: scopeA,
    }));

    refreshOrchestrator.setScopedDomainEnabled('cluster-overview', scopeB, true);

    expect(
      orchestratorInternals.clusterRuntimes
        .get('cluster-a')
        ?.scopedEnabledState.get('cluster-overview')
        ?.get(scopeA)
    ).toBe(true);
    expect(
      orchestratorInternals.clusterRuntimes
        .get('cluster-b')
        ?.scopedEnabledState.get('cluster-overview')
        ?.get(scopeB)
    ).toBe(true);
    expect(
      orchestratorInternals.coordinatorRuntime.scopedEnabledState.get('cluster-overview')
    ).toBeUndefined();
    expect(getScopedDomainState('cluster-overview', scopeA).status).toBe('ready');
  });

  it('keeps one active scope by default within a cluster runtime', () => {
    refreshOrchestrator.registerDomain({
      domain: 'cluster-overview',
      refresherName: SYSTEM_REFRESHERS.clusterOverview,
      category: 'system',
    });

    const firstScope = buildClusterScope('cluster-a', 'overview-a');
    const secondScope = buildClusterScope('cluster-a', 'overview-b');

    refreshOrchestrator.setScopedDomainEnabled('cluster-overview', firstScope, true);
    setScopedDomainState('cluster-overview', firstScope, (previous) => ({
      ...previous,
      status: 'ready',
      data: { clusterId: 'cluster-a' } as any,
      stats: { itemCount: 1, buildDurationMs: 0 },
      scope: firstScope,
    }));

    refreshOrchestrator.setScopedDomainEnabled('cluster-overview', secondScope, true);

    const scopedMap = orchestratorInternals.clusterRuntimes
      .get('cluster-a')
      ?.scopedEnabledState.get('cluster-overview');
    expect(scopedMap?.get(firstScope)).toBe(false);
    expect(scopedMap?.get(secondScope)).toBe(true);
    expect(getScopedDomainState('cluster-overview', firstScope).status).toBe('idle');
  });

  it('allows object-panel domains to keep multiple active object scopes', () => {
    const objectPanelDomains: Array<[RefreshDomain, SystemRefresherName]> = [
      ['container-logs', SYSTEM_REFRESHERS.containerLogs],
      ['object-details', SYSTEM_REFRESHERS.objectDetails],
      ['object-events', SYSTEM_REFRESHERS.objectEvents],
      ['object-helm-manifest', SYSTEM_REFRESHERS.objectHelmManifest],
      ['object-helm-values', SYSTEM_REFRESHERS.objectHelmValues],
      ['object-maintenance', SYSTEM_REFRESHERS.objectMaintenance],
      ['object-map', SYSTEM_REFRESHERS.objectMap],
      ['object-yaml', SYSTEM_REFRESHERS.objectYaml],
    ];

    objectPanelDomains.forEach(([domain, refresherName]) => {
      resetAllScopedDomainStates(domain);
      refreshOrchestrator.registerDomain({
        domain,
        refresherName,
        category: 'system',
      });

      const firstScope = buildClusterScope('cluster-a', `${domain}:first`);
      const secondScope = buildClusterScope('cluster-a', `${domain}:second`);

      refreshOrchestrator.setScopedDomainEnabled(domain, firstScope, true);
      setScopedDomainState(domain, firstScope, (previous) => ({
        ...previous,
        status: 'ready',
        data: { value: 'first' } as any,
        stats: { itemCount: 1, buildDurationMs: 0 },
        scope: firstScope,
      }));

      refreshOrchestrator.setScopedDomainEnabled(domain, secondScope, true);

      const scopedMap = orchestratorInternals.clusterRuntimes
        .get('cluster-a')
        ?.scopedEnabledState.get(domain);
      expect(scopedMap?.get(firstScope)).toBe(true);
      expect(scopedMap?.get(secondScope)).toBe(true);
      expect(getScopedDomainState(domain, firstScope).status).toBe('ready');
    });
  });

  it('replaces existing non-scoped subscriptions when re-registering a domain', () => {
    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: CLUSTER_REFRESHERS.config,
      category: 'cluster',
    });

    const subscribeResults = refreshManagerMocks.subscribeMock.mock.results;
    const firstUnsubscribe = subscribeResults[subscribeResults.length - 1]?.value as
      ReturnType<typeof vi.fn> | undefined;
    expect(firstUnsubscribe).toBeDefined();

    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: CLUSTER_REFRESHERS.config,
      category: 'cluster',
    });

    expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('enables scoped namespace domains even when namespace context is inactive', async () => {
    refreshOrchestrator.updateContext({
      currentView: 'cluster',
      activeClusterView: 'nodes',
      objectPanel: { isOpen: false },
      selectedNamespace: undefined,
    });

    refreshOrchestrator.registerDomain({
      domain: 'namespace-config',
      refresherName: NAMESPACE_REFRESHERS.config,
      category: 'namespace',
    });

    refreshManagerMocks.disableMock.mockClear();
    refreshManagerMocks.enableMock.mockClear();

    // Scoped domains can be enabled regardless of namespace context.
    refreshOrchestrator.setScopedDomainEnabled('namespace-config', 'team-a', true);

    expect(refreshManagerMocks.enableMock).toHaveBeenCalledWith(NAMESPACE_REFRESHERS.config);
  });

  it('uses snapshot fetch for manual refresh on SSE domains even when stream is active', async () => {
    catalogStreamMocks.refreshOnce.mockClear();
    clientMocks.fetchSnapshotMock.mockClear();

    registerCatalogDomain();

    // Enable the scope and simulate an already-active stream by injecting cleanup directly.
    setRuntimeScopeEnabled('catalog', 'scope=all', true);
    orchestratorInternals.coordinatorRuntime.streamingCleanup.set(
      makeTestInFlightKey('catalog', 'scope=all'),
      () => undefined
    );

    catalogStreamMocks.refreshOnce.mockClear();
    clientMocks.fetchSnapshotMock.mockClear();

    // Trigger a manual refresh via fetchScopedDomain.
    // Doorbell domains should fall through to a snapshot fetch instead of
    // redirecting to refreshStreamingDomainOnce for manual refresh.
    await refreshOrchestrator.fetchScopedDomain('catalog', 'scope=all', { isManual: true });

    expect(catalogStreamMocks.refreshOnce).not.toHaveBeenCalled();
    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalled();
  });

  it('does not let a healthy catalog stream for one scope skip another scope snapshot', async () => {
    registerCatalogDomain();
    const pageScope = buildClusterScope('cluster-a', 'limit=50&namespace=cluster');
    const metadataScope = buildClusterScope('cluster-a', 'limit=1&namespace=cluster');
    setRuntimeScopeEnabled('catalog', pageScope, true);
    resourceStreamMocks.isHealthy.mockImplementation(
      (_domain?: string, scope?: string) => scope === metadataScope
    );
    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'catalog',
        scope: pageScope,
        version: 1,
        checksum: 'catalog-page',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          clusterId: 'cluster-a',
          items: [],
          total: 0,
          resourceCount: 0,
          batchIndex: 0,
          batchSize: 0,
          totalBatches: 1,
          isFinal: true,
        },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      etag: 'catalog-page',
      notModified: false,
    });

    await refreshOrchestrator.fetchScopedDomain('catalog', pageScope, { isManual: false });

    expect(resourceStreamMocks.isHealthy).toHaveBeenCalledWith('catalog', pageScope);
    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'catalog',
      expect.objectContaining({ scope: pageScope })
    );
  });

  it('keeps polling enabled when a resource stream is active but unhealthy', () => {
    registerStreamingClusterConfigDomain();

    const scope = buildClusterScope('cluster-a', '');
    setRuntimeScopeEnabled('cluster-config', scope, true);
    markResourceStreamActive('cluster-config', scope);
    resourceStreamMocks.isHealthy.mockReturnValue(false);

    refreshManagerMocks.enableMock.mockClear();
    refreshManagerMocks.disableMock.mockClear();

    orchestratorInternals.handleResourceStreamHealth({
      domain: 'cluster-config',
      scope,
      status: 'unhealthy',
      reason: 'no-delivery',
      connectionStatus: 'connected',
    });

    expect(
      orchestratorInternals.clusterRuntimes
        .get('cluster-a')
        ?.streamHealth.get(makeTestInFlightKey('cluster-config', scope))?.status
    ).toBe('unhealthy');
  });

  it('pauses polling when a resource stream is active and healthy', () => {
    registerStreamingClusterConfigDomain();

    const scope = buildClusterScope('cluster-a', '');
    setRuntimeScopeEnabled('cluster-config', scope, true);
    markResourceStreamActive('cluster-config', scope);
    resourceStreamMocks.isHealthy.mockReturnValue(true);

    refreshManagerMocks.enableMock.mockClear();
    refreshManagerMocks.disableMock.mockClear();

    orchestratorInternals.handleResourceStreamHealth({
      domain: 'cluster-config',
      scope,
      status: 'healthy',
      reason: 'delivering',
      connectionStatus: 'connected',
    });

    expect(
      orchestratorInternals.clusterRuntimes
        .get('cluster-a')
        ?.streamHealth.get(makeTestInFlightKey('cluster-config', scope))?.status
    ).toBe('healthy');
  });

  it('falls back to snapshots when a resource stream is unhealthy', async () => {
    // Register cluster-config as scoped (matching production config) with streaming.
    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: CLUSTER_REFRESHERS.config,
      category: 'cluster',
      streaming: {
        start: (scope: string) => resourceStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          resourceStreamMocks.stop(scope, options),
        refreshOnce: (scope: string) => resourceStreamMocks.refreshOnce(scope),
        pauseRefresherWhenStreaming: true,
      },
    });

    const scope = buildClusterScope('cluster-a', '');
    orchestratorInternals.context = {
      currentView: 'cluster',
      activeClusterView: 'config',
      selectedClusterIds: ['cluster-a'],
      objectPanel: { isOpen: false },
    };
    // Enable the scoped domain and mark the stream as active but unhealthy.
    await refreshOrchestrator.setScopedDomainEnabled?.('cluster-config', scope, true);
    markResourceStreamActive('cluster-config', scope);
    resourceStreamMocks.isHealthy.mockReturnValue(false);

    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'cluster-config',
        scope,
        version: 1,
        checksum: 'etag-1',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          resources: [],
        },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      etag: 'etag-1',
      notModified: false,
    });

    // With unhealthy stream, fetchScopedDomain should fall back to a snapshot fetch.
    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { isManual: false });

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'cluster-config',
      expect.objectContaining({ scope })
    );

    clientMocks.fetchSnapshotMock.mockClear();
    resourceStreamMocks.isHealthy.mockReturnValue(true);

    // With healthy stream, fetchScopedDomain should skip the snapshot fetch.
    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { isManual: false });

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it('uses resource stream refreshOnce for manual metrics domains with an active stream', async () => {
    registerStreamingPodsDomain();
    const scope = buildClusterScope('cluster-a', 'namespace:team-a');
    refreshOrchestrator.updateContext({
      currentView: 'namespace',
      activeNamespaceView: 'pods',
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a'],
    });
    markResourceStreamActive('pods', scope);
    resourceStreamMocks.isHealthy.mockReturnValue(true);

    await refreshOrchestrator.fetchScopedDomain('pods', scope, { isManual: true });

    expect(resourceStreamMocks.refreshOnce).toHaveBeenCalledWith(scope);
    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it('uses snapshots without opening a resource stream for query-backed typed table scopes', async () => {
    registerStreamingPodsDomain();
    const scope = buildClusterScope(
      'cluster-a',
      'namespace:all?limit=50&sort=name&sortDirection=asc'
    );
    refreshOrchestrator.updateContext({
      currentView: 'namespace',
      activeNamespaceView: 'pods',
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a'],
    });
    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'pods',
        scope,
        version: 1,
        checksum: 'etag-query',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          clusterId: 'cluster-a',
          rows: [makePodRow({ clusterId: 'cluster-a', namespace: 'team-a', name: 'pod-a' })],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-query',
      notModified: false,
    });

    refreshOrchestrator.setScopedDomainEnabled('pods', scope, true);
    await refreshOrchestrator.fetchScopedDomain('pods', scope, { isManual: false });

    expect(resourceStreamMocks.start).not.toHaveBeenCalled();
    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'pods',
      expect.objectContaining({ scope })
    );
    expect(getScopedDomainState('pods', scope).data?.rows).toHaveLength(1);
  });

  it('falls back to full snapshots for metrics domains when a stream is unhealthy', async () => {
    registerStreamingPodsDomain();
    const scope = buildClusterScope('cluster-a', 'namespace:team-a');
    refreshOrchestrator.updateContext({
      currentView: 'namespace',
      activeNamespaceView: 'pods',
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a'],
    });
    markResourceStreamActive('pods', scope);
    resourceStreamMocks.isHealthy.mockReturnValue(false);

    setScopedDomainState('pods', scope, () => ({
      status: 'ready',
      data: {
        clusterId: 'cluster-a',
        rows: [
          makePodRow({
            clusterId: 'cluster-a',
            namespace: 'team-a',
            name: 'pod-a',
            status: 'Running',
            cpuUsage: '10m',
            memUsage: '20Mi',
          }),
        ],
      },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope,
    }));

    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'pods',
        scope,
        version: 1,
        checksum: 'etag-pods',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          clusterId: 'cluster-a',
          rows: [
            makePodRow({
              clusterId: 'cluster-a',
              namespace: 'team-a',
              name: 'pod-a',
              status: 'Pending',
              cpuUsage: '15m',
              memUsage: '25Mi',
            }),
          ],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-pods',
      notModified: false,
    });

    await refreshOrchestrator.fetchScopedDomain('pods', scope, { isManual: false });

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'pods',
      expect.objectContaining({ scope })
    );
    const nextPod = getScopedDomainState('pods', scope).data?.rows?.[0];
    expect(nextPod?.status).toBe('Pending');
    expect(nextPod?.cpuUsage).toBe('15m');

    resetAllScopedDomainStates('pods');
  });

  it('skips enabling streaming domains when no scope is available', async () => {
    catalogStreamMocks.start.mockClear();
    refreshManagerMocks.enableMock.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      refresherName: CLUSTER_REFRESHERS.browse,
      category: 'cluster',

      streaming: {
        start: (scope: string) => catalogStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => catalogStreamMocks.refreshOnce(scope),
      },
    });

    // With no scopes registered, setDomainEnabled has no scopes to enable.
    await refreshOrchestrator.setDomainEnabled('catalog', true);

    expect(catalogStreamMocks.start).not.toHaveBeenCalled();
    expect(refreshManagerMocks.enableMock).not.toHaveBeenCalledWith(CLUSTER_REFRESHERS.browse);
  });

  it('does not start passive streaming while auto-refresh is disabled', async () => {
    registerStreamingClusterConfigDomain();
    refreshOrchestrator.updateContext({
      currentView: 'cluster',
      activeClusterView: 'config',
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a'],
    });

    const scope = buildClusterScope('cluster-a', 'config');
    setAutoRefreshEnabled(false);
    refreshOrchestrator.setScopedDomainEnabled('cluster-config', scope, true);
    await Promise.resolve();

    expect(resourceStreamMocks.start).not.toHaveBeenCalled();
  });

  it('stops and resumes passive streaming when auto-refresh is toggled', async () => {
    registerStreamingClusterConfigDomain();
    refreshOrchestrator.updateContext({
      currentView: 'cluster',
      activeClusterView: 'config',
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a'],
    });

    const scope = buildClusterScope('cluster-a', 'config');
    refreshOrchestrator.setScopedDomainEnabled('cluster-config', scope, true);
    await Promise.resolve();

    expect(resourceStreamMocks.start).toHaveBeenCalledWith(scope);

    resourceStreamMocks.stop.mockClear();
    resourceStreamMocks.start.mockClear();

    setAutoRefreshEnabled(false);
    await Promise.resolve();

    expect(resourceStreamMocks.stop).toHaveBeenCalledWith(scope, { reset: false });

    setAutoRefreshEnabled(true);
    await Promise.resolve();

    expect(resourceStreamMocks.start).toHaveBeenCalledWith(scope);
  });

  it('restarts streaming when the active scope changes', async () => {
    const cleanup = vi.fn();
    catalogStreamMocks.start.mockImplementation((_scope) => cleanup);
    catalogStreamMocks.stop.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      refresherName: CLUSTER_REFRESHERS.browse,
      category: 'cluster',

      streaming: {
        start: (scope: string) => {
          catalogStreamMocks.start(scope);
          return cleanup;
        },
        stop: (scope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => catalogStreamMocks.refreshOnce(scope),
      },
    });

    await refreshOrchestrator.setScopedDomainEnabled('catalog', 'scope=team-a', true);
    await Promise.resolve();
    expect(catalogStreamMocks.start).toHaveBeenCalledWith('scope=team-a');

    catalogStreamMocks.start.mockClear();
    catalogStreamMocks.stop.mockClear();
    cleanup.mockClear();

    // Switch scope by disabling the old one and enabling the new one.
    await refreshOrchestrator.setScopedDomainEnabled('catalog', 'scope=team-a', false);
    await refreshOrchestrator.setScopedDomainEnabled('catalog', 'scope=team-b', true);
    await Promise.resolve();

    expect(catalogStreamMocks.stop).toHaveBeenCalledWith('scope=team-a', true);
    expect(cleanup).toHaveBeenCalled();
    expect(catalogStreamMocks.start).toHaveBeenCalledWith('scope=team-b');
  });

  it('stops streaming when the scope is disabled', async () => {
    const cleanup = vi.fn();
    catalogStreamMocks.start.mockClear();
    catalogStreamMocks.stop.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      refresherName: CLUSTER_REFRESHERS.browse,
      category: 'cluster',

      streaming: {
        start: (scope: string) => {
          catalogStreamMocks.start(scope);
          return cleanup;
        },
        stop: (scope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => catalogStreamMocks.refreshOnce(scope),
      },
    });

    await refreshOrchestrator.setScopedDomainEnabled('catalog', 'scope=team-a', true);
    await Promise.resolve();
    expect(catalogStreamMocks.start).toHaveBeenCalledWith('scope=team-a');

    cleanup.mockClear();
    catalogStreamMocks.start.mockClear();
    catalogStreamMocks.stop.mockClear();

    await refreshOrchestrator.setScopedDomainEnabled('catalog', 'scope=team-a', false);

    expect(catalogStreamMocks.stop).toHaveBeenCalledWith('scope=team-a', true);
    expect(cleanup).toHaveBeenCalled();
  });

  it('cleans up pending streaming promises and logs errors when cleanup fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      refresherName: CLUSTER_REFRESHERS.browse,
      category: 'cluster',

      streaming: {
        start: (scope: string) => catalogStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => catalogStreamMocks.refreshOnce(scope),
      },
    });

    const streamingRegistration = orchestratorInternals.configs.get('catalog')!.streaming!;
    const key = makeTestInFlightKey('catalog', 'scope=test');
    const pendingCleanup = vi.fn(() => {
      throw new Error('pending failure');
    });
    let resolvePending: ((value: () => void) => void) | undefined;
    const pendingPromise = new Promise<() => void>((resolve) => {
      resolvePending = resolve;
    });
    orchestratorInternals.coordinatorRuntime.pendingStreaming.set(key, pendingPromise);
    orchestratorInternals.coordinatorRuntime.streamingCleanup.set(key, () => {
      throw new Error('cleanup failure');
    });

    orchestratorInternals.stopStreamingScope('catalog', 'scope=test', streamingRegistration, true);
    resolvePending?.(pendingCleanup);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pendingCleanup).toHaveBeenCalled();
    expect(consoleSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(consoleSpy.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.stringContaining('Failed to stop pending streaming domain catalog::scope=test'),
          expect.any(Error),
        ],
        [
          expect.stringContaining('Failed to stop streaming domain catalog::scope=test'),
          expect.any(Error),
        ],
      ])
    );
    expect(orchestratorInternals.coordinatorRuntime.streamingCleanup.has(key)).toBe(false);
    consoleSpy.mockRestore();
  });

  it('skips scheduling scoped streaming when domain is disabled', async () => {
    const streaming = {
      start: vi.fn(() => vi.fn()),
      stop: vi.fn(),
    };

    orchestratorInternals.coordinatorRuntime.scopedEnabledState.set(
      'namespace-events',
      new Map([['team-a', false]])
    );

    await orchestratorInternals.scheduleStreamingStart('namespace-events', 'team-a', streaming);

    expect(streaming.start).not.toHaveBeenCalled();
  });

  it('suppresses catalog hydration errors from bubbling to user error handler', async () => {
    const scope = 'cluster-a';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    clientMocks.fetchSnapshotMock.mockRejectedValue(
      new Error('Catalog hydration incomplete - retry')
    );

    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: 'cluster-config',
      category: 'cluster',
    });
    refreshOrchestrator.setScopedDomainEnabled('cluster-config', scope, true);
    errorHandlerMock.handle.mockClear();

    await subscriber?.(false, new AbortController().signal);

    expect(errorHandlerMock.handle).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('hydration warning suppressed for cluster-config')
    );

    warnSpy.mockRestore();
  });

  it('starts and stops streaming managers for scoped domains', async () => {
    containerLogsStreamMocks.start.mockClear();
    containerLogsStreamMocks.stop.mockClear();
    containerLogsStreamMocks.refreshOnce.mockClear();
    eventStreamMocks.startNamespace.mockClear();
    eventStreamMocks.stopNamespace.mockClear();
    eventStreamMocks.refreshNamespace.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'container-logs',
      refresherName: SYSTEM_REFRESHERS.containerLogs,
      category: 'system',

      streaming: {
        start: (scope: string) => containerLogsStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          containerLogsStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => containerLogsStreamMocks.refreshOnce(scope),
      },
    });

    await refreshOrchestrator.setScopedDomainEnabled?.('container-logs', 'team-a', true);
    expect(containerLogsStreamMocks.start).toHaveBeenCalledWith('team-a');

    await refreshOrchestrator.refreshStreamingDomainOnce('container-logs', 'team-a');
    expect(containerLogsStreamMocks.refreshOnce).toHaveBeenCalledWith('team-a');

    await refreshOrchestrator.setScopedDomainEnabled?.('container-logs', 'team-a', false);
    expect(containerLogsStreamMocks.stop).toHaveBeenCalledWith('team-a', true);

    catalogStreamMocks.start.mockClear();
    catalogStreamMocks.stop.mockClear();
    catalogStreamMocks.refreshOnce.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      refresherName: CLUSTER_REFRESHERS.browse,
      category: 'cluster',

      streaming: {
        start: (scope: string) => catalogStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => catalogStreamMocks.refreshOnce(scope),
      },
    });

    await refreshOrchestrator.setScopedDomainEnabled?.('catalog', 'limit=1000', true);
    expect(catalogStreamMocks.start).toHaveBeenCalledWith('limit=1000');

    await refreshOrchestrator.refreshStreamingDomainOnce('catalog', 'limit=1000');
    expect(catalogStreamMocks.refreshOnce).toHaveBeenCalledWith('limit=1000');

    await refreshOrchestrator.setScopedDomainEnabled?.('catalog', 'limit=1000', false);
    expect(catalogStreamMocks.stop).toHaveBeenCalledWith('limit=1000', true);

    // cluster-events is now a scoped domain (matching production config).
    eventStreamMocks.startCluster.mockClear();
    eventStreamMocks.stopCluster.mockClear();
    eventStreamMocks.refreshCluster.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'cluster-events',
      refresherName: CLUSTER_REFRESHERS.events,
      category: 'cluster',
      streaming: {
        start: (scope: string) => eventStreamMocks.startCluster(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopCluster(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => eventStreamMocks.refreshCluster(scope),
      },
    });

    await refreshOrchestrator.setScopedDomainEnabled?.('cluster-events', 'cluster', true);
    expect(eventStreamMocks.startCluster).toHaveBeenCalledWith('cluster');

    await refreshOrchestrator.refreshStreamingDomainOnce('cluster-events', 'cluster');
    expect(eventStreamMocks.refreshCluster).toHaveBeenCalledWith('cluster');

    await refreshOrchestrator.setScopedDomainEnabled?.('cluster-events', 'cluster', false);
    expect(eventStreamMocks.stopCluster).toHaveBeenCalledWith('cluster', true);
  });

  it('handles concurrent namespace streams without leaking state', async () => {
    containerLogsStreamMocks.start.mockClear();
    containerLogsStreamMocks.stop.mockClear();
    containerLogsStreamMocks.refreshOnce.mockClear();
    eventStreamMocks.startNamespace.mockClear();
    eventStreamMocks.stopNamespace.mockClear();
    eventStreamMocks.refreshNamespace?.mockClear?.();

    refreshOrchestrator.registerDomain({
      domain: 'container-logs',
      refresherName: SYSTEM_REFRESHERS.containerLogs,
      category: 'system',

      streaming: {
        start: (scope: string) => containerLogsStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          containerLogsStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => containerLogsStreamMocks.refreshOnce(scope),
      },
    });

    refreshOrchestrator.registerDomain({
      domain: 'namespace-events',
      refresherName: NAMESPACE_REFRESHERS.events,
      category: 'namespace',

      streaming: {
        start: (scope: string) => eventStreamMocks.startNamespace(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopNamespace(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => eventStreamMocks.refreshNamespace(scope),
      },
    });

    await refreshOrchestrator.setScopedDomainEnabled?.('container-logs', 'team-a', true);
    await refreshOrchestrator.setScopedDomainEnabled?.('namespace-events', 'team-a', true);

    expect(containerLogsStreamMocks.start).toHaveBeenCalledWith('team-a');
    expect(eventStreamMocks.startNamespace).toHaveBeenCalledWith('team-a');

    await refreshOrchestrator.refreshStreamingDomainOnce('namespace-events', 'team-a');
    expect(eventStreamMocks.refreshNamespace).toHaveBeenCalledWith('team-a');

    await refreshOrchestrator.setScopedDomainEnabled?.('container-logs', 'team-a', false);
    await refreshOrchestrator.setScopedDomainEnabled?.('namespace-events', 'team-a', false);

    expect(containerLogsStreamMocks.stop).toHaveBeenCalledWith('team-a', true);
    expect(eventStreamMocks.stopNamespace).toHaveBeenCalledWith('team-a', true);
  });

  it('trims scoped streaming scopes when toggling enablement', async () => {
    const startSpy = vi.fn((_scope: string) => vi.fn());
    const stopSpy = vi.fn();

    refreshOrchestrator.registerDomain({
      domain: 'container-logs',
      refresherName: SYSTEM_REFRESHERS.containerLogs,
      category: 'system',

      streaming: {
        start: startSpy,
        stop: (scope: string, options?: { reset?: boolean }) =>
          stopSpy(scope, options?.reset ?? false),
      },
    });

    refreshOrchestrator.setScopedDomainEnabled('container-logs', '  Team-A  ', true);
    await Promise.resolve();
    expect(startSpy).toHaveBeenCalledWith('Team-A');

    refreshOrchestrator.setScopedDomainEnabled('container-logs', 'Team-A', true);
    expect(startSpy).toHaveBeenCalledTimes(1);

    refreshOrchestrator.setScopedDomainEnabled('container-logs', 'Team-A', false);
    expect(stopSpy).toHaveBeenCalledWith('Team-A', true);
  });

  it('prevents enabling namespace domains outside of an active namespace context', () => {
    refreshOrchestrator.registerDomain({
      domain: 'namespace-config',
      refresherName: NAMESPACE_REFRESHERS.config,
      category: 'namespace',
    });

    refreshOrchestrator.updateContext({
      currentView: 'cluster',
      selectedNamespace: undefined,
    });

    refreshOrchestrator.setDomainEnabled('namespace-config', true);

    expect(refreshManagerMocks.disableMock).toHaveBeenCalledWith(NAMESPACE_REFRESHERS.config);
    const state = getScopedDomainState('namespace-config', '');
    expect(state.status).toBe('idle');
    expect(state.data).toBeNull();
  });

  it('validates scoped domain enablement requires a non-empty scope', async () => {
    refreshOrchestrator.registerDomain({
      domain: 'namespace-events',
      refresherName: NAMESPACE_REFRESHERS.events,
      category: 'namespace',

      streaming: {
        start: (scope: string) => eventStreamMocks.startNamespace(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopNamespace(scope, options?.reset ?? false),
      },
    });

    expect(() =>
      refreshOrchestrator.setScopedDomainEnabled('namespace-events', '   ', true)
    ).toThrow('requires a non-empty scope value');
  });

  it('preserves event stream state when toggling scoped enablement with preserveState', async () => {
    eventStreamMocks.startCluster.mockClear();
    eventStreamMocks.stopCluster.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'cluster-events',
      refresherName: CLUSTER_REFRESHERS.events,
      category: 'cluster',

      streaming: {
        start: (scope: string) => eventStreamMocks.startCluster(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopCluster(scope, options?.reset ?? false),
      },
    });

    setScopedDomainState('cluster-events', 'cluster', (previous) => ({
      ...previous,
      status: 'ready',
      data: {
        clusterId: 'cluster-a',
        rows: [
          {
            kind: 'Event',
            clusterId: 'cluster-a',
            name: 'existing',
            namespace: 'default',
            type: 'Normal',
            source: 'kubelet',
            reason: 'Started',
            object: 'Pod/web',
            message: 'still here',
            age: '1m',
          },
        ],
      },
      error: null,
      lastUpdated: 1,
      lastAutoRefresh: 1,
      isManual: false,
      scope: 'cluster',
      stats: null,
    }));

    await refreshOrchestrator.setScopedDomainEnabled('cluster-events', 'cluster', false, {
      preserveState: true,
    });
    expect(eventStreamMocks.stopCluster).toHaveBeenCalledWith('cluster', false);
    expect(getScopedDomainState('cluster-events', 'cluster').data?.rows).toHaveLength(1);

    await refreshOrchestrator.setScopedDomainEnabled('cluster-events', 'cluster', true, {
      preserveState: true,
    });
    expect(eventStreamMocks.startCluster).toHaveBeenCalledWith('cluster');

    const state = getScopedDomainState('cluster-events', 'cluster');
    expect(state.status).toBe('updating');
    expect(state.data?.rows?.[0].message).toBe('still here');
  });

  it('resets state when streaming start fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const startError = new Error('stream boom');

    containerLogsStreamMocks.start.mockRejectedValueOnce(startError);
    refreshOrchestrator.registerDomain({
      domain: 'container-logs',
      refresherName: SYSTEM_REFRESHERS.containerLogs,
      category: 'system',

      streaming: {
        start: (scope: string) => containerLogsStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          containerLogsStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => containerLogsStreamMocks.refreshOnce(scope),
      },
    });

    await refreshOrchestrator.setScopedDomainEnabled?.('container-logs', 'team-a', true);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(containerLogsStreamMocks.start).toHaveBeenCalledWith('team-a');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to start streaming domain container-logs::team-a'),
      startError
    );
    expect(orchestratorInternals.coordinatorRuntime.streamingCleanup.size).toBe(0);
    const scopedState = getScopedDomainState('container-logs', 'team-a');
    expect(scopedState.status).toBe('error');
    expect(scopedState.error).toContain('stream boom');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        domain: 'container-logs',
        scope: 'team-a',
      })
    );

    consoleSpy.mockRestore();
  });

  it('surfaces streaming initialisation failures and clears loading state when scope creation fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    clientMocks.ensureRefreshBaseURLMock.mockRejectedValueOnce(new Error('bootstrap failed'));

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      refresherName: CLUSTER_REFRESHERS.browse,
      category: 'cluster',

      streaming: {
        start: (scope: string) => catalogStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => catalogStreamMocks.refreshOnce(scope),
      },
    });

    refreshOrchestrator.setScopedDomainEnabled('catalog', 'limit=100', true);
    await Promise.resolve();
    await Promise.resolve();

    const state = getScopedDomainState('catalog', 'limit=100');
    expect(state.status).toBe('error');
    expect(state.error).toContain('bootstrap failed');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to initialise streaming for catalog'),
      expect.any(Error)
    );
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        domain: 'catalog',
        scope: 'limit=100',
      })
    );

    consoleSpy.mockRestore();
  });

  it('deduplicates identical refresh errors for streaming and snapshot domains', async () => {
    const scope = 'cluster-a';
    clientMocks.fetchSnapshotMock.mockRejectedValue(new Error('backend unavailable'));

    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: CLUSTER_REFRESHERS.config,
      category: 'cluster',
    });
    refreshOrchestrator.setScopedDomainEnabled('cluster-config', scope, true);

    await subscriber?.(false, new AbortController().signal);
    await subscriber?.(true, new AbortController().signal);

    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(1);
  });

  it('rejects multi-cluster resource stream refresh scopes', async () => {
    registerPodsDomain();
    const scope = 'clusters=cluster-a,cluster-b|namespace:default';

    await expect(
      refreshOrchestrator.fetchScopedDomain('pods', scope, { isManual: false })
    ).rejects.toThrow('single cluster');

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it('refreshes background resource domains one cluster at a time', async () => {
    registerPodsDomain();

    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'pods',
        scope: buildClusterScope('cluster-a', 'namespace:default'),
        version: 1,
        checksum: 'etag-a',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          clusterId: 'cluster-a',
          rows: [
            {
              clusterId: 'cluster-a',
              name: 'pod-a',
              namespace: 'default',
              status: 'Running',
            },
          ],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-a',
      notModified: false,
    });
    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'pods',
        scope: buildClusterScope('cluster-b', 'namespace:default'),
        version: 1,
        checksum: 'etag-b',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          clusterId: 'cluster-b',
          rows: [
            {
              clusterId: 'cluster-b',
              name: 'pod-b',
              namespace: 'default',
              status: 'Running',
            },
          ],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-b',
      notModified: false,
    });

    await refreshOrchestrator.fetchDomainForCluster('pods', 'cluster-a', 'namespace:default');
    await refreshOrchestrator.fetchDomainForCluster('pods', 'cluster-b', 'namespace:default');

    const scopes = clientMocks.fetchSnapshotMock.mock.calls.map((call) => call[1]?.scope);
    expect(scopes).toEqual(['cluster-a|namespace:default', 'cluster-b|namespace:default']);
    expect(getScopedDomainState('pods', 'cluster-a|namespace:default').data?.rows).toHaveLength(1);
    expect(getScopedDomainState('pods', 'cluster-b|namespace:default').data?.rows).toHaveLength(1);
    expect(orchestratorInternals.clusterRuntimes.has('cluster-a')).toBe(true);
    expect(orchestratorInternals.clusterRuntimes.has('cluster-b')).toBe(true);
    expect(orchestratorInternals.coordinatorRuntime.scopedEnabledState.get('pods')).toBeUndefined();
  });

  it('updates disabled retained scopes during background refresh without clearing cached state', async () => {
    registerPodsDomain();
    const scope = buildClusterScope('cluster-b', 'namespace:default');

    refreshOrchestrator.setScopedDomainEnabled('pods', scope, true);
    setScopedDomainState('pods', scope, (previous) => ({
      ...previous,
      status: 'ready',
      data: {
        clusterId: 'cluster-b',
        rows: [makePodRow({ clusterId: 'cluster-b', name: 'cached-pod' })],
      },
      scope,
    }));
    refreshOrchestrator.setScopedDomainEnabled('pods', scope, false, {
      preserveState: true,
    });

    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'pods',
        scope,
        version: 2,
        checksum: 'etag-retained',
        generatedAt: Date.now(),
        sequence: 2,
        payload: {
          clusterId: 'cluster-b',
          rows: [makePodRow({ clusterId: 'cluster-b', name: 'fresh-pod' })],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-retained',
      notModified: false,
    });

    await refreshOrchestrator.fetchDomainForCluster('pods', 'cluster-b', 'namespace:default');

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'pods',
      expect.objectContaining({ scope })
    );
    expect(getScopedDomainState('pods', scope).data?.rows?.[0]?.name).toBe('fresh-pod');
  });

  it('removes runtime state for disconnected background clusters', () => {
    registerStreamingClusterConfigDomain();
    refreshOrchestrator.updateContext({
      currentView: 'cluster',
      activeClusterView: 'config',
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a'],
      allConnectedClusterIds: ['cluster-a', 'cluster-b'],
    });

    const scopeA = buildClusterScope('cluster-a', '');
    const scopeB = buildClusterScope('cluster-b', '');
    setRuntimeScopeEnabled('cluster-config', scopeA, true);
    setRuntimeScopeEnabled('cluster-config', scopeB, true);
    markResourceStreamActive('cluster-config', scopeA);
    markResourceStreamActive('cluster-config', scopeB);
    setScopedDomainState('cluster-config', scopeB, (previous) => ({
      ...previous,
      status: 'ready',
      data: { clusterId: 'cluster-b', rows: [] },
      scope: scopeB,
    }));

    refreshOrchestrator.updateContext({
      allConnectedClusterIds: ['cluster-a'],
      selectedClusterIds: ['cluster-a'],
      selectedClusterId: 'cluster-a',
    });

    expect(orchestratorInternals.clusterRuntimes.has('cluster-a')).toBe(true);
    expect(orchestratorInternals.clusterRuntimes.has('cluster-b')).toBe(false);
    expect(resourceStreamMocks.stop).toHaveBeenCalledWith(scopeB, { reset: true });
    expect(getScopedDomainState('cluster-config', scopeB).status).toBe('idle');
  });

  it('records resource stream drift in the owning cluster runtime', () => {
    registerStreamingClusterConfigDomain();
    const scope = buildClusterScope('cluster-a', '');
    markResourceStreamActive('cluster-config', scope);

    orchestratorInternals.handleResourceStreamDrift({
      domain: 'cluster-config',
      scope,
      reason: 'key mismatch',
      streamCount: 2,
      snapshotCount: 1,
      missingKeys: 1,
      extraKeys: 0,
    });

    const key = makeTestInFlightKey('cluster-config', scope);
    expect(orchestratorInternals.clusterRuntimes.get('cluster-a')?.blockedStreaming.has(key)).toBe(
      true
    );
    expect(orchestratorInternals.coordinatorRuntime.blockedStreaming.has(key)).toBe(false);
  });

  it('clears cluster runtime transient state on auth failure and restarts after recovery', async () => {
    registerStreamingClusterConfigDomain();
    refreshOrchestrator.updateContext({
      currentView: 'cluster',
      activeClusterView: 'config',
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a'],
      allConnectedClusterIds: ['cluster-a', 'cluster-b'],
    });

    const scopeA = buildClusterScope('cluster-a', '');
    const scopeB = buildClusterScope('cluster-b', '');
    setRuntimeScopeEnabled('cluster-config', scopeA, true);
    setRuntimeScopeEnabled('cluster-config', scopeB, true);

    const runtimeA = orchestratorInternals.getRuntimeForScope('cluster-config', scopeA);
    const keyA = makeTestInFlightKey('cluster-config', scopeA);
    runtimeA.streamingReady.set(keyA, Promise.resolve());
    runtimeA.pendingStreaming.set(keyA, Promise.resolve());
    runtimeA.cancelledStreaming.add(keyA);
    runtimeA.inFlight.set(keyA, {
      controller: new AbortController(),
      isManual: false,
      requestId: 1,
      contextVersion: 0,
      domain: 'cluster-config',
      scope: scopeA,
    });

    orchestratorInternals.handleClusterAuthFailed({ clusterId: 'cluster-a' });

    expect(runtimeA.inFlight.size).toBe(0);
    expect(runtimeA.streamingReady.size).toBe(0);
    expect(runtimeA.pendingStreaming.size).toBe(0);
    expect(runtimeA.cancelledStreaming.size).toBe(0);

    resourceStreamMocks.start.mockClear();
    orchestratorInternals.handleClusterAuthFailed({ clusterId: 'cluster-b' });
    orchestratorInternals.handleClusterAuthRecovered({ clusterId: 'cluster-a' });
    expect(resourceStreamMocks.start).not.toHaveBeenCalled();

    orchestratorInternals.handleClusterAuthRecovered({ clusterId: 'cluster-b' });
    await Promise.resolve();
    await Promise.resolve();
    expect(resourceStreamMocks.start).toHaveBeenCalledWith(scopeA);
    expect(resourceStreamMocks.start).toHaveBeenCalledWith(scopeB);
  });

  it('keeps metrics freshness isolated to the owning cluster runtime', async () => {
    registerStreamingPodsDomain();
    const scopeA = buildClusterScope('cluster-a', 'namespace:default');
    const scopeB = buildClusterScope('cluster-b', 'namespace:default');
    refreshOrchestrator.updateContext({
      currentView: 'namespace',
      activeNamespaceView: 'pods',
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a'],
      allConnectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    markResourceStreamActive('pods', scopeA);
    markResourceStreamActive('pods', scopeB);
    resourceStreamMocks.isHealthy.mockReturnValue(true);

    const podA = makePodRow({
      clusterId: 'cluster-a',
      namespace: 'default',
      name: 'pod-a',
      status: 'Running',
      cpuUsage: '10m',
      memUsage: '20Mi',
    });
    const podB = makePodRow({
      clusterId: 'cluster-b',
      namespace: 'default',
      name: 'pod-b',
      node: 'node-b',
      status: 'Running',
      cpuUsage: '30m',
      memUsage: '40Mi',
    });

    setScopedDomainState('pods', scopeA, () => ({
      status: 'ready',
      data: { clusterId: 'cluster-a', rows: [podA] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: scopeA,
    }));
    setScopedDomainState('pods', scopeB, () => ({
      status: 'ready',
      data: { clusterId: 'cluster-b', rows: [podB] },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: scopeB,
    }));
    orchestratorInternals
      .getRuntimeForScope('pods', scopeA)
      .recordMetricsRefresh('pods', scopeA, Date.now());

    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'pods',
        scope: scopeB,
        version: 2,
        checksum: 'etag-pods-b',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          clusterId: 'cluster-b',
          rows: [
            {
              ...podB,
              cpuUsage: '35m',
              memUsage: '45Mi',
            },
          ],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-pods-b',
      notModified: false,
    });

    await refreshOrchestrator.fetchScopedDomain('pods', scopeA, { isManual: false });
    await refreshOrchestrator.fetchScopedDomain('pods', scopeB, { isManual: false });

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledTimes(1);
    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'pods',
      expect.objectContaining({ scope: scopeB })
    );
    expect(getScopedDomainState('pods', scopeA).data?.rows?.[0]).toBe(podA);
    const nextPodB = getScopedDomainState('pods', scopeB).data?.rows?.[0];
    expect(nextPodB?.status).toBe('Running');
    expect(nextPodB?.cpuUsage).toBe('35m');
    expect(nextPodB?.memUsage).toBe('45Mi');

    resetAllScopedDomainStates('pods');
  });

  it('keeps the normal pod snapshot path free of metrics errors', async () => {
    registerStreamingPodsDomain();
    const scope = buildClusterScope('cluster-a', 'namespace:default');
    refreshOrchestrator.updateContext({
      currentView: 'namespace',
      activeNamespaceView: 'pods',
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a'],
    });
    markResourceStreamActive('pods', scope);
    resourceStreamMocks.isHealthy.mockReturnValue(true);

    const existingPod = makePodRow({
      clusterId: 'cluster-a',
      namespace: 'default',
      name: 'pod-a',
      status: 'Running',
      cpuUsage: '10m',
      memUsage: '20Mi',
    });
    setScopedDomainState('pods', scope, () => ({
      status: 'ready',
      data: {
        clusterId: 'cluster-a',
        rows: [existingPod],
      },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope,
    }));

    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'pods',
        scope,
        version: 2,
        checksum: 'etag-pods-rbac',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          clusterId: 'cluster-a',
          rows: [
            {
              ...existingPod,
            },
          ],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-pods-rbac',
      notModified: false,
    });

    await refreshOrchestrator.fetchScopedDomain('pods', scope, { isManual: false });

    const nextState = getScopedDomainState('pods', scope);
    expect(nextState.data?.rows?.[0]).toEqual(existingPod);
    expect(nextState.data).not.toHaveProperty('metrics');

    resetAllScopedDomainStates('pods');
  });

  it('never treats one-shot query scopes (`?` params) as streaming targets', () => {
    // Typed events queries use parameterized one-shot scopes on the SAME domain
    // as the singleton events SSE stream; treating them as streamable churned
    // the shared connection on every query.
    expect(
      orchestratorInternals.shouldStreamScope('cluster-events', 'cluster-a|?limit=50&sort=age')
    ).toBe(false);
    expect(
      orchestratorInternals.shouldStreamScope(
        'namespace-events',
        'cluster-a|namespace:all?limit=50'
      )
    ).toBe(false);
  });

  it('handles global reset and kubeconfig transitions by cancelling inflight work', () => {
    const scope = 'cluster-a';
    const teardownSpy = vi.spyOn(orchestratorInternals as Record<string, any>, 'teardownInFlight');
    const stopAllSpy = vi.spyOn(orchestratorInternals as Record<string, any>, 'stopAllStreaming');

    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: CLUSTER_REFRESHERS.config,
      category: 'cluster',
    });
    refreshOrchestrator.setScopedDomainEnabled('cluster-config', scope, true);

    setScopedDomainState('cluster-config', scope, () => ({
      status: 'ready',
      data: {
        clusterId: 'test-cluster',
        rows: [
          {
            kind: 'ConfigMap',
            name: 'settings',
            details: 'cluster defaults',
            age: '5m',
            clusterId: 'test-cluster',
          },
        ],
      },
      stats: null,
      error: null,
      etag: '123',
      isManual: false,
      scope,
      droppedAutoRefreshes: 0,
    }));

    orchestratorInternals
      .getRuntimeForScope('cluster-config', scope)
      .inFlight.set(`cluster-config::${scope}`, {
        controller: new AbortController(),
        isManual: false,
        requestId: 1,
        contextVersion: 0,
        domain: 'cluster-config',
        scope,
      });

    orchestratorInternals.handleResetViews();

    expect(stopAllSpy).toHaveBeenCalledWith(true);
    expect(teardownSpy).toHaveBeenCalled();

    // Re-register after reset since handleResetViews resets domain state.
    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: CLUSTER_REFRESHERS.config,
      category: 'cluster',
    });
    refreshOrchestrator.setScopedDomainEnabled('cluster-config', scope, true);

    orchestratorInternals.handleKubeconfigChanging();
    expect(clientMocks.invalidateRefreshBaseURLMock).toHaveBeenCalled();
    expect(orchestratorInternals.suspendedDomains.get('cluster-config')).toBe(true);

    orchestratorInternals.handleKubeconfigChanged();
    expect(orchestratorInternals.suspendedDomains.size).toBe(0);

    stopAllSpy.mockRestore();
    teardownSpy.mockRestore();
  });
});
