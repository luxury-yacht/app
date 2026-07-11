/**
 * frontend/src/hooks/useDimInactiveNamespaces.test.tsx
 *
 * Test suite for useDimInactiveNamespaces.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { eventBus } from '@/core/events';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';
import { useDimInactiveNamespaces } from './useDimInactiveNamespaces';

const renderHookComponent = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const HookHost = () => {
    const enabled = useDimInactiveNamespaces();
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

describe('useDimInactiveNamespaces', () => {
  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const getValue = () => document.querySelector('[data-testid="value"]')?.textContent;

  it('initialises from preference cache', async () => {
    setAppPreferencesForTesting({ dimInactiveNamespaces: false });
    const { unmount } = await renderHookComponent();

    expect(getValue()).toBe('false');

    unmount();
  });

  it('responds to event bus updates', async () => {
    setAppPreferencesForTesting({ dimInactiveNamespaces: true });
    const { unmount } = await renderHookComponent();

    expect(getValue()).toBe('true');

    act(() => {
      eventBus.emit('settings:dim-inactive-namespaces', false);
    });

    expect(getValue()).toBe('false');

    unmount();
  });
});
