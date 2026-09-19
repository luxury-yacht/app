import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { describe, expect, it } from 'vitest';

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

  it('retains equivalent filter options and publishes changed nested selections', () => {
    let nextValue = {
      kinds: ['ConfigMap', 'Secret'],
      queryFacets: { apiGroups: ['apps', 'batch'] },
    };

    const hook = renderHook(() => useStableSelectedValue(nextValue));
    const first = hook.get();

    nextValue = {
      kinds: ['ConfigMap', 'Secret'],
      queryFacets: { apiGroups: ['apps', 'batch'] },
    };
    hook.rerender();

    expect(hook.get()).toBe(first);
    for (const apiGroups of [['batch', 'apps'], ['batch'], ['networking.k8s.io'], []]) {
      nextValue = { ...nextValue, queryFacets: { apiGroups } };
      hook.rerender();
      expect(hook.get()).toBe(nextValue);
      expect(hook.get().queryFacets.apiGroups).toEqual(apiGroups);
    }
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
