/**
 * frontend/src/core/contexts/AuthErrorContext.tsx
 *
 * Context for sharing authentication error state across the application.
 * Subscribes to backend auth events and provides auth state to all consumers.
 */
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';

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
 * Context value for auth error state.
 */
export interface AuthErrorContextValue {
  /** Map of cluster IDs to their auth state. */
  clusterAuthErrors: Map<string, ClusterAuthState>;
  /** Get auth state for a specific cluster. Returns default state if not found. */
  getClusterAuthState: (clusterId: string) => ClusterAuthState;
  /** Retry authentication for a specific cluster. */
  handleRetry: (clusterId: string) => Promise<void>;
}

const AuthErrorContext = createContext<AuthErrorContextValue | null>(null);

/**
 * Provider component that subscribes to backend auth events and shares state.
 */
export const AuthErrorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Track auth errors per cluster.
  const [clusterAuthErrors, setClusterAuthErrors] = useState<Map<string, ClusterAuthState>>(
    () => new Map()
  );

  /**
   * Retry authentication for a specific cluster.
   */
  const handleRetry = useCallback(async (clusterId: string): Promise<void> => {
    if (!clusterId) {
      console.warn('[AuthErrorContext] handleRetry called without clusterId');
      return;
    }

    try {
      const module = await import('../../../wailsjs/go/backend/App');
      await module.RetryClusterAuth(clusterId);
    } catch (err) {
      console.error(`[AuthErrorContext] RetryClusterAuth failed for ${clusterId}:`, err);
    }
  }, []);

  // Fetch initial auth state from backend on mount.
  // This catches any auth failures that occurred before React was loaded.
  useEffect(() => {
    const fetchInitialState = async () => {
      try {
        const module = await import('../../../wailsjs/go/backend/App');
        const states = await module.GetAllClusterAuthStates();
        if (!states) return;

        const initialErrors = new Map<string, ClusterAuthState>();
        for (const [clusterId, stateInfo] of Object.entries(states)) {
          const state = stateInfo.state;
          const reason = stateInfo.reason || '';
          const clusterName = stateInfo.clusterName || clusterId;

          // Only add clusters that are in error or recovering state
          if (state === 'recovering') {
            initialErrors.set(clusterId, {
              hasError: true,
              reason: reason || 'Authentication failed',
              clusterName,
              isRecovering: true,
            });
          } else if (state === 'invalid') {
            initialErrors.set(clusterId, {
              hasError: true,
              reason: reason || 'Authentication failed',
              clusterName,
              isRecovering: false,
            });
          }
        }

        if (initialErrors.size > 0) {
          console.log('[AuthErrorContext] Loaded initial auth errors:', initialErrors);
          setClusterAuthErrors(initialErrors);
        }
      } catch (err) {
        console.error('[AuthErrorContext] Failed to fetch initial auth state:', err);
      }
    };

    void fetchInitialState();
  }, []);

  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    // Handler for auth failure events.
    const handleAuthFailed = (...args: unknown[]) => {
      console.log('[AuthErrorContext] Received cluster:auth:failed', args);

      const payload = args[0] as AuthEventPayload | undefined;
      if (!payload?.clusterId) {
        console.warn('[AuthErrorContext] Received auth:failed without clusterId', args);
        return;
      }

      const { clusterId, clusterName, reason } = payload;

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
      console.log('[AuthErrorContext] Received cluster:auth:recovering', args);

      const payload = args[0] as AuthEventPayload | undefined;
      if (!payload?.clusterId) {
        console.warn('[AuthErrorContext] Received auth:recovering without clusterId', args);
        return;
      }

      const { clusterId, clusterName, reason } = payload;

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
      console.log('[AuthErrorContext] Received cluster:auth:recovered', args);

      const payload = args[0] as AuthEventPayload | undefined;
      if (!payload?.clusterId) {
        console.warn('[AuthErrorContext] Received auth:recovered without clusterId', args);
        return;
      }

      const { clusterId } = payload;

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
  }, []);

  // Accessor to get auth state for a specific cluster.
  const getClusterAuthState = useCallback(
    (clusterId: string): ClusterAuthState => {
      return clusterAuthErrors.get(clusterId) || DEFAULT_AUTH_STATE;
    },
    [clusterAuthErrors]
  );

  const value = useMemo(
    () => ({
      clusterAuthErrors,
      getClusterAuthState,
      handleRetry,
    }),
    [clusterAuthErrors, getClusterAuthState, handleRetry]
  );

  return <AuthErrorContext.Provider value={value}>{children}</AuthErrorContext.Provider>;
};

/**
 * Hook to access auth error context.
 * Must be used within an AuthErrorProvider.
 */
export function useAuthError(): AuthErrorContextValue {
  const context = useContext(AuthErrorContext);
  if (!context) {
    throw new Error('useAuthError must be used within an AuthErrorProvider');
  }
  return context;
}

/**
 * Hook to get auth state for the active cluster.
 */
export function useActiveClusterAuthState(activeClusterId: string): ClusterAuthState {
  const { getClusterAuthState } = useAuthError();
  return useMemo(
    () => (activeClusterId ? getClusterAuthState(activeClusterId) : DEFAULT_AUTH_STATE),
    [activeClusterId, getClusterAuthState]
  );
}
