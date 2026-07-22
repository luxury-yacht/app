/**
 * frontend/src/hooks/useWailsRuntimeEvents.ts
 *
 * Hook for useWailsRuntimeEvents.
 * Subscribes to Wails runtime events for UI actions (menu items, etc.), connection status updates,
 * and per-cluster health events.
 */
import { useCallback, useEffect, useMemo } from 'react';
import type { ClusterHealthStatus } from '@/core/cluster-workspace/clusterWorkspaceStore';
import { useClusterWorkspaceSnapshot } from '@/core/cluster-workspace/useClusterWorkspace';
import {
  type ConnectionStatusEvent,
  useConnectionStatusActions,
} from '@/core/connection/connectionStatus';

/**
 * Health status for a cluster.
 */
export type { ClusterHealthStatus } from '@/core/cluster-workspace/clusterWorkspaceStore';

/**
 * Return type for the useClusterHealthListener hook.
 */
export interface UseClusterHealthListenerResult {
  /** Map of cluster IDs to their health status. */
  clusterHealth: Map<string, ClusterHealthStatus>;
  /** Get health status for a specific cluster. Returns 'unknown' if not tracked. */
  getClusterHealth: (clusterId: string) => ClusterHealthStatus;
  /** Get health status for the active cluster. Returns 'unknown' if no active cluster. */
  getActiveClusterHealth: () => ClusterHealthStatus;
}

interface WailsRuntimeEventHandlers {
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onOpenCluster: () => void;
  onToggleSidebar: () => void;
  onToggleAppLogsPanel: () => void;
  onToggleDiagnostics: () => void;
  onToggleObjectDiff: () => void;
}

const subscribeRuntimeEvent = (
  runtime: WailsRuntime,
  event: string,
  handler: (...args: unknown[]) => void
): (() => void) => {
  const dispose = runtime.EventsOn?.(event, handler);
  if (typeof dispose === 'function') {
    return dispose;
  }
  return () => runtime.EventsOff?.(event, handler);
};

/**
 * Subscribes to Wails runtime events for UI actions (menu items, etc.)
 */
export function useWailsRuntimeEvents(handlers: WailsRuntimeEventHandlers): void {
  const {
    onOpenSettings,
    onOpenAbout,
    onOpenCluster,
    onToggleSidebar,
    onToggleAppLogsPanel,
    onToggleDiagnostics,
    onToggleObjectDiff,
  } = handlers;

  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    const eventHandlers: Array<[string, () => void]> = [
      ['open-settings', onOpenSettings],
      ['open-about', onOpenAbout],
      ['open-cluster', onOpenCluster],
      ['toggle-sidebar', onToggleSidebar],
      ['toggle-app-logs-panel', onToggleAppLogsPanel],
      ['toggle-diagnostics', onToggleDiagnostics],
      ['toggle-object-diff', onToggleObjectDiff],
    ];

    const disposers = eventHandlers.map(([event, handler]) =>
      subscribeRuntimeEvent(runtime, event, handler)
    );

    return () => {
      disposers.forEach((dispose) => {
        dispose();
      });
    };
  }, [
    onOpenSettings,
    onOpenAbout,
    onOpenCluster,
    onToggleSidebar,
    onToggleAppLogsPanel,
    onToggleDiagnostics,
    onToggleObjectDiff,
  ]);
}

/**
 * Subscribes to connection status events from Wails runtime
 */
export function useConnectionStatusListener(): void {
  const { updateFromEvent } = useConnectionStatusActions();

  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    const handleConnectionStatus = (...args: unknown[]) => {
      const payload = (args[0] as ConnectionStatusEvent) || undefined;
      updateFromEvent(payload);
    };

    const dispose = subscribeRuntimeEvent(runtime, 'connection-status', handleConnectionStatus);

    return () => {
      dispose();
    };
  }, [updateFromEvent]);
}

/**
 * Subscribes to per-cluster health events from Wails runtime.
 * Tracks health status (healthy/degraded) for each cluster independently.
 *
 * @param activeClusterId - The currently active cluster ID for getActiveClusterHealth()
 * @returns Object with clusterHealth Map and accessor functions
 */
export function useClusterHealthListener(
  activeClusterId: string = ''
): UseClusterHealthListenerResult {
  const workspace = useClusterWorkspaceSnapshot();
  const clusterHealth = useMemo(() => {
    const health = new Map<string, ClusterHealthStatus>();
    for (const [clusterId, cluster] of workspace.clusters) {
      if (cluster.health !== 'unknown') {
        health.set(clusterId, cluster.health);
      }
    }
    return health;
  }, [workspace.clusters]);

  // Accessor to get health status for a specific cluster.
  const getClusterHealth = useCallback(
    (clusterId: string): ClusterHealthStatus => {
      return clusterHealth.get(clusterId) || 'unknown';
    },
    [clusterHealth]
  );

  // Accessor to get health status for the active cluster.
  const getActiveClusterHealth = useCallback((): ClusterHealthStatus => {
    if (!activeClusterId) {
      return 'unknown';
    }
    return getClusterHealth(activeClusterId);
  }, [activeClusterId, getClusterHealth]);

  // Memoize the result object to prevent unnecessary re-renders.
  const result = useMemo(
    () => ({
      clusterHealth,
      getClusterHealth,
      getActiveClusterHealth,
    }),
    [clusterHealth, getClusterHealth, getActiveClusterHealth]
  );

  return result;
}
