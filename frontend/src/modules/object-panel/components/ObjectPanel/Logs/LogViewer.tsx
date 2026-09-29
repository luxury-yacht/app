/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx
 *
 * Renders the object-panel Logs tab. It reads the live stream's state (the
 * stream manager is its only writer), loads previous logs into component
 * state, and owns filtering, parsing, keyboard shortcuts, and viewer
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
  multiSelectFilterTriggerLabel,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import { WarningIcon } from '@shared/components/icons/SharedIcons';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import ScrollableRegion from '@shared/components/ScrollableRegion';
import Tooltip from '@shared/components/Tooltip';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { compareUtf16Strings } from '@shared/utils/sort';
import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { readContainerLogsScopeContainers, requestData } from '@/core/data-access';
import { useContainerLogsStream } from './hooks/useContainerLogsStream';
import { useLogCopyAction, useLogSelectionCopy } from './hooks/useLogCopyAction';
import { useLogFiltering } from './hooks/useLogFiltering';
import { useLogKeyboardShortcuts } from './hooks/useLogKeyboardShortcuts';
import { logCopyText, splitDisplayRows, useRawViewFallback } from './hooks/useLogPresentation';
import './LogViewer.css';
import ObjPanelLogsSettingsModal from '@ui/modals/ObjPanelLogsSettingsModal';
import { eventBus } from '@/core/events';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import { refreshOrchestrator } from '@/core/refresh/orchestrator';
import { type DomainSnapshotState, useRefreshScopedDomain } from '@/core/refresh/store';
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
import {
  DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT,
  formatDefaultObjPanelLogsApiTimestamp,
  formatObjPanelLogsApiTimestamp,
} from '@/utils/objPanelLogsApiTimestampFormat';
import { INACTIVE_SCOPE } from '../constants';
import type { LogDisplayMode, LogTimestampMode } from '../types';
import { containsAnsi } from './ansi';
import { buildContainerLogMetadataColumns, containerLogExportValue } from './containerLogColumns';
import {
  bufferFullNotice,
  buildContainerLogNotices,
  LIVE_LOGS_UNAVAILABLE_MESSAGE,
  onlyUnavailableIssues,
  PREVIOUS_LOGS_UNAVAILABLE_MESSAGE,
  RETRY_HINT,
} from './containerLogNotices';
import { setContainerLogsStreamScopeParams } from './containerLogsStreamScopeParamsCache';
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
  classifySelectedLogSources,
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
  logViewerReducer,
} from './logViewerReducer';
import ParsedLogTable from './ParsedLogTable';
import { formatRawOrPrettyJsonLine } from './parsedLogUtils';
import { buildStablePodColorMap } from './podColors';
import RawLogViewer, { type RenderedLogRow } from './RawLogViewer';

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
  mode: LogTimestampMode,
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
const WORKLOAD_RAW_LOG_PREFIX_PATTERN = /^(?:(\[[^\]]+\]\s*))?\[([^/]+)\/([^\]]+)\]\s*(.*)/;
const EMPTY_CONTAINER_LOG_PLACEHOLDER = '[container emitted an empty log]';

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
  | 'unavailable'
  | 'previous_unavailable'
  | 'auto_refresh_off';

type ContainerLogsSnapshotState = DomainSnapshotState<ContainerLogsSnapshotPayload>;

const getWorkloadPodNames = (
  entries: ContainerLogsEntry[],
  activePods: string[] | null
): string[] =>
  (activePods ?? Array.from(new Set(entries.map((entry) => entry.pod).filter(Boolean))))
    .slice()
    .sort(compareUtf16Strings);

// Lines of pods the workload no longer has are hidden. The filter applies only
// once the pod list is known, and an empty list hides every line only after
// pods were seen, so the first, still-loading list does not blank the view.
const filterEntriesForActivePods = (
  entries: ContainerLogsEntry[],
  activePods: Set<string> | null
): ContainerLogsEntry[] =>
  activePods === null ? entries : entries.filter((entry) => activePods.has(entry.pod));

const NO_ACTIVE_PODS = new Set<string>();

const normalizeActivePodNames = (activePodNames: string[] | null): string[] | null =>
  activePodNames === null
    ? null
    : activePodNames
        .map((name) => (typeof name === 'string' ? name.trim() : ''))
        .filter((name) => name.length > 0);

const useActivePodSet = (
  activePodNames: string[] | null,
  enabled: boolean,
  scope: string | null
): Set<string> | null => {
  const seenPodsRef = useRef<{ scope: string | null; seen: boolean }>({ scope, seen: false });
  // Reset during render, like syncContainerLogsScope, so a new scope never
  // inherits the previous one's history.
  if (seenPodsRef.current.scope !== scope) {
    seenPodsRef.current = { scope, seen: false };
  }
  const names = useMemo(() => normalizeActivePodNames(activePodNames), [activePodNames]);
  const activePods = useMemo(() => (names && names.length > 0 ? new Set(names) : null), [names]);
  useEffect(() => {
    if (enabled && activePods) {
      seenPodsRef.current.seen = true;
    }
  }, [activePods, enabled]);
  if (!enabled || names === null) {
    return null;
  }
  return activePods ?? (seenPodsRef.current.seen ? NO_ACTIVE_PODS : null);
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
  const match = WORKLOAD_RAW_LOG_PREFIX_PATTERN.exec(row.line);
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
          tabIndex={-1}
          data-focus-trap-ignore="true"
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
          tabIndex={-1}
          data-focus-trap-ignore="true"
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
            tabIndex={-1}
            data-focus-trap-ignore="true"
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

const renderLogViewerContent = ({
  isParsedView,
  parsedLogs,
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
  parsedLogs: ParsedLogEntry[];
  tableColumns: GridColumnDefinition<ParsedLogEntry>[];
  expandedRows: Set<string>;
  onToggleParsedRow: (rowKey: string) => void;
  displayLogs: string;
  renderedDisplayRows: RenderedLogRow[];
  logsContentRef: React.RefObject<HTMLElement | null>;
  wrapText: boolean;
  renderRawLogRow: (row: RenderedLogRow) => React.ReactNode;
  emptyStateMessage: string;
}): React.ReactNode => {
  if (isParsedView) {
    return (
      <ParsedLogTable
        rows={parsedLogs}
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
      />
    );
  }
  return emptyStateMessage;
};

const renderLogViewerBlockingState = ({
  loading,
  loadingMessage,
  paused,
  displayError,
  retryHint,
  hasEntries,
}: {
  loading: boolean;
  loadingMessage: string;
  paused: boolean;
  displayError: string | null;
  retryHint: boolean;
  hasEntries: boolean;
}) => {
  if (loading) {
    return (
      <div className="object-panel-tab-content">
        <LoadingSpinner message={loadingMessage} />
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
  if (displayError && !hasEntries) {
    return (
      <div className="object-panel-tab-content">
        <div className="logs-viewer-display-error">
          <div className="error-message">
            Error: <ErrorSurface kind="reported" message={displayError} />
          </div>
          {retryHint ? <div className="logs-viewer-retry-hint">{RETRY_HINT}</div> : null}
        </div>
      </div>
    );
  }
  return null;
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
  bufferFull: string | null;
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
  bufferFull,
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
            renderValue={(value) =>
              multiSelectFilterTriggerLabel('Logs', selectedFilters, normalizeDropdownValue(value))
            }
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
      {bufferFull ? (
        <Tooltip content={bufferFull} triggerLabel="Log buffer is full">
          <span className="logs-viewer-buffer-full">
            <WarningIcon width={16} height={16} />
          </span>
        </Tooltip>
      ) : null}
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
  logsContentRef: React.RefObject<HTMLElement | null>;
  renderedLogContent: React.ReactNode;
  isParsedView: boolean;
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
  isParsedView,
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
          <ScrollableRegion
            className="logs-viewer-content selectable"
            ref={logsContentRef}
            aria-label="Log output"
            tabIndex={isParsedView ? -1 : 0}
          >
            {renderedLogContent}
          </ScrollableRegion>
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
  // A snapshot has been delivered at least once for this scope.
  hasSnapshot: boolean;
};

const NO_LIVE_LOGS: LiveContainerLogs = {
  entries: EMPTY_CONTAINER_LOG_ENTRIES,
  phase: null,
  warnings: [],
  issues: [],
  truncation: null,
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
  issues: ContainerLogsTargetIssue[];
  notices: string[];
  // Shown as a tooltip beside the toolbar rather than above the lines.
  bufferFullNotice: string | null;
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
  previous: PreviousContainerLogs;
  streamExpected: boolean;
}): LogViewerSource => {
  if (showPreviousContainerLogs) {
    return {
      entries: previous.entries,
      issues: previous.issues,
      notices: buildContainerLogNotices({
        phase: null,
        warnings: previous.warnings,
        // A container without a previous run is the empty state, not a problem.
        issues: previous.issues.filter((issue) => issue.state !== 'unavailable'),
      }),
      bufferFullNotice: null,
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
    issues: live.issues,
    notices: buildContainerLogNotices(live),
    bufferFullNotice: bufferFullNotice(live.truncation),
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
  const source = useMemo(
    () =>
      resolveLogViewerSource({
        showPreviousContainerLogs,
        hasScope: Boolean(containerLogsScope),
        live,
        previous,
        streamExpected,
      }),
    [containerLogsScope, live, previous, showPreviousContainerLogs, streamExpected]
  );
  const rawLogEntries = useMemo(
    () => filterEntriesForActivePods(source.entries, activePods),
    [activePods, source.entries]
  );

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
  const logEntries = useAnchoredLogEntries(rawLogEntries, isTailFollowing, anchoredLogSourceKey);
  const visibleLogWarnings = source.notices;

  const workloadPodsForSelector = useMemo(
    () => getWorkloadPodNames(logEntries, activePodList),
    [logEntries, activePodList]
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
    parsedCsv,
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

  const selectorOptions = useMemo(() => {
    const options: DropdownOption[] = [];

    if (isWorkload) {
      options.push(
        { value: '_pods_header', label: 'Pods', disabled: true, group: 'header' },
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
    options.push(...regularContainerOptions, ...debugContainerOptions);

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
      splitDisplayRows(displayLines, (displayIndex) => {
        const sourceSeq = filteredEntries[displayIndex]?._seq;
        return sourceSeq !== undefined ? `${sourceSeq}` : `placeholder:${displayIndex}`;
      }),
    [displayLines, filteredEntries]
  );

  const hasCopyableContent = hasCopyableContainerLogs(
    isParsedView,
    parsedRows.length,
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
    tailFollowSignal: displayLogs,
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

  const handleCopyContainerLogs = useLogCopyAction({
    text: logCopyText(displayMode, displayLines, parsedCsv),
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

  const blockingState = renderLogViewerBlockingState({
    loading: logsLoadingState.loading,
    loadingMessage: source.loadingMessage,
    paused: showPausedLogsState || shouldShowPausedLogsEmptyState,
    displayError: source.displayError,
    retryHint: source.liveFailure !== null,
    hasEntries: logEntries.length > 0,
  });
  if (blockingState) {
    return blockingState;
  }

  const renderedLogContent = renderLogViewerContent({
    isParsedView,
    parsedLogs: parsedRows,
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
  const iconItems = buildLogToolbarItems({
    options: state,
    dispatch,
    hasAnsiLogEntries,
    canParseLogs: canParseContainerLogs,
    hasCopyableContent,
    copyLogs: handleCopyContainerLogs,
    previousLogs: previousLogsFeature,
    timestamps: { active: showTimestamps, toggle: toggleTimestamps },
    openSettings: () => setIsObjPanelLogsSettingsOpen(true),
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
      bufferFull={source.bufferFullNotice}
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
