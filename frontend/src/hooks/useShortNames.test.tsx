/**
 * frontend/src/hooks/useShortNames.test.tsx
 *
 * Tests for useShortNames.
 */
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { useShortNames } from './useShortNames';
import { eventBus } from '@/core/events';

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

  it('initialises from localStorage', async () => {
    localStorage.setItem('useShortResourceNames', 'true');
    const { unmount } = await renderHookComponent();

    expect(getValue()).toBe('true');

    unmount();
  });

  it('responds to custom and storage events', async () => {
    localStorage.setItem('useShortResourceNames', 'false');
    const { unmount } = await renderHookComponent();

    expect(getValue()).toBe('false');

    act(() => {
      eventBus.emit('settings:short-names', true);
    });

    expect(getValue()).toBe('true');

    act(() => {
      const event = new StorageEvent('storage', {
        key: 'useShortResourceNames',
        newValue: 'false',
      });
      window.dispatchEvent(event);
    });

    expect(getValue()).toBe('false');

    unmount();
  });
});
