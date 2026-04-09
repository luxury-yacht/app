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
import {
  AutoRefreshIcon,
  PreviousLogsIcon,
  TimestampIcon,
  WrapTextIcon,
  ParseJsonIcon,
  CopyIcon,
} from '@shared/components/icons/LogIcons';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import './LogViewer.css';
import { refreshOrchestrator } from '@/core/refresh/orchestrator';
import { setScopedDomainState, useRefreshScopedDomain } from '@/core/refresh/store';
import { getLogBufferMaxSize } from '@/core/settings/appPreferences';
import type { ObjectLogEntry } from '@/core/refresh/types';
import type { types } from '@wailsjs/go/models';
import {
  ALL_CONTAINERS,
  logViewerReducer,
  initialLogViewerState,
  applyLogViewerPrefs,
  extractLogViewerPrefs,
  type ParsedLogEntry,
} from './logViewerReducer';
import {
  getLogViewerPrefs,
  getLogViewerScrollTop,
  setLogViewerPrefs,
  setLogViewerScrollTop,
} from './logViewerPrefsCache';
import { buildStablePodColorMap } from './podColors';
import { setLogStreamScopeParams } from './logStreamScopeParamsCache';
import { INACTIVE_SCOPE } from '../constants';

interface LogViewerProps {
  namespace: string;
  resourceName: string;
  resourceKind: string;
  /**
   * Refresh-domain scope string for the object-logs producer. Owned by
   * ObjectPanel via getObjectPanelKind so this component and the panel-
   * level cleanup effect in ObjectPanelContent consume the same value.
   * They used to compute it independently and could drift apart.
   */
  logScope: string | null;
  isActive?: boolean;
  activePodNames?: string[] | null;
  clusterId?: string | null;
  /**
   * Stable identifier for the owning ObjectPanel. Used as the key into
   * logViewerPrefsCache so the user's view preferences (autoScroll,
   * textFilter, isParsedView, expandedRows, etc.) survive
   * ObjectPanelContent unmount/remount caused by cluster switches.
   */
  panelId: string;
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

const buildHighlightRegex = (pattern: string): RegExp | null => {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const probe = new RegExp(trimmed);
    if (probe.test('')) {
      return null;
    }
    return new RegExp(trimmed, 'g');
  } catch {
    return null;
  }
};

const LogViewerInner: React.FC<LogViewerProps> = ({
  namespace,
  resourceName,
  resourceKind: resourceKind,
  logScope,
  isActive = false,
  activePodNames = null,
  clusterId,
  panelId,
}) => {
  // Lazy reducer init: rehydrate from the panel-scoped prefs cache so a
  // remount caused by a cluster switch picks up the user's previous
  // selectedContainer / autoScroll / textFilter / isParsedView /
  // expandedRows / etc. The cache lives outside React state so this
  // lookup is a single Map.get on mount and never re-runs. The cache is
  // evicted by ObjectPanelStateContext when the panel actually closes.
  const [state, dispatch] = useReducer(logViewerReducer, undefined, () => {
    const cached = getLogViewerPrefs(panelId);
    return cached ? applyLogViewerPrefs(initialLogViewerState, cached) : initialLogViewerState;
  });

  // Destructure commonly used state for readability
  const {
    containers,
    selectedContainer,
    availablePods,
    availableContainers,
    selectedFilter,
    autoRefresh,
    showTimestamps,
    wrapText,
    textFilter,
    highlightFilter,
    includeFilter,
    excludeFilter,
    copyFeedback,
    isParsedView,
    parsedLogs,
    expandedRows,
    fallbackActive,
    fallbackError,
    showPreviousLogs,
    isLoadingPreviousLogs,
  } = state;

  // Push the persistent subset of state into the panel-scoped prefs
  // cache whenever it changes. The cache is a module-level Map (not
  // React state), so this is just a Map.set per change with no
  // re-renders triggered. On the next remount of this LogViewer instance
  // (e.g. after a cluster-switch round trip) the lazy reducer
  // initializer above pulls these values back out.
  //
  // Deps list every persistent field individually so changes to derived
  // state (containers, availablePods, parsedLogs, fallbackError, etc.)
  // don't trigger an unnecessary writeback.
  useEffect(() => {
    setLogViewerPrefs(panelId, extractLogViewerPrefs(state));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only persistent fields trigger writeback; `state` is read inside
  }, [
    panelId,
    state.selectedContainer,
    state.selectedFilter,
    state.autoRefresh,
    state.showTimestamps,
    state.wrapText,
    state.textFilter,
    state.highlightFilter,
    state.includeFilter,
    state.excludeFilter,
    state.isParsedView,
    state.expandedRows,
    state.showPreviousLogs,
  ]);

  const hasPrimedScopeRef = useRef(false);
  const fallbackRecoveringRef = useRef(false);
  const previousActivePodsRef = useRef<string[] | null>(null);
  const previousLogScopeRef = useRef<string | null>(null);
  const resolvedClusterId = clusterId?.trim() ?? '';

  // Refs
  const logsContentRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const seqCounterRef = useRef(0);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True until the restoration effect has successfully positioned the
  // scroll container after a (re)mount. Prevents the auto-scroll effect
  // from fighting the restoration for the first paint, and makes the
  // restore-once behavior idempotent across state changes.
  const scrollRestoredRef = useRef<boolean>(false);

  const resourceKindKey = resourceKind?.toLowerCase() ?? '';
  const isWorkload = resourceKindKey !== 'pod';
  const supportsPreviousLogs = resourceKindKey === 'pod';
  const podName = !isWorkload ? resourceName : '';
  const highlightRegex = useMemo(() => buildHighlightRegex(highlightFilter), [highlightFilter]);
  const backendLogSelection = useMemo(() => {
    const include = includeFilter.trim();
    const exclude = excludeFilter.trim();
    if (isWorkload) {
      if (selectedFilter.startsWith('pod:')) {
        return { pod: selectedFilter.substring(4), container: '', include, exclude };
      }
      if (selectedFilter.startsWith('container:')) {
        return { pod: '', container: selectedFilter.substring(10), include, exclude };
      }
      return { pod: '', container: '', include, exclude };
    }
    if (selectedContainer && selectedContainer !== ALL_CONTAINERS) {
      return { pod: '', container: selectedContainer, include, exclude };
    }
    return { pod: '', container: '', include, exclude };
  }, [excludeFilter, includeFilter, isWorkload, selectedContainer, selectedFilter]);

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

  // LogStreamManager already caps rawLogEntries at the user-configured
  // buffer size, so we can use it directly. The old stable-list merge
  // logic existed to keep the viewport anchored while reading in place
  // with autoScroll off, but now that tail-following is derived from
  // scroll position (see the smart auto-scroll effect below), the
  // stable list is unnecessary — new entries arrive at the bottom,
  // buffer rotation drops the oldest, and the smart-scroll effect only
  // tail-follows when the user is already at the bottom anyway.
  const logEntries: ObjectLogEntry[] = rawLogEntries;
  const snapshotStatus = logScope ? logSnapshot.status : 'idle';
  const snapshotError = logScope ? logSnapshot.error : null;
  // sequence 1 = connected event, sequence >= 2 = initial logs received (may be empty)
  const snapshotSequence = logScope ? (logSnapshot.data?.sequence ?? 0) : 0;
  const hasReceivedInitialLogs = snapshotSequence >= 2;
  // True once LogStreamManager has had to drop the front of the buffer
  // to stay under MAX_BUFFER_SIZE. Exposed via the buildStats wrapper on
  // the scoped snapshot.
  const bufferLimitReached = Boolean(logSnapshot.stats?.truncated);
  const logWarnings = (logSnapshot.stats?.warnings ?? []).filter(
    (warning) => typeof warning === 'string' && warning.trim().length > 0
  );

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
  const waitingForInitialPrime = !hasPrimedScopeRef.current && !displayError;

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
        waitingForInitialPrime ||
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
    (
      entries: ObjectLogEntry[],
      generatedAt: number,
      isManual: boolean,
      warnings: string[] = []
    ) => {
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
          stats: {
            itemCount: entries.length,
            buildDurationMs: 0,
            warnings: warnings.length > 0 ? warnings : undefined,
          },
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
        // tailLines for the fallback fetch tracks the user-configurable
        // log buffer size setting (Advanced → Pod Logs). This keeps the
        // initial fallback fetch in sync with the rolling buffer cap so
        // the user gets exactly as much history as their buffer can hold.
        const request: types.LogFetchRequest = {
          scope: logScope,
          namespace,
          workloadName: isWorkload ? resourceName : '',
          workloadKind: isWorkload ? resourceKindKey : '',
          podName: isWorkload ? '' : podName,
          podFilter: backendLogSelection.pod,
          container: backendLogSelection.container,
          include: backendLogSelection.include,
          exclude: backendLogSelection.exclude,
          previous,
          tailLines: getLogBufferMaxSize(),
          sinceSeconds: 0,
        };

        const response = await LogFetcher(resolvedClusterId, request);
        if (response?.error) {
          throw new Error(response.error);
        }

        const entries = Array.isArray(response?.entries) ? response.entries : [];
        const warnings = Array.isArray(response?.warnings)
          ? response.warnings.filter((warning): warning is string => typeof warning === 'string')
          : [];

        const mapped: ObjectLogEntry[] = entries.map((entry) => ({
          timestamp: entry.timestamp ?? '',
          pod: entry.pod ?? '',
          container: entry.container ?? '',
          line: entry.line ?? '',
          isInit: Boolean(entry.isInit),
          _seq: ++seqCounterRef.current,
        }));

        const generatedAt = Date.now();
        mapEntriesToSnapshot(mapped, generatedAt, isManual, warnings);
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
      backendLogSelection.container,
      backendLogSelection.exclude,
      backendLogSelection.include,
      backendLogSelection.pod,
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
    if (!logScope) {
      return;
    }
    const changed = setLogStreamScopeParams(logScope, backendLogSelection);
    if (!changed) {
      return;
    }
    if (showPreviousLogs) {
      dispatch({ type: 'SET_IS_LOADING_PREVIOUS_LOGS', payload: true });
      void fetchLogs({ previous: true, isManual: true })
        .catch((error) => {
          console.error('Failed to reload previous logs', error);
        })
        .finally(() => {
          dispatch({ type: 'SET_IS_LOADING_PREVIOUS_LOGS', payload: false });
        });
      return;
    }
    if (fallbackActive) {
      void fetchFallbackLogs(false);
      return;
    }
    if (!isActive || !autoRefresh) {
      return;
    }
    void refreshOrchestrator.restartStreamingDomain(LOG_DOMAIN, logScope);
  }, [
    autoRefresh,
    backendLogSelection,
    fallbackActive,
    fetchFallbackLogs,
    fetchLogs,
    isActive,
    logScope,
    showPreviousLogs,
  ]);

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
    const palette = [
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
    return buildStablePodColorMap(availablePods, palette, fallbackColor);
  }, [availablePods]);

  useEffect(() => {
    if (isWorkload) {
      const pods = (
        normalizedActivePods ??
        Array.from(new Set(logEntries.map((entry) => entry.pod).filter(Boolean)))
      )
        .slice()
        .sort();
      dispatch({ type: 'SET_AVAILABLE_PODS', payload: pods });
      const containersList = Array.from(
        new Set(logEntries.map((entry) => entry.container).filter(Boolean))
      ).sort();
      dispatch({ type: 'SET_AVAILABLE_CONTAINERS', payload: containersList });
    }
  }, [isWorkload, logEntries, normalizedActivePods]);

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
  const hasDebugContainers = containers.some((container) => container.endsWith(' (debug)'));
  const allContainersLabel = hasDebugContainers ? 'All (includes debug)' : 'All';

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

  const renderHighlightedMessage = useCallback(
    (text: string, keyPrefix: string) => {
      if (!text) {
        return '\u00A0';
      }
      if (!highlightRegex) {
        return text;
      }

      const matches = Array.from(text.matchAll(highlightRegex));
      if (matches.length === 0) {
        return text;
      }

      const nodes: React.ReactNode[] = [];
      let lastIndex = 0;

      matches.forEach((match, index) => {
        const matchIndex = match.index ?? -1;
        const value = match[0] ?? '';
        if (matchIndex < 0 || value.length === 0) {
          return;
        }
        if (matchIndex > lastIndex) {
          nodes.push(text.slice(lastIndex, matchIndex));
        }
        nodes.push(
          <mark key={`${keyPrefix}-${matchIndex}-${index}`} className="pod-log-highlight">
            {value}
          </mark>
        );
        lastIndex = matchIndex + value.length;
      });

      if (nodes.length === 0) {
        return text;
      }
      if (lastIndex < text.length) {
        nodes.push(text.slice(lastIndex));
      }
      return nodes;
    },
    [highlightRegex]
  );

  // Schedule copy feedback reset, cancelling any prior pending timer
  const scheduleCopyReset = useCallback(() => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(
      () => dispatch({ type: 'SET_COPY_FEEDBACK', payload: 'idle' }),
      750
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
      // When entries are empty (e.g. stream reconnecting or switching to
      // previous logs), keep parsed view active but clear stale data so
      // old logs aren't displayed while waiting for new data.
      dispatch({ type: 'SET_PARSED_LOGS', payload: [] });
      if (filteredEntries.length > 0) {
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

  // --- Scroll position and tail-follow ---
  //
  // Four concerns, all reading from the same scroll container:
  //
  //   1. getScrollContainer — returns the element that actually
  //      scrolls for the current view mode. Raw view is
  //      pod-logs-content itself; parsed view is the GridTable's
  //      virtualization wrapper inside it.
  //
  //   2. Scroll listener — on every scroll event, saves the current
  //      scrollTop to the panel-scoped prefs cache (so it survives
  //      a tab-switch remount) and refreshes wasAtBottomRef so the
  //      tail-follow effect knows whether the user is currently
  //      pinned to the tail. Gated on scrollRestoredRef for the
  //      writeback path to ignore the synthetic scroll events the
  //      restoration effect itself triggers.
  //
  //   3. Restoration effect — on (re)mount, once entries have
  //      rendered, scrolls to the saved position from the prefs
  //      cache (clamped to the current maxScrollTop). Falls back to
  //      the bottom (newest entries) when nothing was saved. Runs
  //      exactly once per mount via scrollRestoredRef.
  //
  //   4. Smart tail-follow — derives the follow-the-tail intent
  //      from the user's current scroll position:
  //
  //        - If the viewport was at (or very near) the bottom just
  //          before React committed the new entries, scroll to the
  //          new bottom after commit so new entries come into view.
  //        - Otherwise leave scrollTop alone; when the user scrolls
  //          back down to the bottom they automatically resume
  //          tail-following on the next entry.
  //
  //      wasAtBottomRef is updated by the scroll listener above,
  //      not by a per-render useLayoutEffect — measuring in render
  //      forces a synchronous reflow on every unrelated parent
  //      re-render (e.g. ObjectPanel drag/resize), which tanks
  //      drag performance. Scroll events are the only thing that
  //      can change at-bottom status between log appends, so the
  //      ref is always fresh when the tail-follow effect reads it.

  const AT_BOTTOM_THRESHOLD_PX = 16;
  const wasAtBottomRef = useRef<boolean>(true);

  const getScrollContainer = useCallback((): HTMLElement | null => {
    const root = logsContentRef.current;
    if (!root) return null;
    if (isParsedView) {
      return root.querySelector<HTMLElement>('.gridtable-wrapper');
    }
    return root;
  }, [isParsedView]);

  // Scroll listener — writes scrollTop to the cache and refreshes
  // wasAtBottomRef so the tail-follow effect has an up-to-date
  // "was the user at the bottom?" signal without having to measure
  // on every render. Attaches to whichever container is active for
  // the current view mode; re-runs when isParsedView changes.
  //
  // Measuring here (instead of in a depless useLayoutEffect) keeps
  // draggable parents fast: unrelated parent re-renders no longer
  // trigger forced reflows inside LogViewer. Scroll events are the
  // only thing that can change at-bottom status between log
  // appends — programmatic scrollTop writes fire one too, so the
  // restoration effect and the tail-follow scroll both keep this
  // ref in sync automatically.
  useEffect(() => {
    const scrollEl = getScrollContainer();
    if (!scrollEl) return;

    const handler = () => {
      wasAtBottomRef.current =
        scrollEl.scrollTop + scrollEl.clientHeight >=
        scrollEl.scrollHeight - AT_BOTTOM_THRESHOLD_PX;
      // Skip writeback until the initial restore has completed —
      // the browser fires scroll events as we restore scrollTop,
      // and we don't want those synthetic events to overwrite the
      // saved value with 0 before the restoration runs.
      if (!scrollRestoredRef.current) return;
      setLogViewerScrollTop(panelId, scrollEl.scrollTop);
    };

    scrollEl.addEventListener('scroll', handler, { passive: true });
    return () => {
      scrollEl.removeEventListener('scroll', handler);
    };
  }, [getScrollContainer, panelId]);

  // Restoration effect — runs on every render but is a no-op after
  // the first successful positioning. Re-runs until the scroll
  // container is actually present (parsed view needs the
  // virtualization wrapper to be mounted, which may take a frame or
  // two) and has entries to render into.
  //
  // Policy on (re)mount:
  //   - If a saved scrollTop exists in the prefs cache (the user
  //     had scrolled somewhere during a previous session), restore
  //     it — clamped to the current maxScrollTop so a smaller
  //     buffer doesn't land us past the bottom.
  //   - Otherwise, scroll to the bottom (newest entries). This is
  //     the intuitive default for a fresh view.
  useEffect(() => {
    if (scrollRestoredRef.current) return;

    const entryCount = isParsedView ? parsedLogs.length : logEntries.length;
    if (entryCount === 0) return;

    const scrollEl = getScrollContainer();
    if (!scrollEl) return;
    // scrollHeight === clientHeight means content hasn't laid out
    // yet (parsed view virtualization wrapper takes a frame or
    // two). Defer to the next render.
    if (scrollEl.scrollHeight <= scrollEl.clientHeight) return;

    const maxScrollTop = scrollEl.scrollHeight - scrollEl.clientHeight;
    const savedScrollTop = getLogViewerScrollTop(panelId);
    const targetScrollTop =
      savedScrollTop != null ? Math.min(savedScrollTop, maxScrollTop) : maxScrollTop;

    scrollEl.scrollTop = targetScrollTop;
    scrollRestoredRef.current = true;
  }, [getScrollContainer, isParsedView, logEntries.length, panelId, parsedLogs.length]);

  // After commit: if the user was tail-following, scroll to the new
  // bottom so the newly appended entries come into view. If not,
  // leave scrollTop alone — the user is reading in place.
  useEffect(() => {
    if (!wasAtBottomRef.current) return;
    // Don't interfere with the initial restoration effect; it owns
    // the first scroll position of the mount.
    if (!scrollRestoredRef.current) return;

    const scrollEl = getScrollContainer();
    if (!scrollEl) return;

    // Parsed view's virtualization wrapper may not have laid out
    // yet on the same frame the entries land — retry a few frames
    // if scrollHeight hasn't caught up.
    let rafId: number | undefined;
    const scrollToBottom = () => {
      const el = getScrollContainer();
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    };
    if (isParsedView) {
      let attempts = 0;
      const maxAttempts = 20;
      const checkAndScroll = () => {
        const el = getScrollContainer();
        if (el && el.scrollHeight > el.clientHeight) {
          rafId = requestAnimationFrame(scrollToBottom);
        } else if (attempts < maxAttempts) {
          attempts += 1;
          rafId = requestAnimationFrame(checkAndScroll);
        }
      };
      rafId = requestAnimationFrame(checkAndScroll);
    } else {
      rafId = requestAnimationFrame(scrollToBottom);
    }
    return () => {
      if (rafId !== undefined) cancelAnimationFrame(rafId);
    };
  }, [getScrollContainer, isParsedView, logEntries.length, parsedLogs.length, displayLogs]);

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

    // Always show metadata columns when relevant — don't gate on first entry.
    // API Timestamp is metadata we add on the client (not part of the log
    // payload), so in workload mode we color it with the same pod color as
    // the Pod column — visually grouping the metadata fields for a single
    // pod together when multiple pods are interleaved.
    if (showTimestamps) {
      columns.push({
        key: '_timestamp',
        header: 'API Timestamp',
        sortable: false,
        minWidth: PARSED_TIMESTAMP_MIN_WIDTH,
        render: (item: ParsedLogEntry) => {
          const formatted = item.timestamp ? formatTimestamp(item.timestamp) : '-';
          if (!isWorkload) {
            return formatted;
          }
          return (
            <span
              className="pod-color-text"
              style={
                {
                  '--pod-color': podColors[item.pod || ''] || podColors['__fallback__'],
                } as React.CSSProperties
              }
            >
              {formatted}
            </span>
          );
        },
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
        render: (item: ParsedLogEntry) => (
          <div className="parsed-log-cell">{formatParsedValue(item.data[key])}</div>
        ),
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
                    ...(containers.length > 1
                      ? [{ value: ALL_CONTAINERS, label: allContainersLabel }]
                      : []),
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

            <div className="pod-logs-control-group pod-logs-filter-group">
              <input
                type="text"
                value={highlightFilter}
                onChange={(e) =>
                  dispatch({ type: 'SET_HIGHLIGHT_FILTER', payload: e.target.value })
                }
                placeholder="Highlight regex"
                className="pod-logs-text-filter"
                title="Highlight visible log message text that matches this regex"
              />
              {highlightFilter && (
                <button
                  className="pod-logs-filter-clear"
                  onClick={() => dispatch({ type: 'SET_HIGHLIGHT_FILTER', payload: '' })}
                  title="Clear highlight regex"
                  aria-label="Clear highlight regex"
                >
                  ×
                </button>
              )}
            </div>

            <div className="pod-logs-control-group pod-logs-filter-group">
              <input
                type="text"
                value={includeFilter}
                onChange={(e) => dispatch({ type: 'SET_INCLUDE_FILTER', payload: e.target.value })}
                placeholder="Include regex"
                className="pod-logs-text-filter"
                title="Only send log lines whose message matches this regex"
              />
              {includeFilter && (
                <button
                  className="pod-logs-filter-clear"
                  onClick={() => dispatch({ type: 'SET_INCLUDE_FILTER', payload: '' })}
                  title="Clear include regex"
                  aria-label="Clear include regex"
                >
                  ×
                </button>
              )}
            </div>

            <div className="pod-logs-control-group pod-logs-filter-group">
              <input
                type="text"
                value={excludeFilter}
                onChange={(e) => dispatch({ type: 'SET_EXCLUDE_FILTER', payload: e.target.value })}
                placeholder="Exclude regex"
                className="pod-logs-text-filter"
                title="Drop log lines whose message matches this regex"
              />
              {excludeFilter && (
                <button
                  className="pod-logs-filter-clear"
                  onClick={() => dispatch({ type: 'SET_EXCLUDE_FILTER', payload: '' })}
                  title="Clear exclude regex"
                  aria-label="Clear exclude regex"
                >
                  ×
                </button>
              )}
            </div>

            <IconBar
              items={
                [
                  {
                    type: 'toggle',
                    id: 'autoRefresh',
                    icon: <AutoRefreshIcon />,
                    active: autoRefresh,
                    onClick: () => dispatch({ type: 'TOGGLE_AUTO_REFRESH' }),
                    title: 'Auto-refresh (R)',
                  },
                  { type: 'separator' },
                  ...(supportsPreviousLogs
                    ? [
                        {
                          type: 'toggle' as const,
                          id: 'previousLogs',
                          icon: <PreviousLogsIcon />,
                          active: showPreviousLogs,
                          onClick: handleTogglePreviousLogs,
                          title: 'Previous logs (X)',
                        },
                      ]
                    : []),
                  {
                    type: 'toggle',
                    id: 'timestamps',
                    icon: <TimestampIcon />,
                    active: showTimestamps,
                    onClick: () => dispatch({ type: 'TOGGLE_TIMESTAMPS' }),
                    title: 'Timestamps (T)',
                  },
                  {
                    type: 'toggle',
                    id: 'wrapText',
                    icon: <WrapTextIcon />,
                    active: wrapText,
                    onClick: () => dispatch({ type: 'TOGGLE_WRAP_TEXT' }),
                    title: 'Wrap text (W)',
                    disabled: isParsedView,
                  },
                  {
                    type: 'toggle',
                    id: 'parseJson',
                    icon: <ParseJsonIcon />,
                    active: isParsedView,
                    onClick: () => dispatch({ type: 'TOGGLE_PARSED_VIEW' }),
                    title: 'Parse as JSON (P)',
                    disabled: !canParseLogs,
                  },
                  { type: 'separator' },
                  {
                    type: 'action',
                    id: 'copy',
                    icon: <CopyIcon />,
                    onClick: handleCopyLogs,
                    title: 'Copy to clipboard',
                    disabled: !displayLogs && !isParsedView,
                    feedback:
                      copyFeedback === 'copied'
                        ? 'success'
                        : copyFeedback === 'error'
                          ? 'error'
                          : null,
                  },
                ] satisfies IconBarItem[]
              }
            />

            <span
              className="pod-logs-count"
              title={
                bufferLimitReached
                  ? filteredEntries.length === logEntries.length
                    ? `${logEntries.length} logs (buffer limit reached — older entries dropped)`
                    : `${filteredEntries.length} of ${logEntries.length} logs (buffer limit reached — older entries dropped)`
                  : filteredEntries.length === logEntries.length
                    ? `${logEntries.length} logs`
                    : `${filteredEntries.length} of ${logEntries.length} logs`
              }
            >
              {filteredEntries.length === logEntries.length
                ? `${logEntries.length} logs`
                : `${filteredEntries.length} of ${logEntries.length} logs`}
              {bufferLimitReached ? ' (max)' : ''}
            </span>
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

        {logWarnings.length > 0 && (
          <div className="pod-logs-fallback-banner" role="status">
            <span>{logWarnings.join(' ')}</span>
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
                // Parsed logs use row-expansion to show the full cell
                // contents; the native hover tooltip would duplicate that
                // affordance and also race with the custom expand UX.
                disableCellNativeTitle
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
                            <span>
                              {' '}
                              {renderHighlightedMessage(logLine, `workload-${entryKey}`)}
                            </span>
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
                            <span> {renderHighlightedMessage(remainder, `pod-${entryKey}`)}</span>
                          </div>
                        );
                      }
                    }

                    return (
                      <div key={entryKey} className="pod-log-line">
                        {renderHighlightedMessage(line, `line-${entryKey}`)}
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

// Memoize so panel drag/resize — which re-renders the DockablePanel
// subtree on every rAF tick as width/height state updates — doesn't
// reconcile LogViewer's (potentially ~1000-row) raw-log list on every
// frame. All LogViewer props are referentially stable during drag:
// strings/booleans from the object catalog and the memoized
// activePodNames array from ObjectPanelContent (whose deps are the
// stable *Details.pods references, not the fresh-every-render
// detailTabProps object). With stable props, the default shallow
// equality check short-circuits the entire render subtree.
const LogViewer = React.memo(LogViewerInner);

export default LogViewer;
