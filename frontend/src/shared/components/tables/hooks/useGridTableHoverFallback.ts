import { useEffect } from 'react';
import type { RefObject } from 'react';

// When the hovered row is unmounted (e.g., virtualization window shifts),
// find a focused/selected row in the DOM and restore the hover overlay to it.
interface UseGridTableHoverFallbackOptions {
  hoverStateVisible: boolean;
  wrapperRef: RefObject<HTMLDivElement | null>;
  updateHoverForElement: (element: HTMLDivElement | null) => void;
  tableLength: number;
}

export function useGridTableHoverFallback({
  hoverStateVisible,
  wrapperRef,
  updateHoverForElement,
  tableLength,
}: UseGridTableHoverFallbackOptions) {
  useEffect(() => {
    if (hoverStateVisible) {
      return;
    }
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const fallback = wrapper.querySelector<HTMLDivElement>(
      '[data-row-focused="true"], [data-row-selected="true"]'
    );
    if (fallback) {
      updateHoverForElement(fallback);
    }
  }, [hoverStateVisible, wrapperRef, updateHoverForElement, tableLength]);
}
