/**
 * frontend/src/shared/components/tables/hooks/useGridTableHoverSync.ts
 *
 * React hook for useGridTableHoverSync.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

// Keeps the header/body hover overlay aligned with the current row, while
// throttling updates to avoid jank and honoring hover suppression flags.

export interface HoverState {
  visible: boolean;
  top: number;
  height: number;
  selected: boolean;
  focused: boolean;
}

export interface UseGridTableHoverSyncParams {
  wrapperRef: RefObject<HTMLDivElement | null>;
  headerInnerRef: RefObject<HTMLDivElement | null>;
  hideHeader: boolean;
}

export interface UseGridTableHoverSyncResult {
  hoverState: HoverState;
  hoverRowRef: RefObject<HTMLDivElement | null>;
  updateHoverForElement: (element: HTMLDivElement | null) => void;
  handleRowMouseEnter: (element: HTMLDivElement) => void;
  handleRowMouseLeave: (element?: HTMLDivElement | null) => void;
  scheduleHeaderSync: () => void;
}

export function useGridTableHoverSync({
  wrapperRef,
  headerInnerRef,
  hideHeader,
}: UseGridTableHoverSyncParams): UseGridTableHoverSyncResult {
  const [hoverState, setHoverState] = useState<HoverState>({
    visible: false,
    top: 0,
    height: 0,
    selected: false,
    focused: false,
  });

  const hoverRowRef = useRef<HTMLDivElement | null>(null);
  const headerSyncFrameRef = useRef<number | null>(null);

  const isHoverSuppressed = useCallback(() => {
    if (typeof document === 'undefined') {
      return false;
    }
    return document.body.classList.contains('gridtable-disable-hover');
  }, []);

  const updateHoverForElement = useCallback(
    (element: HTMLDivElement | null) => {
      if (isHoverSuppressed()) {
        return;
      }
      if (!element) {
        hoverRowRef.current = null;
        setHoverState((prev) =>
          prev.visible
            ? {
                visible: false,
                top: prev.top,
                height: prev.height,
                selected: false,
                focused: false,
              }
            : prev
        );
        return;
      }
      const wrapper = wrapperRef.current;
      if (!wrapper) {
        return;
      }
      const wrapperRect = wrapper.getBoundingClientRect();
      const rowRect = element.getBoundingClientRect();
      const top = rowRect.top - wrapperRect.top + wrapper.scrollTop;
      const height = rowRect.height;
      const selected = element.dataset.rowSelected === 'true';
      const focused = element.dataset.rowFocused === 'true';
      hoverRowRef.current = element;
      setHoverState((prev) => {
        if (
          prev.visible &&
          Math.abs(prev.top - top) < 0.5 &&
          Math.abs(prev.height - height) < 0.5 &&
          prev.selected === selected &&
          prev.focused === focused
        ) {
          return prev;
        }
        return { visible: true, top, height, selected, focused };
      });
    },
    [isHoverSuppressed, wrapperRef]
  );

  const handleRowMouseEnter = useCallback(
    (element: HTMLDivElement) => {
      if (isHoverSuppressed()) {
        return;
      }
      updateHoverForElement(element);
    },
    [updateHoverForElement, isHoverSuppressed]
  );

  const handleRowMouseLeave = useCallback(
    (element?: HTMLDivElement | null) => {
      if (isHoverSuppressed()) {
        return;
      }
      if (element) {
        const selected = element.dataset.rowSelected === 'true';
        const focused = element.dataset.rowFocused === 'true';
        if (selected || focused) {
          updateHoverForElement(element);
          return;
        }
      }
      hoverRowRef.current = null;
      setHoverState((prev) =>
        prev.visible
          ? { visible: false, top: prev.top, height: prev.height, selected: false, focused: false }
          : prev
      );
    },
    [updateHoverForElement, isHoverSuppressed]
  );

  const alignHeaderWithBody = useCallback(() => {
    if (hideHeader) {
      return;
    }
    const wrapper = wrapperRef.current;
    const headerInner = headerInnerRef.current;
    if (!wrapper || !headerInner) {
      return;
    }
    const offset = wrapper.scrollLeft;
    headerInner.style.transform = offset ? `translateX(${-offset}px)` : 'translateX(0px)';
  }, [hideHeader, headerInnerRef, wrapperRef]);

  const flushHeaderSync = useCallback(() => {
    headerSyncFrameRef.current = null;
    alignHeaderWithBody();
    const current = hoverRowRef.current;
    if (current && !isHoverSuppressed()) {
      updateHoverForElement(current);
    }
  }, [alignHeaderWithBody, updateHoverForElement, isHoverSuppressed]);

  const scheduleHeaderSync = useCallback(() => {
    if (hideHeader) {
      return;
    }
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      flushHeaderSync();
      return;
    }
    if (headerSyncFrameRef.current != null) {
      return;
    }
    headerSyncFrameRef.current = window.requestAnimationFrame(flushHeaderSync);
  }, [hideHeader, flushHeaderSync]);

  useEffect(() => {
    return () => {
      if (headerSyncFrameRef.current != null && typeof window !== 'undefined') {
        if (typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(headerSyncFrameRef.current);
        }
      }
      headerSyncFrameRef.current = null;
    };
  }, []);

  return {
    hoverState,
    hoverRowRef,
    updateHoverForElement,
    handleRowMouseEnter,
    handleRowMouseLeave,
    scheduleHeaderSync,
  };
}
