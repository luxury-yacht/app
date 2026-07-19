/**
 * frontend/src/core/events/eventBus.ts
 *
 * Centralized event bus for type-safe inter-component communication.
 * Replaces scattered window.dispatchEvent/addEventListener calls.
 * Defines all app events and their payloads in one place.
 * Provides emit, on, once, and off methods for event management.
 * Includes error handling in event callbacks to prevent crashes.
 */

import type { ObjectDiffOpenRequest } from '@shared/components/diff/objectDiffSelection';
import type { GridTableFilterRequest } from '@shared/components/tables/hooks/gridTableFilterRequest';
import type { GridTableFocusRequest } from '@shared/components/tables/hooks/gridTableFocusRequest';
import type { ClusterLifecycleState } from '@/core/contexts/clusterLifecycleState';
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
  | 'cluster-rbac'
  | 'cluster-storage'
  | 'cluster-config'
  | 'cluster-crds'
  | 'cluster-custom'
  | 'nodes';

type DoorbellStreamDomain =
  | ResourceStreamDomain
  | 'catalog'
  | 'cluster-events'
  | 'namespace-events'
  | 'namespaces'
  | 'namespace-metrics'
  | 'object-events'
  | 'cluster-overview'
  | 'cluster-attention';

type ResourceStreamHealthStatus = 'healthy' | 'degraded' | 'unhealthy';
type ResourceStreamConnectionStatus = 'connected' | 'disconnected';

// Event payload types
export interface AppEvents {
  // Kubeconfig events
  'kubeconfig:changing': string; // config name
  'kubeconfig:changed': string; // config name
  'kubeconfig:selection-changed': undefined;

  // Open the command palette directly in kubeconfig-select mode — the entry
  // points for opening a cluster (the "+" in the cluster tab bar, ⌘O, and
  // File → Open Cluster).
  'command-palette:open-kubeconfigs': undefined;

  // Open the command palette directly in namespace-select mode — the search
  // button in the sidebar's Namespaces header (⇧⌘N reaches the same mode via
  // the frontend shortcut system).
  'command-palette:open-namespaces': undefined;

  // Open the command palette in its normal (search) mode — the header search
  // button.
  'command-palette:open': undefined;

  // Auth events — bridged from Wails runtime by AuthErrorContext.
  'cluster:auth:failed': { clusterId: string };
  'cluster:auth:recovered': { clusterId: string };

  // A cluster's namespace scope changed and its refresh subsystem finished
  // rebuilding (docs/plans/namespace-scope.md) — bridged from the Wails
  // cluster:scope:changed event by KubeconfigContext. Streams must restart
  // and the cluster's domains refetch.
  'cluster:scope-changed': { clusterId: string };

  // View events
  'view:reset': undefined;
  'view:toggle-diagnostics': undefined;
  'view:toggle-app-logs-panel': undefined;
  'view:open-object-diff': ObjectDiffOpenRequest;
  'cluster-tabs:order': string[];

  // Favorites events
  'favorites:changed': unknown[];

  // Refresh events
  /** A cluster's refresh runtime was torn down (cluster closed/deselected). */
  'refresh:cluster-pruned': { clusterId: string };
  'refresh:state-change': { name: string; state: RefresherState };
  'refresh:registered': { name: string };
  'refresh:start': { name: string; isManual: boolean };
  'refresh:complete': { name: string; isManual: boolean; success: boolean; error?: unknown };
  /** A stream scope got a permission-denied error frame: streaming for it is
   *  blocked (settled) until scope change / auth recovery clears the block. */
  'refresh:resource-stream-permission-denied': {
    domain: DoorbellStreamDomain;
    scope: string;
    reason: string;
  };
  'refresh:resource-stream-drift': {
    domain: ResourceStreamDomain;
    scope: string;
    reason: string;
    streamCount: number;
    snapshotCount: number;
    missingKeys: number;
    extraKeys: number;
  };
  'refresh:resource-stream-health': {
    domain: DoorbellStreamDomain;
    scope: string;
    status: ResourceStreamHealthStatus;
    reason: string;
    connectionStatus: ResourceStreamConnectionStatus;
    lastMessageAt?: number;
    lastDeliveryAt?: number;
  };

  // Settings events
  'settings:auto-refresh': boolean;
  'settings:refresh-background': boolean;
  'settings:short-names': boolean;
  'settings:dim-inactive-namespaces': boolean;
  'settings:exclusive-namespaces': boolean;
  'settings:appearance-mode': 'light' | 'dark' | 'system';
  'settings:kubernetes-client-qps': number;
  'settings:default-table-page-size': number;
  'settings:kubernetes-client-burst': number;
  'settings:permission-ssrr-fetch-concurrency': number;
  'settings:obj-panel-logs-buffer-size': number;
  'settings:obj-panel-logs-api-timestamp-format': string;
  'settings:obj-panel-logs-api-timestamp-use-local-time-zone': boolean;
  'settings:obj-panel-logs-target-per-scope-limit': number;
  'settings:obj-panel-logs-target-global-limit': number;
  'settings:palette-tint': {
    mode: 'light' | 'dark';
    hue: number;
    saturation: number;
    brightness: number;
  };
  'settings:accent-color': { mode: 'light' | 'dark'; color: string };
  'settings:link-color': { mode: 'light' | 'dark'; color: string };
  'settings:appearance-mode-resolved': 'light' | 'dark';

  // Feature events
  'gridtable:persistence-mode': 'namespaced' | 'shared';

  // Grid table external focus — emitted to request that a visible GridTable
  // finds and focuses a specific row matching the given resource fields.
  'gridtable:focus-request': GridTableFocusRequest;
  'gridtable:filter-request': GridTableFilterRequest;

  // Cluster lifecycle events — bridged from Wails runtime by ClusterLifecycleContext,
  // which closes the state union at the ingestion boundary.
  'cluster:lifecycle': { clusterId: string; state: ClusterLifecycleState };

  // App visibility events
  'app:visibility-hidden': undefined;
  'app:visibility-visible': undefined;
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
    if (!subs) {
      return;
    }

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

    toRemove.forEach((sub) => {
      subs.delete(sub);
    });
  }

  on<K extends keyof AppEvents>(event: K, callback: EventCallback<AppEvents[K]>): UnsubscribeFn {
    return this.subscribe(event, callback, false);
  }

  once<K extends keyof AppEvents>(event: K, callback: EventCallback<AppEvents[K]>): UnsubscribeFn {
    return this.subscribe(event, callback, true);
  }

  off<K extends keyof AppEvents>(event: K, callback: EventCallback<AppEvents[K]>): void {
    const subs = this.listeners.get(event);
    if (!subs) {
      return;
    }

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

    this.listeners.get(event)?.add(subscription);

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
