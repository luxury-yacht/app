/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerReducer.ts
 *
 * Consolidates the multiple useState calls in LogViewer into a single reducer
 * for better state management and reduced complexity.
 */

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
  autoScroll: boolean;
  autoRefresh: boolean;
  showTimestamps: boolean;
  wrapText: boolean;
  textFilter: string;

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
  | { type: 'TOGGLE_AUTO_SCROLL' }
  | { type: 'TOGGLE_AUTO_REFRESH' }
  | { type: 'TOGGLE_TIMESTAMPS' }
  | { type: 'TOGGLE_WRAP_TEXT' }
  | { type: 'SET_TEXT_FILTER'; payload: string }

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
  autoScroll: true,
  autoRefresh: true,
  showTimestamps: true,
  wrapText: true,
  textFilter: '',

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
    case 'TOGGLE_AUTO_SCROLL':
      return { ...state, autoScroll: !state.autoScroll };
    case 'TOGGLE_AUTO_REFRESH':
      return { ...state, autoRefresh: !state.autoRefresh };
    case 'TOGGLE_TIMESTAMPS':
      return { ...state, showTimestamps: !state.showTimestamps };
    case 'TOGGLE_WRAP_TEXT':
      return { ...state, wrapText: !state.wrapText };
    case 'SET_TEXT_FILTER':
      return { ...state, textFilter: action.payload };

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
      // Clear expanded rows when log data changes — row keys may have shifted
      return { ...state, parsedLogs: action.payload, expandedRows: new Set<string>() };
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
