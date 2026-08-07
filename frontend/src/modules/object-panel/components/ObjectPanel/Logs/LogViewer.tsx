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
import { normalizeDropdownValue } from '@shared/components/dropdowns/dropdownValue';
import {
  ALL_MULTISELECT_FILTER,
  filterSelectionValues,
  isNarrowingFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
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
import {
  type DomainSnapshotState,
  setScopedDomainState,
  useRefreshScopedDomain,
} from '@/core/refresh/store';
import type { ContainerLogsEntry, ContainerLogsSnapshotPayload } from '@/core/refresh/types';
import {
  getObjPanelLogsApiTimestampFormat,
  getObjPanelLogsApiTimestampUseLocalTimeZone,
  getObjPanelLogsBufferMaxSize,
} from '@/core/settings/appPreferences';
import { reportOperationalError } from '@/utils/errorHandler';
import {
  DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT,
  formatDefaultObjPanelLogsApiTimestamp,
  formatObjPanelLogsApiTimestamp,
} from '@/utils/objPanelLogsApiTimestampFormat';
import { INACTIVE_SCOPE } from '../constants';
import type { LogDisplayMode } from '../types';
import { containsAnsi } from './ansi';
import { setContainerLogsStreamScopeParams } from './containerLogsStreamScopeParamsCache';
import { useAnchoredLogEntries } from './hooks/useAnchoredLogEntries';
import { useLogMessageRenderer } from './hooks/useLogMessageRenderer';
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
import { parseBracketedLogPrefix } from './logLineMetadata';
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
  buildParsedLogDataColumns,
  PARSED_TIMESTAMP_AUTOSIZE_MAX_WIDTH,
  PARSED_TIMESTAMP_MIN_WIDTH,
} from './parsedLogColumns';
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
const PARSED_POD_COLUMN_MIN_WIDTH = 80;
const PARSED_METADATA_AUTOSIZE_MAX_WIDTH = 320;
const RAW_LOG_VIRTUALIZATION_THRESHOLD = 120;
const RAW_LOG_VIRTUALIZATION_OVERSCAN = 10;
const RAW_LOG_ESTIMATE_ROW_HEIGHT = 26;
const RAW_LOG_VERTICAL_PADDING_PX = 16;
const EMPTY_CONTAINER_LOG_ENTRIES: ContainerLogsEntry[] = [];

const formatShortTimestamp = (timestamp: string, useLocalTimeZone: boolean): string => {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return formatDefaultObjPanelLogsApiTimestamp(timestamp, useLocalTimeZone);
  }
  const hours = String(useLocalTimeZone ? parsed.getHours() : parsed.getUTCHours()).padStart(
    2,
    '0'
  );
  const minutes = String(useLocalTimeZone ? parsed.getMinutes() : parsed.getUTCMinutes()).padStart(
    2,
    '0'
  );
  const seconds = String(useLocalTimeZone ? parsed.getSeconds() : parsed.getUTCSeconds()).padStart(
    2,
    '0'
  );
  const millis = String(
    useLocalTimeZone ? parsed.getMilliseconds() : parsed.getUTCMilliseconds()
  ).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${millis}`;
};

const formatLocalizedTimestamp = (timestamp: string, useLocalTimeZone: boolean): string => {
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
};

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
    case 'short':
      return formatShortTimestamp(timestamp, useLocalTimeZone);
    case 'localized':
      return formatLocalizedTimestamp(timestamp, useLocalTimeZone);
    default:
      return formatObjPanelLogsApiTimestamp(
        timestamp,
        DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT,
        useLocalTimeZone
      );
  }
};

type LogContainerKind = 'regular' | 'init' | 'ephemeral';

interface LogContainerTraits {
  isInit?: boolean;
  isEphemeral?: boolean;
}

const logContainerKind = (traits: LogContainerTraits): LogContainerKind => {
  if (traits.isInit) {
    return 'init';
  }
  if (traits.isEphemeral) {
    return 'ephemeral';
  }
  return 'regular';
};

const CONTAINER_LABEL_SUFFIX: Record<LogContainerKind, string> = {
  regular: '',
  init: ':init',
  ephemeral: ' (debug)',
};

const formatContainerLabel = (container: string, kind: LogContainerKind): string =>
  `${container}${CONTAINER_LABEL_SUFFIX[kind]}`;

const parseContainerLabel = (label: string): { name: string; kind: LogContainerKind } => {
  if (label.endsWith(':init')) {
    return {
      name: label.slice(0, -':init'.length),
      kind: 'init',
    };
  }
  if (label.endsWith(' (debug)')) {
    return {
      name: label.slice(0, -' (debug)'.length),
      kind: 'ephemeral',
    };
  }
  return { name: label, kind: 'regular' };
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

const CONTAINER_FILTER_VALUE: Record<LogContainerKind, (container: string) => string> = {
  regular: toContainerFilterValue,
  init: toInitContainerFilterValue,
  ephemeral: toDebugContainerFilterValue,
};

const toContainerFilterValueForKind = (container: string, kind: LogContainerKind): string =>
  CONTAINER_FILTER_VALUE[kind](container);

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

type ContainerLogsSnapshotState = DomainSnapshotState<ContainerLogsSnapshotPayload>;

const buildContainerLogsSnapshotState = (
  previous: ContainerLogsSnapshotState,
  scope: string,
  entries: ContainerLogsEntry[],
  generatedAt: number,
  isManual: boolean,
  warnings: string[]
): ContainerLogsSnapshotState => {
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
      // sequence >= 2 means the initial log load completed even if the
      // payload is empty. Fallback/manual fetches honor the same contract.
      sequence: Math.max(previousPayload.sequence, 2),
      generatedAt,
      resetCount: previousPayload.resetCount + (isManual ? 1 : 0),
      error: null,
    },
    lastUpdated: generatedAt,
    lastManualRefresh: isManual ? generatedAt : previous.lastManualRefresh,
    lastAutoRefresh: isManual ? previous.lastAutoRefresh : generatedAt,
    isManual,
    scope,
  };
};

type BackendLogSelection = {
  container: string;
  includeInit: boolean;
  includeEphemeral: boolean;
  selectedFilters: string[];
  matchNone: boolean;
};

type ContainerLogsFetchOutcome =
  | { kind: 'blocked' }
  | { kind: 'loaded'; entries: ContainerLogsEntry[]; warnings: string[] }
  | { kind: 'unavailable'; warning: string }
  | { kind: 'error'; message: string };

const buildContainerLogsFetchRequest = (
  scope: string,
  selection: BackendLogSelection,
  previous: boolean
): types.ContainerLogsFetchRequest => ({
  scope,
  selectedFilters: selection.selectedFilters,
  matchNone: selection.matchNone,
  container: selection.container,
  includeInit: selection.includeInit,
  includeEphemeral: selection.includeEphemeral,
  previous,
  tailLines: getObjPanelLogsBufferMaxSize(),
  sinceSeconds: 0,
});

const mapFetchedContainerLogEntries = (
  entries: types.ContainerLogsEntry[] | null | undefined,
  nextSequence: () => number
): ContainerLogsEntry[] =>
  (entries ?? []).map((entry) => ({
    timestamp: entry.timestamp ?? '',
    pod: entry.pod ?? '',
    container: entry.container ?? '',
    line: entry.line ?? '',
    isInit: Boolean(entry.isInit),
    isEphemeral: Boolean(entry.isEphemeral),
    _seq: nextSequence(),
  }));

const normalizeContainerLogWarnings = (warnings: string[] | null | undefined): string[] =>
  (warnings ?? []).filter((warning): warning is string => typeof warning === 'string');

const requestFallbackContainerLogs = async ({
  clusterId,
  scope,
  selection,
  isManual,
  previous,
  nextSequence,
}: {
  clusterId: string;
  scope: string;
  selection: BackendLogSelection;
  isManual: boolean;
  previous: boolean;
  nextSequence: () => number;
}): Promise<ContainerLogsFetchOutcome> => {
  try {
    const request = buildContainerLogsFetchRequest(scope, selection, previous);
    const result = await requestData({
      resource: 'container-logs-fallback',
      reason: isManual ? 'user' : 'background',
      adapter: 'rpc-read',
      label: previous ? 'Previous Container Logs' : 'Container Logs Fallback',
      scope,
      read: () => readContainerLogs(clusterId, request),
    });
    if (result.status === 'blocked') {
      return { kind: 'blocked' };
    }
    if (result.data?.error) {
      throw new Error(result.data.error);
    }
    return {
      kind: 'loaded',
      entries: mapFetchedContainerLogEntries(result.data?.entries, nextSequence),
      warnings: normalizeContainerLogWarnings(result.data?.warnings),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isLogDataUnavailable(message)) {
      return { kind: 'unavailable', warning: getLogDataUnavailableMessage(previous) };
    }
    return { kind: 'error', message };
  }
};

const filterEntriesForActivePods = (
  entries: ContainerLogsEntry[],
  activePods: string[] | null,
  previousActivePods: string[] | null
): ContainerLogsEntry[] | null => {
  if (activePods === null) {
    return null;
  }
  if (previousActivePods === null && activePods.length === 0) {
    return null;
  }
  if (activePods.length === 0) {
    return entries.length > 0 ? [] : null;
  }
  const activePodSet = new Set(activePods);
  const visibleEntries = entries.filter((entry) => activePodSet.has(entry.pod));
  return visibleEntries.length === entries.length ? null : visibleEntries;
};

const buildActivePodSnapshotState = (
  previous: ContainerLogsSnapshotState,
  scope: string,
  entries: ContainerLogsEntry[],
  generatedAt: number
): ContainerLogsSnapshotState => {
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
      entries,
      generatedAt,
      resetCount: previousPayload.resetCount + 1,
    },
    lastUpdated: generatedAt,
    lastAutoRefresh: generatedAt,
    isManual: false,
    scope,
  };
};

type LogViewerAction = Parameters<typeof logViewerReducer>[1];

const buildTextFilterChip = (
  textFilter: string,
  regexMatches: boolean,
  hasInvalidRegex: boolean,
  dispatch: React.Dispatch<LogViewerAction>
): ActiveFilterChip | null => {
  const trimmedTextFilter = textFilter.trim();
  if (!trimmedTextFilter) {
    return null;
  }
  let label = `Text: ${trimmedTextFilter}`;
  if (regexMatches) {
    label = hasInvalidRegex
      ? `Regex: ${trimmedTextFilter} (invalid expression)`
      : `Regex: ${trimmedTextFilter}`;
  }
  return {
    key: 'text-filter',
    label,
    removeLabel: 'Clear text filter',
    onRemove: () => dispatch({ type: 'SET_TEXT_FILTER', payload: '' }),
  };
};

const removeSelectedFilterValue = (selectedValues: string[], filterValue: string) => {
  const values = selectedValues.filter((value) => value !== filterValue);
  return values.length > 0 ? { mode: 'some' as const, values } : ALL_MULTISELECT_FILTER;
};

const buildSelectedFilterChips = (
  selectedFilterValues: string[],
  optionsByValue: Map<string, string>,
  dispatch: React.Dispatch<LogViewerAction>
): ActiveFilterChip[] =>
  selectedFilterValues.map((filterValue) => {
    const label =
      logFilterSelectionLabel(filterValue) ??
      formatSelectedFilterLabel(filterValue, optionsByValue);
    return {
      key: `selected-filter:${filterValue}`,
      label,
      removeLabel: `Remove filter ${label}`,
      onRemove: () =>
        dispatch({
          type: 'SET_SELECTED_FILTERS',
          payload: removeSelectedFilterValue(selectedFilterValues, filterValue),
        }),
    };
  });

const optionalActiveFilterChip = (
  enabled: boolean,
  chip: ActiveFilterChip
): ActiveFilterChip | null => (enabled ? chip : null);

const buildActiveLogFilterChips = ({
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
  stopPreviousLogs,
}: {
  textFilter: string;
  regexMatches: boolean;
  hasInvalidRegex: boolean;
  showPreviousContainerLogs: boolean;
  selectedFilterValues: string[];
  selectorOptionLabelsByValue: Map<string, string>;
  highlightMatches: boolean;
  inverseMatches: boolean;
  caseSensitiveMatches: boolean;
  dispatch: React.Dispatch<LogViewerAction>;
  stopPreviousLogs: () => void;
}): ActiveFilterChip[] => {
  const chips = [
    buildTextFilterChip(textFilter, regexMatches, hasInvalidRegex, dispatch),
    optionalActiveFilterChip(showPreviousContainerLogs, {
      key: 'previous-logs',
      label: 'Showing previous logs',
      removeLabel: 'Return to live logs',
      onRemove: stopPreviousLogs,
    }),
    ...buildSelectedFilterChips(selectedFilterValues, selectorOptionLabelsByValue, dispatch),
    optionalActiveFilterChip(highlightMatches, {
      key: 'highlight',
      label: 'Highlight',
      removeLabel: 'Disable highlight matches',
      onRemove: () => dispatch({ type: 'TOGGLE_HIGHLIGHT_MATCHES' }),
    }),
    optionalActiveFilterChip(inverseMatches, {
      key: 'invert',
      label: 'Invert',
      removeLabel: 'Disable invert filter',
      onRemove: () => dispatch({ type: 'TOGGLE_INVERSE_MATCHES' }),
    }),
    optionalActiveFilterChip(caseSensitiveMatches, {
      key: 'case-sensitive',
      label: 'Match case',
      removeLabel: 'Disable case-sensitive matching',
      onRemove: () => dispatch({ type: 'TOGGLE_CASE_SENSITIVE_MATCHES' }),
    }),
    optionalActiveFilterChip(regexMatches && !textFilter.trim(), {
      key: 'regex',
      label: 'Regex',
      removeLabel: 'Disable regex matching',
      onRemove: () => dispatch({ type: 'TOGGLE_REGEX_MATCHES' }),
    }),
  ];
  return chips.filter((chip): chip is ActiveFilterChip => chip !== null);
};

const shouldDisplayPodContainerMetadata = (
  selectedContainerFilterCount: number,
  singlePodSelectableContainerCount: number
): boolean =>
  selectedContainerFilterCount !== 1 &&
  !(selectedContainerFilterCount === 0 && singlePodSelectableContainerCount === 1);

const formatContainerLogDisplayLine = ({
  entry,
  displayMode,
  showAnsiColors,
  timestampMode,
  apiTimestampFormat,
  apiTimestampUseLocalTimeZone,
  isWorkload,
  showContainerMetadata,
}: {
  entry: ContainerLogsEntry;
  displayMode: LogDisplayMode;
  showAnsiColors: boolean;
  timestampMode: 'hidden' | 'default' | 'short' | 'localized';
  apiTimestampFormat: string;
  apiTimestampUseLocalTimeZone: boolean;
  isWorkload: boolean;
  showContainerMetadata: boolean;
}): string => {
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
    const containerLabel = formatContainerLabel(entry.container, logContainerKind(entry));
    return `${timestampPrefix}[${entry.pod}/${containerLabel}] ${displayContent}`;
  }
  if (showContainerMetadata) {
    const containerLabel = formatContainerLabel(entry.container, logContainerKind(entry));
    return `${timestampPrefix}[${containerLabel}] ${displayContent}`;
  }
  return timestampPrefix + displayContent;
};

const buildContainerLogDisplayLines = ({
  entries,
  isPendingLogs,
  emptyStateMessage,
  ...formatOptions
}: {
  entries: ContainerLogsEntry[];
  isPendingLogs: boolean;
  emptyStateMessage: string;
  displayMode: LogDisplayMode;
  showAnsiColors: boolean;
  timestampMode: 'hidden' | 'default' | 'short' | 'localized';
  apiTimestampFormat: string;
  apiTimestampUseLocalTimeZone: boolean;
  isWorkload: boolean;
  showContainerMetadata: boolean;
}): string[] => {
  if (entries.length === 0) {
    if (isPendingLogs) {
      return [];
    }
    return emptyStateMessage ? [emptyStateMessage] : [];
  }
  return entries.map((entry) => formatContainerLogDisplayLine({ entry, ...formatOptions }));
};

type RenderLogMessage = (message: string, keyPrefix: string) => React.ReactNode;
type SelectContainerFilter = (container: string, kind: LogContainerKind) => void;

const selectContainerLabel = (label: string, selectContainer: SelectContainerFilter): void => {
  const parsedContainerLabel = parseContainerLabel(label);
  selectContainer(parsedContainerLabel.name, parsedContainerLabel.kind);
};

const renderWorkloadRawLogRow = ({
  row,
  podColors,
  selectPod,
  selectContainer,
  renderMessage,
}: {
  row: RenderedLogRow;
  podColors: Record<string, string>;
  selectPod: (pod: string) => void;
  selectContainer: SelectContainerFilter;
  renderMessage: RenderLogMessage;
}): React.ReactNode | null => {
  if (!row.line.includes('[') || !row.line.includes('/')) {
    return null;
  }
  const match = row.line.match(WORKLOAD_RAW_LOG_PREFIX_PATTERN);
  if (!match) {
    return null;
  }
  const [, timestamp = '', pod = '', container = '', logLine = ''] = match;
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
        {'['}
        <button
          type="button"
          className="log-viewer-metadata-button pod-color-text"
          style={{ '--pod-color': podColor } as React.CSSProperties}
          onClick={() => selectPod(pod)}
          title={`Show only logs from pod ${pod}`}
          aria-label={`Show only logs from pod ${pod}`}
        >
          {pod}
        </button>
        {'/'}
        <button
          type="button"
          className="log-viewer-metadata-button pod-color-text"
          style={{ '--pod-color': podColor } as React.CSSProperties}
          onClick={() => selectContainerLabel(container, selectContainer)}
          title={`Show only logs from container ${container}`}
          aria-label={`Show only logs from container ${container}`}
        >
          {container}
        </button>
        {']'}
      </span>
      <span> {renderMessage(logLine, `workload-${row.key}`)}</span>
    </div>
  );
};

const renderPodRawLogRow = ({
  row,
  showTimestamps,
  showContainerMetadata,
  selectContainer,
  renderMessage,
}: {
  row: RenderedLogRow;
  showTimestamps: boolean;
  showContainerMetadata: boolean;
  selectContainer: SelectContainerFilter;
  renderMessage: RenderLogMessage;
}): React.ReactNode | null => {
  let workingLine = row.line;
  let timestampPrefix = '';
  if (showTimestamps) {
    const timestampMetadata = parseBracketedLogPrefix(row.line);
    if (timestampMetadata) {
      timestampPrefix = timestampMetadata.prefix;
      workingLine = timestampMetadata.remainder;
    }
  }
  const containerMetadata = parseBracketedLogPrefix(workingLine);
  const hasContainerMetadata = Boolean(containerMetadata && showContainerMetadata);
  if (!timestampPrefix && !hasContainerMetadata) {
    return null;
  }
  const containerLabel = hasContainerMetadata && containerMetadata ? containerMetadata.label : '';
  const remainder =
    hasContainerMetadata && containerMetadata ? containerMetadata.remainder : workingLine;
  return (
    <div className="log-viewer-line">
      {!!timestampPrefix && <span className="log-viewer-metadata">{timestampPrefix}</span>}
      {hasContainerMetadata && (
        <span className="log-viewer-metadata">
          {'['}
          <button
            type="button"
            className="log-viewer-metadata-button"
            onClick={() => selectContainerLabel(containerLabel, selectContainer)}
            title={`Show only logs from container ${containerLabel}`}
            aria-label={`Show only logs from container ${containerLabel}`}
          >
            {containerLabel}
          </button>
          {']'}
        </span>
      )}
      <span> {renderMessage(remainder, `pod-${row.key}`)}</span>
    </div>
  );
};

const requestLogScopeContainers = async (clusterId: string, scope: string): Promise<string[]> => {
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

const applyLogScopeContainers = (
  dispatch: React.Dispatch<LogViewerAction>,
  containers: string[],
  isWorkload: boolean
): void => {
  dispatch({ type: 'SET_CONTAINERS', payload: containers });
  dispatch({ type: 'SET_SELECTED_CONTAINER', payload: isWorkload ? '' : ALL_CONTAINERS });
};

const getLogViewerCopyFeedback = (copyFeedback: string): 'success' | 'error' | null => {
  if (copyFeedback === 'copied') {
    return 'success';
  }
  return copyFeedback === 'error' ? 'error' : null;
};

const renderLogViewerContent = ({
  isParsedView,
  parsedContainerLogs,
  tableColumns,
  expandedRows,
  onToggleParsedRow,
  displayLogs,
  renderedDisplayRows,
  logsContentRef,
  wrapText,
  renderRawLogRow,
  emptyStateMessage,
}: {
  isParsedView: boolean;
  parsedContainerLogs: ParsedLogEntry[];
  tableColumns: GridColumnDefinition<ParsedLogEntry>[];
  expandedRows: Set<string>;
  onToggleParsedRow: (rowKey: string) => void;
  displayLogs: string;
  renderedDisplayRows: RenderedLogRow[];
  logsContentRef: React.RefObject<HTMLDivElement | null>;
  wrapText: boolean;
  renderRawLogRow: (row: RenderedLogRow) => React.ReactNode;
  emptyStateMessage: string;
}): React.ReactNode => {
  if (isParsedView) {
    return (
      <ParsedLogTable
        rows={parsedContainerLogs}
        columns={tableColumns}
        expandedRows={expandedRows}
        onToggleRow={onToggleParsedRow}
      />
    );
  }
  if (displayLogs) {
    return (
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
    );
  }
  return emptyStateMessage;
};

const LogViewerBlockingState = ({
  loading,
  paused,
  pendingFallback,
  displayError,
  hasEntries,
}: {
  loading: boolean;
  paused: boolean;
  pendingFallback: boolean;
  displayError: string | null;
  hasEntries: boolean;
}) => {
  if (loading) {
    return (
      <div className="object-panel-tab-content">
        <LoadingSpinner message="Loading logs..." />
      </div>
    );
  }
  if (paused) {
    return (
      <div className="object-panel-tab-content">
        <div className="logs-viewer-display-empty">
          <ClusterDataPausedState />
        </div>
      </div>
    );
  }
  if (!pendingFallback && displayError && !hasEntries) {
    return (
      <div className="object-panel-tab-content">
        <div className="logs-viewer-display-error">
          <div className="error-message">
            Error: <ErrorSurface kind="reported" message={displayError} />
          </div>
        </div>
      </div>
    );
  }
  return null;
};

const shouldShowLogViewerBlockingState = ({
  loading,
  paused,
  pendingFallback,
  displayError,
  hasEntries,
}: {
  loading: boolean;
  paused: boolean;
  pendingFallback: boolean;
  displayError: string | null;
  hasEntries: boolean;
}): boolean => loading || paused || (!pendingFallback && Boolean(displayError) && !hasEntries);

type LogViewerIconItemsOptions = {
  highlightMatches: boolean;
  inverseMatches: boolean;
  caseSensitiveMatches: boolean;
  regexMatches: boolean;
  autoRefresh: boolean;
  supportsPreviousContainerLogs: boolean;
  showPreviousContainerLogs: boolean;
  showTimestamps: boolean;
  wrapText: boolean;
  isParsedView: boolean;
  hasAnsiLogEntries: boolean;
  showAnsiColors: boolean;
  canParseContainerLogs: boolean;
  displayMode: LogDisplayMode;
  hasCopyableContent: boolean;
  copyIconFeedback: 'success' | 'error' | null;
  dispatch: React.Dispatch<LogViewerAction>;
  togglePreviousContainerLogs: () => void;
  openSettings: () => void;
  copyLogs: () => void;
};

const buildLogViewerIconItems = (options: LogViewerIconItemsOptions): IconBarItem[] => {
  const items: IconBarItem[] = [
    {
      type: 'toggle',
      id: 'highlightSearch',
      icon: <HighlightSearchIcon width={16} height={16} />,
      active: options.highlightMatches,
      onClick: () => options.dispatch({ type: 'TOGGLE_HIGHLIGHT_MATCHES' }),
      title: 'Highlight matching text - disabled when Invert is enabled (H)',
      ariaLabel: 'Highlight matching text - disabled when Invert is enabled',
      disabled: options.inverseMatches,
    },
    {
      type: 'toggle',
      id: 'inverseSearch',
      icon: <InverseSearchIcon width={18} height={18} />,
      active: options.inverseMatches,
      onClick: () => options.dispatch({ type: 'TOGGLE_INVERSE_MATCHES' }),
      title: 'Invert the text filter to show only non-matching logs (I)',
      ariaLabel: 'Invert the text filter to show only non-matching logs',
    },
    {
      type: 'toggle',
      id: 'caseSensitiveSearch',
      icon: <CaseSensitiveIcon width={18} height={18} />,
      active: options.caseSensitiveMatches,
      onClick: () => options.dispatch({ type: 'TOGGLE_CASE_SENSITIVE_MATCHES' }),
      title: 'Case-sensitive search - disabled when regex is enabled (C)',
      ariaLabel: 'Case-sensitive search - disabled when regex is enabled',
      disabled: options.regexMatches,
    },
    {
      type: 'toggle',
      id: 'regexSearch',
      icon: <RegexSearchIcon width={16} height={16} />,
      active: options.regexMatches,
      onClick: () => options.dispatch({ type: 'TOGGLE_REGEX_MATCHES' }),
      title: 'Enable regular expression support for the text filter (X)',
      ariaLabel: 'Enable regular expression support for the text filter',
    },
    { type: 'separator' },
    {
      type: 'toggle',
      id: 'autoRefresh',
      icon: <AutoRefreshIcon width={18} height={18} />,
      active: options.autoRefresh,
      onClick: () => options.dispatch({ type: 'TOGGLE_AUTO_REFRESH' }),
      title: 'Toggle auto-refresh (R)',
      ariaLabel: 'Toggle auto-refresh',
    },
  ];
  if (options.supportsPreviousContainerLogs) {
    items.push({
      type: 'toggle',
      id: 'previousLogs',
      icon: <PreviousLogsIcon width={18} height={18} />,
      active: options.showPreviousContainerLogs,
      onClick: options.togglePreviousContainerLogs,
      title: 'Show previous logs (V)',
      ariaLabel: 'Show previous logs (V)',
    });
  }
  items.push(
    {
      type: 'toggle',
      id: 'apiTimestamps',
      icon: <TimestampIcon width={18} height={18} />,
      active: options.showTimestamps,
      onClick: () =>
        options.dispatch({
          type: 'SET_TIMESTAMP_MODE',
          payload: options.showTimestamps ? 'hidden' : 'default',
        }),
      title: 'Show timestamps from the Kubernetes API (T)',
      ariaLabel: 'Show timestamps from the Kubernetes API',
    },
    {
      type: 'toggle',
      id: 'wrapText',
      icon: <WrapTextIcon width={20} height={20} />,
      active: options.wrapText,
      onClick: () => options.dispatch({ type: 'TOGGLE_WRAP_TEXT' }),
      title: 'Wrap text (W)',
      ariaLabel: 'Wrap text',
      disabled: options.isParsedView,
    }
  );
  if (options.hasAnsiLogEntries) {
    items.push({
      type: 'toggle',
      id: 'ansiColors',
      icon: <AnsiColorIcon width={20} height={20} />,
      active: options.showAnsiColors,
      onClick: () => options.dispatch({ type: 'TOGGLE_SHOW_ANSI_COLORS' }),
      title: 'Show ANSI colors if present (O)',
      ariaLabel: 'Show ANSI colors if present',
      disabled: options.isParsedView,
    });
  }
  if (options.canParseContainerLogs) {
    items.push(
      {
        type: 'toggle',
        id: 'prettyJson',
        icon: <PrettyJsonIcon width={18} height={18} />,
        active: options.displayMode === 'pretty',
        onClick: () =>
          options.dispatch({
            type: 'SET_DISPLAY_MODE',
            payload: options.displayMode === 'pretty' ? 'raw' : 'pretty',
          }),
        title: 'Show pretty JSON (J)',
        ariaLabel: 'Show pretty JSON',
      },
      {
        type: 'toggle',
        id: 'parsedJson',
        icon: <ParseJsonIcon width={16} height={16} />,
        active: options.displayMode === 'parsed',
        onClick: () =>
          options.dispatch({
            type: 'SET_DISPLAY_MODE',
            payload: options.displayMode === 'parsed' ? 'raw' : 'parsed',
          }),
        title: 'Parse the JSON into a table (P)',
        ariaLabel: 'Parse the JSON into a table',
      }
    );
  }
  items.push(
    { type: 'separator' },
    {
      type: 'action',
      id: 'logSettings',
      icon: <SettingsIcon width={18} height={18} />,
      onClick: options.openSettings,
      title: 'Open log settings',
      ariaLabel: 'Open log settings',
    },
    {
      type: 'action',
      id: 'copy',
      icon: <CopyIcon width={18} height={18} />,
      onClick: options.copyLogs,
      title: 'Copy current log buffer to clipboard (Shift+C)',
      ariaLabel: 'Copy to clipboard',
      disabled: !options.hasCopyableContent,
      feedback: options.copyIconFeedback,
    }
  );
  return items;
};

type LogViewerControlsProps = {
  activeFilterChips: ActiveFilterChip[];
  selectorOptions: DropdownOption[];
  selectedFilters: Parameters<typeof logFilterSelectionToDropdownValues>[0];
  isPendingLogs: boolean;
  filterInputRef: React.RefObject<HTMLInputElement | null>;
  textFilter: string;
  iconItems: IconBarItem[];
  hasActiveResultFilter: boolean;
  countTitle: string;
  countLabel: string;
  dispatch: React.Dispatch<LogViewerAction>;
};

const LogViewerControls = ({
  activeFilterChips,
  selectorOptions,
  selectedFilters,
  isPendingLogs,
  filterInputRef,
  textFilter,
  iconItems,
  hasActiveResultFilter,
  countTitle,
  countLabel,
  dispatch,
}: LogViewerControlsProps) => (
  <div
    className={`logs-viewer-controls${activeFilterChips.length > 0 ? ' logs-viewer-controls--with-active-filters' : ''}`}
  >
    <div className="logs-viewer-controls-left">
      {selectorOptions.length > 0 && (
        <div className="logs-viewer-control-group">
          <Dropdown
            options={selectorOptions}
            value={logFilterSelectionToDropdownValues(selectedFilters, selectorOptions)}
            onChange={(value) =>
              dispatch({
                type: 'SET_SELECTED_FILTERS',
                payload: logFilterSelectionFromDropdownValues(
                  normalizeDropdownValue(value),
                  selectorOptions
                ),
              })
            }
            multiple
            showBulkActions
            placeholder={isPendingLogs ? 'Loading logs…' : 'All Logs'}
            renderValue={(value, options) =>
              summarizeWorkloadSelection(normalizeDropdownValue(value), options)
            }
            size="compact"
            className="logs-viewer-selector-dropdown"
          />
        </div>
      )}
      <div className="logs-viewer-control-group logs-viewer-filter-group">
        <div className="logs-viewer-filter-group">
          <input
            type="text"
            ref={filterInputRef}
            value={textFilter}
            onChange={(event) => dispatch({ type: 'SET_TEXT_FILTER', payload: event.target.value })}
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
      <IconBar items={iconItems} />
      {!!hasActiveResultFilter && (
        <span className="logs-viewer-count" title={countTitle}>
          {countLabel}
        </span>
      )}
    </div>
  </div>
);

type LogViewerReadyViewProps = {
  controls: React.ReactNode;
  activeFilterChips: ActiveFilterChip[];
  clearAllFilters: () => void;
  visibleLogWarnings: string[];
  logsContentRef: React.RefObject<HTMLDivElement | null>;
  renderedLogContent: React.ReactNode;
  isTailFollowing: boolean;
  resumeScrolling: () => void;
  isSettingsOpen: boolean;
  closeSettings: () => void;
};

const LogViewerReadyView = ({
  controls,
  activeFilterChips,
  clearAllFilters,
  visibleLogWarnings,
  logsContentRef,
  renderedLogContent,
  isTailFollowing,
  resumeScrolling,
  isSettingsOpen,
  closeSettings,
}: LogViewerReadyViewProps) => (
  <>
    <div className="object-panel-tab-content">
      <div className="logs-viewer-display">
        {controls}
        <ActiveFilterChips
          ariaLabel="Active log filters"
          chips={activeFilterChips}
          onClearAll={clearAllFilters}
          className="logs-viewer-active-filters"
        />
        {visibleLogWarnings.length > 0 && (
          <div className="logs-viewer-warning-bar" role="status" aria-label="Log warnings">
            {visibleLogWarnings.join(' ')}
          </div>
        )}
        <div className="logs-viewer-content-frame">
          <div className="logs-viewer-content selectable" ref={logsContentRef} tabIndex={-1}>
            {renderedLogContent}
          </div>
          {!isTailFollowing && (
            <button
              type="button"
              className="logs-viewer-resume-scrolling"
              aria-label="Resume scrolling"
              onClick={resumeScrolling}
            >
              Resume scrolling
            </button>
          )}
        </div>
      </div>
    </div>
    <ObjPanelLogsSettingsModal isOpen={isSettingsOpen} onClose={closeSettings} />
  </>
);

const syncContainerLogsScope = ({
  scope,
  previousScopeRef,
  hasPrimedScopeRef,
  previousActivePodsRef,
  dispatch,
  isWorkload,
}: {
  scope: string | null;
  previousScopeRef: { current: string | null };
  hasPrimedScopeRef: { current: boolean };
  previousActivePodsRef: { current: string[] | null };
  dispatch: React.Dispatch<LogViewerAction>;
  isWorkload: boolean;
}): void => {
  if (scope === previousScopeRef.current) {
    return;
  }
  const hadPreviousScope = previousScopeRef.current !== null;
  previousScopeRef.current = scope;
  hasPrimedScopeRef.current = false;
  previousActivePodsRef.current = null;
  if (hadPreviousScope) {
    dispatch({ type: 'RESET_FOR_NEW_SCOPE', isWorkload });
  }
};

const getScopedContainerLogSnapshot = (
  snapshot: ContainerLogsSnapshotState,
  hasScope: boolean
) => ({
  entries: hasScope
    ? (snapshot.data?.entries ?? EMPTY_CONTAINER_LOG_ENTRIES)
    : EMPTY_CONTAINER_LOG_ENTRIES,
  status: hasScope ? snapshot.status : ('idle' as const),
  error: hasScope ? snapshot.error : null,
  sequence: hasScope ? (snapshot.data?.sequence ?? 0) : 0,
  warnings: (snapshot.stats?.warnings ?? []).filter(
    (warning) => typeof warning === 'string' && warning.trim().length > 0
  ),
});

const shouldFollowCurrentLogTail = (
  isParsedView: boolean,
  logsContent: HTMLDivElement | null,
  isTailFollowing: boolean
): boolean => {
  const activeScrollContainer = isParsedView
    ? logsContent?.querySelector<HTMLElement>('.gridtable-wrapper')
    : logsContent;
  return Boolean(
    isTailFollowing && (!activeScrollContainer || isLogScrollAtBottom(activeScrollContainer))
  );
};

const getContainerLogDisplayError = (snapshotError: string | null | undefined): string | null => {
  if (!snapshotError || isLogDataUnavailable(snapshotError)) {
    return null;
  }
  return snapshotError;
};

const isTransientContainerLogStreamError = (displayError: string | null): boolean => {
  if (!displayError) {
    return false;
  }
  const normalizedError = displayError.toLowerCase();
  return [
    'container logs stream connection lost',
    'container logs stream disconnected',
    'reconnecting',
    'failed to open container logs stream',
  ].some((term) => normalizedError.includes(term));
};

const shouldSuppressContainerLogError = ({
  fallbackActive,
  showPreviousContainerLogs,
  fallbackRecovering,
  transientStreamError,
  autoRefresh,
  snapshotStatus,
}: {
  fallbackActive: boolean;
  showPreviousContainerLogs: boolean;
  fallbackRecovering: boolean;
  transientStreamError: boolean;
  autoRefresh: boolean;
  snapshotStatus: string;
}): boolean =>
  fallbackActive ||
  showPreviousContainerLogs ||
  fallbackRecovering ||
  transientStreamError ||
  (autoRefresh && snapshotStatus === 'error');

const areContainerLogsPending = ({
  showPreviousContainerLogs,
  isLoadingPreviousContainerLogs,
  entryCount,
  hasReceivedInitialLogs,
  waitingForInitialPrime,
  snapshotStatus,
  fallbackActive,
  pendingFallback,
}: {
  showPreviousContainerLogs: boolean;
  isLoadingPreviousContainerLogs: boolean;
  entryCount: number;
  hasReceivedInitialLogs: boolean;
  waitingForInitialPrime: boolean;
  snapshotStatus: string;
  fallbackActive: boolean;
  pendingFallback: boolean;
}): boolean => {
  if (showPreviousContainerLogs) {
    return isLoadingPreviousContainerLogs && entryCount === 0;
  }
  return (
    entryCount === 0 &&
    (!hasReceivedInitialLogs ||
      waitingForInitialPrime ||
      ['loading', 'updating', 'initialising'].includes(snapshotStatus) ||
      fallbackActive ||
      pendingFallback)
  );
};

const findUnavailableLogMessage = (
  filteredEntryCount: number,
  warnings: string[]
): string | null => {
  if (filteredEntryCount > 0) {
    return null;
  }
  return (
    warnings.find(
      (warning) =>
        warning === getLogDataUnavailableMessage(false) ||
        warning === getLogDataUnavailableMessage(true)
    ) ?? null
  );
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

const getContainerLogCountLabel = (displayedLogCount: number): string => {
  const suffix = displayedLogCount === 1 ? '' : 's';
  return `${displayedLogCount} matching log${suffix} in current buffer`;
};

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

  // Keep this synchronous with render so a scope-reset re-render cannot
  // interrupt streaming startup.
  syncContainerLogsScope({
    scope: containerLogsScope,
    previousScopeRef: previousContainerLogsScopeRef,
    hasPrimedScopeRef,
    previousActivePodsRef,
    dispatch,
    isWorkload,
  });

  const logSnapshot = useRefreshScopedDomain(
    CONTAINER_LOGS_DOMAIN,
    containerLogsScope ?? INACTIVE_SCOPE
  );
  const scopedSnapshot = getScopedContainerLogSnapshot(logSnapshot, Boolean(containerLogsScope));
  const rawLogEntries = scopedSnapshot.entries;

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
  const shouldFollowTailForCurrentRender = shouldFollowCurrentLogTail(
    isParsedView,
    logsContentRef.current,
    isTailFollowing
  );
  const logEntries = useAnchoredLogEntries(
    rawLogEntries,
    shouldFollowTailForCurrentRender,
    anchoredLogSourceKey
  );
  const snapshotStatus = scopedSnapshot.status;
  const snapshotError = scopedSnapshot.error;
  // sequence 1 = connected event, sequence >= 2 = initial logs received (may be empty)
  const snapshotSequence = scopedSnapshot.sequence;
  const hasReceivedInitialLogs = snapshotSequence >= 2;
  const logWarnings = scopedSnapshot.warnings;
  const visibleLogWarnings = useMemo(
    () =>
      mergeTargetLimitWarnings(
        logWarnings.filter(
          (warning) => warning.includes('per-tab limit') || warning.includes('global limit')
        )
      ),
    [logWarnings]
  );

  const displayError = getContainerLogDisplayError(snapshotError);
  const transientStreamError = isTransientContainerLogStreamError(displayError);
  const shouldSuppressError = shouldSuppressContainerLogError({
    fallbackActive,
    showPreviousContainerLogs,
    fallbackRecovering: fallbackRecoveringRef.current,
    transientStreamError,
    autoRefresh,
    snapshotStatus,
  });
  const pendingFallback = shouldSuppressError;
  const waitingForInitialPrime = Boolean(
    !hasPrimedScopeRef.current && !displayError && !hasReceivedInitialLogs
  );

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

  const isPendingLogs = areContainerLogsPending({
    showPreviousContainerLogs,
    isLoadingPreviousContainerLogs,
    entryCount: logEntries.length,
    hasReceivedInitialLogs,
    waitingForInitialPrime,
    snapshotStatus,
    fallbackActive,
    pendingFallback,
  });
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
      setScopedDomainState(CONTAINER_LOGS_DOMAIN, containerLogsScope, (previous) =>
        buildContainerLogsSnapshotState(
          previous,
          containerLogsScope,
          entries,
          generatedAt,
          isManual,
          warnings
        )
      );
    },
    [containerLogsScope]
  );

  const fetchLogs = useCallback(
    async (options: { isManual?: boolean; previous?: boolean } = {}) => {
      if (!containerLogsScope) {
        return;
      }

      const { isManual = false, previous = false } = options;
      const outcome = await requestFallbackContainerLogs({
        clusterId: resolvedClusterId,
        scope: containerLogsScope,
        selection: backendLogSelection,
        isManual,
        previous,
        nextSequence: () => ++seqCounterRef.current,
      });
      if (outcome.kind === 'blocked') {
        return;
      }
      if (outcome.kind === 'error') {
        setScopedDomainState(CONTAINER_LOGS_DOMAIN, containerLogsScope, (previousState) => ({
          ...previousState,
          status: 'error',
          error: outcome.message,
          scope: containerLogsScope,
        }));
        return;
      }
      const generatedAt = Date.now();
      const entries = outcome.kind === 'loaded' ? outcome.entries : [];
      const warnings = outcome.kind === 'loaded' ? outcome.warnings : [outcome.warning];
      mapEntriesToSnapshot(entries, generatedAt, isManual, warnings);
      hasPrimedScopeRef.current = true;
    },
    [containerLogsScope, mapEntriesToSnapshot, backendLogSelection, resolvedClusterId]
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
          reportOperationalError(error, { source: 'LogViewer', action: 'reloadPreviousLogs' });
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
    const visibleEntries = filterEntriesForActivePods(
      logEntries,
      normalizedActivePods,
      previousActivePodsRef.current
    );
    previousActivePodsRef.current = normalizedActivePods;
    if (!visibleEntries) {
      return;
    }
    const generatedAt = Date.now();
    setScopedDomainState(CONTAINER_LOGS_DOMAIN, containerLogsScope, (previous) =>
      buildActivePodSnapshotState(previous, containerLogsScope, visibleEntries, generatedAt)
    );
    hasPrimedScopeRef.current = visibleEntries.length > 0;
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
        reportOperationalError(error, { source: 'LogViewer', action: 'loadPreviousLogs' });
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
      stopPreviousLogs: () => {
        dispatch({ type: 'STOP_PREVIOUS_LOGS' });
        hasPrimedScopeRef.current = false;
      },
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
  const unavailableLogMessage = findUnavailableLogMessage(filteredEntries.length, logWarnings);
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
  const shouldShowPausedLogsEmptyState = shouldShowPausedLogEmptyState({
    suppressPassiveLoading: logsLoadingState.suppressPassiveLoading,
    logEmptyState,
    entryCount: logEntries.length,
    showPreviousContainerLogs,
  });

  const displayLines = useMemo(() => {
    return buildContainerLogDisplayLines({
      entries: filteredEntries,
      isPendingLogs,
      emptyStateMessage,
      displayMode,
      showAnsiColors,
      timestampMode,
      apiTimestampFormat,
      apiTimestampUseLocalTimeZone,
      isWorkload,
      showContainerMetadata: shouldDisplayPodContainerMetadata(
        selectedContainerFilterCount,
        singlePodSelectableContainerCount
      ),
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

  const hasCopyableContent = hasCopyableContainerLogs(
    isParsedView,
    parsedContainerLogs.length,
    filteredEntries.length
  );
  const hasAnsiLogEntries = useMemo(
    () => rawLogEntries.some((entry) => containsAnsi(entry.line)),
    [rawLogEntries]
  );
  const hasActiveResultFilter = hasActiveLogResultFilter(selectedFilters, textFilter);
  const displayedLogCount = filteredEntries.length;
  const countLabel = getContainerLogCountLabel(displayedLogCount);
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

  const renderMessageContent = useLogMessageRenderer({
    highlightRegex,
    showAnsiColors,
    terminalTheme,
    plainSegmentWrapper: 'fragment',
  });

  const renderRawLogRow = useCallback(
    (row: RenderedLogRow) => {
      if (isWorkload) {
        const workloadRow = renderWorkloadRawLogRow({
          row,
          podColors,
          selectPod: handleSelectPodFilter,
          selectContainer: handleSelectContainerFilter,
          renderMessage: renderMessageContent,
        });
        if (workloadRow) {
          return workloadRow;
        }
      }
      if (!isWorkload) {
        const podRow = renderPodRawLogRow({
          row,
          showTimestamps,
          showContainerMetadata: shouldDisplayPodContainerMetadata(
            selectedContainerFilterCount,
            singlePodSelectableContainerCount
          ),
          selectContainer: handleSelectContainerFilter,
          renderMessage: renderMessageContent,
        });
        if (podRow) {
          return podRow;
        }
      }
      return (
        <div className="log-viewer-line">{renderMessageContent(row.line, `line-${row.key}`)}</div>
      );
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
    void requestLogScopeContainers(resolvedClusterId, containerLogsScope)
      .then((containerList) => {
        if (isCancelled) {
          return;
        }
        applyLogScopeContainers(dispatch, containerList, isWorkload);
      })
      .catch((err) => {
        if (isCancelled) {
          return;
        }
        console.warn('Failed to fetch containers:', err);
        dispatch({ type: 'SET_CONTAINERS', payload: [] });
        dispatch({ type: 'SET_SELECTED_CONTAINER', payload: '' });
      });

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
        const containerKind = logContainerKind(item);
        const containerLabel = container ? formatContainerLabel(container, containerKind) : '';
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
              handleSelectContainerFilter(container, containerKind);
            }}
            title={`Show only logs from container ${containerLabel}`}
            aria-label={`Show only logs from container ${containerLabel}`}
          >
            {container}
          </button>
        ) : (
          '-'
        );
      },
    });

    // Promote well-known timestamp and level fields to appear first, then add
    // the remaining user-data columns (shared with the node-logs tab).
    columns.push(
      ...buildParsedLogDataColumns(derivedFieldKeys, new Set(columns.map((col) => col.key)))
    );

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
      reportOperationalError(err, { source: 'LogViewer', action: 'copyLogs' });
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
          reportOperationalError(err, { source: 'LogViewer', action: 'copySelectedLogText' });
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

  const blockingState = (
    <LogViewerBlockingState
      loading={logsLoadingState.loading}
      paused={showPausedLogsState || shouldShowPausedLogsEmptyState}
      pendingFallback={pendingFallback}
      displayError={displayError}
      hasEntries={logEntries.length > 0}
    />
  );
  if (
    shouldShowLogViewerBlockingState({
      loading: logsLoadingState.loading,
      paused: showPausedLogsState || shouldShowPausedLogsEmptyState,
      pendingFallback,
      displayError,
      hasEntries: logEntries.length > 0,
    })
  ) {
    return blockingState;
  }

  const copyIconFeedback = getLogViewerCopyFeedback(copyFeedback);
  const renderedLogContent = renderLogViewerContent({
    isParsedView,
    parsedContainerLogs,
    tableColumns,
    expandedRows,
    onToggleParsedRow: handleToggleParsedRow,
    displayLogs,
    renderedDisplayRows,
    logsContentRef,
    wrapText,
    renderRawLogRow,
    emptyStateMessage,
  });
  const iconItems = buildLogViewerIconItems({
    highlightMatches,
    inverseMatches,
    caseSensitiveMatches,
    regexMatches,
    autoRefresh,
    supportsPreviousContainerLogs,
    showPreviousContainerLogs,
    showTimestamps,
    wrapText,
    isParsedView,
    hasAnsiLogEntries,
    showAnsiColors,
    canParseContainerLogs,
    displayMode,
    hasCopyableContent,
    copyIconFeedback,
    dispatch,
    togglePreviousContainerLogs: handleTogglePreviousContainerLogs,
    openSettings: () => setIsObjPanelLogsSettingsOpen(true),
    copyLogs: handleCopyContainerLogs,
  });
  const controls = (
    <LogViewerControls
      activeFilterChips={activeFilterChips}
      selectorOptions={selectorOptions}
      selectedFilters={selectedFilters}
      isPendingLogs={isPendingLogs}
      filterInputRef={filterInputRef}
      textFilter={textFilter}
      iconItems={iconItems}
      hasActiveResultFilter={hasActiveResultFilter}
      countTitle={countTitle}
      countLabel={countLabel}
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
      isTailFollowing={isTailFollowing}
      resumeScrolling={handleResumeScrolling}
      isSettingsOpen={isObjPanelLogsSettingsOpen}
      closeSettings={() => setIsObjPanelLogsSettingsOpen(false)}
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
