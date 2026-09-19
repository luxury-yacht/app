/**
 * frontend/src/core/refresh/hooks/useBackgroundClusterRefresh.ts
 *
 * React hook that bridges BackgroundClusterRefresher with context state.
 * Creates/manages the refresher instance and updates it when clusters or settings change.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useEffect, useRef } from 'react';
import type { NavigationTabState } from '@/core/contexts/ViewStateContext';
import { BackgroundClusterRefresher } from '../backgroundClusterRefresher';
import { useBackgroundRefresh } from './useBackgroundRefresh';

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

  // Keep callback refs up to date without recreating the refresher.
  const getNavStateRef = useRef(getClusterNavigationState);
  getNavStateRef.current = getClusterNavigationState;
  const getNamespaceRef = useRef(getClusterNamespace);
  getNamespaceRef.current = getClusterNamespace;

  useEffect(() => {
    if (!enabled || selectedClusterIds.length <= 1) {
      return;
    }

    const refresher = new BackgroundClusterRefresher(
      (clusterId) => getNavStateRef.current(clusterId),
      (clusterId) => getNamespaceRef.current(clusterId)
    );
    refresher.updateClusters(selectedClusterId, selectedClusterIds);
    refresher.start();
    return () => refresher.stop();
  }, [enabled, selectedClusterId, selectedClusterIds]);
}
