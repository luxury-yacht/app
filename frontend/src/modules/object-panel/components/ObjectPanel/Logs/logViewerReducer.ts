/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerReducer.ts
 *
 * Consolidates the multiple useState calls in LogViewer into a single reducer
 * for better state management and reduced complexity.
 */

import {
  ALL_MULTISELECT_FILTER,
  type MultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import type { LogDisplayMode, LogTimestampMode, LogViewerPrefs } from '../types';

// Empty string means "all containers" in both the backend API and the filter UI
export const ALL_CONTAINERS = '';

export interface ParsedLogEntry {
  /** User JSON fields — never collides with internal metadata */
  data: Record<string, unknown>;
  pod?: string;
  container?: string;
  isInit?: boolean;
  isEphemeral?: boolean;
  timestamp?: string;
  rawLine: string;
  lineNumber: number;
  seq?: number;
}

export type CopyFeedback = 'idle' | 'copied' | 'error';

/**
 * The LogViewer is always in exactly one view mode. Modeling it as a
 * discriminated union makes the contradictions the old boolean trio allowed
 * unrepresentable: fallback polling and the previous-container view are mutually
 * exclusive, and "loading previous logs" only exists inside the previous mode.
 *  - live:     streaming the current container's logs (or the initial prime)
 *  - fallback: the stream errored; the snapshot-polling fallback is active
 *  - previous: showing a previous container's logs (loading until fetched)
 */
export type LogViewMode =
  | { kind: 'live' }
  | { kind: 'fallback' }
  | { kind: 'previous'; loading: boolean };

export const LIVE_MODE: LogViewMode = { kind: 'live' };

const TIMESTAMP_MODE_ORDER: LogTimestampMode[] = ['hidden', 'default', 'short', 'localized'];

/**
 * LogViewer state grouped by concern
 */
export interface LogViewerState {
  // Container state (for single pod view)
  containers: string[];
  selectedContainer: string;

  // Pod and container state (for workload view)
  availablePods: string[];
  availableContainers: string[];
  selectedFilters: MultiSelectFilterSelection;

  // UI settings (user preferences)
  autoRefresh: boolean;
  timestampMode: LogTimestampMode;
  wrapText: boolean;
  showAnsiColors: boolean;
  textFilter: string;
  highlightMatches: boolean;
  inverseMatches: boolean;
  caseSensitiveMatches: boolean;
  regexMatches: boolean;

  // Parsed view state
  displayMode: LogDisplayMode;
  parsedContainerLogs: ParsedLogEntry[];
  expandedRows: Set<string>;

  // Async/status state. `mode` is a discriminated union of the mutually
  // exclusive view modes (live / fallback / previous) so contradictory
  // combinations are unrepresentable. The fallback error is intentionally NOT
  // tracked here — it surfaces through the refresh-store snapshot status.
  copyFeedback: CopyFeedback;
  mode: LogViewMode;
}

export type LogViewerAction =
  // Container actions
  | { type: 'SET_CONTAINERS'; payload: string[] }
  | { type: 'SET_SELECTED_CONTAINER'; payload: string }

  // Workload filter actions
  | { type: 'SET_AVAILABLE_PODS'; payload: string[] }
  | { type: 'SET_AVAILABLE_CONTAINERS'; payload: string[] }
  | { type: 'SET_SELECTED_FILTERS'; payload: MultiSelectFilterSelection }

  // UI settings actions
  | { type: 'TOGGLE_AUTO_REFRESH' }
  | { type: 'CYCLE_TIMESTAMP_MODE' }
  | { type: 'SET_TIMESTAMP_MODE'; payload: LogTimestampMode }
  | { type: 'TOGGLE_WRAP_TEXT' }
  | { type: 'TOGGLE_SHOW_ANSI_COLORS' }
  | { type: 'SET_TEXT_FILTER'; payload: string }
  | { type: 'TOGGLE_HIGHLIGHT_MATCHES' }
  | { type: 'TOGGLE_INVERSE_MATCHES' }
  | { type: 'TOGGLE_CASE_SENSITIVE_MATCHES' }
  | { type: 'TOGGLE_REGEX_MATCHES' }

  // Parsed view actions
  | { type: 'TOGGLE_PARSED_VIEW' }
  | { type: 'SET_DISPLAY_MODE'; payload: LogDisplayMode }
  | { type: 'SET_PARSED_LOGS'; payload: ParsedLogEntry[] }
  | { type: 'TOGGLE_ROW_EXPANSION'; payload: string }

  // Async/status actions. These keep their boolean-setter shape (the stream
  // fallback hook and LogViewer dispatch them) but the reducer maps each to a
  // `mode` transition.
  | { type: 'SET_COPY_FEEDBACK'; payload: CopyFeedback }
  | { type: 'SET_FALLBACK_ACTIVE'; payload: boolean }
  | { type: 'SET_SHOW_PREVIOUS_LOGS'; payload: boolean }
  | { type: 'SET_IS_LOADING_PREVIOUS_LOGS'; payload: boolean }

  // Compound actions for common operations
  | { type: 'RESET_FOR_NEW_SCOPE'; isWorkload: boolean }
  | { type: 'START_PREVIOUS_LOGS' }
  | { type: 'STOP_PREVIOUS_LOGS' };

export const initialLogViewerState: LogViewerState = {
  // Container state
  containers: [],
  selectedContainer: '',

  // Workload filter state
  availablePods: [],
  availableContainers: [],
  selectedFilters: ALL_MULTISELECT_FILTER,

  // UI settings
  autoRefresh: true,
  timestampMode: 'default',
  wrapText: true,
  showAnsiColors: true,
  textFilter: '',
  highlightMatches: false,
  inverseMatches: false,
  caseSensitiveMatches: false,
  regexMatches: false,

  // Parsed view state
  displayMode: 'raw',
  parsedContainerLogs: [],
  expandedRows: new Set<string>(),

  // Async/status state
  copyFeedback: 'idle',
  mode: LIVE_MODE,
};

/**
 * Project the persistent subset of LogViewerState into a flat
 * LogViewerPrefs snapshot. expandedRows is converted from Set → array
 * here so the snapshot is trivially copyable; applyLogViewerPrefs
 * inverts that on the way back in.
 */
export const extractLogViewerPrefs = (state: LogViewerState): LogViewerPrefs => ({
  selectedContainer: state.selectedContainer,
  selectedFilters: state.selectedFilters,
  autoRefresh: state.autoRefresh,
  timestampMode: state.timestampMode,
  showTimestamps: state.timestampMode !== 'hidden',
  wrapText: state.wrapText,
  showAnsiColors: state.showAnsiColors,
  textFilter: state.textFilter,
  highlightMatches: state.highlightMatches,
  inverseMatches: state.inverseMatches,
  caseSensitiveMatches: state.caseSensitiveMatches,
  regexMatches: state.regexMatches,
  displayMode: state.displayMode,
  isParsedView: state.displayMode === 'parsed',
  expandedRows: Array.from(state.expandedRows),
  showPreviousContainerLogs: state.mode.kind === 'previous',
});

/**
 * Merge a LogViewerPrefs snapshot back onto a base state. Used by
 * LogViewer's lazy useReducer initializer to rehydrate from the
 * cached prefs on (re)mount.
 */
export const applyLogViewerPrefs = (
  base: LogViewerState,
  prefs: LogViewerPrefs
): LogViewerState => ({
  ...base,
  selectedContainer: prefs.selectedContainer,
  selectedFilters: prefs.selectedFilters ?? ALL_MULTISELECT_FILTER,
  autoRefresh: prefs.autoRefresh,
  timestampMode: prefs.timestampMode ?? (prefs.showTimestamps ? 'default' : 'hidden'),
  wrapText: prefs.wrapText,
  showAnsiColors: prefs.showAnsiColors ?? true,
  textFilter: prefs.textFilter,
  highlightMatches: prefs.highlightMatches ?? false,
  inverseMatches: prefs.inverseMatches ?? false,
  caseSensitiveMatches: prefs.caseSensitiveMatches ?? false,
  regexMatches: prefs.regexMatches ?? false,
  displayMode: prefs.displayMode ?? (prefs.isParsedView ? 'parsed' : 'raw'),
  expandedRows: new Set(prefs.expandedRows),
  // Rehydrate into the previous-logs view (not loading — the fetch reprimes on
  // mount); otherwise the default live mode.
  mode: prefs.showPreviousContainerLogs ? { kind: 'previous', loading: false } : LIVE_MODE,
});

type LogViewerActionReducer = (
  state: LogViewerState,
  action: LogViewerAction
) => LogViewerState | null;

const cycleTimestampMode = (state: LogViewerState): LogViewerState => {
  const currentIndex = TIMESTAMP_MODE_ORDER.indexOf(state.timestampMode);
  return {
    ...state,
    timestampMode: TIMESTAMP_MODE_ORDER[(currentIndex + 1) % TIMESTAMP_MODE_ORDER.length],
  };
};

const toggleHighlightMatches = (state: LogViewerState): LogViewerState => ({
  ...state,
  highlightMatches: state.inverseMatches ? false : !state.highlightMatches,
});

const toggleInverseMatches = (state: LogViewerState): LogViewerState => ({
  ...state,
  inverseMatches: !state.inverseMatches,
  highlightMatches: state.inverseMatches ? state.highlightMatches : false,
});

const toggleCaseSensitiveMatches = (state: LogViewerState): LogViewerState =>
  state.regexMatches ? state : { ...state, caseSensitiveMatches: !state.caseSensitiveMatches };

const toggleRegexMatches = (state: LogViewerState): LogViewerState => ({
  ...state,
  regexMatches: !state.regexMatches,
  caseSensitiveMatches: state.regexMatches ? state.caseSensitiveMatches : false,
});

const toggleParsedView = (state: LogViewerState): LogViewerState => {
  const showParsed = state.displayMode !== 'parsed';
  return {
    ...state,
    displayMode: showParsed ? 'parsed' : 'raw',
    parsedContainerLogs: showParsed ? state.parsedContainerLogs : [],
    expandedRows: new Set<string>(),
  };
};

const setDisplayMode = (state: LogViewerState, displayMode: LogDisplayMode): LogViewerState => ({
  ...state,
  displayMode,
  parsedContainerLogs: displayMode === 'parsed' ? state.parsedContainerLogs : [],
  expandedRows: new Set<string>(),
});

const toggleRowExpansion = (state: LogViewerState, rowId: string): LogViewerState => {
  const expandedRows = new Set(state.expandedRows);
  if (expandedRows.has(rowId)) {
    expandedRows.delete(rowId);
  } else {
    expandedRows.add(rowId);
  }
  return { ...state, expandedRows };
};

const setFallbackMode = (state: LogViewerState, active: boolean): LogViewerState => {
  if (active) {
    return state.mode.kind === 'previous' ? state : { ...state, mode: { kind: 'fallback' } };
  }
  return state.mode.kind === 'fallback' ? { ...state, mode: LIVE_MODE } : state;
};

const setPreviousLogsMode = (state: LogViewerState, visible: boolean): LogViewerState => {
  if (visible) {
    return state.mode.kind === 'previous'
      ? state
      : { ...state, mode: { kind: 'previous', loading: false } };
  }
  return state.mode.kind === 'previous' ? { ...state, mode: LIVE_MODE } : state;
};

const setPreviousLogsLoading = (state: LogViewerState, loading: boolean): LogViewerState =>
  state.mode.kind === 'previous' ? { ...state, mode: { kind: 'previous', loading } } : state;

const resetForNewScope = (state: LogViewerState, isWorkload: boolean): LogViewerState => ({
  ...state,
  selectedFilters: ALL_MULTISELECT_FILTER,
  selectedContainer: isWorkload ? state.selectedContainer : '',
  textFilter: '',
  highlightMatches: false,
  inverseMatches: false,
  caseSensitiveMatches: false,
  regexMatches: false,
  displayMode: 'raw',
  parsedContainerLogs: [],
  expandedRows: new Set<string>(),
  mode: LIVE_MODE,
});

const reduceContainerAndFilterAction: LogViewerActionReducer = (state, action) => {
  switch (action.type) {
    case 'SET_CONTAINERS':
      return { ...state, containers: action.payload };
    case 'SET_SELECTED_CONTAINER':
      return { ...state, selectedContainer: action.payload };
    case 'SET_AVAILABLE_PODS':
      return { ...state, availablePods: action.payload };
    case 'SET_AVAILABLE_CONTAINERS':
      return { ...state, availableContainers: action.payload };
    case 'SET_SELECTED_FILTERS':
      return { ...state, selectedFilters: action.payload };
    default:
      return null;
  }
};

const reduceUiSettingsAction: LogViewerActionReducer = (state, action) => {
  switch (action.type) {
    case 'TOGGLE_AUTO_REFRESH':
      return { ...state, autoRefresh: !state.autoRefresh };
    case 'CYCLE_TIMESTAMP_MODE':
      return cycleTimestampMode(state);
    case 'SET_TIMESTAMP_MODE':
      return { ...state, timestampMode: action.payload };
    case 'TOGGLE_WRAP_TEXT':
      return { ...state, wrapText: !state.wrapText };
    case 'TOGGLE_SHOW_ANSI_COLORS':
      return { ...state, showAnsiColors: !state.showAnsiColors };
    case 'SET_TEXT_FILTER':
      return { ...state, textFilter: action.payload };
    case 'TOGGLE_HIGHLIGHT_MATCHES':
      return toggleHighlightMatches(state);
    case 'TOGGLE_INVERSE_MATCHES':
      return toggleInverseMatches(state);
    case 'TOGGLE_CASE_SENSITIVE_MATCHES':
      return toggleCaseSensitiveMatches(state);
    case 'TOGGLE_REGEX_MATCHES':
      return toggleRegexMatches(state);
    default:
      return null;
  }
};

const reduceParsedViewAction: LogViewerActionReducer = (state, action) => {
  switch (action.type) {
    case 'TOGGLE_PARSED_VIEW':
      return toggleParsedView(state);
    case 'SET_DISPLAY_MODE':
      return setDisplayMode(state, action.payload);
    case 'SET_PARSED_LOGS':
      return { ...state, parsedContainerLogs: action.payload };
    case 'TOGGLE_ROW_EXPANSION':
      return toggleRowExpansion(state, action.payload);
    default:
      return null;
  }
};

const reduceAsyncStatusAction: LogViewerActionReducer = (state, action) => {
  switch (action.type) {
    case 'SET_COPY_FEEDBACK':
      return { ...state, copyFeedback: action.payload };
    case 'SET_FALLBACK_ACTIVE':
      return setFallbackMode(state, action.payload);
    case 'SET_SHOW_PREVIOUS_LOGS':
      return setPreviousLogsMode(state, action.payload);
    case 'SET_IS_LOADING_PREVIOUS_LOGS':
      return setPreviousLogsLoading(state, action.payload);
    default:
      return null;
  }
};

const reduceCompoundAction: LogViewerActionReducer = (state, action) => {
  switch (action.type) {
    case 'RESET_FOR_NEW_SCOPE':
      return resetForNewScope(state, action.isWorkload);
    case 'START_PREVIOUS_LOGS':
      return { ...state, mode: { kind: 'previous', loading: true } };
    case 'STOP_PREVIOUS_LOGS':
      return { ...state, mode: LIVE_MODE };
    default:
      return null;
  }
};

const LOG_VIEWER_ACTION_REDUCERS: LogViewerActionReducer[] = [
  reduceContainerAndFilterAction,
  reduceUiSettingsAction,
  reduceParsedViewAction,
  reduceAsyncStatusAction,
  reduceCompoundAction,
];

export function logViewerReducer(state: LogViewerState, action: LogViewerAction): LogViewerState {
  for (const reducer of LOG_VIEWER_ACTION_REDUCERS) {
    const nextState = reducer(state, action);
    if (nextState) {
      return nextState;
    }
  }
  return state;
}
