/**
 * frontend/src/shared/components/tables/hooks/useGridTableHoverSync.test.tsx
 *
 * Test suite for useGridTableHoverSync.
 * Covers key behaviors and edge cases for useGridTableHoverSync.
 */

import { useGridTableHoverSync } from '@shared/components/tables/hooks/useGridTableHoverSync';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

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
      requireValue(
        result.current,
        'expected test value in useGridTableHoverSync.test.tsx'
      ).handleRowMouseEnter(row);
    });
    expect(
      requireValue(result.current, 'expected test value in useGridTableHoverSync.test.tsx')
        .hoverState.visible
    ).toBe(true);
    expect(
      requireValue(result.current, 'expected test value in useGridTableHoverSync.test.tsx')
        .hoverState.top
    ).toBe(10);
    expect(
      requireValue(result.current, 'expected test value in useGridTableHoverSync.test.tsx')
        .hoverState.height
    ).toBe(25);
    expect(
      requireValue(result.current, 'expected test value in useGridTableHoverSync.test.tsx')
        .hoverState.selected
    ).toBe(true);

    document.body.classList.add('gridtable-disable-hover');
    act(() => {
      requireValue(
        result.current,
        'expected test value in useGridTableHoverSync.test.tsx'
      ).handleRowMouseLeave();
    });
    expect(
      requireValue(result.current, 'expected test value in useGridTableHoverSync.test.tsx')
        .hoverState.visible
    ).toBe(true);
    document.body.classList.remove('gridtable-disable-hover');

    act(() => {
      requireValue(
        result.current,
        'expected test value in useGridTableHoverSync.test.tsx'
      ).handleRowMouseLeave();
    });
    expect(
      requireValue(result.current, 'expected test value in useGridTableHoverSync.test.tsx')
        .hoverState.visible
    ).toBe(false);

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
      requireValue(
        result.current,
        'expected test value in useGridTableHoverSync.test.tsx'
      ).updateHoverForElement(row);
    });
    act(() => {
      requireValue(
        result.current,
        'expected test value in useGridTableHoverSync.test.tsx'
      ).handleRowMouseLeave(row);
    });

    expect(
      requireValue(result.current, 'expected test value in useGridTableHoverSync.test.tsx')
        .hoverState.visible
    ).toBe(true);

    row.dataset.rowSelected = undefined;
    row.dataset.rowFocused = 'true';
    act(() => {
      requireValue(
        result.current,
        'expected test value in useGridTableHoverSync.test.tsx'
      ).handleRowMouseLeave(row);
    });
    expect(
      requireValue(result.current, 'expected test value in useGridTableHoverSync.test.tsx')
        .hoverState.visible
    ).toBe(true);

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
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    act(() => {
      requireValue(
        result.current,
        'expected test value in useGridTableHoverSync.test.tsx'
      ).scheduleHeaderSync();
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
      requireValue(
        result.current,
        'expected test value in useGridTableHoverSync.test.tsx'
      ).updateHoverForElement(row);
    });
    expect(
      requireValue(result.current, 'expected test value in useGridTableHoverSync.test.tsx')
        .hoverState.visible
    ).toBe(true);
    expect(
      requireValue(result.current, 'expected test value in useGridTableHoverSync.test.tsx')
        .hoverRowRef.current
    ).toBe(row);

    // Activate hover suppression (e.g. during keyboard shortcut).
    document.body.classList.add('gridtable-disable-hover');

    // Without force, updateHoverForElement(null) is a no-op during suppression.
    act(() => {
      requireValue(
        result.current,
        'expected test value in useGridTableHoverSync.test.tsx'
      ).updateHoverForElement(null);
    });
    expect(
      requireValue(result.current, 'expected test value in useGridTableHoverSync.test.tsx')
        .hoverState.visible
    ).toBe(true);
    expect(
      requireValue(result.current, 'expected test value in useGridTableHoverSync.test.tsx')
        .hoverRowRef.current
    ).toBe(row);

    // With force: true, the detached node is cleared even during suppression.
    act(() => {
      requireValue(
        result.current,
        'expected test value in useGridTableHoverSync.test.tsx'
      ).updateHoverForElement(null, { force: true });
    });
    expect(
      requireValue(result.current, 'expected test value in useGridTableHoverSync.test.tsx')
        .hoverState.visible
    ).toBe(false);
    expect(
      requireValue(result.current, 'expected test value in useGridTableHoverSync.test.tsx')
        .hoverRowRef.current
    ).toBeNull();

    unmount();
    document.body.removeChild(wrapper);
  });

  it('falls back to immediate sync when RAF missing and hides header', () => {
    const { wrapperRef, headerRef } = setupWrapper();
    const firstHook = renderHook(() =>
      useGridTableHoverSync({ wrapperRef, headerInnerRef: headerRef, hideHeader: true })
    );
    act(() => {
      requireValue(
        firstHook.result.current,
        'expected test value in useGridTableHoverSync.test.tsx'
      ).scheduleHeaderSync();
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
      requireValue(
        result.current,
        'expected test value in useGridTableHoverSync.test.tsx'
      ).scheduleHeaderSync();
    });
    expect(headerInner.style.transform).toBe('translateX(0px)');
    window.requestAnimationFrame = originalRAF;

    unmount();
    document.body.removeChild(wrapper);
  });
});
