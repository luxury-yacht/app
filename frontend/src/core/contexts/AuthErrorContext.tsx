/**
 * frontend/src/core/contexts/AuthErrorContext.tsx
 *
 * Context for sharing authentication error state across the application.
 * Subscribes to backend auth events and provides auth state to all consumers.
 */

import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { readAllClusterAuthStates, requestAppState } from '@/core/app-state-access';
import { RetryClusterAuth } from '@/core/backend-api';
import { eventBus } from '@/core/events';

/**
 * Classification of the most recent recovery probe failure.
 * 'auth' means the cluster rejected the credentials (confirmed failure);
 * 'connectivity' means the cluster is unreachable (waiting state);
 * '' means no probe has produced a verdict yet.
 */
export type AuthErrorClass = 'auth' | 'connectivity' | '';

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
  /** Seconds until next retry attempt (0 if retry in progress). */
  secondsUntilRetry: number;
  /** Latest recovery verdict; sticky until a probe result contradicts it. */
  errorClass: AuthErrorClass;
  /**
   * The kubeconfig exec credential command, when the failure is exec-plugin
   * related (e.g. a missing helper). '' when unknown or not exec-based.
   */
  execCommand: string;
  /** Finer backend failure classification (e.g. 'missing-helper'); '' when unknown. */
  diagnosticKind: string;
  /** Sanitized, provider-neutral one-line summary of the failure; '' when unknown. */
  diagnosticSummary: string;
}

/**
 * Default auth state for clusters with no errors.
 */
const DEFAULT_AUTH_STATE: ClusterAuthState = {
  hasError: false,
  reason: '',
  clusterName: '',
  isRecovering: false,
  secondsUntilRetry: 0,
  errorClass: '',
  execCommand: '',
  diagnosticKind: '',
  diagnosticSummary: '',
};

/**
 * Payload structure sent by the backend for auth events.
 */
interface AuthEventPayload {
  clusterId?: string;
  clusterName?: string;
  reason?: string;
  /** Finer credential classification (credentialerrors.Kind). */
  kind?: string;
  /** Sanitized, provider-neutral summary. */
  summary?: string;
  /** Kubeconfig exec credential command, when known. */
  execCommand?: string;
}

/**
 * Payload structure sent by the backend for auth progress events.
 */
interface AuthProgressPayload {
  clusterId?: string;
  clusterName?: string;
  secondsUntilRetry?: number;
  errorClass?: string;
  kind?: string;
  summary?: string;
  execCommand?: string;
}

/** Narrows an event payload value to a known error class. */
const normalizeAuthErrorClass = (value: unknown): AuthErrorClass => {
  return value === 'auth' || value === 'connectivity' ? value : '';
};

/**
 * isConfirmedAuthFailure reports whether a cluster's failure is a confirmed
 * authentication problem the user must act on. A recovering cluster whose
 * latest verdict is connectivity (or that has no verdict yet) is a waiting
 * state — the backend keeps probing and recovers on its own.
 */
export const isConfirmedAuthFailure = (state: ClusterAuthState): boolean => {
  return state.hasError && (!state.isRecovering || state.errorClass === 'auth');
};

/**
 * applyAuthFailedEvent records a terminal auth failure. Terminal failures only
 * happen after auth-class probe failures exhaust the retry budget, so the
 * verdict is 'auth' by definition.
 */
export const applyAuthFailedEvent = (
  prev: Map<string, ClusterAuthState>,
  payload: AuthEventPayload
): Map<string, ClusterAuthState> => {
  if (!payload.clusterId) {
    return prev;
  }
  const existing = prev.get(payload.clusterId);
  const next = new Map(prev);
  next.set(payload.clusterId, {
    hasError: true,
    reason: payload.reason || 'Authentication failed',
    clusterName: payload.clusterName || payload.clusterId,
    isRecovering: false,
    secondsUntilRetry: existing?.secondsUntilRetry || 0,
    errorClass: 'auth',
    execCommand: payload.execCommand || existing?.execCommand || '',
    diagnosticKind: payload.kind || existing?.diagnosticKind || '',
    diagnosticSummary: payload.summary || existing?.diagnosticSummary || '',
  });
  return next;
};

/**
 * applyAuthRecoveringEvent marks recovery as in progress. The previous verdict
 * is preserved (sticky): entering recovery says a retry started, not that the
 * earlier verdict stopped being true.
 */
export const applyAuthRecoveringEvent = (
  prev: Map<string, ClusterAuthState>,
  payload: AuthEventPayload
): Map<string, ClusterAuthState> => {
  if (!payload.clusterId) {
    return prev;
  }
  const existing = prev.get(payload.clusterId);
  const next = new Map(prev);
  next.set(payload.clusterId, {
    hasError: true, // Still in error state while recovering
    reason: existing?.reason || payload.reason || 'Authentication failed',
    clusterName: existing?.clusterName || payload.clusterName || payload.clusterId,
    isRecovering: true,
    secondsUntilRetry: existing?.secondsUntilRetry || 0,
    errorClass: existing?.errorClass ?? '',
    execCommand: existing?.execCommand || payload.execCommand || '',
    diagnosticKind: existing?.diagnosticKind || payload.kind || '',
    diagnosticSummary: existing?.diagnosticSummary || payload.summary || '',
  });
  return next;
};

/**
 * applyAuthProgressEvent updates countdown/attempt info during recovery and
 * adopts the probe verdict when the event carries one; an empty verdict keeps
 * the previous one.
 */
export const applyAuthProgressEvent = (
  prev: Map<string, ClusterAuthState>,
  payload: AuthProgressPayload
): Map<string, ClusterAuthState> => {
  if (!payload.clusterId) {
    return prev;
  }
  const existing = prev.get(payload.clusterId);
  // Only update if we have an existing error for this cluster
  if (!existing?.hasError) {
    return prev;
  }
  const next = new Map(prev);
  next.set(payload.clusterId, {
    ...existing,
    clusterName: payload.clusterName || existing.clusterName,
    secondsUntilRetry: payload.secondsUntilRetry ?? existing.secondsUntilRetry,
    errorClass: normalizeAuthErrorClass(payload.errorClass) || existing.errorClass,
    execCommand: payload.execCommand || existing.execCommand,
    diagnosticKind: payload.kind || existing.diagnosticKind,
    diagnosticSummary: payload.summary || existing.diagnosticSummary,
  });
  return next;
};

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
 * Mounted at the root in App.tsx (app-lifetime).
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
      await RetryClusterAuth(clusterId);
    } catch (err) {
      console.error(`[AuthErrorContext] RetryClusterAuth failed for ${clusterId}:`, err);
    }
  }, []);

  // Fetch initial auth state from backend on mount.
  // This catches any auth failures that occurred before React was loaded.
  useEffect(() => {
    const fetchInitialState = async () => {
      try {
        const states = await requestAppState({
          resource: 'cluster-auth-states',
          read: () => readAllClusterAuthStates(),
        });
        if (!states) {
          return;
        }

        const initialErrors = new Map<string, ClusterAuthState>();
        for (const [clusterId, stateInfo] of Object.entries(states)) {
          const state = stateInfo.state as string;
          const reason = (stateInfo.reason as string) || '';
          const clusterName = (stateInfo.clusterName as string) || clusterId;
          const secondsUntilRetry = (stateInfo.secondsUntilRetry as number) || 0;
          const execCommand = (stateInfo.execCommand as string) || '';
          const diagnosticKind = (stateInfo.kind as string) || '';
          const diagnosticSummary = (stateInfo.summary as string) || '';

          // Only add clusters that are in error or recovering state
          if (state === 'recovering') {
            initialErrors.set(clusterId, {
              hasError: true,
              reason: reason || 'Authentication failed',
              clusterName,
              isRecovering: true,
              secondsUntilRetry,
              errorClass: normalizeAuthErrorClass(stateInfo.errorClass),
              execCommand,
              diagnosticKind,
              diagnosticSummary,
            });
          } else if (state === 'invalid') {
            initialErrors.set(clusterId, {
              hasError: true,
              reason: reason || 'Authentication failed',
              clusterName,
              isRecovering: false,
              // The recovery loop keeps probing while invalid, so the
              // countdown is live here too.
              secondsUntilRetry,
              // Invalid is only reached by exhausting auth-class failures.
              errorClass: 'auth',
              execCommand,
              diagnosticKind,
              diagnosticSummary,
            });
          }
        }

        if (initialErrors.size > 0) {
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
      const payload = args[0] as AuthEventPayload | undefined;
      if (!payload?.clusterId) {
        console.warn('[AuthErrorContext] Received auth:failed without clusterId');
        return;
      }

      // Notify the refresh orchestrator so it can pause refresh activity.
      eventBus.emit('cluster:auth:failed', { clusterId: payload.clusterId });

      setClusterAuthErrors((prev) => applyAuthFailedEvent(prev, payload));
    };

    // Handler for auth recovering events (auth is being retried).
    const handleAuthRecovering = (...args: unknown[]) => {
      const payload = args[0] as AuthEventPayload | undefined;
      if (!payload?.clusterId) {
        console.warn('[AuthErrorContext] Received auth:recovering without clusterId');
        return;
      }
      setClusterAuthErrors((prev) => applyAuthRecoveringEvent(prev, payload));
    };

    // Handler for auth progress events (countdown updates during recovery).
    const handleAuthProgress = (...args: unknown[]) => {
      const payload = args[0] as AuthProgressPayload | undefined;
      if (!payload?.clusterId) {
        return;
      }
      setClusterAuthErrors((prev) => applyAuthProgressEvent(prev, payload));
    };

    // Handler for auth recovery events.
    const handleAuthRecovered = (...args: unknown[]) => {
      const payload = args[0] as AuthEventPayload | undefined;
      if (!payload?.clusterId) {
        console.warn('[AuthErrorContext] Received auth:recovered without clusterId');
        return;
      }

      const { clusterId } = payload;

      // Notify the refresh orchestrator so it can resume refresh activity.
      eventBus.emit('cluster:auth:recovered', { clusterId });

      setClusterAuthErrors((prev) => {
        const next = new Map(prev);
        next.delete(clusterId);
        return next;
      });
    };

    // Subscribe to cluster auth events. EventsOn returns a per-listener
    // disposer, so we use those for cleanup instead of EventsOff (which
    // would remove ALL listeners for the event name).
    const disposers = [
      runtime.EventsOn('cluster:auth:failed', handleAuthFailed),
      runtime.EventsOn('cluster:auth:recovering', handleAuthRecovering),
      runtime.EventsOn('cluster:auth:recovered', handleAuthRecovered),
      runtime.EventsOn('cluster:auth:progress', handleAuthProgress),
    ];

    return () => {
      disposers.forEach((dispose) => {
        dispose();
      });
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
