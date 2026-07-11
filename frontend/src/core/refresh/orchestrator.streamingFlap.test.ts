/**
 * Regression: the mount-time lease flap must not kill a streaming scope's
 * first start.
 *
 * Observed live (restricted-cluster, every first visit to a streaming view):
 * mount enables the scope and begins streaming.start; a transient disable
 * cancels the in-flight start; the immediate re-enable's own start attempt
 * early-returns because the doomed start is still pending; the doomed start
 * then arrives cancelled and died silently. Nothing owned the scope anymore,
 * so the view sat in 'initialising' until the fallback poller's first tick
 * (5–10s) — or forever for scopes without an active poller.
 *
 * Contract under test: a start that arrives cancelled while the scope is
 * ENABLED is an obsolete cancellation — the orchestrator must clean up the
 * doomed start and immediately restart streaming (the manager re-ensures the
 * lingering subscription), then run the initial reconciliation fetch. A start
 * that arrives cancelled while DISABLED still tears down, exactly once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchSnapshotMock } = vi.hoisted(() => ({
  fetchSnapshotMock: vi.fn(),
}));

vi.mock('./client', () => ({
  ensureRefreshBaseURL: () => Promise.resolve('http://127.0.0.1:0'),
  invalidateRefreshBaseURL: () => undefined,
  fetchSnapshot: (...args: unknown[]) => fetchSnapshotMock(...args),
  isSnapshotPermissionDenied: () => false,
  setMetricsActive: () => undefined,
}));

vi.mock('./RefreshManager', () => ({
  refreshManager: {
    subscribe: () => () => undefined,
    enable: () => undefined,
    disable: () => undefined,
    register: () => undefined,
    updateContext: () => undefined,
    triggerManualRefreshForContext: () => Promise.resolve(),
  },
}));

// Keep the singleton lean: no default domains, no stream-manager wiring.
vi.mock('./domainRegistrations', () => ({
  registerDefaultRefreshDomains: () => undefined,
}));

// The flap contract is view-independent: bypass the view-activity and
// auto-refresh gates so shouldStreamScope answers on scope shape alone.
vi.mock('./resourceStreamViews', () => ({
  isResourceStreamDomain: () => false,
  isResourceStreamViewActive: () => true,
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => true,
}));

vi.mock('@/core/logging/appLogsClient', () => ({
  APP_LOG_SOURCES: new Proxy({}, { get: (_t, key) => String(key) }),
  logAppLogsInfo: () => undefined,
  logAppLogsWarn: () => undefined,
  logAppLogsError: () => undefined,
}));

import { refreshOrchestrator } from './orchestrator';

const DOMAIN = 'namespace-storage' as const;
const SCOPE = 'flap-cluster:flap-cluster|namespace:flap-ns';

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

type StartResolver = (cleanup: () => void) => void;

describe('streaming start under the mount-time lease flap', () => {
  let startCalls: string[];
  let stopCalls: string[];
  let resolvers: StartResolver[];

  beforeEach(() => {
    startCalls = [];
    stopCalls = [];
    resolvers = [];
    fetchSnapshotMock.mockReset();
    fetchSnapshotMock.mockResolvedValue({
      snapshot: { data: { rows: [] }, sourceVersion: 'v1' },
      etag: 'v1',
      notModified: false,
    });
    refreshOrchestrator.registerDomain({
      domain: DOMAIN,
      refresherName: 'test-flap-refresher',
      category: 'namespace',
      streaming: {
        start: (scope: string) => {
          startCalls.push(scope);
          return new Promise<() => void>((resolve) => {
            resolvers.push(resolve);
          });
        },
        stop: (scope: string) => {
          stopCalls.push(scope);
        },
      },
    } as never);
  });

  afterEach(() => {
    refreshOrchestrator.setScopedDomainEnabled(DOMAIN, SCOPE, false);
  });

  it('restarts a cancelled in-flight start when the scope was re-enabled', async () => {
    refreshOrchestrator.setScopedDomainEnabled(DOMAIN, SCOPE, true);
    await flush();
    expect(startCalls).toHaveLength(1);

    // The flap: disable cancels the in-flight start; the immediate re-enable's
    // start attempt early-returns on the still-pending doomed start.
    refreshOrchestrator.setScopedDomainEnabled(DOMAIN, SCOPE, false);
    refreshOrchestrator.setScopedDomainEnabled(DOMAIN, SCOPE, true);
    await flush();
    expect(startCalls).toHaveLength(1);

    // The doomed start arrives cancelled while the scope is enabled: the
    // orchestrator must clean it up exactly once and start fresh.
    const doomedCleanup = vi.fn();
    resolvers[0](doomedCleanup);
    await flush();
    expect(doomedCleanup).toHaveBeenCalledTimes(1);
    expect(startCalls).toHaveLength(2);

    // The fresh start completes: streaming is active and the initial
    // reconciliation fetch runs so the scope leaves 'initialising' now, not
    // at the fallback poller's first tick.
    resolvers[1](() => undefined);
    await flush();
    expect(fetchSnapshotMock).toHaveBeenCalled();
    // fetchSnapshot(domain, options) — the scope rides in the options.
    const fetchedScopes = fetchSnapshotMock.mock.calls.map(
      (call) => (call[1] as { scope?: string } | undefined)?.scope
    );
    expect(fetchedScopes).toContain(SCOPE);
  });

  it('never snapshot-fetches a snapshotless (stream-only) domain on start', async () => {
    // container-logs regression: the domain has no snapshot endpoint (its
    // data flows through its own stream manager), so the initial
    // reconciliation fetch must skip it — the backend answers such fetches
    // with "unknown domain", surfaced to the user as an error toast.
    refreshOrchestrator.registerDomain({
      domain: DOMAIN,
      refresherName: 'test-flap-refresher',
      category: 'namespace',
      streaming: {
        snapshotless: true,
        start: (scope: string) => {
          startCalls.push(scope);
          return new Promise<() => void>((resolve) => {
            resolvers.push(resolve);
          });
        },
        stop: (scope: string) => {
          stopCalls.push(scope);
        },
      },
    } as never);

    refreshOrchestrator.setScopedDomainEnabled(DOMAIN, SCOPE, true);
    await flush();
    expect(startCalls).toHaveLength(1);
    resolvers[0](() => undefined);
    await flush();
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
  });

  it('tears a cancelled start down exactly once when the scope stays disabled', async () => {
    refreshOrchestrator.setScopedDomainEnabled(DOMAIN, SCOPE, true);
    await flush();
    expect(startCalls).toHaveLength(1);

    refreshOrchestrator.setScopedDomainEnabled(DOMAIN, SCOPE, false);
    const doomedCleanup = vi.fn();
    resolvers[0](doomedCleanup);
    await flush();

    // Both the start's own continuation and the stop's deferred block see the
    // doomed start; only one of them may release the subscription.
    expect(doomedCleanup).toHaveBeenCalledTimes(1);
    expect(startCalls).toHaveLength(1);
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
  });
});
