import { useEffect, useSyncExternalStore } from 'react';
import { clusterWorkspaceStore } from './clusterWorkspaceStore';

export const useClusterWorkspaceSnapshot = () => {
  useEffect(() => clusterWorkspaceStore.acquire(), []);
  return useSyncExternalStore(
    clusterWorkspaceStore.subscribe,
    clusterWorkspaceStore.getSnapshot,
    clusterWorkspaceStore.getSnapshot
  );
};
