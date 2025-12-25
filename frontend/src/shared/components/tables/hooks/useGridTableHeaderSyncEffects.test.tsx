/**
 * frontend/src/shared/components/tables/hooks/useGridTableHeaderSyncEffects.test.tsx
 *
 * Test suite for useGridTableHeaderSyncEffects.
 * Covers key behaviors and edge cases for useGridTableHeaderSyncEffects.
 */

import { forwardRef } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useGridTableHeaderSyncEffects } from '@shared/components/tables/hooks/useGridTableHeaderSyncEffects';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useGridTableHeaderSyncEffects', () => {
  it('wires scroll and resize handlers when header visible', async () => {
    const wrapper = document.createElement('div');
    const table = document.createElement('div');
    wrapper.appendChild(table);
    document.body.appendChild(wrapper);

    const wrapperRef = { current: wrapper };
    const scheduleHeaderSync = vi.fn();
    const updateHoverForElement = vi.fn();
    const hoverRowRef = { current: table };
    const updateColumnWindowRange = vi.fn();

    const addEventListenerSpy = vi.spyOn(wrapper, 'addEventListener');

    const Harness = forwardRef<HTMLDivElement, { hideHeader: boolean }>((props, ref) => {
      useGridTableHeaderSyncEffects({
        hideHeader: props.hideHeader,
        wrapperRef,
        scheduleHeaderSync,
        updateHoverForElement,
        hoverRowRef,
        updateColumnWindowRange,
      });
      return <div ref={ref} />;
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(<Harness hideHeader={false} />);
    });

    expect(addEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function), {
      passive: true,
    });

    const scrollHandler = addEventListenerSpy.mock.calls[0][1] as EventListener;
    await act(async () => {
      scrollHandler(new Event('scroll'));
    });

    expect(scheduleHeaderSync).toHaveBeenCalled();
    expect(updateHoverForElement).toHaveBeenCalled();
    expect(updateColumnWindowRange).toHaveBeenCalled();
  });
});
