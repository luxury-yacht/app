import { useState, useEffect, useCallback } from 'react';
import { refreshManager } from '../RefreshManager';
import { eventBus } from '@/core/events';

const STORAGE_KEY = 'autoRefreshEnabled';

/**
 * Hook for managing auto-refresh state.
 * Provides a single source of truth for the auto-refresh setting,
 * syncing localStorage, refreshManager, and eventBus.
 */
export function useAutoRefresh() {
  const [enabled, setEnabled] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
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
    setEnabled(value);
    localStorage.setItem(STORAGE_KEY, String(value));
    eventBus.emit('settings:auto-refresh', value);
  }, []);

  const toggle = useCallback(() => {
    setAutoRefresh(!enabled);
  }, [enabled, setAutoRefresh]);

  return { enabled, setAutoRefresh, toggle };
}

/**
 * Initialize auto-refresh state from localStorage on app startup.
 * Call this once in App.tsx to ensure refreshManager is paused if disabled.
 */
export function initializeAutoRefresh() {
  const enabled = localStorage.getItem(STORAGE_KEY) !== 'false';
  if (!enabled) {
    refreshManager.pause();
  }
}
