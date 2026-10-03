/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx
 *
 * Renders the object-panel Logs tab. It reads the live stream's state (the
 * stream manager is its only writer), loads previous logs into component
 * state, and owns filtering, parsing, keyboard shortcuts, and viewer
 * preference persistence.
 */

import type { types } from '@core/backend-api/models';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import {
  ALL_MULTISELECT_FILTER,
  filterSelectionValues,
  isNarrowingFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { readContainerLogsScopeContainers, requestData } from '@/core/data-access';
import { useContainerLogsStream } from './hooks/useContainerLogsStream';
import { useLogCopyAction, useLogSelectionCopy } from './hooks/useLogCopyAction';
import { useLogFiltering } from './hooks/useLogFiltering';
import { useLogKeyboardShortcuts } from './hooks/useLogKeyboardShortcuts';
import { logCopyText, useRawViewFallback } from './hooks/useLogPresentation';
import './LogViewer.css';
import { eventBus } from '@/core/events';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import { refreshOrchestrator } from '@/core/refresh/orchestrator';
import { type DomainSnapshotState, useRefreshScopedDomain } from '@/core/refresh/store';
import { setContainerLogsStreamScopeParams } from '@/core/refresh/streaming/containerLogsStreamScopeParams';
import type {
  ContainerLogsEntry,
  ContainerLogsSnapshotPayload,
  ContainerLogsStreamPhase,
  ContainerLogsTargetIssue,
  ContainerLogsWarning,
} from '@/core/refresh/types';
import {
  getObjPanelLogsApiTimestampFormat,
  getObjPanelLogsApiTimestampUseLocalTimeZone,
} from '@/core/settings/appPreferences';
import { INACTIVE_SCOPE } from '../constants';
import { containsAnsi } from './ansi';
import { buildContainerLogMetadataColumns, containerLogExportValue } from './containerLogColumns';
import {
  buildActiveLogFilterChips,
  CONTAINER_FILTER_PREFIX,
  containerSelectorOptions,
  DEBUG_FILTER_PREFIX,
  formatContainerLabel,
  INIT_FILTER_PREFIX,
  type LogContainerKind,
  logContainerKind,
  toContainerFilterValueForKind,
  toPodFilterValue,
} from './containerLogFilters';
import {
  buildContainerLogNotices,
  LIVE_LOGS_UNAVAILABLE_MESSAGE,
  onlyUnavailableIssues,
  PREVIOUS_LOGS_UNAVAILABLE_MESSAGE,
} from './containerLogNotices';
import {
  type ContainerLogRow,
  renderContainerLogRow,
  shouldDisplayPodContainerMetadata,
  useContainerLogDisplay,
} from './containerLogRows';
import { formatTimestampForMode } from './containerLogTimestamps';
import { getWorkloadPodNames, useActivePodSet, useHiddenPods } from './hooks/useActivePodSet';
import { useAnchoredLogEntries } from './hooks/useAnchoredLogEntries';
import { useLogMessageRenderer } from './hooks/useLogMessageRenderer';
import { useLogScrollRestoration } from './hooks/useLogScrollRestoration';
import {
  type BackendLogSelection,
  type PreviousContainerLogs,
  usePreviousContainerLogs,
} from './hooks/usePreviousContainerLogs';
import { useTerminalTheme } from './hooks/useTerminalTheme';
import {
  LogViewerControls,
  LogViewerReadyView,
  renderLogViewerContent,
  renderLogViewerStatus,
} from './LogViewerLayout';
import {
  classifySelectedLogSources,
  logFilterBackendValues,
  logFilterSelectionForOnlyContainer,
  logFilterSelectionForOnlyPod,
  logFilterSelectionMatchesNone,
  pruneLogFilterSelectionToOptions,
} from './logFilterSelection';
import type { ParsedLogEntry } from './logOptionsReducer';
import { buildLogSearchRegex, isValidRegexPattern } from './logSearch';
import { buildLogToolbarItems } from './logToolbar';
import {
  getLogViewerPrefs,
  getLogViewerScrollPosition,
  setLogViewerPrefs,
  setLogViewerScrollPosition,
} from './logViewerPrefsCache';
import {
  applyLogViewerPrefs,
  extractLogViewerPrefs,
  initialLogViewerState,
  type LogViewerAction,
  logViewerReducer,
} from './logViewerReducer';
import { buildStablePodColorMap } from './podColors';

interface LogViewerProps {
  resourceKind: string;
  /**
   * Refresh-domain scope string for the container-logs producer. Owned by
   * ObjectPanel via getObjectPanelScopes so this component and the panel-
   * level cleanup effect in ObjectPanelContent consume the same value.
   * They used to compute it independently and could drift apart.
   */
  containerLogsScope: string | null;
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

const CONTAINER_LOGS_DOMAIN = 'container-logs' as const;
const POD_LOG_COLOR_PALETTE_SLOTS = Array.from({ length: 24 }, (_, index) => index + 1);
const EMPTY_CONTAINER_LOG_ENTRIES: ContainerLogsEntry[] = [];

type LogEmptyState =
  | 'none'
  | 'no_logs_yet'
  | 'no_previous_logs'
  | 'no_filter_matches'
  | 'unavailable'
  | 'previous_unavailable'
  | 'auto_refresh_off';

type ContainerLogsSnapshotState = DomainSnapshotState<ContainerLogsSnapshotPayload>;

const requestLogScopeContainers = async (
  clusterId: string,
  scope: string
): Promise<types.PodContainer[]> => {
  const result = await requestData({
    resource: 'log-scope-containers',
    reason: 'startup',
    adapter: 'rpc-read',
    label: 'Log Scope Containers',
    scope,
    read: () => readContainerLogsScopeContainers(clusterId, scope),
  });
  return result.status === 'executed' ? (result.data ?? []) : [];
};

const syncContainerLogsScope = ({
  scope,
  previousScopeRef,
  dispatch,
}: {
  scope: string | null;
  previousScopeRef: { current: string | null };
  dispatch: React.Dispatch<LogViewerAction>;
}): void => {
  if (scope === previousScopeRef.current) {
    return;
  }
  const hadPreviousScope = previousScopeRef.current !== null;
  previousScopeRef.current = scope;
  if (hadPreviousScope) {
    dispatch({ type: 'RESET_FOR_NEW_SCOPE' });
  }
};

type LiveContainerLogs = {
  entries: ContainerLogsEntry[];
  phase: ContainerLogsStreamPhase | null;
  warnings: ContainerLogsWarning[];
  issues: ContainerLogsTargetIssue[];
  truncation: ContainerLogsSnapshotPayload['truncation'];
  pods: string[];
  // A snapshot has been delivered at least once for this scope.
  hasSnapshot: boolean;
};

const NO_LIVE_LOGS: LiveContainerLogs = {
  entries: EMPTY_CONTAINER_LOG_ENTRIES,
  phase: null,
  warnings: [],
  issues: [],
  truncation: null,
  pods: [],
  hasSnapshot: false,
};

const getLiveContainerLogs = (
  snapshot: ContainerLogsSnapshotState,
  hasScope: boolean
): LiveContainerLogs => {
  const data = snapshot.data;
  if (!hasScope || !data) {
    return NO_LIVE_LOGS;
  }
  return {
    entries: data.entries,
    phase: data.phase,
    warnings: data.warnings,
    issues: data.issues,
    truncation: data.truncation,
    pods: data.pods,
    hasSnapshot: data.resetCount > 0,
  };
};

// The stream is still connecting and has nothing to show yet.
const isAwaitingLiveLogs = (live: LiveContainerLogs, streamExpected: boolean): boolean => {
  if (live.entries.length > 0) {
    return false;
  }
  if (!live.phase) {
    return streamExpected;
  }
  const status = live.phase.status;
  return status === 'connecting' || status === 'awaiting-snapshot' || status === 'reconnecting';
};

const liveLoadingMessage = (phase: ContainerLogsStreamPhase | null): string =>
  phase?.status === 'reconnecting'
    ? `Reconnecting to live logs (${phase.reason})...`
    : 'Loading logs...';

type LogViewerSource = {
  entries: ContainerLogsEntry[];
  // The pods that have lines in the source.
  pods: readonly string[];
  issues: ContainerLogsTargetIssue[];
  notices: string[];
  // Logs shown once the buffer has dropped some (null while it has room); the
  // buffer-full indicator beside the toolbar says so.
  bufferFullShown: number | null;
  displayError: string | null;
  // The live failure, when that is what stopped the view.
  liveFailure: string | null;
  isPending: boolean;
  hasLoaded: boolean;
  loadingMessage: string;
};

// Picks what the view shows: the live stream's buffer or the fetched previous
// logs, with the matching notices, error and loading state.
const resolveLogViewerSource = ({
  showPreviousContainerLogs,
  hasScope,
  live,
  previous,
  streamExpected,
}: {
  showPreviousContainerLogs: boolean;
  hasScope: boolean;
  live: LiveContainerLogs;
  previous: PreviousContainerLogs & { pods: readonly string[] };
  streamExpected: boolean;
}): LogViewerSource => {
  if (showPreviousContainerLogs) {
    return {
      entries: previous.entries,
      pods: previous.pods,
      issues: previous.issues,
      notices: buildContainerLogNotices({
        phase: null,
        warnings: previous.warnings,
        // A container without a previous run is the empty state, not a problem.
        issues: previous.issues.filter((issue) => issue.state !== 'unavailable'),
      }),
      bufferFullShown: null,
      displayError: previous.error,
      liveFailure: null,
      isPending: !hasScope || (previous.loading && previous.entries.length === 0),
      hasLoaded: !previous.loading,
      loadingMessage: 'Loading logs...',
    };
  }
  const liveFailure = live.phase?.status === 'failed' ? live.phase.reason : null;
  return {
    entries: live.entries,
    pods: live.pods,
    issues: live.issues,
    notices: buildContainerLogNotices(live),
    bufferFullShown: live.truncation?.shown ?? null,
    displayError: liveFailure,
    liveFailure,
    isPending: !hasScope || isAwaitingLiveLogs(live, streamExpected),
    hasLoaded: live.hasSnapshot,
    loadingMessage: liveLoadingMessage(live.phase),
  };
};

const resolveLogEmptyState = ({
  isPendingLogs,
  filteredEntryCount,
  entryCount,
  showPreviousContainerLogs,
  issues,
  hasNarrowingFilter,
  streamExpected,
  hasSnapshot,
}: {
  isPendingLogs: boolean;
  filteredEntryCount: number;
  entryCount: number;
  showPreviousContainerLogs: boolean;
  issues: ContainerLogsTargetIssue[];
  hasNarrowingFilter: boolean;
  streamExpected: boolean;
  hasSnapshot: boolean;
}): LogEmptyState => {
  if (isPendingLogs || filteredEntryCount > 0) {
    return 'none';
  }
  if (showPreviousContainerLogs) {
    return onlyUnavailableIssues(issues) ? 'previous_unavailable' : 'no_previous_logs';
  }
  if (onlyUnavailableIssues(issues)) {
    return 'unavailable';
  }
  if (hasNarrowingFilter && entryCount > 0) {
    return 'no_filter_matches';
  }
  if (!streamExpected && !hasSnapshot) {
    return 'auto_refresh_off';
  }
  return 'no_logs_yet';
};

const EMPTY_STATE_MESSAGES: Record<LogEmptyState, string> = {
  none: '',
  unavailable: LIVE_LOGS_UNAVAILABLE_MESSAGE,
  previous_unavailable: PREVIOUS_LOGS_UNAVAILABLE_MESSAGE,
  no_previous_logs: 'No previous logs found',
  no_filter_matches: 'No logs match the current filters',
  auto_refresh_off: 'Auto-refresh is off for this tab. Turn it on (R) to load logs.',
  no_logs_yet: 'No logs yet',
};

const shouldShowPausedLogEmptyState = ({
  suppressPassiveLoading,
  logEmptyState,
  entryCount,
  showPreviousContainerLogs,
}: {
  suppressPassiveLoading: boolean;
  logEmptyState: LogEmptyState;
  entryCount: number;
  showPreviousContainerLogs: boolean;
}): boolean =>
  suppressPassiveLoading &&
  logEmptyState === 'no_logs_yet' &&
  entryCount === 0 &&
  !showPreviousContainerLogs;

const hasCopyableContainerLogs = (
  isParsedView: boolean,
  parsedCount: number,
  filteredCount: number
): boolean => (isParsedView ? parsedCount > 0 : filteredCount > 0);

const hasActiveLogResultFilter = (
  selectedFilters: Parameters<typeof isNarrowingFilterSelection>[0],
  textFilter: string
): boolean => isNarrowingFilterSelection(selectedFilters) || textFilter.trim().length > 0;

const LogViewerInner: React.FC<LogViewerProps> = ({
  resourceKind,
  containerLogsScope,
  isActive = false,
  activePodNames = null,
  clusterId,
  panelId,
}) => {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
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
  const [apiTimestampFormat, setApiTimestampFormatState] = React.useState<string>(() =>
    getObjPanelLogsApiTimestampFormat()
  );
  const [apiTimestampUseLocalTimeZone, setApiTimestampUseLocalTimeZoneState] =
    React.useState<boolean>(() => getObjPanelLogsApiTimestampUseLocalTimeZone());
  const [isTailFollowing, setIsTailFollowing] = React.useState(true);

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
    caseSensitiveMatches,
    regexMatches,
    displayMode,
    expandedRows,
  } = state;
  const showPreviousContainerLogs = state.mode.kind === 'previous';
  const showTimestamps = timestampMode !== 'hidden';
  const isParsedView = displayMode === 'parsed';

  // Push the persistent subset of state into the panel-scoped prefs
  // cache whenever it changes. The cache is a module-level Map (not
  // React state), so this is just a Map.set per change with no
  // re-renders triggered. On the next remount of this LogViewer instance
  // (e.g. after a cluster-switch round trip) the lazy reducer
  // initializer above pulls these values back out.
  //
  // The reducer state is the source snapshot. Projecting it on every state
  // transition keeps the cache synchronized without maintaining a second,
  // manually duplicated dependency contract for its persistent fields.
  useEffect(() => {
    setLogViewerPrefs(panelId, extractLogViewerPrefs(state));
  }, [panelId, state]);

  const previousContainerLogsScopeRef = useRef<string | null>(null);
  const resolvedClusterId = clusterId?.trim() ?? '';

  // Refs
  const logsContentRef = useRef<HTMLElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const terminalTheme = useTerminalTheme(logsContentRef);

  useEffect(
    () => eventBus.on('settings:obj-panel-logs-api-timestamp-format', setApiTimestampFormatState),
    []
  );
  useEffect(
    () =>
      eventBus.on(
        'settings:obj-panel-logs-api-timestamp-use-local-time-zone',
        setApiTimestampUseLocalTimeZoneState
      ),
    []
  );
  const resourceKindKey = resourceKind?.toLowerCase() ?? '';
  const isWorkload = resourceKindKey !== 'pod';
  const supportsPreviousContainerLogs = resourceKindKey === 'pod';
  const selectedFilterValues = useMemo(
    () => filterSelectionValues(selectedFilters),
    [selectedFilters]
  );
  const selectedLogSources = useMemo(
    () => classifySelectedLogSources(selectedFilterValues),
    [selectedFilterValues]
  );
  const selectedContainerFilterCount =
    selectedLogSources.initContainers.size +
    selectedLogSources.containers.size +
    selectedLogSources.debugContainers.size;
  const handleSelectPodFilter = useCallback(
    (pod: string) => {
      dispatch({
        type: 'SET_SELECTED_FILTERS',
        payload: logFilterSelectionForOnlyPod(selectedFilters, pod),
      });
    },
    [selectedFilters]
  );
  const handleSelectContainerFilter = useCallback(
    (container: string, kind: LogContainerKind) => {
      dispatch({
        type: 'SET_SELECTED_FILTERS',
        payload: logFilterSelectionForOnlyContainer(
          selectedFilters,
          toContainerFilterValueForKind(container, kind)
        ),
      });
    },
    [selectedFilters]
  );
  const backendLogSelection = useMemo<BackendLogSelection>(
    () => ({
      selectedFilters: logFilterBackendValues(selectedFilters),
      matchNone: logFilterSelectionMatchesNone(selectedFilters),
    }),
    [selectedFilters]
  );

  // Keep this synchronous with render so a scope-reset re-render cannot
  // interrupt streaming startup.
  syncContainerLogsScope({
    scope: containerLogsScope,
    previousScopeRef: previousContainerLogsScopeRef,
    dispatch,
  });

  const logSnapshot = useRefreshScopedDomain(
    CONTAINER_LOGS_DOMAIN,
    containerLogsScope ?? INACTIVE_SCOPE
  );
  const live = getLiveContainerLogs(logSnapshot, Boolean(containerLogsScope));
  const previous = usePreviousContainerLogs({
    enabled: showPreviousContainerLogs,
    clusterId: resolvedClusterId,
    scope: containerLogsScope,
    selection: backendLogSelection,
  });
  const streamExpected =
    Boolean(containerLogsScope) && isActive && autoRefresh && !showPreviousContainerLogs;
  useContainerLogsStream({
    scope: containerLogsScope,
    isActive,
    autoRefresh,
    showPreviousContainerLogs,
  });

  // A failure that cannot be retried stops the stream; turning auto-refresh off
  // makes that visible, and turning it back on retries.
  const handledFailureRef = useRef<ContainerLogsStreamPhase | null>(null);
  useEffect(() => {
    if (live.phase?.status !== 'failed' || handledFailureRef.current === live.phase) {
      return;
    }
    handledFailureRef.current = live.phase;
    dispatch({ type: 'SET_AUTO_REFRESH', payload: false });
  }, [live.phase]);

  // Leaving the tab returns it to live logs.
  useEffect(() => {
    if (!isActive) {
      dispatch({ type: 'SET_SHOW_PREVIOUS_LOGS', payload: false });
    }
  }, [isActive]);

  const activePods = useActivePodSet(
    activePodNames,
    isWorkload && !showPreviousContainerLogs,
    containerLogsScope
  );
  const activePodList = useMemo(() => (activePods ? Array.from(activePods) : null), [activePods]);
  const previousPods = useMemo(
    () => Array.from(new Set(previous.entries.map((entry) => entry.pod))),
    [previous.entries]
  );
  const source = useMemo(
    () =>
      resolveLogViewerSource({
        showPreviousContainerLogs,
        hasScope: Boolean(containerLogsScope),
        live,
        previous: { ...previous, pods: previousPods },
        streamExpected,
      }),
    [containerLogsScope, live, previous, previousPods, showPreviousContainerLogs, streamExpected]
  );
  const hiddenPods = useHiddenPods(source.entries, activePods);

  const anchoredLogSourceKey = useMemo(
    () =>
      JSON.stringify([
        resolvedClusterId,
        containerLogsScope,
        backendLogSelection.selectedFilters,
        backendLogSelection.matchNone,
        showPreviousContainerLogs,
      ]),
    [
      backendLogSelection.matchNone,
      backendLogSelection.selectedFilters,
      containerLogsScope,
      resolvedClusterId,
      showPreviousContainerLogs,
    ]
  );
  const logEntries = useAnchoredLogEntries(
    source.entries,
    hiddenPods,
    isTailFollowing,
    anchoredLogSourceKey
  );
  const visibleLogWarnings = source.notices;

  const workloadPodsForSelector = useMemo(
    () => getWorkloadPodNames(source.pods, activePodList, hiddenPods),
    [source.pods, activePodList, hiddenPods]
  );

  const isPendingLogs = source.isPending;
  const logsLoadingState = applyPassiveLoadingPolicy({
    loading: isPendingLogs,
    hasLoaded: source.hasLoaded,
    hasData: logEntries.length > 0,
    isPaused,
    isManualRefreshActive: isManualRefreshActive || showPreviousContainerLogs,
  });
  const showPausedLogsState = logsLoadingState.showPausedEmptyState;

  // Generate consistent colors for pods (workload view).
  // Reads the shared --hash-color-N palette so pod-log colors and kind badges
  // draw from the same set; values resolve per appearance mode.
  const podColors = useMemo(() => {
    const styles = getComputedStyle(document.documentElement);
    const palette = POD_LOG_COLOR_PALETTE_SLOTS.map((slot) =>
      styles.getPropertyValue(`--hash-color-${slot}`).trim()
    );
    const fallbackColor = styles.getPropertyValue('--hash-color-fallback').trim();
    return buildStablePodColorMap(availablePods, palette, fallbackColor);
  }, [availablePods]);
  const formatApiTimestamp = useCallback(
    (timestamp: string) =>
      formatTimestampForMode(
        timestamp,
        timestampMode,
        apiTimestampFormat,
        apiTimestampUseLocalTimeZone
      ),
    [apiTimestampFormat, apiTimestampUseLocalTimeZone, timestampMode]
  );
  // The table view's pod, container and timestamp columns, ahead of the JSON fields.
  const metadataColumns = useMemo(
    () =>
      buildContainerLogMetadataColumns({
        isWorkload,
        showTimestamp: timestampMode !== 'hidden',
        podColors,
        formatTimestamp: formatApiTimestamp,
        getContainerLabel: (entry) =>
          formatContainerLabel(entry.container ?? '', logContainerKind(entry)),
        onSelectPod: handleSelectPodFilter,
        onSelectContainer: (entry) =>
          handleSelectContainerFilter(entry.container ?? '', logContainerKind(entry)),
      }),
    [
      formatApiTimestamp,
      handleSelectContainerFilter,
      handleSelectPodFilter,
      isWorkload,
      podColors,
      timestampMode,
    ]
  );
  const exportTableValue = useCallback(
    (row: ParsedLogEntry, key: string) => containerLogExportValue(row, key, formatApiTimestamp),
    [formatApiTimestamp]
  );
  const {
    filterText,
    filteredEntries,
    hasVisibleLines,
    canParseLogs: canParseContainerLogs,
    parsedRows,
    tableColumns,
    getParsedCsv,
    jsonOf,
  } = useLogFiltering({
    logEntries,
    isWorkload,
    selectedFilters,
    options: state,
    metadataColumns,
    exportValue: exportTableValue,
  });
  // Highlighting follows the filter as applied, so it never runs ahead of it.
  const highlightRegex = useMemo(
    () =>
      buildLogSearchRegex(highlightMatches && !inverseMatches ? filterText : '', {
        regexMode: regexMatches,
        caseSensitive: caseSensitiveMatches,
        global: true,
      }),
    [caseSensitiveMatches, filterText, highlightMatches, inverseMatches, regexMatches]
  );

  // A new source selection restarts the live stream; previous logs refetch on
  // their own, and a stopped stream picks the selection up when it starts.
  useEffect(() => {
    if (!containerLogsScope) {
      return;
    }
    const changed = setContainerLogsStreamScopeParams(containerLogsScope, backendLogSelection);
    if (!changed || showPreviousContainerLogs || !isActive || !autoRefresh) {
      return;
    }
    void refreshOrchestrator.restartStreamingDomain(CONTAINER_LOGS_DOMAIN, containerLogsScope);
  }, [autoRefresh, backendLogSelection, containerLogsScope, isActive, showPreviousContainerLogs]);

  const handleTogglePreviousContainerLogs = useCallback(() => {
    if (supportsPreviousContainerLogs) {
      dispatch({ type: 'SET_SHOW_PREVIOUS_LOGS', payload: !showPreviousContainerLogs });
    }
  }, [showPreviousContainerLogs, supportsPreviousContainerLogs]);

  useEffect(() => {
    if (!supportsPreviousContainerLogs && showPreviousContainerLogs) {
      dispatch({ type: 'SET_SHOW_PREVIOUS_LOGS', payload: false });
    }
  }, [supportsPreviousContainerLogs, showPreviousContainerLogs]);

  useEffect(() => {
    if (isWorkload) {
      dispatch({ type: 'SET_AVAILABLE_PODS', payload: workloadPodsForSelector });
    }
  }, [isWorkload, workloadPodsForSelector]);

  const podOptions = useMemo<DropdownOption[]>(
    () =>
      isWorkload
        ? workloadPodsForSelector.map((pod) => ({
            value: toPodFilterValue(pod),
            label: pod,
            group: 'Pods',
          }))
        : [],
    [isWorkload, workloadPodsForSelector]
  );
  // Init and regular containers get their own headings only when both exist.
  const containerOptions = useMemo<DropdownOption[]>(() => {
    const initOptions = containerSelectorOptions(containers, 'init', 'Init Containers');
    const regularOptions = [
      ...containerSelectorOptions(containers, 'regular', 'Containers'),
      ...containerSelectorOptions(containers, 'ephemeral', 'Containers'),
    ];
    if (initOptions.length === 0) {
      return regularOptions;
    }
    return [
      {
        value: '_init_containers_header',
        label: 'Init Containers',
        disabled: true,
        group: 'header',
      },
      ...initOptions,
      { value: '_containers_header', label: 'Containers', disabled: true, group: 'header' },
      ...regularOptions,
    ];
  }, [containers]);
  const selectorOptions = useMemo(
    () => [...podOptions, ...containerOptions],
    [podOptions, containerOptions]
  );
  const singlePodSelectableContainerCount = useMemo(
    () =>
      selectorOptions.filter(
        (option) =>
          option.value.startsWith(INIT_FILTER_PREFIX) ||
          option.value.startsWith(CONTAINER_FILTER_PREFIX) ||
          option.value.startsWith(DEBUG_FILTER_PREFIX)
      ).length,
    [selectorOptions]
  );
  const selectorOptionLabelsByValue = useMemo(
    () =>
      new Map(
        selectorOptions
          .filter((option) => option.group !== 'header')
          .map((option) => [option.value, option.label] as const)
      ),
    [selectorOptions]
  );
  const hasInvalidRegex = useMemo(
    () => regexMatches && !isValidRegexPattern(textFilter),
    [regexMatches, textFilter]
  );
  const activeFilterChips = useMemo(() => {
    return buildActiveLogFilterChips({
      textFilter,
      regexMatches,
      hasInvalidRegex,
      showPreviousContainerLogs,
      selectedFilterValues,
      selectorOptionLabelsByValue,
      highlightMatches,
      inverseMatches,
      caseSensitiveMatches,
      dispatch,
      stopPreviousLogs: () => dispatch({ type: 'STOP_PREVIOUS_LOGS' }),
    });
  }, [
    caseSensitiveMatches,
    hasInvalidRegex,
    highlightMatches,
    inverseMatches,
    regexMatches,
    selectedFilterValues,
    selectorOptionLabelsByValue,
    showPreviousContainerLogs,
    textFilter,
  ]);
  const handleClearAllFilters = useCallback(() => {
    dispatch({ type: 'SET_TEXT_FILTER', payload: '' });
    dispatch({ type: 'SET_SELECTED_FILTERS', payload: ALL_MULTISELECT_FILTER });
    if (showPreviousContainerLogs) {
      dispatch({ type: 'STOP_PREVIOUS_LOGS' });
    }
    if (highlightMatches) {
      dispatch({ type: 'TOGGLE_HIGHLIGHT_MATCHES' });
    }
    if (inverseMatches) {
      dispatch({ type: 'TOGGLE_INVERSE_MATCHES' });
    }
    if (caseSensitiveMatches) {
      dispatch({ type: 'TOGGLE_CASE_SENSITIVE_MATCHES' });
    }
    if (regexMatches) {
      dispatch({ type: 'TOGGLE_REGEX_MATCHES' });
    }
  }, [
    caseSensitiveMatches,
    highlightMatches,
    inverseMatches,
    regexMatches,
    showPreviousContainerLogs,
  ]);

  useEffect(() => {
    const nextSelection = pruneLogFilterSelectionToOptions(selectedFilters, selectorOptions);
    if (nextSelection !== selectedFilters) {
      dispatch({ type: 'SET_SELECTED_FILTERS', payload: nextSelection });
    }
  }, [selectedFilters, selectorOptions]);

  const logEmptyState = resolveLogEmptyState({
    isPendingLogs,
    filteredEntryCount: filteredEntries.length,
    entryCount: logEntries.length,
    showPreviousContainerLogs,
    issues: source.issues,
    hasNarrowingFilter: textFilter.trim().length > 0 || isNarrowingFilterSelection(selectedFilters),
    streamExpected,
    hasSnapshot: live.hasSnapshot,
  });
  const emptyStateMessage = EMPTY_STATE_MESSAGES[logEmptyState];
  const shouldShowPausedLogsEmptyState = shouldShowPausedLogEmptyState({
    suppressPassiveLoading: logsLoadingState.suppressPassiveLoading,
    logEmptyState,
    entryCount: logEntries.length,
    showPreviousContainerLogs,
  });

  const showContainerMetadata = shouldDisplayPodContainerMetadata(
    selectedContainerFilterCount,
    singlePodSelectableContainerCount
  );
  // Kept stable until an option changes, so rows are formatted once per entry.
  const displayOptions = useMemo(
    () => ({
      displayMode,
      showAnsiColors,
      timestampMode,
      apiTimestampFormat,
      apiTimestampUseLocalTimeZone,
      isWorkload,
      showContainerMetadata,
    }),
    [
      apiTimestampFormat,
      apiTimestampUseLocalTimeZone,
      displayMode,
      isWorkload,
      showAnsiColors,
      showContainerMetadata,
      timestampMode,
    ]
  );
  const { rows: displayRows, copyText } = useContainerLogDisplay({
    entries: filteredEntries,
    emptyStateMessage,
    jsonOf,
    options: displayOptions,
  });

  const hasCopyableContent = hasCopyableContainerLogs(
    isParsedView,
    parsedRows.length,
    filteredEntries.length
  );
  const hasAnsiLogEntries = useMemo(
    () => logEntries.some((entry) => containsAnsi(entry.line)),
    [logEntries]
  );
  const hasActiveResultFilter = hasActiveLogResultFilter(selectedFilters, textFilter);

  useRawViewFallback({
    displayMode,
    hasVisibleLines,
    canParseLogs: canParseContainerLogs,
    dispatch,
  });

  const renderMessageContent = useLogMessageRenderer({
    highlightRegex,
    showAnsiColors,
    terminalTheme,
    plainSegmentWrapper: 'fragment',
  });

  const renderRawLogRow = useCallback(
    (row: ContainerLogRow) =>
      renderContainerLogRow({
        row,
        podColors,
        selectPod: handleSelectPodFilter,
        selectContainer: handleSelectContainerFilter,
        renderMessage: renderMessageContent,
      }),
    [handleSelectContainerFilter, handleSelectPodFilter, podColors, renderMessageContent]
  );

  // Fetch container inventory for the current log scope.
  useEffect(() => {
    // Keep the inventory recheck on pod/workload transitions.
    void isWorkload;
    if (!containerLogsScope) {
      dispatch({ type: 'SET_CONTAINERS', payload: [] });
      return;
    }

    let isCancelled = false;
    void requestLogScopeContainers(resolvedClusterId, containerLogsScope)
      .then((containerList) => {
        if (isCancelled) {
          return;
        }
        dispatch({ type: 'SET_CONTAINERS', payload: containerList });
      })
      .catch((err) => {
        if (isCancelled) {
          return;
        }
        console.warn('Failed to fetch containers:', err);
        dispatch({ type: 'SET_CONTAINERS', payload: [] });
      });

    return () => {
      isCancelled = true;
    };
  }, [isWorkload, containerLogsScope, resolvedClusterId]);

  const { resumeTailFollowing } = useLogScrollRestoration({
    rootRef: logsContentRef,
    isActive,
    isParsedView,
    rowCount: isParsedView ? parsedRows.length : logEntries.length,
    // A new batch changes the shown rows (or the table's rows).
    tailFollowSignal: isParsedView ? parsedRows : displayRows,
    cacheKey: panelId,
    getScrollPosition: getLogViewerScrollPosition,
    setScrollPosition: setLogViewerScrollPosition,
    onTailFollowingChange: setIsTailFollowing,
  });
  const handleResumeScrolling = useCallback(() => {
    if (!autoRefresh) {
      dispatch({ type: 'TOGGLE_AUTO_REFRESH' });
    }
    resumeTailFollowing();
  }, [autoRefresh, resumeTailFollowing]);

  const getCopyText = useCallback(
    () => logCopyText(displayMode, copyText, getParsedCsv),
    [copyText, displayMode, getParsedCsv]
  );
  const handleCopyContainerLogs = useLogCopyAction({
    getText: getCopyText,
    dispatch,
    source: 'LogViewer',
  });
  useLogSelectionCopy({ rootRef: logsContentRef, active: isActive, source: 'LogViewer' });

  const toggleTimestamps = useCallback(
    () => dispatch({ type: 'SET_TIMESTAMP_MODE', payload: showTimestamps ? 'hidden' : 'default' }),
    [showTimestamps]
  );
  const previousLogsFeature = supportsPreviousContainerLogs
    ? { active: showPreviousContainerLogs, toggle: handleTogglePreviousContainerLogs }
    : undefined;
  useLogKeyboardShortcuts({
    isActive,
    options: state,
    hasAnsiLogEntries,
    hasCopyableContent,
    canParseLogs: canParseContainerLogs,
    dispatch,
    copyLogs: handleCopyContainerLogs,
    filterInputRef,
    logsContentRef,
    timestamps: { toggle: toggleTimestamps },
    previousLogs: previousLogsFeature,
  });

  const handleToggleParsedRow = useCallback((rowKey: string) => {
    dispatch({ type: 'TOGGLE_ROW_EXPANSION', payload: rowKey });
  }, []);

  const status = renderLogViewerStatus({
    loading: logsLoadingState.loading,
    loadingMessage: source.loadingMessage,
    paused: showPausedLogsState || shouldShowPausedLogsEmptyState,
    displayError: source.displayError,
    retryHint: source.liveFailure !== null,
    hasEntries: logEntries.length > 0,
  });
  const renderedLogContent =
    status ??
    renderLogViewerContent({
      isParsedView,
      parsedLogs: parsedRows,
      tableColumns,
      expandedRows,
      onToggleParsedRow: handleToggleParsedRow,
      displayRows,
      logsContentRef,
      wrapText,
      renderRawLogRow,
    });
  const iconItems = buildLogToolbarItems({
    options: state,
    dispatch,
    hasAnsiLogEntries,
    canParseLogs: canParseContainerLogs,
    hasCopyableContent,
    copyLogs: handleCopyContainerLogs,
    previousLogs: previousLogsFeature,
    timestamps: { active: showTimestamps, toggle: toggleTimestamps },
  });
  const controls = (
    <LogViewerControls
      activeFilterChips={activeFilterChips}
      podOptions={podOptions}
      containerOptions={containerOptions}
      selectedFilters={selectedFilters}
      filterInputRef={filterInputRef}
      textFilter={textFilter}
      iconItems={iconItems}
      hasActiveResultFilter={hasActiveResultFilter}
      matchCount={filteredEntries.length}
      bufferFullShown={source.bufferFullShown}
      dispatch={dispatch}
    />
  );
  return (
    <LogViewerReadyView
      controls={controls}
      activeFilterChips={activeFilterChips}
      clearAllFilters={handleClearAllFilters}
      visibleLogWarnings={visibleLogWarnings}
      logsContentRef={logsContentRef}
      renderedLogContent={renderedLogContent}
      isParsedView={isParsedView}
      isTailFollowing={isTailFollowing}
      resumeScrolling={handleResumeScrolling}
    />
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
