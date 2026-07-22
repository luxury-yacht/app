import { describe, expect, it, vi } from 'vitest';

import { ClusterRefreshRuntime, makeInFlightKey } from './refreshRuntime';

describe('ClusterRefreshRuntime', () => {
  it('keeps enabled scoped domain state behind runtime operations', () => {
    const runtime = new ClusterRefreshRuntime('cluster-a');

    expect(runtime.isScopedDomainEnabled('pods', 'cluster-a|namespace:default')).toBe(true);
    expect(runtime.setScopedDomainEnabled('pods', 'cluster-a|namespace:default', true)).toEqual({
      previous: undefined,
      changed: true,
    });
    expect(runtime.setScopedDomainEnabled('pods', 'cluster-a|namespace:kube-system', true)).toEqual(
      {
        previous: undefined,
        changed: true,
      }
    );

    expect(runtime.hasEnabledScopedSources('pods')).toBe(true);
    expect(runtime.getEnabledScopes('pods')).toEqual([
      'cluster-a|namespace:default',
      'cluster-a|namespace:kube-system',
    ]);

    expect(
      runtime.applyScopedDomainEnabled('cluster-overview', 'cluster-a|namespace:default', true)
    ).toEqual({
      previous: undefined,
      changed: true,
      staleScopes: [],
    });
    expect(
      runtime.applyScopedDomainEnabled('cluster-overview', 'cluster-a|namespace:kube-system', true)
    ).toEqual({
      previous: undefined,
      changed: true,
      staleScopes: ['cluster-a|namespace:default'],
    });
    expect(runtime.getEnabledScopes('cluster-overview')).toEqual([
      'cluster-a|namespace:kube-system',
    ]);
    expect(runtime.isScopedDomainEnabled('cluster-overview', 'cluster-a|namespace:default')).toBe(
      false
    );

    expect(runtime.applyScopedDomainEnabled('pods', 'cluster-a|namespace:prod', true)).toEqual({
      previous: undefined,
      changed: true,
      staleScopes: [],
    });
    expect(runtime.getEnabledScopes('pods')).toEqual([
      'cluster-a|namespace:default',
      'cluster-a|namespace:kube-system',
      'cluster-a|namespace:prod',
    ]);
  });

  it('keeps live resource-stream table scopes enabled while typed query scopes run', () => {
    const runtime = new ClusterRefreshRuntime('cluster-a');

    expect(runtime.applyScopedDomainEnabled('nodes', 'cluster-a|', true)).toEqual({
      previous: undefined,
      changed: true,
      staleScopes: [],
    });
    expect(
      runtime.applyScopedDomainEnabled(
        'nodes',
        'cluster-a|?limit=50&sort=name&sortDirection=asc',
        true
      )
    ).toEqual({
      previous: undefined,
      changed: true,
      staleScopes: [],
    });

    expect(runtime.getEnabledScopes('nodes')).toEqual([
      'cluster-a|',
      'cluster-a|?limit=50&sort=name&sortDirection=asc',
    ]);
    expect(runtime.isScopedDomainEnabled('nodes', 'cluster-a|')).toBe(true);

    expect(
      runtime.applyScopedDomainEnabled(
        'nodes',
        'cluster-a|?limit=50&sort=name&sortDirection=asc',
        false
      )
    ).toEqual({
      previous: true,
      changed: true,
      staleScopes: [],
    });

    expect(runtime.getEnabledScopes('nodes')).toEqual(['cluster-a|']);
  });

  it('owns async streaming lifecycle bookkeeping', async () => {
    const runtime = new ClusterRefreshRuntime('cluster-a');
    const cleanup = vi.fn();
    const startPromise = Promise.resolve(cleanup);

    runtime.beginStreamingStart('cluster-config', 'cluster-a|', startPromise);
    expect(runtime.isStreamingStartingOrActive('cluster-config', 'cluster-a|')).toBe(true);
    expect(runtime.getStreamingLifecycleKeys()).toEqual([
      makeInFlightKey('cluster-config', 'cluster-a|'),
    ]);

    runtime.finishStreamingStart('cluster-config', 'cluster-a|', await startPromise);

    expect(runtime.hasPendingStreaming('cluster-config', 'cluster-a|')).toBe(false);
    expect(runtime.isStreamingActive('cluster-config', 'cluster-a|')).toBe(true);
    expect(runtime.getStreamingCleanup('cluster-config', 'cluster-a|')).toBe(cleanup);

    const pending = runtime.cancelStreamingStart('cluster-config', 'cluster-a|');
    expect(pending).toBeNull();
    expect(runtime.isStreamingCancelled('cluster-config', 'cluster-a|')).toBe(true);

    runtime.deleteStreamingCleanup('cluster-config', 'cluster-a|');
    runtime.clearStreamingCancelled('cluster-config', 'cluster-a|');

    expect(runtime.isStreamingStartingOrActive('cluster-config', 'cluster-a|')).toBe(false);
    expect(runtime.isStreamingCancelled('cluster-config', 'cluster-a|')).toBe(false);
  });

  it('tears down in-flight work and transient cluster state', () => {
    const runtime = new ClusterRefreshRuntime('cluster-a');
    const controller = new AbortController();
    const cleanup = vi.fn();
    const request = {
      controller,
      cleanup,
      isManual: false,
      requestId: 1,
      contextVersion: 0,
      domain: 'cluster-config' as const,
      scope: 'cluster-a|',
    };

    const key = runtime.setInFlight(request);
    runtime.setScopedDomainEnabled('cluster-config', 'cluster-a|', true);
    runtime.blockStreaming('cluster-config', 'cluster-a|');
    runtime.setStreamHealth('cluster-config', 'cluster-a|', {
      domain: 'cluster-config',
      scope: 'cluster-a|',
      status: 'healthy',
      reason: 'connected',
      connectionStatus: 'connected',
    });

    runtime.teardownInFlight(key, request);

    expect(controller.signal.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalled();
    expect(runtime.getInFlight('cluster-config', 'cluster-a|')).toBeUndefined();

    runtime.resetTransientState();

    expect(runtime.isStreamingBlocked('cluster-config', 'cluster-a|')).toBe(false);
    expect(runtime.getEnabledScopes('cluster-config')).toEqual(['cluster-a|']);
  });

  it('reference-counts scoped leases so concurrent holders share one enable', () => {
    const runtime = new ClusterRefreshRuntime('cluster-a');

    expect(runtime.hasScopedLease('nodes', 'cluster-a|')).toBe(false);
    expect(runtime.getScopedLeaseCount('nodes', 'cluster-a|')).toBe(0);

    // Old table instance acquires the first lease.
    expect(runtime.acquireScopedLease('nodes', 'cluster-a|')).toEqual({
      count: 1,
      firstLease: true,
    });
    // New instance mounts before the old one unmounts: shares the lease.
    expect(runtime.acquireScopedLease('nodes', 'cluster-a|')).toEqual({
      count: 2,
      firstLease: false,
    });
    expect(runtime.hasScopedLease('nodes', 'cluster-a|')).toBe(true);

    // Old instance unmounts: a holder remains, so this is not the last lease.
    expect(runtime.releaseScopedLease('nodes', 'cluster-a|')).toEqual({
      count: 1,
      lastLease: false,
      hadLease: true,
    });
    expect(runtime.hasScopedLease('nodes', 'cluster-a|')).toBe(true);

    // New instance unmounts: the final lease is gone.
    expect(runtime.releaseScopedLease('nodes', 'cluster-a|')).toEqual({
      count: 0,
      lastLease: true,
      hadLease: true,
    });
    expect(runtime.hasScopedLease('nodes', 'cluster-a|')).toBe(false);

    // Over-release is a no-op and never produces a negative count.
    expect(runtime.releaseScopedLease('nodes', 'cluster-a|')).toEqual({
      count: 0,
      lastLease: false,
      hadLease: false,
    });
    expect(runtime.getScopedLeaseCount('nodes', 'cluster-a|')).toBe(0);
  });

  it('tracks query and snapshot demand independently within one scoped lease count', () => {
    const runtime = new ClusterRefreshRuntime('cluster-a');
    const scope = 'cluster-a|';

    expect(runtime.acquireScopedLease('nodes', scope, 'query')).toEqual({
      count: 1,
      firstLease: true,
    });
    expect(runtime.getScopedLeaseCount('nodes', scope, 'query')).toBe(1);
    expect(runtime.getScopedLeaseCount('nodes', scope, 'snapshot')).toBe(0);

    expect(runtime.acquireScopedLease('nodes', scope, 'snapshot')).toEqual({
      count: 2,
      firstLease: false,
    });
    expect(runtime.getScopedLeaseCount('nodes', scope)).toBe(2);
    expect(runtime.hasScopedDemand('nodes', scope, 'snapshot')).toBe(true);

    expect(runtime.releaseScopedLease('nodes', scope, 'query')).toEqual({
      count: 1,
      lastLease: false,
      hadLease: true,
    });
    expect(runtime.hasScopedDemand('nodes', scope, 'query')).toBe(false);
    expect(runtime.hasScopedDemand('nodes', scope, 'snapshot')).toBe(true);

    expect(runtime.releaseScopedLease('nodes', scope, 'snapshot')).toEqual({
      count: 0,
      lastLease: true,
      hadLease: true,
    });
  });

  it('skips polling for covered pods scopes while the stream is healthy and snapshots when it is not', async () => {
    // Metric cadence for pods/nodes/namespace-workloads is push-driven (the
    // backend fans a metric doorbell over the resources stream), so a healthy
    // stream with data means no client-side poll at all; the poll runs only as
    // the stream-down fallback.
    const runtime = new ClusterRefreshRuntime('cluster-a');
    const scope = 'cluster-a|namespace:default';
    const startPromise = Promise.resolve(vi.fn());
    runtime.beginStreamingStart('pods', scope, startPromise);
    runtime.finishStreamingStart('pods', scope, await startPromise);

    const base = {
      domain: 'pods' as const,
      scope,
      isManual: false,
      shouldStream: true,
      hasData: true,
    };
    expect(runtime.resolveStreamingFetchMode({ ...base, streamingHealthy: true })).toBe('skip');
    expect(runtime.resolveStreamingFetchMode({ ...base, streamingHealthy: false })).toBe(
      'snapshot'
    );
  });

  it('never skips a stream-signal fetch — the doorbell IS the stream saying data changed', async () => {
    // Found live: the namespaces doorbell was delivered and applied, but the
    // refetch it triggered routed through the same gate that skips polls while
    // the stream is healthy — swallowing the doorbell entirely (frozen list).
    const runtime = new ClusterRefreshRuntime('cluster-a');
    const scope = 'cluster-a|';
    const startPromise = Promise.resolve(vi.fn());
    runtime.beginStreamingStart('namespaces', scope, startPromise);
    runtime.finishStreamingStart('namespaces', scope, await startPromise);

    expect(
      runtime.resolveStreamingFetchMode({
        domain: 'namespaces' as const,
        scope,
        isManual: false,
        shouldStream: true,
        streamingHealthy: true,
        hasData: true,
        streamSignal: true,
      })
    ).toBe('snapshot');
  });

  it('fetches a snapshot for a no-data scope even when the stream is healthy, but skips once it has data', () => {
    const runtime = new ClusterRefreshRuntime('cluster-a');
    const base = {
      domain: 'catalog' as const,
      scope: 'cluster-a|limit=50&kind=Widget&namespace=cluster',
      isManual: false,
      shouldStream: true,
      streamingHealthy: true,
    };
    // A brand-new filter/page scope has no data yet — the notify-only stream cannot
    // deliver its first page, so it MUST fetch even though the stream is healthy.
    expect(runtime.resolveStreamingFetchMode({ ...base, hasData: false })).toBe('snapshot');
    // Once the scope holds data, the healthy stream keeps it fresh → skip the poll.
    expect(runtime.resolveStreamingFetchMode({ ...base, hasData: true })).toBe('skip');
  });
});
