import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { clusterWorkspaceStore } from './clusterWorkspaceStore';

export const useClusterWorkspaceSnapshot = () => {
  useEffect(() => clusterWorkspaceStore.acquire(), []);
  return useSyncExternalStore(
    clusterWorkspaceStore.subscribe,
    clusterWorkspaceStore.getSnapshot,
    clusterWorkspaceStore.getSnapshot
  );
};

export const useClusterNameResolver = () => {
  const snapshot = useClusterWorkspaceSnapshot();
  return useCallback(
    (clusterId: string | null | undefined): string | undefined => {
      const normalized = clusterId?.trim();
      return normalized ? snapshot.clusters.get(normalized)?.clusterName || undefined : undefined;
    },
    [snapshot.clusters]
  );
};
