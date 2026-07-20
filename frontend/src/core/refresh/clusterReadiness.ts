/**
 * frontend/src/core/refresh/clusterReadiness.ts
 *
 * Tracks per-cluster lifecycle and foreground-activation state for the refresh
 * layer so dispatch is held while the backend cannot serve the cluster yet.
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
  private foregroundActivations = new Map<string, number>();
  private listeners = new Set<(clusterId: string) => void>();
  private foregroundActivationListeners = new Set<(clusterId: string) => void>();

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

  /** Whether lifecycle and foreground activation both allow snapshot dispatch. */
  isServiceable(clusterId: string | null | undefined): boolean {
    if (!clusterId) {
      return true;
    }
    const state = this.states.get(clusterId);
    if (state === undefined) {
      return !this.foregroundActivations.has(clusterId);
    }
    return SERVICEABLE_STATES.has(state) && !this.foregroundActivations.has(clusterId);
  }

  /** Hold refresh dispatch while backend foreground activation re-establishes producers. */
  beginForegroundActivation(clusterId: string): void {
    const normalized = clusterId.trim();
    if (!normalized) {
      return;
    }
    const pending = this.foregroundActivations.get(normalized) ?? 0;
    this.foregroundActivations.set(normalized, pending + 1);
    if (pending === 0) {
      this.foregroundActivationListeners.forEach((listener) => {
        listener(normalized);
      });
    }
  }

  /** Release one foreground activation hold and wake retained refresh demand when serviceable. */
  endForegroundActivation(clusterId: string): void {
    const normalized = clusterId.trim();
    if (!normalized) {
      return;
    }
    const pending = this.foregroundActivations.get(normalized) ?? 0;
    if (pending <= 1) {
      this.foregroundActivations.delete(normalized);
      if (pending === 1 && this.isServiceable(normalized)) {
        this.listeners.forEach((listener) => {
          listener(normalized);
        });
      }
      return;
    }
    this.foregroundActivations.set(normalized, pending - 1);
  }

  /** Fires on the not-serviceable → serviceable edge for a cluster. */
  onBecameServiceable(listener: (clusterId: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Fires when the first foreground activation hold begins for a cluster. */
  onForegroundActivationStarted(listener: (clusterId: string) => void): () => void {
    this.foregroundActivationListeners.add(listener);
    return () => {
      this.foregroundActivationListeners.delete(listener);
    };
  }

  // Clears tracked states only. Listener registrations belong to long-lived
  // modules (the orchestrator subscribes once at construction) and survive.
  resetForTests(): void {
    this.states.clear();
    this.foregroundActivations.clear();
  }
}

export const clusterReadiness = new ClusterReadinessTracker();
