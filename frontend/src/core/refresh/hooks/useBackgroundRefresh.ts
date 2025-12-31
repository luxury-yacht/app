/**
 * frontend/src/core/refresh/hooks/useBackgroundRefresh.ts
 *
 * Hook for managing background cluster refresh settings.
 * Keeps the backend preference cache, eventBus, and callers in sync.
 */

import { useCallback, useEffect, useState } from 'react';
import { eventBus } from '@/core/events';
import {
  getBackgroundRefreshEnabled,
  setBackgroundRefreshEnabled,
} from '@/core/settings/appPreferences';

export function useBackgroundRefresh() {
  const [enabled, setEnabled] = useState(() => getBackgroundRefreshEnabled());

  useEffect(() => {
    const unsub = eventBus.on('settings:refresh-background', setEnabled);
    return unsub;
  }, []);

  const setBackgroundRefresh = useCallback((value: boolean) => {
    setBackgroundRefreshEnabled(value);
  }, []);

  const toggle = useCallback(() => {
    setBackgroundRefresh(!enabled);
  }, [enabled, setBackgroundRefresh]);

  return { enabled, setBackgroundRefresh, toggle };
}

export { getBackgroundRefreshEnabled };
