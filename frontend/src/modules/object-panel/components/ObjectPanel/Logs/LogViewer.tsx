/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx
 *
 * Renders the object-panel Logs tab. It coordinates container-log stream
 * lifecycle, fallback reads, filtering, parsing, keyboard shortcuts, and viewer
 * preference persistence.
 */

import ActiveFilterChips, { type ActiveFilterChip } from '@shared/components/ActiveFilterChips';
import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
import { Dropdown, type DropdownOption } from '@shared/components/dropdowns/Dropdown';
import {
  ALL_MULTISELECT_FILTER,
  filterSelectionValues,
  isNarrowingFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import {
  AnsiColorIcon,
  AutoRefreshIcon,
  CopyIcon,
  HighlightSearchIcon,
  InverseSearchIcon,
  ParseJsonIcon,
  PrettyJsonIcon,
  PreviousLogsIcon,
  RegexSearchIcon,
  TimestampIcon,
  WrapTextIcon,
} from '@shared/components/icons/LogIcons';
import { CaseSensitiveIcon, SettingsIcon } from '@shared/components/icons/SharedIcons';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  readContainerLogs,
  readContainerLogsScopeContainers,
  requestData,
  setRefreshDomainEnabled,
} from '@/core/data-access';
import {
  getLogDataUnavailableMessage,
  isLogDataUnavailable,
  useContainerLogsStreamFallback,
} from './hooks/useContainerLogsStreamFallback';
import { useLogFiltering } from './hooks/useLogFiltering';
import { useLogKeyboardShortcuts } from './hooks/useLogKeyboardShortcuts';
import './LogViewer.css';
import ObjPanelLogsSettingsModal from '@ui/modals/ObjPanelLogsSettingsModal';
import { useKeyboardSurface } from '@ui/shortcuts';
import type { types } from '@wailsjs/go/models';
import { eventBus } from '@/core/events';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import { refreshOrchestrator } from '@/core/refresh/orchestrator';
import { setScopedDomainState, useRefreshScopedDomain } from '@/core/refresh/store';
import type { ContainerLogsEntry } from '@/core/refresh/types';
import {
  getObjPanelLogsApiTimestampFormat,
  getObjPanelLogsApiTimestampUseLocalTimeZone,
  getObjPanelLogsBufferMaxSize,
} from '@/core/settings/appPreferences';
import {
  DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT,
  formatDefaultObjPanelLogsApiTimestamp,
  formatObjPanelLogsApiTimestamp,
} from '@/utils/objPanelLogsApiTimestampFormat';
import { INACTIVE_SCOPE } from '../constants';
import { containsAnsi, parseAnsiTextSegments, stripAnsi } from './ansi';
import { setContainerLogsStreamScopeParams } from './containerLogsStreamScopeParamsCache';
import { useAnchoredLogEntries } from './hooks/useAnchoredLogEntries';
import { isLogScrollAtBottom, useLogScrollRestoration } from './hooks/useLogScrollRestoration';
import { useTerminalTheme } from './hooks/useTerminalTheme';
import { buildCsv } from './logExport';
import {
  logFilterBackendValues,
  logFilterSelectionForOnlyContainer,
  logFilterSelectionForOnlyPod,
  logFilterSelectionFromDropdownValues,
  logFilterSelectionLabel,
  logFilterSelectionMatchesNone,
  logFilterSelectionToDropdownValues,
  pruneLogFilterSelectionToOptions,
} from './logFilterSelection';
import { buildLogSearchRegex, isValidRegexPattern } from './logSearch';
import {
  getLogViewerPrefs,
  getLogViewerScrollTop,
  setLogViewerPrefs,
  setLogViewerScrollTop,
} from './logViewerPrefsCache';
import {
  ALL_CONTAINERS,
  applyLogViewerPrefs,
  extractLogViewerPrefs,
  initialLogViewerState,
  logViewerReducer,
  type ParsedLogEntry,
} from './logViewerReducer';
import ParsedLogTable from './ParsedLogTable';
import {
  deriveParsedLogFieldKeys,
  formatParsedValue,
  formatRawOrPrettyJsonLine,
} from './parsedLogUtils';
import { buildStablePodColorMap } from './podColors';
import RawLogViewer, { type RenderedLogRow } from './RawLogViewer';
import { getSelectedTextWithinRoot, selectAllTextWithinRoot } from './textSelection';

interface LogViewerProps {
  namespace: string;
  resourceName: string;
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
const PARSED_COLUMN_MIN_WIDTH = 50;
const PARSED_TIMESTAMP_MIN_WIDTH = 80;
const PARSED_POD_COLUMN_MIN_WIDTH = 80;
const PARSED_COLUMN_AUTOSIZE_MAX_WIDTH = 520;
const PARSED_TIMESTAMP_AUTOSIZE_MAX_WIDTH = 280;
const PARSED_METADATA_AUTOSIZE_MAX_WIDTH = 320;
const RAW_LOG_VIRTUALIZATION_THRESHOLD = 120;
const RAW_LOG_VIRTUALIZATION_OVERSCAN = 10;
const RAW_LOG_ESTIMATE_ROW_HEIGHT = 26;
const RAW_LOG_VERTICAL_PADDING_PX = 16;

const formatTimestampForMode = (
  timestamp: string,
  mode: 'hidden' | 'default' | 'short' | 'localized',
  apiTimestampFormat: string,
  useLocalTimeZone: boolean
): string => {
  if (!timestamp || mode === 'hidden') {
    return '';
  }
  switch (mode) {
    case 'default':
      return formatObjPanelLogsApiTimestamp(timestamp, apiTimestampFormat, useLocalTimeZone);
    case 'short': {
      const parsed = new Date(timestamp);
      if (Number.isNaN(parsed.getTime())) {
        return formatDefaultObjPanelLogsApiTimestamp(timestamp, useLocalTimeZone);
      }
      const hours = String(useLocalTimeZone ? parsed.getHours() : parsed.getUTCHours()).padStart(
        2,
        '0'
      );
      const minutes = String(
        useLocalTimeZone ? parsed.getMinutes() : parsed.getUTCMinutes()
      ).padStart(2, '0');
      const seconds = String(
        useLocalTimeZone ? parsed.getSeconds() : parsed.getUTCSeconds()
      ).padStart(2, '0');
      const millis = String(
        useLocalTimeZone ? parsed.getMilliseconds() : parsed.getUTCMilliseconds()
      ).padStart(3, '0');
      return `${hours}:${minutes}:${seconds}.${millis}`;
    }
    case 'localized': {
      const parsed = new Date(timestamp);
      if (Number.isNaN(parsed.getTime())) {
        return formatDefaultObjPanelLogsApiTimestamp(timestamp, useLocalTimeZone);
      }
      return parsed.toLocaleString([], {
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: useLocalTimeZone ? undefined : 'UTC',
      });
    }
    default:
      return formatObjPanelLogsApiTimestamp(
        timestamp,
        DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT,
        useLocalTimeZone
      );
  }
};

// Build a display label for a container, appending :init for init containers
const formatContainerLabel = (container: string, isInit: boolean, isEphemeral: boolean): string =>
  isInit ? `${container}:init` : isEphemeral ? `${container} (debug)` : container;

const parseContainerLabel = (
  label: string
): { name: string; isInit: boolean; isEphemeral: boolean } => {
  if (label.endsWith(':init')) {
    return {
      name: label.slice(0, -':init'.length),
      isInit: true,
      isEphemeral: false,
    };
  }
  if (label.endsWith(' (debug)')) {
    return {
      name: label.slice(0, -' (debug)'.length),
      isInit: false,
      isEphemeral: true,
    };
  }
  return { name: label, isInit: false, isEphemeral: false };
};

const POD_FILTER_PREFIX = 'pod:';
const INIT_FILTER_PREFIX = 'init:';
const CONTAINER_FILTER_PREFIX = 'container:';
const DEBUG_FILTER_PREFIX = 'debug:';
const TARGET_LIMIT_WARNING_PATTERN =
  /^Logs are hidden for (\d+) containers because the (per-tab|global) limit of (\d+) was reached\. Using filters to reduce the number of containers may clear this message\.$/;
const WORKLOAD_RAW_LOG_PREFIX_PATTERN = /^(?:(\[[^\]]+\]\s*))?\[([^/]+)\/([^\]]+)\]\s*(.*)/;
const EMPTY_CONTAINER_LOG_PLACEHOLDER = '[container emitted an empty log]';

const mergeTargetLimitWarnings = (warnings: string[]): string[] => {
  if (warnings.length < 2) {
    return warnings;
  }

  const merged: string[] = [];
  let perTabMatch: RegExpMatchArray | null = null;
  let globalMatch: RegExpMatchArray | null = null;

  for (const warning of warnings) {
    const match = warning.match(TARGET_LIMIT_WARNING_PATTERN);
    if (!match) {
      merged.push(warning);
      continue;
    }
    if (match[2] === 'per-tab') {
      perTabMatch = match;
      continue;
    }
    if (match[2] === 'global') {
      globalMatch = match;
      continue;
    }
    merged.push(warning);
  }

  if (perTabMatch && globalMatch) {
    const hiddenCount = Number.parseInt(perTabMatch[1], 10) + Number.parseInt(globalMatch[1], 10);
    merged.unshift(
      `Logs are hidden for ${hiddenCount} containers because the per-tab limit of ${perTabMatch[3]} and global limit of ${globalMatch[3]} were reached. Using filters to reduce the number of containers may clear this message.`
    );
    return merged;
  }

  if (perTabMatch) {
    merged.unshift(perTabMatch[0]);
  }
  if (globalMatch) {
    merged.unshift(globalMatch[0]);
  }

  return merged;
};

const isInitContainerDisplayName = (container: string): boolean => container.endsWith(' (init)');
const isDebugContainerDisplayName = (container: string): boolean => container.endsWith(' (debug)');
const getActualContainerName = (displayName: string): string =>
  displayName.replace(' (init)', '').replace(' (debug)', '');

const toPodFilterValue = (pod: string): string => `${POD_FILTER_PREFIX}${pod}`;
const toInitContainerFilterValue = (container: string): string =>
  `${INIT_FILTER_PREFIX}${container}`;
const toContainerFilterValue = (container: string): string =>
  `${CONTAINER_FILTER_PREFIX}${container}`;
const toDebugContainerFilterValue = (container: string): string =>
  `${DEBUG_FILTER_PREFIX}${container}`;
const toContainerFilterValueForKind = (
  container: string,
  isInit: boolean,
  isEphemeral: boolean
): string =>
  isInit
    ? toInitContainerFilterValue(container)
    : isEphemeral
      ? toDebugContainerFilterValue(container)
      : toContainerFilterValue(container);

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
  const containerCount = selectedValues.filter(
    (value) => value.startsWith(CONTAINER_FILTER_PREFIX) || value.startsWith(DEBUG_FILTER_PREFIX)
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

const formatSelectedFilterLabel = (
  filterValue: string,
  optionsByValue: Map<string, string>
): string => {
  const knownLabel = optionsByValue.get(filterValue);
  if (knownLabel) {
    return knownLabel;
  }
  if (filterValue.startsWith(POD_FILTER_PREFIX)) {
    return filterValue.substring(POD_FILTER_PREFIX.length);
  }
  if (filterValue.startsWith(INIT_FILTER_PREFIX)) {
    return filterValue.substring(INIT_FILTER_PREFIX.length);
  }
  if (filterValue.startsWith(CONTAINER_FILTER_PREFIX)) {
    return filterValue.substring(CONTAINER_FILTER_PREFIX.length);
  }
  if (filterValue.startsWith(DEBUG_FILTER_PREFIX)) {
    return `${filterValue.substring(DEBUG_FILTER_PREFIX.length)} (debug)`;
  }
  return filterValue;
};

type LogEmptyState =
  | 'none'
  | 'no_logs_yet'
  | 'no_previous_logs'
  | 'no_filter_matches'
  | 'unavailable';

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
  const [isObjPanelLogsSettingsOpen, setIsObjPanelLogsSettingsOpen] = React.useState(false);
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
    copyFeedback,
    displayMode,
    parsedContainerLogs,
    expandedRows,
  } = state;
  // Derived from the discriminated view mode (the single source of truth for
  // the mutually-exclusive live / fallback / previous-logs states).
  const fallbackActive = state.mode.kind === 'fallback';
  const showPreviousContainerLogs = state.mode.kind === 'previous';
  const isLoadingPreviousContainerLogs = state.mode.kind === 'previous' && state.mode.loading;
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

  const hasPrimedScopeRef = useRef(false);
  const fallbackRecoveringRef = useRef(false);
  const previousActivePodsRef = useRef<string[] | null>(null);
  const previousContainerLogsScopeRef = useRef<string | null>(null);
  const resolvedClusterId = clusterId?.trim() ?? '';

  // Refs
  const logsContentRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const seqCounterRef = useRef(0);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const selectedInitContainers = useMemo(
    () =>
      new Set(
        selectedFilterValues
          .filter((filterValue) => filterValue.startsWith(INIT_FILTER_PREFIX))
          .map((filterValue) => filterValue.substring(INIT_FILTER_PREFIX.length))
      ),
    [selectedFilterValues]
  );
  const selectedRegularContainers = useMemo(
    () =>
      new Set(
        selectedFilterValues
          .filter((filterValue) => filterValue.startsWith(CONTAINER_FILTER_PREFIX))
          .map((filterValue) => filterValue.substring(CONTAINER_FILTER_PREFIX.length))
      ),
    [selectedFilterValues]
  );
  const selectedEphemeralContainers = useMemo(
    () =>
      new Set(
        selectedFilterValues
          .filter((filterValue) => filterValue.startsWith(DEBUG_FILTER_PREFIX))
          .map((filterValue) => filterValue.substring(DEBUG_FILTER_PREFIX.length))
      ),
    [selectedFilterValues]
  );
  const selectedContainerFilterCount =
    selectedInitContainers.size + selectedRegularContainers.size + selectedEphemeralContainers.size;
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
    (container: string, isInit: boolean, isEphemeral: boolean) => {
      dispatch({
        type: 'SET_SELECTED_FILTERS',
        payload: logFilterSelectionForOnlyContainer(
          selectedFilters,
          toContainerFilterValueForKind(container, isInit, isEphemeral)
        ),
      });
    },
    [selectedFilters]
  );
  const highlightRegex = useMemo(
    () =>
      buildLogSearchRegex(highlightMatches && !inverseMatches ? textFilter : '', {
        regexMode: regexMatches,
        caseSensitive: caseSensitiveMatches,
        global: true,
      }),
    [caseSensitiveMatches, highlightMatches, inverseMatches, regexMatches, textFilter]
  );
  const backendLogSelection = useMemo(() => {
    return {
      container: '',
      includeInit: true,
      includeEphemeral: true,
      selectedFilters: logFilterBackendValues(selectedFilters),
      matchNone: logFilterSelectionMatchesNone(selectedFilters),
    };
  }, [selectedFilters]);

  // Reset state when scope changes - do this during render, not in an effect,
  // to avoid causing a re-render that would interrupt streaming startup
  if (containerLogsScope !== previousContainerLogsScopeRef.current) {
    const hadPreviousScope = previousContainerLogsScopeRef.current !== null;
    previousContainerLogsScopeRef.current = containerLogsScope;
    hasPrimedScopeRef.current = false;
    previousActivePodsRef.current = null;
    // Only dispatch RESET_FOR_NEW_SCOPE if we had a previous scope (not on initial render)
    // This prevents a re-render that would interrupt streaming startup
    if (hadPreviousScope) {
      dispatch({ type: 'RESET_FOR_NEW_SCOPE', isWorkload });
    }
  }

  const logSnapshot = useRefreshScopedDomain(
    CONTAINER_LOGS_DOMAIN,
    containerLogsScope ?? INACTIVE_SCOPE
  );
  const payloadEntries = containerLogsScope ? logSnapshot.data?.entries : undefined;
  const rawLogEntries: ContainerLogsEntry[] = useMemo(() => payloadEntries ?? [], [payloadEntries]);

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
  const activeScrollContainer = isParsedView
    ? logsContentRef.current?.querySelector<HTMLElement>('.gridtable-wrapper')
    : logsContentRef.current;
  const shouldFollowTailForCurrentRender =
    isTailFollowing && (!activeScrollContainer || isLogScrollAtBottom(activeScrollContainer));
  const logEntries = useAnchoredLogEntries(
    rawLogEntries,
    shouldFollowTailForCurrentRender,
    anchoredLogSourceKey
  );
  const snapshotStatus = containerLogsScope ? logSnapshot.status : 'idle';
  const snapshotError = containerLogsScope ? logSnapshot.error : null;
  // sequence 1 = connected event, sequence >= 2 = initial logs received (may be empty)
  const snapshotSequence = containerLogsScope ? (logSnapshot.data?.sequence ?? 0) : 0;
  const hasReceivedInitialLogs = snapshotSequence >= 2;
  const logWarnings = (logSnapshot.stats?.warnings ?? []).filter(
    (warning) => typeof warning === 'string' && warning.trim().length > 0
  );
  const visibleLogWarnings = useMemo(
    () =>
      mergeTargetLimitWarnings(
        logWarnings.filter(
          (warning) => warning.includes('per-tab limit') || warning.includes('global limit')
        )
      ),
    [logWarnings]
  );

  const displayError = snapshotError && !isLogDataUnavailable(snapshotError) ? snapshotError : null;
  const transientStreamError = displayError
    ? [
        'container logs stream connection lost',
        'container logs stream disconnected',
        'reconnecting',
        'failed to open container logs stream',
      ].some((term) => displayError.toLowerCase().includes(term))
    : false;
  const shouldSuppressError =
    fallbackActive ||
    showPreviousContainerLogs ||
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

  const isPendingLogs = showPreviousContainerLogs
    ? isLoadingPreviousContainerLogs && logEntries.length === 0
    : logEntries.length === 0 &&
      (!hasReceivedInitialLogs ||
        waitingForInitialPrime ||
        ['loading', 'updating', 'initialising'].includes(snapshotStatus) ||
        fallbackActive ||
        pendingFallback);
  const logsLoadingState = applyPassiveLoadingPolicy({
    loading: isPendingLogs,
    hasLoaded: hasReceivedInitialLogs,
    hasData: logEntries.length > 0,
    isPaused,
    isManualRefreshActive: isManualRefreshActive || showPreviousContainerLogs,
  });
  const showPausedLogsState = logsLoadingState.showPausedEmptyState;

  const { filteredEntries, parsedCandidates, canParseContainerLogs } = useLogFiltering({
    logEntries,
    isWorkload,
    selectedFilters,
    textFilter,
    inverseMatches,
    caseSensitiveMatches,
    regexMatches,
  });

  const mapEntriesToSnapshot = useCallback(
    (
      entries: ContainerLogsEntry[],
      generatedAt: number,
      isManual: boolean,
      warnings: string[] = []
    ) => {
      if (!containerLogsScope) {
        return;
      }
      setScopedDomainState(CONTAINER_LOGS_DOMAIN, containerLogsScope, (previous) => {
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
          scope: containerLogsScope,
        };
      });
    },
    [containerLogsScope]
  );

  const fetchLogs = useCallback(
    async (options: { isManual?: boolean; previous?: boolean } = {}) => {
      if (!containerLogsScope) {
        return;
      }

      const { isManual = false, previous = false } = options;

      try {
        // tailLines for the fallback fetch tracks the user-configurable
        // Object Panel Logs Tab buffer size setting. This keeps the
        // initial fallback fetch in sync with the rolling buffer cap so
        // the user gets exactly as much history as their buffer can hold.
        const request: types.ContainerLogsFetchRequest = {
          scope: containerLogsScope,
          selectedFilters: backendLogSelection.selectedFilters,
          matchNone: backendLogSelection.matchNone,
          container: backendLogSelection.container,
          includeInit: backendLogSelection.includeInit,
          includeEphemeral: backendLogSelection.includeEphemeral,
          previous,
          tailLines: getObjPanelLogsBufferMaxSize(),
          sinceSeconds: 0,
        };

        const result = await requestData({
          resource: 'container-logs-fallback',
          reason: isManual ? 'user' : 'background',
          adapter: 'rpc-read',
          label: previous ? 'Previous Container Logs' : 'Container Logs Fallback',
          scope: containerLogsScope,
          read: () => readContainerLogs(resolvedClusterId, request),
        });
        if (result.status === 'blocked') {
          return;
        }

        const response = result.data;
        if (response?.error) {
          throw new Error(response.error);
        }

        const entries = Array.isArray(response?.entries) ? response.entries : [];
        const warnings = Array.isArray(response?.warnings)
          ? response.warnings.filter((warning): warning is string => typeof warning === 'string')
          : [];

        const mapped: ContainerLogsEntry[] = entries.map((entry) => ({
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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isLogDataUnavailable(message)) {
          const generatedAt = Date.now();
          mapEntriesToSnapshot([], generatedAt, isManual, [getLogDataUnavailableMessage(previous)]);
          hasPrimedScopeRef.current = true;
          return;
        }
        // The error surfaces through the refresh-store snapshot status below.
        setScopedDomainState(CONTAINER_LOGS_DOMAIN, containerLogsScope, (previousState) => ({
          ...previousState,
          status: 'error',
          error: message,
          scope: containerLogsScope,
        }));
      }
    },
    [
      containerLogsScope,
      mapEntriesToSnapshot,
      backendLogSelection.container,
      backendLogSelection.includeEphemeral,
      backendLogSelection.includeInit,
      backendLogSelection.selectedFilters,
      backendLogSelection.matchNone,
      resolvedClusterId,
    ]
  );

  const fetchFallbackContainerLogs = useCallback(
    async (isManualFetch: boolean = false) => {
      await fetchLogs({ isManual: isManualFetch });
    },
    [fetchLogs]
  );

  // Stream lifecycle, fallback activation, recovery, and initial log priming.
  useContainerLogsStreamFallback({
    containerLogsScope,
    isActive,
    autoRefresh,
    showPreviousContainerLogs,
    snapshotStatus,
    logEntriesLength: logEntries.length,
    fallbackActive,
    fetchFallbackContainerLogs,
    dispatch,
    fallbackRecoveringRef,
    hasPrimedScopeRef,
  });

  useEffect(() => {
    if (!containerLogsScope) {
      return;
    }
    const changed = setContainerLogsStreamScopeParams(containerLogsScope, backendLogSelection);
    if (!changed) {
      return;
    }
    if (showPreviousContainerLogs) {
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
      void fetchFallbackContainerLogs(false);
      return;
    }
    if (!isActive || !autoRefresh) {
      return;
    }
    void refreshOrchestrator.restartStreamingDomain(CONTAINER_LOGS_DOMAIN, containerLogsScope);
  }, [
    autoRefresh,
    backendLogSelection,
    fallbackActive,
    fetchFallbackContainerLogs,
    fetchLogs,
    isActive,
    containerLogsScope,
    showPreviousContainerLogs,
  ]);

  useEffect(() => {
    if (!isWorkload || !containerLogsScope || showPreviousContainerLogs) {
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
    const visibleEntries = clearAllEntries
      ? []
      : logEntries.filter((entry) => activePodSet.has(entry.pod));
    const hasChanged = clearAllEntries
      ? logEntries.length > 0
      : visibleEntries.length !== logEntries.length;

    if (!hasChanged) {
      previousActivePodsRef.current = normalizedActivePods;
      return;
    }

    const generatedAt = Date.now();

    setScopedDomainState(CONTAINER_LOGS_DOMAIN, containerLogsScope, (previous) => {
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
          entries: visibleEntries,
          generatedAt,
          resetCount: previousPayload.resetCount + 1,
        },
        lastUpdated: generatedAt,
        lastAutoRefresh: generatedAt,
        isManual: false,
        scope: containerLogsScope,
      };
    });

    hasPrimedScopeRef.current = visibleEntries.length > 0;
    previousActivePodsRef.current = normalizedActivePods;
  }, [isWorkload, logEntries, containerLogsScope, normalizedActivePods, showPreviousContainerLogs]);

  const handleTogglePreviousContainerLogs = useCallback(() => {
    if (!supportsPreviousContainerLogs) {
      return;
    }
    if (!containerLogsScope) {
      dispatch({ type: 'SET_SHOW_PREVIOUS_LOGS', payload: !showPreviousContainerLogs });
      dispatch({ type: 'SET_IS_LOADING_PREVIOUS_LOGS', payload: false });
      return;
    }

    if (showPreviousContainerLogs) {
      dispatch({ type: 'STOP_PREVIOUS_LOGS' });
      hasPrimedScopeRef.current = false;
      return;
    }

    dispatch({ type: 'START_PREVIOUS_LOGS' });
    hasPrimedScopeRef.current = false;

    refreshOrchestrator.stopStreamingDomain(CONTAINER_LOGS_DOMAIN, containerLogsScope, {
      reset: false,
    });
    setRefreshDomainEnabled({
      domain: CONTAINER_LOGS_DOMAIN,
      scope: containerLogsScope,
      enabled: false,
    });

    setScopedDomainState(CONTAINER_LOGS_DOMAIN, containerLogsScope, (previous) => {
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
        scope: containerLogsScope,
      };
    });

    void fetchLogs({ previous: true, isManual: true })
      .catch((error) => {
        console.error('Failed to load previous logs', error);
      })
      .finally(() => {
        dispatch({ type: 'SET_IS_LOADING_PREVIOUS_LOGS', payload: false });
      });
  }, [fetchLogs, containerLogsScope, showPreviousContainerLogs, supportsPreviousContainerLogs]);

  useEffect(() => {
    if (!supportsPreviousContainerLogs && showPreviousContainerLogs) {
      dispatch({ type: 'SET_SHOW_PREVIOUS_LOGS', payload: false });
      dispatch({ type: 'SET_IS_LOADING_PREVIOUS_LOGS', payload: false });
    }
  }, [supportsPreviousContainerLogs, showPreviousContainerLogs]);

  // Generate consistent colors for pods (workload view).
  // Reads the shared --hash-color-N palette so pod-log colors and kind badges
  // draw from the same set; values resolve per appearance mode.
  const podColors = useMemo(() => {
    const styles = getComputedStyle(document.documentElement);
    const palette = Array.from({ length: 24 }, (_, i) =>
      styles.getPropertyValue(`--hash-color-${i + 1}`).trim()
    );
    const fallbackColor = styles.getPropertyValue('--hash-color-fallback').trim();
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
    }
  }, [isWorkload, logEntries, normalizedActivePods]);

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

    const initContainerOptions = containers
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

    const regularContainerOptions = containers
      .filter(
        (container) =>
          !isInitContainerDisplayName(container) && !isDebugContainerDisplayName(container)
      )
      .map((container) => ({
        value: toContainerFilterValue(getActualContainerName(container)),
        label: container.endsWith(' (debug)') ? container : getActualContainerName(container),
        group: 'Containers',
      }))
      .sort((left, right) => left.label.localeCompare(right.label));

    const debugContainerOptions = containers
      .filter((container) => isDebugContainerDisplayName(container))
      .map((container) => ({
        value: toDebugContainerFilterValue(getActualContainerName(container)),
        label: container,
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
    options.push(...debugContainerOptions);

    return options;
  }, [containers, isWorkload, workloadPodsForSelector]);
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
    const chips: ActiveFilterChip[] = [];

    const trimmedTextFilter = textFilter.trim();
    if (trimmedTextFilter) {
      chips.push({
        key: 'text-filter',
        label:
          regexMatches && hasInvalidRegex
            ? `Regex: ${trimmedTextFilter} (invalid expression)`
            : regexMatches
              ? `Regex: ${trimmedTextFilter}`
              : `Text: ${trimmedTextFilter}`,
        removeLabel: 'Clear text filter',
        onRemove: () => dispatch({ type: 'SET_TEXT_FILTER', payload: '' }),
      });
    }

    if (showPreviousContainerLogs) {
      chips.push({
        key: 'previous-logs',
        label: 'Showing previous logs',
        removeLabel: 'Return to live logs',
        onRemove: () => {
          dispatch({ type: 'STOP_PREVIOUS_LOGS' });
          hasPrimedScopeRef.current = false;
        },
      });
    }

    selectedFilterValues.forEach((filterValue) => {
      const label =
        logFilterSelectionLabel(filterValue) ??
        formatSelectedFilterLabel(filterValue, selectorOptionLabelsByValue);
      chips.push({
        key: `selected-filter:${filterValue}`,
        label,
        removeLabel: `Remove filter ${label}`,
        onRemove: () =>
          dispatch({
            type: 'SET_SELECTED_FILTERS',
            payload: (() => {
              const values = selectedFilterValues.filter((value) => value !== filterValue);
              return values.length > 0 ? { mode: 'some' as const, values } : ALL_MULTISELECT_FILTER;
            })(),
          }),
      });
    });

    if (highlightMatches) {
      chips.push({
        key: 'highlight',
        label: 'Highlight',
        removeLabel: 'Disable highlight matches',
        onRemove: () => dispatch({ type: 'TOGGLE_HIGHLIGHT_MATCHES' }),
      });
    }

    if (inverseMatches) {
      chips.push({
        key: 'invert',
        label: 'Invert',
        removeLabel: 'Disable invert filter',
        onRemove: () => dispatch({ type: 'TOGGLE_INVERSE_MATCHES' }),
      });
    }

    if (caseSensitiveMatches) {
      chips.push({
        key: 'case-sensitive',
        label: 'Match case',
        removeLabel: 'Disable case-sensitive matching',
        onRemove: () => dispatch({ type: 'TOGGLE_CASE_SENSITIVE_MATCHES' }),
      });
    }

    if (regexMatches && !trimmedTextFilter) {
      chips.push({
        key: 'regex',
        label: 'Regex',
        removeLabel: 'Disable regex matching',
        onRemove: () => dispatch({ type: 'TOGGLE_REGEX_MATCHES' }),
      });
    }

    return chips;
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
      hasPrimedScopeRef.current = false;
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
    if (selectedFilters.mode !== 'some') {
      return;
    }
    const hasSelectedContainerFilters = selectedFilters.values.some(
      (filterValue) =>
        filterValue.startsWith(INIT_FILTER_PREFIX) ||
        filterValue.startsWith(CONTAINER_FILTER_PREFIX)
    );
    if (hasSelectedContainerFilters && containers.length === 0) {
      return;
    }
    const validFilterValues = new Set(
      selectorOptions.filter((option) => option.group !== 'header').map((option) => option.value)
    );
    if (validFilterValues.size === 0) {
      return;
    }
    const nextSelection = pruneLogFilterSelectionToOptions(selectedFilters, selectorOptions);
    if (nextSelection !== selectedFilters) {
      dispatch({ type: 'SET_SELECTED_FILTERS', payload: nextSelection });
    }
  }, [containers.length, selectedFilters, selectorOptions]);

  // Helper functions
  const unavailableLogMessage =
    filteredEntries.length === 0
      ? (logWarnings.find(
          (warning) =>
            warning === getLogDataUnavailableMessage(false) ||
            warning === getLogDataUnavailableMessage(true)
        ) ?? null)
      : null;
  const logEmptyState = useMemo<LogEmptyState>(() => {
    if (isPendingLogs || filteredEntries.length > 0) {
      return 'none';
    }
    if (unavailableLogMessage) {
      return 'unavailable';
    }
    if (showPreviousContainerLogs) {
      return 'no_previous_logs';
    }
    if (
      (textFilter.trim().length > 0 || isNarrowingFilterSelection(selectedFilters)) &&
      logEntries.length > 0
    ) {
      return 'no_filter_matches';
    }
    return 'no_logs_yet';
  }, [
    filteredEntries.length,
    isPendingLogs,
    logEntries.length,
    selectedFilters,
    showPreviousContainerLogs,
    textFilter,
    unavailableLogMessage,
  ]);
  const emptyStateMessage = useMemo(() => {
    switch (logEmptyState) {
      case 'unavailable':
        return unavailableLogMessage ?? 'Logs are unavailable right now';
      case 'no_previous_logs':
        return 'No previous logs found';
      case 'no_filter_matches':
        return 'No logs match the current filters';
      case 'no_logs_yet':
        return 'No logs yet';
      default:
        return '';
    }
  }, [logEmptyState, unavailableLogMessage]);
  const shouldShowPausedLogsEmptyState =
    logsLoadingState.suppressPassiveLoading &&
    logEmptyState === 'no_logs_yet' &&
    logEntries.length === 0 &&
    !showPreviousContainerLogs;

  const displayLines = useMemo(() => {
    if (filteredEntries.length === 0) {
      if (isPendingLogs) {
        return [] as string[];
      }
      return emptyStateMessage ? [emptyStateMessage] : [];
    }

    return filteredEntries.map((entry) => {
      const lineContent = formatRawOrPrettyJsonLine(entry.line, displayMode, showAnsiColors);
      const displayContent =
        lineContent.trim().length > 0 ? lineContent : EMPTY_CONTAINER_LOG_PLACEHOLDER;
      const timestamp = formatTimestampForMode(
        entry.timestamp ?? '',
        timestampMode,
        apiTimestampFormat,
        apiTimestampUseLocalTimeZone
      );
      const timestampPrefix = timestamp ? `[${timestamp}] ` : '';

      if (isWorkload) {
        const containerLabel = formatContainerLabel(
          entry.container,
          entry.isInit,
          Boolean(entry.isEphemeral)
        );
        const formatted = `[${entry.pod}/${containerLabel}] ${displayContent}`;
        return timestampPrefix + formatted;
      }

      if (
        selectedContainerFilterCount !== 1 &&
        !(selectedContainerFilterCount === 0 && singlePodSelectableContainerCount === 1)
      ) {
        const containerLabel = formatContainerLabel(
          entry.container,
          entry.isInit,
          Boolean(entry.isEphemeral)
        );
        const formatted = `[${containerLabel}] ${displayContent}`;
        return timestampPrefix + formatted;
      }

      return timestampPrefix + displayContent;
    });
  }, [
    displayMode,
    filteredEntries,
    isPendingLogs,
    isWorkload,
    singlePodSelectableContainerCount,
    showAnsiColors,
    selectedContainerFilterCount,
    timestampMode,
    apiTimestampFormat,
    apiTimestampUseLocalTimeZone,
    emptyStateMessage,
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

  const hasCopyableContent = isParsedView
    ? parsedContainerLogs.length > 0
    : filteredEntries.length > 0;
  const hasAnsiLogEntries = useMemo(
    () => rawLogEntries.some((entry) => containsAnsi(entry.line)),
    [rawLogEntries]
  );
  const hasActiveResultFilter =
    isNarrowingFilterSelection(selectedFilters) || textFilter.trim().length > 0;
  const displayedLogCount = filteredEntries.length;
  const countLabel = `${displayedLogCount} matching log${
    displayedLogCount === 1 ? '' : 's'
  } in current buffer`;
  const countTitle = `${countLabel}. Filtering and copy actions apply only to the current log buffer.`;

  useEffect(() => {
    if (displayMode !== 'raw' && !canParseContainerLogs) {
      dispatch({ type: 'SET_DISPLAY_MODE', payload: 'raw' });
    }
  }, [canParseContainerLogs, displayMode]);

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
          <mark key={`${keyPrefix}-${matchIndex}-${index}`} className="log-viewer-highlight">
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

      const segments = parseAnsiTextSegments(text, terminalTheme);
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
    [renderHighlightedMessage, showAnsiColors, terminalTheme]
  );

  const renderRawLogRow = useCallback(
    (row: RenderedLogRow) => {
      const line = row.line;

      if (isWorkload && line.includes('[') && line.includes('/')) {
        const match = line.match(WORKLOAD_RAW_LOG_PREFIX_PATTERN);
        if (match) {
          const [, timestamp = '', pod, container, logLine] = match;
          const podColor = podColors[pod] || podColors.__fallback__;

          return (
            <div className="log-viewer-line">
              {!!timestamp && (
                <span
                  className="log-viewer-metadata pod-color-text"
                  style={{ '--pod-color': podColor } as React.CSSProperties}
                >
                  {timestamp}
                </span>
              )}
              <span
                className="log-viewer-metadata log-viewer-metadata--bold"
                style={{ '--pod-color': podColor } as React.CSSProperties}
              >
                [
                <button
                  type="button"
                  className="log-viewer-metadata-button pod-color-text"
                  style={{ '--pod-color': podColor } as React.CSSProperties}
                  onClick={() => handleSelectPodFilter(pod)}
                  title={`Show only logs from pod ${pod}`}
                  aria-label={`Show only logs from pod ${pod}`}
                >
                  {pod}
                </button>
                /
                <button
                  type="button"
                  className="log-viewer-metadata-button pod-color-text"
                  style={{ '--pod-color': podColor } as React.CSSProperties}
                  onClick={() =>
                    (() => {
                      const parsedContainerLabel = parseContainerLabel(container);
                      handleSelectContainerFilter(
                        parsedContainerLabel.name,
                        parsedContainerLabel.isInit,
                        parsedContainerLabel.isEphemeral
                      );
                    })()
                  }
                  title={`Show only logs from container ${container}`}
                  aria-label={`Show only logs from container ${container}`}
                >
                  {container}
                </button>
                ]
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
          const containerLabel = showContainerMeta && containerMatch ? containerMatch[1] : '';
          const remainder = showContainerMeta && containerMatch ? containerMatch[2] : workingLine;
          return (
            <div className="log-viewer-line">
              {!!timestampPrefix && <span className="log-viewer-metadata">{timestampPrefix}</span>}
              {!!showContainerMeta && (
                <span className="log-viewer-metadata">
                  [
                  <button
                    type="button"
                    className="log-viewer-metadata-button"
                    onClick={() =>
                      (() => {
                        const parsedContainerLabel = parseContainerLabel(containerLabel);
                        handleSelectContainerFilter(
                          parsedContainerLabel.name,
                          parsedContainerLabel.isInit,
                          parsedContainerLabel.isEphemeral
                        );
                      })()
                    }
                    title={`Show only logs from container ${containerLabel}`}
                    aria-label={`Show only logs from container ${containerLabel}`}
                  >
                    {containerLabel}
                  </button>
                  ]
                </span>
              )}
              <span> {renderMessageContent(remainder, `pod-${row.key}`)}</span>
            </div>
          );
        }
      }

      return <div className="log-viewer-line">{renderMessageContent(line, `line-${row.key}`)}</div>;
    },
    [
      handleSelectContainerFilter,
      handleSelectPodFilter,
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
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(
      () => dispatch({ type: 'SET_COPY_FEEDBACK', payload: 'idle' }),
      750
    );
  }, []);

  // Clean up copy timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  // Fetch container inventory for the current log scope.
  useEffect(() => {
    if (!containerLogsScope) {
      dispatch({ type: 'SET_CONTAINERS', payload: [] });
      dispatch({ type: 'SET_SELECTED_CONTAINER', payload: '' });
      return;
    }

    let isCancelled = false;
    const fetchContainers = async () => {
      try {
        const result = await requestData({
          resource: 'log-scope-containers',
          reason: 'startup',
          adapter: 'rpc-read',
          label: 'Log Scope Containers',
          scope: containerLogsScope,
          read: () => readContainerLogsScopeContainers(resolvedClusterId, containerLogsScope),
        });
        const containerList = result.status === 'executed' ? (result.data ?? []) : [];

        if (isCancelled) {
          return;
        }

        if (!containerList || containerList.length === 0) {
          dispatch({ type: 'SET_CONTAINERS', payload: [] });
          dispatch({ type: 'SET_SELECTED_CONTAINER', payload: isWorkload ? '' : ALL_CONTAINERS });
          return;
        }

        dispatch({ type: 'SET_CONTAINERS', payload: containerList });
        dispatch({ type: 'SET_SELECTED_CONTAINER', payload: isWorkload ? '' : ALL_CONTAINERS });
      } catch (err) {
        if (isCancelled) {
          return;
        }
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
  }, [isWorkload, containerLogsScope, resolvedClusterId]);

  const { resumeTailFollowing } = useLogScrollRestoration({
    rootRef: logsContentRef,
    isParsedView,
    rowCount: isParsedView ? parsedContainerLogs.length : logEntries.length,
    tailFollowSignal: displayLogs,
    cacheKey: panelId,
    getScrollTop: getLogViewerScrollTop,
    setScrollTop: setLogViewerScrollTop,
    onTailFollowingChange: setIsTailFollowing,
  });
  const handleResumeScrolling = useCallback(() => {
    if (!autoRefresh) {
      dispatch({ type: 'TOGGLE_AUTO_REFRESH' });
    }
    resumeTailFollowing();
  }, [autoRefresh, resumeTailFollowing]);

  const derivedFieldKeys = useMemo(
    () => deriveParsedLogFieldKeys(parsedContainerLogs),
    [parsedContainerLogs]
  );

  const tableColumns = useMemo(() => {
    if (derivedFieldKeys.length === 0) {
      return [];
    }

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
        autoSizeMaxWidth: PARSED_TIMESTAMP_AUTOSIZE_MAX_WIDTH,
        render: (item: ParsedLogEntry) => {
          const formatted = item.timestamp
            ? formatTimestampForMode(
                item.timestamp,
                timestampMode,
                apiTimestampFormat,
                apiTimestampUseLocalTimeZone
              )
            : '-';
          if (!isWorkload) {
            return formatted;
          }
          return (
            <span
              className="pod-color-text"
              style={
                {
                  '--pod-color': podColors[item.pod || ''] || podColors.__fallback__,
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
        autoSizeMaxWidth: PARSED_METADATA_AUTOSIZE_MAX_WIDTH,
        render: (item: ParsedLogEntry) => {
          const pod = item.pod;
          return pod ? (
            <button
              type="button"
              className="log-viewer-metadata-button pod-color-text"
              style={
                {
                  '--pod-color': podColors[pod] || podColors.__fallback__,
                } as React.CSSProperties
              }
              onClick={(event) => {
                event.stopPropagation();
                handleSelectPodFilter(pod);
              }}
              title={`Show only logs from pod ${pod}`}
              aria-label={`Show only logs from pod ${pod}`}
            >
              {pod}
            </button>
          ) : (
            '-'
          );
        },
      });
    }

    columns.push({
      key: '_container',
      header: 'Container',
      sortable: false,
      minWidth: PARSED_POD_COLUMN_MIN_WIDTH,
      autoSizeMaxWidth: PARSED_METADATA_AUTOSIZE_MAX_WIDTH,
      render: (item: ParsedLogEntry) => {
        const container = item.container;
        return container ? (
          <button
            type="button"
            className="log-viewer-metadata-button pod-color-text"
            style={
              {
                '--pod-color': podColors[item.pod || ''] || podColors.__fallback__,
              } as React.CSSProperties
            }
            onClick={(event) => {
              event.stopPropagation();
              handleSelectContainerFilter(
                container,
                Boolean(item.isInit),
                Boolean(item.isEphemeral)
              );
            }}
            title={`Show only logs from container ${formatContainerLabel(container, Boolean(item.isInit), Boolean(item.isEphemeral))}`}
            aria-label={`Show only logs from container ${formatContainerLabel(container, Boolean(item.isInit), Boolean(item.isEphemeral))}`}
          >
            {container}
          </button>
        ) : (
          '-'
        );
      },
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
        autoSizeMaxWidth: PARSED_TIMESTAMP_AUTOSIZE_MAX_WIDTH,
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
        autoSizeMaxWidth: PARSED_COLUMN_AUTOSIZE_MAX_WIDTH,
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
        autoSizeMaxWidth: PARSED_COLUMN_AUTOSIZE_MAX_WIDTH,
        render: (item: ParsedLogEntry) => (
          <div className="parsed-log-cell">{formatParsedValue(item.data[key])}</div>
        ),
      });
    });

    return columns;
  }, [
    derivedFieldKeys,
    handleSelectContainerFilter,
    handleSelectPodFilter,
    isWorkload,
    podColors,
    timestampMode,
    apiTimestampFormat,
    apiTimestampUseLocalTimeZone,
  ]);

  const parsedCsv = useMemo(() => {
    if (!isParsedView || parsedContainerLogs.length === 0 || tableColumns.length === 0) {
      return '';
    }

    const getParsedColumnValue = (entry: ParsedLogEntry, key: string): string => {
      switch (key) {
        case '_timestamp':
          return entry.timestamp
            ? formatTimestampForMode(
                entry.timestamp,
                timestampMode,
                apiTimestampFormat,
                apiTimestampUseLocalTimeZone
              )
            : '-';
        case '_pod':
          return entry.pod || '-';
        case '_container':
          return entry.container || '-';
        default:
          return formatParsedValue(entry.data[key]);
      }
    };

    const headerRow = tableColumns.map((column) =>
      typeof column.header === 'string' ? column.header : column.key
    );
    const dataRows = parsedContainerLogs.map((entry) =>
      tableColumns.map((column) => getParsedColumnValue(entry, column.key))
    );

    return buildCsv([headerRow, ...dataRows]);
  }, [
    apiTimestampFormat,
    apiTimestampUseLocalTimeZone,
    isParsedView,
    parsedContainerLogs,
    tableColumns,
    timestampMode,
  ]);

  const handleCopyContainerLogs = useCallback(async () => {
    const text = displayMode === 'parsed' ? parsedCsv : displayLogs;
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
  }, [displayLogs, displayMode, parsedCsv, scheduleCopyReset]);

  useKeyboardSurface({
    kind: 'editor',
    rootRef: logsContentRef,
    active: isActive,
    captureWhenActive: true,
    onNativeAction: ({ action, selection }) => {
      if (action === 'copy') {
        const text = getSelectedTextWithinRoot(selection, logsContentRef.current);
        if (!text) {
          return false;
        }
        void navigator.clipboard.writeText(text).catch((err) => {
          console.error('Failed to copy selected log text', err);
        });
        return true;
      }
      if (action === 'selectAll') {
        return selectAllTextWithinRoot(selection, logsContentRef.current);
      }
      return false;
    },
  });

  // Keyboard shortcuts for Logs tab
  useLogKeyboardShortcuts({
    isActive,
    isParsedView,
    displayMode,
    showTimestamps,
    regexMatches,
    hasAnsiLogEntries,
    hasCopyableContent,
    dispatch,
    supportsPreviousContainerLogs,
    canParseContainerLogs,
    handleTogglePreviousContainerLogs,
    handleCopyContainerLogs,
    filterInputRef,
    logsContentRef,
  });

  const handleToggleParsedRow = useCallback((rowKey: string) => {
    dispatch({ type: 'TOGGLE_ROW_EXPANSION', payload: rowKey });
  }, []);

  // Loading state
  if (logsLoadingState.loading) {
    return (
      <div className="object-panel-tab-content">
        <LoadingSpinner message="Loading logs..." />
      </div>
    );
  }

  if (showPausedLogsState || shouldShowPausedLogsEmptyState) {
    return (
      <div className="object-panel-tab-content">
        <div className="logs-viewer-display-empty">
          <ClusterDataPausedState />
        </div>
      </div>
    );
  }

  // Error state
  if (!pendingFallback && displayError && logEntries.length === 0) {
    return (
      <div className="object-panel-tab-content">
        <div className="logs-viewer-display-error">
          <div className="error-message">Error: {displayError}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="object-panel-tab-content">
        <div className="logs-viewer-display">
          <div
            className={`logs-viewer-controls${activeFilterChips.length > 0 ? ' logs-viewer-controls--with-active-filters' : ''}`}
          >
            <div className="logs-viewer-controls-left">
              {/* Pod / container selector */}
              {selectorOptions.length > 0 && (
                <div className="logs-viewer-control-group">
                  <Dropdown
                    options={selectorOptions}
                    value={logFilterSelectionToDropdownValues(selectedFilters, selectorOptions)}
                    onChange={(value) =>
                      dispatch({
                        type: 'SET_SELECTED_FILTERS',
                        payload: logFilterSelectionFromDropdownValues(
                          Array.isArray(value) ? value : value ? [value] : [],
                          selectorOptions
                        ),
                      })
                    }
                    multiple
                    showBulkActions
                    placeholder={isPendingLogs ? 'Loading logs…' : 'All Logs'}
                    renderValue={(value, options) =>
                      summarizeWorkloadSelection(
                        Array.isArray(value) ? value : value ? [value] : [],
                        options
                      )
                    }
                    size="compact"
                    className="logs-viewer-selector-dropdown"
                  />
                </div>
              )}

              {/* Text filter input */}
              <div className="logs-viewer-control-group logs-viewer-filter-group">
                <div className="logs-viewer-filter-group">
                  <input
                    type="text"
                    ref={filterInputRef}
                    value={textFilter}
                    onChange={(e) => dispatch({ type: 'SET_TEXT_FILTER', payload: e.target.value })}
                    placeholder="Filter logs..."
                    className="logs-viewer-text-filter"
                    title="Filter logs by text (searches in log lines, pods, and containers)"
                  />
                  {!!textFilter && (
                    <button
                      type="button"
                      className="logs-viewer-filter-clear"
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
                      icon: <HighlightSearchIcon width={16} height={16} />,
                      active: highlightMatches,
                      onClick: () => dispatch({ type: 'TOGGLE_HIGHLIGHT_MATCHES' }),
                      title: 'Highlight matching text - disabled when Invert is enabled (H)',
                      ariaLabel: 'Highlight matching text - disabled when Invert is enabled',
                      disabled: inverseMatches,
                    },
                    {
                      type: 'toggle',
                      id: 'inverseSearch',
                      icon: <InverseSearchIcon width={18} height={18} />,
                      active: inverseMatches,
                      onClick: () => dispatch({ type: 'TOGGLE_INVERSE_MATCHES' }),
                      title: 'Invert the text filter to show only non-matching logs (I)',
                      ariaLabel: 'Invert the text filter to show only non-matching logs',
                    },
                    {
                      type: 'toggle',
                      id: 'caseSensitiveSearch',
                      icon: <CaseSensitiveIcon width={18} height={18} />,
                      active: caseSensitiveMatches,
                      onClick: () => dispatch({ type: 'TOGGLE_CASE_SENSITIVE_MATCHES' }),
                      title: 'Case-sensitive search - disabled when regex is enabled (C)',
                      ariaLabel: 'Case-sensitive search - disabled when regex is enabled',
                      disabled: regexMatches,
                    },
                    {
                      type: 'toggle',
                      id: 'regexSearch',
                      icon: <RegexSearchIcon width={16} height={16} />,
                      active: regexMatches,
                      onClick: () => dispatch({ type: 'TOGGLE_REGEX_MATCHES' }),
                      title: 'Enable regular expression support for the text filter (X)',
                      ariaLabel: 'Enable regular expression support for the text filter',
                    },
                    { type: 'separator' },
                    {
                      type: 'toggle',
                      id: 'autoRefresh',
                      icon: <AutoRefreshIcon width={18} height={18} />,
                      active: autoRefresh,
                      onClick: () => dispatch({ type: 'TOGGLE_AUTO_REFRESH' }),
                      title: 'Toggle auto-refresh (R)',
                      ariaLabel: 'Toggle auto-refresh',
                    },
                    ...(supportsPreviousContainerLogs
                      ? [
                          {
                            type: 'toggle' as const,
                            id: 'previousLogs',
                            icon: <PreviousLogsIcon width={18} height={18} />,
                            active: showPreviousContainerLogs,
                            onClick: handleTogglePreviousContainerLogs,
                            title: 'Show previous logs (V)',
                            ariaLabel: 'Show previous logs (V)',
                          },
                        ]
                      : []),
                    {
                      type: 'toggle',
                      id: 'apiTimestamps',
                      icon: <TimestampIcon width={18} height={18} />,
                      active: showTimestamps,
                      onClick: () =>
                        dispatch({
                          type: 'SET_TIMESTAMP_MODE',
                          payload: showTimestamps ? 'hidden' : 'default',
                        }),
                      title: 'Show timestamps from the Kubernetes API (T)',
                      ariaLabel: 'Show timestamps from the Kubernetes API',
                    },
                    {
                      type: 'toggle',
                      id: 'wrapText',
                      icon: <WrapTextIcon width={20} height={20} />,
                      active: wrapText,
                      onClick: () => dispatch({ type: 'TOGGLE_WRAP_TEXT' }),
                      title: 'Wrap text (W)',
                      ariaLabel: 'Wrap text',
                      disabled: isParsedView,
                    },
                    ...(hasAnsiLogEntries
                      ? [
                          {
                            type: 'toggle' as const,
                            id: 'ansiColors',
                            icon: <AnsiColorIcon width={20} height={20} />,
                            active: showAnsiColors,
                            onClick: () => dispatch({ type: 'TOGGLE_SHOW_ANSI_COLORS' }),
                            title: 'Show ANSI colors if present (O)',
                            ariaLabel: 'Show ANSI colors if present',
                            disabled: isParsedView,
                          },
                        ]
                      : []),
                    ...(canParseContainerLogs
                      ? [
                          {
                            type: 'toggle' as const,
                            id: 'prettyJson',
                            icon: <PrettyJsonIcon width={18} height={18} />,
                            active: displayMode === 'pretty',
                            onClick: () =>
                              dispatch({
                                type: 'SET_DISPLAY_MODE',
                                payload: displayMode === 'pretty' ? 'raw' : 'pretty',
                              }),
                            title: 'Show pretty JSON (J)',
                            ariaLabel: 'Show pretty JSON',
                          },
                          {
                            type: 'toggle' as const,
                            id: 'parsedJson',
                            icon: <ParseJsonIcon width={16} height={16} />,
                            active: displayMode === 'parsed',
                            onClick: () =>
                              dispatch({
                                type: 'SET_DISPLAY_MODE',
                                payload: displayMode === 'parsed' ? 'raw' : 'parsed',
                              }),
                            title: 'Parse the JSON into a table (P)',
                            ariaLabel: 'Parse the JSON into a table',
                          },
                        ]
                      : []),
                    { type: 'separator' },
                    {
                      type: 'action',
                      id: 'logSettings',
                      icon: <SettingsIcon width={18} height={18} />,
                      onClick: () => setIsObjPanelLogsSettingsOpen(true),
                      title: 'Open log settings',
                      ariaLabel: 'Open log settings',
                    },
                    {
                      type: 'action',
                      id: 'copy',
                      icon: <CopyIcon width={18} height={18} />,
                      onClick: handleCopyContainerLogs,
                      title: 'Copy current log buffer to clipboard (Shift+C)',
                      ariaLabel: 'Copy to clipboard',
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

              {!!hasActiveResultFilter && (
                <span className="logs-viewer-count" title={countTitle}>
                  {countLabel}
                </span>
              )}
            </div>
          </div>

          <ActiveFilterChips
            ariaLabel="Active log filters"
            chips={activeFilterChips}
            onClearAll={handleClearAllFilters}
            className="logs-viewer-active-filters"
          />

          {visibleLogWarnings.length > 0 && (
            <div className="logs-viewer-warning-bar" role="status" aria-label="Log warnings">
              {visibleLogWarnings.join(' ')}
            </div>
          )}

          <div className="logs-viewer-content-frame">
            <div className="logs-viewer-content selectable" ref={logsContentRef} tabIndex={-1}>
              {isParsedView ? (
                <ParsedLogTable
                  rows={parsedContainerLogs}
                  columns={tableColumns}
                  expandedRows={expandedRows}
                  onToggleRow={handleToggleParsedRow}
                />
              ) : displayLogs ? (
                <RawLogViewer
                  rows={renderedDisplayRows}
                  scrollContainerRef={logsContentRef}
                  wrapText={wrapText}
                  renderRow={renderRawLogRow}
                  virtualizationThreshold={RAW_LOG_VIRTUALIZATION_THRESHOLD}
                  virtualizationOverscan={RAW_LOG_VIRTUALIZATION_OVERSCAN}
                  estimateRowHeight={RAW_LOG_ESTIMATE_ROW_HEIGHT}
                  verticalPaddingPx={RAW_LOG_VERTICAL_PADDING_PX}
                />
              ) : (
                emptyStateMessage
              )}
            </div>
            {!isTailFollowing && (
              <button
                type="button"
                className="logs-viewer-resume-scrolling"
                aria-label="Resume scrolling"
                onClick={handleResumeScrolling}
              >
                Resume scrolling
              </button>
            )}
          </div>
        </div>
      </div>
      <ObjPanelLogsSettingsModal
        isOpen={isObjPanelLogsSettingsOpen}
        onClose={() => setIsObjPanelLogsSettingsOpen(false)}
      />
    </>
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
