/**
 * frontend/src/core/data-access/dataAccess.test.ts
 *
 * Brokered data access over the real refresh orchestrator, store, domain
 * registrations, and stream managers (test-utils/appState); only the refresh
 * HTTP API and the stream sockets are faked. Each test states what a broker
 * request asks the backend for, when the auto-refresh pause blocks it, and
 * what the broker records in its read diagnostics.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBrokerReadDiagnosticsSnapshot } from '@/core/read-diagnostics';
import {
  makeClusterConfigSnapshotPayload,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { getScopedDomainState } from '@/core/refresh/store';
import type { RefreshDomain } from '@/core/refresh/types';
import {
  flushRefreshWork,
  installAppStateHarness,
  markClusterReady,
  setAutoRefresh,
} from '@/test-utils/appState/harness';
import { snapshotResponse, streamKey } from '@/test-utils/appState/transport';
import { testScope } from '@/test-utils/refreshScope';
import {
  acquireRefreshDomainLease,
  isDataAccessBlocked,
  releaseRefreshDomainLease,
  requestData,
  requestRefreshDomain,
  requestRefreshDomainState,
} from './dataAccess';

const app = installAppStateHarness({ streams: 'manual' });

// A snapshot-only domain: its reads are exactly the broker's.
const yamlScope = (clusterId: string) => testScope(clusterId, 'default:apps/v1:Deployment:web');

/** Snapshot reads of `(domain, scope)` so far. */
const readsOf = (domain: RefreshDomain, scope: string): number =>
  app.snapshots.reads(domain).filter((read) => read.scope === scope).length;

/** The correlation id each snapshot read carried, in order. */
const recordCorrelationIds = (): string[] => {
  const ids: string[] = [];
  let version = 0;
  app.snapshots.respond(({ domain, scope, headers }) => {
    ids.push(headers.get('X-Correlation-ID') ?? '');
    version += 1;
    return snapshotResponse({
      domain,
      scope,
      version,
      payload: { yaml: 'kind: Deployment' },
    });
  });
  return ids;
};

const settle = async () => {
  await flushRefreshWork();
  await vi.advanceTimersByTimeAsync(0);
  await flushRefreshWork();
};

const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await flushRefreshWork();
};

beforeEach(() => {
  vi.useFakeTimers();
  setAutoRefresh(true);
});

afterEach(async () => {
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
});

describe('refresh-domain leases', () => {
  // The broker passes demand and preserveState to the orchestrator on both
  // acquire and release; a mismatch strands the lease (the stream never stops)
  // or drops rows a remount would repaint.
  it.each([
    { demand: 'snapshot', preserveState: false },
    { demand: 'snapshot', preserveState: true },
    { demand: 'query', preserveState: false },
    { demand: 'query', preserveState: true },
  ] as const)(
    'balances $demand demand with preserveState=$preserveState across acquire and release',
    async ({ demand, preserveState }) => {
      const clusterId = `lease-${demand}-${preserveState}`;
      markClusterReady(clusterId);
      const scope = testScope(clusterId, 'namespace:prod');
      app.snapshots.serve('pods', scope, makePodSnapshotPayload({ clusterId }));
      const lease = { domain: 'pods', scope, demand, preserveState } as const;

      acquireRefreshDomainLease(lease);
      await settle();
      expect(app.streams.active()).toContain(streamKey('pods', scope));
      // Only snapshot demand loads the bounded base snapshot; query consumers
      // read their own pages.
      expect(readsOf('pods', scope)).toBe(demand === 'snapshot' ? 1 : 0);
      const loaded = getScopedDomainState('pods', scope).data;
      expect(Boolean(loaded)).toBe(demand === 'snapshot');

      releaseRefreshDomainLease(lease);
      await settle();
      // A preserved scope's stream lingers briefly for a remount and keeps its
      // rows; a reset scope stops at once and drops them.
      expect(app.streams.active().includes(streamKey('pods', scope))).toBe(preserveState);
      expect(getScopedDomainState('pods', scope).data).toBe(preserveState ? loaded : null);

      await advance(1_000);
      expect(app.streams.active()).not.toContain(streamKey('pods', scope));
    }
  );
});

describe('auto-refresh pause', () => {
  it.each(['startup', 'background'] as const)(
    'blocks %s requests without asking the backend',
    async (reason) => {
      markClusterReady('paused-a');
      const scope = yamlScope('paused-a');
      setAutoRefresh(false);
      acquireRefreshDomainLease({ domain: 'object-yaml', scope });

      await expect(requestRefreshDomain({ domain: 'object-yaml', scope, reason })).resolves.toEqual(
        { status: 'blocked', blockedReason: 'auto-refresh-disabled' }
      );
      await settle();

      expect(isDataAccessBlocked(reason)).toBe(true);
      expect(readsOf('object-yaml', scope)).toBe(0);
      releaseRefreshDomainLease({ domain: 'object-yaml', scope });
    }
  );

  // Only a user request asks the backend to rebuild the snapshot before
  // reading it (a manual refresh job); foreground activation and startup reads
  // are not manual refreshes.
  it.each([
    { reason: 'user', paused: true, manualJob: true },
    { reason: 'foreground', paused: true, manualJob: false },
    { reason: 'startup', paused: false, manualJob: false },
  ] as const)(
    'runs $reason requests (paused=$paused) with the broker correlation id',
    async ({ reason, paused, manualJob }) => {
      markClusterReady('run-a');
      const scope = yamlScope('run-a');
      const correlationIds = recordCorrelationIds();
      setAutoRefresh(!paused);
      acquireRefreshDomainLease({ domain: 'object-yaml', scope });

      await expect(requestRefreshDomain({ domain: 'object-yaml', scope, reason })).resolves.toEqual(
        { status: 'executed' }
      );

      expect(correlationIds).toEqual(['broker-read-1']);
      expect(app.snapshots.requests().includes('POST /api/v2/refresh/object-yaml')).toBe(manualJob);
      releaseRefreshDomainLease({ domain: 'object-yaml', scope });
    }
  );
});

describe('one-shot refresh-domain reads', () => {
  // Typed table pages read one-shot query scopes. The read holds its own lease
  // from before the fetch until after its state is read, so the request never
  // disables a scope another consumer leases and returns the fetched rows.
  it.each([false, true])(
    'reads the scope under its own lease, then releases it (preserveState=%s)',
    async (preserveState) => {
      markClusterReady('oneshot-a');
      const scope = testScope('oneshot-a', '?limit=2');
      const payload = makeClusterConfigSnapshotPayload({ clusterId: 'oneshot-a' });
      app.snapshots.serve('cluster-config', scope, payload);

      const result = await requestRefreshDomainState({
        domain: 'cluster-config',
        scope,
        reason: 'user',
        preserveState,
      });

      expect(result).toEqual({
        status: 'executed',
        data: expect.objectContaining({ status: 'ready', data: payload, scope }),
      });
      expect(getScopedDomainState('cluster-config', scope).data).toEqual(
        preserveState ? payload : null
      );
      // Released: nothing keeps reading the scope.
      app.snapshots.clearReads();
      await advance(30_000);
      expect(readsOf('cluster-config', scope)).toBe(0);
    }
  );
});

describe('generic cluster-data reads', () => {
  it('executes the read with the broker request id and returns its data', async () => {
    const read = vi.fn().mockResolvedValue(['alpha', 'beta']);

    await expect(requestData({ resource: 'target-ports', reason: 'user', read })).resolves.toEqual({
      status: 'executed',
      data: ['alpha', 'beta'],
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('broker-read-1');
  });

  it('records diagnostics for blocked and executed reads', async () => {
    setAutoRefresh(false);
    await requestData({
      resource: 'namespaces',
      reason: 'startup',
      adapter: 'refresh-domain',
      label: 'Namespaces',
      scope: 'cluster:alpha',
      read: vi.fn(),
    });

    setAutoRefresh(true);
    await requestData({
      resource: 'query-permissions',
      reason: 'startup',
      adapter: 'permission-read',
      label: 'Query Permissions',
      scope: 'cluster:alpha',
      read: vi.fn().mockResolvedValue([]),
    });

    expect(getBrokerReadDiagnosticsSnapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          broker: 'data-access',
          resource: 'namespaces',
          label: 'Namespaces',
          adapter: 'refresh-domain',
          reason: 'startup',
          blockedCount: 1,
          lastStatus: 'blocked',
          lastScope: 'cluster:alpha',
          recentScopes: ['cluster:alpha'],
        }),
        expect.objectContaining({
          broker: 'data-access',
          resource: 'query-permissions',
          label: 'Query Permissions',
          adapter: 'permission-read',
          reason: 'startup',
          successCount: 1,
          lastStatus: 'success',
          lastScope: 'cluster:alpha',
          recentScopes: ['cluster:alpha'],
        }),
      ])
    );
  });

  it.each(['throw', 'reject'] as const)(
    'settles a failed read before rethrowing the original %s',
    async (failure) => {
      const error = new Error('read failed');
      const read = vi.fn(() => {
        expect(getBrokerReadDiagnosticsSnapshot()[0].inFlightCount).toBe(1);
        if (failure === 'throw') {
          throw error;
        }
        return Promise.reject(error);
      });

      await expect(requestData({ resource: 'pods', reason: 'user', read })).rejects.toBe(error);

      expect(getBrokerReadDiagnosticsSnapshot()).toEqual([
        expect.objectContaining({
          inFlightCount: 0,
          errorCount: 1,
          successCount: 0,
          lastStatus: 'error',
        }),
      ]);
    }
  );
});
