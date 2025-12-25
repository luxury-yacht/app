/**
 * frontend/src/shared/components/tables/hooks/useGridTableHoverFallback.test.tsx
 *
 * Test suite for useGridTableHoverFallback.
 * Covers key behaviors and edge cases for useGridTableHoverFallback.
 */

import { forwardRef } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useGridTableHoverFallback } from '@shared/components/tables/hooks/useGridTableHoverFallback';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useGridTableHoverFallback', () => {
  it('triggers hover fallback when hover state not visible', async () => {
    const updateHover = vi.fn();

    const wrapper = document.createElement('div');
    const focusedRow = document.createElement('div');
    focusedRow.setAttribute('data-row-focused', 'true');
    wrapper.appendChild(focusedRow);

    const wrapperRef = { current: wrapper };

    const Harness = forwardRef<HTMLDivElement, { visible: boolean }>((props, ref) => {
      useGridTableHoverFallback({
        hoverStateVisible: props.visible,
        wrapperRef,
        updateHoverForElement: updateHover,
        tableLength: 2,
      });
      return <div ref={ref} />;
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(<Harness visible={false} />);
    });

    expect(updateHover).toHaveBeenCalledWith(focusedRow);
  });
});
