/**
 * frontend/src/hooks/useShortNames.test.tsx
 *
 * Test suite for useShortNames.
 * Covers key behaviors and edge cases for useShortNames.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventBus } from '@/core/events';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';
import { useShortNames } from './useShortNames';

const renderHookComponent = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const HookHost = () => {
    const enabled = useShortNames();
    return <span data-testid="value">{enabled ? 'true' : 'false'}</span>;
  };

  await act(async () => {
    root.render(<HookHost />);
    await Promise.resolve();
  });

  return {
    container,
    unmount: () =>
      act(() => {
        root.unmount();
        container.remove();
      }),
  };
};

describe('useShortNames', () => {
  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const getValue = () => document.querySelector('[data-testid="value"]')?.textContent;

  it('initialises from preference cache', async () => {
    setAppPreferencesForTesting({ useShortResourceNames: true });
    const { unmount } = await renderHookComponent();

    expect(getValue()).toBe('true');

    unmount();
  });

  it('responds to event bus updates', async () => {
    setAppPreferencesForTesting({ useShortResourceNames: false });
    const { unmount } = await renderHookComponent();

    expect(getValue()).toBe('false');

    act(() => {
      eventBus.emit('settings:short-names', true);
    });

    expect(getValue()).toBe('true');

    unmount();
  });
});
