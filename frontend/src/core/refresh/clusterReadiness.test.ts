/**
 * frontend/src/core/refresh/clusterReadiness.test.ts
 *
 * The refresh layer's view of cluster lifecycle readiness: dispatch is held
 * for clusters whose backend refresh subsystem is not serving yet
 * ('connecting'/'connected' precede service registration; 'loading' onward
 * serves). Unknown clusters allow dispatch — the orchestrator classifies the
 * backend's not-ready error for that race instead of guessing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClusterLifecycleState } from '@/core/contexts/clusterLifecycleState';
import { eventBus } from '@/core/events';
import { clusterReadiness } from './clusterReadiness';

const lifecycle = (clusterId: string, state: ClusterLifecycleState) => {
  eventBus.emit('cluster:lifecycle', { clusterId, state });
};

describe('clusterReadiness', () => {
  beforeEach(() => {
    clusterReadiness.resetForTests();
  });

  it('treats unknown clusters as serviceable (backend answers the race)', () => {
    expect(clusterReadiness.isServiceable('never-seen')).toBe(true);
    expect(clusterReadiness.isServiceable(null)).toBe(true);
    expect(clusterReadiness.isServiceable(undefined)).toBe(true);
  });

  it('blocks dispatch before the backend registers services, allows from loading onward', () => {
    lifecycle('cluster-a', 'connecting');
    expect(clusterReadiness.isServiceable('cluster-a')).toBe(false);
    lifecycle('cluster-a', 'connected');
    expect(clusterReadiness.isServiceable('cluster-a')).toBe(false);
    lifecycle('cluster-a', 'loading');
    expect(clusterReadiness.isServiceable('cluster-a')).toBe(true);
    lifecycle('cluster-a', 'loading_slow');
    expect(clusterReadiness.isServiceable('cluster-a')).toBe(true);
    lifecycle('cluster-a', 'ready');
    expect(clusterReadiness.isServiceable('cluster-a')).toBe(true);
  });

  it('treats failure and teardown states as unserviceable', () => {
    for (const state of ['auth_failed', 'disconnected', 'reconnecting'] as const) {
      lifecycle('cluster-a', state);
      expect(clusterReadiness.isServiceable('cluster-a')).toBe(false);
    }
  });

  it('fires the became-serviceable edge once per transition', () => {
    const listener = vi.fn();
    clusterReadiness.onBecameServiceable(listener);

    lifecycle('cluster-a', 'connecting');
    expect(listener).not.toHaveBeenCalled();

    lifecycle('cluster-a', 'loading');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('cluster-a');

    // Staying serviceable is not an edge.
    lifecycle('cluster-a', 'ready');
    expect(listener).toHaveBeenCalledTimes(1);

    // Going unserviceable and recovering is a new edge.
    lifecycle('cluster-a', 'reconnecting');
    lifecycle('cluster-a', 'loading');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes listeners', () => {
    const listener = vi.fn();
    const off = clusterReadiness.onBecameServiceable(listener);
    off();
    lifecycle('cluster-a', 'connecting');
    lifecycle('cluster-a', 'loading');
    expect(listener).not.toHaveBeenCalled();
  });
});
