import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { eventBus } from '@/core/events';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';
import { useAutoRefreshLoadingState } from './useAutoRefreshLoadingState';

describe('useAutoRefreshLoadingState', () => {
  it('shows overlapping manual refreshes while paused and ignores passive refresh activity', () => {
    setAppPreferencesForTesting({ autoRefreshEnabled: false });
    let current!: ReturnType<typeof useAutoRefreshLoadingState>;
    function Consumer() {
      current = useAutoRefreshLoadingState();
      return null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    const start = (isManual: boolean) =>
      act(() => eventBus.emit('refresh:start', { name: 'test', isManual }));
    const complete = (isManual: boolean) =>
      act(() => eventBus.emit('refresh:complete', { name: 'test', isManual, success: true }));
    try {
      act(() => root.render(<Consumer />));
      expect(current.suppressPassiveLoading).toBe(true);
      start(false);
      complete(false);
      expect(current.isManualRefreshActive).toBe(false);
      start(true);
      start(true);
      expect(current).toEqual({
        isPaused: true,
        isManualRefreshActive: true,
        suppressPassiveLoading: false,
      });
      complete(true);
      expect(current.isManualRefreshActive).toBe(true);
      complete(true);
      expect(current.suppressPassiveLoading).toBe(true);
      complete(true);
      start(true);
      expect(current.isManualRefreshActive).toBe(true);
      complete(true);
    } finally {
      act(() => root.unmount());
      resetAppPreferencesCacheForTesting();
    }
  });
});
