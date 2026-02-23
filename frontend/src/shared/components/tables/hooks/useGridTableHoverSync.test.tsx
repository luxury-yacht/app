/**
 * frontend/src/shared/components/tables/hooks/useGridTableHoverSync.test.tsx
 *
 * Test suite for useGridTableHoverSync.
 * Covers key behaviors and edge cases for useGridTableHoverSync.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useGridTableHoverSync } from '@shared/components/tables/hooks/useGridTableHoverSync';

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
    result,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
};

describe('useGridTableHoverSync', () => {
  let wrapper: HTMLDivElement;
  let headerInner: HTMLDivElement;

  afterEach(() => {
    document.body.classList.remove('gridtable-disable-hover');
  });

  const setupWrapper = () => {
    wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.width = '200px';
    wrapper.style.height = '200px';
    Object.defineProperty(wrapper, 'scrollTop', { value: 0, writable: true });
    Object.defineProperty(wrapper, 'scrollLeft', { value: 0, writable: true });
    document.body.appendChild(wrapper);

    headerInner = document.createElement('div');
    return {
      wrapperRef: { current: wrapper },
      headerRef: { current: headerInner },
    };
  };

  it('tracks hover state and respects suppression class', () => {
    const { wrapperRef, headerRef } = setupWrapper();
    const { result, unmount } = renderHook(() =>
      useGridTableHoverSync({ wrapperRef, headerInnerRef: headerRef, hideHeader: false })
    );

    const row = document.createElement('div');
    row.dataset.rowSelected = 'true';
    row.tabIndex = 0;
    wrapper.appendChild(row);
    Object.defineProperty(row, 'getBoundingClientRect', {
      value: () => ({ top: 15, height: 25 }) as DOMRect,
    });
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      value: () => ({ top: 5 }) as DOMRect,
    });

    // Focus an element within the wrapper so handleRowMouseEnter proceeds
    row.focus();

    act(() => {
      result.current!.handleRowMouseEnter(row);
    });
    expect(result.current!.hoverState.visible).toBe(true);
    expect(result.current!.hoverState.top).toBe(10);
    expect(result.current!.hoverState.height).toBe(25);
    expect(result.current!.hoverState.selected).toBe(true);

    document.body.classList.add('gridtable-disable-hover');
    act(() => {
      result.current!.handleRowMouseLeave();
    });
    expect(result.current!.hoverState.visible).toBe(true);
    document.body.classList.remove('gridtable-disable-hover');

    act(() => {
      result.current!.handleRowMouseLeave();
    });
    expect(result.current!.hoverState.visible).toBe(false);

    unmount();
    document.body.removeChild(wrapper);
  });

  it('keeps hover visible when leaving a selected or focused row', () => {
    const { wrapperRef, headerRef } = setupWrapper();
    const { result, unmount } = renderHook(() =>
      useGridTableHoverSync({ wrapperRef, headerInnerRef: headerRef, hideHeader: false })
    );

    const row = document.createElement('div');
    row.dataset.rowSelected = 'true';
    row.tabIndex = 0;
    wrapper.appendChild(row);
    Object.defineProperty(row, 'getBoundingClientRect', {
      value: () => ({ top: 15, height: 25 }) as DOMRect,
    });
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      value: () => ({ top: 5 }) as DOMRect,
    });

    // Focus an element within the wrapper so handleRowMouseLeave proceeds
    row.focus();

    act(() => {
      result.current!.updateHoverForElement(row);
    });
    act(() => {
      result.current!.handleRowMouseLeave(row);
    });

    expect(result.current!.hoverState.visible).toBe(true);

    row.dataset.rowSelected = undefined;
    row.dataset.rowFocused = 'true';
    act(() => {
      result.current!.handleRowMouseLeave(row);
    });
    expect(result.current!.hoverState.visible).toBe(true);

    unmount();
    document.body.removeChild(wrapper);
  });

  it('aligns header and reschedules hover in animation frame', () => {
    const { wrapperRef, headerRef } = setupWrapper();
    const { result, unmount } = renderHook(() =>
      useGridTableHoverSync({ wrapperRef, headerInnerRef: headerRef, hideHeader: false })
    );

    wrapper.scrollLeft = 20;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(16);
      return 1 as unknown as number;
    });
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    act(() => {
      result.current!.scheduleHeaderSync();
    });
    expect(headerInner.style.transform).toBe('translateX(-20px)');

    cancelSpy.mockRestore();
    rafSpy.mockRestore();
    unmount();
    document.body.removeChild(wrapper);
  });

  it('clears detached hover with force: true even while hover is suppressed', () => {
    const { wrapperRef, headerRef } = setupWrapper();
    const { result, unmount } = renderHook(() =>
      useGridTableHoverSync({ wrapperRef, headerInnerRef: headerRef, hideHeader: false })
    );

    const row = document.createElement('div');
    row.dataset.rowSelected = 'false';
    row.dataset.rowFocused = 'false';
    row.tabIndex = 0;
    wrapper.appendChild(row);
    Object.defineProperty(row, 'getBoundingClientRect', {
      value: () => ({ top: 15, height: 25 }) as DOMRect,
    });
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      value: () => ({ top: 5 }) as DOMRect,
    });

    // Establish hover on the row.
    act(() => {
      result.current!.updateHoverForElement(row);
    });
    expect(result.current!.hoverState.visible).toBe(true);
    expect(result.current!.hoverRowRef.current).toBe(row);

    // Activate hover suppression (e.g. during keyboard shortcut).
    document.body.classList.add('gridtable-disable-hover');

    // Without force, updateHoverForElement(null) is a no-op during suppression.
    act(() => {
      result.current!.updateHoverForElement(null);
    });
    expect(result.current!.hoverState.visible).toBe(true);
    expect(result.current!.hoverRowRef.current).toBe(row);

    // With force: true, the detached node is cleared even during suppression.
    act(() => {
      result.current!.updateHoverForElement(null, { force: true });
    });
    expect(result.current!.hoverState.visible).toBe(false);
    expect(result.current!.hoverRowRef.current).toBeNull();

    unmount();
    document.body.removeChild(wrapper);
  });

  it('falls back to immediate sync when RAF missing and hides header', () => {
    const { wrapperRef, headerRef } = setupWrapper();
    const firstHook = renderHook(() =>
      useGridTableHoverSync({ wrapperRef, headerInnerRef: headerRef, hideHeader: true })
    );
    act(() => {
      firstHook.result.current!.scheduleHeaderSync();
    });
    expect(headerInner.style.transform).toBe('');
    firstHook.unmount();

    const originalRAF = window.requestAnimationFrame;
    // @ts-expect-error intentionally removing RAF for test
    window.requestAnimationFrame = undefined;
    const { result, unmount } = renderHook(() =>
      useGridTableHoverSync({ wrapperRef, headerInnerRef: headerRef, hideHeader: false })
    );
    act(() => {
      result.current!.scheduleHeaderSync();
    });
    expect(headerInner.style.transform).toBe('translateX(0px)');
    window.requestAnimationFrame = originalRAF;

    unmount();
    document.body.removeChild(wrapper);
  });
});
