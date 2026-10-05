/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogKeyboardShortcuts.ts
 *
 * Keyboard shortcuts shared by Container Logs and Node Logs. Timestamps (T)
 * and previous logs (V) are optional features a viewer passes when it has them.
 */

import { useKeyboardSurface, useSearchShortcutTarget, useShortcut } from '@ui/shortcuts';
import { type Dispatch, type RefObject, useCallback } from 'react';
import type { LogOptionsAction, LogOptionsState } from '../logOptionsReducer';
import { closeLogSearch, logSearchAvailable, openLogSearch } from '../logToolbar';

interface UseLogKeyboardShortcutsParams {
  isActive: boolean;
  options: Pick<LogOptionsState, 'displayMode' | 'regexMatches' | 'filterMode' | 'searchOpen'>;
  hasAnsiLogEntries: boolean;
  hasCopyableContent: boolean;
  canParseLogs: boolean;
  /** A log line has arrived; the T, W, search and filter-option shortcuts wait for one, like their buttons. */
  hasLogs: boolean;
  dispatch: Dispatch<LogOptionsAction>;
  copyLogs: () => void;
  filterInputRef: RefObject<HTMLInputElement | null>;
  logsContentRef: RefObject<HTMLElement | null>;
  /** The whole viewer: controls, search row and log output. */
  viewerRef: RefObject<HTMLElement | null>;
  searchRowId: string;
  timestamps?: { toggle: () => void };
  previousLogs?: { toggle: () => void };
}

export function useLogKeyboardShortcuts({
  isActive,
  options,
  hasAnsiLogEntries,
  hasCopyableContent,
  canParseLogs,
  hasLogs,
  dispatch,
  copyLogs,
  filterInputRef,
  logsContentRef,
  viewerRef,
  searchRowId,
  timestamps,
  previousLogs,
}: UseLogKeyboardShortcutsParams) {
  const { displayMode, regexMatches, filterMode, searchOpen } = options;
  const isParsedView = displayMode === 'parsed';
  const toggleTimestamps = timestamps?.toggle;
  const togglePreviousLogs = previousLogs?.toggle;
  const searchAvailable = logSearchAvailable(hasLogs, searchOpen);
  // Toggle auto-refresh with 'R' key
  useShortcut({
    key: 'r',
    handler: useCallback(() => {
      if (!isActive) {
        return false;
      }
      dispatch({ type: 'TOGGLE_AUTO_REFRESH' });
      return true;
    }, [isActive, dispatch]),
    description: 'Toggle auto-refresh',
    category: 'Logs',
    helpOrder: 10,
    enabled: isActive,
    priority: 20,
  });

  useShortcut({
    key: 't',
    handler: useCallback(() => {
      if (!isActive || !hasLogs || !toggleTimestamps) {
        return false;
      }
      toggleTimestamps();
      return true;
    }, [isActive, hasLogs, toggleTimestamps]),
    description: 'Toggle API timestamps',
    category: 'Logs',
    helpOrder: 30,
    enabled: isActive && hasLogs && Boolean(toggleTimestamps),
    priority: 20,
  });

  useShortcut({
    key: 'v',
    handler: useCallback(() => {
      if (!isActive || !togglePreviousLogs) {
        return false;
      }
      togglePreviousLogs();
      return true;
    }, [isActive, togglePreviousLogs]),
    description: 'Toggle previous logs',
    category: 'Logs',
    helpOrder: 40,
    enabled: isActive && Boolean(togglePreviousLogs),
    priority: 20,
  });

  useShortcut({
    key: 'i',
    handler: useCallback(() => {
      if (!isActive || !searchAvailable) {
        return false;
      }
      dispatch({ type: 'SET_FILTER_MODE', payload: filterMode === 'invert' ? 'all' : 'invert' });
      return true;
    }, [isActive, searchAvailable, dispatch, filterMode]),
    description: 'Toggle inverse filtering',
    category: 'Logs',
    helpOrder: 51,
    enabled: isActive && searchAvailable,
    priority: 20,
  });

  useShortcut({
    key: 'x',
    handler: useCallback(() => {
      if (!isActive || !searchAvailable) {
        return false;
      }
      dispatch({ type: 'TOGGLE_REGEX_MATCHES' });
      return true;
    }, [isActive, searchAvailable, dispatch]),
    description: 'Toggle regex filtering',
    category: 'Logs',
    helpOrder: 52,
    enabled: isActive && searchAvailable,
    priority: 20,
  });

  useShortcut({
    key: 'c',
    handler: useCallback(() => {
      if (!isActive || !searchAvailable || regexMatches) {
        return false;
      }
      dispatch({ type: 'TOGGLE_CASE_SENSITIVE_MATCHES' });
      return true;
    }, [dispatch, isActive, searchAvailable, regexMatches]),
    description: 'Toggle case-sensitive matching',
    category: 'Logs',
    helpOrder: 53,
    enabled: isActive && searchAvailable && !regexMatches,
    priority: 20,
  });

  // Toggle Parse/Raw mode with 'P' key
  useShortcut({
    key: 'p',
    handler: useCallback(() => {
      if (!isActive || !canParseLogs) {
        return false;
      }
      dispatch({ type: 'TOGGLE_PARSED_VIEW' });
      return true;
    }, [isActive, canParseLogs, dispatch]),
    description: 'Toggle Parse/Raw mode',
    category: 'Logs',
    helpOrder: 60,
    enabled: isActive && canParseLogs,
    priority: 20,
  });

  useShortcut({
    key: 'o',
    handler: useCallback(() => {
      if (!isActive || isParsedView || !hasAnsiLogEntries) {
        return false;
      }
      dispatch({ type: 'TOGGLE_SHOW_ANSI_COLORS' });
      return true;
    }, [dispatch, hasAnsiLogEntries, isActive, isParsedView]),
    description: 'Toggle ANSI colors',
    category: 'Logs',
    helpOrder: 62,
    enabled: isActive && !isParsedView && hasAnsiLogEntries,
    priority: 20,
  });

  useShortcut({
    key: 'c',
    modifiers: { shift: true },
    handler: useCallback(() => {
      if (!isActive || !hasCopyableContent) {
        return false;
      }
      copyLogs();
      return true;
    }, [copyLogs, hasCopyableContent, isActive]),
    description: 'Copy logs to clipboard',
    category: 'Logs',
    helpOrder: 70,
    enabled: isActive && hasCopyableContent,
    priority: 20,
  });

  useShortcut({
    key: 'j',
    handler: useCallback(() => {
      if (!isActive || !canParseLogs) {
        return false;
      }
      dispatch({
        type: 'SET_DISPLAY_MODE',
        payload: displayMode === 'pretty' ? 'raw' : 'pretty',
      });
      return true;
    }, [isActive, canParseLogs, displayMode, dispatch]),
    description: 'Toggle pretty JSON',
    category: 'Logs',
    helpOrder: 61,
    enabled: isActive && canParseLogs,
    priority: 20,
  });

  // Toggle text wrap with 'W' key (only in raw view — has no effect in parsed view)
  useShortcut({
    key: 'w',
    handler: useCallback(() => {
      if (!isActive || !hasLogs || isParsedView) {
        return false;
      }
      dispatch({ type: 'TOGGLE_WRAP_TEXT' });
      return true;
    }, [isActive, hasLogs, isParsedView, dispatch]),
    description: 'Toggle text wrap',
    category: 'Logs',
    helpOrder: 63,
    enabled: isActive && hasLogs && !isParsedView,
    priority: 20,
  });

  // Helper to get the scroll container for the current view mode
  const getScrollContainer = useCallback((): HTMLElement | null => {
    if (!logsContentRef.current) {
      return null;
    }
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
      if (!isActive) {
        return false;
      }
      const container = getScrollContainer();
      if (!container) {
        return false;
      }
      container.scrollTo({ top: 0, behavior: 'auto' });
      return true;
    }, [isActive, getScrollContainer]),
    description: 'Scroll logs to top',
    category: 'Logs',
    helpOrder: 20,
    enabled: isActive,
    priority: 500,
  });

  // Scroll to bottom with End key. Landing at the bottom re-engages
  // tail-following automatically via the smart-scroll effect.
  useShortcut({
    key: 'End',
    handler: useCallback(() => {
      if (!isActive) {
        return false;
      }
      const container = getScrollContainer();
      if (!container) {
        return false;
      }
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
      return true;
    }, [isActive, getScrollContainer]),
    description: 'Scroll logs to bottom',
    category: 'Logs',
    helpOrder: 21,
    enabled: isActive,
    priority: 500,
  });

  // The search shortcut opens the search row and focuses its filter box. The
  // logs tab keeps the shortcut while search is unavailable, so it doesn't fall
  // through to a table behind the panel; it then does nothing.
  const focusFilterInput = useCallback(() => {
    if (searchAvailable) {
      openLogSearch(dispatch, filterInputRef);
    }
  }, [searchAvailable, dispatch, filterInputRef]);

  useSearchShortcutTarget({
    isActive,
    focus: focusFilterInput,
    priority: 25,
    label: 'Logs filter',
  });

  // While the search row is open, Escape with focus in the viewer closes it.
  // The viewer sits inside the object panel, so it is asked before the panel
  // closes its tab.
  const closeSearch = useCallback(() => {
    closeLogSearch(dispatch, searchRowId);
    return true;
  }, [dispatch, searchRowId]);

  useKeyboardSurface({
    kind: 'region',
    rootRef: viewerRef,
    active: isActive && searchOpen,
    onEscape: closeSearch,
  });
}
