/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogStreamFallback.ts
 *
 * Manages log stream lifecycle, fallback activation on stream errors,
 * objectLogFallbackManager registration, and exponential-backoff recovery.
 * Extracted from LogViewer to reduce its line count and isolate the
 * stream recovery concern.
 *
 * Note: We don't call startStreamingDomain separately because
 * setScopedDomainEnabled already handles starting streaming internally.
 * Calling both creates a race condition with the orchestrator's
 * deduplication during React Strict Mode.
 */
import { useEffect } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import { refreshOrchestrator } from '@/core/refresh/orchestrator';
import { objectLogFallbackManager } from '@/core/refresh/fallbacks/objectLogFallbackManager';
import { setScopedDomainState } from '@/core/refresh/store';
import type { LogViewerAction } from '../logViewerReducer';

const LOG_DOMAIN = 'object-logs' as const;

/**
 * Checks whether an error message indicates that logs are structurally
 * unavailable (container not started, no pods, etc.) as opposed to a
 * transient failure.
 */
export const isLogDataUnavailable = (message?: string | null): boolean => {
  if (!message) {
    return false;
  }
  const normalized = message.toLowerCase();
  return (
    normalized.includes('waiting to start') ||
    normalized.includes('podinitializing') ||
    normalized.includes('container not found') ||
    normalized.includes('previous terminated container') ||
    normalized.includes('is not valid for pod') ||
    normalized.includes('no pods found') ||
    normalized.includes('has no logs') ||
    normalized.includes('no logs available')
  );
};

interface UseLogStreamFallbackParams {
  logScope: string | null;
  isActive: boolean;
  autoRefresh: boolean;
  showPreviousLogs: boolean;
  snapshotStatus: string;
  logEntriesLength: number;
  fallbackActive: boolean;
  fetchFallbackLogs: (isManual?: boolean) => Promise<void>;
  dispatch: Dispatch<LogViewerAction>;
  /** Ref tracking whether stream recovery is in-flight. Owned by the caller. */
  fallbackRecoveringRef: MutableRefObject<boolean>;
  /** Ref tracking whether the initial log prime has been performed. Owned by the caller. */
  hasPrimedScopeRef: MutableRefObject<boolean>;
}

export function useLogStreamFallback({
  logScope,
  isActive,
  autoRefresh,
  showPreviousLogs,
  snapshotStatus,
  logEntriesLength,
  fallbackActive,
  fetchFallbackLogs,
  dispatch,
  fallbackRecoveringRef,
  hasPrimedScopeRef,
}: UseLogStreamFallbackParams): void {
  // --- Stream lifecycle management ---
  // Enable/disable the streaming domain based on isActive, fallbackActive,
  // and showPreviousLogs. When fallback is active and recovery is in-flight,
  // the domain is re-enabled to attempt reconnection.
  useEffect(() => {
    if (!logScope) {
      return;
    }
    if (!isActive) {
      fallbackRecoveringRef.current = false;
      dispatch({ type: 'SET_FALLBACK_ACTIVE', payload: false });
      dispatch({ type: 'SET_SHOW_PREVIOUS_LOGS', payload: false });
      dispatch({ type: 'SET_IS_LOADING_PREVIOUS_LOGS', payload: false });
      refreshOrchestrator.stopStreamingDomain(LOG_DOMAIN, logScope, { reset: false });
      // Use preserveState so the diagnostics panel can still see the last
      // log snapshot while the logs tab is inactive. Full cleanup happens
      // via ObjectPanelContent when the panel closes.
      refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false, {
        preserveState: true,
      });
      return;
    }

    if (showPreviousLogs) {
      refreshOrchestrator.stopStreamingDomain(LOG_DOMAIN, logScope, { reset: false });
      refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false, {
        preserveState: true,
      });
      return () => {
        refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false, {
          preserveState: true,
        });
      };
    }

    if (fallbackActive) {
      if (fallbackRecoveringRef.current) {
        refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, true);
        return () => {
          if (!fallbackRecoveringRef.current) {
            refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false, {
              preserveState: true,
            });
          }
        };
      }
      refreshOrchestrator.stopStreamingDomain(LOG_DOMAIN, logScope, { reset: false });
      refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false, {
        preserveState: true,
      });
      return () => {
        refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false, {
          preserveState: true,
        });
      };
    }

    fallbackRecoveringRef.current = false;
    refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, true);
    return () => {
      refreshOrchestrator.stopStreamingDomain(LOG_DOMAIN, logScope, { reset: false });
      refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false, {
        preserveState: true,
      });
    };
  }, [dispatch, fallbackActive, fallbackRecoveringRef, isActive, logScope, showPreviousLogs]);

  // --- Reset primed ref when fallback or previous-logs mode changes ---
  useEffect(() => {
    if (fallbackActive || showPreviousLogs) {
      hasPrimedScopeRef.current = false;
    }
  }, [fallbackActive, hasPrimedScopeRef, showPreviousLogs]);

  // --- Error-to-fallback transition ---
  // When the stream enters an error state and auto-refresh is on, activate
  // fallback polling so the user still sees log updates.
  useEffect(() => {
    if (!logScope || !isActive || showPreviousLogs) {
      return;
    }
    if (fallbackActive) {
      return;
    }
    if (fallbackRecoveringRef.current) {
      return;
    }
    if (snapshotStatus === 'error' && autoRefresh) {
      refreshOrchestrator.stopStreamingDomain(LOG_DOMAIN, logScope, { reset: false });
      refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false);
      dispatch({ type: 'SET_FALLBACK_ACTIVE', payload: true });
    }
  }, [
    autoRefresh,
    dispatch,
    fallbackActive,
    fallbackRecoveringRef,
    isActive,
    logScope,
    showPreviousLogs,
    snapshotStatus,
  ]);

  // --- Fallback manager registration ---
  useEffect(() => {
    if (!fallbackActive || !logScope || showPreviousLogs) {
      dispatch({ type: 'SET_FALLBACK_ERROR', payload: null });
      if (logScope) {
        objectLogFallbackManager.unregister(logScope);
      }
      return;
    }

    objectLogFallbackManager.register(logScope, fetchFallbackLogs, autoRefresh && isActive);
    void objectLogFallbackManager.refreshNow(logScope);

    return () => {
      objectLogFallbackManager.unregister(logScope);
    };
  }, [
    autoRefresh,
    dispatch,
    fallbackActive,
    fetchFallbackLogs,
    isActive,
    logScope,
    showPreviousLogs,
  ]);

  // --- Fallback manager config updates ---
  useEffect(() => {
    if (!fallbackActive || !logScope || showPreviousLogs) {
      return;
    }
    objectLogFallbackManager.update(logScope, {
      autoRefresh: autoRefresh && isActive,
      fetcher: fetchFallbackLogs,
    });
  }, [autoRefresh, fallbackActive, fetchFallbackLogs, isActive, logScope, showPreviousLogs]);

  // --- Exponential backoff recovery ---
  // When fallback is active and autoRefresh is on, periodically attempt to
  // restore the streaming connection. Delays: 3s, 6s, 12s, 24s, 30s (capped).
  // Stops after MAX_RECOVERY_ATTEMPTS.
  useEffect(() => {
    if (!fallbackActive || showPreviousLogs || !autoRefresh || !isActive || !logScope) {
      return;
    }

    let cancelled = false;
    let attemptInFlight = false;

    const attemptRecovery = async () => {
      if (cancelled || attemptInFlight) {
        return;
      }
      attemptInFlight = true;
      fallbackRecoveringRef.current = true;

      setScopedDomainState(LOG_DOMAIN, logScope, (previous) => ({
        ...previous,
        status: 'loading',
        error: null,
        scope: logScope,
      }));
      dispatch({ type: 'SET_FALLBACK_ERROR', payload: null });

      refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, true);

      try {
        await refreshOrchestrator.restartStreamingDomain(LOG_DOMAIN, logScope);
        if (cancelled) {
          return;
        }
        fallbackRecoveringRef.current = false;
        dispatch({ type: 'SET_FALLBACK_ACTIVE', payload: false });
      } catch (restartError) {
        if (cancelled) {
          return;
        }
        fallbackRecoveringRef.current = false;
        const message = restartError instanceof Error ? restartError.message : String(restartError);
        const unavailable = isLogDataUnavailable(message);
        setScopedDomainState(LOG_DOMAIN, logScope, (previous) => ({
          ...previous,
          status: unavailable ? 'ready' : 'error',
          error: unavailable ? null : message,
          scope: logScope,
        }));
        dispatch({ type: 'SET_FALLBACK_ERROR', payload: unavailable ? null : message });
        dispatch({ type: 'SET_FALLBACK_ACTIVE', payload: true });
      } finally {
        attemptInFlight = false;
        if (cancelled) {
          fallbackRecoveringRef.current = false;
        }
      }
    };

    // Retry with exponential backoff: 3s, 6s, 12s, 24s, 30s (capped).
    // Stops after MAX_RECOVERY_ATTEMPTS to avoid retrying indefinitely.
    const MAX_RECOVERY_ATTEMPTS = 8;
    const INITIAL_DELAY_MS = 3000;
    const MAX_DELAY_MS = 30000;
    let attempt = 0;
    let timerId: number | undefined;

    const scheduleNext = () => {
      if (cancelled || attempt >= MAX_RECOVERY_ATTEMPTS) {
        return;
      }
      const delay = Math.min(INITIAL_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
      timerId = window.setTimeout(async () => {
        attempt++;
        await attemptRecovery();
        // On failure attemptRecovery sets fallbackActive=true, so this effect
        // stays mounted and we schedule the next retry. On success it sets
        // fallbackActive=false which unmounts this effect via the dependency array.
        scheduleNext();
      }, delay);
    };

    scheduleNext();

    return () => {
      cancelled = true;
      if (timerId !== undefined) {
        window.clearTimeout(timerId);
      }
    };
  }, [
    autoRefresh,
    dispatch,
    fallbackActive,
    fallbackRecoveringRef,
    isActive,
    logScope,
    showPreviousLogs,
  ]);

  // --- Initial log priming ---
  // On first activation of a scope, fetch logs once to populate the store
  // before streaming kicks in. This provides immediate feedback while the
  // stream connection is being established.
  useEffect(() => {
    if (!logScope || !isActive || fallbackActive || showPreviousLogs) {
      return;
    }
    if (logEntriesLength > 0) {
      hasPrimedScopeRef.current = true;
      return;
    }
    if (hasPrimedScopeRef.current) {
      return;
    }
    hasPrimedScopeRef.current = true;
    void fetchFallbackLogs();
  }, [
    fallbackActive,
    fetchFallbackLogs,
    hasPrimedScopeRef,
    isActive,
    logEntriesLength,
    logScope,
    showPreviousLogs,
  ]);
}
