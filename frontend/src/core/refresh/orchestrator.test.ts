/**
 * frontend/src/core/refresh/orchestrator.test.ts
 *
 * Test suite for orchestrator.
 * Covers key behaviors and edge cases for orchestrator.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clusterWorkspaceStore } from '@/core/cluster-workspace/clusterWorkspaceStore';
import { requestRefreshDomainState } from '@/core/data-access/dataAccess';
import { eventBus } from '@/core/events';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
  setAutoRefreshEnabled,
} from '@/core/settings/appPreferences';
import { errorWithStatus, makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { testScope } from '@/test-utils/refreshScope';
import { requireValue } from '@/test-utils/requireValue';
import { clusterReadiness } from './clusterReadiness';
import { getRefreshDomainDescriptor, refreshDomainContract } from './domainRegistry';
import { refreshOrchestrator } from './orchestrator';
import {
  makeCatalogSnapshotPayload,
  makeClusterConfigSnapshotPayload,
  makeClusterEventsSnapshotPayload,
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from './refreshContractTestBuilders';
import { failureMessage, isPermissionDenied } from './refreshFailure';
import type { DomainRegistration } from './refreshRegistration';
import {
  getRefreshState,
  getScopedDomainState,
  markPendingRequest,
  resetAllScopedDomainStates,
  setScopedDomainState,
} from './store';
import { REFRESH_DOMAINS, type RefreshDomain } from './types';

const SNAPSHOT_REFRESH_DOMAINS = REFRESH_DOMAINS.filter(
  (domain): domain is Exclude<RefreshDomain, 'container-logs'> => domain !== 'container-logs'
);

type TestClusterRefreshRuntime = {
  acquireScopedLease: (domain: RefreshDomain, scope: string) => unknown;
  getLeasedScopes: () => Array<{ domain: RefreshDomain; scope: string }>;
  disableScopedDomain: (domain: RefreshDomain, scope: string) => unknown;
  getKnownScopes: (domain: RefreshDomain) => string[];
  isScopedDomainEnabled: (domain: RefreshDomain, scope: string) => boolean;
  getDeferredReadinessRequests: () => Array<{ isManual: boolean; streamSignal: boolean }>;
  setInFlight: (request: {
    controller: AbortController;
    isManual: boolean;
    requestId: number;
    contextVersion: number;
    domain: RefreshDomain;
    scope: string;
  }) => string;
  getInFlight: (domain: RefreshDomain, scope: string) => unknown;
  resetAllState: () => void;
  beginStreamingStart: (
    domain: RefreshDomain,
    scope: string,
    task: Promise<(() => void) | undefined>
  ) => void;
  finishStreamingStart: (
    domain: RefreshDomain,
    scope: string,
    task: Promise<(() => void) | undefined>,
    cleanup: (() => void) | undefined
  ) => boolean;
  cancelStreamingStart: (domain: RefreshDomain, scope: string) => unknown;
  setStreamingReady: (domain: RefreshDomain, scope: string, task: Promise<void>) => void;
  hasStreamingReady: (domain: RefreshDomain, scope: string) => boolean;
  hasPendingStreaming: (domain: RefreshDomain, scope: string) => boolean;
  isStreamingCancelled: (domain: RefreshDomain, scope: string) => boolean;
  isStreamingActive: (domain: RefreshDomain, scope: string) => boolean;
  getStreamingCleanup: (domain: RefreshDomain, scope: string) => (() => void) | undefined;
  getStreamHealth: (domain: RefreshDomain, scope: string) => { status: string } | undefined;
  isStreamingBlocked: (domain: RefreshDomain, scope: string) => boolean;
};

type RefreshOrchestratorInternals = {
  configs: Map<RefreshDomain, DomainRegistration<RefreshDomain>>;
  unsubscriptions: Map<RefreshDomain, () => void>;
  registeredRefreshers: Set<string>;
  coordinatorRuntime: TestClusterRefreshRuntime;
  clusterRuntimes: Map<string, TestClusterRefreshRuntime>;
  lastNotifiedErrors: Map<string, unknown>;
  contextVersion: number;
  metricsDemandState:
    | { status: 'idle'; appliedKey: string; retryDelayMs: number }
    | {
        status: 'requesting';
        appliedKey: string;
        requestKey: string;
        retryDelayMs: number;
      }
    | {
        status: 'waiting-retry';
        appliedKey: string;
        retryKey: string;
        retryTimer: ReturnType<typeof setTimeout>;
        retryDelayMs: number;
      };
  getRuntimeForScope: (scope: string) => TestClusterRefreshRuntime;
  notifyRefreshError: (
    domain: RefreshDomain,
    scope: string | undefined,
    message: string,
    error?: unknown
  ) => void;
  isScopedDomainEnabledInternal: (domain: RefreshDomain, scope: string) => boolean;
  handleKubeconfigChanging: (...args: unknown[]) => void;
  handleKubeconfigChanged: (...args: unknown[]) => void;
  handleResourceStreamHealth: (...args: unknown[]) => void;
  handleResourceStreamDrift: (...args: unknown[]) => void;
  handleClusterAuthFailed: (...args: unknown[]) => void;
  handleClusterAuthRecovered: (...args: unknown[]) => void;
  handleResetViews: (...args: unknown[]) => void;
  stopStreamingScope: (...args: unknown[]) => void;
  scheduleStreamingStart: (...args: unknown[]) => void;
  shouldStreamScope: (...args: unknown[]) => boolean;
  teardownInFlight: (...args: unknown[]) => void;
  stopAllStreaming: (reset: boolean) => void;
};

const clientMocks = vi.hoisted(() => ({
  fetchSnapshotMock: vi.fn(),
  setMetricsActiveMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./client', () => ({
  fetchSnapshot: clientMocks.fetchSnapshotMock,
  setMetricsActive: clientMocks.setMetricsActiveMock,
}));

const containerLogsStreamMocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
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
  recordStreamFallback: vi.fn(),
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
  reportOperationalError: vi.fn(),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
  reportOperationalError: errorHandlerMock.reportOperationalError,
}));

const orchestratorInternals = refreshOrchestrator as unknown as RefreshOrchestratorInternals;

// A canonical scope for any domain: its first authored scope-contract example.
const exampleScopeFor = (domain: RefreshDomain, clusterId: string): string =>
  testScope(clusterId, refreshDomainContract.domainInventory[domain].scopeContract.valid[0]);

describe('refreshOrchestrator', () => {
  // One scheduler tick for every leased scope of a domain: the read each
  // scope's poll makes (or the user's, for a manual tick).
  const pollLeasedScopes = async (domain: RefreshDomain, manual = false, signal?: AbortSignal) => {
    const runtimes = [
      orchestratorInternals.coordinatorRuntime,
      ...orchestratorInternals.clusterRuntimes.values(),
    ];
    const scopes = runtimes.flatMap((runtime) =>
      runtime
        .getLeasedScopes()
        .filter((entry) => entry.domain === domain)
        .map((entry) => entry.scope)
    );
    await Promise.all(
      scopes.map((scope) =>
        refreshOrchestrator.fetchScopedDomain(domain, scope, {
          intent: manual ? 'user' : 'background',
          queryReconcile: true,
          signal,
        })
      )
    );
  };
  const scopedFetch = vi.spyOn(refreshOrchestrator, 'fetchScopedDomain');

  beforeEach(() => {
    clusterReadiness.resetForTests();
    resetAppPreferencesCacheForTesting();
    setAppPreferencesForTesting({ autoRefreshEnabled: true });
    resourceStreamMocks.start.mockReset();
    resourceStreamMocks.stop.mockReset();
    resourceStreamMocks.refreshOnce.mockReset();
    resourceStreamMocks.isHealthy.mockReset();
    resourceStreamMocks.isHealthy.mockReturnValue(false);
    resourceStreamMocks.recordStreamFallback.mockReset();
    catalogStreamMocks.start.mockReset();
    catalogStreamMocks.stop.mockReset();
    catalogStreamMocks.refreshOnce.mockReset();
    catalogStreamMocks.isHealthy.mockReset();
    catalogStreamMocks.isHealthy.mockReturnValue(false);
    clientMocks.fetchSnapshotMock.mockReset();
    clientMocks.setMetricsActiveMock.mockClear();
    errorHandlerMock.handle.mockReset();
    errorHandlerMock.reportOperationalError.mockReset();

    orchestratorInternals.configs?.clear?.();
    orchestratorInternals.unsubscriptions?.clear?.();
    orchestratorInternals.registeredRefreshers?.clear?.();
    orchestratorInternals.coordinatorRuntime?.resetAllState?.();
    orchestratorInternals.clusterRuntimes?.clear?.();
    orchestratorInternals.lastNotifiedErrors?.clear?.();
    orchestratorInternals.contextVersion = 0;
    if (orchestratorInternals.metricsDemandState.status === 'waiting-retry') {
      clearTimeout(orchestratorInternals.metricsDemandState.retryTimer);
    }
    orchestratorInternals.metricsDemandState = {
      status: 'idle',
      appliedKey: '',
      retryDelayMs: 1_000,
    };

    resetAllScopedDomainStates('cluster-config');
    const { pendingRequests } = getRefreshState();
    if (pendingRequests !== 0) {
      markPendingRequest(-pendingRequests);
    }
    // Normal refresh scenarios start with published cluster services. Readiness
    // transition cases reset this state and explicitly deliver their own edges.
    for (const clusterId of ['cluster-a', 'cluster-b', 'test-cluster']) {
      eventBus.emit('cluster:lifecycle', { clusterId, state: 'ready' });
    }
  });

  afterEach(() => {
    scopedFetch.mockReset();
  });

  const registerStreamingClusterConfigDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      category: 'cluster',

      streaming: {
        start: (streamScope: string) => resourceStreamMocks.start(streamScope),
        stop: (streamScope: string, options?: { reset?: boolean }) =>
          resourceStreamMocks.stop(streamScope, options),
        refreshOnce: (streamScope: string) => resourceStreamMocks.refreshOnce(streamScope),
      },
    });
  };

  const registerAllSnapshotDomains = () => {
    SNAPSHOT_REFRESH_DOMAINS.forEach((domain) => {
      const descriptor = getRefreshDomainDescriptor(domain);
      refreshOrchestrator.registerDomain({
        domain,
        category: descriptor.category,
      });
    });
  };

  const markResourceStreamActive = (domain: RefreshDomain, scope: string) => {
    // Simulate an active resource stream so polling gating is deterministic in tests.
    const runtime = orchestratorInternals.getRuntimeForScope(scope);
    const cleanup = () => undefined;
    const startTask = Promise.resolve(cleanup);
    runtime.beginStreamingStart(domain, scope, startTask);
    runtime.finishStreamingStart(domain, scope, startTask, cleanup);
  };

  const leaseRuntimeScope = (domain: RefreshDomain, scope: string) => {
    orchestratorInternals.getRuntimeForScope(scope).acquireScopedLease(domain, scope);
  };

  const registerObjectMaintenanceDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'object-maintenance',
      category: 'system',
    });
  };

  const registerCatalogDiffDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'catalog-diff',
      category: 'cluster',
    });
  };

  const registerCatalogDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      category: 'cluster',

      streaming: {
        start: (catalogScope: string) => catalogStreamMocks.start(catalogScope),
        stop: (catalogScope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(catalogScope, options?.reset ?? false),
        refreshOnce: (catalogScope: string) => catalogStreamMocks.refreshOnce(catalogScope),
      },
    });
  };

  const registerPodsDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'pods',
      category: 'system',
    });
  };

  const registerStreamingPodsDomain = () => {
    refreshOrchestrator.registerDomain({
      domain: 'pods',
      category: 'system',
      streaming: {
        start: (streamScope: string) => resourceStreamMocks.start(streamScope),
        stop: (streamScope: string, options?: { reset?: boolean }) =>
          resourceStreamMocks.stop(streamScope, options),
        refreshOnce: (streamScope: string) => resourceStreamMocks.refreshOnce(streamScope),
      },
    });
  };

  it('holds scoped fetches for an initializing cluster and dispatches once it becomes serviceable', async () => {
    clusterReadiness.resetForTests();
    registerStreamingClusterConfigDomain();
    const scope = testScope('cluster-init', '');
    resetAllScopedDomainStates('cluster-config');
    leaseRuntimeScope('cluster-config', scope);
    clientMocks.fetchSnapshotMock.mockClear();
    errorHandlerMock.handle.mockClear();

    // The backend registers this cluster's services only at the 'loading'
    // transition; until then every request would 500 with "no active
    // clusters available".
    eventBus.emit('cluster:lifecycle', {
      clusterId: 'cluster-init',
      state: 'connecting',
    });

    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { intent: 'startup' });
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
    });

    await vi.waitFor(() => {
      expect(clientMocks.fetchSnapshotMock).toHaveBeenCalled();
    });

    clusterReadiness.resetForTests();
    resetAllScopedDomainStates('cluster-config');
  });

  it('holds a catalog refresh while foreground activation re-establishes a cooled cluster', async () => {
    clusterReadiness.resetForTests();
    registerCatalogDomain();
    const scope = testScope('cluster-cold', '');
    resetAllScopedDomainStates('catalog');
    leaseRuntimeScope('catalog', scope);
    eventBus.emit('cluster:lifecycle', { clusterId: 'cluster-cold', state: 'ready' });
    clusterReadiness.beginForegroundActivation('cluster-cold');
    clientMocks.fetchSnapshotMock.mockClear();

    await refreshOrchestrator.fetchScopedDomain('catalog', scope, { intent: 'startup' });

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();

    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'catalog',
        scope,
        version: 1,
        checksum: 'etag-catalog',
        generatedAt: Date.now(),
        sequence: 1,
        payload: makeCatalogSnapshotPayload({ clusterId: 'cluster-cold' }),
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      etag: 'etag-catalog',
      notModified: false,
    });

    clusterReadiness.endForegroundActivation('cluster-cold');

    await vi.waitFor(() => {
      expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledTimes(1);
    });

    clusterReadiness.resetForTests();
    resetAllScopedDomainStates('catalog');
  });

  it('holds every snapshot domain at the shared foreground activation gate', async () => {
    registerAllSnapshotDomains();
    const clusterId = 'cluster-cold';
    eventBus.emit('cluster:lifecycle', { clusterId, state: 'ready' });
    clusterReadiness.beginForegroundActivation(clusterId);
    clientMocks.fetchSnapshotMock.mockClear();
    SNAPSHOT_REFRESH_DOMAINS.forEach((domain) => {
      leaseRuntimeScope(domain, exampleScopeFor(domain, clusterId));
    });

    await Promise.all(
      SNAPSHOT_REFRESH_DOMAINS.map((domain) =>
        refreshOrchestrator.fetchScopedDomain(domain, exampleScopeFor(domain, clusterId), {
          intent: 'startup',
        })
      )
    );

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();

    clientMocks.fetchSnapshotMock.mockResolvedValue({
      snapshot: null,
      etag: undefined,
      notModified: true,
    });
    clusterReadiness.endForegroundActivation(clusterId);

    await vi.waitFor(() => {
      expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledTimes(SNAPSHOT_REFRESH_DOMAINS.length);
    });
  });

  it('does not turn a leased background poll into queued demand at the activation gate', async () => {
    registerAllSnapshotDomains();
    const clusterId = 'cluster-cold';
    eventBus.emit('cluster:lifecycle', { clusterId, state: 'ready' });
    clusterReadiness.beginForegroundActivation(clusterId);
    clientMocks.fetchSnapshotMock.mockClear();
    clientMocks.fetchSnapshotMock.mockResolvedValue({
      snapshot: null,
      etag: undefined,
      notModified: true,
    });
    SNAPSHOT_REFRESH_DOMAINS.forEach((domain) => {
      leaseRuntimeScope(domain, exampleScopeFor(domain, clusterId));
    });

    await Promise.all(
      SNAPSHOT_REFRESH_DOMAINS.map((domain) =>
        refreshOrchestrator.fetchScopedDomain(domain, exampleScopeFor(domain, clusterId), {
          intent: 'background',
        })
      )
    );
    clusterReadiness.endForegroundActivation(clusterId);
    // Let any replay the gate queued dispatch before asserting none did.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it('preserves manual intent while a refresh waits for foreground activation', async () => {
    registerCatalogDomain();
    const clusterId = 'cluster-cold';
    const scope = testScope(clusterId, '');
    leaseRuntimeScope('catalog', scope);
    eventBus.emit('cluster:lifecycle', { clusterId, state: 'ready' });
    clusterReadiness.beginForegroundActivation(clusterId);
    clientMocks.fetchSnapshotMock.mockResolvedValue({
      snapshot: null,
      etag: undefined,
      notModified: true,
    });

    await refreshOrchestrator.fetchScopedDomain('catalog', scope, { intent: 'user' });
    clusterReadiness.endForegroundActivation(clusterId);

    await vi.waitFor(() => {
      expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
        'catalog',
        expect.objectContaining({ scope, manual: true })
      );
    });
  });

  it('stops an in-flight snapshot when its cluster enters foreground activation', async () => {
    registerStreamingClusterConfigDomain();
    const clusterId = 'cluster-cold';
    const scope = testScope(clusterId, '');
    leaseRuntimeScope('cluster-config', scope);
    eventBus.emit('cluster:lifecycle', { clusterId, state: 'ready' });
    let requestSignal: AbortSignal | undefined;
    clientMocks.fetchSnapshotMock.mockImplementation(
      (_domain: RefreshDomain, options: { signal?: AbortSignal }) => {
        requestSignal = options.signal;
        return new Promise(() => undefined);
      }
    );

    void refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { intent: 'startup' });
    await vi.waitFor(() => expect(requestSignal).toBeDefined());

    clusterReadiness.beginForegroundActivation(clusterId);

    expect(requestSignal?.aborted).toBe(true);
  });

  it('discards a late catalog failure after cluster close and leaves the other cluster usable', async () => {
    registerCatalogDomain();
    const clusterId = 'closing';
    const scope = testScope(clusterId, 'limit=1');
    leaseRuntimeScope('catalog', scope);
    eventBus.emit('cluster:lifecycle', { clusterId, state: 'ready' });
    eventBus.emit('cluster:lifecycle', { clusterId: 'retained', state: 'ready' });
    let rejectSnapshot!: (error: Error) => void;
    let requestSignal: AbortSignal | undefined;
    clientMocks.fetchSnapshotMock.mockImplementation((_domain, options) => {
      requestSignal = options.signal;
      return new Promise((_resolve, reject) => {
        rejectSnapshot = reject;
      });
    });
    const request = refreshOrchestrator.fetchScopedDomain('catalog', scope, { intent: 'startup' });
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    const resume = clusterWorkspaceStore.holdClusterRequests(clusterId);
    expect(requestSignal?.aborted).toBe(true);
    expect(clusterReadiness.isServiceable('retained')).toBe(true);
    refreshOrchestrator.setConnectedClusters(['retained']);
    rejectSnapshot(new Error('object catalog service unavailable'));
    await request;
    resume();
    expect(errorHandlerMock.handle).not.toHaveBeenCalled();
    expect(getScopedDomainState('catalog', scope)?.status).not.toBe('error');
  });

  it("stops only the activating cluster's in-flight snapshots", async () => {
    registerStreamingClusterConfigDomain();
    const scopeA = testScope('cluster-a', '');
    const scopeB = testScope('cluster-b', '');
    leaseRuntimeScope('cluster-config', scopeA);
    leaseRuntimeScope('cluster-config', scopeB);
    eventBus.emit('cluster:lifecycle', { clusterId: 'cluster-a', state: 'ready' });
    eventBus.emit('cluster:lifecycle', { clusterId: 'cluster-b', state: 'ready' });
    const signals = new Map<string, AbortSignal>();
    clientMocks.fetchSnapshotMock.mockImplementation(
      (_domain: RefreshDomain, options: { scope: string; signal: AbortSignal }) => {
        signals.set(options.scope, options.signal);
        return new Promise(() => undefined);
      }
    );

    void refreshOrchestrator.fetchScopedDomain('cluster-config', scopeA, { intent: 'startup' });
    void refreshOrchestrator.fetchScopedDomain('cluster-config', scopeB, { intent: 'startup' });
    await vi.waitFor(() => expect(signals.size).toBe(2));

    clusterReadiness.beginForegroundActivation('cluster-a');

    expect(signals.get(scopeA)?.aborted).toBe(true);
    expect(signals.get(scopeB)?.aborted).toBe(false);
  });

  it('preserves an in-flight stream signal across foreground activation', async () => {
    registerStreamingClusterConfigDomain();
    const clusterId = 'cluster-cold';
    const scope = testScope(clusterId, '');
    leaseRuntimeScope('cluster-config', scope);
    setScopedDomainState('cluster-config', scope, (previous) => ({
      ...previous,
      status: 'ready',
      data: {} as never,
    }));
    eventBus.emit('cluster:lifecycle', { clusterId, state: 'ready' });
    markResourceStreamActive('cluster-config', scope);
    resourceStreamMocks.isHealthy.mockReturnValue(true);
    clientMocks.fetchSnapshotMock
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce({ snapshot: null, etag: undefined, notModified: true });

    void refreshOrchestrator.fetchScopedDomain('cluster-config', scope, {
      intent: 'stream-signal',
    });
    await vi.waitFor(() => expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledTimes(1));

    clusterReadiness.beginForegroundActivation(clusterId);
    expect(
      orchestratorInternals.clusterRuntimes.get(clusterId)?.getDeferredReadinessRequests()
    ).toEqual([expect.objectContaining({ intents: ['stream-signal'] })]);
    clusterReadiness.endForegroundActivation(clusterId);

    await vi.waitFor(() => expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledTimes(2));
  });

  // Closing an object panel resets its scopes after its Logs tab stopped with
  // its lines kept for a remount; the stream owner must drop them too, or a
  // reopened panel shows the old lines.
  it('resets the stream owner when a scope nobody streams is reset', () => {
    const scope = testScope('cluster-a', 'default:/v1:Pod:web');
    refreshOrchestrator.registerDomain({
      domain: 'container-logs',
      category: 'system',
      streaming: {
        snapshotless: true,
        start: (streamScope) => containerLogsStreamMocks.start(streamScope),
        stop: (streamScope, options) => containerLogsStreamMocks.stop(streamScope, options),
      },
    });
    refreshOrchestrator.acquireScopedDomainLease('container-logs', scope, {
      preserveState: true,
    });
    refreshOrchestrator.releaseScopedDomainLease('container-logs', scope, {
      preserveState: true,
    });
    containerLogsStreamMocks.stop.mockClear();

    refreshOrchestrator.resetScopedDomain('container-logs', scope);

    expect(containerLogsStreamMocks.stop).toHaveBeenCalledWith(scope, { reset: true });
  });

  it('leaves a streamed scope running when its state is reset', () => {
    const scope = testScope('cluster-a', 'default:/v1:Pod:api');
    refreshOrchestrator.registerDomain({
      domain: 'container-logs',
      category: 'system',
      streaming: {
        snapshotless: true,
        start: (streamScope) => containerLogsStreamMocks.start(streamScope),
        stop: (streamScope, options) => containerLogsStreamMocks.stop(streamScope, options),
      },
    });
    refreshOrchestrator.acquireScopedDomainLease('container-logs', scope, {
      preserveState: true,
    });
    containerLogsStreamMocks.stop.mockClear();

    refreshOrchestrator.resetScopedDomain('container-logs', scope);

    expect(containerLogsStreamMocks.stop).not.toHaveBeenCalled();
    refreshOrchestrator.releaseScopedDomainLease('container-logs', scope, {
      preserveState: true,
    });
  });

  it('holds the stream-only domain during activation and starts it on release', async () => {
    const clusterId = 'cluster-cold';
    const scope = testScope(clusterId, 'default:/v1:Pod:web');
    eventBus.emit('cluster:lifecycle', { clusterId, state: 'ready' });
    clusterReadiness.beginForegroundActivation(clusterId);
    containerLogsStreamMocks.start.mockResolvedValue(undefined);
    refreshOrchestrator.registerDomain({
      domain: 'container-logs',
      category: 'system',
      streaming: {
        snapshotless: true,
        start: (streamScope) => containerLogsStreamMocks.start(streamScope),
        stop: (streamScope) => containerLogsStreamMocks.stop(streamScope),
      },
    });
    refreshOrchestrator.acquireScopedDomainLease('container-logs', scope, {
      preserveState: true,
    });

    await refreshOrchestrator.restartStreamingDomain('container-logs', scope);

    expect(containerLogsStreamMocks.start).not.toHaveBeenCalled();

    clusterReadiness.endForegroundActivation(clusterId);

    await vi.waitFor(() => {
      expect(containerLogsStreamMocks.start).toHaveBeenCalledTimes(1);
      expect(containerLogsStreamMocks.start).toHaveBeenCalledWith(scope);
    });
  });

  it('cluster-overview polls proceed while its metric-doorbell stream is healthy (doorbell augments polling)', async () => {
    // The overview's metric doorbell rings ONLY on successful collections;
    // on a metrics-less cluster it never rings. If a healthy stream
    // suppressed the overview's polls (as it does for the table domains),
    // the overview's object-derived counts would freeze forever.
    clusterReadiness.resetForTests();
    refreshOrchestrator.registerDomain({
      domain: 'cluster-overview',
      category: 'cluster',
      streaming: {
        start: (overviewScope: string) => resourceStreamMocks.start(overviewScope),
        stop: (overviewScope: string, options?: { reset?: boolean }) =>
          resourceStreamMocks.stop(overviewScope, options),
        refreshOnce: (overviewScope: string) => resourceStreamMocks.refreshOnce(overviewScope),
      },
    });
    const scope = testScope('cluster-a', '');
    resetAllScopedDomainStates('cluster-overview');
    leaseRuntimeScope('cluster-overview', scope);
    eventBus.emit('cluster:lifecycle', {
      clusterId: 'cluster-a',
      state: 'loading',
    });
    // Applied data + healthy stream: the exact state where table-domain polls
    // are skipped.
    setScopedDomainState('cluster-overview', scope, (prev) => ({
      ...prev,
      status: 'ready',
      data: {} as never,
    }));
    resourceStreamMocks.isHealthy.mockReturnValue(true);
    clientMocks.fetchSnapshotMock.mockClear();
    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'cluster-overview',
        scope,
        version: 2,
        checksum: 'etag-2',
        generatedAt: 1,
        sequence: 2,
        payload: {} as never,
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-2',
      notModified: false,
    });

    await refreshOrchestrator.fetchScopedDomain('cluster-overview', scope, { intent: 'startup' });

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledTimes(1);
    resourceStreamMocks.isHealthy.mockReturnValue(false);
  });

  it('a permission-denied scope is settled: background refetches are skipped and the state never re-enters loading', async () => {
    clusterReadiness.resetForTests();
    registerStreamingClusterConfigDomain();
    const scope = testScope('cluster-a', '');
    resetAllScopedDomainStates('cluster-config');
    // Serviceable before the lease, so no stream starts: this is the snapshot
    // path. With an active stream, a manual refresh resyncs the stream instead.
    eventBus.emit('cluster:lifecycle', {
      clusterId: 'cluster-a',
      state: 'loading',
    });
    leaseRuntimeScope('cluster-config', scope);
    clientMocks.fetchSnapshotMock.mockClear();

    // First (and only) permission check: the backend fails fast with a typed
    // 403. Permission is extremely unlikely to change mid-session, so this is
    // checked ONCE — recovery is an app restart.
    const denied = errorWithStatus(
      makeErrorStatus('Forbidden', 'permission denied for domain namespaces (core/namespaces)')
    );
    clientMocks.fetchSnapshotMock.mockRejectedValueOnce(denied);
    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { intent: 'startup' });
    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledTimes(1);
    // The orchestrator stores cluster-config under the cluster BASE scope.
    const storedScope = testScope('cluster-a', '');
    await vi.waitFor(() => {
      const deniedState = getScopedDomainState('cluster-config', storedScope);
      expect(deniedState.status).toBe('error');
      expect(deniedState.permissionDenied).toBe(true);
      expect(isPermissionDenied(deniedState.error)).toBe(true);
    });

    // Background retries (the 2s fallback poll observed live as
    // failureCount 73->78/10s + a loading/error spinner flicker) must be
    // SKIPPED entirely: no request, no loading transition.
    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { intent: 'startup' });
    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { intent: 'startup' });
    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledTimes(1);
    expect(getScopedDomainState('cluster-config', storedScope).status).toBe('error');

    // A manual refresh is a deliberate user action: it may re-ask.
    clientMocks.fetchSnapshotMock.mockRejectedValueOnce(denied);
    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { intent: 'user' });
    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledTimes(2);
  });

  // Starting the scope's stream resets it to initialising without an error.
  // The denial must outlive that: refetches stay blocked, so a lost denial
  // leaves the view loading forever (the restricted namespaces sidebar).
  it('keeps a permission-denied scope denied when its stream starts', async () => {
    clusterReadiness.resetForTests();
    registerStreamingClusterConfigDomain();
    const scope = testScope('cluster-a', '');
    resetAllScopedDomainStates('cluster-config');
    leaseRuntimeScope('cluster-config', scope);
    eventBus.emit('cluster:lifecycle', { clusterId: 'cluster-a', state: 'loading' });
    clientMocks.fetchSnapshotMock.mockRejectedValueOnce(
      errorWithStatus(makeErrorStatus('Forbidden', 'permission denied for domain cluster-config'))
    );
    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { intent: 'startup' });

    orchestratorInternals.scheduleStreamingStart('cluster-config', scope, {
      start: vi.fn(),
      stop: vi.fn(),
    });

    expect(getScopedDomainState('cluster-config', scope).permissionDenied).toBe(true);
  });

  it('re-asks a permission-denied scope after that cluster recovers from auth failure', async () => {
    registerCatalogDomain();
    const clusterId = 'cluster-auth-recovery';
    const scope = testScope(clusterId, '');
    leaseRuntimeScope('catalog', scope);
    eventBus.emit('cluster:lifecycle', { clusterId, state: 'loading' });
    const denied = errorWithStatus(
      makeErrorStatus('Forbidden', 'permission denied for domain catalog')
    );
    clientMocks.fetchSnapshotMock.mockRejectedValueOnce(denied);

    await refreshOrchestrator.fetchScopedDomain('catalog', scope, { intent: 'startup' });
    expect(isPermissionDenied(getScopedDomainState('catalog', scope).error)).toBe(true);

    orchestratorInternals.handleClusterAuthFailed({ clusterId });
    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: null,
      etag: undefined,
      notModified: true,
    });
    orchestratorInternals.handleClusterAuthRecovered({ clusterId });
    // Recovery restarts the scope's stream, whose initial read may re-ask
    // first; either way the denial no longer blocks a passive read.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const readsBefore = clientMocks.fetchSnapshotMock.mock.calls.length;
    await refreshOrchestrator.fetchScopedDomain('catalog', scope, { intent: 'startup' });

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledTimes(readsBefore + 1);
  });

  it.each(['cluster:scope-changed', 'cluster:permissions-changed'] as const)(
    'recovers only the affected cluster on %s',
    async (event) => {
      registerCatalogDomain();
      const scopeA = testScope('cluster-a', '');
      const scopeB = testScope('cluster-b', '');
      for (const scope of [scopeA, scopeB]) {
        leaseRuntimeScope('catalog', scope);
        setScopedDomainState('catalog', scope, (previous) => ({
          ...previous,
          status: 'error',
          error: { kind: 'backend', status: makeErrorStatus('Forbidden') },
          permissionDenied: true,
        }));
      }
      const controllerB = new AbortController();
      const runtimeB = orchestratorInternals.getRuntimeForScope(scopeB);
      runtimeB.setInFlight({
        controller: controllerB,
        isManual: false,
        requestId: 999,
        contextVersion: orchestratorInternals.contextVersion,
        domain: 'catalog',
        scope: scopeB,
      });
      const version = orchestratorInternals.contextVersion;
      eventBus.emit(event, { clusterId: 'cluster-a' });
      expect(getScopedDomainState('catalog', scopeA).permissionDenied).not.toBe(true);
      expect(getScopedDomainState('catalog', scopeB).permissionDenied).toBe(true);
      expect(controllerB.signal.aborted).toBe(false);
      expect(orchestratorInternals.contextVersion).toBe(version);
    }
  );

  it('a stream-signal fetch latches a trailing refetch behind an in-flight fetch — never dropped, never aborting', async () => {
    clusterReadiness.resetForTests();
    registerStreamingClusterConfigDomain();
    const scope = testScope('cluster-a', '');
    resetAllScopedDomainStates('cluster-config');
    leaseRuntimeScope('cluster-config', scope);
    eventBus.emit('cluster:lifecycle', {
      clusterId: 'cluster-a',
      state: 'loading',
    });
    clientMocks.fetchSnapshotMock.mockClear();

    // First doorbell's fetch hangs in flight.
    let resolveFirst: (value: unknown) => void = () => undefined;
    let firstSignal: AbortSignal | undefined;
    clientMocks.fetchSnapshotMock.mockImplementationOnce(
      (_domain: string, args: { signal?: AbortSignal }) => {
        firstSignal = args?.signal;
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
    );
    const firstFetch = refreshOrchestrator.fetchScopedDomain('cluster-config', scope, {
      intent: 'stream-signal',
    });
    await vi.waitFor(() => expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledTimes(1));

    // Doorbells ring (twice) while the first fetch is in flight. The signal
    // proves the in-flight response predates the change, so it must NOT be
    // dropped (lost update: nothing refetches until an unrelated event) — but
    // it must not ABORT the in-flight fetch either: signals can arrive faster
    // than a round trip, and abort-and-replace starves the scope so no fetch
    // ever lands. The correct semantics: latch ONE trailing refetch behind
    // the in-flight fetch, coalescing any number of signals.
    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'cluster-config',
        scope,
        version: 2,
        checksum: 'etag-2',
        generatedAt: Date.now(),
        sequence: 2,
        payload: { clusterId: 'cluster-a', rows: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      etag: 'etag-2',
      notModified: false,
    });
    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, {
      intent: 'stream-signal',
    });
    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, {
      intent: 'stream-signal',
    });
    // No new fetch yet, and the in-flight one was not cancelled.
    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledTimes(1);
    expect(firstSignal?.aborted ?? false).toBe(false);

    // The in-flight fetch lands (its data applies — it is newer than whatever
    // was on screen), then EXACTLY ONE trailing fetch runs for the signals.
    resolveFirst({
      snapshot: {
        domain: 'cluster-config',
        scope,
        version: 1,
        checksum: 'etag-1',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { clusterId: 'cluster-a', rows: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      etag: 'etag-1',
      notModified: false,
    });
    await firstFetch;
    await vi.waitFor(() => expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledTimes(2));

    // The trailing fetch's (fresh) data wins.
    const fetchedScope = clientMocks.fetchSnapshotMock.mock.calls[1][1].scope as string;
    await vi.waitFor(() =>
      expect(getScopedDomainState('cluster-config', fetchedScope).etag).toBe('etag-2')
    );

    clusterReadiness.resetForTests();
    resetAllScopedDomainStates('cluster-config');
  });

  it('fetches a new filtered catalog scope even when the stream is healthy (filter change must fire)', async () => {
    clusterReadiness.resetForTests();
    registerCatalogDomain();
    const filteredScope = testScope(
      'cluster-a',
      'limit=50&customOnly=true&kind=Widget&namespace=cluster'
    );
    resetAllScopedDomainStates('catalog');
    leaseRuntimeScope('catalog', filteredScope);
    clientMocks.fetchSnapshotMock.mockReset();
    clientMocks.fetchSnapshotMock.mockResolvedValue({
      snapshot: {
        domain: 'catalog',
        scope: filteredScope,
        version: 1,
        checksum: 'etag-filtered',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { clusterId: 'cluster-a', items: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      etag: 'etag-filtered',
      notModified: false,
    });

    // Make cluster-a serviceable (backend registers services at the 'loading' edge).
    eventBus.emit('cluster:lifecycle', {
      clusterId: 'cluster-a',
      state: 'loading',
    });

    // After the initial page load, the catalog doorbell stream is healthy.
    resourceStreamMocks.isHealthy.mockReturnValue(true);

    // Picking a Kind refetches the NEW scope with reason 'startup' → isManual:false.
    // The new scope has no data yet, so a snapshot MUST be fetched — a healthy stream
    // does not carry the new query's first page.
    await refreshOrchestrator.fetchScopedDomain('catalog', filteredScope, { intent: 'startup' });

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalled();

    clusterReadiness.resetForTests();
    resetAllScopedDomainStates('catalog');
  });

  it('still skips a background snapshot for a LOADED catalog scope when the stream is healthy', async () => {
    clusterReadiness.resetForTests();
    registerCatalogDomain();
    const loadedScope = testScope('cluster-a', 'limit=50&customOnly=true&namespace=cluster');
    resetAllScopedDomainStates('catalog');
    leaseRuntimeScope('catalog', loadedScope);
    // The scope already holds an applied snapshot (the stream keeps it fresh).
    setScopedDomainState('catalog', loadedScope, (prev) => ({
      ...prev,
      status: 'ready',
      scope: loadedScope,
      data: { clusterId: 'cluster-a', items: [] } as never,
    }));
    clientMocks.fetchSnapshotMock.mockReset();

    eventBus.emit('cluster:lifecycle', {
      clusterId: 'cluster-a',
      state: 'loading',
    });
    resourceStreamMocks.isHealthy.mockReturnValue(true);

    await refreshOrchestrator.fetchScopedDomain('catalog', loadedScope, { intent: 'startup' });

    // Optimization intact: a loaded scope with a healthy stream skips the redundant poll.
    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();

    clusterReadiness.resetForTests();
    resetAllScopedDomainStates('catalog');
  });

  it('skips the namespaces poll for a loaded scope while its doorbell stream is healthy', async () => {
    clusterReadiness.resetForTests();
    refreshOrchestrator.registerDomain({
      domain: 'namespaces',
      category: 'system',
      streaming: {
        start: (namespaceScope: string) => catalogStreamMocks.start(namespaceScope),
        stop: (namespaceScope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(namespaceScope, options?.reset ?? false),
        refreshOnce: (namespaceScope: string) => catalogStreamMocks.refreshOnce(namespaceScope),
      },
    });
    const scope = testScope('cluster-a', '');
    resetAllScopedDomainStates('namespaces');
    leaseRuntimeScope('namespaces', scope);
    setScopedDomainState('namespaces', scope, (prev) => ({
      ...prev,
      status: 'ready',
      scope,
      data: { clusterId: 'cluster-a', namespaces: [] } as never,
    }));
    clientMocks.fetchSnapshotMock.mockReset();

    eventBus.emit('cluster:lifecycle', {
      clusterId: 'cluster-a',
      state: 'loading',
    });
    resourceStreamMocks.isHealthy.mockReturnValue(true);

    await refreshOrchestrator.fetchScopedDomain('namespaces', scope, { intent: 'startup' });

    // The 2s namespaces timing is only the stream-down fallback: a loaded scope
    // with a healthy doorbell stream must not re-poll.
    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();

    clusterReadiness.resetForTests();
    resetAllScopedDomainStates('namespaces');
  });

  it.each(['event', 'snapshot'] as const)(
    'defers a newly selected cluster until serving readiness arrives by %s',
    async (source) => {
      clusterReadiness.resetForTests();
      registerStreamingClusterConfigDomain();
      const scope = testScope('cluster-new', '');
      leaseRuntimeScope('cluster-config', scope);
      clientMocks.fetchSnapshotMock.mockResolvedValue({
        snapshot: {
          domain: 'cluster-config',
          scope,
          version: 1,
          generatedAt: Date.now(),
          sequence: 1,
          payload: makeClusterConfigSnapshotPayload(),
          stats: { itemCount: 0, buildDurationMs: 0 },
        },
        notModified: false,
      });
      await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { intent: 'startup' });
      expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
      expect(errorHandlerMock.handle).not.toHaveBeenCalled();

      if (source === 'event') {
        eventBus.emit('cluster:lifecycle', { clusterId: 'cluster-new', state: 'loading' });
      } else {
        await clusterWorkspaceStore.reconcileCommand(
          async () => ({
            state: {
              selectedKubeconfigs: [],
              visibleClusterId: 'cluster-new',
              clusters: {
                'cluster-new': {
                  clusterId: 'cluster-new',
                  clusterName: 'New cluster',
                  lifecycle: 'loading',
                  auth: { state: 'valid' },
                  health: 'healthy',
                  scopeRevision: 0,
                },
              },
            },
          }),
          () => true
        );
      }
      await vi.waitFor(() => expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledOnce());
      expect(getScopedDomainState('cluster-config', scope).status).toBe('ready');
    }
  );

  // A failure without a backend status (the browser could not reach the
  // backend after the client's retries) is still a visible error state that
  // keeps its own message, and the next good fetch clears it.
  it('stores a browser failure as a local failure until a fetch succeeds', async () => {
    registerCatalogDomain();
    const scope = testScope('cluster-a', '');
    leaseRuntimeScope('catalog', scope);
    eventBus.emit('cluster:lifecycle', { clusterId: 'cluster-a', state: 'ready' });
    clientMocks.fetchSnapshotMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await refreshOrchestrator.fetchScopedDomain('catalog', scope, { intent: 'startup' });

    expect(getScopedDomainState('catalog', scope)).toMatchObject({
      status: 'error',
      error: { kind: 'local', message: 'Failed to fetch', errorName: 'TypeError' },
    });

    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'catalog',
        scope,
        version: 2,
        checksum: 'etag-ok',
        generatedAt: Date.now(),
        sequence: 2,
        payload: makeCatalogSnapshotPayload(),
        stats: { itemCount: 0, buildDurationMs: 1 },
      },
      etag: 'etag-ok',
      notModified: false,
    });
    await refreshOrchestrator.fetchScopedDomain('catalog', scope, { intent: 'startup' });

    expect(getScopedDomainState('catalog', scope)).toMatchObject({ status: 'ready', error: null });
  });

  describe('right after a kubeconfig change', () => {
    // The start-up window is measured on Date; an epoch-zero clock lets it
    // lapse as soon as these tests restore real time.
    beforeEach(() => {
      vi.useFakeTimers({ now: 0, toFake: ['Date'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const failFetch = async (error: Error) => {
      registerCatalogDomain();
      const scope = testScope('cluster-a', '');
      leaseRuntimeScope('catalog', scope);
      eventBus.emit('cluster:lifecycle', { clusterId: 'cluster-a', state: 'loading' });
      orchestratorInternals.handleKubeconfigChanged();
      errorHandlerMock.handle.mockClear();
      clientMocks.fetchSnapshotMock.mockRejectedValueOnce(error);
      await refreshOrchestrator.fetchScopedDomain('catalog', scope, { intent: 'startup' });
      return getScopedDomainState('catalog', scope);
    };

    // The backend is republishing its refresh service and cluster handlers;
    // these answers are start-up, not failures.
    it.each([
      ['RefreshUnavailable', 'refresh subsystem not initialised'],
      ['ClusterNotReady', 'no active clusters available (requested: [cluster-a])'],
    ] as const)('does not report a %s answer', async (reason, message) => {
      const state = await failFetch(errorWithStatus(makeErrorStatus(reason, message)));

      expect(errorHandlerMock.handle).not.toHaveBeenCalled();
      expect(state.status).not.toBe('error');
    });

    it('does not report a browser fetch failure', async () => {
      const state = await failFetch(new TypeError('Failed to fetch'));

      expect(errorHandlerMock.handle).not.toHaveBeenCalled();
      expect(state.status).not.toBe('error');
    });

    it('still reports a real failure', async () => {
      const state = await failFetch(
        errorWithStatus(makeErrorStatus('InternalError', 'catalog sync failed'))
      );

      expect(errorHandlerMock.handle).toHaveBeenCalledTimes(1);
      expect(state.status).toBe('error');
    });
  });

  it('treats a ClusterNotReady answer as warm-up instead of toasting', () => {
    clusterReadiness.resetForTests();
    errorHandlerMock.handle.mockClear();
    const notReady = errorWithStatus(makeErrorStatus('ClusterNotReady', 'cluster is starting'));

    orchestratorInternals.notifyRefreshError(
      'cluster-config',
      testScope('cluster-init', ''),
      notReady.message,
      notReady
    );

    expect(errorHandlerMock.handle).not.toHaveBeenCalled();
    clusterReadiness.resetForTests();
  });

  // A panel's object that is gone is shown as deleted by the panel; only the
  // backend's NotFound says so, not words in a message.
  it.each([
    ['does not toast a NotFound answer', errorWithStatus(makeErrorStatus('NotFound', 'gone')), 0],
    ['toasts a failure that only mentions "not found"', new Error('helper not found'), 1],
  ] as const)('object details: %s', (_name, error, toasts) => {
    errorHandlerMock.handle.mockClear();

    orchestratorInternals.notifyRefreshError(
      'object-details',
      testScope('cluster-a', 'default:apps/v1:Deployment:web'),
      error.message,
      error
    );

    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(toasts);
  });

  it('reads the leased pods table scope of the named cluster on manual refresh', async () => {
    scopedFetch.mockResolvedValue(undefined as unknown as undefined);
    registerPodsDomain();
    refreshOrchestrator.acquireScopedDomainLease('pods', 'cluster-a|namespace:team-a');

    await refreshOrchestrator.refreshCluster('cluster-a');

    expect(scopedFetch).toHaveBeenCalledWith(
      'pods',
      'cluster-a|namespace:team-a',
      expect.objectContaining({ intent: 'user' })
    );
    refreshOrchestrator.releaseScopedDomainLease('pods', 'cluster-a|namespace:team-a');
  });

  it('keeps a leased scope enabled across an old instance unmount (remount race)', () => {
    registerPodsDomain();

    // Old table instance leases the scope.
    refreshOrchestrator.acquireScopedDomainLease('pods', 'cluster-a|namespace:team-a');
    expect(
      orchestratorInternals.isScopedDomainEnabledInternal('pods', 'cluster-a|namespace:team-a')
    ).toBe(true);

    // New instance leases the same scope before the old instance unmounts.
    refreshOrchestrator.acquireScopedDomainLease('pods', 'cluster-a|namespace:team-a');

    // Old instance unmounts: its release must NOT disable the still-leased scope.
    refreshOrchestrator.releaseScopedDomainLease('pods', 'cluster-a|namespace:team-a');
    expect(
      orchestratorInternals.isScopedDomainEnabledInternal('pods', 'cluster-a|namespace:team-a')
    ).toBe(true);

    // Final lease released: only now does the scope disable.
    refreshOrchestrator.releaseScopedDomainLease('pods', 'cluster-a|namespace:team-a');
    expect(
      orchestratorInternals.isScopedDomainEnabledInternal('pods', 'cluster-a|namespace:team-a')
    ).toBe(false);
  });

  it('polls every leased pods scope at the domain interval', async () => {
    vi.useFakeTimers();
    try {
      scopedFetch.mockReset();
      registerPodsDomain();
      eventBus.emit('cluster:lifecycle', { clusterId: 'cluster-a', state: 'ready' });
      refreshOrchestrator.acquireScopedDomainLease('pods', 'cluster-a|namespace:team-a');
      refreshOrchestrator.acquireScopedDomainLease('pods', 'cluster-a|namespace:team-b');

      await vi.advanceTimersByTimeAsync(5000);

      for (const scope of ['cluster-a|namespace:team-a', 'cluster-a|namespace:team-b']) {
        expect(scopedFetch).toHaveBeenCalledWith(
          'pods',
          scope,
          expect.objectContaining({ intent: 'background', queryReconcile: true })
        );
      }
      refreshOrchestrator.releaseScopedDomainLease('pods', 'cluster-a|namespace:team-a');
      refreshOrchestrator.releaseScopedDomainLease('pods', 'cluster-a|namespace:team-b');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects scopes without a cluster prefix instead of rebasing them onto the selected cluster', async () => {
    registerPodsDomain();
    refreshOrchestrator.setConnectedClusters(['cluster-a', 'cluster-b']);
    clientMocks.fetchSnapshotMock.mockClear();

    expect(() => refreshOrchestrator.acquireScopedDomainLease('pods', 'namespace:team-a')).toThrow(
      'no cluster prefix'
    );
    await expect(
      refreshOrchestrator.fetchScopedDomain('pods', 'namespace:team-a', { intent: 'user' })
    ).rejects.toThrow('no cluster prefix');
    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
  });
  it('stores single-cluster resource enablement in the cluster runtime', () => {
    registerPodsDomain();
    refreshOrchestrator.setConnectedClusters(['cluster-a', 'cluster-b']);

    refreshOrchestrator.acquireScopedDomainLease('pods', 'cluster-a|namespace:team-a');

    const scope = 'cluster-a|namespace:team-a';
    expect(orchestratorInternals.coordinatorRuntime.getKnownScopes('pods')).toEqual([]);
    expect(
      orchestratorInternals.clusterRuntimes.get('cluster-a')?.isScopedDomainEnabled('pods', scope)
    ).toBe(true);
  });

  it('resets leaked snapshot/stream scoped state for a removed cluster, keeping connected clusters', () => {
    // cluster-events is snapshot/stream-driven (polling disabled), so its scope is never
    // tracked as an enabled polling lease and lives only in the global scoped store. When
    // its cluster is closed, prune must still reset it — otherwise it orphans in the
    // diagnostics domain list (a closed cluster's domain lingering forever). The stored
    // scope for a cluster-scoped, empty-tail domain is "<clusterId>|" (the cluster selector).
    const removedScope = 'cluster-b|';
    const keptScope = 'cluster-a|';
    setScopedDomainState('cluster-events', removedScope, (prev) => ({ ...prev, status: 'ready' }));
    setScopedDomainState('cluster-events', keptScope, (prev) => ({ ...prev, status: 'ready' }));

    const eventScopes = () =>
      (getRefreshState().scopedDomainEntries['cluster-events'] ?? []).map(([scope]) => scope);
    expect(eventScopes()).toEqual(expect.arrayContaining([removedScope, keptScope]));

    refreshOrchestrator.setConnectedClusters(['cluster-a']);

    expect(eventScopes()).toContain(keptScope);
    expect(eventScopes()).not.toContain(removedScope);
  });

  it('does not start a queued stream or recreate diagnostics after its cluster closes', async () => {
    const start = vi.fn(async () => undefined);
    refreshOrchestrator.registerDomain({
      domain: 'namespaces',
      category: 'system',
      streaming: { start, snapshotless: true },
    });
    const scope = 'closing|';
    eventBus.emit('cluster:lifecycle', { clusterId: 'closing', state: 'ready' });
    refreshOrchestrator.acquireScopedDomainLease('namespaces', scope);
    refreshOrchestrator.setConnectedClusters(['retained']);
    await Promise.resolve();
    await Promise.resolve();

    expect(start).not.toHaveBeenCalled();
    expect(orchestratorInternals.clusterRuntimes.has('closing')).toBe(false);
    expect(getRefreshState().scopedDomainEntries.namespaces ?? []).toEqual([]);

    // An explicit reopen owns a fresh runtime and may start its own stream.
    refreshOrchestrator.setConnectedClusters(['retained', 'closing']);
    refreshOrchestrator.acquireScopedDomainLease('namespaces', scope);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  });

  it.each(['resolve', 'reject'] as const)(
    'retires a pending stream that settles with %s after cluster close',
    async (outcome) => {
      let resolve!: (cleanup: () => void) => void;
      let reject!: (error: Error) => void;
      const cleanup = vi.fn();
      const pending = new Promise<() => void>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      const start = vi.fn(() => pending);
      refreshOrchestrator.registerDomain({
        domain: 'namespaces',
        category: 'system',
        streaming: { start, snapshotless: true },
      });
      eventBus.emit('cluster:lifecycle', { clusterId: 'closing', state: 'ready' });
      refreshOrchestrator.acquireScopedDomainLease('namespaces', 'closing|');
      await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
      refreshOrchestrator.setConnectedClusters(['retained']);
      if (outcome === 'resolve') {
        resolve(cleanup);
      } else {
        reject(new Error('retired connection'));
      }
      await pending.catch(() => undefined);
      await Promise.resolve();
      expect(cleanup).toHaveBeenCalledTimes(outcome === 'resolve' ? 1 : 0);
      expect(orchestratorInternals.clusterRuntimes.has('closing')).toBe(false);
      expect(getRefreshState().scopedDomainEntries.namespaces ?? []).toEqual([]);
      expect(errorHandlerMock.handle).not.toHaveBeenCalled();
    }
  );

  it('drops deferred refresh work when its cluster is removed', async () => {
    registerStreamingClusterConfigDomain();
    const clusterId = 'cluster-b';
    const scope = testScope(clusterId, '');
    leaseRuntimeScope('cluster-config', scope);
    eventBus.emit('cluster:lifecycle', { clusterId, state: 'ready' });
    clusterReadiness.beginForegroundActivation(clusterId);

    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { intent: 'startup' });
    expect(
      orchestratorInternals.clusterRuntimes.get(clusterId)?.getDeferredReadinessRequests()
    ).toHaveLength(1);

    refreshOrchestrator.setConnectedClusters(['cluster-a']);

    expect(orchestratorInternals.clusterRuntimes.has(clusterId)).toBe(false);
  });

  it('stores namespaces enablement in the active cluster runtime', () => {
    refreshOrchestrator.registerDomain({
      domain: 'namespaces',
      category: 'system',
    });
    refreshOrchestrator.setConnectedClusters(['cluster-a', 'cluster-b']);

    refreshOrchestrator.acquireScopedDomainLease('namespaces', testScope('cluster-a'));

    const scope = testScope('cluster-a');
    expect(orchestratorInternals.coordinatorRuntime.getKnownScopes('namespaces')).toEqual([]);
    expect(
      orchestratorInternals.clusterRuntimes
        .get('cluster-a')
        ?.isScopedDomainEnabled('namespaces', scope)
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

    const scope = testScope('cluster-a');
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
      category: 'cluster',
    });
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scope);

    const abortController = new AbortController();
    await pollLeasedScopes('cluster-config', true, abortController.signal);

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
    const scope = testScope('cluster-a');
    const cachedNamespace = {
      clusterId: 'cluster-a',
      clusterName: 'Cluster A',
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
      warningEventsState: 'available' as const,
      quotaPressureState: 'available' as const,
    };
    const changedNamespace = {
      clusterId: 'cluster-a',
      clusterName: 'Cluster A',
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
      warningEventsState: 'available' as const,
      quotaPressureState: 'available' as const,
    };

    setScopedDomainState('namespaces', scope, (prev) => ({
      ...prev,
      status: 'ready',
      data: {
        namespaces: [cachedNamespace, changedNamespace],
        metrics: { stale: false, successCount: 1, failureCount: 0 },
        metricsState: 'available',
        clusterId: 'test-cluster',
        clusterName: 'Test Cluster',
      },
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
          metrics: { stale: false, successCount: 1, failureCount: 0 },
          metricsState: 'available',
          clusterId: 'test-cluster',
          clusterName: 'Test Cluster',
        },
        stats: { itemCount: 2, buildDurationMs: 0 },
      },
      etag: 'etag-2',
      notModified: false,
    });

    refreshOrchestrator.registerDomain({
      domain: 'namespaces',
      category: 'system',
    });
    refreshOrchestrator.acquireScopedDomainLease('namespaces', scope);

    const abortController = new AbortController();
    await pollLeasedScopes('namespaces', true, abortController.signal);

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

    const scope = testScope('cluster-a', 'node:node-a');
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

    await refreshOrchestrator.fetchScopedDomain('object-maintenance', scope, { intent: 'user' });

    const nextDrains = getScopedDomainState('object-maintenance', scope).data?.drains ?? [];
    expect(nextDrains[0]).toBe(cachedDrain);
    expect(nextDrains[1]).not.toBe(changedDrain);
  });

  it('reuses cached catalog diff items when polling snapshots are unchanged', async () => {
    const cachedItem = {
      ref: {
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        resource: 'deployments',
        namespace: 'default',
        name: 'web',
        uid: 'uid-1',
      },
      resourceVersion: '10',
      creationTimestamp: '2024-01-01T00:00:00Z',
      scope: 'Namespace' as const,
    };
    const changedItem = {
      ref: {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'ConfigMap',
        resource: 'configmaps',
        namespace: 'default',
        name: 'settings',
        uid: 'uid-2',
      },
      resourceVersion: '5',
      creationTimestamp: '2024-01-01T00:00:00Z',
      scope: 'Namespace' as const,
    };

    const scope = testScope('cluster-a', 'limit=50');
    setScopedDomainState('catalog-diff', scope, (prev) => ({
      ...prev,
      status: 'ready',
      data: makeCatalogSnapshotPayload({
        clusterId: 'cluster-a',
        items: [cachedItem, changedItem],
        total: 2,
        unfilteredTotal: 2,
        resourceCount: 2,
        batchIndex: 0,
        batchSize: 2,
        totalBatches: 1,
        isFinal: true,
      }),
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

    await refreshOrchestrator.fetchScopedDomain('catalog-diff', scope, { intent: 'user' });

    const nextItems = getScopedDomainState('catalog-diff', scope).data?.items ?? [];
    expect(nextItems[0]).toBe(cachedItem);
    expect(nextItems[1]).not.toBe(changedItem);
  });

  it('records errors and surfaces them via the error handler', async () => {
    const scope = testScope('cluster-a');
    const fetchError = new Error('offline');
    clientMocks.fetchSnapshotMock.mockRejectedValue(fetchError);

    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      category: 'cluster',
    });
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scope);

    await pollLeasedScopes('cluster-config', true, new AbortController().signal);

    const state = getScopedDomainState('cluster-config', scope);
    expect(state.status).toBe('error');
    expect(failureMessage(state.error)).toBe('offline');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      fetchError,
      expect.objectContaining({
        source: 'refresh-orchestrator',
        domain: 'cluster-config',
        scope,
      }),
      'offline'
    );
    expect(getRefreshState().pendingRequests).toBe(0);
  });

  it('carries a broker correlation id into refresh error reporting', async () => {
    const scope = testScope('cluster-correlation');
    const fetchError = new Error('correlated refresh failed');
    clientMocks.fetchSnapshotMock.mockRejectedValue(fetchError);

    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      category: 'cluster',
    });
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scope);
    eventBus.emit('cluster:lifecycle', { clusterId: 'cluster-correlation', state: 'loading' });

    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, {
      intent: 'user',
      correlationId: 'broker-read-42',
    });

    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      fetchError,
      expect.objectContaining({
        source: 'refresh-orchestrator',
        operationId: 'broker-read-42',
      }),
      'correlated refresh failed'
    );
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

  it('discards old scoped enablement across kubeconfig changes', async () => {
    refreshOrchestrator.registerDomain({
      domain: 'namespace-events',
      category: 'namespace',

      streaming: {
        start: (scope: string) => eventStreamMocks.startNamespace(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopNamespace(scope, options?.reset ?? false),
      },
    });

    const teamScope = 'cluster-a|namespace:team-a';
    const knownScopes = () =>
      orchestratorInternals.clusterRuntimes.get('cluster-a')?.getKnownScopes('namespace-events') ??
      [];
    await refreshOrchestrator.acquireScopedDomainLease('namespace-events', teamScope);
    expect(knownScopes()).toEqual([teamScope]);

    orchestratorInternals.handleKubeconfigChanging();
    expect(knownScopes()).toEqual([]);

    orchestratorInternals.handleKubeconfigChanged();
    expect(knownScopes()).toEqual([]);
  });

  it('retains existing data when the backend responds with not-modified', async () => {
    const scope = testScope('cluster-a');
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
      category: 'cluster',
    });
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scope);
    await pollLeasedScopes('cluster-config', true, new AbortController().signal);

    clientMocks.fetchSnapshotMock.mockReset();
    clientMocks.fetchSnapshotMock.mockResolvedValue({
      notModified: true,
      snapshot: undefined,
      etag: undefined,
    });

    await pollLeasedScopes('cluster-config', false, new AbortController().signal);

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

  it('updates metrics demand when metrics domains toggle', async () => {
    refreshOrchestrator.registerDomain({
      domain: 'cluster-overview',
      category: 'cluster',
    });

    // Metrics demand should follow the visibility of metrics-driven domains.
    const scope = testScope('cluster-a', '');
    refreshOrchestrator.acquireScopedDomainLease('cluster-overview', scope);
    expect(clientMocks.setMetricsActiveMock).toHaveBeenCalledWith(['cluster-a']);
    await Promise.resolve();

    refreshOrchestrator.releaseScopedDomainLease('cluster-overview', scope);
    await Promise.resolve();
    expect(clientMocks.setMetricsActiveMock).toHaveBeenLastCalledWith([]);
    expect(clientMocks.setMetricsActiveMock).toHaveBeenCalledTimes(2);
  });

  it('routes metrics demand to the clusters that own active metric-bearing scopes', async () => {
    refreshOrchestrator.registerDomain({
      domain: 'cluster-overview',
      category: 'system',
    });

    const scopeA = testScope('cluster-a', '');
    const scopeB = testScope('cluster-b', '');
    refreshOrchestrator.acquireScopedDomainLease('cluster-overview', scopeA);
    await Promise.resolve();
    refreshOrchestrator.acquireScopedDomainLease('cluster-overview', scopeB);
    await Promise.resolve();
    expect(clientMocks.setMetricsActiveMock).toHaveBeenLastCalledWith(['cluster-a', 'cluster-b']);

    refreshOrchestrator.releaseScopedDomainLease('cluster-overview', scopeA);
    await Promise.resolve();
    expect(clientMocks.setMetricsActiveMock).toHaveBeenLastCalledWith(['cluster-b']);

    refreshOrchestrator.acquireScopedDomainLease('cluster-overview', scopeA);
    await Promise.resolve();
    refreshOrchestrator.setConnectedClusters(['cluster-b']);
    await Promise.resolve();
    expect(clientMocks.setMetricsActiveMock).toHaveBeenLastCalledWith(['cluster-b']);
  });

  it('does not treat a retained namespace workspace as metrics demand', () => {
    refreshOrchestrator.registerDomain({
      domain: 'namespaces',
      category: 'cluster',
    });

    refreshOrchestrator.acquireScopedDomainLease('namespaces', 'cluster-a|');
    expect(clientMocks.setMetricsActiveMock).not.toHaveBeenCalled();

    refreshOrchestrator.releaseScopedDomainLease('namespaces', 'cluster-a|');
    expect(clientMocks.setMetricsActiveMock).not.toHaveBeenCalled();
  });

  it('treats a visible namespace-metrics lease as metrics demand', async () => {
    refreshOrchestrator.registerDomain({
      domain: 'namespace-metrics',
      category: 'system',
    });

    refreshOrchestrator.acquireScopedDomainLease('namespace-metrics', 'cluster-a|');
    expect(clientMocks.setMetricsActiveMock).toHaveBeenLastCalledWith(['cluster-a']);
    await Promise.resolve();

    refreshOrchestrator.releaseScopedDomainLease('namespace-metrics', 'cluster-a|');
    await Promise.resolve();
    expect(clientMocks.setMetricsActiveMock).toHaveBeenLastCalledWith([]);
  });

  it('retries unchanged metrics demand after a transient request failure', async () => {
    vi.useFakeTimers();
    try {
      clientMocks.setMetricsActiveMock
        .mockRejectedValueOnce(new Error('refresh API unavailable'))
        .mockResolvedValue(undefined);
      refreshOrchestrator.registerDomain({
        domain: 'namespace-metrics',
        category: 'system',
      });

      refreshOrchestrator.acquireScopedDomainLease('namespace-metrics', 'cluster-a|');
      await Promise.resolve();
      expect(clientMocks.setMetricsActiveMock).toHaveBeenCalledTimes(1);

      await vi.runOnlyPendingTimersAsync();
      expect(clientMocks.setMetricsActiveMock).toHaveBeenCalledTimes(2);
      expect(clientMocks.setMetricsActiveMock).toHaveBeenLastCalledWith(['cluster-a']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps single-scope system domains isolated by cluster runtime', () => {
    refreshOrchestrator.registerDomain({
      domain: 'cluster-overview',
      category: 'system',
    });

    const scopeA = testScope('cluster-a', '');
    const scopeB = testScope('cluster-b', '');

    refreshOrchestrator.acquireScopedDomainLease('cluster-overview', scopeA);
    setScopedDomainState('cluster-overview', scopeA, (previous) => ({
      ...previous,
      status: 'ready',
      data: previous.data,
      stats: { itemCount: 1, buildDurationMs: 0 },
      scope: scopeA,
    }));

    refreshOrchestrator.acquireScopedDomainLease('cluster-overview', scopeB);

    expect(
      orchestratorInternals.clusterRuntimes
        .get('cluster-a')
        ?.isScopedDomainEnabled('cluster-overview', scopeA)
    ).toBe(true);
    expect(
      orchestratorInternals.clusterRuntimes
        .get('cluster-b')
        ?.isScopedDomainEnabled('cluster-overview', scopeB)
    ).toBe(true);
    expect(orchestratorInternals.coordinatorRuntime.getKnownScopes('cluster-overview')).toEqual([]);
    expect(getScopedDomainState('cluster-overview', scopeA).status).toBe('ready');
  });

  it('reports no polling for a stream-only domain', () => {
    refreshOrchestrator.registerDomain({
      domain: 'container-logs',
      category: 'system',
      streaming: { snapshotless: true, start: () => () => undefined },
    });

    const scope = testScope('cluster-a', 'team-a:/v1:Pod:web-0');
    refreshOrchestrator.acquireScopedDomainLease('container-logs', scope);

    expect(refreshOrchestrator.getPollingStatus('container-logs', scope)).toEqual({
      state: 'off',
      intervalMs: null,
    });
    refreshOrchestrator.releaseScopedDomainLease('container-logs', scope);
  });

  it('keeps the leased cluster-attention base scope while a table query scope is active', () => {
    refreshOrchestrator.registerDomain({
      domain: 'cluster-attention',
      category: 'cluster',
    });

    const baseScope = testScope('cluster-a', '');
    const queryScope = testScope('cluster-a', '?limit=50&sort=severity');
    const severityCounts = { info: 5, warning: 16, error: 0 };

    refreshOrchestrator.acquireScopedDomainLease('cluster-attention', baseScope, {
      preserveState: true,
    });
    setScopedDomainState('cluster-attention', baseScope, (previous) => ({
      ...previous,
      status: 'ready',
      data: { severityCounts } as never,
      scope: baseScope,
    }));

    // Typed table queries temporarily enable their full query scope, then
    // disable it after reading the result. That transient scope must not evict
    // the sidebar's independently leased base snapshot.
    refreshOrchestrator.acquireScopedDomainLease('cluster-attention', queryScope);
    refreshOrchestrator.releaseScopedDomainLease('cluster-attention', queryScope);

    const runtime = orchestratorInternals.clusterRuntimes.get('cluster-a');
    expect(runtime?.isScopedDomainEnabled('cluster-attention', baseScope)).toBe(true);
    expect(getScopedDomainState('cluster-attention', baseScope).data?.severityCounts).toEqual(
      severityCounts
    );

    refreshOrchestrator.releaseScopedDomainLease('cluster-attention', baseScope, {
      preserveState: true,
    });
  });

  it('allows object-panel domains to keep multiple active object scopes', () => {
    const objectPanelDomains: RefreshDomain[] = [
      'container-logs',
      'object-details',
      'object-events',
      'object-helm-manifest',
      'object-helm-values',
      'object-maintenance',
      'object-map',
      'object-yaml',
    ];

    objectPanelDomains.forEach((domain) => {
      resetAllScopedDomainStates(domain);
      refreshOrchestrator.registerDomain({
        domain,
        category: 'system',
      });

      const [firstTail, secondTail] =
        refreshDomainContract.domainInventory[domain].scopeContract.valid;
      const firstScope = testScope('cluster-a', firstTail);
      const secondScope = testScope('cluster-a', secondTail);

      refreshOrchestrator.acquireScopedDomainLease(domain, firstScope);
      setScopedDomainState(domain, firstScope, (previous) => ({
        ...previous,
        status: 'ready',
        data: previous.data,
        stats: { itemCount: 1, buildDurationMs: 0 },
        scope: firstScope,
      }));

      refreshOrchestrator.acquireScopedDomainLease(domain, secondScope);

      const runtime = orchestratorInternals.clusterRuntimes.get('cluster-a');
      expect(runtime?.isScopedDomainEnabled(domain, firstScope)).toBe(true);
      expect(runtime?.isScopedDomainEnabled(domain, secondScope)).toBe(true);
      expect(getScopedDomainState(domain, firstScope).status).toBe('ready');
    });
  });

  it('uses snapshot fetch for manual refresh on streaming domains even when stream is active', async () => {
    catalogStreamMocks.refreshOnce.mockClear();
    clientMocks.fetchSnapshotMock.mockClear();

    registerCatalogDomain();

    // Enable the scope and simulate an already-active stream by injecting cleanup directly.
    leaseRuntimeScope('catalog', 'cluster-a|scope=all');
    markResourceStreamActive('catalog', 'cluster-a|scope=all');

    catalogStreamMocks.refreshOnce.mockClear();
    clientMocks.fetchSnapshotMock.mockClear();

    // Trigger a manual refresh via fetchScopedDomain.
    // Doorbell domains should fall through to a snapshot fetch instead of
    // redirecting to refreshStreamingDomainOnce for manual refresh.
    await refreshOrchestrator.fetchScopedDomain('catalog', 'cluster-a|scope=all', {
      intent: 'user',
    });

    expect(catalogStreamMocks.refreshOnce).not.toHaveBeenCalled();
    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalled();
  });

  it('does not let a healthy catalog stream for one scope skip another scope snapshot', async () => {
    registerCatalogDomain();
    const pageScope = testScope('cluster-a', 'limit=50&namespace=cluster');
    const metadataScope = testScope('cluster-a', 'limit=1&namespace=cluster');
    leaseRuntimeScope('catalog', pageScope);
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

    await refreshOrchestrator.fetchScopedDomain('catalog', pageScope, { intent: 'startup' });

    expect(resourceStreamMocks.isHealthy).toHaveBeenCalledWith('catalog', pageScope);
    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'catalog',
      expect.objectContaining({ scope: pageScope })
    );
  });

  it('keeps polling enabled when a resource stream is active but unhealthy', () => {
    registerStreamingClusterConfigDomain();

    const scope = testScope('cluster-a', '');
    leaseRuntimeScope('cluster-config', scope);
    markResourceStreamActive('cluster-config', scope);
    resourceStreamMocks.isHealthy.mockReturnValue(false);

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
        ?.getStreamHealth('cluster-config', scope)?.status
    ).toBe('unhealthy');
  });

  it('pauses polling when a resource stream is active and healthy', () => {
    registerStreamingClusterConfigDomain();

    const scope = testScope('cluster-a', '');
    leaseRuntimeScope('cluster-config', scope);
    markResourceStreamActive('cluster-config', scope);
    resourceStreamMocks.isHealthy.mockReturnValue(true);

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
        ?.getStreamHealth('cluster-config', scope)?.status
    ).toBe('healthy');
  });

  it('falls back to snapshots when a resource stream is unhealthy', async () => {
    // Register cluster-config as scoped (matching production config) with streaming.
    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      category: 'cluster',
      streaming: {
        start: (configScope: string) => resourceStreamMocks.start(configScope),
        stop: (configScope: string, options?: { reset?: boolean }) =>
          resourceStreamMocks.stop(configScope, options),
        refreshOnce: (configScope: string) => resourceStreamMocks.refreshOnce(configScope),
      },
    });

    const scope = testScope('cluster-a', '');
    // Enable the scoped domain and mark the stream as active but unhealthy.
    await refreshOrchestrator.acquireScopedDomainLease?.('cluster-config', scope);
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
    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { intent: 'startup' });

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'cluster-config',
      expect.objectContaining({ scope })
    );

    clientMocks.fetchSnapshotMock.mockClear();
    resourceStreamMocks.isHealthy.mockReturnValue(true);

    // With healthy stream, fetchScopedDomain should skip the snapshot fetch.
    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { intent: 'startup' });

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it('asks query-only consumers to reconcile without fetching a bounded base snapshot', async () => {
    registerStreamingClusterConfigDomain();
    const scope = testScope('cluster-a', '');
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scope, { demand: 'query' });
    await Promise.resolve();
    await Promise.resolve();
    clientMocks.fetchSnapshotMock.mockClear();
    resourceStreamMocks.isHealthy.mockReturnValue(false);

    await pollLeasedScopes('cluster-config', false);

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
    expect(getScopedDomainState('cluster-config', scope).queryReconcileVersion).toBe(1);
    expect(resourceStreamMocks.recordStreamFallback).toHaveBeenCalledWith(
      'cluster-config',
      scope,
      'stream not delivering'
    );
    refreshOrchestrator.releaseScopedDomainLease('cluster-config', scope, { demand: 'query' });
  });

  it('leaves a query-only consumer alone while its stream is healthy', async () => {
    registerStreamingClusterConfigDomain();
    const scope = testScope('cluster-a', '');
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scope, { demand: 'query' });
    await Promise.resolve();
    await Promise.resolve();
    clientMocks.fetchSnapshotMock.mockClear();
    resourceStreamMocks.isHealthy.mockReturnValue(true);

    await pollLeasedScopes('cluster-config', false);

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
    expect(getScopedDomainState('cluster-config', scope).queryReconcileVersion).toBeUndefined();
    expect(resourceStreamMocks.recordStreamFallback).not.toHaveBeenCalled();
    refreshOrchestrator.releaseScopedDomainLease('cluster-config', scope, { demand: 'query' });
  });

  it('uses resource stream refreshOnce for manual refreshes of resource-stream domains with an active stream', async () => {
    registerStreamingPodsDomain();
    const scope = testScope('cluster-a', 'namespace:team-a');
    markResourceStreamActive('pods', scope);
    resourceStreamMocks.isHealthy.mockReturnValue(true);

    await refreshOrchestrator.fetchScopedDomain('pods', scope, { intent: 'user' });

    expect(resourceStreamMocks.refreshOnce).toHaveBeenCalledWith(scope);
    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it('uses snapshots without opening a resource stream for query-backed typed table scopes', async () => {
    registerStreamingPodsDomain();
    const scope = testScope('cluster-a', 'namespace:all?limit=50&sort=name&sortDirection=asc');
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
          rows: [
            makePodSnapshotEntry({ clusterId: 'cluster-a', namespace: 'team-a', name: 'pod-a' }),
          ],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-query',
      notModified: false,
    });

    refreshOrchestrator.acquireScopedDomainLease('pods', scope);
    await refreshOrchestrator.fetchScopedDomain('pods', scope, { intent: 'user' });

    expect(resourceStreamMocks.start).not.toHaveBeenCalled();
    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'pods',
      expect.objectContaining({ scope, manual: false })
    );
    expect(getScopedDomainState('pods', scope).data?.rows).toHaveLength(1);
  });

  it('falls back to full snapshots for resource-stream domains when the stream is unhealthy', async () => {
    registerStreamingPodsDomain();
    const scope = testScope('cluster-a', 'namespace:team-a');
    markResourceStreamActive('pods', scope);
    resourceStreamMocks.isHealthy.mockReturnValue(false);

    setScopedDomainState('pods', scope, () => ({
      status: 'ready',
      data: makePodSnapshotPayload({
        clusterId: 'cluster-a',
        rows: [
          makePodSnapshotEntry({
            clusterId: 'cluster-a',
            namespace: 'team-a',
            name: 'pod-a',
            status: 'Running',
            cpuUsageMilli: 10,
            memoryUsageBytes: 20 * 1024 ** 2,
          }),
        ],
      }),
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
            makePodSnapshotEntry({
              clusterId: 'cluster-a',
              namespace: 'team-a',
              name: 'pod-a',
              status: 'Pending',
              cpuUsageMilli: 15,
              memoryUsageBytes: 25 * 1024 ** 2,
            }),
          ],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-pods',
      notModified: false,
    });

    await refreshOrchestrator.fetchScopedDomain('pods', scope, { intent: 'startup' });

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'pods',
      expect.objectContaining({ scope })
    );
    const nextPod = getScopedDomainState('pods', scope).data?.rows?.[0];
    expect(nextPod?.status).toBe('Pending');
    expect(nextPod?.cpuUsageMilli).toBe(15);

    resetAllScopedDomainStates('pods');
  });

  it.each(['workload:team-a:apps:v1:Deployment:web', 'node:node-1', 'namespace:all'])(
    'streams a leased pods %s window',
    async (tail) => {
      // An object panel's Pods tab leases a workload- or node-scoped window; a
      // window without its stream never refetches and its rows go stale.
      registerStreamingPodsDomain();

      const scope = testScope('cluster-a', tail);
      refreshOrchestrator.acquireScopedDomainLease('pods', scope);
      await Promise.resolve();

      expect(resourceStreamMocks.start).toHaveBeenCalledWith(scope);
    }
  );

  it('does not start passive streaming while auto-refresh is disabled', async () => {
    registerStreamingClusterConfigDomain();

    const scope = testScope('cluster-a', '');
    setAutoRefreshEnabled(false);
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scope);
    await Promise.resolve();

    expect(resourceStreamMocks.start).not.toHaveBeenCalled();
  });

  it('stops and resumes passive streaming when auto-refresh is toggled', async () => {
    registerStreamingClusterConfigDomain();

    const scope = testScope('cluster-a', '');
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scope);
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

  // The global pause freezes an open Logs tab: its stream stops without
  // clearing the buffer and starts again when auto-refresh returns.
  it('stops and resumes the container-logs stream when auto-refresh is toggled', async () => {
    containerLogsStreamMocks.start.mockClear();
    containerLogsStreamMocks.stop.mockClear();
    refreshOrchestrator.registerDomain({
      domain: 'container-logs',
      category: 'system',
      streaming: {
        snapshotless: true,
        start: (streamScope: string) => containerLogsStreamMocks.start(streamScope),
        stop: (streamScope: string, options?: { reset?: boolean }) =>
          containerLogsStreamMocks.stop(streamScope, options?.reset ?? false),
      },
    });
    const scope = testScope('cluster-a', 'team-a:/v1:Pod:web-0');
    refreshOrchestrator.acquireScopedDomainLease('container-logs', scope, {
      preserveState: true,
    });
    await Promise.resolve();
    expect(containerLogsStreamMocks.start).toHaveBeenCalledWith(scope);

    containerLogsStreamMocks.start.mockClear();
    setAutoRefreshEnabled(false);
    await Promise.resolve();
    expect(containerLogsStreamMocks.stop).toHaveBeenCalledWith(scope, false);

    setAutoRefreshEnabled(true);
    await Promise.resolve();
    expect(containerLogsStreamMocks.start).toHaveBeenCalledWith(scope);
  });

  it('restarts streaming when the active scope changes', async () => {
    const cleanup = vi.fn();
    catalogStreamMocks.start.mockImplementation((_scope) => cleanup);
    catalogStreamMocks.stop.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
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

    await refreshOrchestrator.acquireScopedDomainLease('catalog', 'cluster-a|scope=team-a');
    await Promise.resolve();
    expect(catalogStreamMocks.start).toHaveBeenCalledWith('cluster-a|scope=team-a');

    catalogStreamMocks.start.mockClear();
    catalogStreamMocks.stop.mockClear();
    cleanup.mockClear();

    // Switch scope by disabling the old one and enabling the new one.
    await refreshOrchestrator.releaseScopedDomainLease('catalog', 'cluster-a|scope=team-a');
    await refreshOrchestrator.acquireScopedDomainLease('catalog', 'cluster-a|scope=team-b');
    await Promise.resolve();

    expect(catalogStreamMocks.stop).toHaveBeenCalledWith('cluster-a|scope=team-a', true);
    expect(cleanup).toHaveBeenCalled();
    expect(catalogStreamMocks.start).toHaveBeenCalledWith('cluster-a|scope=team-b');
  });

  it('stops streaming when the scope is disabled', async () => {
    const cleanup = vi.fn();
    catalogStreamMocks.start.mockClear();
    catalogStreamMocks.stop.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
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

    await refreshOrchestrator.acquireScopedDomainLease('catalog', 'cluster-a|scope=team-a');
    await Promise.resolve();
    expect(catalogStreamMocks.start).toHaveBeenCalledWith('cluster-a|scope=team-a');

    cleanup.mockClear();
    catalogStreamMocks.start.mockClear();
    catalogStreamMocks.stop.mockClear();

    await refreshOrchestrator.releaseScopedDomainLease('catalog', 'cluster-a|scope=team-a');

    expect(catalogStreamMocks.stop).toHaveBeenCalledWith('cluster-a|scope=team-a', true);
    expect(cleanup).toHaveBeenCalled();
  });

  it('cleans up pending streaming promises and reports errors when cleanup fails', async () => {
    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      category: 'cluster',

      streaming: {
        start: (scope: string) => catalogStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => catalogStreamMocks.refreshOnce(scope),
      },
    });

    const streamingRegistration = requireValue(
      requireValue(
        orchestratorInternals.configs.get('catalog'),
        'expected test value in orchestrator.test.ts'
      ).streaming,
      'expected test value in orchestrator.test.ts'
    );
    const runtime = orchestratorInternals.coordinatorRuntime;
    const pendingCleanup = vi.fn(() => {
      throw new Error('pending failure');
    });
    let resolvePending: ((value: () => void) => void) | undefined;
    const pendingPromise = new Promise<() => void>((resolve) => {
      resolvePending = resolve;
    });
    runtime.beginStreamingStart('catalog', 'scope=test', pendingPromise);

    orchestratorInternals.stopStreamingScope('catalog', 'scope=test', streamingRegistration, true);
    resolvePending?.(pendingCleanup);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const activeCleanup = () => {
      throw new Error('cleanup failure');
    };
    const activeTask = Promise.resolve(activeCleanup);
    runtime.beginStreamingStart('catalog', 'scope=test', activeTask);
    runtime.finishStreamingStart('catalog', 'scope=test', activeTask, activeCleanup);
    orchestratorInternals.stopStreamingScope('catalog', 'scope=test', streamingRegistration, true);

    expect(pendingCleanup).toHaveBeenCalled();
    expect(errorHandlerMock.reportOperationalError.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.any(Error),
          expect.objectContaining({
            action: 'stopPendingStreamingDomain',
            domain: 'catalog',
            scope: 'scope=test',
          }),
        ],
        [
          expect.any(Error),
          expect.objectContaining({
            action: 'stopStreamingDomain',
            domain: 'catalog',
            scope: 'scope=test',
          }),
        ],
      ])
    );
    expect(runtime.isStreamingActive('catalog', 'scope=test')).toBe(false);
  });

  it('skips scheduling scoped streaming when domain is disabled', async () => {
    const streaming = {
      start: vi.fn(() => vi.fn()),
      stop: vi.fn(),
    };

    const scope = 'cluster-a|namespace:team-a';
    orchestratorInternals.getRuntimeForScope(scope).disableScopedDomain('namespace-events', scope);

    await orchestratorInternals.scheduleStreamingStart('namespace-events', scope, streaming);

    expect(streaming.start).not.toHaveBeenCalled();
  });

  it('starts and stops streaming managers for scoped domains', async () => {
    containerLogsStreamMocks.start.mockClear();
    containerLogsStreamMocks.stop.mockClear();
    eventStreamMocks.startNamespace.mockClear();
    eventStreamMocks.stopNamespace.mockClear();
    eventStreamMocks.refreshNamespace.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'container-logs',
      category: 'system',

      streaming: {
        start: (scope: string) => containerLogsStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          containerLogsStreamMocks.stop(scope, options?.reset ?? false),
      },
    });

    await refreshOrchestrator.acquireScopedDomainLease?.(
      'container-logs',
      'cluster-a|team-a:/v1:Pod:api'
    );
    expect(containerLogsStreamMocks.start).toHaveBeenCalledWith('cluster-a|team-a:/v1:Pod:api');

    // Without a one-shot callback, a one-shot refresh restarts the stream.
    containerLogsStreamMocks.start.mockClear();
    await refreshOrchestrator.refreshStreamingDomainOnce(
      'container-logs',
      'cluster-a|team-a:/v1:Pod:api'
    );
    expect(containerLogsStreamMocks.stop).toHaveBeenCalledWith(
      'cluster-a|team-a:/v1:Pod:api',
      false
    );
    expect(containerLogsStreamMocks.start).toHaveBeenCalledWith('cluster-a|team-a:/v1:Pod:api');

    await refreshOrchestrator.releaseScopedDomainLease?.(
      'container-logs',
      'cluster-a|team-a:/v1:Pod:api'
    );
    expect(containerLogsStreamMocks.stop).toHaveBeenCalledWith(
      'cluster-a|team-a:/v1:Pod:api',
      true
    );

    catalogStreamMocks.start.mockClear();
    catalogStreamMocks.stop.mockClear();
    catalogStreamMocks.refreshOnce.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      category: 'cluster',

      streaming: {
        start: (scope: string) => catalogStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => catalogStreamMocks.refreshOnce(scope),
      },
    });

    await refreshOrchestrator.acquireScopedDomainLease?.('catalog', 'cluster-a|limit=1000');
    expect(catalogStreamMocks.start).toHaveBeenCalledWith('cluster-a|limit=1000');

    await refreshOrchestrator.refreshStreamingDomainOnce('catalog', 'cluster-a|limit=1000');
    expect(catalogStreamMocks.refreshOnce).toHaveBeenCalledWith('cluster-a|limit=1000');

    await refreshOrchestrator.releaseScopedDomainLease?.('catalog', 'cluster-a|limit=1000');
    expect(catalogStreamMocks.stop).toHaveBeenCalledWith('cluster-a|limit=1000', true);

    // cluster-events is now a scoped domain (matching production config).
    eventStreamMocks.startCluster.mockClear();
    eventStreamMocks.stopCluster.mockClear();
    eventStreamMocks.refreshCluster.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'cluster-events',
      category: 'cluster',
      streaming: {
        start: (scope: string) => eventStreamMocks.startCluster(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopCluster(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => eventStreamMocks.refreshCluster(scope),
      },
    });

    await refreshOrchestrator.acquireScopedDomainLease?.('cluster-events', 'cluster-a|');
    expect(eventStreamMocks.startCluster).toHaveBeenCalledWith('cluster-a|');

    await refreshOrchestrator.refreshStreamingDomainOnce('cluster-events', 'cluster-a|');
    expect(eventStreamMocks.refreshCluster).toHaveBeenCalledWith('cluster-a|');

    await refreshOrchestrator.releaseScopedDomainLease?.('cluster-events', 'cluster-a|');
    expect(eventStreamMocks.stopCluster).toHaveBeenCalledWith('cluster-a|', true);
  });

  it('handles concurrent namespace streams without leaking state', async () => {
    containerLogsStreamMocks.start.mockClear();
    containerLogsStreamMocks.stop.mockClear();
    eventStreamMocks.startNamespace.mockClear();
    eventStreamMocks.stopNamespace.mockClear();
    eventStreamMocks.refreshNamespace?.mockClear?.();

    refreshOrchestrator.registerDomain({
      domain: 'container-logs',
      category: 'system',

      streaming: {
        start: (scope: string) => containerLogsStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          containerLogsStreamMocks.stop(scope, options?.reset ?? false),
      },
    });

    refreshOrchestrator.registerDomain({
      domain: 'namespace-events',
      category: 'namespace',

      streaming: {
        start: (scope: string) => eventStreamMocks.startNamespace(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopNamespace(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => eventStreamMocks.refreshNamespace(scope),
      },
    });

    await refreshOrchestrator.acquireScopedDomainLease?.(
      'container-logs',
      'cluster-a|team-a:/v1:Pod:api'
    );
    await refreshOrchestrator.acquireScopedDomainLease?.(
      'namespace-events',
      'cluster-a|namespace:team-a'
    );

    expect(containerLogsStreamMocks.start).toHaveBeenCalledWith('cluster-a|team-a:/v1:Pod:api');
    expect(eventStreamMocks.startNamespace).toHaveBeenCalledWith('cluster-a|namespace:team-a');

    await refreshOrchestrator.refreshStreamingDomainOnce(
      'namespace-events',
      'cluster-a|namespace:team-a'
    );
    expect(eventStreamMocks.refreshNamespace).toHaveBeenCalledWith('cluster-a|namespace:team-a');

    await refreshOrchestrator.releaseScopedDomainLease?.(
      'container-logs',
      'cluster-a|team-a:/v1:Pod:api'
    );
    await refreshOrchestrator.releaseScopedDomainLease?.(
      'namespace-events',
      'cluster-a|namespace:team-a'
    );

    expect(containerLogsStreamMocks.stop).toHaveBeenCalledWith(
      'cluster-a|team-a:/v1:Pod:api',
      true
    );
    expect(eventStreamMocks.stopNamespace).toHaveBeenCalledWith('cluster-a|namespace:team-a', true);
  });

  it('trims scoped streaming scopes when toggling enablement', async () => {
    const startSpy = vi.fn((_scope: string) => vi.fn());
    const stopSpy = vi.fn();

    refreshOrchestrator.registerDomain({
      domain: 'container-logs',
      category: 'system',

      streaming: {
        start: startSpy,
        stop: (scope: string, options?: { reset?: boolean }) =>
          stopSpy(scope, options?.reset ?? false),
      },
    });

    refreshOrchestrator.acquireScopedDomainLease(
      'container-logs',
      '  cluster-a|team-a:/v1:Pod:api  '
    );
    await Promise.resolve();
    expect(startSpy).toHaveBeenCalledWith('cluster-a|team-a:/v1:Pod:api');

    refreshOrchestrator.acquireScopedDomainLease('container-logs', 'cluster-a|team-a:/v1:Pod:api');
    expect(startSpy).toHaveBeenCalledTimes(1);

    refreshOrchestrator.releaseScopedDomainLease('container-logs', 'cluster-a|team-a:/v1:Pod:api');
    expect(stopSpy).not.toHaveBeenCalled();
    refreshOrchestrator.releaseScopedDomainLease('container-logs', 'cluster-a|team-a:/v1:Pod:api');
    expect(stopSpy).toHaveBeenCalledWith('cluster-a|team-a:/v1:Pod:api', true);
  });

  it('validates scoped domain enablement requires a non-empty scope', async () => {
    refreshOrchestrator.registerDomain({
      domain: 'namespace-events',
      category: 'namespace',

      streaming: {
        start: (scope: string) => eventStreamMocks.startNamespace(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopNamespace(scope, options?.reset ?? false),
      },
    });

    expect(() => refreshOrchestrator.acquireScopedDomainLease('namespace-events', '   ')).toThrow(
      'requires a non-empty scope value'
    );
  });

  it('preserves event stream state when toggling scoped enablement with preserveState', async () => {
    eventStreamMocks.startCluster.mockClear();
    eventStreamMocks.stopCluster.mockClear();

    refreshOrchestrator.registerDomain({
      domain: 'cluster-events',
      category: 'cluster',

      streaming: {
        start: (scope: string) => eventStreamMocks.startCluster(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          eventStreamMocks.stopCluster(scope, options?.reset ?? false),
      },
    });

    refreshOrchestrator.acquireScopedDomainLease('cluster-events', 'cluster-a|', {
      preserveState: true,
    });

    setScopedDomainState('cluster-events', 'cluster-a|', (previous) => ({
      ...previous,
      status: 'ready',
      data: makeClusterEventsSnapshotPayload({
        clusterId: 'cluster-a',
        rows: [
          {
            ref: {
              clusterId: 'cluster-a',
              group: '',
              version: 'v1',
              kind: 'Event',
              resource: 'events',
              namespace: 'default',
              name: 'existing',
              uid: 'existing-uid',
            },

            resourceVersion: '1',

            objectNamespace: 'default',
            objectUid: 'web-uid',
            type: 'Normal',
            source: 'kubelet',
            reason: 'Started',
            object: 'Pod/web',
            objectKind: 'Pod',
            objectName: 'web',
            message: 'still here',
            age: '1m',
            ageTimestamp: 1,
          },
        ],
      }),
      error: null,
      lastUpdated: 1,
      lastAutoRefresh: 1,
      isManual: false,
      scope: 'cluster-a|',
      stats: null,
    }));

    await refreshOrchestrator.releaseScopedDomainLease('cluster-events', 'cluster-a|', {
      preserveState: true,
    });
    expect(eventStreamMocks.stopCluster).toHaveBeenCalledWith('cluster-a|', false);
    expect(getScopedDomainState('cluster-events', 'cluster-a|').data?.rows).toHaveLength(1);

    await refreshOrchestrator.acquireScopedDomainLease('cluster-events', 'cluster-a|', {
      preserveState: true,
    });
    expect(eventStreamMocks.startCluster).toHaveBeenCalledWith('cluster-a|');

    const state = getScopedDomainState('cluster-events', 'cluster-a|');
    expect(state.status).toBe('updating');
    expect(state.data?.rows?.[0].message).toBe('still here');
  });

  it('resets state when streaming start fails', async () => {
    const startError = new Error('stream boom');

    containerLogsStreamMocks.start.mockRejectedValueOnce(startError);
    refreshOrchestrator.registerDomain({
      domain: 'container-logs',
      category: 'system',

      streaming: {
        start: (scope: string) => containerLogsStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          containerLogsStreamMocks.stop(scope, options?.reset ?? false),
      },
    });

    await refreshOrchestrator.acquireScopedDomainLease?.(
      'container-logs',
      'cluster-a|team-a:/v1:Pod:api'
    );
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(containerLogsStreamMocks.start).toHaveBeenCalledWith('cluster-a|team-a:/v1:Pod:api');
    expect(
      orchestratorInternals
        .getRuntimeForScope('cluster-a|team-a:/v1:Pod:api')
        .isStreamingActive('container-logs', 'cluster-a|team-a:/v1:Pod:api')
    ).toBe(false);
    const scopedState = getScopedDomainState('container-logs', 'cluster-a|team-a:/v1:Pod:api');
    expect(scopedState.status).toBe('error');
    expect(failureMessage(scopedState.error)).toContain('stream boom');
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      startError,
      expect.objectContaining({
        domain: 'container-logs',
        scope: 'cluster-a|team-a:/v1:Pod:api',
      }),
      'stream boom'
    );
  });

  it('starts framework named streams without a base URL bootstrap', async () => {
    refreshOrchestrator.registerDomain({
      domain: 'catalog',
      category: 'cluster',

      streaming: {
        start: (scope: string) => catalogStreamMocks.start(scope),
        stop: (scope: string, options?: { reset?: boolean }) =>
          catalogStreamMocks.stop(scope, options?.reset ?? false),
        refreshOnce: (scope: string) => catalogStreamMocks.refreshOnce(scope),
      },
    });

    refreshOrchestrator.acquireScopedDomainLease('catalog', 'cluster-a|limit=100');
    await Promise.resolve();
    await Promise.resolve();

    expect(catalogStreamMocks.start).toHaveBeenCalledWith('cluster-a|limit=100');
  });

  it('deduplicates identical refresh errors for streaming and snapshot domains', async () => {
    const scope = testScope('cluster-a');
    clientMocks.fetchSnapshotMock.mockRejectedValue(new Error('backend unavailable'));

    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      category: 'cluster',
    });
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scope);

    await pollLeasedScopes('cluster-config', false, new AbortController().signal);
    await pollLeasedScopes('cluster-config', true, new AbortController().signal);

    expect(errorHandlerMock.handle).toHaveBeenCalledTimes(1);
  });

  it('rejects resource stream refresh scopes without a cluster prefix', async () => {
    registerPodsDomain();
    const scope = 'namespace:default';

    await expect(
      refreshOrchestrator.fetchScopedDomain('pods', scope, { intent: 'startup' })
    ).rejects.toThrow('no cluster prefix');

    expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it.each(SNAPSHOT_REFRESH_DOMAINS)(
    'rejects unprefixed %s scopes before they can acquire a denial latch',
    async (domain) => {
      registerAllSnapshotDomains();
      const scope = 'namespace:default';
      expect(() => refreshOrchestrator.acquireScopedDomainLease(domain, scope)).toThrow(
        'no cluster prefix'
      );
      expect(() => refreshOrchestrator.acquireScopedDomainLease(domain, scope)).toThrow(
        'no cluster prefix'
      );
      await expect(
        refreshOrchestrator.fetchScopedDomain(domain, scope, { intent: 'user' })
      ).rejects.toThrow('no cluster prefix');
      expect(clientMocks.fetchSnapshotMock).not.toHaveBeenCalled();
      expect(isPermissionDenied(getScopedDomainState(domain, scope).error)).toBe(false);
    }
  );

  // A kubeconfig file or context name may contain a comma; the scope prefix is
  // one cluster id, so that cluster fetches like any other.
  it('fetches a cluster whose id contains a comma', async () => {
    registerPodsDomain();
    const clusterId = 'prod,eu.yaml:ctx';
    const scope = testScope(clusterId, 'namespace:default');
    eventBus.emit('cluster:lifecycle', { clusterId, state: 'ready' });
    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({
      snapshot: {
        domain: 'pods',
        scope,
        version: 1,
        checksum: 'etag-comma',
        generatedAt: Date.now(),
        sequence: 1,
        payload: { clusterId, rows: [] },
        stats: { itemCount: 0, buildDurationMs: 0 },
      },
      etag: 'etag-comma',
      notModified: false,
    });

    leaseRuntimeScope('pods', scope);
    await refreshOrchestrator.fetchScopedDomain('pods', scope, { intent: 'user' });

    expect(clientMocks.fetchSnapshotMock.mock.calls.map((call) => call[1]?.scope)).toEqual([scope]);
    expect(getScopedDomainState('pods', scope).status).toBe('ready');
    expect(orchestratorInternals.clusterRuntimes.has(clusterId)).toBe(true);
    expect(orchestratorInternals.coordinatorRuntime.getKnownScopes('pods')).toEqual([]);
  });

  it('removes runtime state for disconnected background clusters', () => {
    registerStreamingClusterConfigDomain();
    refreshOrchestrator.setConnectedClusters(['cluster-a', 'cluster-b']);

    const scopeA = testScope('cluster-a', '');
    const scopeB = testScope('cluster-b', '');
    leaseRuntimeScope('cluster-config', scopeA);
    leaseRuntimeScope('cluster-config', scopeB);
    markResourceStreamActive('cluster-config', scopeA);
    markResourceStreamActive('cluster-config', scopeB);
    setScopedDomainState('cluster-config', scopeB, (previous) => ({
      ...previous,
      status: 'ready',
      data: makeClusterConfigSnapshotPayload({ clusterId: 'cluster-b', rows: [] }),
      scope: scopeB,
    }));

    refreshOrchestrator.setConnectedClusters(['cluster-a']);

    expect(orchestratorInternals.clusterRuntimes.has('cluster-a')).toBe(true);
    expect(orchestratorInternals.clusterRuntimes.has('cluster-b')).toBe(false);
    expect(resourceStreamMocks.stop).toHaveBeenCalledWith(scopeB, { reset: true });
    expect(getScopedDomainState('cluster-config', scopeB).status).toBe('idle');
  });

  it('records resource stream drift in the owning cluster runtime', () => {
    registerStreamingClusterConfigDomain();
    const scope = testScope('cluster-a', '');
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

    expect(
      orchestratorInternals.clusterRuntimes
        .get('cluster-a')
        ?.isStreamingBlocked('cluster-config', scope)
    ).toBe(true);
    expect(
      orchestratorInternals.coordinatorRuntime.isStreamingBlocked('cluster-config', scope)
    ).toBe(false);
  });

  it('stops only the owning cluster stream when its identity contains the runtime key delimiter', async () => {
    const clusterId = 'config::blue';
    const scopeA = testScope(clusterId, '');
    const scopeB = testScope('cluster-b', '');
    const cleanupA = vi.fn();
    const cleanupB = vi.fn();
    eventBus.emit('cluster:lifecycle', { clusterId, state: 'ready' });
    registerStreamingClusterConfigDomain();
    clientMocks.fetchSnapshotMock.mockResolvedValue({ notModified: true });
    resourceStreamMocks.start.mockImplementation((scope: string) =>
      scope === scopeA ? cleanupA : cleanupB
    );
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scopeA);
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scopeB);
    await Promise.resolve();
    await Promise.resolve();

    eventBus.emit('cluster:auth:failed', { clusterId });

    expect(resourceStreamMocks.stop).toHaveBeenCalledWith(scopeA, { reset: false });
    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(cleanupB).not.toHaveBeenCalled();
    expect(resourceStreamMocks.stop).not.toHaveBeenCalledWith(scopeB, expect.anything());
  });

  it('clears cluster runtime transient state on auth failure and restarts after recovery', async () => {
    registerStreamingClusterConfigDomain();
    refreshOrchestrator.setConnectedClusters(['cluster-a', 'cluster-b']);

    const scopeA = testScope('cluster-a', '');
    const scopeB = testScope('cluster-b', '');
    leaseRuntimeScope('cluster-config', scopeA);
    leaseRuntimeScope('cluster-config', scopeB);

    const runtimeA = orchestratorInternals.getRuntimeForScope(scopeA);
    runtimeA.setStreamingReady('cluster-config', scopeA, Promise.resolve());
    runtimeA.beginStreamingStart('cluster-config', scopeA, Promise.resolve(undefined));
    runtimeA.cancelStreamingStart('cluster-config', scopeA);
    runtimeA.setInFlight({
      controller: new AbortController(),
      isManual: false,
      requestId: 1,
      contextVersion: 0,
      domain: 'cluster-config',
      scope: scopeA,
    });

    orchestratorInternals.handleClusterAuthFailed({ clusterId: 'cluster-a' });

    expect(runtimeA.getInFlight('cluster-config', scopeA)).toBeUndefined();
    expect(runtimeA.hasStreamingReady('cluster-config', scopeA)).toBe(false);
    expect(runtimeA.hasPendingStreaming('cluster-config', scopeA)).toBe(false);
    expect(runtimeA.isStreamingCancelled('cluster-config', scopeA)).toBe(false);

    resourceStreamMocks.start.mockClear();
    orchestratorInternals.handleClusterAuthFailed({ clusterId: 'cluster-b' });
    orchestratorInternals.handleClusterAuthRecovered({ clusterId: 'cluster-a' });
    await Promise.resolve();
    await Promise.resolve();
    expect(resourceStreamMocks.start).toHaveBeenCalledWith(scopeA);
    expect(resourceStreamMocks.start).not.toHaveBeenCalledWith(scopeB);

    resourceStreamMocks.start.mockClear();
    orchestratorInternals.handleClusterAuthRecovered({ clusterId: 'cluster-b' });
    await Promise.resolve();
    await Promise.resolve();
    expect(resourceStreamMocks.start).toHaveBeenCalledWith(scopeB);
  });

  it('keeps a healthy cluster refreshing when another cluster authentication fails', async () => {
    registerStreamingClusterConfigDomain();
    refreshOrchestrator.setConnectedClusters(['cluster-a', 'cluster-b']);

    const scopeA = testScope('cluster-a', '');
    const scopeB = testScope('cluster-b', '');
    leaseRuntimeScope('cluster-config', scopeA);
    leaseRuntimeScope('cluster-config', scopeB);
    markResourceStreamActive('cluster-config', scopeA);
    markResourceStreamActive('cluster-config', scopeB);

    const runtimeA = orchestratorInternals.getRuntimeForScope(scopeA);
    const runtimeB = orchestratorInternals.getRuntimeForScope(scopeB);
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    runtimeA.setInFlight({
      controller: controllerA,
      isManual: false,
      requestId: 1,
      contextVersion: 0,
      domain: 'cluster-config',
      scope: scopeA,
    });
    runtimeB.setInFlight({
      controller: controllerB,
      isManual: false,
      requestId: 2,
      contextVersion: 0,
      domain: 'cluster-config',
      scope: scopeB,
    });

    eventBus.emit('cluster:auth:failed', { clusterId: 'cluster-a' });

    expect(controllerA.signal.aborted).toBe(true);
    expect(controllerB.signal.aborted).toBe(false);
    expect(resourceStreamMocks.stop).toHaveBeenCalledWith(scopeA, { reset: false });
    expect(resourceStreamMocks.stop).not.toHaveBeenCalledWith(scopeB, expect.anything());
    expect(runtimeB.isStreamingActive('cluster-config', scopeB)).toBe(true);

    eventBus.emit('cluster:auth:recovered', { clusterId: 'cluster-a' });
  });

  it('keeps stream-health polling fallback isolated to the owning cluster scope', async () => {
    // Cluster A's healthy stream must not suppress the poll fallback for
    // cluster B's unhealthy stream, and cluster B's fallback fetch must not
    // touch cluster A's rows.
    registerStreamingPodsDomain();
    const scopeA = testScope('cluster-a', 'namespace:default');
    const scopeB = testScope('cluster-b', 'namespace:default');
    refreshOrchestrator.setConnectedClusters(['cluster-a', 'cluster-b']);
    markResourceStreamActive('pods', scopeA);
    markResourceStreamActive('pods', scopeB);
    // Cluster A's stream is healthy; cluster B's stream is not.
    resourceStreamMocks.isHealthy.mockImplementation((...args: unknown[]) => args[1] === scopeA);

    const podA = makePodSnapshotEntry({
      clusterId: 'cluster-a',
      namespace: 'default',
      name: 'pod-a',
      status: 'Running',
      cpuUsageMilli: 10,
      memoryUsageBytes: 20 * 1024 ** 2,
    });
    const podB = makePodSnapshotEntry({
      clusterId: 'cluster-b',
      namespace: 'default',
      name: 'pod-b',
      node: 'node-b',
      status: 'Running',
      cpuUsageMilli: 30,
      memoryUsageBytes: 40 * 1024 ** 2,
    });

    setScopedDomainState('pods', scopeA, () => ({
      status: 'ready',
      data: makePodSnapshotPayload({ clusterId: 'cluster-a', rows: [podA] }),
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: scopeA,
    }));
    setScopedDomainState('pods', scopeB, () => ({
      status: 'ready',
      data: makePodSnapshotPayload({ clusterId: 'cluster-b', rows: [podB] }),
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: scopeB,
    }));

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
              cpuUsageMilli: 35,
              memoryUsageBytes: 45 * 1024 ** 2,
            },
          ],
        },
        stats: { itemCount: 1, buildDurationMs: 0 },
      },
      etag: 'etag-pods-b',
      notModified: false,
    });

    await refreshOrchestrator.fetchScopedDomain('pods', scopeA, { intent: 'startup' });
    await refreshOrchestrator.fetchScopedDomain('pods', scopeB, { intent: 'startup' });

    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledTimes(1);
    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledWith(
      'pods',
      expect.objectContaining({ scope: scopeB })
    );
    expect(getScopedDomainState('pods', scopeA).data?.rows?.[0]).toBe(podA);
    const nextPodB = getScopedDomainState('pods', scopeB).data?.rows?.[0];
    expect(nextPodB?.status).toBe('Running');
    expect(nextPodB?.cpuUsageMilli).toBe(35);
    expect(nextPodB?.memoryUsageBytes).toBe(45 * 1024 ** 2);

    resetAllScopedDomainStates('pods');
  });

  it('keeps the normal pod snapshot path free of metrics errors', async () => {
    registerStreamingPodsDomain();
    const scope = testScope('cluster-a', 'namespace:default');
    markResourceStreamActive('pods', scope);
    // An unhealthy stream forces the poll fallback so the snapshot path runs.
    resourceStreamMocks.isHealthy.mockReturnValue(false);

    const existingPod = makePodSnapshotEntry({
      clusterId: 'cluster-a',
      namespace: 'default',
      name: 'pod-a',
      status: 'Running',
      cpuUsageMilli: 10,
      memoryUsageBytes: 20 * 1024 ** 2,
    });
    setScopedDomainState('pods', scope, () => ({
      status: 'ready',
      data: makePodSnapshotPayload({
        clusterId: 'cluster-a',
        rows: [existingPod],
      }),
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

    await refreshOrchestrator.fetchScopedDomain('pods', scope, { intent: 'startup' });

    const nextState = getScopedDomainState('pods', scope);
    expect(nextState.data?.rows?.[0]).toEqual(existingPod);
    expect(nextState.data).not.toHaveProperty('metrics');

    resetAllScopedDomainStates('pods');
  });

  it('never treats one-shot query scopes (`?` params) as streaming targets', () => {
    // Typed events queries use parameterized one-shot scopes on the SAME domain
    // as the singleton events change stream; treating them as streamable churned
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
    const scope = testScope('cluster-a');
    const teardownSpy = vi.spyOn(orchestratorInternals, 'teardownInFlight');
    const stopAllSpy = vi.spyOn(orchestratorInternals, 'stopAllStreaming');

    refreshOrchestrator.registerDomain({
      domain: 'cluster-config',
      category: 'cluster',
    });
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scope);

    setScopedDomainState('cluster-config', scope, () => ({
      status: 'ready',
      data: makeClusterConfigSnapshotPayload({
        clusterId: 'test-cluster',
        rows: [
          {
            details: 'cluster defaults',
            age: '5m',
            ref: {
              clusterId: 'test-cluster',
              group: 'storage.k8s.io',
              version: 'v1',
              kind: 'StorageClass',
              resource: 'storageclasses',
              namespace: '',
              name: 'settings',
              uid: '',
            },
          },
        ],
      }),
      stats: null,
      error: null,
      etag: '123',
      isManual: false,
      scope,
      droppedAutoRefreshes: 0,
    }));

    orchestratorInternals.getRuntimeForScope(scope).setInFlight({
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
      category: 'cluster',
    });
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scope);

    orchestratorInternals.handleKubeconfigChanging();
    expect(
      orchestratorInternals.getRuntimeForScope(scope).getKnownScopes('cluster-config')
    ).toEqual([]);

    orchestratorInternals.handleKubeconfigChanged();
    expect(
      orchestratorInternals.getRuntimeForScope(scope).getKnownScopes('cluster-config')
    ).toEqual([]);

    stopAllSpy.mockRestore();
    teardownSpy.mockRestore();
  });
  it('retries failed signal reconciliation while transport stays healthy', async () => {
    registerStreamingClusterConfigDomain();
    const scope = testScope('cluster-a', '');
    eventBus.emit('cluster:lifecycle', { clusterId: 'cluster-a', state: 'loading' });
    leaseRuntimeScope('cluster-config', scope);
    markResourceStreamActive('cluster-config', scope);
    resourceStreamMocks.isHealthy.mockReturnValue(true);
    setScopedDomainState('cluster-config', scope, (prev) => ({
      ...prev,
      status: 'ready',
      scope,
      data: { clusterId: 'cluster-a', rows: [] } as never,
    }));
    clientMocks.fetchSnapshotMock.mockRejectedValueOnce(
      new Error('server temporarily unavailable')
    );
    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, {
      intent: 'stream-signal',
    });
    expect(getScopedDomainState('cluster-config', scope).status).toBe('error');
    clientMocks.fetchSnapshotMock.mockResolvedValue({ notModified: true });
    for (let i = 0; i < 5; i++) {
      await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { intent: 'startup' });
    }
    expect(clientMocks.fetchSnapshotMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('one-shot reads fetch a snapshot even when the base stream is already active', async () => {
    registerStreamingClusterConfigDomain();
    const scope = testScope('cluster-a', '');
    eventBus.emit('cluster:lifecycle', { clusterId: 'cluster-a', state: 'loading' });
    leaseRuntimeScope('cluster-config', scope);
    markResourceStreamActive('cluster-config', scope);
    clientMocks.fetchSnapshotMock.mockResolvedValueOnce({ notModified: true });
    await requestRefreshDomainState({ domain: 'cluster-config', scope, reason: 'user' });
    expect(clientMocks.fetchSnapshotMock).toHaveBeenCalledOnce();
    expect(resourceStreamMocks.refreshOnce).not.toHaveBeenCalled();
  });

  it('coalesces signal page reads and waits for the trailing snapshot', async () => {
    registerStreamingClusterConfigDomain();
    eventBus.emit('cluster:lifecycle', { clusterId: 'cluster-a', state: 'loading' });
    const scope = testScope('cluster-a', '?limit=100');
    const calls: Array<{ signal: AbortSignal; resolve: (value: unknown) => void }> = [];
    clientMocks.fetchSnapshotMock.mockImplementation(
      (_domain: string, args: { signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          calls.push({ signal: args.signal, resolve });
          args.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        })
    );
    const first = requestRefreshDomainState({
      domain: 'cluster-config',
      scope,
      reason: 'foreground',
    });
    await vi.waitFor(() => expect(calls.length).toBe(1));
    let settled = false;
    const second = requestRefreshDomainState({
      domain: 'cluster-config',
      scope,
      reason: 'stream-signal',
    }).then((response) => {
      settled = true;
      return response;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const settledBeforeData = settled;
    calls[0].resolve({
      snapshot: {
        domain: 'cluster-config',
        scope,
        version: 1,
        sequence: 1,
        payload: { clusterId: 'cluster-a', rows: [], marker: 'old' },
        stats: {},
      },
    });
    await first;
    await vi.waitFor(() => expect(calls.length).toBe(2));
    calls[1].resolve({
      snapshot: {
        domain: 'cluster-config',
        scope,
        version: 2,
        sequence: 2,
        payload: { clusterId: 'cluster-a', rows: [], marker: 'new' },
        stats: {},
      },
    });
    const result = await second;
    expect(settledBeforeData).toBe(false);
    expect(calls[0].signal.aborted).toBe(false);
    expect(result.data?.data).toEqual(expect.objectContaining({ marker: 'new' }));
  });
  it('coalesces overlapping user page reads without aborting either owner', async () => {
    registerStreamingClusterConfigDomain();
    eventBus.emit('cluster:lifecycle', { clusterId: 'cluster-a', state: 'loading' });
    const scope = testScope('cluster-a', '?limit=100');
    const calls: Array<{ signal: AbortSignal; resolve: (value: unknown) => void }> = [];
    clientMocks.fetchSnapshotMock.mockImplementation(
      (_domain: string, args: { signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          calls.push({ signal: args.signal, resolve });
          args.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        })
    );
    const first = requestRefreshDomainState({ domain: 'cluster-config', scope, reason: 'user' });
    await vi.waitFor(() => expect(calls.length).toBe(1));
    let settled = false;
    const second = requestRefreshDomainState({
      domain: 'cluster-config',
      scope,
      reason: 'user',
    }).then((response) => {
      settled = true;
      return response;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const settledBeforeData = settled;
    calls[0].resolve({
      snapshot: {
        domain: 'cluster-config',
        scope,
        version: 1,
        sequence: 1,
        payload: { clusterId: 'cluster-a', rows: [], marker: 'old' },
        stats: {},
      },
    });
    await first;
    await vi.waitFor(() => expect(calls.length).toBe(2));
    calls[1].resolve({
      snapshot: {
        domain: 'cluster-config',
        scope,
        version: 2,
        sequence: 2,
        payload: { clusterId: 'cluster-a', rows: [], marker: 'new' },
        stats: {},
      },
    });
    const result = await second;
    expect(settledBeforeData).toBe(false);
    expect(calls[0].signal.aborted).toBe(false);
    expect(result.data?.data).toEqual(expect.objectContaining({ marker: 'new' }));
  });
});
