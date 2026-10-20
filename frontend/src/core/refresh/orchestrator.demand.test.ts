/**
 * frontend/src/core/refresh/orchestrator.demand.test.ts
 *
 * Demand contract of the refresh layer, driven through the real orchestrator,
 * runtimes, store, domain registrations, and stream managers. Only snapshot
 * reads and the named-stream sockets are faked (test-utils/refreshHarness).
 * Each test states what the backend is asked for: which scopes are read and
 * which stream subscriptions are open.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchSnapshotMock } = vi.hoisted(() => ({ fetchSnapshotMock: vi.fn() }));

vi.mock('./client', () => ({
  fetchSnapshot: (...args: unknown[]) => fetchSnapshotMock(...args),
  setMetricsActive: () => Promise.resolve(),
}));

vi.mock('@/core/logging/appLogsClient', () => ({
  APP_LOG_SOURCES: new Proxy({}, { get: (_target, key) => String(key) }),
  logAppLogsDebug: () => undefined,
  logAppLogsInfo: () => undefined,
  logAppLogsWarn: () => undefined,
  logAppLogsError: () => undefined,
}));

import {
  acquireRefreshDomainLease,
  releaseRefreshDomainLease,
  requestContextRefresh,
  requestRefreshDomain,
  resetRefreshDomain,
} from '@/core/data-access/dataAccess';
import { eventBus } from '@/core/events';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';
import { errorWithStatus, makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import {
  acknowledgeStream,
  activeStreamSubscriptions,
  flushRefreshWork,
  installFakeStreamSockets,
  markClusterReady,
  resetRefreshHarness,
  ringStream,
  setAutoRefresh,
  streamKey,
} from '@/test-utils/refreshHarness';
import { testScope } from '@/test-utils/refreshScope';
import { clusterReadiness } from './clusterReadiness';
import { refreshOrchestrator } from './orchestrator';
import { makeClusterEventsSnapshotPayload } from './refreshContractTestBuilders';
import { getScopedDomainState, setScopedDomainState } from './store';
import { resourceStreamManager } from './streaming/resourceStreamManager';
import type { RefreshDomain } from './types';

const yamlScope = (clusterId: string) => testScope(clusterId, 'default:apps/v1:Deployment:web');
const eventsScope = (clusterId: string) => testScope(clusterId, '');
const overviewScope = (clusterId: string) => testScope(clusterId, '');
const namespaceScope = (clusterId: string, namespace = 'team-a') =>
  testScope(clusterId, `namespace:${namespace}`);

const defaultPayload = (domain: RefreshDomain): unknown =>
  domain === 'cluster-events' ? makeClusterEventsSnapshotPayload() : {};

let snapshotVersion = 0;

const snapshotResponse = (domain: RefreshDomain, scope: string) => {
  snapshotVersion += 1;
  return {
    notModified: false,
    etag: `v${snapshotVersion}`,
    snapshot: {
      domain,
      scope,
      version: snapshotVersion,
      checksum: `c${snapshotVersion}`,
      generatedAt: Date.now(),
      sequence: snapshotVersion,
      payload: defaultPayload(domain),
      stats: { itemCount: 0, buildDurationMs: 0 },
    },
  };
};

const answerReads = () => {
  fetchSnapshotMock.mockImplementation(async (domain: RefreshDomain, options: { scope: string }) =>
    snapshotResponse(domain, options.scope)
  );
};

/** Scopes read since the last reset, in order. */
const reads = (domain?: RefreshDomain): string[] =>
  fetchSnapshotMock.mock.calls
    .filter(([calledDomain]) => !domain || calledDomain === domain)
    .map(([calledDomain, options]) => `${calledDomain} ${(options as { scope: string }).scope}`);

const readsOf = (domain: RefreshDomain, scope: string): number =>
  reads(domain).filter((entry) => entry === `${domain} ${scope}`).length;

const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await flushRefreshWork();
};

const settle = async () => {
  await flushRefreshWork();
  await vi.advanceTimersByTimeAsync(0);
  await flushRefreshWork();
};

beforeAll(() => {
  installFakeStreamSockets();
});

beforeEach(() => {
  vi.useFakeTimers();
  resetAppPreferencesCacheForTesting();
  setAppPreferencesForTesting({ autoRefreshEnabled: true });
  setAutoRefresh(true);
  fetchSnapshotMock.mockReset();
  answerReads();
});

afterEach(async () => {
  resetRefreshHarness();
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
});

describe('scheduled polling follows leases', () => {
  it('polls a leased snapshot scope at its contract interval and stops on release', async () => {
    markClusterReady('poll-a');
    const scope = yamlScope('poll-a');
    acquireRefreshDomainLease({ domain: 'object-yaml', scope });
    await settle();
    fetchSnapshotMock.mockClear();

    await advance(10_000);
    expect(readsOf('object-yaml', scope)).toBe(2);

    releaseRefreshDomainLease({ domain: 'object-yaml', scope });
    fetchSnapshotMock.mockClear();
    await advance(20_000);
    expect(readsOf('object-yaml', scope)).toBe(0);
  });

  it('polls the same domain in two clusters independently', async () => {
    markClusterReady('poll-b1');
    markClusterReady('poll-b2');
    const first = yamlScope('poll-b1');
    const second = yamlScope('poll-b2');
    acquireRefreshDomainLease({ domain: 'object-yaml', scope: first });
    acquireRefreshDomainLease({ domain: 'object-yaml', scope: second });
    await settle();

    releaseRefreshDomainLease({ domain: 'object-yaml', scope: first });
    fetchSnapshotMock.mockClear();
    await advance(10_000);

    expect(readsOf('object-yaml', first)).toBe(0);
    expect(readsOf('object-yaml', second)).toBe(2);
    releaseRefreshDomainLease({ domain: 'object-yaml', scope: second });
  });

  it('backs a failing poll off to a 60 s cap, waits while paused, and stops on release', async () => {
    markClusterReady('poll-fail');
    const scope = yamlScope('poll-fail');
    const readTimes: number[] = [];
    fetchSnapshotMock.mockReset();
    fetchSnapshotMock.mockImplementation(async () => {
      readTimes.push(Date.now());
      throw errorWithStatus(makeErrorStatus('InternalError'));
    });
    acquireRefreshDomainLease({ domain: 'object-yaml', scope });
    await settle();
    await advance(400_000);

    const gaps = readTimes.slice(1).map((time, index) => time - readTimes[index]);
    gaps.slice(1).forEach((gap, index) => {
      expect(gap).toBeGreaterThanOrEqual(gaps[index]);
    });
    // Polls land on the 5 s interval, so a capped retry waits at most one extra interval.
    expect(Math.max(...gaps)).toBeLessThanOrEqual(65_000);
    expect(gaps[gaps.length - 1]).toBeGreaterThanOrEqual(60_000);

    setAutoRefresh(false);
    readTimes.length = 0;
    await advance(130_000);
    expect(readTimes).toHaveLength(0);
    setAutoRefresh(true);
    await advance(5_000);
    expect(readTimes).toHaveLength(1);

    releaseRefreshDomainLease({ domain: 'object-yaml', scope });
    readTimes.length = 0;
    await advance(130_000);
    expect(readTimes).toHaveLength(0);
  });
});

describe('poll deadlines', () => {
  // A hung backend read: it settles only when its signal aborts.
  const stallReads = (readTimes: number[] = []) => {
    fetchSnapshotMock.mockReset();
    fetchSnapshotMock.mockImplementation(
      (_domain: RefreshDomain, options: { signal?: AbortSignal }) => {
        readTimes.push(Date.now());
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(options.signal?.reason));
        });
      }
    );
    return readTimes;
  };

  it('records a poll that outlives its deadline as a failure and backs it off', async () => {
    markClusterReady('stall-a');
    const scope = yamlScope('stall-a');
    const readTimes = stallReads();
    acquireRefreshDomainLease({ domain: 'object-yaml', scope });
    await settle();

    // The first poll starts at 5 s; its 10 s deadline expires at 15 s.
    await advance(15_000);
    expect(getScopedDomainState('object-yaml', scope)).toMatchObject({
      status: 'error',
      error: { kind: 'local', errorName: 'TimeoutError' },
    });

    await advance(400_000);
    const gaps = readTimes.slice(1).map((time, index) => time - readTimes[index]);
    expect(gaps[gaps.length - 1]).toBeGreaterThanOrEqual(60_000);
    releaseRefreshDomainLease({ domain: 'object-yaml', scope });
  });

  it('records nothing when a release cancels a stalled poll', async () => {
    markClusterReady('stall-b');
    const scope = yamlScope('stall-b');
    stallReads();
    acquireRefreshDomainLease({ domain: 'object-yaml', scope, preserveState: true });
    await settle();
    await advance(5_000);

    releaseRefreshDomainLease({ domain: 'object-yaml', scope, preserveState: true });
    await advance(20_000);

    expect(getScopedDomainState('object-yaml', scope).error).toBeNull();
  });

  // Activation cancels in-flight reads while their scopes stay leased; that is
  // the backend being re-warmed, not the read failing.
  it('records nothing when foreground activation cancels a stalled poll', async () => {
    markClusterReady('stall-c');
    const scope = yamlScope('stall-c');
    stallReads();
    acquireRefreshDomainLease({ domain: 'object-yaml', scope });
    await settle();
    await advance(5_000);

    clusterReadiness.beginForegroundActivation('stall-c');
    await advance(20_000);

    expect(getScopedDomainState('object-yaml', scope).error).toBeNull();
    clusterReadiness.endForegroundActivation('stall-c');
    releaseRefreshDomainLease({ domain: 'object-yaml', scope });
  });
});

describe('retained data', () => {
  it('keeps a preserved scope’s rows through release and paints them on re-acquire', async () => {
    markClusterReady('retain-a');
    const scope = eventsScope('retain-a');
    acquireRefreshDomainLease({ domain: 'cluster-events', scope, preserveState: true });
    await settle();
    acknowledgeStream('cluster-events', scope);
    await settle();
    const painted = getScopedDomainState('cluster-events', scope).data;
    expect(painted).toBeTruthy();

    releaseRefreshDomainLease({ domain: 'cluster-events', scope, preserveState: true });
    await settle();
    expect(getScopedDomainState('cluster-events', scope).data).toBe(painted);

    fetchSnapshotMock.mockClear();
    acquireRefreshDomainLease({ domain: 'cluster-events', scope, preserveState: true });
    expect(getScopedDomainState('cluster-events', scope).data).toBe(painted);
    releaseRefreshDomainLease({ domain: 'cluster-events', scope, preserveState: true });
  });
});

describe('resetting a leased scope', () => {
  it('keeps rows a holder still shows, then clears them on the last release', async () => {
    markClusterReady('reset-a');
    const scope = yamlScope('reset-a');
    acquireRefreshDomainLease({ domain: 'object-details', scope, preserveState: true });
    await requestRefreshDomain({ domain: 'object-details', scope, reason: 'startup' });
    await settle();
    expect(getScopedDomainState('object-details', scope).data).toBeTruthy();

    resetRefreshDomain('object-details', scope);
    expect(getScopedDomainState('object-details', scope).data).toBeTruthy();

    releaseRefreshDomainLease({ domain: 'object-details', scope, preserveState: true });
    await settle();
    expect(getScopedDomainState('object-details', scope).data).toBeNull();
  });
});

describe('streams replace polling while healthy', () => {
  it('polls a doorbell scope until its stream acknowledges, then stops polling', async () => {
    markClusterReady('stream-a');
    const scope = eventsScope('stream-a');
    acquireRefreshDomainLease({ domain: 'cluster-events', scope });
    await settle();
    expect(activeStreamSubscriptions()).toContain(streamKey('cluster-events', scope));

    acknowledgeStream('cluster-events', scope);
    await settle();
    expect(getScopedDomainState('cluster-events', scope).data).toBeTruthy();

    fetchSnapshotMock.mockClear();
    await advance(15_000);
    expect(readsOf('cluster-events', scope)).toBe(0);
    releaseRefreshDomainLease({ domain: 'cluster-events', scope });
  });

  it('keeps polling cluster-overview while its stream is healthy', async () => {
    markClusterReady('overview-poll');
    const scope = overviewScope('overview-poll');
    acquireRefreshDomainLease({ domain: 'cluster-overview', scope });
    await settle();
    acknowledgeStream('cluster-overview', scope);
    await settle();

    fetchSnapshotMock.mockClear();
    await advance(20_000);
    expect(readsOf('cluster-overview', scope)).toBeGreaterThanOrEqual(2);
    releaseRefreshDomainLease({ domain: 'cluster-overview', scope });
  });
});

describe('auto-refresh pause', () => {
  it('stops streams and polls but still serves foreground and user reads', async () => {
    markClusterReady('pause-a');
    const scope = eventsScope('pause-a');
    acquireRefreshDomainLease({ domain: 'cluster-events', scope });
    await settle();
    acknowledgeStream('cluster-events', scope);
    await settle();

    setAutoRefresh(false);
    await advance(30_000);
    expect(activeStreamSubscriptions()).not.toContain(streamKey('cluster-events', scope));

    fetchSnapshotMock.mockClear();
    await advance(30_000);
    expect(readsOf('cluster-events', scope)).toBe(0);

    await requestRefreshDomain({ domain: 'cluster-events', scope, reason: 'startup' });
    await requestRefreshDomain({ domain: 'cluster-events', scope, reason: 'stream-signal' });
    await settle();
    expect(readsOf('cluster-events', scope)).toBe(0);

    await requestRefreshDomain({ domain: 'cluster-events', scope, reason: 'foreground' });
    await settle();
    expect(readsOf('cluster-events', scope)).toBe(1);

    await requestRefreshDomain({ domain: 'cluster-events', scope, reason: 'user' });
    await settle();
    expect(readsOf('cluster-events', scope)).toBe(2);
    releaseRefreshDomainLease({ domain: 'cluster-events', scope });
  });
});

describe('settled permission denial', () => {
  it('stops automatic reads after a typed denial and lets the user ask again', async () => {
    markClusterReady('denied-a');
    const scope = yamlScope('denied-a');
    fetchSnapshotMock.mockRejectedValue(errorWithStatus(makeErrorStatus('Forbidden')));
    acquireRefreshDomainLease({ domain: 'object-yaml', scope });
    await requestRefreshDomain({ domain: 'object-yaml', scope, reason: 'startup' });
    await settle();
    expect(getScopedDomainState('object-yaml', scope).permissionDenied).toBe(true);

    fetchSnapshotMock.mockClear();
    await advance(30_000);
    expect(readsOf('object-yaml', scope)).toBe(0);

    await requestRefreshDomain({ domain: 'object-yaml', scope, reason: 'user' });
    await settle();
    expect(readsOf('object-yaml', scope)).toBe(1);
    releaseRefreshDomainLease({ domain: 'object-yaml', scope });
  });
});

describe('cluster readiness', () => {
  it('replays a read deferred for warm-up once the cluster serves, while leased', async () => {
    const scope = yamlScope('warm-a');
    acquireRefreshDomainLease({ domain: 'object-yaml', scope });
    await requestRefreshDomain({ domain: 'object-yaml', scope, reason: 'startup' });
    await settle();
    expect(readsOf('object-yaml', scope)).toBe(0);

    markClusterReady('warm-a');
    await settle();
    expect(readsOf('object-yaml', scope)).toBe(1);
    releaseRefreshDomainLease({ domain: 'object-yaml', scope });
  });

  it('drops a deferred read whose lease was released before the cluster served', async () => {
    const scope = yamlScope('warm-b');
    acquireRefreshDomainLease({ domain: 'object-yaml', scope });
    await requestRefreshDomain({ domain: 'object-yaml', scope, reason: 'startup' });
    releaseRefreshDomainLease({ domain: 'object-yaml', scope });

    markClusterReady('warm-b');
    await settle();
    expect(readsOf('object-yaml', scope)).toBe(0);
  });
});

describe('closing a cluster', () => {
  it('prunes the closed cluster’s leases, streams, polls, and retained data, and nothing else', async () => {
    markClusterReady('close-a');
    markClusterReady('close-b');
    const closed = eventsScope('close-a');
    const kept = eventsScope('close-b');
    const closedYaml = yamlScope('close-a');
    refreshOrchestrator.setConnectedClusters(['close-a', 'close-b']);
    acquireRefreshDomainLease({ domain: 'cluster-events', scope: closed, preserveState: true });
    acquireRefreshDomainLease({ domain: 'cluster-events', scope: kept, preserveState: true });
    acquireRefreshDomainLease({ domain: 'object-yaml', scope: closedYaml });
    await settle();
    acknowledgeStream('cluster-events', closed);
    acknowledgeStream('cluster-events', kept);
    await settle();
    expect(getScopedDomainState('cluster-events', closed).data).toBeTruthy();
    const keptData = getScopedDomainState('cluster-events', kept).data;
    expect(keptData).toBeTruthy();

    refreshOrchestrator.setConnectedClusters(['close-b']);
    await settle();
    expect(activeStreamSubscriptions()).not.toContain(streamKey('cluster-events', closed));
    expect(activeStreamSubscriptions()).toContain(streamKey('cluster-events', kept));
    expect(getScopedDomainState('cluster-events', closed).data).toBeNull();
    expect(getScopedDomainState('cluster-events', kept).data).toBe(keptData);

    fetchSnapshotMock.mockClear();
    await advance(10_000);
    expect(readsOf('cluster-events', closed)).toBe(0);
    expect(readsOf('object-yaml', closedYaml)).toBe(0);
    releaseRefreshDomainLease({ domain: 'cluster-events', scope: kept, preserveState: true });
  });
});

describe('closing every cluster', () => {
  // kubeconfig:changing fires only when the selection becomes empty
  // (kubeconfigSelection.ts), when every cluster view unmounts.
  it('tears down all refresh work, and a reopened cluster starts fresh', async () => {
    markClusterReady('all-a');
    const events = eventsScope('all-a');
    const yaml = yamlScope('all-a');
    acquireRefreshDomainLease({ domain: 'cluster-events', scope: events });
    acquireRefreshDomainLease({ domain: 'object-yaml', scope: yaml });
    await settle();
    acknowledgeStream('cluster-events', events);
    await settle();
    expect(activeStreamSubscriptions()).toContain(streamKey('cluster-events', events));
    expect(getScopedDomainState('cluster-events', events).data).toBeTruthy();

    eventBus.emit('kubeconfig:changing', '');
    await settle();
    expect(getScopedDomainState('cluster-events', events).data).toBeNull();
    releaseRefreshDomainLease({ domain: 'cluster-events', scope: events });
    releaseRefreshDomainLease({ domain: 'object-yaml', scope: yaml });
    expect(activeStreamSubscriptions()).not.toContain(streamKey('cluster-events', events));
    fetchSnapshotMock.mockClear();
    await advance(20_000);
    expect(reads()).toEqual([]);

    eventBus.emit('kubeconfig:changed', '');
    markClusterReady('all-a');
    acquireRefreshDomainLease({ domain: 'cluster-events', scope: events });
    await settle();
    expect(activeStreamSubscriptions()).toContain(streamKey('cluster-events', events));
    releaseRefreshDomainLease({ domain: 'cluster-events', scope: events });
  });
});

describe('failed reads under a healthy stream', () => {
  it('retries a failed signal read even though the stream stays healthy and quiet', async () => {
    markClusterReady('retry-a');
    const scope = eventsScope('retry-a');
    acquireRefreshDomainLease({ domain: 'cluster-events', scope });
    await settle();
    acknowledgeStream('cluster-events', scope);
    await settle();
    expect(getScopedDomainState('cluster-events', scope).data).toBeTruthy();

    let failNext = true;
    fetchSnapshotMock.mockReset();
    fetchSnapshotMock.mockImplementation(
      async (domain: RefreshDomain, options: { scope: string }) => {
        if (failNext) {
          failNext = false;
          throw errorWithStatus(makeErrorStatus('InternalError'));
        }
        return snapshotResponse(domain, options.scope);
      }
    );
    await requestRefreshDomain({ domain: 'cluster-events', scope, reason: 'stream-signal' });
    await settle();
    expect(readsOf('cluster-events', scope)).toBe(1);

    await advance(3_000);
    expect(readsOf('cluster-events', scope)).toBe(2);
    expect(getScopedDomainState('cluster-events', scope).error).toBeNull();
    releaseRefreshDomainLease({ domain: 'cluster-events', scope });
  });
});

describe('Overview cluster switch', () => {
  // Mirrors ClusterOverview: it leases the selected cluster's scope (the
  // previous cluster's lease is released) and asks for a foreground read. The
  // selection still reaches the refresh context while that copy exists.
  let shownOverview: string | null = null;
  const showOverviewFor = (clusterId: string) => {
    const scope = overviewScope(clusterId);
    if (shownOverview) {
      releaseRefreshDomainLease({
        domain: 'cluster-overview',
        scope: shownOverview,
        preserveState: true,
      });
    }
    shownOverview = scope;
    acquireRefreshDomainLease({ domain: 'cluster-overview', scope, preserveState: true });
    void requestRefreshDomain({ domain: 'cluster-overview', scope, reason: 'foreground' });
  };

  afterEach(() => {
    if (shownOverview) {
      releaseRefreshDomainLease({
        domain: 'cluster-overview',
        scope: shownOverview,
        preserveState: true,
      });
      shownOverview = null;
    }
  });

  it.each([
    { paused: false, retained: false },
    { paused: false, retained: true },
    { paused: true, retained: false },
    { paused: true, retained: true },
  ])(
    'reads the new cluster’s overview (paused=$paused, retained=$retained)',
    async ({ paused, retained }) => {
      const from = `ov-from-${paused}-${retained}`;
      const to = `ov-to-${paused}-${retained}`;
      markClusterReady(from);
      markClusterReady(to);
      showOverviewFor(from);
      await settle();
      if (retained) {
        setScopedDomainState('cluster-overview', overviewScope(to), (previous) => ({
          ...previous,
          status: 'ready',
          data: {} as never,
        }));
      }
      if (paused) {
        setAutoRefresh(false);
        await settle();
      }
      fetchSnapshotMock.mockClear();

      showOverviewFor(to);
      await settle();

      expect(readsOf('cluster-overview', overviewScope(to))).toBeGreaterThanOrEqual(1);
    }
  );
});

describe('hidden document', () => {
  it('stops passive polls while hidden and resumes them when shown', async () => {
    markClusterReady('hidden-a');
    const scope = yamlScope('hidden-a');
    acquireRefreshDomainLease({ domain: 'object-yaml', scope });
    await settle();

    eventBus.emit('app:visibility-hidden');
    fetchSnapshotMock.mockClear();
    await advance(20_000);
    expect(readsOf('object-yaml', scope)).toBe(0);

    await requestRefreshDomain({ domain: 'object-yaml', scope, reason: 'user' });
    await settle();
    expect(readsOf('object-yaml', scope)).toBe(1);

    eventBus.emit('app:visibility-visible');
    fetchSnapshotMock.mockClear();
    await advance(10_000);
    expect(readsOf('object-yaml', scope)).toBe(2);
    releaseRefreshDomainLease({ domain: 'object-yaml', scope });
  });

  // A window root publishes its visibility when it mounts, so a repeat of the
  // current state must not restart a poll that is already counting down.
  it('keeps a pending poll on schedule when told the visible window is visible', async () => {
    markClusterReady('hidden-b');
    const scope = yamlScope('hidden-b');
    acquireRefreshDomainLease({ domain: 'object-yaml', scope });
    await settle();
    fetchSnapshotMock.mockClear();

    await advance(4_000);
    eventBus.emit('app:visibility-visible');
    await advance(1_000);

    expect(readsOf('object-yaml', scope)).toBe(1);
    releaseRefreshDomainLease({ domain: 'object-yaml', scope });
  });
});

describe('manual refresh', () => {
  it('reads every leased scope of the named cluster and nothing in other clusters', async () => {
    markClusterReady('manual-a');
    markClusterReady('manual-b');
    const yamlA = yamlScope('manual-a');
    const eventsA = eventsScope('manual-a');
    const yamlB = yamlScope('manual-b');
    acquireRefreshDomainLease({ domain: 'object-yaml', scope: yamlA });
    acquireRefreshDomainLease({ domain: 'cluster-events', scope: eventsA });
    acquireRefreshDomainLease({ domain: 'object-yaml', scope: yamlB });
    await settle();
    fetchSnapshotMock.mockClear();

    await requestContextRefresh({ reason: 'user', clusterId: 'manual-a' });
    await settle();

    expect(readsOf('object-yaml', yamlA)).toBe(1);
    expect(readsOf('cluster-events', eventsA)).toBe(1);
    expect(readsOf('object-yaml', yamlB)).toBe(0);
    releaseRefreshDomainLease({ domain: 'object-yaml', scope: yamlA });
    releaseRefreshDomainLease({ domain: 'cluster-events', scope: eventsA });
    releaseRefreshDomainLease({ domain: 'object-yaml', scope: yamlB });
  });

  it('never asks for a container-logs snapshot, even paused or while the cluster warms up', async () => {
    const logs = testScope('manual-logs', 'default:/v1:Pod:web');
    acquireRefreshDomainLease({ domain: 'container-logs', scope: logs, preserveState: true });

    await requestContextRefresh({ reason: 'user', clusterId: 'manual-logs' });
    markClusterReady('manual-logs');
    await settle();
    setAutoRefresh(false);
    await requestContextRefresh({ reason: 'user', clusterId: 'manual-logs' });
    await settle();
    setAutoRefresh(true);
    await requestContextRefresh({ reason: 'user', clusterId: 'manual-logs' });
    await settle();

    expect(reads('container-logs')).toEqual([]);
    releaseRefreshDomainLease({ domain: 'container-logs', scope: logs, preserveState: true });
  });

  it('announces only manual refreshes as refreshing', async () => {
    markClusterReady('announce-a');
    const scope = yamlScope('announce-a');
    const starts: boolean[] = [];
    const completes: boolean[] = [];
    const offStart = eventBus.on('refresh:start', ({ isManual }) => starts.push(isManual));
    const offComplete = eventBus.on('refresh:complete', ({ isManual }) => completes.push(isManual));
    acquireRefreshDomainLease({ domain: 'object-yaml', scope });
    await advance(10_000);
    expect(starts).toEqual([]);

    await requestContextRefresh({ reason: 'user', clusterId: 'announce-a' });
    await settle();
    expect(starts).toEqual([true]);
    expect(completes).toEqual([true]);
    offStart();
    offComplete();
    releaseRefreshDomainLease({ domain: 'object-yaml', scope });
  });
});

describe('snapshotless domains', () => {
  it('never reads a snapshot for a stream-only domain from any path', async () => {
    markClusterReady('snapless-a');
    const logs = testScope('snapless-a', 'default:/v1:Pod:web');
    acquireRefreshDomainLease({ domain: 'container-logs', scope: logs, preserveState: true });
    await requestRefreshDomain({ domain: 'container-logs', scope: logs, reason: 'user' });
    await requestRefreshDomain({ domain: 'container-logs', scope: logs, reason: 'startup' });
    await advance(20_000);
    expect(reads('container-logs')).toEqual([]);
    releaseRefreshDomainLease({ domain: 'container-logs', scope: logs, preserveState: true });
  });
});

describe('request intent survives deferral', () => {
  it('runs a deferred foreground read while paused and holds deferred passive reads', async () => {
    const foregroundScope = yamlScope('defer-a');
    const passiveScope = testScope('defer-a', 'default:apps/v1:Deployment:other');
    acquireRefreshDomainLease({ domain: 'object-yaml', scope: foregroundScope });
    acquireRefreshDomainLease({ domain: 'object-yaml', scope: passiveScope });
    await requestRefreshDomain({
      domain: 'object-yaml',
      scope: foregroundScope,
      reason: 'foreground',
    });
    await requestRefreshDomain({ domain: 'object-yaml', scope: passiveScope, reason: 'startup' });
    setAutoRefresh(false);

    markClusterReady('defer-a');
    await settle();
    expect(readsOf('object-yaml', foregroundScope)).toBe(1);
    expect(readsOf('object-yaml', passiveScope)).toBe(0);

    setAutoRefresh(true);
    await advance(10_000);
    expect(readsOf('object-yaml', passiveScope)).toBeGreaterThanOrEqual(1);
    releaseRefreshDomainLease({ domain: 'object-yaml', scope: foregroundScope });
    releaseRefreshDomainLease({ domain: 'object-yaml', scope: passiveScope });
  });

  it('replays in-flight user reads after foreground activation and drops background polls', async () => {
    markClusterReady('activate-a');
    const polled = yamlScope('activate-a');
    const asked = testScope('activate-a', 'default:apps/v1:Deployment:asked');
    acquireRefreshDomainLease({ domain: 'object-yaml', scope: polled });
    acquireRefreshDomainLease({ domain: 'object-yaml', scope: asked });
    await settle();

    const hung = new Set<string>();
    fetchSnapshotMock.mockImplementation(
      (_domain: RefreshDomain, options: { scope: string; signal?: AbortSignal }) => {
        hung.add(options.scope);
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        });
      }
    );
    await advance(5_000);
    void requestRefreshDomain({ domain: 'object-yaml', scope: asked, reason: 'user' });
    await settle();
    expect(hung).toEqual(new Set([polled, asked]));

    clusterReadiness.beginForegroundActivation('activate-a');
    await settle();
    answerReads();
    fetchSnapshotMock.mockClear();
    clusterReadiness.endForegroundActivation('activate-a');
    await settle();

    expect(readsOf('object-yaml', asked)).toBe(1);
    expect(readsOf('object-yaml', polled)).toBe(0);
    releaseRefreshDomainLease({ domain: 'object-yaml', scope: polled });
    releaseRefreshDomainLease({ domain: 'object-yaml', scope: asked });
  });
});

// No test here publishes navigation: a lease alone must decide streaming, as
// it does in a native panel window.
describe('leases own streaming', () => {
  it('streams a leased resource table with no navigation published', async () => {
    markClusterReady('own-a');
    const scope = namespaceScope('own-a');
    acquireRefreshDomainLease({ domain: 'namespace-config', scope });
    await settle();

    expect(activeStreamSubscriptions()).toContain(streamKey('namespace-config', scope));
    releaseRefreshDomainLease({ domain: 'namespace-config', scope });
  });

  it.each(['snapshot', 'query'] as const)(
    'keeps the stream until the last %s lease is released',
    async (demand) => {
      markClusterReady(`own-b-${demand}`);
      const scope = namespaceScope(`own-b-${demand}`);
      acquireRefreshDomainLease({ domain: 'namespace-config', scope, demand });
      acquireRefreshDomainLease({ domain: 'namespace-config', scope, demand });
      await settle();

      releaseRefreshDomainLease({ domain: 'namespace-config', scope, demand });
      await advance(1_000);
      expect(activeStreamSubscriptions()).toContain(streamKey('namespace-config', scope));

      releaseRefreshDomainLease({ domain: 'namespace-config', scope, demand });
      await advance(1_000);
      expect(activeStreamSubscriptions()).not.toContain(streamKey('namespace-config', scope));
    }
  );

  it('never starts a stream for a read of an unleased scope', async () => {
    markClusterReady('own-c');
    const scope = eventsScope('own-c');
    await requestRefreshDomain({ domain: 'cluster-events', scope, reason: 'startup' });
    await refreshOrchestrator.fetchScopedDomain('cluster-events', scope, {
      intent: 'stream-signal',
    });
    await settle();

    expect(readsOf('cluster-events', scope)).toBeGreaterThan(0);
    expect(activeStreamSubscriptions()).not.toContain(streamKey('cluster-events', scope));
  });

  it('starts nothing before the cluster serves, then streams and reads once it does', async () => {
    const scope = namespaceScope('own-d');
    acquireRefreshDomainLease({ domain: 'namespace-config', scope });
    await settle();
    expect(activeStreamSubscriptions()).not.toContain(streamKey('namespace-config', scope));
    expect(readsOf('namespace-config', scope)).toBe(0);

    markClusterReady('own-d');
    await settle();
    expect(activeStreamSubscriptions()).toContain(streamKey('namespace-config', scope));
    acknowledgeStream('namespace-config', scope);
    await settle();
    expect(readsOf('namespace-config', scope)).toBe(1);
    releaseRefreshDomainLease({ domain: 'namespace-config', scope });
  });

  it('retries a failed stream start with backoff while leased, and stops on release', async () => {
    markClusterReady('own-e');
    const scope = namespaceScope('own-e');
    const start = vi.spyOn(resourceStreamManager, 'start').mockImplementation(() => {
      throw new Error('stream unavailable');
    });
    try {
      acquireRefreshDomainLease({ domain: 'namespace-config', scope });
      await settle();
      expect(start).toHaveBeenCalledTimes(1);

      // Retries wait 1 s, then 2 s.
      await advance(1_000);
      expect(start).toHaveBeenCalledTimes(2);
      await advance(1_000);
      expect(start).toHaveBeenCalledTimes(2);
      await advance(1_000);
      expect(start).toHaveBeenCalledTimes(3);

      start.mockRestore();
      await advance(4_000);
      expect(activeStreamSubscriptions()).toContain(streamKey('namespace-config', scope));

      releaseRefreshDomainLease({ domain: 'namespace-config', scope });
      const restarted = vi.spyOn(resourceStreamManager, 'start');
      await advance(60_000);
      expect(restarted).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('stops a released scope’s retries even while its start keeps failing', async () => {
    markClusterReady('own-e2');
    const scope = namespaceScope('own-e2');
    const start = vi.spyOn(resourceStreamManager, 'start').mockImplementation(() => {
      throw new Error('stream unavailable');
    });
    try {
      acquireRefreshDomainLease({ domain: 'namespace-config', scope });
      await settle();
      await advance(1_000);
      expect(start).toHaveBeenCalledTimes(2);

      releaseRefreshDomainLease({ domain: 'namespace-config', scope });
      start.mockClear();
      await advance(60_000);
      expect(start).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('stops streams while auto-refresh is off and restarts only leased scopes', async () => {
    markClusterReady('own-f');
    const leased = namespaceScope('own-f', 'team-a');
    const released = namespaceScope('own-f', 'team-b');
    acquireRefreshDomainLease({ domain: 'namespace-config', scope: leased });
    acquireRefreshDomainLease({ domain: 'namespace-config', scope: released });
    await settle();
    releaseRefreshDomainLease({ domain: 'namespace-config', scope: released });

    setAutoRefresh(false);
    await advance(1_000);
    expect(activeStreamSubscriptions()).toEqual([]);

    setAutoRefresh(true);
    await settle();
    expect(activeStreamSubscriptions()).toEqual([streamKey('namespace-config', leased)]);
    releaseRefreshDomainLease({ domain: 'namespace-config', scope: leased });
  });

  it('streams a panel metrics lease on namespace-workloads instead of polling it', async () => {
    markClusterReady('own-g');
    const scope = namespaceScope('own-g');
    acquireRefreshDomainLease({ domain: 'namespace-workloads', scope, preserveState: true });
    await settle();
    expect(activeStreamSubscriptions()).toContain(streamKey('namespace-workloads', scope));
    acknowledgeStream('namespace-workloads', scope);
    await settle();

    fetchSnapshotMock.mockClear();
    await advance(30_000);
    expect(readsOf('namespace-workloads', scope)).toBe(0);
    releaseRefreshDomainLease({ domain: 'namespace-workloads', scope, preserveState: true });
  });

  it('restarts a drift-blocked stream as soon as a selection change clears the block', async () => {
    markClusterReady('own-h');
    const scope = namespaceScope('own-h');
    acquireRefreshDomainLease({ domain: 'namespace-config', scope });
    await settle();
    expect(activeStreamSubscriptions()).toContain(streamKey('namespace-config', scope));

    eventBus.emit('refresh:resource-stream-drift', {
      domain: 'namespace-config',
      scope,
      reason: 'test drift',
      streamCount: 1,
      snapshotCount: 2,
      missingKeys: 1,
      extraKeys: 0,
    });
    await advance(1_000);
    expect(activeStreamSubscriptions()).not.toContain(streamKey('namespace-config', scope));

    eventBus.emit('kubeconfig:selection-changed');
    await settle();
    expect(activeStreamSubscriptions()).toContain(streamKey('namespace-config', scope));
    releaseRefreshDomainLease({ domain: 'namespace-config', scope });
  });
});

describe('leaving the namespace view', () => {
  it('keeps a retained namespace scope’s rows for the return visit', async () => {
    markClusterReady('leave-a');
    const scope = namespaceScope('leave-a');
    acquireRefreshDomainLease({ domain: 'namespace-config', scope, preserveState: true });
    await requestRefreshDomain({ domain: 'namespace-config', scope, reason: 'startup' });
    await settle();
    const painted = getScopedDomainState('namespace-config', scope).data;
    expect(painted).toBeTruthy();

    releaseRefreshDomainLease({ domain: 'namespace-config', scope, preserveState: true });
    await settle();

    acquireRefreshDomainLease({ domain: 'namespace-config', scope, preserveState: true });
    expect(getScopedDomainState('namespace-config', scope).data).toBe(painted);
    releaseRefreshDomainLease({ domain: 'namespace-config', scope, preserveState: true });
  });
});

describe('object events cadence', () => {
  it('polls an open Events tab every 3 s only while its doorbell is down', async () => {
    markClusterReady('events-cadence');
    const scope = testScope('events-cadence', 'team-a:apps/v1:Deployment:web');
    acquireRefreshDomainLease({ domain: 'object-events', scope, preserveState: true });
    await settle();
    fetchSnapshotMock.mockClear();
    await advance(6_500);
    expect(readsOf('object-events', scope)).toBe(2);

    acknowledgeStream('object-events', scope);
    await settle();
    fetchSnapshotMock.mockClear();
    await advance(30_000);
    expect(readsOf('object-events', scope)).toBe(0);
    releaseRefreshDomainLease({ domain: 'object-events', scope, preserveState: true });
  });
});

// Doorbells refetch snapshot leases in the orchestrator; no consumer hook.
describe('signal refetch follows snapshot leases', () => {
  const leaseHealthyEvents = async (
    clusterId: string,
    demand: 'snapshot' | 'query' = 'snapshot'
  ) => {
    markClusterReady(clusterId);
    const scope = eventsScope(clusterId);
    acquireRefreshDomainLease({ domain: 'cluster-events', scope, demand });
    await settle();
    acknowledgeStream('cluster-events', scope);
    await settle();
    fetchSnapshotMock.mockClear();
    return scope;
  };

  it('refetches a leased snapshot scope once per declared clock advance', async () => {
    const scope = await leaseHealthyEvents('signal-a');

    ringStream('cluster-events', scope, 'event', 'e1');
    await advance(500);
    expect(readsOf('cluster-events', scope)).toBe(1);

    // Applying that read's payload is not a signal, and neither is a repeat
    // of a clock value the scope already holds.
    ringStream('cluster-events', scope, 'event', 'e1');
    await advance(10_000);
    expect(readsOf('cluster-events', scope)).toBe(1);
    releaseRefreshDomainLease({ domain: 'cluster-events', scope });
  });

  it('reads once for a scope however many consumers lease it', async () => {
    const scope = await leaseHealthyEvents('signal-b');
    acquireRefreshDomainLease({ domain: 'cluster-events', scope });

    ringStream('cluster-events', scope, 'event', 'e1');
    await advance(500);
    expect(readsOf('cluster-events', scope)).toBe(1);
    releaseRefreshDomainLease({ domain: 'cluster-events', scope });
    releaseRefreshDomainLease({ domain: 'cluster-events', scope });
  });

  it('turns signals during an in-flight read into exactly one trailing read', async () => {
    const scope = await leaseHealthyEvents('signal-c');
    let finishFirst: () => void = () => undefined;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    fetchSnapshotMock.mockImplementationOnce(
      async (domain: RefreshDomain, options: { scope: string }) => {
        await first;
        return snapshotResponse(domain, options.scope);
      }
    );

    ringStream('cluster-events', scope, 'event', 'e1');
    await advance(500);
    ringStream('cluster-events', scope, 'event', 'e2');
    await advance(500);
    ringStream('cluster-events', scope, 'event', 'e3');
    await advance(500);
    expect(readsOf('cluster-events', scope)).toBe(1);

    finishFirst();
    await advance(500);
    expect(readsOf('cluster-events', scope)).toBe(2);
    releaseRefreshDomainLease({ domain: 'cluster-events', scope });
  });

  it('never reads the base snapshot for a query-only lease', async () => {
    const scope = await leaseHealthyEvents('signal-d', 'query');

    ringStream('cluster-events', scope, 'event', 'e1');
    await advance(500);
    expect(readsOf('cluster-events', scope)).toBe(0);
    releaseRefreshDomainLease({ domain: 'cluster-events', scope, demand: 'query' });
  });

  it('holds a signal latched before a pause and reconciles it once after resume', async () => {
    const scope = await leaseHealthyEvents('signal-e');
    let finishFirst: () => void = () => undefined;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    fetchSnapshotMock.mockImplementationOnce(
      async (domain: RefreshDomain, options: { scope: string }) => {
        await first;
        return snapshotResponse(domain, options.scope);
      }
    );
    ringStream('cluster-events', scope, 'event', 'e1');
    await advance(500);
    // Lands during the read, so it latches the one trailing read.
    ringStream('cluster-events', scope, 'event', 'e2');
    await advance(500);

    setAutoRefresh(false);
    finishFirst();
    await advance(10_000);
    expect(readsOf('cluster-events', scope)).toBe(1);

    setAutoRefresh(true);
    await settle();
    acknowledgeStream('cluster-events', scope);
    await settle();
    fetchSnapshotMock.mockClear();
    await advance(3_500);
    expect(readsOf('cluster-events', scope)).toBe(1);
    await advance(10_000);
    expect(readsOf('cluster-events', scope)).toBe(1);
    releaseRefreshDomainLease({ domain: 'cluster-events', scope });
  });
});
