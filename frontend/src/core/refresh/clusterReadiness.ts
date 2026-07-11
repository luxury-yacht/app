/**
 * frontend/src/core/refresh/clusterReadiness.ts
 *
 * Tracks per-cluster lifecycle states for the refresh layer so dispatch can be
 * held for clusters whose backend refresh subsystem is not serving yet.
 *
 * Backend ordering (app_refresh_setup.go): snapshot services register before
 * the 'loading' lifecycle transition, so 'connecting'/'connected' requests
 * fail with "no active clusters available". Failure/teardown states
 * (auth_failed, disconnected, reconnecting) are likewise unserviceable until
 * the backend re-emits 'loading'.
 *
 * Unknown clusters (no lifecycle event seen) ALLOW dispatch: at app boot or
 * before hydration the backend simply answers, and the orchestrator classifies
 * its not-ready error as warm-up. Holding unknown clusters would risk freezing
 * healthy ones.
 */
import type { ClusterLifecycleState } from '@/core/contexts/clusterLifecycleState';
import { eventBus } from '@/core/events';

const SERVICEABLE_STATES: ReadonlySet<ClusterLifecycleState> = new Set<ClusterLifecycleState>([
  'loading',
  'loading_slow',
  'ready',
]);

class ClusterReadinessTracker {
  private states = new Map<string, ClusterLifecycleState>();
  private listeners = new Set<(clusterId: string) => void>();

  constructor() {
    eventBus.on('cluster:lifecycle', ({ clusterId, state }) => {
      if (!clusterId) {
        return;
      }
      const wasServiceable = this.isServiceable(clusterId);
      this.states.set(clusterId, state);
      if (!wasServiceable && this.isServiceable(clusterId)) {
        this.listeners.forEach((listener) => {
          listener(clusterId);
        });
      }
    });
  }

  /** Whether the cluster's backend refresh subsystem can serve requests. */
  isServiceable(clusterId: string | null | undefined): boolean {
    if (!clusterId) {
      return true;
    }
    const state = this.states.get(clusterId);
    if (state === undefined) {
      return true;
    }
    return SERVICEABLE_STATES.has(state);
  }

  /** Fires on the not-serviceable → serviceable edge for a cluster. */
  onBecameServiceable(listener: (clusterId: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Clears tracked states only. Listener registrations belong to long-lived
  // modules (the orchestrator subscribes once at construction) and survive.
  resetForTests(): void {
    this.states.clear();
  }
}

export const clusterReadiness = new ClusterReadinessTracker();
