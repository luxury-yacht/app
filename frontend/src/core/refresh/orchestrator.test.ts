/**
 * frontend/src/core/refresh/orchestrator.test.ts
 *
 * The refresh orchestrator's read, stream, and failure contracts, driven
 * through the real orchestrator, domain registrations, store, cluster
 * workspace store, and stream managers. Only the refresh HTTP API and the
 * named-stream sockets are faked (test-utils/appState). Each test states what
 * the backend is asked for (snapshot reads, stream subscriptions, manual
 * refresh jobs, metrics demand), what the scoped store holds, and what the
 * user is told. Lease and polling demand lives in orchestrator.demand.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clusterWorkspaceStore } from '@/core/cluster-workspace/clusterWorkspaceStore';
import { requestRefreshDomainState } from '@/core/data-access/dataAccess';
import { eventBus } from '@/core/events';
import { compareUtf16Strings } from '@/shared/utils/sort';
import {
  flushRefreshWork,
  installAppStateHarness,
  markClusterReady,
  setAutoRefresh,
} from '@/test-utils/appState/harness';
import {
  type SnapshotRequest,
  snapshotResponse,
  statusResponse,
  streamKey,
} from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { testScope } from '@/test-utils/refreshScope';
import { clusterReadiness } from './clusterReadiness';
import { refreshDomainContract } from './domainRegistry';
import { refreshOrchestrator } from './orchestrator';
import {
  makeCatalogSnapshotPayload,
  makeClusterAttentionSnapshot,
  makeClusterEventsSnapshotPayload,
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from './refreshContractTestBuilders';
import { failureMessage, isPermissionDenied } from './refreshFailure';
import { getRefreshState, getScopedDomainState, setScopedDomainState } from './store';
import { containerLogsStreamManager } from './streaming/containerLogsStreamManager';
import { resourceStreamManager } from './streaming/resourceStreamManager';
import { type DomainPayloadMap, REFRESH_DOMAINS, type RefreshDomain } from './types';

const SNAPSHOT_REFRESH_DOMAINS = REFRESH_DOMAINS.filter(
  (domain): domain is Exclude<RefreshDomain, 'container-logs'> => domain !== 'container-logs'
);

const app = installAppStateHarness({ streams: 'manual' });

// A canonical scope for any domain: its first authored scope-contract example.
const exampleScopeFor = (domain: RefreshDomain, clusterId: string): string =>
  testScope(clusterId, refreshDomainContract.domainInventory[domain].scopeContract.valid[0]);

const baseScope = (clusterId: string) => testScope(clusterId, '');
const yamlScope = (clusterId: string) => testScope(clusterId, 'default:apps/v1:Deployment:web');
const namespaceScope = (clusterId: string, namespace = 'team-a') =>
  testScope(clusterId, `namespace:${namespace}`);
const logsScope = (clusterId: string) => testScope(clusterId, 'team-a:/v1:Pod:web-0');

const yamlPayload = (
  clusterId: string,
  yaml = 'kind: Deployment'
): DomainPayloadMap['object-yaml'] => ({
  clusterId,
  clusterName: clusterId,
  yaml,
});

let snapshotVersion = 0;

/** A fresh snapshot version for every read, as a changing backend answers. */
const answerRead = ({ domain, scope }: SnapshotRequest) => {
  snapshotVersion += 1;
  return snapshotResponse({ domain, scope, version: snapshotVersion, payload: {}, itemCount: 0 });
};

const answerReads = () => {
  app.snapshots.respond(answerRead);
};

/** Reads only what the test serves; any other read fails the test. */
const serveOnly = () => {
  app.snapshots.respond(null);
};

/** A read the backend never answers; it settles only when the client aborts. */
const stalledRead = (signal: AbortSignal | null): Promise<Response> =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason));
  });

/**
 * A read the test answers later. Like fetch, it fails if the client aborts it
 * first (the fake server does not watch the signal).
 */
const heldRead = (signal: AbortSignal | null) => {
  let finish: (response: Response) => void = () => undefined;
  const response = new Promise<Response>((resolve, reject) => {
    finish = resolve;
    signal?.addEventListener('abort', () => reject(signal.reason));
  });
  return { response, finish: (answer: Response) => finish(answer) };
};

/** Lets a rung doorbell through the stream's signal coalescing. */
const afterSignal = () => advance(500);

const failWith = (reason: Parameters<typeof makeErrorStatus>[0], message: string) => () =>
  statusResponse(makeErrorStatus(reason, message));

const reads = (domain?: RefreshDomain): string[] =>
  app.snapshots.reads(domain).map((read) => `${read.domain} ${read.scope}`);

const readsOf = (domain: RefreshDomain, scope: string): number =>
  reads(domain).filter((entry) => entry === `${domain} ${scope}`).length;

const takeToasts = () => app.errors.take((record) => record.kinds.includes('toast'));

const sortedKeys = (...keys: string[]) => [...keys].sort(compareUtf16Strings);

const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await flushRefreshWork();
};

const settle = async () => {
  await flushRefreshWork();
  await vi.advanceTimersByTimeAsync(0);
  await flushRefreshWork();
};

/** Leases a streamed scope, lets its first read land, and acknowledges its stream. */
const leaseHealthy = async (domain: RefreshDomain, scope: string) => {
  refreshOrchestrator.acquireScopedDomainLease(domain, scope);
  await settle();
  app.streams.acknowledge(domain, scope);
  await settle();
};

/** The clusters each metrics-activity request named, in order. */
const recordMetricsDemand = ({ failFirst = false } = {}): string[][] => {
  const requested: string[][] = [];
  const harnessFetch = globalThis.fetch;
  let fail = failFirst;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith('/api/v2/metrics/active')) {
      requested.push((JSON.parse(String(init?.body)) as { clusterIds: string[] }).clusterIds);
      if (fail) {
        fail = false;
        return new Response(null, { status: 503, statusText: 'Refresh API unavailable' });
      }
    }
    return harnessFetch(input, init);
  }) as typeof fetch;
  return requested;
};

beforeEach(() => {
  vi.useFakeTimers();
  setAutoRefresh(true);
  answerReads();
});

afterEach(async () => {
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
});

describe('cluster readiness', () => {
  // The backend registers a cluster's services at the 'loading' transition;
  // until then every read would fail with "no active clusters available".
  it.each(['event', 'snapshot'] as const)(
    'holds a leased read until the cluster serves, by lifecycle %s',
    async (source) => {
      const clusterId = `warm-${source}`;
      const scope = yamlScope(clusterId);
      refreshOrchestrator.acquireScopedDomainLease('object-yaml', scope);
      if (source === 'event') {
        eventBus.emit('cluster:lifecycle', { clusterId, state: 'connecting' });
      }

      await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'startup' });
      await settle();
      expect(readsOf('object-yaml', scope)).toBe(0);

      if (source === 'event') {
        eventBus.emit('cluster:lifecycle', { clusterId, state: 'loading' });
      } else {
        await clusterWorkspaceStore.reconcileCommand(
          async () => ({
            state: {
              selectedKubeconfigs: [],
              visibleClusterId: clusterId,
              clusters: {
                [clusterId]: {
                  clusterId,
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
      await settle();

      expect(readsOf('object-yaml', scope)).toBe(1);
      expect(getScopedDomainState('object-yaml', scope).status).toBe('ready');
      refreshOrchestrator.releaseScopedDomainLease('object-yaml', scope);
    }
  );

  it('holds every snapshot domain at the shared foreground activation gate', async () => {
    const clusterId = 'gate-all';
    markClusterReady(clusterId);
    clusterReadiness.beginForegroundActivation(clusterId);
    SNAPSHOT_REFRESH_DOMAINS.forEach((domain) => {
      refreshOrchestrator.acquireScopedDomainLease(domain, exampleScopeFor(domain, clusterId));
    });

    await Promise.all(
      SNAPSHOT_REFRESH_DOMAINS.map((domain) =>
        refreshOrchestrator.fetchScopedDomain(domain, exampleScopeFor(domain, clusterId), {
          intent: 'startup',
        })
      )
    );
    await settle();
    expect(reads()).toEqual([]);

    clusterReadiness.endForegroundActivation(clusterId);
    await settle();

    expect(new Set(app.snapshots.reads().map((read) => read.domain))).toEqual(
      new Set(SNAPSHOT_REFRESH_DOMAINS)
    );
    SNAPSHOT_REFRESH_DOMAINS.forEach((domain) => {
      refreshOrchestrator.releaseScopedDomainLease(domain, exampleScopeFor(domain, clusterId));
    });
  });

  // Background polls are not replayed: the scheduler and the restarted
  // streams reconcile the cluster once it serves. Streamed domains are left
  // out because their restarted stream reads them by design.
  it('drops passive reads that arrive during foreground activation', async () => {
    const clusterId = 'gate-passive';
    const polledOnly = SNAPSHOT_REFRESH_DOMAINS.filter(
      (domain) => !refreshOrchestrator.isStreamingDomain(domain)
    );
    markClusterReady(clusterId);
    clusterReadiness.beginForegroundActivation(clusterId);
    polledOnly.forEach((domain) => {
      refreshOrchestrator.acquireScopedDomainLease(domain, exampleScopeFor(domain, clusterId));
    });

    await Promise.all(
      polledOnly.map((domain) =>
        refreshOrchestrator.fetchScopedDomain(domain, exampleScopeFor(domain, clusterId), {
          intent: 'background',
        })
      )
    );
    clusterReadiness.endForegroundActivation(clusterId);
    await settle();

    expect(reads()).toEqual([]);
    polledOnly.forEach((domain) => {
      refreshOrchestrator.releaseScopedDomainLease(domain, exampleScopeFor(domain, clusterId));
    });
  });

  it('keeps a user read manual while it waits for foreground activation', async () => {
    const clusterId = 'gate-user';
    const scope = yamlScope(clusterId);
    markClusterReady(clusterId);
    clusterReadiness.beginForegroundActivation(clusterId);
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', scope);

    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'user' });
    await settle();
    expect(readsOf('object-yaml', scope)).toBe(0);

    clusterReadiness.endForegroundActivation(clusterId);
    await settle();

    expect(readsOf('object-yaml', scope)).toBe(1);
    expect(app.snapshots.requests()).toContain('POST /api/v2/refresh/object-yaml');
    refreshOrchestrator.releaseScopedDomainLease('object-yaml', scope);
  });

  it("aborts only the activating cluster's in-flight reads", async () => {
    const scopeA = yamlScope('abort-a');
    const scopeB = yamlScope('abort-b');
    markClusterReady('abort-a');
    markClusterReady('abort-b');
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', scopeA);
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', scopeB);
    const signals = new Map<string, AbortSignal | null>();
    app.snapshots.respond(({ scope, signal }) => {
      signals.set(scope, signal);
      return stalledRead(signal);
    });

    void refreshOrchestrator.fetchScopedDomain('object-yaml', scopeA, { intent: 'startup' });
    void refreshOrchestrator.fetchScopedDomain('object-yaml', scopeB, { intent: 'startup' });
    await settle();
    expect(signals.size).toBe(2);

    clusterReadiness.beginForegroundActivation('abort-a');

    expect(signals.get(scopeA)?.aborted).toBe(true);
    expect(signals.get(scopeB)?.aborted).toBe(false);
    clusterReadiness.endForegroundActivation('abort-a');
  });

  // Close preflight holds the cluster's requests (cancelling its reads) before
  // the backend retires its producers; the cancelled read reports nothing and
  // the other cluster keeps serving.
  it('cancels a closing cluster’s read without a report and leaves the other cluster serving', async () => {
    const scope = yamlScope('closing');
    markClusterReady('closing');
    markClusterReady('retained');
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', scope);
    let signal: AbortSignal | null = null;
    app.snapshots.respond((request) => {
      signal = request.signal;
      return heldRead(request.signal).response;
    });

    const read = refreshOrchestrator.fetchScopedDomain('object-yaml', scope, {
      intent: 'startup',
    });
    await settle();
    const resume = clusterWorkspaceStore.holdClusterRequests('closing');
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(clusterReadiness.isServiceable('retained')).toBe(true);

    refreshOrchestrator.setConnectedClusters(['retained']);
    await read;
    resume();
    await settle();

    expect(app.errors.records()).toEqual([]);
    expect(getScopedDomainState('object-yaml', scope).status).not.toBe('error');
  });

  it('replays an in-flight stream signal read once foreground activation ends', async () => {
    const clusterId = 'signal-act';
    const scope = baseScope(clusterId);
    markClusterReady(clusterId);
    await leaseHealthy('cluster-config', scope);
    app.snapshots.clearReads();
    let hold = true;
    app.snapshots.respond((request) => {
      if (hold) {
        hold = false;
        return stalledRead(request.signal);
      }
      return answerRead(request);
    });

    app.streams.ring('cluster-config', scope, 'object', 'v1');
    await afterSignal();
    expect(readsOf('cluster-config', scope)).toBe(1);

    clusterReadiness.beginForegroundActivation(clusterId);
    await settle();
    clusterReadiness.endForegroundActivation(clusterId);
    await settle();

    expect(readsOf('cluster-config', scope)).toBe(2);
    refreshOrchestrator.releaseScopedDomainLease('cluster-config', scope);
  });

  it('starts a held log stream once foreground activation ends', async () => {
    const clusterId = 'logs-act';
    const scope = logsScope(clusterId);
    const startStream = vi.spyOn(containerLogsStreamManager, 'startStream');
    try {
      markClusterReady(clusterId);
      clusterReadiness.beginForegroundActivation(clusterId);
      refreshOrchestrator.acquireScopedDomainLease('container-logs', scope, {
        preserveState: true,
      });

      await refreshOrchestrator.restartStreamingDomain('container-logs', scope);
      await settle();
      expect(startStream).not.toHaveBeenCalled();

      clusterReadiness.endForegroundActivation(clusterId);
      await settle();

      expect(startStream.mock.calls).toEqual([[scope]]);
      expect(getScopedDomainState('container-logs', scope).data?.phase.status).not.toBe('stopping');
      refreshOrchestrator.releaseScopedDomainLease('container-logs', scope, {
        preserveState: true,
      });
    } finally {
      startStream.mockRestore();
    }
  });
});

describe('resetting a streamed scope', () => {
  // Closing an object panel resets its scopes after its Logs tab stopped with
  // its lines kept for a remount; the stream owner must drop them too, or a
  // reopened panel shows the old lines.
  it('resets the log stream owner when a scope nobody streams is reset', async () => {
    const scope = logsScope('reset-logs');
    markClusterReady('reset-logs');
    const stop = vi.spyOn(containerLogsStreamManager, 'stop');
    try {
      refreshOrchestrator.acquireScopedDomainLease('container-logs', scope, {
        preserveState: true,
      });
      await settle();
      refreshOrchestrator.releaseScopedDomainLease('container-logs', scope, {
        preserveState: true,
      });
      expect(getScopedDomainState('container-logs', scope).data?.phase.status).toBe('stopping');
      stop.mockClear();

      refreshOrchestrator.resetScopedDomain('container-logs', scope);

      expect(stop.mock.calls).toEqual([[scope, true]]);
      expect(getScopedDomainState('container-logs', scope).data).toBeNull();
    } finally {
      stop.mockRestore();
    }
  });

  it('leaves a streamed scope running when its state is reset while leased', async () => {
    const scope = logsScope('reset-live');
    markClusterReady('reset-live');
    refreshOrchestrator.acquireScopedDomainLease('container-logs', scope, {
      preserveState: true,
    });
    await settle();

    refreshOrchestrator.resetScopedDomain('container-logs', scope);
    await settle();

    expect(getScopedDomainState('container-logs', scope).data?.phase.status).not.toBe('stopping');
    refreshOrchestrator.releaseScopedDomainLease('container-logs', scope, {
      preserveState: true,
    });
  });
});

describe('permission denial', () => {
  it('keeps a denied scope settled: passive reads are skipped and it stays denied', async () => {
    const scope = yamlScope('deny-settled');
    markClusterReady('deny-settled');
    app.snapshots.respond(failWith('Forbidden', 'deny-settled: permission denied'));
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', scope);

    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'startup' });
    const denied = getScopedDomainState('object-yaml', scope);
    expect(denied).toMatchObject({ status: 'error', permissionDenied: true });
    expect(isPermissionDenied(denied.error)).toBe(true);

    // Background retries would flash the view through 'loading' every poll.
    app.snapshots.clearReads();
    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'startup' });
    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'background' });
    expect(readsOf('object-yaml', scope)).toBe(0);
    expect(getScopedDomainState('object-yaml', scope)).toMatchObject({
      status: 'error',
      permissionDenied: true,
    });

    // A manual refresh is a deliberate user action: it may re-ask.
    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'user' });
    expect(readsOf('object-yaml', scope)).toBe(1);
    refreshOrchestrator.releaseScopedDomainLease('object-yaml', scope);
  });

  // Starting the scope's stream resets it to initialising without an error.
  // The denial must outlive that: reads stay blocked, so a lost denial leaves
  // the view loading forever (the restricted namespaces sidebar).
  it('keeps a denied scope denied when its stream starts', async () => {
    const scope = baseScope('deny-stream');
    markClusterReady('deny-stream');
    setAutoRefresh(false);
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scope);
    app.snapshots.respond(failWith('Forbidden', 'deny-stream: permission denied'));
    await refreshOrchestrator.fetchScopedDomain('cluster-config', scope, { intent: 'user' });
    expect(getScopedDomainState('cluster-config', scope).permissionDenied).toBe(true);

    setAutoRefresh(true);
    await settle();

    expect(app.streams.active()).toContain(streamKey('cluster-config', scope));
    expect(getScopedDomainState('cluster-config', scope).permissionDenied).toBe(true);
    expect(readsOf('cluster-config', scope)).toBe(1);
    refreshOrchestrator.releaseScopedDomainLease('cluster-config', scope);
  });

  it('re-asks a denied scope after its cluster recovers from an auth failure', async () => {
    const clusterId = 'deny-auth';
    const scope = yamlScope(clusterId);
    markClusterReady(clusterId);
    app.snapshots.respond(failWith('Forbidden', 'deny-auth: permission denied'));
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', scope);
    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'startup' });
    expect(isPermissionDenied(getScopedDomainState('object-yaml', scope).error)).toBe(true);

    eventBus.emit('cluster:auth:failed', { clusterId });
    eventBus.emit('cluster:auth:recovered', { clusterId });
    await settle();
    answerReads();
    app.snapshots.clearReads();
    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'startup' });

    expect(readsOf('object-yaml', scope)).toBe(1);
    refreshOrchestrator.releaseScopedDomainLease('object-yaml', scope);
  });

  it.each(['cluster:scope-changed', 'cluster:permissions-changed'] as const)(
    'clears denials only in the cluster named by %s and leaves other clusters\u2019 reads alone',
    async (event) => {
      const changed = `${event}-a`;
      const other = `${event}-b`;
      const scopeA = yamlScope(changed);
      const scopeB = yamlScope(other);
      markClusterReady(changed);
      markClusterReady(other);
      refreshOrchestrator.acquireScopedDomainLease('object-yaml', scopeA);
      refreshOrchestrator.acquireScopedDomainLease('object-yaml', scopeB);
      app.snapshots.respond(failWith('Forbidden', `${event}: permission denied`));
      await refreshOrchestrator.fetchScopedDomain('object-yaml', scopeA, { intent: 'startup' });
      await refreshOrchestrator.fetchScopedDomain('object-yaml', scopeB, { intent: 'startup' });

      // The other cluster's user re-ask is in flight when the access change lands.
      let finishB: (response: Response) => void = () => undefined;
      let signalB: AbortSignal | null = null;
      app.snapshots.respond(({ signal }) => {
        signalB = signal;
        const held = heldRead(signal);
        finishB = held.finish;
        return held.response;
      });
      const readB = refreshOrchestrator.fetchScopedDomain('object-yaml', scopeB, {
        intent: 'user',
      });
      await settle();

      eventBus.emit(event, { clusterId: changed });

      expect(getScopedDomainState('object-yaml', scopeA).permissionDenied).not.toBe(true);
      expect(getScopedDomainState('object-yaml', scopeB).permissionDenied).toBe(true);
      expect((signalB as AbortSignal | null)?.aborted).toBe(false);
      // The other cluster's read still commits: its work was not invalidated.
      finishB(
        snapshotResponse({
          domain: 'object-yaml',
          scope: scopeB,
          version: 1,
          payload: yamlPayload(other, 'allowed now'),
        })
      );
      await readB;
      expect(getScopedDomainState('object-yaml', scopeB).data).toEqual(
        yamlPayload(other, 'allowed now')
      );
      refreshOrchestrator.releaseScopedDomainLease('object-yaml', scopeA);
      refreshOrchestrator.releaseScopedDomainLease('object-yaml', scopeB);
    }
  );
});

describe('reads while another read is in flight', () => {
  // Signals can arrive faster than a round trip: dropping them loses the
  // update, and aborting the read in flight starves the scope. One trailing
  // read follows the read in flight, and its newer snapshot wins.
  it('latches one trailing read behind an in-flight signal read and applies the newest snapshot', async () => {
    const clusterId = 'trail-a';
    const scope = baseScope(clusterId);
    markClusterReady(clusterId);
    await leaseHealthy('cluster-config', scope);
    app.snapshots.clearReads();
    let finishFirst: () => void = () => undefined;
    let firstSignal: AbortSignal | null = null;
    let readCount = 0;
    app.snapshots.respond(({ domain, scope: readScope, signal }) => {
      readCount += 1;
      const response = snapshotResponse({
        domain,
        scope: readScope,
        version: 100 + readCount,
        payload: {},
      });
      if (readCount > 1) {
        return response;
      }
      firstSignal = signal;
      const held = heldRead(signal);
      finishFirst = () => held.finish(response);
      return held.response;
    });

    app.streams.ring('cluster-config', scope, 'object', 'v1');
    await afterSignal();
    app.streams.ring('cluster-config', scope, 'object', 'v2');
    await afterSignal();
    app.streams.ring('cluster-config', scope, 'object', 'v3');
    await afterSignal();
    expect(readsOf('cluster-config', scope)).toBe(1);
    expect((firstSignal as AbortSignal | null)?.aborted).toBe(false);

    finishFirst();
    await afterSignal();

    expect(readsOf('cluster-config', scope)).toBe(2);
    expect(getScopedDomainState('cluster-config', scope).version).toBe(102);
    refreshOrchestrator.releaseScopedDomainLease('cluster-config', scope);
  });

  // Typed table pages share one read per scope: a second page request waits
  // for the read in flight and then for its one trailing read, so it returns
  // rows newer than its request without aborting the first requester.
  it.each([
    { first: 'foreground', second: 'stream-signal' },
    { first: 'user', second: 'user' },
  ] as const)(
    'coalesces a $second page read behind an in-flight $first read',
    async ({ first, second }) => {
      const clusterId = `page-${first}-${second}`;
      const scope = testScope(clusterId, '?limit=100');
      markClusterReady(clusterId);
      const pending: Array<{ signal: AbortSignal | null; finish: (version: number) => void }> = [];
      app.snapshots.respond(({ domain, scope: readScope, signal }) => {
        const held = heldRead(signal);
        pending.push({
          signal,
          finish: (version) =>
            held.finish(
              snapshotResponse({
                domain,
                scope: readScope,
                version,
                payload: { clusterId, marker: `page-${version}` },
              })
            ),
        });
        return held.response;
      });

      const firstRead = requestRefreshDomainState({
        domain: 'cluster-config',
        scope,
        reason: first,
      });
      await settle();
      expect(pending).toHaveLength(1);
      let settled = false;
      const secondRead = requestRefreshDomainState({
        domain: 'cluster-config',
        scope,
        reason: second,
      }).then((answered) => {
        settled = true;
        return answered;
      });
      await settle();
      expect(settled).toBe(false);

      pending[0].finish(1);
      await firstRead;
      await settle();
      expect(pending).toHaveLength(2);
      expect(settled).toBe(false);
      pending[1].finish(2);
      const result = await secondRead;

      expect(pending[0].signal?.aborted).toBe(false);
      expect(result.data?.data).toEqual(expect.objectContaining({ marker: 'page-2' }));
    }
  );
});

describe('manual refresh', () => {
  it('applies a manual read as a manual update with its ETag', async () => {
    const clusterId = 'manual-apply';
    const scope = yamlScope(clusterId);
    markClusterReady(clusterId);
    const payload = yamlPayload(clusterId, 'kind: StorageClass');
    const answer = () =>
      snapshotResponse({ domain: 'object-yaml', scope, version: 7, payload, itemCount: 1 });
    app.snapshots.respond(answer);
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', scope);

    await refreshOrchestrator.refreshCluster(clusterId);

    expect(app.snapshots.requests()).toContain('POST /api/v2/refresh/object-yaml');
    expect(getScopedDomainState('object-yaml', scope)).toMatchObject({
      status: 'ready',
      data: payload,
      etag: answer().headers.get('ETag'),
      isManual: true,
    });
    expect(getRefreshState().pendingRequests).toBe(0);
    refreshOrchestrator.releaseScopedDomainLease('object-yaml', scope);
  });

  it('keeps the applied snapshot when the backend answers not-modified', async () => {
    const clusterId = 'not-modified';
    const scope = yamlScope(clusterId);
    markClusterReady(clusterId);
    serveOnly();
    app.snapshots.serve('object-yaml', scope, yamlPayload(clusterId, 'kind: Gold'));
    const conditional: Array<string | null> = [];
    app.snapshots.respond(({ headers }) => {
      conditional.push(headers.get('If-None-Match'));
      return undefined;
    });
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', scope);
    await refreshOrchestrator.refreshCluster(clusterId);
    const applied = getScopedDomainState('object-yaml', scope);

    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'background' });

    // A manual read skips the conditional header; a passive one sends the ETag.
    expect(conditional).toEqual([null, applied.etag]);
    const state = getScopedDomainState('object-yaml', scope);
    expect(state.status).toBe('ready');
    expect(state.data).toBe(applied.data);
    expect(state.isManual).toBe(false);
    expect(getRefreshState().pendingRequests).toBe(0);
    refreshOrchestrator.releaseScopedDomainLease('object-yaml', scope);
  });

  // Polling-list payloads merge onto the rows already shown (snapshotMerge.ts):
  // an unchanged row keeps its object, so its table row does not re-render,
  // and a merge never keeps a row the new snapshot changed.
  it('applies the changed rows of every merged polling list and keeps the unchanged ones', async () => {
    const clusterId = 'merge-a';
    markClusterReady(clusterId);
    serveOnly();
    const namespace = (name: string, phase: string) => ({
      ref: {
        clusterId,
        group: '',
        version: 'v1',
        kind: 'Namespace',
        resource: 'namespaces',
        namespace: '',
        name,
        uid: `${clusterId}/${name}`,
      },
      phase,
      resourceVersion: '1',
      creationTimestamp: 100,
      hasWorkloads: false,
      warningEventsState: 'available' as const,
      quotaPressureState: 'available' as const,
    });
    const drain = (id: string, status: 'running' | 'failed' | 'succeeded') => ({
      clusterId,
      id,
      nodeName: `node-${id}`,
      status,
      startedAt: 1000,
      options: {
        gracePeriodSeconds: 30,
        ignoreDaemonSets: true,
        deleteEmptyDirData: false,
        force: false,
        disableEviction: false,
        skipWaitForPodsToTerminate: false,
      },
      events: [{ id: `evt-${id}`, timestamp: 1000, kind: 'info' as const, message: 'Draining' }],
    });
    const catalogItem = (name: string, resourceVersion: string) => ({
      ref: {
        clusterId,
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        resource: 'deployments',
        namespace: 'default',
        name,
        uid: `uid-${name}`,
      },
      resourceVersion,
      creationTimestamp: '2024-01-01T00:00:00Z',
      scope: 'Namespace' as const,
    });
    // Serves `first`, reads it, serves `second`, reads again: what a scope
    // holds before and after its next poll.
    const readTwice = async <D extends RefreshDomain>(
      domain: D,
      scope: string,
      first: DomainPayloadMap[D],
      second: DomainPayloadMap[D]
    ) => {
      app.snapshots.serve(domain, scope, first);
      refreshOrchestrator.acquireScopedDomainLease(domain, scope);
      await refreshOrchestrator.fetchScopedDomain(domain, scope, { intent: 'user' });
      await settle();
      const before = getScopedDomainState(domain, scope).data as DomainPayloadMap[D];
      app.snapshots.serve(domain, scope, second);
      await refreshOrchestrator.fetchScopedDomain(domain, scope, { intent: 'user' });
      await settle();
      const after = getScopedDomainState(domain, scope).data as DomainPayloadMap[D];
      refreshOrchestrator.releaseScopedDomainLease(domain, scope);
      return { before, after };
    };

    const namespaces = {
      clusterId,
      clusterName: clusterId,
      namespaces: [namespace('alpha', 'Active'), namespace('beta', 'Terminating')],
    };
    const namespacePolls = await readTwice(
      'namespaces',
      baseScope(clusterId),
      {
        clusterId,
        clusterName: clusterId,
        namespaces: [namespace('alpha', 'Active'), namespace('beta', 'Active')],
      },
      namespaces
    );
    expect(namespacePolls.after).toEqual(namespaces);
    expect(namespacePolls.after.namespaces?.[0]).toBe(namespacePolls.before.namespaces?.[0]);
    expect(namespacePolls.after.namespaces?.[1]).not.toBe(namespacePolls.before.namespaces?.[1]);

    const drains = { clusterId, drains: [drain('1', 'running'), drain('2', 'succeeded')] };
    const drainPolls = await readTwice(
      'object-maintenance',
      testScope(clusterId, 'node:node-a'),
      { clusterId, drains: [drain('1', 'running'), drain('2', 'failed')] },
      drains
    );
    expect(drainPolls.after).toEqual(drains);
    expect(drainPolls.after.drains?.[0]).toBe(drainPolls.before.drains?.[0]);
    expect(drainPolls.after.drains?.[1]).not.toBe(drainPolls.before.drains?.[1]);

    const items = makeCatalogSnapshotPayload({
      clusterId,
      items: [catalogItem('web', '10'), catalogItem('api', '6')],
    });
    const catalogPolls = await readTwice(
      'catalog-diff',
      testScope(clusterId, 'limit=50'),
      makeCatalogSnapshotPayload({
        clusterId,
        items: [catalogItem('web', '10'), catalogItem('api', '5')],
      }),
      items
    );
    expect(catalogPolls.after).toEqual(items);
    expect(catalogPolls.after.items?.[0]).toBe(catalogPolls.before.items?.[0]);
    expect(catalogPolls.after.items?.[1]).not.toBe(catalogPolls.before.items?.[1]);
  });
});

describe('manual refresh of a streamed scope', () => {
  it('resynchronizes a resource table stream instead of reading a snapshot', async () => {
    const clusterId = 'manual-stream';
    const scope = namespaceScope(clusterId);
    markClusterReady(clusterId);
    await leaseHealthy('pods', scope);
    app.snapshots.clearReads();
    const subscribed = app.streams.requests().length;

    await refreshOrchestrator.fetchScopedDomain('pods', scope, { intent: 'user' });
    await settle();

    expect(readsOf('pods', scope)).toBe(0);
    expect(app.streams.requests().slice(subscribed)).toEqual([
      expect.objectContaining({ type: 'REQUEST', domain: 'pods', clusterId }),
    ]);
    refreshOrchestrator.releaseScopedDomainLease('pods', scope);
  });

  it('reads a snapshot for a doorbell domain even while its stream is active', async () => {
    const clusterId = 'manual-doorbell';
    const scope = baseScope(clusterId);
    markClusterReady(clusterId);
    await leaseHealthy('catalog', scope);
    app.snapshots.clearReads();
    const subscribed = app.streams.requests().length;

    await refreshOrchestrator.fetchScopedDomain('catalog', scope, { intent: 'user' });

    expect(readsOf('catalog', scope)).toBe(1);
    expect(app.snapshots.requests()).toContain('POST /api/v2/refresh/catalog');
    expect(app.streams.requests()).toHaveLength(subscribed);
    refreshOrchestrator.releaseScopedDomainLease('catalog', scope);
  });

  it('reads a snapshot for a one-shot read of a streamed base scope', async () => {
    const clusterId = 'oneshot-base';
    const scope = baseScope(clusterId);
    markClusterReady(clusterId);
    await leaseHealthy('cluster-config', scope);
    app.snapshots.clearReads();
    const subscribed = app.streams.requests().length;

    await requestRefreshDomainState({ domain: 'cluster-config', scope, reason: 'user' });

    expect(readsOf('cluster-config', scope)).toBe(1);
    expect(app.streams.requests()).toHaveLength(subscribed);
    refreshOrchestrator.releaseScopedDomainLease('cluster-config', scope);
  });
});

describe('stream health and polling fallback', () => {
  // One cluster's healthy stream must not suppress the fallback read for
  // another cluster's stream that is not delivering, and that read must not
  // touch the healthy cluster's rows.
  it('reads a snapshot only for the cluster whose stream is not healthy', async () => {
    const podA = makePodSnapshotEntry({
      clusterId: 'health-a',
      namespace: 'default',
      name: 'pod-a',
      status: 'Running',
      cpuUsageMilli: 10,
      memoryUsageBytes: 20 * 1024 ** 2,
    });
    const podB = makePodSnapshotEntry({
      clusterId: 'health-b',
      namespace: 'default',
      name: 'pod-b',
      node: 'node-b',
      status: 'Running',
      cpuUsageMilli: 30,
      memoryUsageBytes: 40 * 1024 ** 2,
    });
    const scopeA = namespaceScope('health-a', 'default');
    const scopeB = namespaceScope('health-b', 'default');
    markClusterReady('health-a');
    markClusterReady('health-b');
    serveOnly();
    app.snapshots.serve(
      'pods',
      scopeA,
      makePodSnapshotPayload({ clusterId: 'health-a', rows: [podA] })
    );
    app.snapshots.serve(
      'pods',
      scopeB,
      makePodSnapshotPayload({ clusterId: 'health-b', rows: [podB] })
    );
    refreshOrchestrator.acquireScopedDomainLease('pods', scopeA);
    refreshOrchestrator.acquireScopedDomainLease('pods', scopeB);
    await settle();
    app.streams.acknowledge('pods', scopeA);
    await settle();
    const shownA = getScopedDomainState('pods', scopeA).data?.rows?.[0];
    app.snapshots.serve(
      'pods',
      scopeB,
      makePodSnapshotPayload({
        clusterId: 'health-b',
        rows: [{ ...podB, cpuUsageMilli: 35, memoryUsageBytes: 45 * 1024 ** 2 }],
      })
    );
    app.snapshots.clearReads();

    await refreshOrchestrator.fetchScopedDomain('pods', scopeA, { intent: 'startup' });
    await refreshOrchestrator.fetchScopedDomain('pods', scopeB, { intent: 'startup' });

    expect(reads('pods')).toEqual([`pods ${scopeB}`]);
    expect(getScopedDomainState('pods', scopeA).data?.rows?.[0]).toBe(shownA);
    expect(getScopedDomainState('pods', scopeB).data?.rows?.[0]).toMatchObject({
      status: 'Running',
      cpuUsageMilli: 35,
      memoryUsageBytes: 45 * 1024 ** 2,
    });
    // Diagnostics count the poll the stream should have made unnecessary.
    const telemetry = resourceStreamManager.getTelemetrySummaryByClusterDomain();
    expect(telemetry['health-b::pods']?.fallbackCount).toBe(1);
    expect(telemetry['health-a::pods']?.fallbackCount ?? 0).toBe(0);
    refreshOrchestrator.releaseScopedDomainLease('pods', scopeA);
    refreshOrchestrator.releaseScopedDomainLease('pods', scopeB);
  });

  it('asks a query-only consumer to refetch its page when its stream is not delivering', async () => {
    const clusterId = 'query-poll';
    const scope = baseScope(clusterId);
    markClusterReady(clusterId);
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scope, { demand: 'query' });
    await settle();
    app.snapshots.clearReads();

    await advance(10_000);

    expect(readsOf('cluster-config', scope)).toBe(0);
    expect(getScopedDomainState('cluster-config', scope).queryReconcileVersion).toBe(1);
    expect(
      resourceStreamManager.getTelemetrySummaryByClusterDomain()[`${clusterId}::cluster-config`]
        ?.fallbackCount
    ).toBe(1);
    refreshOrchestrator.releaseScopedDomainLease('cluster-config', scope, { demand: 'query' });
  });

  it('leaves a query-only consumer alone while its stream is healthy', async () => {
    const clusterId = 'query-healthy';
    const scope = baseScope(clusterId);
    markClusterReady(clusterId);
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scope, { demand: 'query' });
    await settle();
    app.streams.acknowledge('cluster-config', scope);
    await settle();
    app.snapshots.clearReads();

    await advance(10_000);

    expect(readsOf('cluster-config', scope)).toBe(0);
    expect(getScopedDomainState('cluster-config', scope).queryReconcileVersion).toBeUndefined();
    expect(
      resourceStreamManager.getTelemetrySummaryByClusterDomain()[`${clusterId}::cluster-config`]
        ?.fallbackCount ?? 0
    ).toBe(0);
    refreshOrchestrator.releaseScopedDomainLease('cluster-config', scope, { demand: 'query' });
  });

  // A healthy stream signals changes; it does not deliver a new query's first
  // page, so a new filter reads one, once: the query does not join the stream.
  it('reads the first page of a new catalog query once while the catalog stream is healthy', async () => {
    const clusterId = 'catalog-filter';
    const live = baseScope(clusterId);
    const page = testScope(clusterId, 'limit=50&customOnly=true&kind=Widget&namespace=cluster');
    markClusterReady(clusterId);
    await leaseHealthy('catalog', live);
    app.snapshots.clearReads();
    const subscribed = app.streams.requests().length;

    refreshOrchestrator.acquireScopedDomainLease('catalog', page);
    await refreshOrchestrator.fetchScopedDomain('catalog', page, { intent: 'startup' });
    await settle();

    expect(readsOf('catalog', page)).toBe(1);
    expect(app.streams.requests()).toHaveLength(subscribed);
    expect(getScopedDomainState('catalog', page).data).toBeTruthy();
    refreshOrchestrator.releaseScopedDomainLease('catalog', page);
    refreshOrchestrator.releaseScopedDomainLease('catalog', live);
  });

  it('blocks a drifted stream only in its own cluster', async () => {
    const scopeA = baseScope('drift-a');
    const scopeB = baseScope('drift-b');
    markClusterReady('drift-a');
    markClusterReady('drift-b');
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scopeA);
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scopeB);
    await settle();

    eventBus.emit('refresh:resource-stream-drift', {
      domain: 'cluster-config',
      scope: scopeA,
      reason: 'key mismatch',
      streamCount: 2,
      snapshotCount: 1,
      missingKeys: 1,
      extraKeys: 0,
    });
    await advance(1_000);

    expect(refreshOrchestrator.isStreamingBlocked('cluster-config', scopeA)).toBe(true);
    expect(refreshOrchestrator.isStreamingBlocked('cluster-config', scopeB)).toBe(false);
    expect(app.streams.active()).toEqual([streamKey('cluster-config', scopeB)]);
    refreshOrchestrator.releaseScopedDomainLease('cluster-config', scopeA);
    refreshOrchestrator.releaseScopedDomainLease('cluster-config', scopeB);
  });
});

describe('leases and scopes', () => {
  const OBJECT_PANEL_DOMAINS = [
    'object-details',
    'object-events',
    'object-helm-manifest',
    'object-helm-values',
    'object-maintenance',
    'object-map',
    'object-yaml',
  ] as const;

  it('keeps each open object of an object-panel domain leased with its rows', async () => {
    const clusterId = 'panel-a';
    markClusterReady(clusterId);
    for (const domain of OBJECT_PANEL_DOMAINS) {
      const [firstTail, secondTail] =
        refreshDomainContract.domainInventory[domain].scopeContract.valid;
      const first = testScope(clusterId, firstTail);
      const second = testScope(clusterId, secondTail);
      refreshOrchestrator.acquireScopedDomainLease(domain, first);
      await refreshOrchestrator.fetchScopedDomain(domain, first, { intent: 'user' });
      await settle();
      const shown = getScopedDomainState(domain, first).data;
      expect(shown).toBeTruthy();

      refreshOrchestrator.acquireScopedDomainLease(domain, second);
      await settle();

      expect(getScopedDomainState(domain, first).data).toBe(shown);
      expect(refreshOrchestrator.getPollingStatus(domain, first).state).toBe('scheduled');
      expect(refreshOrchestrator.getPollingStatus(domain, second).state).toBe('scheduled');
      refreshOrchestrator.releaseScopedDomainLease(domain, first);
      refreshOrchestrator.releaseScopedDomainLease(domain, second);
    }

    const [firstLogs, secondLogs] = refreshDomainContract.domainInventory[
      'container-logs'
    ].scopeContract.valid.map((tail) => testScope(clusterId, tail));
    refreshOrchestrator.acquireScopedDomainLease('container-logs', firstLogs);
    refreshOrchestrator.acquireScopedDomainLease('container-logs', secondLogs);
    await settle();
    for (const scope of [firstLogs, secondLogs]) {
      expect(getScopedDomainState('container-logs', scope).data?.phase.status).not.toBe('stopping');
    }
    refreshOrchestrator.releaseScopedDomainLease('container-logs', firstLogs);
    refreshOrchestrator.releaseScopedDomainLease('container-logs', secondLogs);
  });

  // Typed table queries lease their full query scope only while reading it;
  // that must not evict the sidebar's independently leased base snapshot.
  it('keeps the leased cluster-attention base scope while a table query scope comes and goes', async () => {
    const clusterId = 'attention-a';
    const base = baseScope(clusterId);
    const query = testScope(clusterId, '?limit=50&sort=severity');
    const severityCounts = { info: 5, warning: 16, error: 0 };
    markClusterReady(clusterId);
    serveOnly();
    app.snapshots.serve(
      'cluster-attention',
      base,
      makeClusterAttentionSnapshot({ clusterId, severityCounts })
    );
    refreshOrchestrator.acquireScopedDomainLease('cluster-attention', base, {
      preserveState: true,
    });
    await settle();
    expect(getScopedDomainState('cluster-attention', base).data?.severityCounts).toEqual(
      severityCounts
    );

    refreshOrchestrator.acquireScopedDomainLease('cluster-attention', query);
    refreshOrchestrator.releaseScopedDomainLease('cluster-attention', query);
    await settle();

    expect(refreshOrchestrator.getPollingStatus('cluster-attention', base).state).toBe('scheduled');
    expect(app.streams.active()).toEqual([streamKey('cluster-attention', base)]);
    expect(getScopedDomainState('cluster-attention', base).data?.severityCounts).toEqual(
      severityCounts
    );
    refreshOrchestrator.releaseScopedDomainLease('cluster-attention', base, {
      preserveState: true,
    });
  });

  it('counts a padded scope and its trimmed form as leases of one stream', async () => {
    const clusterId = 'trim-a';
    const scope = namespaceScope(clusterId);
    markClusterReady(clusterId);

    refreshOrchestrator.acquireScopedDomainLease('namespace-config', `  ${scope}  `);
    refreshOrchestrator.acquireScopedDomainLease('namespace-config', scope);
    await settle();
    expect(app.streams.active()).toEqual([streamKey('namespace-config', scope)]);

    refreshOrchestrator.releaseScopedDomainLease('namespace-config', scope);
    await advance(1_000);
    expect(app.streams.active()).toEqual([streamKey('namespace-config', scope)]);

    refreshOrchestrator.releaseScopedDomainLease('namespace-config', scope);
    await settle();
    expect(app.streams.active()).toEqual([]);
  });

  it('never subscribes a scope released before its stream start runs', async () => {
    const clusterId = 'quick-release';
    const scope = namespaceScope(clusterId);
    markClusterReady(clusterId);

    refreshOrchestrator.acquireScopedDomainLease('namespace-config', scope);
    refreshOrchestrator.releaseScopedDomainLease('namespace-config', scope);
    await settle();
    await advance(1_000);

    expect(app.streams.requests()).toEqual([]);
  });

  it('rejects a blank scope', () => {
    expect(() => refreshOrchestrator.acquireScopedDomainLease('namespace-events', '   ')).toThrow(
      'requires a non-empty scope value'
    );
  });

  it.each(SNAPSHOT_REFRESH_DOMAINS)(
    'rejects unprefixed %s scopes before they can acquire a denial latch',
    async (domain) => {
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
      expect(reads()).toEqual([]);
      expect(isPermissionDenied(getScopedDomainState(domain, scope).error)).toBe(false);
    }
  );

  // A kubeconfig file or context name may contain a comma; the scope prefix is
  // one cluster id, so that cluster leases, streams, and reads like any other.
  it('leases, streams, and reads a cluster whose id contains a comma', async () => {
    const clusterId = 'prod,eu.yaml:ctx';
    const scope = namespaceScope(clusterId, 'default');
    markClusterReady(clusterId);
    serveOnly();
    app.snapshots.serve('pods', scope, makePodSnapshotPayload({ clusterId }));

    refreshOrchestrator.acquireScopedDomainLease('pods', scope);
    await settle();

    expect(reads('pods')).toEqual([`pods ${scope}`]);
    expect(getScopedDomainState('pods', scope).status).toBe('ready');
    expect(app.streams.requests()).toContainEqual(
      expect.objectContaining({ type: 'REQUEST', domain: 'pods', clusterId })
    );
    expect(refreshOrchestrator.getPollingStatus('pods', scope).state).toBe('scheduled');
    refreshOrchestrator.releaseScopedDomainLease('pods', scope);
  });

  // Typed events queries share the singleton named stream with the base
  // scope; streaming their one-shot scopes churned that connection. Catalog
  // queries share the cluster's catalog stream the same way.
  it('reads one-shot query scopes as snapshots and never streams them', async () => {
    const clusterId = 'query-scopes';
    markClusterReady(clusterId);
    const pods = testScope(clusterId, 'namespace:all?limit=50&sort=name&sortDirection=asc');
    const leased = [
      { domain: 'pods', scope: pods },
      { domain: 'cluster-events', scope: testScope(clusterId, '?limit=50&sort=age') },
      { domain: 'namespace-events', scope: testScope(clusterId, 'namespace:all?limit=50') },
      { domain: 'catalog', scope: testScope(clusterId, 'limit=50&namespace=cluster') },
    ] as const;
    serveOnly();
    app.snapshots.serve(
      'pods',
      pods,
      makePodSnapshotPayload({
        clusterId,
        rows: [makePodSnapshotEntry({ clusterId, namespace: 'team-a', name: 'pod-a' })],
      })
    );
    leased.forEach(({ domain, scope }) => {
      refreshOrchestrator.acquireScopedDomainLease(domain, scope);
    });

    await refreshOrchestrator.fetchScopedDomain('pods', pods, { intent: 'user' });
    await settle();

    expect(app.streams.requests()).toEqual([]);
    expect(reads()).toEqual([`pods ${pods}`]);
    expect(app.snapshots.requests()).not.toContain('POST /api/v2/refresh/pods');
    expect(getScopedDomainState('pods', pods).data?.rows).toHaveLength(1);
    leased.forEach(({ domain, scope }) => {
      refreshOrchestrator.releaseScopedDomainLease(domain, scope);
    });
  });

  // An object panel's Pods tab leases a workload- or node-scoped window; a
  // window without its stream never refetches and its rows go stale.
  it.each(['workload:team-a:apps:v1:Deployment:web', 'node:node-1', 'namespace:all'])(
    'streams a leased pods %s window',
    async (tail) => {
      const clusterId = `pods-window-${tail.split(':')[0]}`;
      const scope = testScope(clusterId, tail);
      markClusterReady(clusterId);

      refreshOrchestrator.acquireScopedDomainLease('pods', scope);
      await settle();

      expect(app.streams.active()).toEqual([streamKey('pods', scope)]);
      refreshOrchestrator.releaseScopedDomainLease('pods', scope);
    }
  );

  it('reports no polling for a stream-only domain', async () => {
    const clusterId = 'logs-polling';
    const scope = logsScope(clusterId);
    markClusterReady(clusterId);
    refreshOrchestrator.acquireScopedDomainLease('container-logs', scope);

    expect(refreshOrchestrator.getPollingStatus('container-logs', scope)).toEqual({
      state: 'off',
      intervalMs: null,
    });
    refreshOrchestrator.releaseScopedDomainLease('container-logs', scope);
  });
});

describe('auto-refresh pause and scope changes', () => {
  it('streams a scope only while auto-refresh is on and keeps its rows across a pause', async () => {
    const clusterId = 'pause-stream';
    const scope = baseScope(clusterId);
    markClusterReady(clusterId);
    setAutoRefresh(false);
    refreshOrchestrator.acquireScopedDomainLease('cluster-config', scope);
    await settle();
    expect(app.streams.active()).toEqual([]);

    setAutoRefresh(true);
    await settle();
    expect(app.streams.active()).toEqual([streamKey('cluster-config', scope)]);
    const shown = getScopedDomainState('cluster-config', scope).data;
    expect(shown).toBeTruthy();

    setAutoRefresh(false);
    await advance(1_000);
    expect(app.streams.active()).toEqual([]);
    expect(getScopedDomainState('cluster-config', scope).data).toBe(shown);

    setAutoRefresh(true);
    await settle();
    expect(app.streams.active()).toEqual([streamKey('cluster-config', scope)]);
    refreshOrchestrator.releaseScopedDomainLease('cluster-config', scope);
  });

  // The global pause freezes an open Logs tab: its stream stops without
  // clearing the buffer and starts again when auto-refresh returns.
  it('stops and resumes an open log stream with auto-refresh, keeping its buffer', async () => {
    const clusterId = 'pause-logs';
    const scope = logsScope(clusterId);
    markClusterReady(clusterId);
    refreshOrchestrator.acquireScopedDomainLease('container-logs', scope, { preserveState: true });
    await settle();
    expect(getScopedDomainState('container-logs', scope).data?.phase.status).not.toBe('stopping');

    setAutoRefresh(false);
    await settle();
    expect(getScopedDomainState('container-logs', scope).data?.phase.status).toBe('stopping');

    setAutoRefresh(true);
    await settle();
    expect(getScopedDomainState('container-logs', scope).data?.phase.status).not.toBe('stopping');
    refreshOrchestrator.releaseScopedDomainLease('container-logs', scope, {
      preserveState: true,
    });
  });

  it('stops the old scope with its rows and streams the new one when the scope changes', async () => {
    const clusterId = 'switch-scope';
    const from = namespaceScope(clusterId, 'team-a');
    const to = namespaceScope(clusterId, 'team-b');
    markClusterReady(clusterId);
    refreshOrchestrator.acquireScopedDomainLease('namespace-config', from);
    await settle();
    expect(app.streams.active()).toEqual([streamKey('namespace-config', from)]);
    expect(getScopedDomainState('namespace-config', from).data).toBeTruthy();

    refreshOrchestrator.releaseScopedDomainLease('namespace-config', from);
    refreshOrchestrator.acquireScopedDomainLease('namespace-config', to);
    await settle();

    expect(app.streams.active()).toEqual([streamKey('namespace-config', to)]);
    expect(getScopedDomainState('namespace-config', from).data).toBeNull();
    refreshOrchestrator.releaseScopedDomainLease('namespace-config', to);
  });

  it('restarts a preserved event stream as updating with its rows kept', async () => {
    const clusterId = 'events-kept';
    const scope = baseScope(clusterId);
    markClusterReady(clusterId);
    serveOnly();
    app.snapshots.serve(
      'cluster-events',
      scope,
      makeClusterEventsSnapshotPayload({
        clusterId,
        rows: [
          {
            ref: {
              clusterId,
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
      })
    );
    refreshOrchestrator.acquireScopedDomainLease('cluster-events', scope, { preserveState: true });
    await settle();

    refreshOrchestrator.releaseScopedDomainLease('cluster-events', scope, { preserveState: true });
    await advance(1_000);
    expect(app.streams.active()).toEqual([]);
    expect(getScopedDomainState('cluster-events', scope).data?.rows).toHaveLength(1);

    refreshOrchestrator.acquireScopedDomainLease('cluster-events', scope, { preserveState: true });
    const restarted = getScopedDomainState('cluster-events', scope);
    expect(restarted.status).toBe('updating');
    expect(restarted.data?.rows?.[0].message).toBe('still here');
    await settle();
    expect(app.streams.active()).toEqual([streamKey('cluster-events', scope)]);
    refreshOrchestrator.releaseScopedDomainLease('cluster-events', scope, { preserveState: true });
  });
});

describe('failures and error reports', () => {
  // A failure without a backend status (the browser could not reach the
  // backend after the client's retries) is still a visible error state that
  // keeps its own message, and the next good read clears it.
  it('stores a browser failure as a local failure until a read succeeds', async () => {
    const clusterId = 'browser-failure';
    const scope = yamlScope(clusterId);
    markClusterReady(clusterId);
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', scope);
    app.snapshots.respond(() => Promise.reject(new TypeError('Failed to fetch')));

    const read = refreshOrchestrator.fetchScopedDomain('object-yaml', scope, {
      intent: 'startup',
    });
    await advance(1_000);
    await read;

    expect(getScopedDomainState('object-yaml', scope)).toMatchObject({
      status: 'error',
      error: { kind: 'local', message: 'Failed to fetch', errorName: 'TypeError' },
    });
    expect(takeToasts()).toHaveLength(1);

    answerReads();
    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'startup' });

    expect(getScopedDomainState('object-yaml', scope)).toMatchObject({
      status: 'ready',
      error: null,
    });
    refreshOrchestrator.releaseScopedDomainLease('object-yaml', scope);
  });

  describe('right after a kubeconfig change', () => {
    // The start-up window is measured on Date; an epoch-zero clock lets it
    // lapse before any later test runs.
    beforeEach(() => {
      vi.setSystemTime(0);
    });

    const failRead = async (clusterId: string, answer: () => Response | Promise<Response>) => {
      const scope = yamlScope(clusterId);
      markClusterReady(clusterId);
      refreshOrchestrator.acquireScopedDomainLease('object-yaml', scope);
      eventBus.emit('kubeconfig:changed', '');
      app.snapshots.respond(answer);
      const read = refreshOrchestrator.fetchScopedDomain('object-yaml', scope, {
        intent: 'startup',
      });
      await advance(1_000);
      await read;
      const state = getScopedDomainState('object-yaml', scope);
      refreshOrchestrator.releaseScopedDomainLease('object-yaml', scope);
      return state;
    };

    // The backend is republishing its refresh service and cluster handlers;
    // these answers are start-up, not failures.
    it.each([
      ['RefreshUnavailable', 'refresh subsystem not initialised'],
      ['ClusterNotReady', 'no active clusters available (requested: [cluster-a])'],
    ] as const)('does not report a %s answer', async (reason, message) => {
      const state = await failRead(`startup-${reason}`, failWith(reason, message));

      expect(app.errors.records()).toEqual([]);
      expect(state.status).not.toBe('error');
    });

    it('does not report a browser fetch failure', async () => {
      const state = await failRead('startup-browser', () =>
        Promise.reject(new TypeError('Failed to fetch'))
      );

      expect(app.errors.records()).toEqual([]);
      expect(state.status).not.toBe('error');
    });

    it('still reports a real failure', async () => {
      const state = await failRead(
        'startup-real',
        failWith('InternalError', 'startup-real: catalog sync failed')
      );

      expect(takeToasts()).toHaveLength(1);
      expect(state.status).toBe('error');
    });
  });

  it('holds a read the backend answers ClusterNotReady and replays it once the cluster serves', async () => {
    const clusterId = 'not-ready';
    const scope = yamlScope(clusterId);
    markClusterReady(clusterId);
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', scope);
    let warming = true;
    app.snapshots.respond((request) => {
      if (warming) {
        warming = false;
        return statusResponse(makeErrorStatus('ClusterNotReady', 'not-ready: cluster is starting'));
      }
      return answerRead(request);
    });

    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'startup' });
    expect(app.errors.records()).toEqual([]);

    eventBus.emit('cluster:lifecycle', { clusterId, state: 'connecting' });
    eventBus.emit('cluster:lifecycle', { clusterId, state: 'ready' });
    await settle();

    expect(readsOf('object-yaml', scope)).toBe(2);
    expect(getScopedDomainState('object-yaml', scope).status).toBe('ready');
    refreshOrchestrator.releaseScopedDomainLease('object-yaml', scope);
  });

  // A panel's object that is gone is shown as deleted by the panel; only the
  // backend's NotFound says so, not words in a message.
  it.each([
    { name: 'does not toast a NotFound answer', reason: 'NotFound', toasts: 0 },
    { name: 'toasts a failure that only mentions "not found"', reason: 'InternalError', toasts: 1 },
  ] as const)('object details: $name', async ({ reason, toasts }) => {
    const clusterId = `details-${reason}`;
    const scope = yamlScope(clusterId);
    markClusterReady(clusterId);
    app.snapshots.respond(failWith(reason, `${clusterId}: helper not found`));

    refreshOrchestrator.acquireScopedDomainLease('object-details', scope);
    await settle();

    expect(readsOf('object-details', scope)).toBe(1);
    expect(takeToasts()).toHaveLength(toasts);
    refreshOrchestrator.releaseScopedDomainLease('object-details', scope);
  });

  it('records a failed read and reports it with its domain, scope, and broker correlation id', async () => {
    const clusterId = 'fail-report';
    const scope = yamlScope(clusterId);
    markClusterReady(clusterId);
    app.snapshots.respond(failWith('InternalError', 'fail-report: offline'));
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', scope);

    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, {
      intent: 'user',
      correlationId: 'broker-read-42',
    });

    const state = getScopedDomainState('object-yaml', scope);
    expect(state.status).toBe('error');
    expect(failureMessage(state.error)).toBe('fail-report: offline');
    expect(getRefreshState().pendingRequests).toBe(0);
    const [report, ...others] = takeToasts();
    expect(others).toEqual([]);
    expect((report.error as Error).message).toBe('fail-report: offline');
    expect(report.context).toMatchObject({
      source: 'refresh-orchestrator',
      domain: 'object-yaml',
      scope,
      operationId: 'broker-read-42',
    });
    refreshOrchestrator.releaseScopedDomainLease('object-yaml', scope);
  });

  it('reports a scope’s repeated failure once until a read succeeds', async () => {
    const clusterId = 'fail-dedupe';
    const scope = yamlScope(clusterId);
    markClusterReady(clusterId);
    const failing = failWith('InternalError', 'fail-dedupe: backend unavailable');
    app.snapshots.respond(failing);
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', scope);

    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'background' });
    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'user' });
    expect(readsOf('object-yaml', scope)).toBe(2);
    expect(takeToasts()).toHaveLength(1);

    answerReads();
    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'user' });
    app.snapshots.respond(failing);
    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'user' });

    expect(takeToasts()).toHaveLength(1);
    refreshOrchestrator.releaseScopedDomainLease('object-yaml', scope);
  });

  it('reports a still-failing scope again after a kubeconfig change', async () => {
    const clusterId = 'kubeconfig-forgets';
    const scope = yamlScope(clusterId);
    markClusterReady(clusterId);
    app.snapshots.respond(failWith('InternalError', 'kubeconfig-forgets: backend unavailable'));
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', scope);
    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'user' });
    expect(takeToasts()).toHaveLength(1);

    eventBus.emit('kubeconfig:changing', '');
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', scope);
    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'user' });

    expect(takeToasts()).toHaveLength(1);
    refreshOrchestrator.releaseScopedDomainLease('object-yaml', scope);
  });

  it('records a failed stream start on its scope and reports it', async () => {
    const clusterId = 'start-fail';
    const scope = namespaceScope(clusterId);
    markClusterReady(clusterId);
    const start = vi.spyOn(resourceStreamManager, 'start').mockImplementation(() => {
      throw new Error('start-fail: stream boom');
    });
    try {
      refreshOrchestrator.acquireScopedDomainLease('namespace-config', scope);
      await settle();

      const state = getScopedDomainState('namespace-config', scope);
      expect(state.status).toBe('error');
      expect(failureMessage(state.error)).toContain('start-fail: stream boom');
      expect(app.streams.active()).toEqual([]);
      const [report, ...others] = takeToasts();
      expect(others).toEqual([]);
      expect(report.context).toMatchObject({ domain: 'namespace-config', scope });
      refreshOrchestrator.releaseScopedDomainLease('namespace-config', scope);
    } finally {
      start.mockRestore();
    }
  });
});

describe('closing clusters', () => {
  // A cluster-scoped scope can hold retained data with no lease; closing its
  // cluster must still clear it, or it lingers in diagnostics forever.
  it('clears a closed cluster’s retained state that no lease holds and keeps the others', () => {
    const removed = baseScope('closed-retained');
    const kept = baseScope('open-retained');
    setScopedDomainState('cluster-events', removed, (prev) => ({ ...prev, status: 'ready' }));
    setScopedDomainState('cluster-events', kept, (prev) => ({ ...prev, status: 'ready' }));
    const eventScopes = () =>
      (getRefreshState().scopedDomainEntries['cluster-events'] ?? []).map(([scope]) => scope);
    expect(eventScopes()).toEqual(expect.arrayContaining([removed, kept]));

    refreshOrchestrator.setConnectedClusters(['open-retained']);

    expect(eventScopes()).toContain(kept);
    expect(eventScopes()).not.toContain(removed);
  });

  it('never starts a queued stream for a cluster closed before it ran, and a reopen streams again', async () => {
    const clusterId = 'closing-queued';
    const scope = baseScope(clusterId);
    markClusterReady(clusterId);

    refreshOrchestrator.acquireScopedDomainLease('namespaces', scope);
    refreshOrchestrator.setConnectedClusters(['retained-queued']);
    await settle();
    await advance(1_000);

    expect(app.streams.requests()).toEqual([]);
    expect(getRefreshState().scopedDomainEntries.namespaces ?? []).toEqual([]);
    expect(refreshOrchestrator.getPollingStatus('namespaces', scope).state).toBe('off');

    refreshOrchestrator.setConnectedClusters(['retained-queued', clusterId]);
    refreshOrchestrator.acquireScopedDomainLease('namespaces', scope);
    await settle();
    expect(app.streams.active()).toEqual([streamKey('namespaces', scope)]);
    refreshOrchestrator.releaseScopedDomainLease('namespaces', scope);
  });

  it.each(['resolves', 'fails'] as const)(
    'retires a stream start that %s after its cluster closed',
    async (outcome) => {
      const clusterId = `retire-${outcome}`;
      const scope = baseScope(clusterId);
      markClusterReady(clusterId);
      const start =
        outcome === 'fails'
          ? vi.spyOn(resourceStreamManager, 'start').mockImplementation(() => {
              throw new Error(`${clusterId}: retired connection`);
            })
          : null;
      try {
        refreshOrchestrator.acquireScopedDomainLease('namespaces', scope);
        // One turn: the start has run and its completion is still queued.
        await Promise.resolve();
        refreshOrchestrator.setConnectedClusters(['retained-retire']);
        await settle();
        await advance(1_000);

        expect(app.streams.active()).toEqual([]);
        expect(getRefreshState().scopedDomainEntries.namespaces ?? []).toEqual([]);
        expect(app.errors.records()).toEqual([]);
      } finally {
        start?.mockRestore();
      }
    }
  );

  it('reports a reopened cluster’s failure again and an open cluster’s repeat once', async () => {
    const reopened = yamlScope('reopen-failing');
    const open = yamlScope('reopen-open');
    markClusterReady('reopen-failing');
    markClusterReady('reopen-open');
    app.snapshots.respond(failWith('InternalError', 'reopen: backend unavailable'));
    const read = (scope: string) =>
      refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'user' });
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', reopened);
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', open);
    await read(reopened);
    await read(open);
    expect(takeToasts()).toHaveLength(2);

    refreshOrchestrator.setConnectedClusters(['reopen-open']);
    refreshOrchestrator.setConnectedClusters(['reopen-open', 'reopen-failing']);
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', reopened);
    await read(reopened);
    await read(open);

    expect(takeToasts().map((report) => report.context?.scope)).toEqual([reopened]);
    refreshOrchestrator.releaseScopedDomainLease('object-yaml', reopened);
    refreshOrchestrator.releaseScopedDomainLease('object-yaml', open);
  });

  it('drops deferred reads when their cluster closes', async () => {
    const clusterId = 'drop-deferred';
    const scope = yamlScope(clusterId);
    markClusterReady(clusterId);
    refreshOrchestrator.acquireScopedDomainLease('object-yaml', scope);
    clusterReadiness.beginForegroundActivation(clusterId);
    await refreshOrchestrator.fetchScopedDomain('object-yaml', scope, { intent: 'startup' });

    refreshOrchestrator.setConnectedClusters(['drop-kept']);
    clusterReadiness.endForegroundActivation(clusterId);
    await settle();

    expect(reads()).toEqual([]);
  });
});

describe('cluster auth', () => {
  // The failing cluster's id contains the runtime key delimiter ('::'); only
  // that cluster pauses.
  it('pauses only the cluster whose auth failed and resumes it on recovery', async () => {
    const failing = 'config::blue';
    const healthy = 'auth-healthy';
    const failingScope = baseScope(failing);
    const healthyScope = baseScope(healthy);
    markClusterReady(failing);
    markClusterReady(healthy);
    await leaseHealthy('cluster-config', failingScope);
    await leaseHealthy('cluster-config', healthyScope);
    const signals = new Map<string, AbortSignal | null>();
    app.snapshots.respond(({ scope, signal }) => {
      signals.set(scope, signal);
      return stalledRead(signal);
    });
    app.streams.ring('cluster-config', failingScope, 'object', 'v1');
    app.streams.ring('cluster-config', healthyScope, 'object', 'v1');
    await afterSignal();
    expect(signals.size).toBe(2);

    eventBus.emit('cluster:auth:failed', { clusterId: failing });
    await advance(1_000);
    expect(signals.get(failingScope)?.aborted).toBe(true);
    expect(signals.get(healthyScope)?.aborted).toBe(false);
    expect(app.streams.active()).toEqual([streamKey('cluster-config', healthyScope)]);

    eventBus.emit('cluster:auth:failed', { clusterId: healthy });
    await advance(1_000);
    expect(app.streams.active()).toEqual([]);

    answerReads();
    eventBus.emit('cluster:auth:recovered', { clusterId: failing });
    await settle();
    expect(app.streams.active()).toEqual([streamKey('cluster-config', failingScope)]);

    eventBus.emit('cluster:auth:recovered', { clusterId: healthy });
    await settle();
    expect(app.streams.active()).toEqual(
      sortedKeys(
        streamKey('cluster-config', failingScope),
        streamKey('cluster-config', healthyScope)
      )
    );
    refreshOrchestrator.releaseScopedDomainLease('cluster-config', failingScope);
    refreshOrchestrator.releaseScopedDomainLease('cluster-config', healthyScope);
  });
});

describe('view reset', () => {
  it('cancels in-flight reads, stops streams, and clears scoped state', async () => {
    const clusterId = 'view-reset';
    const scope = baseScope(clusterId);
    markClusterReady(clusterId);
    await leaseHealthy('cluster-config', scope);
    expect(getScopedDomainState('cluster-config', scope).data).toBeTruthy();
    const signals: Array<AbortSignal | null> = [];
    app.snapshots.respond(({ signal }) => {
      signals.push(signal);
      return stalledRead(signal);
    });
    app.streams.ring('cluster-config', scope, 'object', 'v1');
    await afterSignal();
    expect(signals).toHaveLength(1);

    eventBus.emit('view:reset');
    await advance(1_000);

    expect(signals[0]?.aborted).toBe(true);
    expect(app.streams.active()).toEqual([]);
    expect(getScopedDomainState('cluster-config', scope).data).toBeNull();
    refreshOrchestrator.releaseScopedDomainLease('cluster-config', scope);
  });
});

describe('metrics demand', () => {
  it('asks for metrics while a metric view is leased and stops when it is released', async () => {
    const demand = recordMetricsDemand();
    const scope = baseScope('metrics-toggle');
    markClusterReady('metrics-toggle');

    refreshOrchestrator.acquireScopedDomainLease('cluster-overview', scope);
    await settle();
    refreshOrchestrator.releaseScopedDomainLease('cluster-overview', scope);
    await settle();

    expect(demand).toEqual([['metrics-toggle'], []]);
  });

  it('routes metrics demand to the clusters that hold metric leases', async () => {
    const demand = recordMetricsDemand();
    const scopeA = baseScope('metrics-a');
    const scopeB = baseScope('metrics-b');
    markClusterReady('metrics-a');
    markClusterReady('metrics-b');

    refreshOrchestrator.acquireScopedDomainLease('cluster-overview', scopeA);
    await settle();
    refreshOrchestrator.acquireScopedDomainLease('cluster-overview', scopeB);
    await settle();
    expect(demand[demand.length - 1]).toEqual(['metrics-a', 'metrics-b']);

    refreshOrchestrator.releaseScopedDomainLease('cluster-overview', scopeA);
    await settle();
    expect(demand[demand.length - 1]).toEqual(['metrics-b']);

    refreshOrchestrator.acquireScopedDomainLease('cluster-overview', scopeA);
    await settle();
    refreshOrchestrator.setConnectedClusters(['metrics-b']);
    await settle();
    expect(demand[demand.length - 1]).toEqual(['metrics-b']);

    refreshOrchestrator.releaseScopedDomainLease('cluster-overview', scopeB);
    await settle();
    expect(demand[demand.length - 1]).toEqual([]);
  });

  it('does not count a retained namespace workspace as metrics demand', async () => {
    const demand = recordMetricsDemand();
    const scope = baseScope('metrics-namespaces');
    markClusterReady('metrics-namespaces');

    refreshOrchestrator.acquireScopedDomainLease('namespaces', scope);
    await settle();
    refreshOrchestrator.releaseScopedDomainLease('namespaces', scope);
    await settle();

    expect(demand).toEqual([]);
  });

  it('retries unchanged metrics demand after a failed request', async () => {
    const demand = recordMetricsDemand({ failFirst: true });
    const scope = baseScope('metrics-retry');
    markClusterReady('metrics-retry');

    refreshOrchestrator.acquireScopedDomainLease('namespace-metrics', scope);
    await settle();
    expect(demand).toEqual([['metrics-retry']]);

    await advance(1_000);
    expect(demand).toEqual([['metrics-retry'], ['metrics-retry']]);

    refreshOrchestrator.releaseScopedDomainLease('namespace-metrics', scope);
    await settle();
    expect(demand[demand.length - 1]).toEqual([]);
  });
});
