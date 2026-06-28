/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerReducer.ts
 *
 * Consolidates the multiple useState calls in LogViewer into a single reducer
 * for better state management and reduced complexity.
 */
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
  { kind: 'live' } | { kind: 'fallback' } | { kind: 'previous'; loading: boolean };

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
  selectedFilters: string[];

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
  | { type: 'SET_SELECTED_FILTERS'; payload: string[] }

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
  selectedFilters: [],

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
  selectedFilters: prefs.selectedFilters ?? [],
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

export function logViewerReducer(state: LogViewerState, action: LogViewerAction): LogViewerState {
  switch (action.type) {
    // Container actions
    case 'SET_CONTAINERS':
      return { ...state, containers: action.payload };
    case 'SET_SELECTED_CONTAINER':
      return { ...state, selectedContainer: action.payload };

    // Workload filter actions
    case 'SET_AVAILABLE_PODS':
      return { ...state, availablePods: action.payload };
    case 'SET_AVAILABLE_CONTAINERS':
      return { ...state, availableContainers: action.payload };
    case 'SET_SELECTED_FILTERS':
      return { ...state, selectedFilters: action.payload };

    // UI settings actions
    case 'TOGGLE_AUTO_REFRESH':
      return { ...state, autoRefresh: !state.autoRefresh };
    case 'CYCLE_TIMESTAMP_MODE': {
      const currentIndex = TIMESTAMP_MODE_ORDER.indexOf(state.timestampMode);
      return {
        ...state,
        timestampMode: TIMESTAMP_MODE_ORDER[(currentIndex + 1) % TIMESTAMP_MODE_ORDER.length],
      };
    }
    case 'SET_TIMESTAMP_MODE':
      return { ...state, timestampMode: action.payload };
    case 'TOGGLE_WRAP_TEXT':
      return { ...state, wrapText: !state.wrapText };
    case 'TOGGLE_SHOW_ANSI_COLORS':
      return { ...state, showAnsiColors: !state.showAnsiColors };
    case 'SET_TEXT_FILTER':
      return {
        ...state,
        textFilter: action.payload,
      };
    case 'TOGGLE_HIGHLIGHT_MATCHES':
      return {
        ...state,
        highlightMatches: !state.inverseMatches ? !state.highlightMatches : false,
      };
    case 'TOGGLE_INVERSE_MATCHES':
      return {
        ...state,
        inverseMatches: !state.inverseMatches,
        highlightMatches: !state.inverseMatches ? false : state.highlightMatches,
      };
    case 'TOGGLE_CASE_SENSITIVE_MATCHES':
      if (state.regexMatches) {
        return state;
      }
      return {
        ...state,
        caseSensitiveMatches: !state.caseSensitiveMatches,
      };
    case 'TOGGLE_REGEX_MATCHES':
      return {
        ...state,
        regexMatches: !state.regexMatches,
        caseSensitiveMatches: !state.regexMatches ? false : state.caseSensitiveMatches,
      };

    // Parsed view actions
    case 'TOGGLE_PARSED_VIEW':
      return {
        ...state,
        displayMode: state.displayMode === 'parsed' ? 'raw' : 'parsed',
        parsedContainerLogs: state.displayMode === 'parsed' ? [] : state.parsedContainerLogs,
        expandedRows: new Set<string>(),
      };
    case 'SET_DISPLAY_MODE':
      return {
        ...state,
        displayMode: action.payload,
        parsedContainerLogs: action.payload === 'parsed' ? state.parsedContainerLogs : [],
        expandedRows: new Set<string>(),
      };
    case 'SET_PARSED_LOGS':
      return { ...state, parsedContainerLogs: action.payload };
    case 'TOGGLE_ROW_EXPANSION': {
      const next = new Set(state.expandedRows);
      if (next.has(action.payload)) {
        next.delete(action.payload);
      } else {
        next.add(action.payload);
      }
      return { ...state, expandedRows: next };
    }

    // Async/status actions — each maps to a `mode` transition.
    case 'SET_COPY_FEEDBACK':
      return { ...state, copyFeedback: action.payload };
    case 'SET_FALLBACK_ACTIVE':
      if (action.payload) {
        // Fallback applies only to the live stream; never interrupt the
        // previous-logs view (which has no stream to fall back from).
        return state.mode.kind === 'previous' ? state : { ...state, mode: { kind: 'fallback' } };
      }
      return state.mode.kind === 'fallback' ? { ...state, mode: LIVE_MODE } : state;
    case 'SET_SHOW_PREVIOUS_LOGS':
      if (action.payload) {
        return state.mode.kind === 'previous'
          ? state
          : { ...state, mode: { kind: 'previous', loading: false } };
      }
      return state.mode.kind === 'previous' ? { ...state, mode: LIVE_MODE } : state;
    case 'SET_IS_LOADING_PREVIOUS_LOGS':
      // Loading only exists inside the previous-logs mode.
      return state.mode.kind === 'previous'
        ? { ...state, mode: { kind: 'previous', loading: action.payload } }
        : state;

    // Compound actions
    case 'RESET_FOR_NEW_SCOPE':
      return {
        ...state,
        selectedFilters: [],
        selectedContainer: action.isWorkload ? state.selectedContainer : '',
        textFilter: '',
        highlightMatches: false,
        inverseMatches: false,
        caseSensitiveMatches: false,
        regexMatches: false,
        displayMode: 'raw',
        parsedContainerLogs: [],
        expandedRows: new Set<string>(),
        mode: LIVE_MODE,
      };
    case 'START_PREVIOUS_LOGS':
      return { ...state, mode: { kind: 'previous', loading: true } };
    case 'STOP_PREVIOUS_LOGS':
      return { ...state, mode: LIVE_MODE };

    default:
      return state;
  }
}
