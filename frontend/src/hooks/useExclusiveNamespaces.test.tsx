/**
 * frontend/src/hooks/useExclusiveNamespaces.test.tsx
 *
 * Test suite for useExclusiveNamespaces.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { eventBus } from '@/core/events';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';
import { useExclusiveNamespaces } from './useExclusiveNamespaces';

const renderHookComponent = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const HookHost = () => {
    const enabled = useExclusiveNamespaces();
    return <span data-testid="value">{enabled ? 'true' : 'false'}</span>;
  };

  await act(async () => {
    root.render(<HookHost />);
    await Promise.resolve();
  });

  return {
    unmount: () =>
      act(() => {
        root.unmount();
        container.remove();
      }),
  };
};

describe('useExclusiveNamespaces', () => {
  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const getValue = () => document.querySelector('[data-testid="value"]')?.textContent;

  it('initialises from preference cache', async () => {
    setAppPreferencesForTesting({ exclusiveNamespaces: false });
    const { unmount } = await renderHookComponent();

    expect(getValue()).toBe('false');

    unmount();
  });

  it('responds to event bus updates', async () => {
    setAppPreferencesForTesting({ exclusiveNamespaces: true });
    const { unmount } = await renderHookComponent();

    expect(getValue()).toBe('true');

    act(() => {
      eventBus.emit('settings:exclusive-namespaces', false);
    });

    expect(getValue()).toBe('false');

    unmount();
  });
});
