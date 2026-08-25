import { describe, expect, it, vi } from 'vitest';

import {
  ClusterRefreshRuntime,
  makeInFlightKey,
  transitionClusterAuthState,
  transitionScopedActivationState,
  transitionScopedFetchState,
  transitionScopedPermissionState,
  transitionScopedReadinessState,
  transitionScopedStreamState,
} from './refreshRuntime';

describe('transitionScopedStreamState', () => {
  it('keeps one start owner and rejects a stale completion', () => {
    const firstTask = Promise.resolve<(() => void) | undefined>(undefined);
    const replacementTask = Promise.resolve<(() => void) | undefined>(undefined);
    const cleanup = vi.fn();
    let state = transitionScopedStreamState(
      {
        policy: 'allowed',
        initialization: { status: 'idle' },
        connection: { status: 'inactive' },
        health: { status: 'unknown' },
      },
      { type: 'start-began', task: firstTask }
    );
    state = transitionScopedStreamState(state, { type: 'start-cancelled' });
    state = transitionScopedStreamState(state, {
      type: 'start-began',
      task: replacementTask,
    });

    expect(
      transitionScopedStreamState(state, {
        type: 'start-finished',
        task: firstTask,
        cleanup,
      })
    ).toBe(state);
    expect(
      transitionScopedStreamState(state, {
        type: 'start-finished',
        task: replacementTask,
        cleanup,
      })
    ).toEqual({
      policy: 'allowed',
      initialization: { status: 'idle' },
      connection: { status: 'active', cleanup, cancellationRequested: false },
      health: { status: 'unknown' },
    });
  });
});

describe('scoped readiness, permission, and cluster auth transitions', () => {
  it('coalesces deferred intent and resets permission only at a new epoch', () => {
    const first = {
      domain: 'cluster-config' as const,
      scope: 'cluster-a|',
      isManual: false,
      streamSignal: true,
      queryReconcile: false,
    };
    let readiness = transitionScopedReadinessState(
      { status: 'ready' },
      { type: 'request-deferred', request: first }
    );
    readiness = transitionScopedReadinessState(readiness, {
      type: 'request-deferred',
      request: { ...first, isManual: true, streamSignal: false, queryReconcile: true },
    });

    expect(readiness).toEqual({
      status: 'waiting',
      request: { ...first, isManual: true, streamSignal: true, queryReconcile: true },
    });
    expect(transitionScopedReadinessState(readiness, { type: 'cluster-ready' })).toEqual({
      status: 'ready',
    });

    const denied = transitionScopedPermissionState(
      { status: 'unknown' },
      { type: 'permission-denied' }
    );
    expect(denied).toEqual({ status: 'denied' });
    expect(transitionScopedPermissionState(denied, { type: 'permission-allowed' })).toEqual({
      status: 'allowed',
    });
    expect(transitionScopedPermissionState(denied, { type: 'permission-epoch-reset' })).toEqual({
      status: 'unknown',
    });
  });

  it('makes duplicate auth lifecycle events no-ops', () => {
    const failed = transitionClusterAuthState({ status: 'available' }, { type: 'auth-failed' });
    expect(failed).toEqual({ status: 'failed' });
    expect(transitionClusterAuthState(failed, { type: 'auth-failed' })).toBe(failed);
    expect(transitionClusterAuthState(failed, { type: 'auth-recovered' })).toEqual({
      status: 'available',
    });
  });
});

describe('transitionScopedActivationState', () => {
  it('keeps enablement and query/snapshot demand in one valid state', () => {
    let state = transitionScopedActivationState(
      { status: 'untracked' },
      { type: 'lease-acquired', demand: 'query' }
    );

    expect(state).toEqual({
      status: 'enabled',
      demands: { query: 1, snapshot: 0 },
    });
    expect(transitionScopedActivationState(state, { type: 'disabled' })).toBe(state);

    state = transitionScopedActivationState(state, {
      type: 'lease-acquired',
      demand: 'snapshot',
    });
    state = transitionScopedActivationState(state, {
      type: 'lease-released',
      demand: 'query',
    });

    expect(state).toEqual({
      status: 'enabled',
      demands: { query: 0, snapshot: 1 },
    });

    state = transitionScopedActivationState(state, {
      type: 'lease-released',
      demand: 'snapshot',
    });
    expect(state).toEqual({
      status: 'enabled',
      demands: { query: 0, snapshot: 0 },
    });
    expect(transitionScopedActivationState(state, { type: 'disabled' })).toEqual({
      status: 'disabled',
    });
  });
});

describe('transitionScopedFetchState', () => {
  it('keeps replacement ownership and coalesces repeated stream signals', () => {
    const firstRequest = {
      controller: new AbortController(),
      isManual: false,
      requestId: 1,
      contextVersion: 0,
      domain: 'cluster-config' as const,
      scope: 'cluster-a|',
    };
    const replacementRequest = {
      ...firstRequest,
      controller: new AbortController(),
      isManual: true,
      requestId: 2,
    };

    let state = transitionScopedFetchState(
      { status: 'idle' },
      { type: 'fetch-started', request: firstRequest }
    );
    state = transitionScopedFetchState(state, { type: 'stream-signal-received' });
    state = transitionScopedFetchState(state, { type: 'stream-signal-received' });

    expect(state).toEqual({
      status: 'fetching',
      request: firstRequest,
      trailingStreamSignal: true,
    });

    state = transitionScopedFetchState(state, {
      type: 'fetch-started',
      request: replacementRequest,
    });
    const afterStaleSettle = transitionScopedFetchState(state, {
      type: 'fetch-settled',
      requestId: firstRequest.requestId,
    });
    const afterStaleCancel = transitionScopedFetchState(afterStaleSettle, {
      type: 'fetch-cancelled',
      requestId: firstRequest.requestId,
    });

    expect(afterStaleSettle).toBe(state);
    expect(afterStaleCancel).toBe(state);
    expect(
      transitionScopedFetchState(afterStaleCancel, {
        type: 'fetch-settled',
        requestId: replacementRequest.requestId,
      })
    ).toEqual({ status: 'idle' });
  });
});

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

    runtime.finishStreamingStart('cluster-config', 'cluster-a|', startPromise, await startPromise);

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

  it('ignores stale settle and cancel events after a request is replaced', () => {
    const runtime = new ClusterRefreshRuntime('cluster-a');
    const scope = 'cluster-a|';
    const firstRequest = {
      controller: new AbortController(),
      isManual: false,
      requestId: 1,
      contextVersion: 0,
      domain: 'cluster-config' as const,
      scope,
    };
    const replacementRequest = {
      ...firstRequest,
      controller: new AbortController(),
      isManual: true,
      requestId: 2,
    };

    const key = runtime.setInFlight(firstRequest);
    runtime.setInFlight(replacementRequest);

    expect(runtime.settleInFlight('cluster-config', scope, firstRequest.requestId)).toBeUndefined();
    expect(runtime.teardownInFlight(key, firstRequest)).toBeUndefined();
    expect(replacementRequest.controller.signal.aborted).toBe(false);
    expect(runtime.getInFlight('cluster-config', scope)?.requestId).toBe(
      replacementRequest.requestId
    );

    expect(runtime.settleInFlight('cluster-config', scope, replacementRequest.requestId)).toEqual({
      ...replacementRequest,
      trailingStreamSignal: false,
    });
    expect(runtime.getInFlight('cluster-config', scope)).toBeUndefined();
  });

  it('reference-counts scoped leases so concurrent holders share one enable', () => {
    const runtime = new ClusterRefreshRuntime('cluster-a');

    expect(runtime.hasScopedLease('nodes', 'cluster-a|')).toBe(false);
    expect(runtime.getScopedLeaseCount('nodes', 'cluster-a|')).toBe(0);

    // Old table instance acquires the first lease.
    expect(runtime.acquireScopedLease('nodes', 'cluster-a|')).toEqual({
      count: 1,
      firstLease: true,
      activationChanged: true,
    });
    // New instance mounts before the old one unmounts: shares the lease.
    expect(runtime.acquireScopedLease('nodes', 'cluster-a|')).toEqual({
      count: 2,
      firstLease: false,
      activationChanged: false,
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
      activationChanged: true,
    });
    expect(runtime.getScopedLeaseCount('nodes', scope, 'query')).toBe(1);
    expect(runtime.getScopedLeaseCount('nodes', scope, 'snapshot')).toBe(0);

    expect(runtime.acquireScopedLease('nodes', scope, 'snapshot')).toEqual({
      count: 2,
      firstLease: false,
      activationChanged: false,
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
    runtime.finishStreamingStart('pods', scope, startPromise, await startPromise);

    const base = {
      domain: 'pods' as const,
      scope,
      isManual: false,
      shouldStream: true,
      hasData: true,
    };
    expect(runtime.resolveStreamingFetchMode({ ...base, streamingHealthy: true })).toEqual({
      mode: 'skip',
      fallback: false,
    });
    // A poll that runs only because the stream is not delivering IS the
    // stream-down fallback, and must be counted as one.
    expect(runtime.resolveStreamingFetchMode({ ...base, streamingHealthy: false })).toEqual({
      mode: 'snapshot',
      fallback: true,
    });
  });

  it('never skips a stream-signal fetch — the doorbell IS the stream saying data changed', async () => {
    // Found live: the namespaces doorbell was delivered and applied, but the
    // refetch it triggered routed through the same gate that skips polls while
    // the stream is healthy — swallowing the doorbell entirely (frozen list).
    const runtime = new ClusterRefreshRuntime('cluster-a');
    const scope = 'cluster-a|';
    const startPromise = Promise.resolve(vi.fn());
    runtime.beginStreamingStart('namespaces', scope, startPromise);
    runtime.finishStreamingStart('namespaces', scope, startPromise, await startPromise);

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
    ).toEqual({ mode: 'snapshot', fallback: false });
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
    expect(runtime.resolveStreamingFetchMode({ ...base, hasData: false })).toEqual({
      mode: 'snapshot',
      fallback: false,
    });
    // Once the scope holds data, the healthy stream keeps it fresh → skip the poll.
    expect(runtime.resolveStreamingFetchMode({ ...base, hasData: true })).toEqual({
      mode: 'skip',
      fallback: false,
    });
  });
});
