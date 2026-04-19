import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { useStableSelectedValue } from './useStableSelectedValue';

const renderHook = <T,>(hook: () => T) => {
  const result: { current: T | undefined } = { current: undefined };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const TestComponent: React.FC = () => {
    result.current = hook();
    return null;
  };

  act(() => {
    root.render(<TestComponent />);
  });

  return {
    get() {
      if (result.current === undefined) {
        throw new Error('Hook result not set');
      }
      return result.current;
    },
    rerender() {
      act(() => {
        root.render(<TestComponent />);
      });
    },
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('useStableSelectedValue', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('reuses a previous array reference when the next array contains the same item references', () => {
    const sharedRows = [{ name: 'one' }, { name: 'two' }];
    let nextValue = [...sharedRows];

    const hook = renderHook(() => useStableSelectedValue(nextValue));
    const first = hook.get();

    nextValue = [...sharedRows];
    hook.rerender();

    expect(hook.get()).toBe(first);
    hook.cleanup();
  });

  it('reuses a previous shallow object reference when the next object has the same fields', () => {
    let nextValue: { kinds: string[] } = { kinds: ['ConfigMap', 'Secret'] };

    const hook = renderHook(() => useStableSelectedValue(nextValue));
    const first = hook.get();

    nextValue = { kinds: first.kinds };
    hook.rerender();

    expect(hook.get()).toBe(first);
    hook.cleanup();
  });

  it('returns a new reference when array contents change', () => {
    const sharedRows = [{ name: 'one' }, { name: 'two' }];
    let nextValue = [...sharedRows];

    const hook = renderHook(() => useStableSelectedValue(nextValue));
    const first = hook.get();

    nextValue = [sharedRows[0], { name: 'three' }];
    hook.rerender();

    expect(hook.get()).not.toBe(first);
    hook.cleanup();
  });
});
