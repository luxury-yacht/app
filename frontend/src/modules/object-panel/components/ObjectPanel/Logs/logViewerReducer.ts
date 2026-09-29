/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerReducer.ts
 *
 * Container Logs view state: the shared log options (logOptionsReducer) plus
 * the container viewer's source fields.
 */

import type { types } from '@core/backend-api/models';
import {
  ALL_MULTISELECT_FILTER,
  type MultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import type { LogTimestampMode, LogViewerPrefs } from '../types';
import {
  initialLogOptionsState,
  isLogOptionsAction,
  type LogOptionsAction,
  type LogOptionsState,
  logOptionsReducer,
} from './logOptionsReducer';

/**
 * The LogViewer shows exactly one source of lines:
 *  - live:     the container-logs stream's buffer
 *  - previous: the previous containers' logs, fetched into component state
 */
export type LogViewMode = { kind: 'live' } | { kind: 'previous' };

export const LIVE_MODE: LogViewMode = { kind: 'live' };
const PREVIOUS_MODE: LogViewMode = { kind: 'previous' };

const TIMESTAMP_MODE_ORDER: LogTimestampMode[] = ['hidden', 'default', 'short', 'localized'];

/**
 * LogViewer state: the shared options plus the container viewer's own fields.
 */
export interface LogViewerState extends LogOptionsState {
  // Containers of the scope (single pod view)
  containers: types.PodContainer[];
  // Pods and the pod/container source selection (workload view)
  availablePods: string[];
  selectedFilters: MultiSelectFilterSelection;
  timestampMode: LogTimestampMode;
  mode: LogViewMode;
}

export type LogViewerAction =
  | LogOptionsAction
  | { type: 'SET_CONTAINERS'; payload: types.PodContainer[] }
  | { type: 'SET_AVAILABLE_PODS'; payload: string[] }
  | { type: 'SET_SELECTED_FILTERS'; payload: MultiSelectFilterSelection }
  | { type: 'CYCLE_TIMESTAMP_MODE' }
  | { type: 'SET_TIMESTAMP_MODE'; payload: LogTimestampMode }
  | { type: 'SET_SHOW_PREVIOUS_LOGS'; payload: boolean }
  | { type: 'RESET_FOR_NEW_SCOPE' }
  | { type: 'START_PREVIOUS_LOGS' }
  | { type: 'STOP_PREVIOUS_LOGS' };

export const initialLogViewerState: LogViewerState = {
  ...initialLogOptionsState,
  containers: [],
  availablePods: [],
  selectedFilters: ALL_MULTISELECT_FILTER,
  timestampMode: 'default',
  mode: LIVE_MODE,
};

/**
 * Project the persistent subset of LogViewerState into a flat
 * LogViewerPrefs snapshot. expandedRows is converted from Set → array
 * here so the snapshot is trivially copyable; applyLogViewerPrefs
 * inverts that on the way back in.
 */
export const extractLogViewerPrefs = (state: LogViewerState): LogViewerPrefs => ({
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
  mode: prefs.showPreviousContainerLogs ? PREVIOUS_MODE : LIVE_MODE,
});

const cycleTimestampMode = (state: LogViewerState): LogViewerState => {
  const currentIndex = TIMESTAMP_MODE_ORDER.indexOf(state.timestampMode);
  return {
    ...state,
    timestampMode: TIMESTAMP_MODE_ORDER[(currentIndex + 1) % TIMESTAMP_MODE_ORDER.length],
  };
};

const setPreviousLogsMode = (state: LogViewerState, visible: boolean): LogViewerState => {
  const kind = visible ? 'previous' : 'live';
  return state.mode.kind === kind ? state : { ...state, mode: visible ? PREVIOUS_MODE : LIVE_MODE };
};

const resetForNewScope = (state: LogViewerState): LogViewerState => ({
  ...state,
  selectedFilters: ALL_MULTISELECT_FILTER,
  textFilter: '',
  highlightMatches: false,
  inverseMatches: false,
  caseSensitiveMatches: false,
  regexMatches: false,
  displayMode: 'raw',
  expandedRows: new Set<string>(),
  mode: LIVE_MODE,
});

export function logViewerReducer(state: LogViewerState, action: LogViewerAction): LogViewerState {
  if (isLogOptionsAction(action)) {
    return logOptionsReducer(state, action);
  }
  switch (action.type) {
    case 'SET_CONTAINERS':
      return { ...state, containers: action.payload };
    case 'SET_AVAILABLE_PODS':
      return { ...state, availablePods: action.payload };
    case 'SET_SELECTED_FILTERS':
      return { ...state, selectedFilters: action.payload };
    case 'CYCLE_TIMESTAMP_MODE':
      return cycleTimestampMode(state);
    case 'SET_TIMESTAMP_MODE':
      return { ...state, timestampMode: action.payload };
    case 'SET_SHOW_PREVIOUS_LOGS':
      return setPreviousLogsMode(state, action.payload);
    case 'RESET_FOR_NEW_SCOPE':
      return resetForNewScope(state);
    case 'START_PREVIOUS_LOGS':
      return setPreviousLogsMode(state, true);
    case 'STOP_PREVIOUS_LOGS':
      return setPreviousLogsMode(state, false);
    default:
      return state;
  }
}
