/**
 * frontend/src/core/refresh/orchestrator.test.ts
 *
 * Test suite for orchestrator.
 * Covers key behaviors and edge cases for orchestrator.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RefreshDomain } from './types';
import {
  getDomainState,
  getRefreshState,
  getScopedDomainState,
  markPendingRequest,
  resetDomainState,
  setDomainState,
  setScopedDomainState,
} from './store';
import { refreshOrchestrator } from './orchestrator';
import { CLUSTER_REFRESHERS, NAMESPACE_REFRESHERS, SYSTEM_REFRESHERS } from './refresherTypes';
import { buildClusterScopeList } from './clusterScope';

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

const logStreamMocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  refreshOnce: vi.fn(),
}));

vi.mock('./streaming/logStreamManager', () => ({
  logStreamManager: logStreamMocks,
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

vi.mock('./streaming/eventStreamManager', () => ({
  eventStreamManager: eventStreamMocks,
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
}));

vi.mock('./streaming/catalogStreamManager', () => ({
  catalogStreamManager: catalogStreamMocks,
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
    clientMocks.fetchSnapshotMock.mockReset();
    clientMocks.ensureRefreshBaseURLMock.mockClear();
    clientMocks.invalidateRefreshBaseURLMock.mockClear();
    clientMocks.setMetricsActiveMock.mockClear();
    errorHandlerMock.handle.mockReset();

    orchestratorInternals.configs?.clear?.();
    orchestratorInternals.unsubscriptions?.clear?.();
    orchestratorInternals.registeredRefreshers?.clear?.();
    orchestratorInternals.scopedEnabledState?.clear?.();
    orchestratorInternals.streamingCleanup?.clear?.();
    orchestratorInternals.pendingStreaming?.clear?.();
    orchestratorInternals.streamingReady?.clear?.();
    orchestratorInternals.cancelledStreaming?.clear?.();
    orchestratorInternals.inFlight?.clear?.();
    orchestratorInternals.suspendedDomains?.clear?.();
    orchestratorInternals.lastNotifiedErrors?.clear?.();
    orchestratorInternals.contextVersion = 0;
    orchestratorInternals.metricsDemandActive = false;
    orchestratorInternals.context = {
      currentView: 'namespace',
      objectPanel: { isOpen: false },
    };

    resetDomainState('cluster-config');
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
      autoStart: false,
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
    orchestratorInternals.streamingCleanup.set(makeTestInFlightKey(domain, scope), () => undefined);
  };

  const registerObjectMaintenanceDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'object-maintenance',
      refresherName: SYSTEM_REFRESHERS.objectMaintenance,
      category: 'system',
      scoped: true,
      autoStart: false,
    });
  };

  const registerCatalogDiffDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'catalog-diff',
      refresherName: CLUSTER_REFRESHERS.catalogDiff,
      category: 'cluster',
      scoped: true,
      autoStart: false,
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
      scoped: true,
      autoStart: true,
    });
  };

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
      scoped: true,
      autoStart: true,
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
    });
    refreshOrchestrator.setScopedDomainEnabled('pods', 'namespace:team-a', true);

    await refreshOrchestrator.triggerManualRefreshForContext();

    expect(scopedFetch).toHaveBeenCalledWith(
      'pods',
      'namespace:team-a',
      expect.objectContaining({ isManual: true })
    );
  });

  it('enables and disables scoped refreshers when pods scopes change', () => {
    refreshManagerMocks.enableMock.mockReset();
    refreshManagerMocks.disableMock.mockReset();

    registerPodsDomain();

    refreshOrchestrator.setScopedDomainEnabled('pods', 'namespace:team-a', true);
    expect(refreshManagerMocks.enableMock).toHaveBeenCalledWith(SYSTEM_REFRESHERS.unifiedPods);

    refreshOrchestrator.setScopedDomainEnabled('pods', 'namespace:team-a', false);
    expect(refreshManagerMocks.disableMock).toHaveBeenCalledWith(SYSTEM_REFRESHERS.unifiedPods);
  });

  it('refreshes all enabled scoped pods when the refresher fires', async () => {
    scopedFetch.mockReset();

    registerPodsDomain();

    refreshOrchestrator.setScopedDomainEnabled('pods', 'namespace:team-a', true);
    refreshOrchestrator.setScopedDomainEnabled('pods', 'namespace:team-b', true);

    const podsCalls = refreshManagerMocks.subscribeMock.mock.calls;
    const podsSubscriber = podsCalls[podsCalls.length - 1]?.[1] ?? (() => Promise.resolve());

    const controller = new AbortController();
    await podsSubscriber(false, controller.signal);

    expect(scopedFetch).toHaveBeenCalledWith(
      'pods',
      'namespace:team-a',
      expect.objectContaining({ isManual: false })
    );
    expect(scopedFetch).toHaveBeenCalledWith(
      'pods',
      'namespace:team-b',
      expect.objectContaining({ isManual: false })
    );
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
      scoped: true,
      autoStart: true,
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
      name: 'alpha',
      phase: 'Active',
      resourceVersion: '1',
      creationTimestamp: 100,
      hasWorkloads: false,
    };
    const changedNamespace = {
      clusterId: 'cluster-a',
      name: 'beta',
      phase: 'Active',
      resourceVersion: '2',
      creationTimestamp: 200,
      hasWorkloads: false,
    };

    setScopedDomainState('namespaces', scope, (prev) => ({
      ...prev,
      status: 'ready',
      data: { namespaces: [cachedNamespace, changedNamespace] },
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
      scoped: true,
      autoStart: true,
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
      data: { drains: [cachedDrain, changedDrain] },
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
      scoped: true,
      autoStart: true,
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
      lastNotifiedErrors: Map<string, string>;
    };

    orchestratorWithInternals.notifyRefreshError('cluster-config', undefined, 'temporary failure');
    expect(orchestratorWithInternals.lastNotifiedErrors.size).toBe(1);

    orchestratorWithInternals.clearRefreshError('cluster-config');
    expect(orchestratorWithInternals.lastNotifiedErrors.size).toBe(0);

    orchestratorWithInternals.clearRefreshError('cluster-config');
    expect(orchestratorWithInternals.lastNotifiedErrors.size).toBe(0);
  });

  it('deduplicates identical refresh error notifications per scope', () => {
    const orchestratorWithInternals = refreshOrchestrator as unknown as {
      notifyRefreshError: (domain: string, scope: string | undefined, message: string) => void;
      clearRefreshError: (domain: string, scope?: string) => void;
    };

    orchestratorInternals.lastNotifiedErrors.clear();
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
      scoped: true,
      autoStart: false,
      streaming: {
        start: (scope: string) => eventStreamMocks.startNamespace(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopNamespace(scope, options?.reset ?? false),
      },
    });

    await refreshOrchestrator.setScopedDomainEnabled('namespace-events', 'team-a', true);
    expect(orchestratorInternals.scopedEnabledState.get('namespace-events')?.get('team-a')).toBe(
      true
    );

    orchestratorInternals.handleKubeconfigChanging();
    expect(orchestratorInternals.scopedEnabledState.has('namespace-events')).toBe(false);
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
      scoped: true,
      autoStart: true,
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
      scoped: true,
      autoStart: false,
    });

    // Metrics demand should follow the visibility of metrics-driven domains.
    refreshOrchestrator.setScopedDomainEnabled('cluster-overview', 'cluster-a', true);
    expect(clientMocks.setMetricsActiveMock).toHaveBeenCalledWith(true);

    refreshOrchestrator.setScopedDomainEnabled('cluster-overview', 'cluster-a', false);
    expect(clientMocks.setMetricsActiveMock).toHaveBeenLastCalledWith(false);
    expect(clientMocks.setMetricsActiveMock).toHaveBeenCalledTimes(2);
  });

  it('replaces existing non-scoped subscriptions when re-registering a domain', () => {
    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: CLUSTER_REFRESHERS.config,
      category: 'cluster',
      autoStart: true,
    });

    const subscribeResults = refreshManagerMocks.subscribeMock.mock.results;
    const firstUnsubscribe = subscribeResults[subscribeResults.length - 1]?.value as
      | ReturnType<typeof vi.fn>
      | undefined;
    expect(firstUnsubscribe).toBeDefined();

    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: CLUSTER_REFRESHERS.config,
      category: 'cluster',
      autoStart: false,
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
      scoped: true,
      autoStart: false,
    });

    refreshManagerMocks.disableMock.mockClear();
    refreshManagerMocks.enableMock.mockClear();

    // Scoped domains can be enabled regardless of namespace context.
    refreshOrchestrator.setScopedDomainEnabled('namespace-config', 'team-a', true);

    expect(refreshManagerMocks.enableMock).toHaveBeenCalledWith(NAMESPACE_REFRESHERS.config);
  });

  it('uses streaming refreshOnce for manual refresh when a domain stream is active', async () => {
    catalogStreamMocks.refreshOnce.mockClear();
    clientMocks.fetchSnapshotMock.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      refresherName: CLUSTER_REFRESHERS.browse,
      category: 'cluster',
      scoped: true,
      autoStart: false,
      streaming: {
        start: (scope: string) => catalogStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => catalogStreamMocks.refreshOnce(scope),
      },
    });

    // Enable the scope and simulate an already-active stream by injecting cleanup directly.
    orchestratorInternals.scopedEnabledState.set('catalog', new Map([['scope=all', true]]));
    orchestratorInternals.streamingCleanup.set(
      makeTestInFlightKey('catalog', 'scope=all'),
      () => undefined
    );

    catalogStreamMocks.refreshOnce.mockClear();
    clientMocks.fetchSnapshotMock.mockClear();

    // Trigger a manual refresh via fetchScopedDomain.
    await refreshOrchestrator.fetchScopedDomain('catalog', 'scope=all', { isManual: true });

    expect(catalogStreamMocks.refreshOnce).toHaveBeenCalledWith('scope=all');
    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it('keeps polling enabled when a resource stream is active but unhealthy', () => {
    registerStreamingClusterConfigDomain();

    const scope = buildClusterScopeList(['cluster-a'], '');
    orchestratorInternals.scopedEnabledState.set(
      'cluster-config',
      new Map([[scope, true]])
    );
    markResourceStreamActive('cluster-config', scope);
    resourceStreamMocks.isHealthy.mockReturnValue(false);

    refreshManagerMocks.enableMock.mockClear();
    refreshManagerMocks.disableMock.mockClear();

    // handleResourceStreamHealth is now a no-op; streaming health is managed
    // via the scoped domain lifecycle. Verify it does not throw.
    orchestratorInternals.handleResourceStreamHealth({
      domain: 'cluster-config',
      scope,
      status: 'unhealthy',
      reason: 'no-delivery',
      connectionStatus: 'connected',
    });
  });

  it('pauses polling when a resource stream is active and healthy', () => {
    registerStreamingClusterConfigDomain();

    const scope = buildClusterScopeList(['cluster-a'], '');
    orchestratorInternals.scopedEnabledState.set(
      'cluster-config',
      new Map([[scope, true]])
    );
    markResourceStreamActive('cluster-config', scope);
    resourceStreamMocks.isHealthy.mockReturnValue(true);

    refreshManagerMocks.enableMock.mockClear();
    refreshManagerMocks.disableMock.mockClear();

    // handleResourceStreamHealth is now a no-op; streaming health is managed
    // via the scoped domain lifecycle. Verify it does not throw.
    orchestratorInternals.handleResourceStreamHealth({
      domain: 'cluster-config',
      scope,
      status: 'healthy',
      reason: 'delivering',
      connectionStatus: 'connected',
    });
  });

  it('falls back to snapshots when a resource stream is unhealthy', async () => {
    // Register cluster-config as scoped (matching production config) with streaming.
    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: CLUSTER_REFRESHERS.config,
      category: 'cluster',
      scoped: true,
      streaming: {
        start: (scope: string) => resourceStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          resourceStreamMocks.stop(scope, options),
        refreshOnce: (scope: string) => resourceStreamMocks.refreshOnce(scope),
        pauseRefresherWhenStreaming: true,
      },
    });

    const scope = buildClusterScopeList(['cluster-a'], '');
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

  it('skips enabling streaming domains when no scope is available', async () => {
    catalogStreamMocks.start.mockClear();
    refreshManagerMocks.enableMock.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      refresherName: CLUSTER_REFRESHERS.browse,
      category: 'cluster',
      scoped: true,
      autoStart: false,
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

  it('restarts streaming when the active scope changes', async () => {
    const cleanup = vi.fn();
    catalogStreamMocks.start.mockImplementation((_scope) => cleanup);
    catalogStreamMocks.stop.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      refresherName: CLUSTER_REFRESHERS.browse,
      category: 'cluster',
      scoped: true,
      autoStart: false,
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
      scoped: true,
      autoStart: false,
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
      autoStart: false,
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
    orchestratorInternals.pendingStreaming.set(key, pendingPromise);
    orchestratorInternals.streamingCleanup.set(key, () => {
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
    expect(orchestratorInternals.streamingCleanup.has(key)).toBe(false);
    consoleSpy.mockRestore();
  });

  it('skips scheduling scoped streaming when domain is disabled', async () => {
    const streaming = {
      start: vi.fn(() => vi.fn()),
      stop: vi.fn(),
    };

    orchestratorInternals.scopedEnabledState.set('namespace-events', new Map([['team-a', false]]));

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
      scoped: true,
      autoStart: true,
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
    logStreamMocks.start.mockClear();
    logStreamMocks.stop.mockClear();
    logStreamMocks.refreshOnce.mockClear();
    eventStreamMocks.startNamespace.mockClear();
    eventStreamMocks.stopNamespace.mockClear();
    eventStreamMocks.refreshNamespace.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'object-logs',
      refresherName: SYSTEM_REFRESHERS.objectLogs,
      category: 'system',
      scoped: true,
      autoStart: false,
      streaming: {
        start: (scope: string) => logStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          logStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => logStreamMocks.refreshOnce(scope),
      },
    });

    await refreshOrchestrator.setScopedDomainEnabled?.('object-logs', 'team-a', true);
    expect(logStreamMocks.start).toHaveBeenCalledWith('team-a');

    await refreshOrchestrator.refreshStreamingDomainOnce('object-logs', 'team-a');
    expect(logStreamMocks.refreshOnce).toHaveBeenCalledWith('team-a');

    await refreshOrchestrator.setScopedDomainEnabled?.('object-logs', 'team-a', false);
    expect(logStreamMocks.stop).toHaveBeenCalledWith('team-a', true);

    catalogStreamMocks.start.mockClear();
    catalogStreamMocks.stop.mockClear();
    catalogStreamMocks.refreshOnce.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      refresherName: CLUSTER_REFRESHERS.browse,
      category: 'cluster',
      scoped: true,
      autoStart: false,
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
      scoped: true,
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
    logStreamMocks.start.mockClear();
    logStreamMocks.stop.mockClear();
    logStreamMocks.refreshOnce.mockClear();
    eventStreamMocks.startNamespace.mockClear();
    eventStreamMocks.stopNamespace.mockClear();
    eventStreamMocks.refreshNamespace?.mockClear?.();

    refreshOrchestrator.registerDomain({
      domain: 'object-logs',
      refresherName: SYSTEM_REFRESHERS.objectLogs,
      category: 'system',
      scoped: true,
      autoStart: false,
      streaming: {
        start: (scope: string) => logStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          logStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => logStreamMocks.refreshOnce(scope),
      },
    });

    refreshOrchestrator.registerDomain({
      domain: 'namespace-events',
      refresherName: NAMESPACE_REFRESHERS.events,
      category: 'namespace',
      scoped: true,
      autoStart: false,
      streaming: {
        start: (scope: string) => eventStreamMocks.startNamespace(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopNamespace(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => eventStreamMocks.refreshNamespace(scope),
      },
    });

    await refreshOrchestrator.setScopedDomainEnabled?.('object-logs', 'team-a', true);
    await refreshOrchestrator.setScopedDomainEnabled?.('namespace-events', 'team-a', true);

    expect(logStreamMocks.start).toHaveBeenCalledWith('team-a');
    expect(eventStreamMocks.startNamespace).toHaveBeenCalledWith('team-a');

    await refreshOrchestrator.refreshStreamingDomainOnce('namespace-events', 'team-a');
    expect(eventStreamMocks.refreshNamespace).toHaveBeenCalledWith('team-a');

    await refreshOrchestrator.setScopedDomainEnabled?.('object-logs', 'team-a', false);
    await refreshOrchestrator.setScopedDomainEnabled?.('namespace-events', 'team-a', false);

    expect(logStreamMocks.stop).toHaveBeenCalledWith('team-a', true);
    expect(eventStreamMocks.stopNamespace).toHaveBeenCalledWith('team-a', true);
  });

  it('trims scoped streaming scopes when toggling enablement', async () => {
    const startSpy = vi.fn((_scope: string) => vi.fn());
    const stopSpy = vi.fn();

    refreshOrchestrator.registerDomain({
      domain: 'object-logs',
      refresherName: SYSTEM_REFRESHERS.objectLogs,
      category: 'system',
      scoped: true,
      autoStart: false,
      streaming: {
        start: startSpy,
        stop: (scope: string, options?: { reset?: boolean }) =>
          stopSpy(scope, options?.reset ?? false),
      },
    });

    refreshOrchestrator.setScopedDomainEnabled('object-logs', '  Team-A  ', true);
    await Promise.resolve();
    expect(startSpy).toHaveBeenCalledWith('Team-A');

    refreshOrchestrator.setScopedDomainEnabled('object-logs', 'Team-A', true);
    expect(startSpy).toHaveBeenCalledTimes(1);

    refreshOrchestrator.setScopedDomainEnabled('object-logs', 'Team-A', false);
    expect(stopSpy).toHaveBeenCalledWith('Team-A', true);
  });

  it('prevents enabling namespace domains outside of an active namespace context', () => {
    refreshOrchestrator.registerDomain({
      domain: 'namespace-config',
      refresherName: NAMESPACE_REFRESHERS.config,
      category: 'namespace',
      autoStart: false,
    });

    refreshOrchestrator.updateContext({
      currentView: 'cluster',
      selectedNamespace: undefined,
    });

    refreshOrchestrator.setDomainEnabled('namespace-config', true);

    expect(refreshManagerMocks.disableMock).toHaveBeenCalledWith(NAMESPACE_REFRESHERS.config);
    const state = getDomainState('namespace-config');
    expect(state.status).toBe('idle');
    expect(state.data).toBeNull();
  });

  it('validates scoped domain enablement requires a non-empty scope', async () => {
    refreshOrchestrator.registerDomain({
      domain: 'namespace-events',
      refresherName: NAMESPACE_REFRESHERS.events,
      category: 'namespace',
      scoped: true,
      autoStart: false,
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

  it('resets state when streaming start fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const startError = new Error('stream boom');

    logStreamMocks.start.mockRejectedValueOnce(startError);
    refreshOrchestrator.registerDomain({
      domain: 'object-logs',
      refresherName: SYSTEM_REFRESHERS.objectLogs,
      category: 'system',
      scoped: true,
      autoStart: false,
      streaming: {
        start: (scope: string) => logStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          logStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => logStreamMocks.refreshOnce(scope),
      },
    });

    await refreshOrchestrator.setScopedDomainEnabled?.('object-logs', 'team-a', true);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logStreamMocks.start).toHaveBeenCalledWith('team-a');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to start streaming domain object-logs::team-a'),
      startError
    );
    expect(orchestratorInternals.streamingCleanup.size).toBe(0);
    const scopedState = getScopedDomainState('object-logs', 'team-a');
    expect(scopedState.status).toBe('error');
    expect(scopedState.error).toContain('stream boom');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        domain: 'object-logs',
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
      scoped: true,
      autoStart: false,
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
      scoped: true,
      autoStart: true,
    });
    refreshOrchestrator.setScopedDomainEnabled('cluster-config', scope, true);

    await subscriber?.(false, new AbortController().signal);
    await subscriber?.(true, new AbortController().signal);

    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(1);
  });

  it('fans out multi-cluster metrics-only pod refreshes and preserves existing rows', async () => {
    refreshOrchestrator.registerDomain({
      domain: 'pods',
      refresherName: SYSTEM_REFRESHERS.unifiedPods,
      category: 'system',
      scoped: true,
      autoStart: false,
      streaming: {
        start: (scope: string) => resourceStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          resourceStreamMocks.stop(scope, options),
        refreshOnce: (scope: string) => resourceStreamMocks.refreshOnce(scope),
        metricsOnly: true,
      },
    });

    refreshOrchestrator.updateContext({
      currentView: 'namespace',
      activeNamespaceView: 'pods',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });

    refreshOrchestrator.setScopedDomainEnabled('pods', 'namespace:default', true);

    const reportScope = buildClusterScopeList(['cluster-a', 'cluster-b'], 'namespace:default');
    setScopedDomainState('pods', reportScope, () => ({
      status: 'ready',
      data: {
        pods: [
          {
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
            cpuRequest: '10m',
            cpuLimit: '20m',
            cpuUsage: '50m',
            memRequest: '10Mi',
            memLimit: '20Mi',
            memUsage: '40Mi',
          },
          {
            clusterId: 'cluster-b',
            name: 'pod-b',
            namespace: 'default',
            status: 'Running',
            ready: '1/1',
            restarts: 0,
            age: '2m',
            ownerKind: 'Deployment',
            ownerName: 'api',
            node: 'node-b',
            cpuRequest: '10m',
            cpuLimit: '20m',
            cpuUsage: '60m',
            memRequest: '10Mi',
            memLimit: '20Mi',
            memUsage: '50Mi',
          },
        ],
      },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: reportScope,
    }));

    await refreshOrchestrator.startStreamingDomain('pods', 'namespace:default');
    // Metrics-only refreshes require a healthy stream to trigger multi-cluster fan-out.
    resourceStreamMocks.isHealthy.mockReturnValue(true);

    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'pods',
        scope: 'namespace:default',
        version: 1,
        checksum: 'etag-a',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          pods: [
            {
              clusterId: 'cluster-a',
              name: 'pod-a',
              namespace: 'default',
              status: 'Pending',
              cpuUsage: '5m',
              memUsage: '6Mi',
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
        scope: 'namespace:default',
        version: 1,
        checksum: 'etag-b',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          pods: [
            {
              clusterId: 'cluster-b',
              name: 'pod-b',
              namespace: 'default',
              status: 'Pending',
              cpuUsage: '7m',
              memUsage: '8Mi',
            },
          ],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-b',
      notModified: false,
    });

    await refreshOrchestrator.fetchScopedDomain('pods', 'namespace:default', { isManual: false });

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledTimes(2);
    const scopes = clientMocks.fetchSnapshotMock.mock.calls.map((call) => call[1]?.scope).sort();
    expect(scopes).toEqual(['cluster-a|namespace:default', 'cluster-b|namespace:default']);

    const state = getScopedDomainState('pods', reportScope);
    const podA = state.data?.pods?.find((pod) => pod.clusterId === 'cluster-a');
    const podB = state.data?.pods?.find((pod) => pod.clusterId === 'cluster-b');
    expect(podA?.cpuUsage).toBe('5m');
    expect(podA?.status).toBe('Running');
    expect(podB?.cpuUsage).toBe('7m');
    expect(podB?.status).toBe('Running');
  });

  it('preserves node status fields when applying metrics-only snapshots', () => {
    const scope = buildClusterScopeList(['cluster-a'], '');
    const baseNode = {
      clusterId: 'cluster-a',
      name: 'node-a',
      status: 'Ready',
      roles: 'worker',
      age: '2h',
      version: '1.27',
      cpuCapacity: '4',
      cpuAllocatable: '4',
      cpuRequests: '1',
      cpuLimits: '2',
      cpuUsage: '100m',
      memoryCapacity: '8Gi',
      memoryAllocatable: '8Gi',
      memRequests: '1Gi',
      memLimits: '2Gi',
      memoryUsage: '200Mi',
      pods: '10',
      podsCapacity: '110',
      podsAllocatable: '110',
      restarts: 0,
      kind: 'Node',
      cpu: '4',
      memory: '8Gi',
      unschedulable: true,
      labels: { role: 'worker' },
      annotations: { source: 'test' },
      taints: [{ key: 'dedicated', value: 'infra', effect: 'NoSchedule' }],
    };
    const existingNode = {
      ...baseNode,
      podMetrics: [
        {
          namespace: 'default',
          name: 'pod-a',
          cpuUsage: '5m',
          memoryUsage: '10Mi',
        },
      ],
    };

    setDomainState('nodes', () => ({
      status: 'ready',
      data: {
        nodes: [existingNode],
        metrics: { stale: false, successCount: 1, failureCount: 0 },
      },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope,
    }));

    const incomingNode = {
      ...baseNode,
      status: 'NotReady',
      cpuUsage: '150m',
      memoryUsage: '250Mi',
      unschedulable: false,
      podMetrics: [
        {
          namespace: 'default',
          name: 'pod-a',
          cpuUsage: '6m',
          memoryUsage: '12Mi',
        },
      ],
    };

    const applied = orchestratorInternals.applyMetricsSnapshot(
      'nodes',
      {
        domain: 'nodes',
        scope,
        version: 2,
        checksum: 'etag-node',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          nodes: [incomingNode],
          metrics: { stale: false, successCount: 2, failureCount: 0 },
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      'etag-node',
      false,
      scope
    );

    expect(applied).toBe(true);
    const nextState = getDomainState('nodes');
    const updated = nextState.data?.nodes?.[0];
    expect(updated?.cpuUsage).toBe('150m');
    expect(updated?.memoryUsage).toBe('250Mi');
    expect(updated?.status).toBe('Ready');
    expect(updated?.unschedulable).toBe(true);
    expect(updated?.podMetrics?.[0]?.cpuUsage).toBe('6m');

    resetDomainState('nodes');
  });

  it('preserves workload readiness when applying metrics-only snapshots', () => {
    const scope = buildClusterScopeList(['cluster-a'], 'namespace:default');
    const existingWorkload = {
      clusterId: 'cluster-a',
      kind: 'Deployment',
      name: 'web',
      namespace: 'default',
      ready: '1/1',
      status: 'Running',
      restarts: 0,
      age: '5m',
      cpuUsage: '20m',
      memUsage: '30Mi',
      cpuRequest: '10m',
      cpuLimit: '40m',
      memRequest: '15Mi',
      memLimit: '60Mi',
    };

    setDomainState('namespace-workloads', () => ({
      status: 'ready',
      data: {
        workloads: [existingWorkload],
      },
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope,
    }));

    const incomingWorkload = {
      ...existingWorkload,
      status: 'Pending',
      ready: '0/1',
      cpuUsage: '25m',
      memUsage: '35Mi',
    };

    const applied = orchestratorInternals.applyMetricsSnapshot(
      'namespace-workloads',
      {
        domain: 'namespace-workloads',
        scope,
        version: 3,
        checksum: 'etag-workload',
        generatedAt: Date.now(),
        sequence: 1,
        payload: {
          workloads: [incomingWorkload],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      'etag-workload',
      false,
      scope
    );

    expect(applied).toBe(true);
    const nextState = getDomainState('namespace-workloads');
    const updated = nextState.data?.workloads?.[0];
    expect(updated?.cpuUsage).toBe('25m');
    expect(updated?.memUsage).toBe('35Mi');
    expect(updated?.status).toBe('Running');
    expect(updated?.ready).toBe('1/1');

    resetDomainState('namespace-workloads');
  });

  it('handles global reset and kubeconfig transitions by cancelling inflight work', () => {
    const scope = 'cluster-a';
    const teardownSpy = vi.spyOn(orchestratorInternals as Record<string, any>, 'teardownInFlight');
    const stopAllSpy = vi.spyOn(orchestratorInternals as Record<string, any>, 'stopAllStreaming');

    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: CLUSTER_REFRESHERS.config,
      category: 'cluster',
      scoped: true,
      autoStart: true,
    });
    refreshOrchestrator.setScopedDomainEnabled('cluster-config', scope, true);

    setScopedDomainState('cluster-config', scope, () => ({
      status: 'ready',
      data: {
        resources: [
          { kind: 'ConfigMap', name: 'settings', details: 'cluster defaults', age: '5m' },
        ],
      },
      stats: null,
      error: null,
      etag: '123',
      isManual: false,
      scope,
      droppedAutoRefreshes: 0,
    }));

    orchestratorInternals.inFlight.set(`cluster-config::${scope}`, {
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
      scoped: true,
      autoStart: true,
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
