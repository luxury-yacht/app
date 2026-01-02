/**
 * frontend/src/core/events/eventBus.ts
 *
 * Centralized event bus for type-safe inter-component communication.
 * Replaces scattered window.dispatchEvent/addEventListener calls.
 * Defines all app events and their payloads in one place.
 * Provides emit, on, once, and off methods for event management.
 * Includes error handling in event callbacks to prevent crashes.
 */

import type { RefresherState } from '@/core/refresh/RefreshManager';

type ResourceStreamDomain =
  | 'pods'
  | 'namespace-workloads'
  | 'namespace-config'
  | 'namespace-network'
  | 'namespace-rbac'
  | 'namespace-custom'
  | 'namespace-helm'
  | 'namespace-quotas'
  | 'namespace-storage'
  | 'namespace-autoscaling'
  | 'nodes';

// Event payload types
export interface AppEvents {
  // Kubeconfig events
  'kubeconfig:changing': string; // config name
  'kubeconfig:changed': string; // config name
  'kubeconfig:change-request': string; // config name to change to
  'kubeconfig:selection-changed': void;

  // View events
  'view:reset': void;
  'view:toggle-diagnostics': void;
  'view:toggle-app-logs': void;
  'cluster-tabs:order': string[];

  // Refresh events
  'refresh:state-change': { name: string; state: RefresherState };
  'refresh:registered': { name: string };
  'refresh:start': { name: string; isManual: boolean };
  'refresh:complete': { name: string; isManual: boolean; success: boolean; error?: unknown };
  'refresh:resource-stream-drift': {
    domain: ResourceStreamDomain;
    scope: string;
    reason: string;
    streamCount: number;
    snapshotCount: number;
    missingKeys: number;
    extraKeys: number;
  };

  // Settings events
  'settings:auto-refresh': boolean;
  'settings:refresh-background': boolean;
  'settings:short-names': boolean;
  'settings:theme': string;

  // Feature events
  'pods:show-unhealthy': { scope: string };
  'gridtable:persistence-mode': 'namespaced' | 'shared';

  // App visibility events
  'app:visibility-hidden': void;
  'app:visibility-visible': void;
}

type EventCallback<T> = (payload: T) => void;
type UnsubscribeFn = () => void;

interface Subscription {
  callback: EventCallback<unknown>;
  once: boolean;
}

class EventBus {
  private listeners = new Map<keyof AppEvents, Set<Subscription>>();

  emit<K extends keyof AppEvents>(
    event: K,
    ...args: AppEvents[K] extends void ? [] : [AppEvents[K]]
  ): void {
    const subs = this.listeners.get(event);
    if (!subs) return;

    const payload = args[0];
    const toRemove: Subscription[] = [];

    subs.forEach((sub) => {
      try {
        sub.callback(payload);
        if (sub.once) {
          toRemove.push(sub);
        }
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${event}":`, err);
      }
    });

    toRemove.forEach((sub) => subs.delete(sub));
  }

  on<K extends keyof AppEvents>(event: K, callback: EventCallback<AppEvents[K]>): UnsubscribeFn {
    return this.subscribe(event, callback, false);
  }

  once<K extends keyof AppEvents>(event: K, callback: EventCallback<AppEvents[K]>): UnsubscribeFn {
    return this.subscribe(event, callback, true);
  }

  off<K extends keyof AppEvents>(event: K, callback: EventCallback<AppEvents[K]>): void {
    const subs = this.listeners.get(event);
    if (!subs) return;

    for (const sub of subs) {
      if (sub.callback === callback) {
        subs.delete(sub);
        break;
      }
    }
  }

  private subscribe<K extends keyof AppEvents>(
    event: K,
    callback: EventCallback<AppEvents[K]>,
    once: boolean
  ): UnsubscribeFn {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const subscription: Subscription = {
      callback: callback as EventCallback<unknown>,
      once,
    };

    this.listeners.get(event)!.add(subscription);

    return () => {
      const subs = this.listeners.get(event);
      if (subs) {
        subs.delete(subscription);
      }
    };
  }

  // For debugging/testing
  listenerCount(event: keyof AppEvents): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}

// Singleton instance
export const eventBus = new EventBus();

// Re-export types for convenience
export type { UnsubscribeFn };
