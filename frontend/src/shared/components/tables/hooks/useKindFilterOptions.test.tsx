import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useKindFilterOptions } from './useKindFilterOptions';

const renderHook = <T,>(hook: () => T) => {
  const result: { current: T | undefined } = { current: undefined };

  const TestComponent: React.FC = () => {
    result.current = hook();
    return null;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

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
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('useKindFilterOptions', () => {
  it('deduplicates, trims, and sorts kind values from row payloads', () => {
    const hook = renderHook(() =>
      useKindFilterOptions([
        { kind: 'Secret' },
        { kind: 'ConfigMap' },
        { kind: ' Secret ' },
        { kind: '' },
        { kind: undefined },
      ])
    );

    expect(hook.get()).toEqual(['ConfigMap', 'Secret']);
    hook.cleanup();
  });
});
