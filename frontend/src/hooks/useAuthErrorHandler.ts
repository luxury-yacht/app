/**
 * frontend/src/hooks/useAuthErrorHandler.ts
 *
 * Hook for handling authentication state changes from the backend.
 * Subscribes to cluster:auth:failed, cluster:auth:recovering, and cluster:auth:recovered
 * events from the Wails runtime and tracks auth state per cluster.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';

/**
 * Auth state for a single cluster.
 */
export interface ClusterAuthState {
  /** Whether the cluster has an active auth error. */
  hasError: boolean;
  /** The reason for the auth failure. */
  reason: string;
  /** Human-readable cluster name. */
  clusterName: string;
  /** Whether auth recovery is in progress. */
  isRecovering: boolean;
}

/**
 * Default auth state for clusters with no errors.
 */
const DEFAULT_AUTH_STATE: ClusterAuthState = {
  hasError: false,
  reason: '',
  clusterName: '',
  isRecovering: false,
};

/**
 * Payload structure sent by the backend for auth events.
 */
interface AuthEventPayload {
  clusterId?: string;
  clusterName?: string;
  reason?: string;
}

/**
 * Return type for the useAuthErrorHandler hook.
 */
export interface UseAuthErrorHandlerResult {
  /** Map of cluster IDs to their auth state. */
  clusterAuthErrors: Map<string, ClusterAuthState>;
  /** Get auth state for a specific cluster. Returns default state if not found. */
  getClusterAuthState: (clusterId: string) => ClusterAuthState;
  /** Get auth state for the active cluster. Returns default state if no active cluster. */
  getActiveClusterAuthState: () => ClusterAuthState;
  /** Retry authentication for a specific cluster. */
  handleRetry: (clusterId: string) => Promise<void>;
}

/**
 * Subscribes to backend authentication events and tracks auth state per cluster.
 * When auth fails, records the error for that specific cluster.
 * When auth recovers, clears the error for that cluster.
 *
 * @param activeClusterId - The currently active cluster ID for getActiveClusterAuthState()
 * @returns Object with clusterAuthErrors Map and accessor functions
 */
export function useAuthErrorHandler(activeClusterId: string = ''): UseAuthErrorHandlerResult {
  // Track auth errors per cluster instead of a single global boolean.
  const [clusterAuthErrors, setClusterAuthErrors] = useState<Map<string, ClusterAuthState>>(
    () => new Map()
  );

  /**
   * Retry authentication for a specific cluster.
   * Calls the backend RetryClusterAuth method for the given cluster ID.
   *
   * @param clusterId - The ID of the cluster to retry authentication for
   */
  const handleRetry = useCallback(async (clusterId: string): Promise<void> => {
    if (!clusterId) {
      console.warn('[AuthErrorHandler] handleRetry called without clusterId');
      return;
    }

    try {
      const module = await import('../../wailsjs/go/backend/App');
      await module.RetryClusterAuth(clusterId);
    } catch (err) {
      console.error(`[AuthErrorHandler] RetryClusterAuth failed for ${clusterId}:`, err);
    }
  }, []);

  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    // Handler for auth failure events.
    const handleAuthFailed = (...args: unknown[]) => {
      console.log('[AuthErrorHandler] Received cluster:auth:failed', args);

      // Parse the payload from the backend.
      const payload = args[0] as AuthEventPayload | undefined;
      if (!payload?.clusterId) {
        console.warn('[AuthErrorHandler] Received auth:failed without clusterId', args);
        return;
      }

      const { clusterId, clusterName, reason } = payload;

      // Update the auth state for this specific cluster.
      // The AuthFailureOverlay component will display the error and retry button,
      // so we don't need to show a toast notification here.
      setClusterAuthErrors((prev) => {
        const next = new Map(prev);
        next.set(clusterId, {
          hasError: true,
          reason: reason || 'Authentication failed',
          clusterName: clusterName || clusterId,
          isRecovering: false,
        });
        return next;
      });
    };

    // Handler for auth recovering events (auth is being retried).
    const handleAuthRecovering = (...args: unknown[]) => {
      console.log('[AuthErrorHandler] Received cluster:auth:recovering', args);

      // Parse the payload from the backend.
      const payload = args[0] as AuthEventPayload | undefined;
      if (!payload?.clusterId) {
        console.warn('[AuthErrorHandler] Received auth:recovering without clusterId', args);
        return;
      }

      const { clusterId, clusterName, reason } = payload;

      // Update the auth state to show recovery in progress.
      setClusterAuthErrors((prev) => {
        const next = new Map(prev);
        const existing = prev.get(clusterId);
        next.set(clusterId, {
          hasError: true, // Still in error state while recovering
          reason: existing?.reason || reason || 'Authentication failed',
          clusterName: existing?.clusterName || clusterName || clusterId,
          isRecovering: true,
        });
        return next;
      });
    };

    // Handler for auth recovery events.
    const handleAuthRecovered = (...args: unknown[]) => {
      console.log('[AuthErrorHandler] Received cluster:auth:recovered', args);

      // Parse the payload from the backend.
      const payload = args[0] as AuthEventPayload | undefined;
      if (!payload?.clusterId) {
        console.warn('[AuthErrorHandler] Received auth:recovered without clusterId', args);
        return;
      }

      const { clusterId } = payload;

      // Remove the cluster from the errors map.
      setClusterAuthErrors((prev) => {
        const next = new Map(prev);
        next.delete(clusterId);
        return next;
      });
    };

    // Subscribe to cluster auth events.
    runtime.EventsOn('cluster:auth:failed', handleAuthFailed);
    runtime.EventsOn('cluster:auth:recovering', handleAuthRecovering);
    runtime.EventsOn('cluster:auth:recovered', handleAuthRecovered);

    return () => {
      runtime.EventsOff?.('cluster:auth:failed');
      runtime.EventsOff?.('cluster:auth:recovering');
      runtime.EventsOff?.('cluster:auth:recovered');
    };
  }, [handleRetry]);

  // Accessor to get auth state for a specific cluster.
  const getClusterAuthState = useCallback(
    (clusterId: string): ClusterAuthState => {
      return clusterAuthErrors.get(clusterId) || DEFAULT_AUTH_STATE;
    },
    [clusterAuthErrors]
  );

  // Accessor to get auth state for the active cluster.
  const getActiveClusterAuthState = useCallback((): ClusterAuthState => {
    if (!activeClusterId) {
      return DEFAULT_AUTH_STATE;
    }
    return getClusterAuthState(activeClusterId);
  }, [activeClusterId, getClusterAuthState]);

  // Memoize the result object to prevent unnecessary re-renders.
  const result = useMemo(
    () => ({
      clusterAuthErrors,
      getClusterAuthState,
      getActiveClusterAuthState,
      handleRetry,
    }),
    [clusterAuthErrors, getClusterAuthState, getActiveClusterAuthState, handleRetry]
  );

  return result;
}
