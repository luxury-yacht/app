/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogKeyboardShortcuts.ts
 *
 * Hook for useLogKeyboardShortcuts.
 */
import { useCallback, type RefObject } from 'react';
import { useShortcut, useSearchShortcutTarget } from '@ui/shortcuts';
import type { LogViewerAction } from '../logViewerReducer';

interface UseLogKeyboardShortcutsParams {
  isActive: boolean;
  dispatch: React.Dispatch<LogViewerAction>;
  supportsPreviousLogs: boolean;
  canParseLogs: boolean;
  handleTogglePreviousLogs: () => void;
  filterInputRef: RefObject<HTMLInputElement | null>;
}

/**
 * Keyboard shortcuts for the Log Viewer.
 * Extracts shortcut registration from the main component for clarity.
 */
export function useLogKeyboardShortcuts({
  isActive,
  dispatch,
  supportsPreviousLogs,
  canParseLogs,
  handleTogglePreviousLogs,
  filterInputRef,
}: UseLogKeyboardShortcutsParams) {
  // Toggle auto-scroll with 'S' key
  useShortcut({
    key: 's',
    handler: useCallback(() => {
      if (!isActive) return false;
      dispatch({ type: 'TOGGLE_AUTO_SCROLL' });
      return true;
    }, [isActive, dispatch]),
    description: 'Toggle auto-scroll',
    category: 'Logs Tab',
    enabled: isActive,
    view: 'global',
    priority: 20,
  });

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
      dispatch({ type: 'TOGGLE_TIMESTAMPS' });
      return true;
    }, [isActive, dispatch]),
    description: 'Toggle API timestamps',
    category: 'Logs Tab',
    enabled: isActive,
    view: 'global',
    priority: 20,
  });

  // Toggle previous logs with 'X' key
  useShortcut({
    key: 'x',
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

  // Toggle text wrap with 'W' key
  useShortcut({
    key: 'w',
    handler: useCallback(() => {
      if (!isActive) return false;
      dispatch({ type: 'TOGGLE_WRAP_TEXT' });
      return true;
    }, [isActive, dispatch]),
    description: 'Toggle text wrap',
    category: 'Logs Tab',
    enabled: isActive,
    view: 'global',
    priority: 20,
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
