import { useEffect, useMemo, useState } from 'react';
import { eventBus } from '@/core/events';
import { getAutoRefreshEnabled } from '@/core/settings/appPreferences';

export interface AutoRefreshLoadingState {
  isPaused: boolean;
  isManualRefreshActive: boolean;
  suppressPassiveLoading: boolean;
}

export function useAutoRefreshLoadingState(): AutoRefreshLoadingState {
  const [isPaused, setIsPaused] = useState(() => !getAutoRefreshEnabled());
  const [manualRefreshCount, setManualRefreshCount] = useState(0);

  useEffect(() => {
    setIsPaused(!getAutoRefreshEnabled());

    const unsubAutoRefresh = eventBus.on('settings:auto-refresh', (enabled) => {
      setIsPaused(!enabled);
    });
    const unsubRefreshStart = eventBus.on('refresh:start', ({ isManual }) => {
      if (!isManual) {
        return;
      }
      setManualRefreshCount((count) => count + 1);
    });
    const unsubRefreshComplete = eventBus.on('refresh:complete', ({ isManual }) => {
      if (!isManual) {
        return;
      }
      setManualRefreshCount((count) => Math.max(0, count - 1));
    });

    return () => {
      unsubAutoRefresh();
      unsubRefreshStart();
      unsubRefreshComplete();
    };
  }, []);

  return useMemo(() => {
    const isManualRefreshActive = manualRefreshCount > 0;
    return {
      isPaused,
      isManualRefreshActive,
      suppressPassiveLoading: isPaused && !isManualRefreshActive,
    };
  }, [isPaused, manualRefreshCount]);
}
