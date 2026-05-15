import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { findGridTableRowByKey } from '@shared/components/tables/GridTable.utils';

type NavigationMethodRef = RefObject<'pointer' | 'keyboard'>;

interface UseGridTableKeyboardNavigationOptions {
  tableDataLength: number;
  focusedRowIndex: number | null;
  focusedRowKey: string | null;
  shortcutsActive: boolean;
  focusByIndex: (index: number) => void;
  lastNavigationMethodRef: NavigationMethodRef;
  wrapperRef: RefObject<HTMLDivElement | null>;
  updateHoverForElement: (element: HTMLDivElement | null) => void;
  shouldVirtualize: boolean;
  virtualRowHeight: number;
  getRowTop: (index: number) => number;
}

interface GridTableKeyboardNavigation {
  getPageSizeRef: RefObject<number>;
  moveSelectionByDelta: (delta: number) => boolean;
  jumpToIndex: (index: number) => boolean;
}

export function useGridTableKeyboardNavigation({
  tableDataLength,
  focusedRowIndex,
  focusedRowKey,
  shortcutsActive,
  focusByIndex,
  lastNavigationMethodRef,
  wrapperRef,
  updateHoverForElement,
  shouldVirtualize,
  virtualRowHeight,
  getRowTop,
}: UseGridTableKeyboardNavigationOptions): GridTableKeyboardNavigation {
  const getPageSizeRef = useRef(1);

  const moveSelectionByDelta = useCallback(
    (delta: number) => {
      if (tableDataLength === 0) {
        return false;
      }
      lastNavigationMethodRef.current = 'keyboard';
      const base = focusedRowIndex == null ? (delta > 0 ? -1 : tableDataLength) : focusedRowIndex;
      const next = Math.min(Math.max(base + delta, 0), tableDataLength - 1);
      focusByIndex(next);
      return true;
    },
    [focusByIndex, focusedRowIndex, lastNavigationMethodRef, tableDataLength]
  );

  const jumpToIndex = useCallback(
    (index: number) => {
      if (tableDataLength === 0) {
        return false;
      }
      const clamped = Math.min(Math.max(index, 0), tableDataLength - 1);
      lastNavigationMethodRef.current = 'keyboard';
      focusByIndex(clamped);
      return true;
    },
    [focusByIndex, lastNavigationMethodRef, tableDataLength]
  );

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      getPageSizeRef.current = 1;
      return;
    }

    const computePageSize = () => {
      const height = wrapper.clientHeight || 1;
      if (height <= 0) {
        getPageSizeRef.current = 1;
        return;
      }

      if (shouldVirtualize && virtualRowHeight > 0) {
        getPageSizeRef.current = Math.max(1, Math.round(height / virtualRowHeight));
        return;
      }

      const firstRow = wrapper.querySelector<HTMLElement>('.gridtable-row');
      const rowHeight = firstRow?.getBoundingClientRect().height || 44;
      getPageSizeRef.current = Math.max(1, Math.round(height / Math.max(rowHeight, 1)));
    };

    computePageSize();

    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(computePageSize) : null;
    if (observer) {
      observer.observe(wrapper);
    }

    return () => {
      observer?.disconnect();
    };
  }, [shouldVirtualize, tableDataLength, virtualRowHeight, wrapperRef]);

  useEffect(() => {
    if (!shortcutsActive || !focusedRowKey) {
      return;
    }
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const allowAutoScroll = lastNavigationMethodRef.current === 'keyboard';
    const rowElement = findGridTableRowByKey(wrapper, focusedRowKey);
    if (rowElement) {
      if (allowAutoScroll && typeof rowElement.scrollIntoView === 'function') {
        rowElement.scrollIntoView({ block: 'nearest' });
      }
      updateHoverForElement(rowElement);
      return;
    }
    if (
      allowAutoScroll &&
      shouldVirtualize &&
      virtualRowHeight > 0 &&
      focusedRowIndex != null &&
      focusedRowIndex >= 0
    ) {
      const rowTop = getRowTop(focusedRowIndex);
      const rowBottom = getRowTop(focusedRowIndex + 1);
      const viewportTop = wrapper.scrollTop;
      const viewportBottom = viewportTop + wrapper.clientHeight;

      if (rowTop < viewportTop) {
        wrapper.scrollTo({ top: rowTop, behavior: 'auto' });
      } else if (rowBottom > viewportBottom) {
        wrapper.scrollTo({ top: rowBottom - wrapper.clientHeight, behavior: 'auto' });
      }
    }
  }, [
    focusedRowIndex,
    focusedRowKey,
    getRowTop,
    lastNavigationMethodRef,
    shortcutsActive,
    shouldVirtualize,
    updateHoverForElement,
    virtualRowHeight,
    wrapperRef,
  ]);

  return {
    getPageSizeRef,
    moveSelectionByDelta,
    jumpToIndex,
  };
}
