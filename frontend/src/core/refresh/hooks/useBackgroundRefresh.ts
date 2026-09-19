/**
 * frontend/src/core/refresh/hooks/useBackgroundRefresh.ts
 *
 * Hook for managing background cluster refresh settings.
 * Keeps the backend preference cache, eventBus, and callers in sync.
 */

import { useCallback } from 'react';
import { setBackgroundRefreshEnabled } from '@/core/settings/appPreferences';

import { useBackgroundRefreshEnabled } from './useRefreshPreferences';

export function useBackgroundRefresh() {
  const enabled = useBackgroundRefreshEnabled();

  const setBackgroundRefresh = useCallback((value: boolean) => {
    setBackgroundRefreshEnabled(value);
  }, []);

  const toggle = useCallback(() => {
    setBackgroundRefresh(!enabled);
  }, [enabled, setBackgroundRefresh]);

  return { enabled, setBackgroundRefresh, toggle };
}

export { getBackgroundRefreshEnabled } from '@/core/settings/appPreferences';
