/**
 * frontend/src/core/refresh/hooks/useBackgroundRefresh.test.tsx
 *
 * Test suite for useBackgroundRefresh.
 * Covers key behaviors and edge cases for useBackgroundRefresh.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '@/core/events';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';
import { getBackgroundRefreshEnabled, useBackgroundRefresh } from './useBackgroundRefresh';

const renderHookComponent = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  let hookResult: ReturnType<typeof useBackgroundRefresh> | null = null;

  const HookHost = () => {
    hookResult = useBackgroundRefresh();
    return <span data-testid="value">{hookResult.enabled ? 'true' : 'false'}</span>;
  };

  await act(async () => {
    root.render(<HookHost />);
    await Promise.resolve();
  });

  return {
    getHook() {
      if (!hookResult) {
        throw new Error('Hook result not set');
      }
      return hookResult;
    },
    unmount() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
};

describe('useBackgroundRefresh', () => {
  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const getValue = () => document.querySelector('[data-testid="value"]')?.textContent;

  it('defaults to enabled when using default preferences', async () => {
    const { unmount } = await renderHookComponent();

    expect(getValue()).toBe('true');
    expect(getBackgroundRefreshEnabled()).toBe(true);

    unmount();
  });

  it('hydrates from preference cache and responds to event bus updates', async () => {
    setAppPreferencesForTesting({ refreshBackgroundClustersEnabled: false });
    const { unmount } = await renderHookComponent();

    expect(getValue()).toBe('false');

    // Emit the setting change to confirm the hook stays in sync with the bus.
    act(() => {
      eventBus.emit('settings:refresh-background', true);
    });

    expect(getValue()).toBe('true');

    unmount();
  });

  it('persists updates when callers toggle the setting', async () => {
    const { getHook, unmount } = await renderHookComponent();

    expect(getValue()).toBe('true');
    expect(getBackgroundRefreshEnabled()).toBe(true);

    await act(async () => {
      getHook().setBackgroundRefresh(false);
      await Promise.resolve();
    });

    expect(getValue()).toBe('false');
    expect(getBackgroundRefreshEnabled()).toBe(false);

    await act(async () => {
      getHook().toggle();
      await Promise.resolve();
    });

    expect(getValue()).toBe('true');
    expect(getBackgroundRefreshEnabled()).toBe(true);

    unmount();
  });
});
