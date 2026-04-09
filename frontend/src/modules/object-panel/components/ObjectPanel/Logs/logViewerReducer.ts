/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerReducer.ts
 *
 * Consolidates the multiple useState calls in LogViewer into a single reducer
 * for better state management and reduced complexity.
 */

import type { LogViewerPrefs } from '../types';

// Empty string means "all containers" in both the backend API and the filter UI
export const ALL_CONTAINERS = '';

export interface ParsedLogEntry {
  /** User JSON fields — never collides with internal metadata */
  data: Record<string, unknown>;
  pod?: string;
  container?: string;
  timestamp?: string;
  rawLine: string;
  lineNumber: number;
  seq?: number;
}

export type CopyFeedback = 'idle' | 'copied' | 'error';

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
  selectedFilter: string;

  // UI settings (user preferences)
  autoRefresh: boolean;
  showTimestamps: boolean;
  wrapText: boolean;
  textFilter: string;
  highlightFilter: string;
  includeFilter: string;
  excludeFilter: string;

  // Parsed view state
  isParsedView: boolean;
  parsedLogs: ParsedLogEntry[];
  expandedRows: Set<string>;

  // Loading/status state
  copyFeedback: CopyFeedback;
  manualRefreshPending: boolean;
  fallbackActive: boolean;
  fallbackError: string | null;
  showPreviousLogs: boolean;
  isLoadingPreviousLogs: boolean;
}

export type LogViewerAction =
  // Container actions
  | { type: 'SET_CONTAINERS'; payload: string[] }
  | { type: 'SET_SELECTED_CONTAINER'; payload: string }

  // Workload filter actions
  | { type: 'SET_AVAILABLE_PODS'; payload: string[] }
  | { type: 'SET_AVAILABLE_CONTAINERS'; payload: string[] }
  | { type: 'SET_SELECTED_FILTER'; payload: string }

  // UI settings actions
  | { type: 'TOGGLE_AUTO_REFRESH' }
  | { type: 'TOGGLE_TIMESTAMPS' }
  | { type: 'TOGGLE_WRAP_TEXT' }
  | { type: 'SET_TEXT_FILTER'; payload: string }
  | { type: 'SET_HIGHLIGHT_FILTER'; payload: string }
  | { type: 'SET_INCLUDE_FILTER'; payload: string }
  | { type: 'SET_EXCLUDE_FILTER'; payload: string }

  // Parsed view actions
  | { type: 'TOGGLE_PARSED_VIEW' }
  | { type: 'SET_PARSED_VIEW'; payload: boolean }
  | { type: 'SET_PARSED_LOGS'; payload: ParsedLogEntry[] }
  | { type: 'TOGGLE_ROW_EXPANSION'; payload: string }

  // Loading/status actions
  | { type: 'SET_COPY_FEEDBACK'; payload: CopyFeedback }
  | { type: 'SET_MANUAL_REFRESH_PENDING'; payload: boolean }
  | { type: 'SET_FALLBACK_ACTIVE'; payload: boolean }
  | { type: 'SET_FALLBACK_ERROR'; payload: string | null }
  | { type: 'SET_SHOW_PREVIOUS_LOGS'; payload: boolean }
  | { type: 'SET_IS_LOADING_PREVIOUS_LOGS'; payload: boolean }

  // Compound actions for common operations
  | { type: 'RESET_FOR_NEW_SCOPE'; isWorkload: boolean }
  | { type: 'START_PREVIOUS_LOGS' }
  | { type: 'STOP_PREVIOUS_LOGS' }
  | { type: 'CLEAR_FALLBACK' };

export const initialLogViewerState: LogViewerState = {
  // Container state
  containers: [],
  selectedContainer: '',

  // Workload filter state
  availablePods: [],
  availableContainers: [],
  selectedFilter: '',

  // UI settings
  autoRefresh: true,
  showTimestamps: true,
  wrapText: true,
  textFilter: '',
  highlightFilter: '',
  includeFilter: '',
  excludeFilter: '',

  // Parsed view state
  isParsedView: false,
  parsedLogs: [],
  expandedRows: new Set<string>(),

  // Loading/status state
  copyFeedback: 'idle',
  manualRefreshPending: false,
  fallbackActive: false,
  fallbackError: null,
  showPreviousLogs: false,
  isLoadingPreviousLogs: false,
};

/**
 * Project the persistent subset of LogViewerState into a flat
 * LogViewerPrefs snapshot. expandedRows is converted from Set → array
 * here so the snapshot is trivially copyable; applyLogViewerPrefs
 * inverts that on the way back in.
 */
export const extractLogViewerPrefs = (state: LogViewerState): LogViewerPrefs => ({
  selectedContainer: state.selectedContainer,
  selectedFilter: state.selectedFilter,
  autoRefresh: state.autoRefresh,
  showTimestamps: state.showTimestamps,
  wrapText: state.wrapText,
  textFilter: state.textFilter,
  highlightFilter: state.highlightFilter,
  includeFilter: state.includeFilter,
  excludeFilter: state.excludeFilter,
  isParsedView: state.isParsedView,
  expandedRows: Array.from(state.expandedRows),
  showPreviousLogs: state.showPreviousLogs,
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
  selectedFilter: prefs.selectedFilter,
  autoRefresh: prefs.autoRefresh,
  showTimestamps: prefs.showTimestamps,
  wrapText: prefs.wrapText,
  textFilter: prefs.textFilter,
  highlightFilter: prefs.highlightFilter ?? '',
  includeFilter: prefs.includeFilter ?? '',
  excludeFilter: prefs.excludeFilter ?? '',
  isParsedView: prefs.isParsedView,
  expandedRows: new Set(prefs.expandedRows),
  showPreviousLogs: prefs.showPreviousLogs,
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
    case 'SET_SELECTED_FILTER':
      return { ...state, selectedFilter: action.payload };

    // UI settings actions
    case 'TOGGLE_AUTO_REFRESH':
      return { ...state, autoRefresh: !state.autoRefresh };
    case 'TOGGLE_TIMESTAMPS':
      return { ...state, showTimestamps: !state.showTimestamps };
    case 'TOGGLE_WRAP_TEXT':
      return { ...state, wrapText: !state.wrapText };
    case 'SET_TEXT_FILTER':
      return { ...state, textFilter: action.payload };
    case 'SET_HIGHLIGHT_FILTER':
      return { ...state, highlightFilter: action.payload };
    case 'SET_INCLUDE_FILTER':
      return { ...state, includeFilter: action.payload };
    case 'SET_EXCLUDE_FILTER':
      return { ...state, excludeFilter: action.payload };

    // Parsed view actions
    case 'TOGGLE_PARSED_VIEW':
      return {
        ...state,
        isParsedView: !state.isParsedView,
        parsedLogs: state.isParsedView ? [] : state.parsedLogs,
        expandedRows: new Set<string>(),
      };
    case 'SET_PARSED_VIEW':
      return {
        ...state,
        isParsedView: action.payload,
        parsedLogs: action.payload ? state.parsedLogs : [],
        expandedRows: new Set<string>(),
      };
    case 'SET_PARSED_LOGS':
      return { ...state, parsedLogs: action.payload };
    case 'TOGGLE_ROW_EXPANSION': {
      const next = new Set(state.expandedRows);
      if (next.has(action.payload)) {
        next.delete(action.payload);
      } else {
        next.add(action.payload);
      }
      return { ...state, expandedRows: next };
    }

    // Loading/status actions
    case 'SET_COPY_FEEDBACK':
      return { ...state, copyFeedback: action.payload };
    case 'SET_MANUAL_REFRESH_PENDING':
      return { ...state, manualRefreshPending: action.payload };
    case 'SET_FALLBACK_ACTIVE':
      return { ...state, fallbackActive: action.payload };
    case 'SET_FALLBACK_ERROR':
      return { ...state, fallbackError: action.payload };
    case 'SET_SHOW_PREVIOUS_LOGS':
      return { ...state, showPreviousLogs: action.payload };
    case 'SET_IS_LOADING_PREVIOUS_LOGS':
      return { ...state, isLoadingPreviousLogs: action.payload };

    // Compound actions
    case 'RESET_FOR_NEW_SCOPE':
      return {
        ...state,
        selectedFilter: '',
        selectedContainer: action.isWorkload ? state.selectedContainer : '',
        textFilter: '',
        highlightFilter: '',
        includeFilter: '',
        excludeFilter: '',
        isParsedView: false,
        parsedLogs: [],
        expandedRows: new Set<string>(),
        manualRefreshPending: false,
        fallbackActive: false,
        fallbackError: null,
        showPreviousLogs: false,
        isLoadingPreviousLogs: false,
      };
    case 'START_PREVIOUS_LOGS':
      return {
        ...state,
        showPreviousLogs: true,
        fallbackActive: false,
        fallbackError: null,
        manualRefreshPending: false,
        isLoadingPreviousLogs: true,
      };
    case 'STOP_PREVIOUS_LOGS':
      return {
        ...state,
        showPreviousLogs: false,
        fallbackError: null,
        manualRefreshPending: false,
        isLoadingPreviousLogs: false,
      };
    case 'CLEAR_FALLBACK':
      return {
        ...state,
        fallbackActive: false,
        fallbackError: null,
      };

    default:
      return state;
  }
}
