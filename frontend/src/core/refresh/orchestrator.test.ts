import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as storeModule from './store';
import type { RefreshContext } from './RefreshManager';
import type { RefreshDomain } from './types';
import {
  getDomainState,
  getRefreshState,
  getScopedDomainState,
  markPendingRequest,
  resetDomainState,
  setDomainState,
} from './store';
import { refreshOrchestrator } from './orchestrator';
import { CLUSTER_REFRESHERS, NAMESPACE_REFRESHERS, SYSTEM_REFRESHERS } from './refresherTypes';

const refreshManagerMocks = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  disableMock: vi.fn(),
  enableMock: vi.fn(),
  registerMock: vi.fn(),
  updateContextMock: vi.fn(),
  triggerManualRefreshMock: vi.fn(),
  triggerManualRefreshForContextMock: vi.fn(),
}));

vi.mock('./RefreshManager', () => ({
  refreshManager: {
    subscribe: refreshManagerMocks.subscribeMock,
    disable: refreshManagerMocks.disableMock,
    enable: refreshManagerMocks.enableMock,
    register: refreshManagerMocks.registerMock,
    updateContext: refreshManagerMocks.updateContextMock,
    triggerManualRefresh: refreshManagerMocks.triggerManualRefreshMock,
    triggerManualRefreshForContext: refreshManagerMocks.triggerManualRefreshForContextMock,
  },
}));

const clientMocks = vi.hoisted(() => ({
  fetchSnapshotMock: vi.fn(),
  ensureRefreshBaseURLMock: vi.fn().mockResolvedValue('http://localhost'),
  invalidateRefreshBaseURLMock: vi.fn(),
}));

vi.mock('./client', () => ({
  fetchSnapshot: clientMocks.fetchSnapshotMock,
  ensureRefreshBaseURL: clientMocks.ensureRefreshBaseURLMock,
  invalidateRefreshBaseURL: clientMocks.invalidateRefreshBaseURLMock,
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
    refreshManagerMocks.triggerManualRefreshMock.mockReset();
    refreshManagerMocks.triggerManualRefreshForContextMock.mockReset();
    clientMocks.fetchSnapshotMock.mockReset();
    clientMocks.ensureRefreshBaseURLMock.mockClear();
    clientMocks.invalidateRefreshBaseURLMock.mockClear();
    errorHandlerMock.handle.mockReset();

    orchestratorInternals.configs?.clear?.();
    orchestratorInternals.unsubscriptions?.clear?.();
    orchestratorInternals.registeredRefreshers?.clear?.();
    orchestratorInternals.scopedDomains?.clear?.();
    orchestratorInternals.domainEnabledState?.clear?.();
    orchestratorInternals.scopedEnabledState?.clear?.();
    orchestratorInternals.domainStreamingScopes?.clear?.();
    orchestratorInternals.streamingCleanup?.clear?.();
    orchestratorInternals.pendingStreaming?.clear?.();
    orchestratorInternals.streamingReady?.clear?.();
    orchestratorInternals.cancelledStreaming?.clear?.();
    orchestratorInternals.inFlight?.clear?.();
    orchestratorInternals.domainScopeOverrides?.clear?.();
    orchestratorInternals.suspendedDomains?.clear?.();
    orchestratorInternals.lastNotifiedErrors?.clear?.();
    orchestratorInternals.contextVersion = 0;
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

  const registerClusterConfigDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: 'cluster-config',
      category: 'cluster',
      autoStart: true,
    });
  };

  const registerNamespacesDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'namespaces',
      refresherName: SYSTEM_REFRESHERS.namespaces,
      category: 'system',
      autoStart: true,
    });
  };

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
    const namespaceSpy = vi
      .spyOn(refreshOrchestrator, 'triggerManualRefresh')
      .mockResolvedValue(undefined as unknown as void);

    registerNamespacesDomain();
    refreshOrchestrator.setDomainEnabled('namespaces', true);

    await refreshOrchestrator.triggerManualRefreshForContext();

    expect(refreshManagerMocks.triggerManualRefreshForContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentView: expect.any(String),
      })
    );
    expect(namespaceSpy).toHaveBeenCalledWith('namespaces');
    namespaceSpy.mockRestore();
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

    registerClusterConfigDomain();

    expect(refreshManagerMocks.registerMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'cluster-config' })
    );
    expect(subscriber).toBeDefined();

    const abortController = new AbortController();
    await subscriber?.(true, abortController.signal);

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'cluster-config',
      expect.objectContaining({ scope: undefined })
    );

    const state = getDomainState('cluster-config');
    expect(state.status).toBe('ready');
    expect(state.data).toEqual(snapshotPayload);
    expect(state.etag).toBe('etag-1');
    expect(state.isManual).toBe(true);
    expect(getRefreshState().pendingRequests).toBe(0);
  });

  it('records errors and surfaces them via the error handler', async () => {
    clientMocks.fetchSnapshotMock.mockRejectedValue(new Error('offline'));

    registerClusterConfigDomain();

    await subscriber?.(true, new AbortController().signal);

    const state = getDomainState('cluster-config');
    expect(state.status).toBe('error');
    expect(state.error).toBe('offline');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'offline' }),
      expect.objectContaining({
        source: 'refresh-orchestrator',
        domain: 'cluster-config',
        scope: 'global',
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
        stop: (_scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopNamespace(options?.reset ?? false),
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

    registerClusterConfigDomain();
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

    const state = getDomainState('cluster-config');
    expect(state.status).toBe('ready');
    expect(state.data).toEqual(payload);
    expect(state.isManual).toBe(false);
    expect(getRefreshState().pendingRequests).toBe(0);
  });

  it('triggers manual refreshes only when domains are enabled and surfaces loading state', async () => {
    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: CLUSTER_REFRESHERS.config,
      category: 'cluster',
      autoStart: false,
    });

    await refreshOrchestrator.triggerManualRefresh('cluster-config');
    expect(refreshManagerMocks.triggerManualRefreshMock).not.toHaveBeenCalled();

    refreshOrchestrator.setDomainEnabled('cluster-config', true);
    await refreshOrchestrator.triggerManualRefresh('cluster-config');

    expect(refreshManagerMocks.triggerManualRefreshMock).toHaveBeenCalledWith(
      CLUSTER_REFRESHERS.config
    );
    const state = getDomainState('cluster-config');
    expect(state.status).toBe('loading');
    expect(state.isManual).toBe(true);
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

  it('manages domain scope overrides with trimmed values', () => {
    refreshOrchestrator.setDomainScope('cluster-config', '  limit=10 ');
    expect(refreshOrchestrator.getDomainScope('cluster-config')).toBe('limit=10');

    refreshOrchestrator.setDomainScope('cluster-config', null);
    expect(refreshOrchestrator.getDomainScope('cluster-config')).toBeUndefined();

    refreshOrchestrator.setDomainScope('cluster-config', 'another');
    expect(refreshOrchestrator.getDomainScope('cluster-config')).toBe('another');

    refreshOrchestrator.clearDomainScope('cluster-config');
    expect(refreshOrchestrator.getDomainScope('cluster-config')).toBeUndefined();
  });

  it('normalizes streaming scopes and preserves cluster events handling', () => {
    const normalize = orchestratorInternals.normalizeStreamingScope as (
      domain: RefreshDomain,
      scope?: string
    ) => string;

    expect(normalize('cluster-events', undefined)).toBe('cluster');
    expect(normalize('catalog', '  limit=25 ')).toBe('limit=25');
    expect(normalize('catalog', '')).toBe('');
  });

  it('updates loading and error state for non-scoped streaming domains', () => {
    const domain = 'catalog';
    orchestratorInternals.setStreamingLoadingState(domain, 'limit=5', { scoped: false });
    let state = getDomainState(domain);
    expect(state.status).toBe('initialising');
    expect(state.scope).toBe('limit=5');
    expect(state.error).toBeNull();

    orchestratorInternals.setStreamingErrorState(domain, 'limit=5', 'boom', { scoped: false });
    state = getDomainState(domain);
    expect(state.status).toBe('error');
    expect(state.error).toBe('boom');
  });

  it('updates loading and error state for scoped streaming domains', () => {
    const domain = 'namespace-events';
    const scope = 'team-a';

    orchestratorInternals.setStreamingLoadingState(domain, scope, { scoped: true });
    let state = getScopedDomainState(domain, scope);
    expect(state.status).toBe('initialising');
    expect(state.scope).toBe(scope);

    orchestratorInternals.setStreamingErrorState(domain, scope, 'failure', { scoped: true });
    state = getScopedDomainState(domain, scope);
    expect(state.status).toBe('error');
    expect(state.error).toBe('failure');
  });

  it('normalizes streaming scopes and preserves cluster events handling', () => {
    const normalize = orchestratorInternals.normalizeStreamingScope as (
      domain: RefreshDomain,
      scope?: string
    ) => string;

    expect(normalize('cluster-events', undefined)).toBe('cluster');
    expect(normalize('catalog', '  limit=25 ')).toBe('limit=25');
    expect(normalize('catalog', '')).toBe('');
  });

  it('prevents enabling namespace domains when namespace context is inactive', async () => {
    const resetSpy = vi.spyOn(storeModule, 'resetDomainState');

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
      autoStart: false,
    });

    refreshManagerMocks.disableMock.mockClear();
    refreshManagerMocks.enableMock.mockClear();
    resetSpy.mockClear();

    refreshOrchestrator.setDomainEnabled('namespace-config', true);

    expect(refreshManagerMocks.enableMock).not.toHaveBeenCalled();
    expect(refreshManagerMocks.disableMock).toHaveBeenCalledWith(NAMESPACE_REFRESHERS.config);
    expect(resetSpy).toHaveBeenCalledWith('namespace-config');

    resetSpy.mockRestore();
  });

  it('uses streaming refreshOnce for manual refresh when a domain stream is active', async () => {
    catalogStreamMocks.start.mockImplementation(() => undefined);
    catalogStreamMocks.refreshOnce.mockClear();
    clientMocks.fetchSnapshotMock.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      refresherName: CLUSTER_REFRESHERS.browse,
      category: 'cluster',
      autoStart: false,
      scopeResolver: () => 'scope=all',
      streaming: {
        start: (scope: string) => catalogStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => catalogStreamMocks.refreshOnce(scope),
      },
    });

    const subscribeCalls = refreshManagerMocks.subscribeMock.mock.calls;
    const manualCallback = subscribeCalls[subscribeCalls.length - 1]?.[1];

    await refreshOrchestrator.setDomainEnabled('catalog', true);
    await Promise.resolve();
    catalogStreamMocks.refreshOnce.mockClear();
    clientMocks.fetchSnapshotMock.mockClear();

    await manualCallback?.([], true, new AbortController().signal);

    expect(catalogStreamMocks.refreshOnce).toHaveBeenCalledWith('scope=all');
    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it('skips enabling streaming domains when no scope is available', async () => {
    catalogStreamMocks.start.mockClear();
    refreshManagerMocks.enableMock.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      refresherName: CLUSTER_REFRESHERS.browse,
      category: 'cluster',
      autoStart: false,
      scopeResolver: () => '',
      streaming: {
        start: (scope: string) => catalogStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => catalogStreamMocks.refreshOnce(scope),
      },
    });

    await refreshOrchestrator.setDomainEnabled('catalog', true);

    expect(catalogStreamMocks.start).not.toHaveBeenCalled();
    expect(refreshManagerMocks.enableMock).not.toHaveBeenCalledWith(CLUSTER_REFRESHERS.browse);
    expect(orchestratorInternals.domainEnabledState.get('catalog')).not.toBe(true);
  });

  it('restarts streaming when scope resolver output changes', async () => {
    const cleanup = vi.fn();
    catalogStreamMocks.start.mockImplementation((_scope) => cleanup);
    catalogStreamMocks.stop.mockClear();

    refreshOrchestrator.updateContext({
      currentView: 'namespace',
      selectedNamespace: 'team-a',
      objectPanel: { isOpen: false },
    });

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      refresherName: CLUSTER_REFRESHERS.browse,
      category: 'cluster',
      autoStart: false,
      scopeResolver: () => {
        const ctx = orchestratorInternals.context as RefreshContext;
        return ctx.selectedNamespace ? `scope=${ctx.selectedNamespace}` : '';
      },
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

    await refreshOrchestrator.setDomainEnabled('catalog', true);
    await Promise.resolve();
    expect(catalogStreamMocks.start).toHaveBeenCalledWith('scope=team-a');

    catalogStreamMocks.start.mockClear();
    catalogStreamMocks.stop.mockClear();
    cleanup.mockClear();

    refreshOrchestrator.updateContext({ selectedNamespace: 'team-b' });
    await Promise.resolve();

    expect(catalogStreamMocks.stop).toHaveBeenCalledWith('scope=team-a', true);
    expect(cleanup).toHaveBeenCalled();
    expect(catalogStreamMocks.start).toHaveBeenCalledWith('scope=team-b');
  });

  it('stops streaming when scope resolver no longer provides a value', async () => {
    const cleanup = vi.fn();
    catalogStreamMocks.start.mockClear();
    catalogStreamMocks.stop.mockClear();

    refreshOrchestrator.updateContext({
      currentView: 'namespace',
      selectedNamespace: 'team-a',
      objectPanel: { isOpen: false },
    });

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      refresherName: CLUSTER_REFRESHERS.browse,
      category: 'cluster',
      autoStart: false,
      scopeResolver: () => {
        const ctx = orchestratorInternals.context as RefreshContext;
        return ctx.selectedNamespace ? `scope=${ctx.selectedNamespace}` : '';
      },
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

    await refreshOrchestrator.setDomainEnabled('catalog', true);
    await Promise.resolve();
    expect(catalogStreamMocks.start).toHaveBeenCalledWith('scope=team-a');

    cleanup.mockClear();
    catalogStreamMocks.start.mockClear();
    catalogStreamMocks.stop.mockClear();

    refreshOrchestrator.updateContext({ selectedNamespace: undefined });
    await Promise.resolve();

    expect(catalogStreamMocks.stop).toHaveBeenCalledWith('scope=team-a', true);
    expect(cleanup).toHaveBeenCalled();
    expect(orchestratorInternals.domainStreamingScopes.get('catalog')).toBeUndefined();
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

    orchestratorInternals.scopedDomains.add('namespace-events');
    orchestratorInternals.scopedEnabledState.set('namespace-events', new Map([['team-a', false]]));

    await orchestratorInternals.scheduleStreamingStart('namespace-events', 'team-a', streaming, {
      scoped: true,
    });

    expect(streaming.start).not.toHaveBeenCalled();
  });

  it('suppresses catalog hydration errors from bubbling to user error handler', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    clientMocks.fetchSnapshotMock.mockRejectedValue(
      new Error('Catalog hydration incomplete - retry')
    );

    registerClusterConfigDomain();
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
      autoStart: false,
      scopeResolver: () => 'limit=1000',
      streaming: {
        start: (scope: string) => catalogStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => catalogStreamMocks.refreshOnce(scope),
      },
    });

    await refreshOrchestrator.setDomainEnabled?.('catalog', true);
    expect(catalogStreamMocks.start).toHaveBeenCalledWith('limit=1000');

    await refreshOrchestrator.refreshStreamingDomainOnce('catalog', 'limit=1000');
    expect(catalogStreamMocks.refreshOnce).toHaveBeenCalledWith('limit=1000');

    await refreshOrchestrator.setDomainEnabled?.('catalog', false);
    expect(catalogStreamMocks.stop).toHaveBeenCalledWith('limit=1000', true);

    eventStreamMocks.startCluster.mockClear();
    eventStreamMocks.stopCluster.mockClear();
    eventStreamMocks.refreshCluster.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'cluster-events',
      refresherName: CLUSTER_REFRESHERS.events,
      category: 'cluster',
      autoStart: false,
      streaming: {
        start: () => eventStreamMocks.startCluster(),
        stop: (_scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopCluster(options?.reset ?? false),
        refreshOnce: () => eventStreamMocks.refreshCluster(),
      },
    });

    await refreshOrchestrator.setDomainEnabled?.('cluster-events', true);
    expect(eventStreamMocks.startCluster).toHaveBeenCalled();

    await refreshOrchestrator.refreshStreamingDomainOnce('cluster-events', 'cluster');
    expect(eventStreamMocks.refreshCluster).toHaveBeenCalled();

    await refreshOrchestrator.setDomainEnabled?.('cluster-events', false);
    expect(eventStreamMocks.stopCluster).toHaveBeenCalledWith(true);
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
        stop: (_scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopNamespace(options?.reset ?? false),
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
    expect(eventStreamMocks.stopNamespace).toHaveBeenCalledWith(true);
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
        stop: (_scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopNamespace(options?.reset ?? false),
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
      autoStart: false,
      streaming: {
        start: (scope: string) => catalogStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => catalogStreamMocks.refreshOnce(scope),
      },
      scopeResolver: () => 'limit=100',
    });

    refreshOrchestrator.setDomainEnabled('catalog', true);
    await Promise.resolve();
    await Promise.resolve();

    const state = getDomainState('catalog');
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
    clientMocks.fetchSnapshotMock.mockRejectedValue(new Error('backend unavailable'));

    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: CLUSTER_REFRESHERS.config,
      category: 'cluster',
      autoStart: true,
    });

    await subscriber?.(false, new AbortController().signal);
    await subscriber?.(true, new AbortController().signal);

    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(1);
  });

  it('handles global reset and kubeconfig transitions by cancelling inflight work', () => {
    const teardownSpy = vi.spyOn(orchestratorInternals as Record<string, any>, 'teardownInFlight');
    const stopAllSpy = vi.spyOn(orchestratorInternals as Record<string, any>, 'stopAllStreaming');

    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      refresherName: CLUSTER_REFRESHERS.config,
      category: 'cluster',
      autoStart: true,
    });

    setDomainState('cluster-config', () => ({
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
      scope: undefined,
      droppedAutoRefreshes: 0,
    }));

    orchestratorInternals.domainScopeOverrides.set('cluster-config', 'limit=5');
    orchestratorInternals.inFlight.set('cluster-config::*', {
      controller: new AbortController(),
      isManual: false,
      requestId: 1,
      contextVersion: 0,
      domain: 'cluster-config',
    });

    orchestratorInternals.handleResetViews();

    expect(stopAllSpy).toHaveBeenCalledWith(true);
    expect(teardownSpy).toHaveBeenCalled();
    expect(orchestratorInternals.domainScopeOverrides.size).toBe(0);
    expect(getDomainState('cluster-config').data).toBeNull();

    orchestratorInternals.handleKubeconfigChanging();
    expect(clientMocks.invalidateRefreshBaseURLMock).toHaveBeenCalled();
    expect(orchestratorInternals.suspendedDomains.get('cluster-config')).toBe(true);

    orchestratorInternals.handleKubeconfigChanged();
    expect(orchestratorInternals.suspendedDomains.size).toBe(0);

    stopAllSpy.mockRestore();
    teardownSpy.mockRestore();
  });
});
