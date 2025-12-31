/**
 * frontend/src/core/refresh/hooks/useAutoRefresh.ts
 *
 * React hook for useAutoRefresh.
 * Encapsulates state and side effects for the core layer.
 */

import { useState, useEffect, useCallback } from 'react';
import { refreshManager } from '../RefreshManager';
import { eventBus } from '@/core/events';
import { getAutoRefreshEnabled, setAutoRefreshEnabled } from '@/core/settings/appPreferences';

/**
 * Hook for managing auto-refresh state.
 * Provides a single source of truth for the auto-refresh setting,
 * syncing the backend preference cache, refreshManager, and eventBus.
 */
export function useAutoRefresh() {
  const [enabled, setEnabled] = useState(() => {
    return getAutoRefreshEnabled();
  });

  // Listen for changes from other sources (e.g., command palette, other components)
  useEffect(() => {
    const unsub = eventBus.on('settings:auto-refresh', setEnabled);
    return unsub;
  }, []);

  // Sync refreshManager when enabled changes
  useEffect(() => {
    if (enabled) {
      refreshManager.resume();
    } else {
      refreshManager.pause();
    }
  }, [enabled]);

  const setAutoRefresh = useCallback((value: boolean) => {
    setAutoRefreshEnabled(value);
  }, []);

  const toggle = useCallback(() => {
    setAutoRefresh(!enabled);
  }, [enabled, setAutoRefresh]);

  return { enabled, setAutoRefresh, toggle };
}

/**
 * Initialize auto-refresh state from persisted preferences on app startup.
 * Call this once in App.tsx to ensure refreshManager is paused if disabled.
 */
export function initializeAutoRefresh() {
  const enabled = getAutoRefreshEnabled();
  if (!enabled) {
    refreshManager.pause();
  }
}
