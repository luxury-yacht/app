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
      runtime.applyScopedDomainEnabled('cluster-config', 'cluster-a|namespace:default', true)
    ).toEqual({
      previous: undefined,
      changed: true,
      staleScopes: [],
    });
    expect(
      runtime.applyScopedDomainEnabled('cluster-config', 'cluster-a|namespace:kube-system', true)
    ).toEqual({
      previous: undefined,
      changed: true,
      staleScopes: ['cluster-a|namespace:default'],
    });
    expect(runtime.getEnabledScopes('cluster-config')).toEqual(['cluster-a|namespace:kube-system']);
    expect(runtime.isScopedDomainEnabled('cluster-config', 'cluster-a|namespace:default')).toBe(
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
    runtime.recordMetricsRefresh('cluster-config', 'cluster-a|', 10);
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
});
