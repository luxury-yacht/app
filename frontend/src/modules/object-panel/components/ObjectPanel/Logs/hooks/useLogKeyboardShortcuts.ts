/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogKeyboardShortcuts.ts
 *
 * Keyboard shortcuts for the Log Viewer.
 * Extracts shortcut registration from the main component for clarity.
 */
import { useCallback, type RefObject } from 'react';
import { useShortcut, useSearchShortcutTarget } from '@ui/shortcuts';
import type { LogViewerAction } from '../logViewerReducer';

interface UseLogKeyboardShortcutsParams {
  isActive: boolean;
  isParsedView: boolean;
  displayMode: 'raw' | 'structured' | 'pretty' | 'parsed';
  showTimestamps: boolean;
  dispatch: React.Dispatch<LogViewerAction>;
  supportsPreviousLogs: boolean;
  canParseLogs: boolean;
  handleTogglePreviousLogs: () => void;
  filterInputRef: RefObject<HTMLInputElement | null>;
  logsContentRef: RefObject<HTMLDivElement | null>;
}

/**
 * Keyboard shortcuts for the Log Viewer.
 * Extracts shortcut registration from the main component for clarity.
 */
export function useLogKeyboardShortcuts({
  isActive,
  isParsedView,
  displayMode,
  showTimestamps,
  dispatch,
  supportsPreviousLogs,
  canParseLogs,
  handleTogglePreviousLogs,
  filterInputRef,
  logsContentRef,
}: UseLogKeyboardShortcutsParams) {
  // Toggle auto-refresh with 'R' key
  useShortcut({
    key: 'r',
    handler: useCallback(() => {
      if (!isActive) return false;
      dispatch({ type: 'TOGGLE_AUTO_REFRESH' });
      return true;
    }, [isActive, dispatch]),
    description: 'Toggle auto-refresh',
    category: 'Logs Tab',
    enabled: isActive,
    view: 'global',
    priority: 20,
  });

  // Toggle timestamps with 'T' key
  useShortcut({
    key: 't',
    handler: useCallback(() => {
      if (!isActive) return false;
      dispatch({
        type: 'SET_TIMESTAMP_MODE',
        payload: showTimestamps ? 'hidden' : 'default',
      });
      return true;
    }, [isActive, showTimestamps, dispatch]),
    description: 'Toggle API timestamps',
    category: 'Logs Tab',
    enabled: isActive,
    view: 'global',
    priority: 20,
  });

  // Toggle previous logs with 'V' key
  useShortcut({
    key: 'v',
    handler: useCallback(() => {
      if (!isActive || !supportsPreviousLogs) return false;
      handleTogglePreviousLogs();
      return true;
    }, [handleTogglePreviousLogs, isActive, supportsPreviousLogs]),
    description: 'Toggle previous logs',
    category: 'Logs Tab',
    enabled: isActive && supportsPreviousLogs,
    view: 'global',
    priority: 20,
  });

  useShortcut({
    key: 'h',
    handler: useCallback(() => {
      if (!isActive) return false;
      dispatch({ type: 'TOGGLE_HIGHLIGHT_MATCHES' });
      return true;
    }, [isActive, dispatch]),
    description: 'Toggle match highlighting',
    category: 'Logs Tab',
    enabled: isActive,
    view: 'global',
    priority: 20,
  });

  useShortcut({
    key: 'i',
    handler: useCallback(() => {
      if (!isActive) return false;
      dispatch({ type: 'TOGGLE_INVERSE_MATCHES' });
      return true;
    }, [isActive, dispatch]),
    description: 'Toggle inverse filtering',
    category: 'Logs Tab',
    enabled: isActive,
    view: 'global',
    priority: 20,
  });

  useShortcut({
    key: 'x',
    handler: useCallback(() => {
      if (!isActive) return false;
      dispatch({ type: 'TOGGLE_REGEX_MATCHES' });
      return true;
    }, [isActive, dispatch]),
    description: 'Toggle regex filtering',
    category: 'Logs Tab',
    enabled: isActive,
    view: 'global',
    priority: 20,
  });

  // Toggle Parse/Raw mode with 'P' key
  useShortcut({
    key: 'p',
    handler: useCallback(() => {
      if (!isActive || !canParseLogs) return false;
      dispatch({ type: 'TOGGLE_PARSED_VIEW' });
      return true;
    }, [isActive, canParseLogs, dispatch]),
    description: 'Toggle Parse/Raw mode',
    category: 'Logs Tab',
    enabled: isActive && canParseLogs,
    view: 'global',
    priority: 20,
  });

  useShortcut({
    key: 'j',
    handler: useCallback(() => {
      if (!isActive || !canParseLogs) return false;
      dispatch({
        type: 'SET_DISPLAY_MODE',
        payload: displayMode === 'pretty' ? 'raw' : 'pretty',
      });
      return true;
    }, [isActive, canParseLogs, displayMode, dispatch]),
    description: 'Toggle pretty JSON',
    category: 'Logs Tab',
    enabled: isActive && canParseLogs,
    view: 'global',
    priority: 20,
  });

  // Toggle text wrap with 'W' key (only in raw view — has no effect in parsed view)
  useShortcut({
    key: 'w',
    handler: useCallback(() => {
      if (!isActive || isParsedView) return false;
      dispatch({ type: 'TOGGLE_WRAP_TEXT' });
      return true;
    }, [isActive, isParsedView, dispatch]),
    description: 'Toggle text wrap',
    category: 'Logs Tab',
    enabled: isActive && !isParsedView,
    view: 'global',
    priority: 20,
  });

  // Helper to get the scroll container for the current view mode
  const getScrollContainer = useCallback((): HTMLElement | null => {
    if (!logsContentRef.current) return null;
    if (isParsedView) {
      return logsContentRef.current.querySelector('.gridtable-wrapper');
    }
    return logsContentRef.current;
  }, [isParsedView, logsContentRef]);

  // Scroll to top with Home key. Tail-following is derived from scroll
  // position (see LogViewer's smart-scroll effect), so jumping to the
  // top naturally disables it until the user scrolls back to the
  // bottom. Priority 500 to override GridTable's Home/End at 400,
  // which would otherwise intercept these keys when the parsed view
  // table has focus.
  useShortcut({
    key: 'Home',
    handler: useCallback(() => {
      if (!isActive) return false;
      const container = getScrollContainer();
      if (!container) return false;
      container.scrollTo({ top: 0, behavior: 'auto' });
      return true;
    }, [isActive, getScrollContainer]),
    description: 'Scroll to top',
    category: 'Logs Tab',
    enabled: isActive,
    view: 'global',
    priority: 500,
  });

  // Scroll to bottom with End key. Landing at the bottom re-engages
  // tail-following automatically via the smart-scroll effect.
  useShortcut({
    key: 'End',
    handler: useCallback(() => {
      if (!isActive) return false;
      const container = getScrollContainer();
      if (!container) return false;
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
      return true;
    }, [isActive, getScrollContainer]),
    description: 'Scroll to bottom',
    category: 'Logs Tab',
    enabled: isActive,
    view: 'global',
    priority: 500,
  });

  // Focus filter input shortcut
  const focusFilterInput = useCallback(() => {
    filterInputRef.current?.focus();
    filterInputRef.current?.select();
  }, [filterInputRef]);

  useSearchShortcutTarget({
    isActive,
    focus: focusFilterInput,
    priority: 25,
    label: 'Logs filter',
  });
}
