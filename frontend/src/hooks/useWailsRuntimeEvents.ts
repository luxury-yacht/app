/**
 * frontend/src/hooks/useWailsRuntimeEvents.ts
 *
 * Hook for useWailsRuntimeEvents.
 * Subscribes to Wails runtime events for UI actions (menu items, etc.), connection status updates,
 * and per-cluster health events.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ConnectionStatusEvent,
  useConnectionStatusActions,
} from '@/core/connection/connectionStatus';

/**
 * Health status for a cluster.
 */
export type ClusterHealthStatus = 'healthy' | 'degraded' | 'unknown';

/**
 * Payload structure for cluster health events from the backend.
 */
interface ClusterHealthEventPayload {
  clusterId?: string;
}

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
  onToggleSidebar: () => void;
  onToggleAppLogs: () => void;
  onToggleDiagnostics: () => void;
  onToggleObjectDiff: () => void;
  onTogglePortForwards: () => void;
}

/**
 * Subscribes to Wails runtime events for UI actions (menu items, etc.)
 */
export function useWailsRuntimeEvents(handlers: WailsRuntimeEventHandlers): void {
  const {
    onOpenSettings,
    onOpenAbout,
    onToggleSidebar,
    onToggleAppLogs,
    onToggleDiagnostics,
    onToggleObjectDiff,
    onTogglePortForwards,
  } = handlers;

  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    const eventHandlers: Array<[string, () => void]> = [
      ['open-settings', onOpenSettings],
      ['open-about', onOpenAbout],
      ['toggle-sidebar', onToggleSidebar],
      ['toggle-app-logs', onToggleAppLogs],
      ['toggle-diagnostics', onToggleDiagnostics],
      ['toggle-object-diff', onToggleObjectDiff],
      ['toggle-port-forwards', onTogglePortForwards],
    ];

    eventHandlers.forEach(([event, handler]) => runtime.EventsOn?.(event, handler));

    return () => {
      eventHandlers.forEach(([event]) => runtime.EventsOff?.(event));
    };
  }, [
    onOpenSettings,
    onOpenAbout,
    onToggleSidebar,
    onToggleAppLogs,
    onToggleDiagnostics,
    onToggleObjectDiff,
    onTogglePortForwards,
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

    runtime.EventsOn('connection-status', handleConnectionStatus);

    return () => {
      runtime.EventsOff?.('connection-status');
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
  // Track health status per cluster.
  const [clusterHealth, setClusterHealth] = useState<Map<string, ClusterHealthStatus>>(
    () => new Map()
  );

  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    // Handler for cluster:health:healthy events.
    const handleHealthy = (...args: unknown[]) => {
      const payload = args[0] as ClusterHealthEventPayload | undefined;
      if (!payload?.clusterId) {
        console.warn('[ClusterHealthListener] Received health:healthy without clusterId', args);
        return;
      }

      setClusterHealth((prev) => {
        const next = new Map(prev);
        next.set(payload.clusterId!, 'healthy');
        return next;
      });
    };

    // Handler for cluster:health:degraded events.
    const handleDegraded = (...args: unknown[]) => {
      const payload = args[0] as ClusterHealthEventPayload | undefined;
      if (!payload?.clusterId) {
        console.warn('[ClusterHealthListener] Received health:degraded without clusterId', args);
        return;
      }

      setClusterHealth((prev) => {
        const next = new Map(prev);
        next.set(payload.clusterId!, 'degraded');
        return next;
      });
    };

    // Subscribe to cluster health events.
    runtime.EventsOn('cluster:health:healthy', handleHealthy);
    runtime.EventsOn('cluster:health:degraded', handleDegraded);

    return () => {
      runtime.EventsOff?.('cluster:health:healthy');
      runtime.EventsOff?.('cluster:health:degraded');
    };
  }, []);

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
