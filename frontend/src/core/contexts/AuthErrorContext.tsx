import type React from 'react';
import { createContext, useCallback, useContext, useMemo } from 'react';
import { RetryClusterAuth } from '@/core/backend-api';
import {
  applyAuthFailedEvent,
  applyAuthProgressEvent,
  applyAuthRecoveringEvent,
  type ClusterAuthState,
  DEFAULT_CLUSTER_AUTH_STATE,
  isConfirmedAuthFailure,
} from '@/core/cluster-workspace/clusterWorkspaceStore';
import { useClusterWorkspaceSnapshot } from '@/core/cluster-workspace/useClusterWorkspace';

export type { ClusterAuthState };
export {
  applyAuthFailedEvent,
  applyAuthProgressEvent,
  applyAuthRecoveringEvent,
  isConfirmedAuthFailure,
};

export interface AuthErrorContextValue {
  clusterAuthErrors: Map<string, ClusterAuthState>;
  getClusterAuthState: (clusterId: string) => ClusterAuthState;
  handleRetry: (clusterId: string) => Promise<void>;
}

const AuthErrorContext = createContext<AuthErrorContextValue | null>(null);

export const AuthErrorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const workspace = useClusterWorkspaceSnapshot();
  const clusterAuthErrors = useMemo(() => {
    const errors = new Map<string, ClusterAuthState>();
    for (const [clusterId, cluster] of workspace.clusters) {
      if (cluster.auth.hasError) {
        errors.set(clusterId, cluster.auth);
      }
    }
    return errors;
  }, [workspace.clusters]);
  const getClusterAuthState = useCallback(
    (clusterId: string) => workspace.clusters.get(clusterId)?.auth ?? DEFAULT_CLUSTER_AUTH_STATE,
    [workspace.clusters]
  );
  const handleRetry = useCallback(async (clusterId: string): Promise<void> => {
    if (!clusterId) {
      console.warn('[AuthErrorContext] handleRetry called without clusterId');
      return;
    }
    try {
      await RetryClusterAuth(clusterId);
    } catch (error) {
      console.error(`[AuthErrorContext] RetryClusterAuth failed for ${clusterId}:`, error);
    }
  }, []);
  const value = useMemo(
    () => ({ clusterAuthErrors, getClusterAuthState, handleRetry }),
    [clusterAuthErrors, getClusterAuthState, handleRetry]
  );
  return <AuthErrorContext.Provider value={value}>{children}</AuthErrorContext.Provider>;
};

export function useAuthError(): AuthErrorContextValue {
  const context = useContext(AuthErrorContext);
  if (!context) {
    throw new Error('useAuthError must be used within an AuthErrorProvider');
  }
  return context;
}

export function useActiveClusterAuthState(activeClusterId: string): ClusterAuthState {
  const { getClusterAuthState } = useAuthError();
  return useMemo(
    () => (activeClusterId ? getClusterAuthState(activeClusterId) : DEFAULT_CLUSTER_AUTH_STATE),
    [activeClusterId, getClusterAuthState]
  );
}
