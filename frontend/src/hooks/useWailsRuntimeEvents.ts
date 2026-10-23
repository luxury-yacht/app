/**
 * frontend/src/hooks/useWailsRuntimeEvents.ts
 *
 * Hook for useWailsRuntimeEvents.
 * Subscribes to Wails runtime events for UI actions (menu items, etc.), connection status updates,
 * and per-cluster health events.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { backend } from '@/core/backend-api/models';
import type { ClusterHealthStatus } from '@/core/cluster-workspace/clusterWorkspaceStore';
import { useClusterWorkspaceSnapshot } from '@/core/cluster-workspace/useClusterWorkspace';
import { onEvent } from '@/core/desktop-runtime';

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

const menuCommand = backend.ApplicationMenuCommand;

// The workspace commands the backend sends this window: native macOS menu
// items, and commands a panel window routes to its workspace window
// (internal/panelwindow/workspace_command.go). Each runs as its application
// menu command, under the same rules as the window's own accelerators.
const WORKSPACE_COMMAND_EVENTS = [
  ['open-settings', menuCommand.ApplicationMenuCommandSettings],
  ['open-about', menuCommand.ApplicationMenuCommandAbout],
  ['open-cluster', menuCommand.ApplicationMenuCommandOpenCluster],
  ['open-command-palette', menuCommand.ApplicationMenuCommandCommandPalette],
  ['toggle-sidebar', menuCommand.ApplicationMenuCommandToggleSidebar],
  ['toggle-app-logs-panel', menuCommand.ApplicationMenuCommandToggleAppLogs],
  ['toggle-diagnostics', menuCommand.ApplicationMenuCommandToggleDiagnostics],
  ['toggle-object-diff', menuCommand.ApplicationMenuCommandToggleObjectDiff],
] as const;

/**
 * Runs the workspace commands the backend sends this window with the
 * window's application menu command executor.
 */
export function useWailsRuntimeEvents(
  executeCommand: (command: backend.ApplicationMenuCommand) => void
): void {
  useEffect(() => {
    const disposers = WORKSPACE_COMMAND_EVENTS.map(([eventName, command]) =>
      onEvent(eventName, () => executeCommand(command))
    );
    return () => {
      disposers.forEach((dispose) => {
        dispose();
      });
    };
  }, [executeCommand]);
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
