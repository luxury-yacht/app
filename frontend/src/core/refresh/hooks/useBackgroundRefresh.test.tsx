/**
 * frontend/src/core/refresh/hooks/useBackgroundRefresh.test.tsx
 *
 * Test suite for useBackgroundRefresh.
 * Covers key behaviors and edge cases for useBackgroundRefresh.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useBackgroundRefresh, getBackgroundRefreshEnabled } from './useBackgroundRefresh';
import { eventBus } from '@/core/events';

const STORAGE_KEY = 'refreshBackgroundClustersEnabled';

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
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const getValue = () => document.querySelector('[data-testid="value"]')?.textContent;

  it('defaults to enabled when the storage key is absent', async () => {
    const { unmount } = await renderHookComponent();

    expect(getValue()).toBe('true');
    expect(getBackgroundRefreshEnabled()).toBe(true);

    unmount();
  });

  it('hydrates from storage and responds to event bus updates', async () => {
    localStorage.setItem(STORAGE_KEY, 'false');
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
    localStorage.setItem(STORAGE_KEY, 'false');
    const { getHook, unmount } = await renderHookComponent();

    act(() => {
      getHook().setBackgroundRefresh(true);
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(getValue()).toBe('true');

    act(() => {
      getHook().toggle();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
    expect(getValue()).toBe('false');

    unmount();
  });
});
