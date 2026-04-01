/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx
 *
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
import { useLogStreamFallback, isLogDataUnavailable } from './hooks/useLogStreamFallback';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import './LogViewer.css';
import { refreshOrchestrator } from '@/core/refresh/orchestrator';
import { setScopedDomainState, useRefreshScopedDomain } from '@/core/refresh/store';
import type { ObjectLogEntry } from '@/core/refresh/types';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import type { types } from '@wailsjs/go/models';
import {
  ALL_CONTAINERS,
  logViewerReducer,
  initialLogViewerState,
  type ParsedLogEntry,
} from './logViewerReducer';
import { CLUSTER_SCOPE, INACTIVE_SCOPE } from '../constants';

interface LogViewerProps {
  namespace: string;
  resourceName: string;
  resourceKind: string;
  isActive?: boolean;
  activePodNames?: string[] | null;
  clusterId?: string | null;
  /** Restore parsed view state from a previous mount. */
  initialParsedView?: boolean;
  /** Called when parsed view state changes so the parent can preserve it. */
  onParsedViewChange?: (isParsed: boolean) => void;
}

const LOG_DOMAIN = 'object-logs' as const;
const PARSED_COLUMN_MIN_WIDTH = 120;
const PARSED_TIMESTAMP_MIN_WIDTH = 180;
const PARSED_POD_COLUMN_MIN_WIDTH = 160;

// Truncate RFC3339Nano timestamps to millisecond precision for display
const formatTimestamp = (timestamp: string): string => {
  const match = timestamp.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d+)(.*)$/);
  if (match) {
    const [, dateTime, nanos, rest] = match;
    const millis = nanos.substring(0, 3).padEnd(3, '0');
    return `${dateTime}.${millis}${rest}`;
  }
  return timestamp;
};

// Format a parsed JSON value for table cell display
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

// Build a display label for a container, appending :init for init containers
const formatContainerLabel = (container: string, isInit: boolean): string =>
  isInit ? `${container}:init` : container;

const LogViewer: React.FC<LogViewerProps> = ({
  namespace,
  resourceName,
  resourceKind: resourceKind,
  isActive = false,
  activePodNames = null,
  clusterId,
  initialParsedView = false,
  onParsedViewChange,
}) => {
  // Consolidated state via reducer. Restore parsed view from parent if provided.
  const [state, dispatch] = useReducer(logViewerReducer, {
    ...initialLogViewerState,
    isParsedView: initialParsedView,
  });

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
    expandedRows,
    manualRefreshPending,
    fallbackActive,
    fallbackError,
    showPreviousLogs,
    isLoadingPreviousLogs,
  } = state;

  // Notify parent when parsed view changes so it can preserve across remounts
  useEffect(() => {
    onParsedViewChange?.(isParsedView);
  }, [isParsedView, onParsedViewChange]);

  const hasPrimedScopeRef = useRef(false);
  const fallbackRecoveringRef = useRef(false);
  const previousActivePodsRef = useRef<string[] | null>(null);
  const previousLogScopeRef = useRef<string | null>(null);
  const resolvedClusterId = clusterId?.trim() ?? '';

  // Refs
  const logsContentRef = useRef<HTMLDivElement>(null);
  const previousLogCountRef = useRef<number>(0);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const seqCounterRef = useRef(0);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Reset state when scope changes - do this during render, not in an effect,
  // to avoid causing a re-render that would interrupt streaming startup
  if (logScope !== previousLogScopeRef.current) {
    const hadPreviousScope = previousLogScopeRef.current !== null;
    previousLogScopeRef.current = logScope;
    hasPrimedScopeRef.current = false;
    previousActivePodsRef.current = null;
    // Only dispatch RESET_FOR_NEW_SCOPE if we had a previous scope (not on initial render)
    // This prevents a re-render that would interrupt streaming startup
    if (hadPreviousScope) {
      dispatch({ type: 'RESET_FOR_NEW_SCOPE', isWorkload });
    }
  }

  const logSnapshot = useRefreshScopedDomain(LOG_DOMAIN, logScope ?? INACTIVE_SCOPE);
  const payloadEntries = logScope ? logSnapshot.data?.entries : undefined;
  const rawLogEntries: ObjectLogEntry[] = useMemo(() => payloadEntries ?? [], [payloadEntries]);

  // When autoScroll is off the user is reading in place. Buffer truncation
  // in LogStreamManager removes entries from the front, which would shift
  // the content and cause the viewport to jump. Prevent this by keeping a
  // stable list that only grows (appends) while autoScroll is off.
  const stableEntriesRef = useRef<ObjectLogEntry[]>([]);
  const logEntries: ObjectLogEntry[] = useMemo(() => {
    if (autoScroll) {
      stableEntriesRef.current = rawLogEntries;
      return rawLogEntries;
    }

    const stable = stableEntriesRef.current;
    if (stable.length === 0 || rawLogEntries.length === 0) {
      stableEntriesRef.current = rawLogEntries;
      return rawLogEntries;
    }

    // Find entries newer than the last one in our stable list.
    const lastStableSeq = stable[stable.length - 1]._seq ?? 0;
    const newEntries = rawLogEntries.filter((e) => (e._seq ?? 0) > lastStableSeq);

    if (newEntries.length === 0) {
      return stable;
    }

    const merged = [...stable, ...newEntries];
    stableEntriesRef.current = merged;
    return merged;
  }, [autoScroll, rawLogEntries]);
  const snapshotStatus = logScope ? logSnapshot.status : 'idle';
  const snapshotError = logScope ? logSnapshot.error : null;
  // sequence 1 = connected event, sequence >= 2 = initial logs received (may be empty)
  const snapshotSequence = logScope ? (logSnapshot.data?.sequence ?? 0) : 0;
  const hasReceivedInitialLogs = snapshotSequence >= 2;
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
      (!hasReceivedInitialLogs ||
        !hasPrimedScopeRef.current ||
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
          _seq: ++seqCounterRef.current,
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

  // Stream lifecycle, fallback activation, recovery, and initial log priming.
  useLogStreamFallback({
    logScope,
    isActive,
    autoRefresh,
    showPreviousLogs,
    snapshotStatus,
    logEntriesLength: logEntries.length,
    fallbackActive,
    fetchFallbackLogs,
    dispatch,
    fallbackRecoveringRef,
    hasPrimedScopeRef,
  });

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
        // Streaming domain is stopped when autoRefresh is off, so fetch directly.
        await fetchLogs({ isManual: true });
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
    isParsedView,
    autoScroll,
    dispatch,
    supportsPreviousLogs,
    canParseLogs,
    handleTogglePreviousLogs,
    filterInputRef,
    logsContentRef,
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

    // Use the already-deduplicated and sorted pod list from state
    availablePods.forEach((pod, index) => {
      colorMap[pod] = colors[index % colors.length];
    });

    // Store fallback for use in render
    colorMap['__fallback__'] = fallbackColor;

    return colorMap;
  }, [availablePods]);

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
    return displayName.replace(' (init)', '').replace(' (debug)', '');
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
          const containerLabel = formatContainerLabel(entry.container, entry.isInit);
          const formatted = entry.line.trim()
            ? `[${entry.pod}/${containerLabel}] ${entry.line}`
            : entry.line;
          return timestampPrefix + formatted;
        }

        if (selectedContainer === ALL_CONTAINERS) {
          const containerLabel = formatContainerLabel(entry.container, entry.isInit);
          const formatted = entry.line.trim() ? `[${containerLabel}] ${entry.line}` : entry.line;
          return timestampPrefix + formatted;
        }

        return timestampPrefix + entry.line;
      })
      .join('\n');
  }, [filteredEntries, isPendingLogs, isWorkload, selectedContainer, showTimestamps, textFilter]);

  // Schedule copy feedback reset, cancelling any prior pending timer
  const scheduleCopyReset = useCallback(() => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(
      () => dispatch({ type: 'SET_COPY_FEEDBACK', payload: 'idle' }),
      1500
    );
  }, [dispatch]);

  // Clean up copy timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopyLogs = useCallback(async () => {
    const text = isParsedView
      ? parsedLogs
          .map((entry) =>
            Object.keys(entry.data).length ? JSON.stringify(entry.data) : entry.rawLine
          )
          .join('\n')
      : displayLogs;
    if (!text) {
      dispatch({ type: 'SET_COPY_FEEDBACK', payload: 'error' });
      scheduleCopyReset();
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      dispatch({ type: 'SET_COPY_FEEDBACK', payload: 'copied' });
      scheduleCopyReset();
    } catch (err) {
      console.error('Failed to copy logs', err);
      dispatch({ type: 'SET_COPY_FEEDBACK', payload: 'error' });
      scheduleCopyReset();
    }
  }, [displayLogs, isParsedView, parsedLogs, scheduleCopyReset, dispatch]);

  useEffect(() => {
    if (!isParsedView) {
      dispatch({ type: 'SET_PARSED_LOGS', payload: [] });
      return;
    }
    if (!parsedCandidates.length) {
      // Only exit parsed view if there are entries but none are JSON.
      // When entries are empty (e.g. stream reconnecting), keep parsed view
      // active so the user isn't kicked out on transient empty states.
      if (filteredEntries.length > 0) {
        dispatch({ type: 'SET_PARSED_LOGS', payload: [] });
        dispatch({ type: 'SET_PARSED_VIEW', payload: false });
      }
      return;
    }
    dispatch({ type: 'SET_PARSED_LOGS', payload: parsedCandidates });
  }, [isParsedView, parsedCandidates, filteredEntries.length]);

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
  }, [namespace, podName, isWorkload, resolvedClusterId]);

  // When auto-refresh is re-enabled, the stream restarts with a fresh
  // (smaller) batch. Reset the previous log count so the auto-scroll
  // effect treats it as an initial load and scrolls to the bottom.
  const prevAutoRefreshRef = useRef(autoRefresh);
  useEffect(() => {
    const wasOff = !prevAutoRefreshRef.current;
    prevAutoRefreshRef.current = autoRefresh;
    if (wasOff && autoRefresh && autoScroll) {
      previousLogCountRef.current = 0;
    }
  }, [autoRefresh, autoScroll]);

  // Track previous view to detect view switches
  const previousIsParsedViewRef = useRef(isParsedView);

  // Auto-scroll effect - only scroll when there are new logs or view changes
  useEffect(() => {
    if (autoScroll && logsContentRef.current) {
      const currentLogCount = isParsedView ? parsedLogs.length : logEntries.length;
      const hasNewLogs = currentLogCount > previousLogCountRef.current;
      const isViewChange = previousIsParsedViewRef.current !== isParsedView;
      const isInitialLoad = previousLogCountRef.current === 0;

      // Update refs for next comparison
      previousLogCountRef.current = currentLogCount;
      previousIsParsedViewRef.current = isParsedView;

      // Only scroll if there are new logs, view switch, or initial load
      if (!hasNewLogs && !isViewChange && !isInitialLoad) {
        return;
      }

      const scrollToBottom = () => {
        if (!logsContentRef.current) return;

        if (isParsedView) {
          // For parsed view with virtualization, find the gridtable-wrapper and scroll it
          const wrapper = logsContentRef.current.querySelector('.gridtable-wrapper');
          if (wrapper) {
            wrapper.scrollTop = wrapper.scrollHeight;
          }
        } else {
          // For raw view, scroll the container to bottom
          logsContentRef.current.scrollTop = logsContentRef.current.scrollHeight;
        }
      };

      let rafId: number | undefined;

      if (isParsedView && parsedLogs.length > 0) {
        // For parsed view, wait for the gridtable-wrapper to be rendered
        let attempts = 0;
        const maxAttempts = 20; // About 333ms at 60fps

        const checkAndScroll = () => {
          const wrapper = logsContentRef.current?.querySelector('.gridtable-wrapper');
          if (wrapper && wrapper.scrollHeight > 0) {
            rafId = requestAnimationFrame(scrollToBottom);
          } else if (attempts < maxAttempts) {
            attempts++;
            rafId = requestAnimationFrame(checkAndScroll);
          }
        };

        rafId = requestAnimationFrame(checkAndScroll);
      } else if (!isParsedView && displayLogs) {
        // For raw view, scroll immediately after next frame
        rafId = requestAnimationFrame(scrollToBottom);
      }

      return () => {
        if (rafId !== undefined) cancelAnimationFrame(rafId);
      };
    }
  }, [autoScroll, displayLogs, isParsedView, logEntries.length, parsedLogs.length]);

  // Derive field keys directly from parsed log data
  const derivedFieldKeys = useMemo(() => {
    if (parsedLogs.length === 0) return [];
    const seen = new Set<string>();
    for (const entry of parsedLogs) {
      for (const key of Object.keys(entry.data)) {
        seen.add(key);
      }
    }
    // Sort alphabetically so column order is stable across buffer changes
    return Array.from(seen).sort();
  }, [parsedLogs]);

  const tableColumns = useMemo(() => {
    if (derivedFieldKeys.length === 0) return [];

    const columns: GridColumnDefinition<ParsedLogEntry>[] = [];

    // Always show metadata columns when relevant — don't gate on first entry
    if (showTimestamps) {
      columns.push({
        key: '_timestamp',
        header: 'API Timestamp',
        sortable: false,
        minWidth: PARSED_TIMESTAMP_MIN_WIDTH,
        render: (item: ParsedLogEntry) => (item.timestamp ? formatTimestamp(item.timestamp) : '-'),
      });
    }

    if (isWorkload) {
      columns.push({
        key: '_pod',
        header: 'Pod',
        sortable: false,
        minWidth: PARSED_POD_COLUMN_MIN_WIDTH,
        render: (item: ParsedLogEntry) => (
          <span
            className="pod-color-text"
            style={
              {
                '--pod-color': podColors[item.pod || ''] || podColors['__fallback__'],
              } as React.CSSProperties
            }
          >
            {item.pod || '-'}
          </span>
        ),
      });
    }

    columns.push({
      key: '_container',
      header: 'Container',
      sortable: false,
      minWidth: PARSED_POD_COLUMN_MIN_WIDTH,
      render: (item: ParsedLogEntry) => item.container || '-',
    });

    // Promote well-known timestamp and level fields to appear first
    const timestampCandidates = ['timestamp', 'time', 'ts'];
    const jsonTimestampKey = derivedFieldKeys.find((key) => timestampCandidates.includes(key));
    if (jsonTimestampKey) {
      columns.push({
        key: jsonTimestampKey,
        header: jsonTimestampKey,
        sortable: false,
        minWidth: PARSED_TIMESTAMP_MIN_WIDTH,
        render: (item: ParsedLogEntry) => formatParsedValue(item.data[jsonTimestampKey]),
      });
    }

    const levelCandidates = ['level', 'severity', 'log_level'];
    const jsonLevelKey = derivedFieldKeys.find((key) => levelCandidates.includes(key));
    if (jsonLevelKey) {
      columns.push({
        key: jsonLevelKey,
        header: jsonLevelKey,
        sortable: false,
        minWidth: PARSED_COLUMN_MIN_WIDTH,
        render: (item: ParsedLogEntry) => formatParsedValue(item.data[jsonLevelKey]),
      });
    }

    // Add remaining user-data columns
    const addedKeys = new Set(columns.map((col) => col.key));
    derivedFieldKeys.forEach((key) => {
      if (addedKeys.has(key)) {
        return;
      }
      columns.push({
        key,
        header: key,
        sortable: false,
        minWidth: PARSED_COLUMN_MIN_WIDTH,
        render: (item: ParsedLogEntry) => {
          const displayValue = formatParsedValue(item.data[key]);
          return (
            <div className="parsed-log-cell" title={displayValue}>
              {displayValue}
            </div>
          );
        },
      });
    });

    return columns;
  }, [derivedFieldKeys, isWorkload, podColors, showTimestamps]);

  // Row expansion for parsed view.
  // GridTable's onRowClick only fires for keyboard activation (Enter), not mouse
  // clicks, so we use event delegation on a wrapper to handle pointer clicks.
  const handleParsedTableClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.gridtable-row');
      if (!row) return;
      const key = row.dataset.rowKey;
      if (key) {
        dispatch({ type: 'TOGGLE_ROW_EXPANSION', payload: key });
      }
    },
    [dispatch]
  );

  // Also wire onRowClick for keyboard (Enter) accessibility
  const handleParsedRowKeyboard = useCallback(
    (item: ParsedLogEntry) => {
      const key = `log-${item.seq ?? item.lineNumber}`;
      dispatch({ type: 'TOGGLE_ROW_EXPANSION', payload: key });
    },
    [dispatch]
  );

  const getParsedRowClassName = useCallback(
    (_item: ParsedLogEntry, index: number) => {
      const key = `log-${parsedLogs[index]?.seq ?? parsedLogs[index]?.lineNumber ?? index}`;
      return expandedRows.has(key) ? 'parsed-row-expanded' : undefined;
    },
    [expandedRows, parsedLogs]
  );

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
                <div className="log-option-row">
                  <span className="log-option-check">{option.metadata?.checked ? '✓' : ''}</span>
                  <span className="log-option-label">{option.label}</span>
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
            <div onClick={handleParsedTableClick} style={{ height: '100%' }}>
              <GridTable
                data={parsedLogs}
                columns={tableColumns}
                keyExtractor={(item: ParsedLogEntry) => `log-${item.seq ?? item.lineNumber}`}
                onRowClick={handleParsedRowKeyboard}
                getRowClassName={getParsedRowClassName}
                className="parsed-logs-table"
                tableClassName="gridtable-parsed-logs"
                virtualization={GRIDTABLE_VIRTUALIZATION_DEFAULT}
              />
            </div>
          ) : (
            <div className={`pod-logs-text ${!wrapText ? 'no-wrap' : ''}`}>
              {displayLogs
                ? displayLogs.split('\n').map((line, index) => {
                    // Stable key: use _seq from the source entry so buffer
                    // truncation doesn't shift every key and cause scroll jumps.
                    const entryKey = filteredEntries[index]?._seq ?? index;

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
                          <div key={entryKey} className="pod-log-line">
                            {timestamp && (
                              <span
                                className="pod-log-metadata pod-color-text"
                                style={{ '--pod-color': podColor } as React.CSSProperties}
                              >
                                {timestamp}
                              </span>
                            )}
                            <span
                              className="pod-log-metadata pod-log-metadata--bold"
                              style={{ '--pod-color': podColor } as React.CSSProperties}
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
                          <div key={entryKey} className="pod-log-line">
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
                      <div key={entryKey} className="pod-log-line">
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
