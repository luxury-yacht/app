/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx
 *
 * Module source for LogViewer.
 * Component for viewing object logs with filtering, parsing, and keyboard shortcuts.
 * Extracts logic into hooks for clarity.
 * Uses a reducer for state management.
 */
import React, { useReducer, useEffect, useRef, useMemo, useCallback } from 'react';
import { GetPodContainers, LogFetcher } from '@wailsjs/go/backend/App';
import GridTable, {
  type GridColumnDefinition,
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
} from '@shared/components/tables/GridTable';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { useLogKeyboardShortcuts } from './hooks/useLogKeyboardShortcuts';
import { useLogFiltering } from './hooks/useLogFiltering';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import './LogViewer.css';
import { refreshOrchestrator } from '@/core/refresh/orchestrator';
import { objectLogFallbackManager } from '@/core/refresh/fallbacks/objectLogFallbackManager';
import { setScopedDomainState, useRefreshScopedDomain } from '@/core/refresh/store';
import type { ObjectLogEntry } from '@/core/refresh/types';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import type { types } from '@wailsjs/go/models';
import { logViewerReducer, initialLogViewerState, type ParsedLogEntry } from './logViewerReducer';

interface LogViewerProps {
  namespace: string;
  resourceName: string;
  resourceKind: string;
  isActive?: boolean;
  activePodNames?: string[] | null;
  clusterId?: string | null;
}

const ALL_CONTAINERS = ''; // Empty string means all containers in the backend
const INACTIVE_SCOPE = '__inactive__';
const CLUSTER_SCOPE = '__cluster__';
const LOG_DOMAIN = 'object-logs' as const;
const PARSED_COLUMN_MIN_WIDTH = 120;
const PARSED_TIMESTAMP_MIN_WIDTH = 180;
const PARSED_POD_COLUMN_MIN_WIDTH = 160;

const isLogDataUnavailable = (message?: string | null) => {
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

const LogViewer: React.FC<LogViewerProps> = ({
  namespace,
  resourceName,
  resourceKind: resourceKind,
  isActive = false,
  activePodNames = null,
  clusterId,
}) => {
  // Consolidated state via reducer
  const [state, dispatch] = useReducer(logViewerReducer, initialLogViewerState);

  // Destructure commonly used state for readability
  const {
    containers,
    selectedContainer,
    availablePods,
    availableContainers,
    selectedFilter,
    autoScroll,
    autoRefresh,
    showTimestamps,
    wrapText,
    textFilter,
    copyFeedback,
    isParsedView,
    parsedLogs,
    parsedFieldKeys,
    manualRefreshPending,
    fallbackActive,
    fallbackError,
    showPreviousLogs,
    isLoadingPreviousLogs,
  } = state;

  const hasPrimedScopeRef = useRef(false);
  const fallbackRecoveringRef = useRef(false);
  const previousActivePodsRef = useRef<string[] | null>(null);
  const resolvedClusterId = clusterId?.trim() ?? '';

  // Refs
  const logsContentRef = useRef<HTMLDivElement>(null);
  const previousLogCountRef = useRef<number>(0);
  const filterInputRef = useRef<HTMLInputElement>(null);

  const resourceKindKey = resourceKind?.toLowerCase() ?? '';
  const isWorkload = resourceKindKey !== 'pod';
  const supportsPreviousLogs = resourceKindKey === 'pod';
  const podName = !isWorkload ? resourceName : '';
  const scopeNamespace = namespace && namespace.length > 0 ? namespace : CLUSTER_SCOPE;

  const logScope = useMemo(() => {
    if (!resourceName || !resourceKindKey) {
      return null;
    }
    const rawScope = `${scopeNamespace}:${resourceKindKey}:${resourceName}`;
    return buildClusterScope(clusterId ?? undefined, rawScope);
  }, [clusterId, resourceName, resourceKindKey, scopeNamespace]);

  const logSnapshot = useRefreshScopedDomain(LOG_DOMAIN, logScope ?? INACTIVE_SCOPE);
  const payloadEntries = logScope ? logSnapshot.data?.entries : undefined;
  const logEntries: ObjectLogEntry[] = useMemo(() => payloadEntries ?? [], [payloadEntries]);
  const snapshotStatus = logScope ? logSnapshot.status : 'idle';
  const snapshotError = logScope ? logSnapshot.error : null;
  const loading = snapshotStatus === 'loading' && logEntries.length === 0;
  const displayError = snapshotError && !isLogDataUnavailable(snapshotError) ? snapshotError : null;
  const fallbackDisplayError =
    fallbackError && !isLogDataUnavailable(fallbackError) ? fallbackError : null;
  const transientStreamError = displayError
    ? [
        'log stream connection lost',
        'log stream disconnected',
        'reconnecting',
        'failed to open log stream',
      ].some((term) => displayError.toLowerCase().includes(term))
    : false;
  const shouldSuppressError =
    fallbackActive ||
    showPreviousLogs ||
    fallbackRecoveringRef.current ||
    transientStreamError ||
    (autoRefresh && snapshotStatus === 'error');
  const pendingFallback = shouldSuppressError;

  const normalizedActivePods = useMemo(() => {
    if (!isWorkload) {
      return null;
    }
    if (activePodNames === null) {
      return null;
    }
    const names = Array.from(
      new Set(
        activePodNames
          .map((name) => (typeof name === 'string' ? name.trim() : ''))
          .filter((name) => name.length > 0)
      )
    );
    return names;
  }, [activePodNames, isWorkload]);

  const isPendingLogs = showPreviousLogs
    ? isLoadingPreviousLogs && logEntries.length === 0
    : logEntries.length === 0 &&
      (!hasPrimedScopeRef.current ||
        ['loading', 'updating', 'initialising'].includes(snapshotStatus) ||
        fallbackActive ||
        pendingFallback);

  const { filteredEntries, parsedCandidates, canParseLogs } = useLogFiltering({
    logEntries,
    isWorkload,
    selectedFilter,
    selectedContainer,
    textFilter,
  });

  const mapEntriesToSnapshot = useCallback(
    (entries: ObjectLogEntry[], generatedAt: number, isManual: boolean) => {
      if (!logScope) {
        return;
      }
      setScopedDomainState(LOG_DOMAIN, logScope, (previous) => {
        const previousPayload = previous.data ?? {
          entries: [],
          sequence: 0,
          generatedAt,
          resetCount: 0,
          error: null,
        };

        return {
          ...previous,
          status: 'ready',
          error: null,
          data: {
            entries,
            sequence: previousPayload.sequence,
            generatedAt,
            resetCount: previousPayload.resetCount + (isManual ? 1 : 0),
            error: null,
          },
          lastUpdated: generatedAt,
          lastManualRefresh: isManual ? generatedAt : previous.lastManualRefresh,
          lastAutoRefresh: !isManual ? generatedAt : previous.lastAutoRefresh,
          isManual,
          scope: logScope,
        };
      });
    },
    [logScope]
  );

  const fetchLogs = useCallback(
    async (options: { isManual?: boolean; previous?: boolean } = {}) => {
      if (!logScope) {
        return;
      }

      const { isManual = false, previous = false } = options;

      try {
        const request: types.LogFetchRequest = {
          namespace,
          workloadName: isWorkload ? resourceName : '',
          workloadKind: isWorkload ? resourceKindKey : '',
          podName: isWorkload ? '' : podName,
          container: !isWorkload && selectedContainer ? selectedContainer : '',
          previous,
          tailLines: 1000,
          sinceSeconds: 0,
        };

        const response = await LogFetcher(resolvedClusterId, request);
        if (response?.error) {
          throw new Error(response.error);
        }

        const entries = Array.isArray(response?.entries) ? response.entries : [];

        const mapped: ObjectLogEntry[] = entries.map((entry) => ({
          timestamp: entry.timestamp ?? '',
          pod: entry.pod ?? '',
          container: entry.container ?? '',
          line: entry.line ?? '',
          isInit: Boolean(entry.isInit),
        }));

        const generatedAt = Date.now();
        mapEntriesToSnapshot(mapped, generatedAt, isManual);
        dispatch({ type: 'SET_FALLBACK_ERROR', payload: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isLogDataUnavailable(message)) {
          const generatedAt = Date.now();
          mapEntriesToSnapshot([], generatedAt, isManual);
          dispatch({ type: 'SET_FALLBACK_ERROR', payload: null });
          return;
        }
        dispatch({ type: 'SET_FALLBACK_ERROR', payload: message });
        setScopedDomainState(LOG_DOMAIN, logScope, (previous) => ({
          ...previous,
          status: 'error',
          error: message,
          scope: logScope,
        }));
      }
    },
    [
      isWorkload,
      logScope,
      mapEntriesToSnapshot,
      namespace,
      podName,
      resourceName,
      resourceKindKey,
      selectedContainer,
      resolvedClusterId,
    ]
  );

  const fetchFallbackLogs = useCallback(
    async (isManualFetch: boolean = false) => {
      await fetchLogs({ isManual: isManualFetch });
    },
    [fetchLogs]
  );

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
      refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false);
      return;
    }

    if (showPreviousLogs) {
      refreshOrchestrator.stopStreamingDomain(LOG_DOMAIN, logScope, { reset: false });
      refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false);
      return () => {
        refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false);
      };
    }

    if (fallbackActive) {
      if (fallbackRecoveringRef.current) {
        refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, true);
        return () => {
          if (!fallbackRecoveringRef.current) {
            refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false);
          }
        };
      }
      refreshOrchestrator.stopStreamingDomain(LOG_DOMAIN, logScope, { reset: false });
      refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false);
      return () => {
        refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false);
      };
    }

    fallbackRecoveringRef.current = false;
    refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, true);
    return () => {
      refreshOrchestrator.stopStreamingDomain(LOG_DOMAIN, logScope, { reset: false });
      refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false);
    };
  }, [fallbackActive, isActive, logScope, showPreviousLogs]);

  useEffect(() => {
    if (!logScope || !isActive || fallbackActive || showPreviousLogs) {
      return;
    }
    if (autoRefresh) {
      void refreshOrchestrator.startStreamingDomain(LOG_DOMAIN, logScope);
    } else {
      refreshOrchestrator.stopStreamingDomain(LOG_DOMAIN, logScope, { reset: false });
    }
  }, [autoRefresh, fallbackActive, isActive, logScope, showPreviousLogs]);

  useEffect(() => {
    dispatch({ type: 'RESET_FOR_NEW_SCOPE', isWorkload });
    hasPrimedScopeRef.current = false;
    previousActivePodsRef.current = null;
  }, [logScope, isWorkload]);

  useEffect(() => {
    if (!isWorkload || !logScope || showPreviousLogs) {
      previousActivePodsRef.current = normalizedActivePods;
      return;
    }

    if (normalizedActivePods === null) {
      previousActivePodsRef.current = normalizedActivePods;
      return;
    }

    if (previousActivePodsRef.current === null && normalizedActivePods.length === 0) {
      previousActivePodsRef.current = normalizedActivePods;
      return;
    }

    const clearAllEntries = normalizedActivePods.length === 0;
    const activePodSet = new Set(normalizedActivePods);
    const filteredEntries = clearAllEntries
      ? []
      : logEntries.filter((entry) => activePodSet.has(entry.pod));
    const hasChanged = clearAllEntries
      ? logEntries.length > 0
      : filteredEntries.length !== logEntries.length;

    if (!hasChanged) {
      previousActivePodsRef.current = normalizedActivePods;
      return;
    }

    const generatedAt = Date.now();

    setScopedDomainState(LOG_DOMAIN, logScope, (previous) => {
      const previousPayload = previous.data ?? {
        entries: [],
        sequence: 0,
        generatedAt,
        resetCount: 0,
        error: null,
      };

      return {
        ...previous,
        status: 'ready',
        error: null,
        data: {
          ...previousPayload,
          entries: filteredEntries,
          generatedAt,
          resetCount: previousPayload.resetCount + 1,
        },
        lastUpdated: generatedAt,
        lastAutoRefresh: generatedAt,
        isManual: false,
        scope: logScope,
      };
    });

    hasPrimedScopeRef.current = filteredEntries.length > 0;
    previousLogCountRef.current = filteredEntries.length;
    previousActivePodsRef.current = normalizedActivePods;
  }, [isWorkload, logEntries, logScope, normalizedActivePods, showPreviousLogs]);

  useEffect(() => {
    if (fallbackActive || showPreviousLogs) {
      hasPrimedScopeRef.current = false;
    }
  }, [fallbackActive, showPreviousLogs]);

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
  }, [autoRefresh, fallbackActive, isActive, logScope, showPreviousLogs, snapshotStatus]);

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
  }, [autoRefresh, fallbackActive, fetchFallbackLogs, isActive, logScope, showPreviousLogs]);

  useEffect(() => {
    if (!fallbackActive || !logScope || showPreviousLogs) {
      return;
    }
    objectLogFallbackManager.update(logScope, {
      autoRefresh: autoRefresh && isActive,
      fetcher: fetchFallbackLogs,
    });
  }, [autoRefresh, fallbackActive, fetchFallbackLogs, isActive, logScope, showPreviousLogs]);

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

    const initialTimer = window.setTimeout(() => {
      void attemptRecovery();
    }, 3000);
    const intervalId = window.setInterval(() => {
      void attemptRecovery();
    }, 10000);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
    };
  }, [autoRefresh, fallbackActive, isActive, logScope, showPreviousLogs]);

  useEffect(() => {
    if (!logScope || !isActive || fallbackActive || showPreviousLogs) {
      return;
    }
    if (logEntries.length > 0) {
      hasPrimedScopeRef.current = true;
      return;
    }
    if (hasPrimedScopeRef.current) {
      return;
    }
    hasPrimedScopeRef.current = true;
    void fetchFallbackLogs();
  }, [fallbackActive, fetchFallbackLogs, isActive, logEntries.length, logScope, showPreviousLogs]);

  const handleTogglePreviousLogs = useCallback(() => {
    if (!supportsPreviousLogs) {
      return;
    }
    if (!logScope) {
      dispatch({ type: 'SET_SHOW_PREVIOUS_LOGS', payload: !showPreviousLogs });
      dispatch({ type: 'SET_IS_LOADING_PREVIOUS_LOGS', payload: false });
      return;
    }

    if (showPreviousLogs) {
      dispatch({ type: 'STOP_PREVIOUS_LOGS' });
      hasPrimedScopeRef.current = false;
      return;
    }

    dispatch({ type: 'START_PREVIOUS_LOGS' });
    hasPrimedScopeRef.current = false;

    refreshOrchestrator.stopStreamingDomain(LOG_DOMAIN, logScope, { reset: false });
    refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, false);

    setScopedDomainState(LOG_DOMAIN, logScope, (previous) => {
      const previousPayload = previous.data ?? {
        entries: [],
        sequence: 0,
        generatedAt: Date.now(),
        resetCount: 0,
        error: null,
      };

      return {
        ...previous,
        status: 'loading',
        error: null,
        data: {
          ...previousPayload,
          entries: [],
        },
        scope: logScope,
      };
    });

    void fetchLogs({ previous: true, isManual: true })
      .catch((error) => {
        console.error('Failed to load previous logs', error);
      })
      .finally(() => {
        dispatch({ type: 'SET_IS_LOADING_PREVIOUS_LOGS', payload: false });
      });
  }, [fetchLogs, logScope, showPreviousLogs, supportsPreviousLogs]);

  const handleManualRefresh = useCallback(async () => {
    if (!logScope) {
      return;
    }
    dispatch({ type: 'SET_MANUAL_REFRESH_PENDING', payload: true });
    if (showPreviousLogs) {
      dispatch({ type: 'SET_IS_LOADING_PREVIOUS_LOGS', payload: true });
    }
    try {
      if (showPreviousLogs) {
        await fetchLogs({ previous: true, isManual: true });
      } else if (fallbackActive) {
        await fetchFallbackLogs(true);
      } else if (autoRefresh) {
        await refreshOrchestrator.restartStreamingDomain(LOG_DOMAIN, logScope);
      } else {
        await refreshOrchestrator.refreshStreamingDomainOnce(LOG_DOMAIN, logScope);
      }
    } catch (refreshError) {
      console.error('Failed to refresh logs', refreshError);
    } finally {
      dispatch({ type: 'SET_MANUAL_REFRESH_PENDING', payload: false });
      if (showPreviousLogs) {
        dispatch({ type: 'SET_IS_LOADING_PREVIOUS_LOGS', payload: false });
      }
    }
  }, [autoRefresh, fallbackActive, fetchFallbackLogs, fetchLogs, logScope, showPreviousLogs]);

  useEffect(() => {
    if (!supportsPreviousLogs && showPreviousLogs) {
      dispatch({ type: 'SET_SHOW_PREVIOUS_LOGS', payload: false });
      dispatch({ type: 'SET_IS_LOADING_PREVIOUS_LOGS', payload: false });
    }
  }, [supportsPreviousLogs, showPreviousLogs]);

  // Keyboard shortcuts for Logs tab
  useLogKeyboardShortcuts({
    isActive,
    dispatch,
    supportsPreviousLogs,
    canParseLogs,
    handleTogglePreviousLogs,
    filterInputRef,
  });

  // Generate consistent colors for pods (workload view)
  // Colors are read from CSS variables to support light/dark themes
  const podColors = useMemo(() => {
    const styles = getComputedStyle(document.documentElement);
    const colors = [
      styles.getPropertyValue('--log-pod-color-1').trim(),
      styles.getPropertyValue('--log-pod-color-2').trim(),
      styles.getPropertyValue('--log-pod-color-3').trim(),
      styles.getPropertyValue('--log-pod-color-4').trim(),
      styles.getPropertyValue('--log-pod-color-5').trim(),
      styles.getPropertyValue('--log-pod-color-6').trim(),
      styles.getPropertyValue('--log-pod-color-7').trim(),
      styles.getPropertyValue('--log-pod-color-8').trim(),
      styles.getPropertyValue('--log-pod-color-9').trim(),
      styles.getPropertyValue('--log-pod-color-10').trim(),
      styles.getPropertyValue('--log-pod-color-11').trim(),
      styles.getPropertyValue('--log-pod-color-12').trim(),
    ];
    const fallbackColor = styles.getPropertyValue('--log-pod-color-fallback').trim();
    const colorMap: Record<string, string> = {};

    // Get unique pod names from log entries
    const uniquePods = Array.from(new Set(logEntries.map((entry) => entry.pod)));
    uniquePods.forEach((pod, index) => {
      colorMap[pod] = colors[index % colors.length];
    });

    // Store fallback for use in render
    colorMap['__fallback__'] = fallbackColor;

    return colorMap;
  }, [logEntries]);

  useEffect(() => {
    if (isWorkload) {
      const pods = Array.from(new Set(logEntries.map((entry) => entry.pod).filter(Boolean))).sort();
      dispatch({ type: 'SET_AVAILABLE_PODS', payload: pods });
      const containersList = Array.from(
        new Set(logEntries.map((entry) => entry.container).filter(Boolean))
      ).sort();
      dispatch({ type: 'SET_AVAILABLE_CONTAINERS', payload: containersList });
    }
  }, [isWorkload, logEntries]);

  useEffect(() => {
    if (!isWorkload || !selectedFilter) {
      return;
    }
    if (selectedFilter.startsWith('pod:')) {
      const podName = selectedFilter.substring(4);
      if (!availablePods.includes(podName)) {
        dispatch({ type: 'SET_SELECTED_FILTER', payload: '' });
      }
    } else if (selectedFilter.startsWith('container:')) {
      const containerName = selectedFilter.substring(10);
      if (!availableContainers.includes(containerName)) {
        dispatch({ type: 'SET_SELECTED_FILTER', payload: '' });
      }
    }
  }, [availableContainers, availablePods, isWorkload, selectedFilter]);

  // Helper functions
  const getActualContainerName = (displayName: string) => {
    return displayName.replace(' (init)', '');
  };

  // Check if logs can be parsed as JSON
  // Format timestamp to round milliseconds to 3 digits
  const formatTimestamp = (timestamp: string): string => {
    // Regex to match RFC3339Nano format with nanoseconds
    const match = timestamp.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d+)(.*)$/);
    if (match) {
      const [, dateTime, nanos, rest] = match;
      // Take first 3 digits of fractional seconds
      const millis = nanos.substring(0, 3).padEnd(3, '0');
      return `${dateTime}.${millis}${rest}`;
    }
    return timestamp;
  };
  const formatParsedValue = (value: unknown): string => {
    if (value === undefined || value === null) {
      return '-';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    if (typeof value === 'string') {
      return value.length > 0 ? value : '-';
    }
    const stringified = String(value);
    return stringified.length > 0 ? stringified : '-';
  };
  const displayLogs = useMemo(() => {
    if (filteredEntries.length === 0) {
      if (isPendingLogs) {
        return '';
      }
      return textFilter.trim() ? 'No logs match the filter' : 'No logs available';
    }

    return filteredEntries
      .map((entry) => {
        const timestampPrefix =
          showTimestamps && entry.timestamp ? `[${formatTimestamp(entry.timestamp)}] ` : '';

        if (isWorkload) {
          const containerLabel = entry.isInit ? `${entry.container}:init` : entry.container;
          const formatted = entry.line.trim()
            ? `[${entry.pod}/${containerLabel}] ${entry.line}`
            : entry.line;
          return timestampPrefix + formatted;
        }

        if (selectedContainer === ALL_CONTAINERS) {
          const containerLabel = entry.isInit ? `${entry.container}:init` : entry.container;
          const formatted = entry.line.trim() ? `[${containerLabel}] ${entry.line}` : entry.line;
          return timestampPrefix + formatted;
        }

        return timestampPrefix + entry.line;
      })
      .join('\n');
  }, [filteredEntries, isPendingLogs, isWorkload, selectedContainer, showTimestamps, textFilter]);

  const handleCopyLogs = useCallback(async () => {
    const text = isParsedView
      ? parsedLogs
          .map((entry) => {
            const payload = { ...entry } as Record<string, unknown>;
            Object.keys(payload).forEach((key) => {
              if (key.startsWith('_')) {
                delete payload[key];
              }
            });
            return Object.keys(payload).length ? JSON.stringify(payload) : entry._rawLine;
          })
          .join('\n')
      : displayLogs;
    if (!text) {
      dispatch({ type: 'SET_COPY_FEEDBACK', payload: 'error' });
      window.setTimeout(() => dispatch({ type: 'SET_COPY_FEEDBACK', payload: 'idle' }), 1500);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      dispatch({ type: 'SET_COPY_FEEDBACK', payload: 'copied' });
      window.setTimeout(() => dispatch({ type: 'SET_COPY_FEEDBACK', payload: 'idle' }), 1500);
    } catch (err) {
      console.error('Failed to copy logs', err);
      dispatch({ type: 'SET_COPY_FEEDBACK', payload: 'error' });
      window.setTimeout(() => dispatch({ type: 'SET_COPY_FEEDBACK', payload: 'idle' }), 1500);
    }
  }, [displayLogs, isParsedView, parsedLogs]);

  useEffect(() => {
    if (!isParsedView) {
      dispatch({ type: 'SET_PARSED_LOGS', payload: [] });
      return;
    }
    if (!parsedCandidates.length) {
      dispatch({ type: 'SET_PARSED_LOGS', payload: [] });
      dispatch({ type: 'SET_PARSED_VIEW', payload: false });
      return;
    }
    dispatch({ type: 'SET_PARSED_LOGS', payload: parsedCandidates });
  }, [isParsedView, parsedCandidates]);

  // Fetch containers for single pod
  useEffect(() => {
    if (isWorkload || !namespace || !podName) return;

    let isCancelled = false;
    const fetchContainers = async () => {
      try {
        const containerList = await GetPodContainers(resolvedClusterId, namespace, podName);

        if (isCancelled) return;

        if (!containerList || containerList.length === 0) {
          dispatch({ type: 'SET_CONTAINERS', payload: [] });
          dispatch({ type: 'SET_SELECTED_CONTAINER', payload: '' });
          return;
        }

        dispatch({ type: 'SET_CONTAINERS', payload: containerList });

        // Auto-select container
        if (containerList.length === 1) {
          // For single container, use the actual container name
          dispatch({
            type: 'SET_SELECTED_CONTAINER',
            payload: getActualContainerName(containerList[0]),
          });
        } else {
          // For multiple containers, default to all
          dispatch({ type: 'SET_SELECTED_CONTAINER', payload: ALL_CONTAINERS });
        }
      } catch (err) {
        if (isCancelled) return;
        console.warn('Failed to fetch containers:', err);
        dispatch({ type: 'SET_CONTAINERS', payload: [] });
        dispatch({ type: 'SET_SELECTED_CONTAINER', payload: '' });
      } finally {
        // nothing to clean up
      }
    };

    fetchContainers();

    return () => {
      isCancelled = true;
    };
  }, [namespace, podName, isWorkload]);

  // Auto-scroll effect - only scroll when there are new logs or view changes
  useEffect(() => {
    if (autoScroll && logsContentRef.current) {
      const currentLogCount = isParsedView ? parsedLogs.length : logEntries.length;
      const hasNewLogs = currentLogCount > previousLogCountRef.current;
      const isViewChange = previousLogCountRef.current === 0; // Initial load or view switch

      // Update the previous count for next comparison
      previousLogCountRef.current = currentLogCount;

      // Only scroll if there are new logs or it's an initial load/view change
      if (!hasNewLogs && !isViewChange) {
        return;
      }

      const scrollToBottom = () => {
        if (!logsContentRef.current) return;

        if (isParsedView) {
          // For parsed view, find the last row and scroll it into view
          const rows = logsContentRef.current.querySelectorAll('tbody tr');
          if (rows && rows.length > 0) {
            const lastRow = rows[rows.length - 1];
            lastRow.scrollIntoView({ behavior: 'auto', block: 'end' });
          }
        } else {
          // For raw view, scroll the container to bottom
          logsContentRef.current.scrollTop = logsContentRef.current.scrollHeight;
        }
      };

      if (isParsedView && parsedLogs.length > 0) {
        // For parsed view, wait for table rows to render
        let attempts = 0;
        const maxAttempts = 20; // About 333ms at 60fps

        const checkAndScroll = () => {
          const rows = logsContentRef.current?.querySelectorAll('tbody tr');
          if (rows && rows.length > 0) {
            // Table rows are rendered, scroll to last one
            requestAnimationFrame(scrollToBottom);
          } else if (attempts < maxAttempts) {
            // Try again next frame
            attempts++;
            requestAnimationFrame(checkAndScroll);
          }
        };

        requestAnimationFrame(checkAndScroll);
      } else if (!isParsedView && displayLogs) {
        // For raw view, scroll immediately after next frame
        requestAnimationFrame(scrollToBottom);
      }
    }
  }, [autoScroll, displayLogs, isParsedView, logEntries.length, parsedLogs.length]);

  // Reset previous count when switching views
  useEffect(() => {
    previousLogCountRef.current = 0;
  }, [isParsedView]);

  // Table columns for parsed view - track field keys from parsed logs
  // Note: We use a ref to track previous keys to avoid infinite loops
  const parsedFieldKeysRef = useRef<string[]>([]);
  useEffect(() => {
    if (parsedLogs.length === 0) {
      if (parsedFieldKeysRef.current.length > 0) {
        parsedFieldKeysRef.current = [];
        dispatch({ type: 'SET_PARSED_FIELD_KEYS', payload: [] });
      }
      return;
    }
    const existingKeys = new Set(parsedFieldKeysRef.current);
    const newKeys: string[] = [];
    parsedLogs.forEach((entry) => {
      Object.keys(entry).forEach((key) => {
        if (!key.startsWith('_') && !existingKeys.has(key) && !newKeys.includes(key)) {
          newKeys.push(key);
        }
      });
    });
    if (newKeys.length > 0) {
      parsedFieldKeysRef.current = [...parsedFieldKeysRef.current, ...newKeys];
      dispatch({ type: 'ADD_PARSED_FIELD_KEYS', payload: newKeys });
    }
  }, [parsedLogs]);

  const tableColumns = useMemo(() => {
    if (parsedLogs.length === 0) return [];

    const columns: GridColumnDefinition<ParsedLogEntry>[] = [];
    const sample = parsedLogs[0];

    if (showTimestamps && sample._timestamp) {
      columns.push({
        key: '_timestamp',
        header: 'API Timestamp',
        sortable: false,
        minWidth: PARSED_TIMESTAMP_MIN_WIDTH,
        render: (item: ParsedLogEntry) =>
          item._timestamp ? formatTimestamp(item._timestamp) : '-',
      });
    }

    if (isWorkload && sample._pod) {
      columns.push({
        key: '_pod',
        header: 'Pod',
        sortable: false,
        minWidth: PARSED_POD_COLUMN_MIN_WIDTH,
        render: (item: ParsedLogEntry) => (
          <span style={{ color: podColors[item._pod || ''] || podColors['__fallback__'] }}>
            {item._pod || '-'}
          </span>
        ),
      });
    }

    if (sample._container) {
      columns.push({
        key: '_container',
        header: 'Container',
        sortable: false,
        minWidth: PARSED_POD_COLUMN_MIN_WIDTH,
        render: (item: ParsedLogEntry) => item._container || '-',
      });
    }

    const timestampCandidates = ['timestamp', 'time', 'ts'];
    const jsonTimestampKey = parsedFieldKeys.find((key) => timestampCandidates.includes(key));
    if (jsonTimestampKey) {
      columns.push({
        key: jsonTimestampKey,
        header: jsonTimestampKey,
        sortable: false,
        minWidth: PARSED_TIMESTAMP_MIN_WIDTH,
        render: (item: ParsedLogEntry) => {
          const value = item[jsonTimestampKey];
          return formatParsedValue(value);
        },
      });
    }

    const levelCandidates = ['level', 'severity', 'log_level'];
    const jsonLevelKey = parsedFieldKeys.find((key) => levelCandidates.includes(key));
    if (jsonLevelKey) {
      columns.push({
        key: jsonLevelKey,
        header: jsonLevelKey,
        sortable: false,
        minWidth: PARSED_COLUMN_MIN_WIDTH,
        render: (item: ParsedLogEntry) => {
          const value = item[jsonLevelKey];
          return formatParsedValue(value);
        },
      });
    }

    const addedKeys = new Set(columns.map((col) => col.key));
    parsedFieldKeys.forEach((key) => {
      if (addedKeys.has(key)) {
        return;
      }
      columns.push({
        key,
        header: key,
        sortable: false,
        minWidth: PARSED_COLUMN_MIN_WIDTH,
        render: (item: ParsedLogEntry) => {
          const value = item[key];
          const displayValue = formatParsedValue(value);
          return (
            <div
              className="parsed-log-cell"
              title={displayValue}
              style={{
                maxWidth: '300px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {displayValue}
            </div>
          );
        },
      });
    });

    return columns;
  }, [isWorkload, parsedFieldKeys, parsedLogs, podColors, showTimestamps]);

  // Loading state
  if (isPendingLogs) {
    return (
      <div className="object-panel-tab-content">
        <LoadingSpinner message="Loading logs..." />
      </div>
    );
  }

  // Error state
  if (!pendingFallback && displayError && logEntries.length === 0) {
    return (
      <div className="object-panel-tab-content">
        <div className="pod-logs-display-error">
          <div className="error-message">Error: {displayError}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="object-panel-tab-content">
      <div className="pod-logs-display">
        <div className="pod-logs-controls">
          <div className="pod-logs-controls-left">
            {/* Pod and Container selector for workload view */}
            {isWorkload && (availablePods.length > 0 || availableContainers.length > 0) && (
              <div className="pod-logs-control-group">
                <Dropdown
                  options={[
                    ...(isPendingLogs
                      ? [{ value: '_loading', label: 'Loading logs…', disabled: true }]
                      : []),
                    { value: '', label: 'All Logs' },
                    ...(availablePods.length > 0
                      ? [
                          { value: '_pods_header', label: 'Pods', disabled: true, group: 'header' },
                          ...availablePods.map((pod) => ({
                            value: `pod:${pod}`,
                            label: pod,
                            group: 'Pods',
                          })),
                        ]
                      : []),
                    ...(availableContainers.length > 0
                      ? [
                          {
                            value: '_containers_header',
                            label: 'Containers',
                            disabled: true,
                            group: 'header',
                          },
                          ...availableContainers.map((container) => ({
                            value: `container:${container}`,
                            label: container,
                            group: 'Containers',
                          })),
                        ]
                      : []),
                  ]}
                  value={selectedFilter}
                  onChange={(value) =>
                    dispatch({ type: 'SET_SELECTED_FILTER', payload: value as string })
                  }
                  size="compact"
                />
              </div>
            )}

            {/* Container selector for single pod */}
            {!isWorkload && containers.length > 0 && (
              <div className="pod-logs-control-group">
                <Dropdown
                  options={[
                    ...(containers.length > 1 ? [{ value: ALL_CONTAINERS, label: 'All' }] : []),
                    ...containers.map((container) => ({
                      value: getActualContainerName(container),
                      label: container,
                    })),
                  ]}
                  value={selectedContainer}
                  onChange={(value) =>
                    dispatch({ type: 'SET_SELECTED_CONTAINER', payload: value as string })
                  }
                  size="compact"
                />
              </div>
            )}

            {/* Text filter input */}
            <div className="pod-logs-control-group pod-logs-filter-group">
              <input
                type="text"
                ref={filterInputRef}
                value={textFilter}
                onChange={(e) => dispatch({ type: 'SET_TEXT_FILTER', payload: e.target.value })}
                placeholder="Filter logs..."
                className="pod-logs-text-filter"
                title="Filter logs by text (searches in log lines, pods, and containers)"
              />
              {textFilter && (
                <button
                  className="pod-logs-filter-clear"
                  onClick={() => dispatch({ type: 'SET_TEXT_FILTER', payload: '' })}
                  title="Clear filter"
                  aria-label="Clear filter"
                >
                  ×
                </button>
              )}
            </div>

            <Dropdown
              options={[
                {
                  value: 'autoScroll',
                  label: 'Auto-scroll',
                  metadata: { checked: autoScroll, shortcut: 'S' },
                },
                {
                  value: 'autoRefresh',
                  label: 'Auto-refresh',
                  metadata: { checked: autoRefresh, shortcut: 'R' },
                },
                ...(supportsPreviousLogs
                  ? [
                      {
                        value: 'previousLogs',
                        label: 'Show previous logs',
                        metadata: { checked: showPreviousLogs, shortcut: 'X' },
                      },
                    ]
                  : []),
                {
                  value: 'showTimestamps',
                  label: 'Show API timestamps',
                  metadata: { checked: showTimestamps, shortcut: 'T' },
                },
                {
                  value: 'wrapText',
                  label: 'Wrap text',
                  metadata: { checked: wrapText, shortcut: 'W' },
                },
                ...(canParseLogs
                  ? [
                      {
                        value: 'parseJson',
                        label: 'Parse as JSON',
                        metadata: { checked: isParsedView, shortcut: 'P' },
                        disabled: !canParseLogs,
                      },
                    ]
                  : []),
              ]}
              value="options"
              onChange={(value) => {
                if (value !== 'options') {
                  switch (value) {
                    case 'autoScroll':
                      dispatch({ type: 'TOGGLE_AUTO_SCROLL' });
                      break;
                    case 'autoRefresh':
                      dispatch({ type: 'TOGGLE_AUTO_REFRESH' });
                      break;
                    case 'previousLogs':
                      if (supportsPreviousLogs) {
                        handleTogglePreviousLogs();
                      }
                      break;
                    case 'showTimestamps':
                      dispatch({ type: 'TOGGLE_TIMESTAMPS' });
                      break;
                    case 'wrapText':
                      dispatch({ type: 'TOGGLE_WRAP_TEXT' });
                      break;
                    case 'parseJson':
                      if (!canParseLogs) {
                        break;
                      }
                      dispatch({ type: 'TOGGLE_PARSED_VIEW' });
                      break;
                  }
                }
              }}
              displayValue="Options"
              size="compact"
              renderOption={(option) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                  <span style={{ width: '20px', textAlign: 'center' }}>
                    {option.metadata?.checked ? '✓' : ''}
                  </span>
                  <span style={{ flex: 1 }}>{option.label}</span>
                  <span className="keycap">
                    <kbd>{option.metadata?.shortcut}</kbd>
                  </span>
                </div>
              )}
            />

            {!autoRefresh && (
              <button
                className="button generic"
                onClick={handleManualRefresh}
                disabled={loading || manualRefreshPending}
              >
                {manualRefreshPending ? 'Refreshing…' : 'Refresh'}
              </button>
            )}
            <button
              className="button generic"
              onClick={handleCopyLogs}
              disabled={!displayLogs && !isParsedView}
              title="Copy all logs to clipboard"
            >
              {copyFeedback === 'copied'
                ? 'Copied'
                : copyFeedback === 'error'
                  ? 'Copy failed'
                  : 'Copy'}
            </button>
          </div>
        </div>

        {fallbackActive && (
          <div className="pod-logs-fallback-banner">
            <span>
              Streaming unavailable
              {fallbackDisplayError ? `: ${fallbackDisplayError}` : ''}. Showing fallback updates
              {autoRefresh ? ' every 2s' : ''}. Retrying connection automatically…
            </span>
          </div>
        )}

        <div className="pod-logs-content" ref={logsContentRef}>
          {isParsedView ? (
            <GridTable
              data={parsedLogs}
              columns={tableColumns}
              keyExtractor={(_item: ParsedLogEntry, index: number) => `log-${index}`}
              className="parsed-logs-table"
              tableClassName="gridtable-parsed-logs"
              virtualization={GRIDTABLE_VIRTUALIZATION_DEFAULT}
            />
          ) : (
            <div className={`pod-logs-text ${!wrapText ? 'no-wrap' : ''}`}>
              {displayLogs
                ? displayLogs.split('\n').map((line, index) => {
                    // For workload logs, apply color to pod name and timestamp
                    // Note: Lines only have pod info if backend successfully found pods for the workload
                    if (isWorkload && line.includes('[') && line.includes('/')) {
                      // Handle both with and without timestamps
                      // Pattern: optional timestamp [pod/container] rest of line
                      const match = line.match(
                        /^(?:\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s*)?\[([^\/]+)\/([^\]]+)\]\s*(.*)/
                      );
                      if (match) {
                        const [, pod, container, logLine] = match;
                        // Extract timestamp if present
                        const timestampMatch = line.match(/^(\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s*)/);
                        const timestamp = timestampMatch ? timestampMatch[1] : '';
                        const podColor = podColors[pod] || podColors['__fallback__'];

                        return (
                          <div key={index} className="pod-log-line">
                            {timestamp && (
                              <span className="pod-log-metadata" style={{ color: podColor }}>
                                {timestamp}
                              </span>
                            )}
                            <span
                              className="pod-log-metadata"
                              style={{ color: podColor, fontWeight: 500 }}
                            >
                              [{pod}/{container}]
                            </span>
                            <span> {logLine}</span>
                          </div>
                        );
                      }
                    }

                    if (!isWorkload) {
                      let workingLine = line;
                      let timestampPrefix = '';
                      if (showTimestamps) {
                        const podTimestampMatch = line.match(
                          /^(\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s*)(.*)$/
                        );
                        if (podTimestampMatch) {
                          timestampPrefix = podTimestampMatch[1] ?? '';
                          workingLine = podTimestampMatch[2] ?? '';
                        }
                      }

                      const containerMatch = workingLine.match(/^\[([^\]]+)\]\s*(.*)$/);
                      const showContainerMeta =
                        containerMatch && selectedContainer === ALL_CONTAINERS;
                      if (timestampPrefix || showContainerMeta) {
                        const containerLabel = containerMatch ? containerMatch[1] : '';
                        const remainder = containerMatch ? containerMatch[2] : workingLine;
                        return (
                          <div key={index} className="pod-log-line">
                            {timestampPrefix && (
                              <span className="pod-log-metadata">{timestampPrefix}</span>
                            )}
                            {showContainerMeta && (
                              <span className="pod-log-metadata">[{containerLabel}]</span>
                            )}
                            <span> {remainder || '\u00A0'}</span>
                          </div>
                        );
                      }
                    }

                    return (
                      <div key={index} className="pod-log-line">
                        {line || '\u00A0'}
                      </div>
                    );
                  })
                : showPreviousLogs
                  ? 'No previous logs found'
                  : 'No logs available'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LogViewer;
