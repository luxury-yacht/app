/**
 * frontend/src/core/refresh/hooks/useBackgroundClusterRefresh.ts
 *
 * React hook that bridges BackgroundClusterRefresher with context state.
 * Creates/manages the refresher instance and updates it when clusters or settings change.
 */

import { useEffect, useRef } from 'react';
import { useBackgroundRefresh } from './useBackgroundRefresh';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { BackgroundClusterRefresher } from '../backgroundClusterRefresher';
import type { NavigationTabState } from '@/core/contexts/ViewStateContext';

interface BackgroundClusterRefreshDeps {
  // Lookup a cluster's last-viewed navigation state.
  getClusterNavigationState: (clusterId: string) => NavigationTabState;
  // Lookup a cluster's selected namespace.
  getClusterNamespace: (clusterId: string) => string | undefined;
}

/**
 * Hook that manages the BackgroundClusterRefresher lifecycle.
 * Should be mounted inside ViewStateProvider so it has access to all needed contexts.
 */
export function useBackgroundClusterRefresh({
  getClusterNavigationState,
  getClusterNamespace,
}: BackgroundClusterRefreshDeps): void {
  const { enabled } = useBackgroundRefresh();
  const { selectedClusterId, selectedClusterIds } = useKubeconfig();

  const refresherRef = useRef<BackgroundClusterRefresher | null>(null);

  // Keep callback refs up to date without recreating the refresher.
  const getNavStateRef = useRef(getClusterNavigationState);
  getNavStateRef.current = getClusterNavigationState;
  const getNamespaceRef = useRef(getClusterNamespace);
  getNamespaceRef.current = getClusterNamespace;

  useEffect(() => {
    // Only run background refresh when enabled and multiple clusters are connected.
    const shouldRun = enabled && selectedClusterIds.length > 1;

    if (!shouldRun) {
      // Tear down if running.
      if (refresherRef.current) {
        refresherRef.current.stop();
        refresherRef.current = null;
      }
      return;
    }

    // Lazily create the refresher with stable callback wrappers.
    if (!refresherRef.current) {
      refresherRef.current = new BackgroundClusterRefresher(
        (clusterId) => getNavStateRef.current(clusterId),
        (clusterId) => getNamespaceRef.current(clusterId)
      );
    }

    // Push latest cluster state.
    refresherRef.current.updateClusters(selectedClusterId, selectedClusterIds);

    // Start if not already running.
    if (!refresherRef.current.running) {
      refresherRef.current.start();
    }

    return () => {
      // Cleanup on unmount or when deps change.
      refresherRef.current?.stop();
      refresherRef.current = null;
    };
  }, [enabled, selectedClusterId, selectedClusterIds]);
}
