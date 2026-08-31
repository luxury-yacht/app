import type React from 'react';
import { createContext, useCallback, useContext, useMemo } from 'react';
import { useClusterWorkspaceSnapshot } from '@/core/cluster-workspace/useClusterWorkspace';
import type { ClusterLifecycleState } from './clusterLifecycleState';

interface ClusterLifecycleContextType {
  getClusterState: (clusterId: string) => ClusterLifecycleState | undefined;
}

const ClusterLifecycleContext = createContext<ClusterLifecycleContextType | undefined>(undefined);

export const useClusterLifecycle = (): ClusterLifecycleContextType => {
  const context = useContext(ClusterLifecycleContext);
  if (!context) {
    throw new Error('useClusterLifecycle must be used within ClusterLifecycleProvider');
  }
  return context;
};

export const useOptionalClusterLifecycle = (): ClusterLifecycleContextType | undefined =>
  useContext(ClusterLifecycleContext);

export const ClusterLifecycleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const workspace = useClusterWorkspaceSnapshot();
  const getClusterState = useCallback(
    (clusterId: string) => workspace.clusters.get(clusterId)?.lifecycle,
    [workspace.clusters]
  );
  const value = useMemo(() => ({ getClusterState }), [getClusterState]);
  return (
    <ClusterLifecycleContext.Provider value={value}>{children}</ClusterLifecycleContext.Provider>
  );
};
