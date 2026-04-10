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
import { useVirtualizedLogRows } from './hooks/useVirtualizedLogRows';
import {
  useLogStreamFallback,
  isLogDataUnavailable,
  getLogDataUnavailableMessage,
} from './hooks/useLogStreamFallback';
import { Dropdown, type DropdownOption } from '@shared/components/dropdowns/Dropdown';
import {
  AutoRefreshIcon,
  PreviousLogsIcon,
  TimestampIcon,
  WrapTextIcon,
  AnsiColorIcon,
  CopyIcon,
  ParseJsonIcon,
  PrettyJsonIcon,
  HighlightSearchIcon,
  InverseSearchIcon,
  RegexSearchIcon,
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
import { containsAnsi, parseAnsiTextSegments, stripAnsi } from './ansi';
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
const RAW_LOG_VIRTUALIZATION_THRESHOLD = 120;
const RAW_LOG_VIRTUALIZATION_OVERSCAN = 10;
const RAW_LOG_ESTIMATE_ROW_HEIGHT = 26;
const RAW_LOG_VERTICAL_PADDING_PX = 16;

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

const formatTimestampForMode = (
  timestamp: string,
  mode: 'hidden' | 'default' | 'short' | 'localized'
): string => {
  if (!timestamp || mode === 'hidden') {
    return '';
  }
  switch (mode) {
    case 'default':
      return formatTimestamp(timestamp);
    case 'short': {
      const parsed = new Date(timestamp);
      if (Number.isNaN(parsed.getTime())) {
        return formatTimestamp(timestamp);
      }
      const hours = String(parsed.getHours()).padStart(2, '0');
      const minutes = String(parsed.getMinutes()).padStart(2, '0');
      const seconds = String(parsed.getSeconds()).padStart(2, '0');
      const millis = String(parsed.getMilliseconds()).padStart(3, '0');
      return `${hours}:${minutes}:${seconds}.${millis}`;
    }
    case 'localized': {
      const parsed = new Date(timestamp);
      if (Number.isNaN(parsed.getTime())) {
        return formatTimestamp(timestamp);
      }
      return parsed.toLocaleString([], {
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
    default:
      return formatTimestamp(timestamp);
  }
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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const POD_FILTER_PREFIX = 'pod:';
const INIT_FILTER_PREFIX = 'init:';
const CONTAINER_FILTER_PREFIX = 'container:';

const isInitContainerDisplayName = (container: string): boolean => container.endsWith(' (init)');

const toPodFilterValue = (pod: string): string => `${POD_FILTER_PREFIX}${pod}`;
const toInitContainerFilterValue = (container: string): string =>
  `${INIT_FILTER_PREFIX}${container}`;
const toContainerFilterValue = (container: string): string =>
  `${CONTAINER_FILTER_PREFIX}${container}`;

const summarizeWorkloadSelection = (
  selectedValues: string[],
  options: DropdownOption[]
): string => {
  if (selectedValues.length === 0) {
    return 'All Logs';
  }

  if (selectedValues.length === 1) {
    return options.find((option) => option.value === selectedValues[0])?.label ?? 'All Logs';
  }

  const podCount = selectedValues.filter((value) => value.startsWith(POD_FILTER_PREFIX)).length;
  const initContainerCount = selectedValues.filter((value) =>
    value.startsWith(INIT_FILTER_PREFIX)
  ).length;
  const containerCount = selectedValues.filter((value) =>
    value.startsWith(CONTAINER_FILTER_PREFIX)
  ).length;
  const labels: string[] = [];

  if (podCount > 0) {
    labels.push(`${podCount} Pod${podCount === 1 ? '' : 's'}`);
  }
  if (initContainerCount > 0) {
    labels.push(`${initContainerCount} Init Container${initContainerCount === 1 ? '' : 's'}`);
  }
  if (containerCount > 0) {
    labels.push(`${containerCount} Container${containerCount === 1 ? '' : 's'}`);
  }

  return labels.join(', ');
};

const buildHighlightRegex = (searchText: string, regexMode: boolean): RegExp | null => {
  const trimmed = searchText.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new RegExp(regexMode ? trimmed : escapeRegExp(trimmed), 'gi');
  } catch {
    return null;
  }
};

const tryParseJSONObject = (line: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(stripAnsi(line));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return Object.keys(parsed).length > 0 ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

interface RenderedLogRow {
  key: string;
  line: string;
}

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
  // autoRefresh / textFilter / isParsedView /
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
    availablePods,
    selectedFilters,
    autoRefresh,
    timestampMode,
    wrapText,
    showAnsiColors,
    textFilter,
    highlightMatches,
    inverseMatches,
    regexMatches,
    copyFeedback,
    displayMode,
    parsedLogs,
    expandedRows,
    fallbackActive,
    showPreviousLogs,
    isLoadingPreviousLogs,
  } = state;
  const showTimestamps = timestampMode !== 'hidden';
  const isParsedView = displayMode === 'parsed';

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
    state.selectedFilters,
    state.autoRefresh,
    state.timestampMode,
    state.wrapText,
    state.showAnsiColors,
    state.textFilter,
    state.highlightMatches,
    state.inverseMatches,
    state.regexMatches,
    state.displayMode,
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
  const selectedInitContainers = useMemo(
    () =>
      new Set(
        selectedFilters
          .filter((filterValue) => filterValue.startsWith(INIT_FILTER_PREFIX))
          .map((filterValue) => filterValue.substring(INIT_FILTER_PREFIX.length))
      ),
    [selectedFilters]
  );
  const selectedRegularContainers = useMemo(
    () =>
      new Set(
        selectedFilters
          .filter((filterValue) => filterValue.startsWith(CONTAINER_FILTER_PREFIX))
          .map((filterValue) => filterValue.substring(CONTAINER_FILTER_PREFIX.length))
      ),
    [selectedFilters]
  );
  const selectedContainerFilterCount = selectedInitContainers.size + selectedRegularContainers.size;
  const highlightRegex = useMemo(
    () => buildHighlightRegex(highlightMatches && !inverseMatches ? textFilter : '', regexMatches),
    [highlightMatches, inverseMatches, regexMatches, textFilter]
  );
  const backendLogSelection = useMemo(() => {
    const selectedContainerNames = [
      ...Array.from(selectedInitContainers),
      ...Array.from(selectedRegularContainers),
    ];
    if (isWorkload) {
      return {
        container: '',
        includeInit: true,
        includeEphemeral: true,
      };
    }
    if (selectedContainerNames.length === 1) {
      return {
        container: selectedContainerNames[0],
        includeInit: true,
        includeEphemeral: true,
      };
    }
    return {
      container: '',
      includeInit: true,
      includeEphemeral: true,
    };
  }, [isWorkload, selectedInitContainers, selectedRegularContainers]);

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
  const logWarnings = (logSnapshot.stats?.warnings ?? []).filter(
    (warning) => typeof warning === 'string' && warning.trim().length > 0
  );

  const displayError = snapshotError && !isLogDataUnavailable(snapshotError) ? snapshotError : null;
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
  const waitingForInitialPrime =
    !hasPrimedScopeRef.current && !displayError && !hasReceivedInitialLogs;

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
  const workloadPodsForSelector = useMemo(
    () =>
      (
        normalizedActivePods ??
        Array.from(new Set(logEntries.map((entry) => entry.pod).filter(Boolean)))
      )
        .slice()
        .sort(),
    [logEntries, normalizedActivePods]
  );

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
    selectedFilters,
    textFilter,
    inverseMatches,
    regexMatches,
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
            // sequence >= 2 means the initial log load completed even if
            // the payload is empty. Fallback/manual fetches need to honor
            // the same contract so empty-success responses don't leave the
            // viewer stuck in the initial loading state.
            sequence: Math.max(previousPayload.sequence, 2),
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
          container: backendLogSelection.container,
          includeInit: backendLogSelection.includeInit,
          includeEphemeral: backendLogSelection.includeEphemeral,
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
        hasPrimedScopeRef.current = true;
        dispatch({ type: 'SET_FALLBACK_ERROR', payload: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isLogDataUnavailable(message)) {
          const generatedAt = Date.now();
          mapEntriesToSnapshot([], generatedAt, isManual, [getLogDataUnavailableMessage(previous)]);
          hasPrimedScopeRef.current = true;
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
      backendLogSelection.includeEphemeral,
      backendLogSelection.includeInit,
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
    displayMode,
    showTimestamps,
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

  const getActualContainerName = (displayName: string) => {
    return displayName.replace(' (init)', '').replace(' (debug)', '');
  };

  const selectorOptions = useMemo(() => {
    const options: DropdownOption[] = [];

    if (isWorkload) {
      options.push({ value: '_pods_header', label: 'Pods', disabled: true, group: 'header' });
      options.push(
        ...workloadPodsForSelector.map((pod) => ({
          value: toPodFilterValue(pod),
          label: pod,
          group: 'Pods',
        }))
      );
    }

    const initContainerOptions = isWorkload
      ? Array.from(
          new Set(
            logEntries
              .filter((entry) => entry.isInit && entry.container)
              .map((entry) => entry.container)
              .filter(Boolean)
          )
        )
          .sort()
          .map((container) => ({
            value: toInitContainerFilterValue(container),
            label: container,
            group: 'Init Containers',
          }))
      : containers
          .filter((container) => isInitContainerDisplayName(container))
          .map((container) => ({
            value: toInitContainerFilterValue(getActualContainerName(container)),
            label: getActualContainerName(container),
            group: 'Init Containers',
          }))
          .sort((left, right) => left.label.localeCompare(right.label));

    if (initContainerOptions.length > 0) {
      options.push({
        value: '_init_containers_header',
        label: 'Init Containers',
        disabled: true,
        group: 'header',
      });
    }
    options.push(...initContainerOptions);

    const regularContainerOptions = isWorkload
      ? Array.from(
          new Set(
            logEntries
              .filter((entry) => !entry.isInit && entry.container)
              .map((entry) => entry.container)
              .filter(Boolean)
          )
        )
          .sort()
          .map((container) => ({
            value: toContainerFilterValue(container),
            label: container,
            group: 'Containers',
          }))
      : containers
          .filter((container) => !isInitContainerDisplayName(container))
          .map((container) => ({
            value: toContainerFilterValue(getActualContainerName(container)),
            label: container.endsWith(' (debug)') ? container : getActualContainerName(container),
            group: 'Containers',
          }))
          .sort((left, right) => left.label.localeCompare(right.label));

    if (isWorkload || containers.length > 0) {
      options.push({
        value: '_containers_header',
        label: 'Containers',
        disabled: true,
        group: 'header',
      });
    }
    options.push(...regularContainerOptions);

    return options;
  }, [containers, isWorkload, logEntries, workloadPodsForSelector]);
  const singlePodSelectableContainerCount = useMemo(
    () =>
      selectorOptions.filter(
        (option) =>
          option.value.startsWith(INIT_FILTER_PREFIX) ||
          option.value.startsWith(CONTAINER_FILTER_PREFIX)
      ).length,
    [selectorOptions]
  );

  useEffect(() => {
    if (selectedFilters.length === 0) {
      return;
    }
    const validFilterValues = new Set(
      selectorOptions.filter((option) => option.group !== 'header').map((option) => option.value)
    );
    if (validFilterValues.size === 0) {
      return;
    }
    const nextSelectedFilters = selectedFilters.filter((filterValue) =>
      validFilterValues.has(filterValue)
    );
    if (nextSelectedFilters.length !== selectedFilters.length) {
      dispatch({ type: 'SET_SELECTED_FILTERS', payload: nextSelectedFilters });
    }
  }, [selectedFilters, selectorOptions]);

  // Helper functions
  const unavailableLogMessage =
    filteredEntries.length === 0
      ? (logWarnings.find(
          (warning) =>
            warning === getLogDataUnavailableMessage(false) ||
            warning === getLogDataUnavailableMessage(true)
        ) ?? null)
      : null;

  const displayLines = useMemo(() => {
    if (filteredEntries.length === 0) {
      if (isPendingLogs) {
        return [] as string[];
      }
      if (unavailableLogMessage) {
        return [unavailableLogMessage];
      }
      return [textFilter.trim() ? 'No logs match the filter' : 'No logs available'];
    }

    return filteredEntries.map((entry) => {
      const parsed = tryParseJSONObject(entry.line);
      const normalizedLine = showAnsiColors ? entry.line : stripAnsi(entry.line);
      const lineContent =
        displayMode === 'structured'
          ? parsed
            ? JSON.stringify(parsed)
            : normalizedLine
          : displayMode === 'pretty'
            ? parsed
              ? JSON.stringify(parsed, null, 2)
              : normalizedLine
            : normalizedLine;
      const timestamp = formatTimestampForMode(entry.timestamp ?? '', timestampMode);
      const timestampPrefix = timestamp ? `[${timestamp}] ` : '';

      if (isWorkload) {
        const containerLabel = formatContainerLabel(entry.container, entry.isInit);
        const formatted = lineContent.trim()
          ? `[${entry.pod}/${containerLabel}] ${lineContent}`
          : lineContent;
        return timestampPrefix + formatted;
      }

      if (
        selectedContainerFilterCount !== 1 &&
        !(selectedContainerFilterCount === 0 && singlePodSelectableContainerCount === 1)
      ) {
        const containerLabel = formatContainerLabel(entry.container, entry.isInit);
        const formatted = lineContent.trim() ? `[${containerLabel}] ${lineContent}` : lineContent;
        return timestampPrefix + formatted;
      }

      return timestampPrefix + lineContent;
    });
  }, [
    displayMode,
    filteredEntries,
    isPendingLogs,
    isWorkload,
    singlePodSelectableContainerCount,
    showAnsiColors,
    selectedContainerFilterCount,
    textFilter,
    timestampMode,
    unavailableLogMessage,
  ]);

  const displayLogs = useMemo(() => displayLines.join('\n'), [displayLines]);

  const renderedDisplayRows = useMemo<RenderedLogRow[]>(
    () =>
      displayLines.flatMap((line, displayIndex) => {
        const sourceSeq = filteredEntries[displayIndex]?._seq;
        return line.split('\n').map((segment, segmentIndex) => ({
          key:
            sourceSeq !== undefined
              ? `${sourceSeq}:${segmentIndex}`
              : `placeholder:${displayIndex}:${segmentIndex}`,
          line: segment,
        }));
      }),
    [displayLines, filteredEntries]
  );

  const hasCopyableContent = isParsedView ? parsedLogs.length > 0 : filteredEntries.length > 0;
  const hasAnsiLogEntries = useMemo(
    () => rawLogEntries.some((entry) => containsAnsi(entry.line)),
    [rawLogEntries]
  );
  const totalLogCount = logSnapshot.stats?.totalItems ?? logEntries.length;
  const displayedLogCount = filteredEntries.length;
  const countLabel = `${displayedLogCount} of ${totalLogCount}`;
  const countTitle =
    logWarnings.length > 0 ? `${countLabel} logs. ${logWarnings.join(' ')}` : `${countLabel} logs`;

  const {
    shouldVirtualize: shouldVirtualizeRawLogs,
    visibleRows: visibleRenderedLogRows,
    totalHeight: virtualizedRawHeight,
    offsetTop: virtualizedRawOffsetTop,
    measureRowRef: measureVirtualizedRawRow,
  } = useVirtualizedLogRows({
    rows: renderedDisplayRows,
    scrollContainerRef: logsContentRef,
    keyExtractor: (row) => row.key,
    threshold: RAW_LOG_VIRTUALIZATION_THRESHOLD,
    overscan: RAW_LOG_VIRTUALIZATION_OVERSCAN,
    estimateRowHeight: RAW_LOG_ESTIMATE_ROW_HEIGHT,
  });

  useEffect(() => {
    if (displayMode !== 'raw' && !canParseLogs) {
      dispatch({ type: 'SET_DISPLAY_MODE', payload: 'raw' });
    }
  }, [canParseLogs, displayMode]);

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
        dispatch({ type: 'SET_DISPLAY_MODE', payload: 'raw' });
      }
      return;
    }
    dispatch({ type: 'SET_PARSED_LOGS', payload: parsedCandidates });
  }, [filteredEntries.length, isParsedView, parsedCandidates]);

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

  const renderMessageContent = useCallback(
    (text: string, keyPrefix: string) => {
      const normalizedText = showAnsiColors ? text : stripAnsi(text);
      if (!showAnsiColors || !containsAnsi(text)) {
        return renderHighlightedMessage(normalizedText, keyPrefix);
      }

      const segments = parseAnsiTextSegments(text);
      if (segments.length === 0) {
        return renderHighlightedMessage(stripAnsi(text), keyPrefix);
      }

      return segments.map((segment, index) => {
        const content = renderHighlightedMessage(segment.text, `${keyPrefix}-${index}`);
        if (Object.keys(segment.style).length === 0) {
          return <React.Fragment key={`${keyPrefix}-plain-${index}`}>{content}</React.Fragment>;
        }
        return (
          <span key={`${keyPrefix}-ansi-${index}`} style={segment.style}>
            {content}
          </span>
        );
      });
    },
    [renderHighlightedMessage, showAnsiColors]
  );

  const renderRawLogRow = useCallback(
    (row: RenderedLogRow) => {
      const line = row.line;

      if (isWorkload && line.includes('[') && line.includes('/')) {
        const match = line.match(
          /^(?:\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s*)?\[([^\/]+)\/([^\]]+)\]\s*(.*)/
        );
        if (match) {
          const [, pod, container, logLine] = match;
          const timestampMatch = line.match(/^(\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s*)/);
          const timestamp = timestampMatch ? timestampMatch[1] : '';
          const podColor = podColors[pod] || podColors['__fallback__'];

          return (
            <div className="pod-log-line">
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
              <span> {renderMessageContent(logLine, `workload-${row.key}`)}</span>
            </div>
          );
        }
      }

      if (!isWorkload) {
        let workingLine = line;
        let timestampPrefix = '';
        if (showTimestamps) {
          const podTimestampMatch = line.match(/^(\[[^\]]+\]\s*)(.*)$/);
          if (podTimestampMatch) {
            timestampPrefix = podTimestampMatch[1] ?? '';
            workingLine = podTimestampMatch[2] ?? '';
          }
        }

        const containerMatch = workingLine.match(/^\[([^\]]+)\]\s*(.*)$/);
        const showContainerMeta =
          containerMatch &&
          selectedContainerFilterCount !== 1 &&
          !(selectedContainerFilterCount === 0 && singlePodSelectableContainerCount === 1);
        if (timestampPrefix || showContainerMeta) {
          const containerLabel = containerMatch ? containerMatch[1] : '';
          const remainder = containerMatch ? containerMatch[2] : workingLine;
          return (
            <div className="pod-log-line">
              {timestampPrefix && <span className="pod-log-metadata">{timestampPrefix}</span>}
              {showContainerMeta && <span className="pod-log-metadata">[{containerLabel}]</span>}
              <span> {renderMessageContent(remainder, `pod-${row.key}`)}</span>
            </div>
          );
        }
      }

      return <div className="pod-log-line">{renderMessageContent(line, `line-${row.key}`)}</div>;
    },
    [
      isWorkload,
      podColors,
      renderMessageContent,
      selectedContainerFilterCount,
      showTimestamps,
      singlePodSelectableContainerCount,
    ]
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
    const text =
      displayMode === 'parsed'
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
  }, [displayLogs, displayMode, parsedLogs, scheduleCopyReset, dispatch]);

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
        dispatch({ type: 'SET_SELECTED_CONTAINER', payload: ALL_CONTAINERS });
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
    if (timestampMode !== 'hidden') {
      columns.push({
        key: '_timestamp',
        header: 'API Timestamp',
        sortable: false,
        minWidth: PARSED_TIMESTAMP_MIN_WIDTH,
        render: (item: ParsedLogEntry) => {
          const formatted = item.timestamp
            ? formatTimestampForMode(item.timestamp, timestampMode)
            : '-';
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
  }, [derivedFieldKeys, isWorkload, podColors, timestampMode]);

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
            {/* Pod / container selector */}
            {selectorOptions.length > 0 && (
              <div className="pod-logs-control-group">
                <Dropdown
                  options={selectorOptions}
                  value={selectedFilters}
                  onChange={(value) =>
                    dispatch({
                      type: 'SET_SELECTED_FILTERS',
                      payload: Array.isArray(value) ? value : [value],
                    })
                  }
                  multiple
                  placeholder={isPendingLogs ? 'Loading logs…' : 'All Logs'}
                  renderValue={(value, options) =>
                    summarizeWorkloadSelection(
                      Array.isArray(value) ? value : value ? [value] : [],
                      options
                    )
                  }
                  size="compact"
                />
              </div>
            )}

            {/* Text filter input */}
            <div className="pod-logs-control-group pod-logs-filter-group">
              <div className="pod-logs-filter-group">
                <input
                  type="text"
                  ref={filterInputRef}
                  value={textFilter}
                  onChange={(e) => dispatch({ type: 'SET_TEXT_FILTER', payload: e.target.value })}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
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
            </div>

            <IconBar
              items={
                [
                  {
                    type: 'toggle',
                    id: 'highlightSearch',
                    icon: <HighlightSearchIcon />,
                    active: highlightMatches,
                    onClick: () => dispatch({ type: 'TOGGLE_HIGHLIGHT_MATCHES' }),
                    title: 'Highlight matches from the current text filter',
                    disabled: !textFilter.trim() || inverseMatches,
                  },
                  {
                    type: 'toggle',
                    id: 'inverseSearch',
                    icon: <InverseSearchIcon />,
                    active: inverseMatches,
                    onClick: () => dispatch({ type: 'TOGGLE_INVERSE_MATCHES' }),
                    title: 'Show only logs that do not contain the current text filter',
                    disabled: !textFilter.trim(),
                  },
                  {
                    type: 'toggle',
                    id: 'regexSearch',
                    icon: <RegexSearchIcon />,
                    active: regexMatches,
                    onClick: () => dispatch({ type: 'TOGGLE_REGEX_MATCHES' }),
                    title: 'Treat the current text filter as a regular expression',
                  },
                  { type: 'separator' },
                  {
                    type: 'toggle',
                    id: 'autoRefresh',
                    icon: <AutoRefreshIcon />,
                    active: autoRefresh,
                    onClick: () => dispatch({ type: 'TOGGLE_AUTO_REFRESH' }),
                    title: 'Auto-refresh (R)',
                  },
                  ...(supportsPreviousLogs
                    ? [
                        {
                          type: 'toggle' as const,
                          id: 'previousLogs',
                          icon: <PreviousLogsIcon />,
                          active: showPreviousLogs,
                          onClick: handleTogglePreviousLogs,
                          title: 'Previous logs (V)',
                        },
                      ]
                    : []),
                  { type: 'separator' },
                  {
                    type: 'toggle',
                    id: 'apiTimestamps',
                    icon: <TimestampIcon />,
                    active: showTimestamps,
                    onClick: () =>
                      dispatch({
                        type: 'SET_TIMESTAMP_MODE',
                        payload: showTimestamps ? 'hidden' : 'default',
                      }),
                    title: 'API timestamps (T)',
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
                  ...(hasAnsiLogEntries
                    ? [
                        {
                          type: 'toggle' as const,
                          id: 'ansiColors',
                          icon: <AnsiColorIcon />,
                          active: showAnsiColors,
                          onClick: () => dispatch({ type: 'TOGGLE_SHOW_ANSI_COLORS' }),
                          title: 'ANSI colors',
                          disabled: isParsedView,
                        },
                      ]
                    : []),
                  {
                    type: 'toggle',
                    id: 'prettyJson',
                    icon: <PrettyJsonIcon />,
                    active: displayMode === 'pretty',
                    onClick: () =>
                      dispatch({
                        type: 'SET_DISPLAY_MODE',
                        payload: displayMode === 'pretty' ? 'raw' : 'pretty',
                      }),
                    title: 'Pretty JSON',
                    disabled: !canParseLogs,
                  },
                  {
                    type: 'toggle',
                    id: 'parsedJson',
                    icon: <ParseJsonIcon />,
                    active: displayMode === 'parsed',
                    onClick: () =>
                      dispatch({
                        type: 'SET_DISPLAY_MODE',
                        payload: displayMode === 'parsed' ? 'raw' : 'parsed',
                      }),
                    title: 'Parsed JSON (P)',
                    disabled: !canParseLogs,
                  },
                  { type: 'separator' },
                  {
                    type: 'action',
                    id: 'copy',
                    icon: <CopyIcon />,
                    onClick: handleCopyLogs,
                    title: 'Copy to clipboard',
                    disabled: !hasCopyableContent,
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

            <span className="pod-logs-count" title={countTitle}>
              {countLabel}
            </span>
          </div>
        </div>

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
            <div
              className={`pod-logs-text ${!wrapText ? 'no-wrap' : ''} ${shouldVirtualizeRawLogs ? 'pod-logs-text--virtualized' : ''}`}
            >
              {displayLogs ? (
                shouldVirtualizeRawLogs ? (
                  <div
                    className="pod-logs-virtual-body"
                    style={{ height: `${virtualizedRawHeight + RAW_LOG_VERTICAL_PADDING_PX}px` }}
                  >
                    <div
                      className="pod-logs-virtual-inner"
                      style={{
                        transform: `translateY(${virtualizedRawOffsetTop + RAW_LOG_VERTICAL_PADDING_PX / 2}px)`,
                      }}
                    >
                      {visibleRenderedLogRows.map((row) => (
                        <div
                          key={row.key}
                          className="pod-log-row"
                          ref={(node) => {
                            measureVirtualizedRawRow(row.key, node);
                          }}
                        >
                          {renderRawLogRow(row)}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  renderedDisplayRows.map((row) => (
                    <div key={row.key} className="pod-log-row">
                      {renderRawLogRow(row)}
                    </div>
                  ))
                )
              ) : showPreviousLogs ? (
                'No previous logs found'
              ) : (
                'No logs available'
              )}
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
