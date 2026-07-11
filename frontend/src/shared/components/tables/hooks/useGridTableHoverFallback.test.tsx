/**
 * frontend/src/shared/components/tables/hooks/useGridTableHoverFallback.test.tsx
 *
 * Test suite for useGridTableHoverFallback.
 * Covers key behaviors and edge cases for useGridTableHoverFallback.
 */

import { useGridTableHoverFallback } from '@shared/components/tables/hooks/useGridTableHoverFallback';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

    const Harness = ({ ref, ...props }: { visible: boolean; ref?: React.Ref<HTMLDivElement> }) => {
      useGridTableHoverFallback({
        hoverStateVisible: props.visible,
        wrapperRef,
        updateHoverForElement: updateHover,
        tableLength: 2,
      });
      return <div ref={ref} />;
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(<Harness visible={false} />);
    });

    expect(updateHover).toHaveBeenCalledWith(focusedRow);
  });
});
