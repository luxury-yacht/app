/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogKeyboardShortcuts.ts
 *
 * Keyboard shortcuts shared by Container Logs and Node Logs. Timestamps (T)
 * and previous logs (V) are optional features a viewer passes when it has them.
 */

import { useSearchShortcutTarget, useShortcut } from '@ui/shortcuts';
import { type Dispatch, type RefObject, useCallback } from 'react';
import type { LogOptionsAction, LogOptionsState } from '../logOptionsReducer';

interface UseLogKeyboardShortcutsParams {
  isActive: boolean;
  options: Pick<LogOptionsState, 'displayMode' | 'regexMatches'>;
  hasAnsiLogEntries: boolean;
  hasCopyableContent: boolean;
  canParseLogs: boolean;
  dispatch: Dispatch<LogOptionsAction>;
  copyLogs: () => void;
  filterInputRef: RefObject<HTMLInputElement | null>;
  logsContentRef: RefObject<HTMLElement | null>;
  timestamps?: { toggle: () => void };
  previousLogs?: { toggle: () => void };
}

export function useLogKeyboardShortcuts({
  isActive,
  options,
  hasAnsiLogEntries,
  hasCopyableContent,
  canParseLogs,
  dispatch,
  copyLogs,
  filterInputRef,
  logsContentRef,
  timestamps,
  previousLogs,
}: UseLogKeyboardShortcutsParams) {
  const { displayMode, regexMatches } = options;
  const isParsedView = displayMode === 'parsed';
  const toggleTimestamps = timestamps?.toggle;
  const togglePreviousLogs = previousLogs?.toggle;
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
      if (!isActive || !toggleTimestamps) {
        return false;
      }
      toggleTimestamps();
      return true;
    }, [isActive, toggleTimestamps]),
    description: 'Toggle API timestamps',
    category: 'Logs',
    helpOrder: 30,
    enabled: isActive && Boolean(toggleTimestamps),
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
    key: 'h',
    handler: useCallback(() => {
      if (!isActive) {
        return false;
      }
      dispatch({ type: 'TOGGLE_HIGHLIGHT_MATCHES' });
      return true;
    }, [isActive, dispatch]),
    description: 'Toggle match highlighting',
    category: 'Logs',
    helpOrder: 50,
    enabled: isActive,
    priority: 20,
  });

  useShortcut({
    key: 'i',
    handler: useCallback(() => {
      if (!isActive) {
        return false;
      }
      dispatch({ type: 'TOGGLE_INVERSE_MATCHES' });
      return true;
    }, [isActive, dispatch]),
    description: 'Toggle inverse filtering',
    category: 'Logs',
    helpOrder: 51,
    enabled: isActive,
    priority: 20,
  });

  useShortcut({
    key: 'x',
    handler: useCallback(() => {
      if (!isActive) {
        return false;
      }
      dispatch({ type: 'TOGGLE_REGEX_MATCHES' });
      return true;
    }, [isActive, dispatch]),
    description: 'Toggle regex filtering',
    category: 'Logs',
    helpOrder: 52,
    enabled: isActive,
    priority: 20,
  });

  useShortcut({
    key: 'c',
    handler: useCallback(() => {
      if (!isActive || regexMatches) {
        return false;
      }
      dispatch({ type: 'TOGGLE_CASE_SENSITIVE_MATCHES' });
      return true;
    }, [dispatch, isActive, regexMatches]),
    description: 'Toggle case-sensitive matching',
    category: 'Logs',
    helpOrder: 53,
    enabled: isActive && !regexMatches,
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
      if (!isActive || isParsedView) {
        return false;
      }
      dispatch({ type: 'TOGGLE_WRAP_TEXT' });
      return true;
    }, [isActive, isParsedView, dispatch]),
    description: 'Toggle text wrap',
    category: 'Logs',
    helpOrder: 63,
    enabled: isActive && !isParsedView,
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
