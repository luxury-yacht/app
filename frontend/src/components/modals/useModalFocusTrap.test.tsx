/**
 * frontend/src/components/modals/useModalFocusTrap.test.tsx
 *
 * Test suite for useModalFocusTrap.
 * Covers key behaviors and edge cases for useModalFocusTrap.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, expect, it, vi, beforeAll, afterEach } from 'vitest';

import { useModalFocusTrap } from './useModalFocusTrap';

const scopeMock = vi.hoisted(() => vi.fn());

vi.mock('@ui/shortcuts', () => ({
  useKeyboardNavigationScope: (...args: unknown[]) => scopeMock(...args),
}));

const TestComponent: React.FC<{ disabled?: boolean }> = ({ disabled = false }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  useModalFocusTrap({
    ref,
    focusableSelector: '[data-focusable="true"]',
    priority: 42,
    disabled,
  });
  return (
    <div ref={ref}>
      <button data-focusable="true">First</button>
      <button data-focusable="true">Second</button>
    </div>
  );
};

describe('useModalFocusTrap', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    scopeMock.mockClear();
  });

  it('registers keyboard scope and manages focus order', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(<TestComponent />);
      await Promise.resolve();
    });

    const lastCall = scopeMock.mock.calls[scopeMock.mock.calls.length - 1];
    const config = lastCall?.[0] as {
      priority: number;
      disabled: boolean;
      onNavigate: (args: { direction: 'forward' | 'backward' }) => 'handled' | 'bubble';
      onEnter: (args: { direction: 'forward' | 'backward' }) => void;
    };
    expect(config).toBeTruthy();
    expect(config.priority).toBe(42);
    expect(config.disabled).toBe(false);

    let result: 'handled' | 'bubble' = 'bubble';
    act(() => {
      result = config.onNavigate({ direction: 'forward' });
    });
    expect(result).toBe('handled');
    expect((document.activeElement as HTMLElement)?.textContent).toBe('First');

    act(() => {
      config.onEnter({ direction: 'backward' });
    });
    expect((document.activeElement as HTMLElement)?.textContent).toBe('Second');
  });

  it('tracks disabled state', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(<TestComponent disabled />);
      await Promise.resolve();
    });

    const lastCall = scopeMock.mock.calls[scopeMock.mock.calls.length - 1];
    const config = lastCall?.[0] as { disabled: boolean };
    expect(config.disabled).toBe(true);
  });
});
