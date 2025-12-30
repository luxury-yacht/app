/**
 * frontend/src/core/refresh/hooks/useBackgroundRefresh.ts
 *
 * Hook for managing background cluster refresh settings.
 * Keeps localStorage, eventBus, and callers in sync.
 */

import { useCallback, useEffect, useState } from 'react';
import { eventBus } from '@/core/events';

const STORAGE_KEY = 'refreshBackgroundClustersEnabled';

const readStoredValue = (): boolean => {
  if (typeof window === 'undefined') {
    return true;
  }
  const stored = window.localStorage?.getItem(STORAGE_KEY);
  if (stored == null) {
    // Default to enabled unless the user explicitly disables it.
    return true;
  }
  return stored === 'true';
};

export function useBackgroundRefresh() {
  const [enabled, setEnabled] = useState(() => readStoredValue());

  useEffect(() => {
    const unsub = eventBus.on('settings:refresh-background', setEnabled);
    return unsub;
  }, []);

  const setBackgroundRefresh = useCallback((value: boolean) => {
    setEnabled(value);
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    }
    eventBus.emit('settings:refresh-background', value);
  }, []);

  const toggle = useCallback(() => {
    setBackgroundRefresh(!enabled);
  }, [enabled, setBackgroundRefresh]);

  return { enabled, setBackgroundRefresh, toggle };
}

export const getBackgroundRefreshEnabled = (): boolean => readStoredValue();
