import { findGridTableRowByKey, revealVertically } from '@shared/components/tables/GridTable.utils';
import { getAppZoomFactor } from '@shared/utils/appZoom';

import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

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
  viewportHeight: number;
  getRowTop: (index: number) => number;
}

interface GridTableKeyboardNavigation {
  getPageSizeRef: RefObject<number>;
  moveSelectionByDelta: (delta: number) => boolean;
  jumpToIndex: (index: number) => boolean;
}

// The focused row's index when it can be revealed by its virtual position; -1 otherwise.
const virtualRowIndex = (
  shouldVirtualize: boolean,
  virtualRowHeight: number,
  focusedRowIndex: number | null
): number => (shouldVirtualize && virtualRowHeight > 0 ? (focusedRowIndex ?? -1) : -1);

// Scrolls the wrapper just far enough to show the span from rowTop to rowBottom.
const revealVirtualRow = (wrapper: HTMLElement, rowTop: number, rowBottom: number) => {
  if (rowTop < wrapper.scrollTop) {
    wrapper.scrollTo({ top: rowTop, behavior: 'auto' });
  } else if (rowBottom > wrapper.scrollTop + wrapper.clientHeight) {
    wrapper.scrollTo({ top: rowBottom - wrapper.clientHeight, behavior: 'auto' });
  }
};

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
  viewportHeight,
  getRowTop,
}: UseGridTableKeyboardNavigationOptions): GridTableKeyboardNavigation {
  const getPageSizeRef = useRef(1);

  const moveSelectionByDelta = useCallback(
    (delta: number) => {
      if (tableDataLength === 0) {
        return false;
      }
      lastNavigationMethodRef.current = 'keyboard';
      let base: number;

      if (focusedRowIndex === null || focusedRowIndex === undefined) {
        if (delta > 0) {
          base = -1;
        } else {
          base = tableDataLength;
        }
      } else {
        base = focusedRowIndex;
      }

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
    void tableDataLength;
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      getPageSizeRef.current = 1;
      return;
    }

    const computePageSize = () => {
      const height = viewportHeight || wrapper.clientHeight || 1;
      if (height <= 0) {
        getPageSizeRef.current = 1;
        return;
      }

      if (shouldVirtualize && virtualRowHeight > 0) {
        getPageSizeRef.current = Math.max(1, Math.round(height / virtualRowHeight));
        return;
      }

      const firstRow = wrapper.querySelector<HTMLElement>('.gridtable-row');
      // The viewport height is in CSS pixels; rects are zoomed under page zoom.
      const rowHeight = (firstRow?.getBoundingClientRect().height ?? 0) / getAppZoomFactor() || 44;
      getPageSizeRef.current = Math.max(1, Math.round(height / Math.max(rowHeight, 1)));
    };

    computePageSize();
  }, [shouldVirtualize, virtualRowHeight, viewportHeight, wrapperRef, tableDataLength]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!shortcutsActive || !focusedRowKey || !wrapper) {
      return;
    }
    const allowAutoScroll = lastNavigationMethodRef.current === 'keyboard';
    const rowElement = findGridTableRowByKey(wrapper, focusedRowKey);
    if (rowElement) {
      if (allowAutoScroll) {
        revealVertically(rowElement);
      }
      updateHoverForElement(rowElement);
      return;
    }
    // A virtualized row outside the rendered window is revealed by its position.
    const virtualIndex = virtualRowIndex(shouldVirtualize, virtualRowHeight, focusedRowIndex);
    if (allowAutoScroll && virtualIndex >= 0) {
      revealVirtualRow(wrapper, getRowTop(virtualIndex), getRowTop(virtualIndex + 1));
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
