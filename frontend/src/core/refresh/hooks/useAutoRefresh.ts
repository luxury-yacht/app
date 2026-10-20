/**
 * frontend/src/core/refresh/hooks/useAutoRefresh.ts
 *
 * React hook for the auto-refresh preference. The refresh layer reacts to the
 * preference's change event; this hook only reads and writes the preference.
 */

import { useCallback } from 'react';
import { setAutoRefreshEnabled } from '@/core/settings/appPreferences';
import { useAutoRefreshEnabled } from './useRefreshPreferences';

export function useAutoRefresh() {
  const enabled = useAutoRefreshEnabled();

  const setAutoRefresh = useCallback((value: boolean) => {
    setAutoRefreshEnabled(value);
  }, []);

  const toggle = useCallback(() => {
    setAutoRefresh(!enabled);
  }, [enabled, setAutoRefresh]);

  return { enabled, setAutoRefresh, toggle };
}
