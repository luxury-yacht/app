import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { useAutoRefresh } from './useAutoRefresh';
import { useAutoRefreshLoadingState } from './useAutoRefreshLoadingState';
import { useBackgroundRefresh } from './useBackgroundRefresh';

const preferences = vi.hoisted(() => ({ auto: true, background: true }));
vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => preferences.auto,
  getBackgroundRefreshEnabled: () => preferences.background,
  setAutoRefreshEnabled: vi.fn(),
  setBackgroundRefreshEnabled: vi.fn(),
}));
vi.mock('../RefreshManager', () => ({ refreshManager: { pause: vi.fn(), resume: vi.fn() } }));

describe('refresh preference subscriptions', () => {
  it('observes preference hydration between render and subscription and later rollback', () => {
    preferences.auto = true;
    preferences.background = true;
    let current!: { auto: boolean; background: boolean; paused: boolean };
    function Consumer() {
      const { enabled: auto } = useAutoRefresh();
      const { enabled: background } = useBackgroundRefresh();
      const { isPaused: paused } = useAutoRefreshLoadingState();
      current = { auto, background, paused };
      return null;
    }
    const publish = (enabled: boolean) => {
      preferences.auto = enabled;
      preferences.background = enabled;
      eventBus.emit('settings:auto-refresh', enabled);
      eventBus.emit('settings:refresh-background', enabled);
    };
    function Hydration() {
      useLayoutEffect(() => publish(false), []);
      return null;
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      act(() =>
        root.render(
          <>
            <Consumer />
            <Hydration />
          </>
        )
      );
      expect(current).toEqual({ auto: false, background: false, paused: true });
      act(() => publish(true));
      expect(current).toEqual({ auto: true, background: true, paused: false });
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
  it('shows overlapping manual refreshes while paused and ignores passive refresh activity', () => {
    preferences.auto = false;
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
      preferences.auto = true;
    }
  });
});
