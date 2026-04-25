/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useContainerLogsStreamFallback.ts
 *
 * Manages container logs stream lifecycle, fallback activation on stream errors,
 * containerLogsFallbackManager registration, and exponential-backoff recovery.
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
import { containerLogsFallbackManager } from '@/core/refresh/fallbacks/containerLogsFallbackManager';
import { setScopedDomainState } from '@/core/refresh/store';
import type { LogViewerAction } from '../logViewerReducer';

const CONTAINER_LOGS_DOMAIN = 'container-logs' as const;

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

export const getLogDataUnavailableMessage = (showPreviousContainerLogs: boolean): string =>
  showPreviousContainerLogs
    ? 'No previous logs are available for the selected pod or container yet'
    : 'Logs are not available yet for the selected pod or container';

interface UseContainerLogsStreamFallbackParams {
  containerLogsScope: string | null;
  isActive: boolean;
  autoRefresh: boolean;
  showPreviousContainerLogs: boolean;
  snapshotStatus: string;
  logEntriesLength: number;
  fallbackActive: boolean;
  fetchFallbackContainerLogs: (isManual?: boolean) => Promise<void>;
  dispatch: Dispatch<LogViewerAction>;
  /** Ref tracking whether stream recovery is in-flight. Owned by the caller. */
  fallbackRecoveringRef: MutableRefObject<boolean>;
  /** Ref tracking whether the initial log prime has been performed. Owned by the caller. */
  hasPrimedScopeRef: MutableRefObject<boolean>;
}

export function useContainerLogsStreamFallback({
  containerLogsScope,
  isActive,
  autoRefresh,
  showPreviousContainerLogs,
  snapshotStatus,
  logEntriesLength,
  fallbackActive,
  fetchFallbackContainerLogs,
  dispatch,
  fallbackRecoveringRef,
  hasPrimedScopeRef,
}: UseContainerLogsStreamFallbackParams): void {
  // --- Stream lifecycle management ---
  // Enable/disable the streaming domain based on isActive, fallbackActive,
  // and showPreviousContainerLogs. When fallback is active and recovery is in-flight,
  // the domain is re-enabled to attempt reconnection.
  useEffect(() => {
    if (!containerLogsScope) {
      return;
    }
    if (!isActive) {
      fallbackRecoveringRef.current = false;
      dispatch({ type: 'SET_FALLBACK_ACTIVE', payload: false });
      dispatch({ type: 'SET_SHOW_PREVIOUS_LOGS', payload: false });
      dispatch({ type: 'SET_IS_LOADING_PREVIOUS_LOGS', payload: false });
      refreshOrchestrator.stopStreamingDomain(CONTAINER_LOGS_DOMAIN, containerLogsScope, {
        reset: false,
      });
      // Use preserveState so the diagnostics panel can still see the last
      // log snapshot while the logs tab is inactive. Full cleanup happens
      // via ObjectPanelContent when the panel closes.
      refreshOrchestrator.setScopedDomainEnabled(CONTAINER_LOGS_DOMAIN, containerLogsScope, false, {
        preserveState: true,
      });
      return;
    }

    // When auto-refresh is disabled, stop the stream so the log view freezes.
    // Streaming will resume when auto-refresh is re-enabled.
    if (!autoRefresh) {
      refreshOrchestrator.stopStreamingDomain(CONTAINER_LOGS_DOMAIN, containerLogsScope, {
        reset: false,
      });
      refreshOrchestrator.setScopedDomainEnabled(CONTAINER_LOGS_DOMAIN, containerLogsScope, false, {
        preserveState: true,
      });
      return;
    }

    if (showPreviousContainerLogs) {
      refreshOrchestrator.stopStreamingDomain(CONTAINER_LOGS_DOMAIN, containerLogsScope, {
        reset: false,
      });
      refreshOrchestrator.setScopedDomainEnabled(CONTAINER_LOGS_DOMAIN, containerLogsScope, false, {
        preserveState: true,
      });
      return () => {
        refreshOrchestrator.setScopedDomainEnabled(
          CONTAINER_LOGS_DOMAIN,
          containerLogsScope,
          false,
          {
            preserveState: true,
          }
        );
      };
    }

    if (fallbackActive) {
      if (fallbackRecoveringRef.current) {
        // preserveState on enable: the orchestrator's streaming branch
        // resets the cached snapshot on enable unless told otherwise.
        // Without this, every cluster-switch round-trip wipes the
        // buffered log entries the moment the LogViewer remounts and
        // re-enables the scope, which negates Tier 1 of the
        // responsiveness fix.
        refreshOrchestrator.setScopedDomainEnabled(
          CONTAINER_LOGS_DOMAIN,
          containerLogsScope,
          true,
          {
            preserveState: true,
          }
        );
        return () => {
          if (!fallbackRecoveringRef.current) {
            refreshOrchestrator.setScopedDomainEnabled(
              CONTAINER_LOGS_DOMAIN,
              containerLogsScope,
              false,
              {
                preserveState: true,
              }
            );
          }
        };
      }
      refreshOrchestrator.stopStreamingDomain(CONTAINER_LOGS_DOMAIN, containerLogsScope, {
        reset: false,
      });
      refreshOrchestrator.setScopedDomainEnabled(CONTAINER_LOGS_DOMAIN, containerLogsScope, false, {
        preserveState: true,
      });
      return () => {
        refreshOrchestrator.setScopedDomainEnabled(
          CONTAINER_LOGS_DOMAIN,
          containerLogsScope,
          false,
          {
            preserveState: true,
          }
        );
      };
    }

    fallbackRecoveringRef.current = false;
    // preserveState on enable: see the rationale in the fallbackActive
    // branch above. Without this option, remounting the LogViewer (e.g.
    // after a cluster-switch round-trip) wipes the cached entries and
    // forces a fresh reload — Tier 1 of the responsiveness fix becomes
    // a no-op for streaming domains otherwise.
    refreshOrchestrator.setScopedDomainEnabled(CONTAINER_LOGS_DOMAIN, containerLogsScope, true, {
      preserveState: true,
    });
    return () => {
      refreshOrchestrator.stopStreamingDomain(CONTAINER_LOGS_DOMAIN, containerLogsScope, {
        reset: false,
      });
      refreshOrchestrator.setScopedDomainEnabled(CONTAINER_LOGS_DOMAIN, containerLogsScope, false, {
        preserveState: true,
      });
    };
  }, [
    autoRefresh,
    dispatch,
    fallbackActive,
    fallbackRecoveringRef,
    isActive,
    containerLogsScope,
    showPreviousContainerLogs,
  ]);

  // --- Reset primed ref when fallback or previous-logs mode changes ---
  useEffect(() => {
    if (fallbackActive || showPreviousContainerLogs) {
      hasPrimedScopeRef.current = false;
    }
  }, [fallbackActive, hasPrimedScopeRef, showPreviousContainerLogs]);

  // --- Error-to-fallback transition ---
  // When the stream enters an error state and auto-refresh is on, activate
  // fallback polling so the user still sees log updates.
  useEffect(() => {
    if (!containerLogsScope || !isActive || showPreviousContainerLogs) {
      return;
    }
    if (fallbackActive) {
      return;
    }
    if (fallbackRecoveringRef.current) {
      return;
    }
    if (snapshotStatus === 'error' && autoRefresh) {
      refreshOrchestrator.stopStreamingDomain(CONTAINER_LOGS_DOMAIN, containerLogsScope, {
        reset: false,
      });
      refreshOrchestrator.setScopedDomainEnabled(CONTAINER_LOGS_DOMAIN, containerLogsScope, false);
      dispatch({ type: 'SET_FALLBACK_ACTIVE', payload: true });
    }
  }, [
    autoRefresh,
    dispatch,
    fallbackActive,
    fallbackRecoveringRef,
    isActive,
    containerLogsScope,
    showPreviousContainerLogs,
    snapshotStatus,
  ]);

  // --- Fallback manager registration ---
  useEffect(() => {
    if (!fallbackActive || !containerLogsScope || showPreviousContainerLogs) {
      dispatch({ type: 'SET_FALLBACK_ERROR', payload: null });
      if (containerLogsScope) {
        containerLogsFallbackManager.unregister(containerLogsScope);
      }
      return;
    }

    containerLogsFallbackManager.register(
      containerLogsScope,
      fetchFallbackContainerLogs,
      autoRefresh && isActive
    );
    void containerLogsFallbackManager.refreshNow(containerLogsScope);

    return () => {
      containerLogsFallbackManager.unregister(containerLogsScope);
    };
  }, [
    autoRefresh,
    dispatch,
    fallbackActive,
    fetchFallbackContainerLogs,
    isActive,
    containerLogsScope,
    showPreviousContainerLogs,
  ]);

  // --- Fallback manager config updates ---
  useEffect(() => {
    if (!fallbackActive || !containerLogsScope || showPreviousContainerLogs) {
      return;
    }
    containerLogsFallbackManager.update(containerLogsScope, {
      autoRefresh: autoRefresh && isActive,
      fetcher: fetchFallbackContainerLogs,
    });
  }, [
    autoRefresh,
    fallbackActive,
    fetchFallbackContainerLogs,
    isActive,
    containerLogsScope,
    showPreviousContainerLogs,
  ]);

  // --- Exponential backoff recovery ---
  // When fallback is active and autoRefresh is on, periodically attempt to
  // restore the streaming connection. Delays: 3s, 6s, 12s, 24s, 30s (capped).
  // Stops after MAX_RECOVERY_ATTEMPTS.
  useEffect(() => {
    if (
      !fallbackActive ||
      showPreviousContainerLogs ||
      !autoRefresh ||
      !isActive ||
      !containerLogsScope
    ) {
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

      setScopedDomainState(CONTAINER_LOGS_DOMAIN, containerLogsScope, (previous) => ({
        ...previous,
        status: 'loading',
        error: null,
        scope: containerLogsScope,
      }));
      dispatch({ type: 'SET_FALLBACK_ERROR', payload: null });

      // preserveState on enable: see the comment in the main lifecycle
      // effect above — without it, the orchestrator wipes the cached
      // entries before scheduling the new stream, undoing the buffered
      // log content the user was looking at moments ago.
      refreshOrchestrator.setScopedDomainEnabled(CONTAINER_LOGS_DOMAIN, containerLogsScope, true, {
        preserveState: true,
      });

      try {
        await refreshOrchestrator.restartStreamingDomain(CONTAINER_LOGS_DOMAIN, containerLogsScope);
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
        const warnings = unavailable
          ? [getLogDataUnavailableMessage(showPreviousContainerLogs)]
          : undefined;
        setScopedDomainState(CONTAINER_LOGS_DOMAIN, containerLogsScope, (previous) => ({
          ...previous,
          status: unavailable ? 'ready' : 'error',
          error: unavailable ? null : message,
          stats:
            unavailable && warnings
              ? {
                  itemCount: previous.stats?.itemCount ?? 0,
                  buildDurationMs: previous.stats?.buildDurationMs ?? 0,
                  totalItems: previous.stats?.totalItems,
                  truncated: previous.stats?.truncated,
                  warnings,
                  batchIndex: previous.stats?.batchIndex,
                  batchSize: previous.stats?.batchSize,
                  totalBatches: previous.stats?.totalBatches,
                  isFinalBatch: previous.stats?.isFinalBatch,
                  timeToFirstBatchMs: previous.stats?.timeToFirstBatchMs,
                  timeToFirstRowMs: previous.stats?.timeToFirstRowMs,
                  buildStartedAtUnix: previous.stats?.buildStartedAtUnix,
                }
              : previous.stats,
          scope: containerLogsScope,
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
    containerLogsScope,
    showPreviousContainerLogs,
  ]);

  // --- Initial log priming ---
  // On first activation of a scope, fetch logs once to populate the store
  // before streaming kicks in. This provides immediate feedback while the
  // stream connection is being established.
  useEffect(() => {
    if (!containerLogsScope || !isActive || fallbackActive || showPreviousContainerLogs) {
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
    void fetchFallbackContainerLogs();
  }, [
    fallbackActive,
    fetchFallbackContainerLogs,
    hasPrimedScopeRef,
    isActive,
    logEntriesLength,
    containerLogsScope,
    showPreviousContainerLogs,
  ]);
}
