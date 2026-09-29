/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logOptionsReducer.ts
 *
 * Search and display options shared by Container Logs and Node Logs. Each
 * viewer composes this state with its own source fields.
 */

import type { LogDisplayMode } from '../types';

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

export interface LogOptionsState {
  autoRefresh: boolean;
  textFilter: string;
  highlightMatches: boolean;
  inverseMatches: boolean;
  caseSensitiveMatches: boolean;
  regexMatches: boolean;
  wrapText: boolean;
  showAnsiColors: boolean;
  displayMode: LogDisplayMode;
  expandedRows: Set<string>;
  copyFeedback: CopyFeedback;
}

export type LogOptionsAction =
  | { type: 'TOGGLE_AUTO_REFRESH' }
  | { type: 'SET_AUTO_REFRESH'; payload: boolean }
  | { type: 'SET_TEXT_FILTER'; payload: string }
  | { type: 'TOGGLE_HIGHLIGHT_MATCHES' }
  | { type: 'TOGGLE_INVERSE_MATCHES' }
  | { type: 'TOGGLE_CASE_SENSITIVE_MATCHES' }
  | { type: 'TOGGLE_REGEX_MATCHES' }
  | { type: 'TOGGLE_WRAP_TEXT' }
  | { type: 'TOGGLE_SHOW_ANSI_COLORS' }
  | { type: 'TOGGLE_PARSED_VIEW' }
  | { type: 'SET_DISPLAY_MODE'; payload: LogDisplayMode }
  | { type: 'TOGGLE_ROW_EXPANSION'; payload: string }
  | { type: 'SET_COPY_FEEDBACK'; payload: CopyFeedback };

const LOG_OPTIONS_ACTION_TYPES = new Set<string>(
  Object.keys({
    TOGGLE_AUTO_REFRESH: true,
    SET_AUTO_REFRESH: true,
    SET_TEXT_FILTER: true,
    TOGGLE_HIGHLIGHT_MATCHES: true,
    TOGGLE_INVERSE_MATCHES: true,
    TOGGLE_CASE_SENSITIVE_MATCHES: true,
    TOGGLE_REGEX_MATCHES: true,
    TOGGLE_WRAP_TEXT: true,
    TOGGLE_SHOW_ANSI_COLORS: true,
    TOGGLE_PARSED_VIEW: true,
    SET_DISPLAY_MODE: true,
    TOGGLE_ROW_EXPANSION: true,
    SET_COPY_FEEDBACK: true,
  } satisfies Record<LogOptionsAction['type'], true>)
);

export const isLogOptionsAction = (action: { type: string }): action is LogOptionsAction =>
  LOG_OPTIONS_ACTION_TYPES.has(action.type);

export const initialLogOptionsState: LogOptionsState = {
  autoRefresh: true,
  textFilter: '',
  highlightMatches: false,
  inverseMatches: false,
  caseSensitiveMatches: false,
  regexMatches: false,
  wrapText: true,
  showAnsiColors: true,
  displayMode: 'raw',
  expandedRows: new Set<string>(),
  copyFeedback: 'idle',
};

// Highlighting marks matches, so it cannot apply while the filter is inverted;
// regex patterns carry their own case handling.
const toggleSearchOption = <S extends LogOptionsState>(state: S, action: LogOptionsAction): S => {
  switch (action.type) {
    case 'TOGGLE_HIGHLIGHT_MATCHES':
      return { ...state, highlightMatches: state.inverseMatches ? false : !state.highlightMatches };
    case 'TOGGLE_INVERSE_MATCHES':
      return {
        ...state,
        inverseMatches: !state.inverseMatches,
        highlightMatches: state.inverseMatches ? state.highlightMatches : false,
      };
    case 'TOGGLE_CASE_SENSITIVE_MATCHES':
      return state.regexMatches
        ? state
        : { ...state, caseSensitiveMatches: !state.caseSensitiveMatches };
    case 'TOGGLE_REGEX_MATCHES':
      return {
        ...state,
        regexMatches: !state.regexMatches,
        caseSensitiveMatches: state.regexMatches ? state.caseSensitiveMatches : false,
      };
    default:
      return state;
  }
};

// A display mode change collapses expanded table rows.
const setDisplayMode = <S extends LogOptionsState>(state: S, displayMode: LogDisplayMode): S => ({
  ...state,
  displayMode,
  expandedRows: new Set<string>(),
});

const toggleRowExpansion = <S extends LogOptionsState>(state: S, rowId: string): S => {
  const expandedRows = new Set(state.expandedRows);
  if (expandedRows.has(rowId)) {
    expandedRows.delete(rowId);
  } else {
    expandedRows.add(rowId);
  }
  return { ...state, expandedRows };
};

export function logOptionsReducer<S extends LogOptionsState>(
  state: S,
  action: LogOptionsAction
): S {
  switch (action.type) {
    case 'TOGGLE_AUTO_REFRESH':
      return { ...state, autoRefresh: !state.autoRefresh };
    case 'SET_AUTO_REFRESH':
      return state.autoRefresh === action.payload
        ? state
        : { ...state, autoRefresh: action.payload };
    case 'SET_TEXT_FILTER':
      return { ...state, textFilter: action.payload };
    case 'TOGGLE_WRAP_TEXT':
      return { ...state, wrapText: !state.wrapText };
    case 'TOGGLE_SHOW_ANSI_COLORS':
      return { ...state, showAnsiColors: !state.showAnsiColors };
    case 'TOGGLE_PARSED_VIEW':
      return setDisplayMode(state, state.displayMode === 'parsed' ? 'raw' : 'parsed');
    case 'SET_DISPLAY_MODE':
      return setDisplayMode(state, action.payload);
    case 'TOGGLE_ROW_EXPANSION':
      return toggleRowExpansion(state, action.payload);
    case 'SET_COPY_FEEDBACK':
      return { ...state, copyFeedback: action.payload };
    default:
      return toggleSearchOption(state, action);
  }
}
