/**
 * useDockablePanelWindowBounds.ts
 *
 * Hook to constrain dockable panel size and position within window bounds.
 * Handles debouncing, dock positions, and respects user resize operations.
 */

import { getZoomAwareViewport, useZoom } from '@core/contexts/ZoomContext';
import { useEffect, useRef } from 'react';
import { getContentBounds, LAYOUT } from './dockablePanelLayout';
import type { DockPosition } from './useDockablePanelState';

interface DockablePanelState {
  position: DockPosition;
  size: { width: number; height: number };
  floatingPosition: { x: number; y: number };
  isOpen: boolean;
  setSize: (size: { width: number; height: number }) => void;
  setFloatingPosition: (position: { x: number; y: number }) => void;
}

interface WindowBoundsOptions {
  minWidth: number;
  isResizing: boolean;
  isMaximized: boolean;
}

type PanelSize = DockablePanelState['size'];
type PanelPosition = DockablePanelState['floatingPosition'];
type ContentBounds = ReturnType<typeof getContentBounds>;

interface BoundsAdjustment {
  size: PanelSize;
  position: PanelPosition;
}

const clampFloatingPanel = (
  size: PanelSize,
  position: PanelPosition,
  content: ContentBounds
): BoundsAdjustment => {
  const nextSize = {
    width: Math.min(size.width, content.width),
    height: Math.min(size.height, content.height),
  };
  return {
    size: nextSize,
    position: {
      x: Math.min(Math.max(position.x, 0), Math.max(0, content.width - nextSize.width)),
      y: Math.min(Math.max(position.y, 0), Math.max(0, content.height - nextSize.height)),
    },
  };
};

const clampDockedPanel = (
  panelState: DockablePanelState,
  content: ContentBounds,
  minWidth: number
): BoundsAdjustment => {
  if (panelState.position === 'right' && panelState.size.width > content.width) {
    return {
      size: { ...panelState.size, width: Math.max(minWidth, content.width) },
      position: panelState.floatingPosition,
    };
  }
  if (panelState.position === 'bottom' && panelState.size.height > content.height) {
    return {
      size: { ...panelState.size, height: content.height },
      position: panelState.floatingPosition,
    };
  }
  return { size: panelState.size, position: panelState.floatingPosition };
};

const calculateBoundsAdjustment = (
  panelState: DockablePanelState,
  content: ContentBounds,
  minWidth: number
): BoundsAdjustment =>
  panelState.position === 'floating'
    ? clampFloatingPanel(panelState.size, panelState.floatingPosition, content)
    : clampDockedPanel(panelState, content, minWidth);

const sizesAreEqual = (left: PanelSize, right: PanelSize) =>
  left.width === right.width && left.height === right.height;

const positionsAreEqual = (left: PanelPosition, right: PanelPosition) =>
  left.x === right.x && left.y === right.y;

const applyBoundsAdjustment = (panelState: DockablePanelState, adjustment: BoundsAdjustment) => {
  if (!sizesAreEqual(adjustment.size, panelState.size)) {
    panelState.setSize(adjustment.size);
  }
  if (
    panelState.position === 'floating' &&
    !positionsAreEqual(adjustment.position, panelState.floatingPosition)
  ) {
    panelState.setFloatingPosition(adjustment.position);
  }
};

/**
 * Hook to constrain panel size and position within window bounds.
 * Handles debouncing, dock positions, and respects user resize operations.
 */
export function useWindowBoundsConstraint(
  panelState: DockablePanelState,
  options: WindowBoundsOptions
) {
  const { minWidth, isResizing, isMaximized } = options;
  const panelStateRef = useRef(panelState);
  const { zoomLevel } = useZoom();
  // Store zoom level in a ref so the resize handler can access the latest value.
  const zoomLevelRef = useRef(zoomLevel);
  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
  }, [zoomLevel]);

  // We use a ref to hold the latest panel state so the resize handler
  // can access it without needing to resubscribe on every state change.
  useEffect(() => {
    panelStateRef.current = panelState;
  }, [panelState]);

  useEffect(() => {
    // Skip window listeners when closed or maximized.
    if (isMaximized || !panelState.isOpen) {
      return;
    }

    let resizeTimer: NodeJS.Timeout;
    let initialResizeTimer: NodeJS.Timeout | null = null;

    const constrainToCurrentBounds = () => {
      const currentPanelState = panelStateRef.current;
      if (!currentPanelState.isOpen || isResizing) {
        return;
      }
      const viewport = getZoomAwareViewport(zoomLevelRef.current);
      const content = getContentBounds(viewport.zoomFactor);
      applyBoundsAdjustment(
        currentPanelState,
        calculateBoundsAdjustment(currentPanelState, content, minWidth)
      );
    };

    const handleResize = () => {
      // If the window object is not available, return early.
      if (typeof window === 'undefined') {
        return;
      }

      // Debounce resize handling so we don't thrash during rapid resizes.
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(constrainToCurrentBounds, LAYOUT.RESIZE_DEBOUNCE_MS);
    };

    window.addEventListener('resize', handleResize);

    // Also observe the .content element for size changes (e.g. sidebar resize)
    let resizeObserver: ResizeObserver | null = null;
    const contentEl = typeof document !== 'undefined' ? document.querySelector('.content') : null;
    if (contentEl && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(contentEl);
    }

    // Schedule an initial clamp to match the current content bounds.
    initialResizeTimer = setTimeout(handleResize, LAYOUT.RESIZE_DEBOUNCE_MS);

    return () => {
      clearTimeout(resizeTimer);
      if (initialResizeTimer) {
        clearTimeout(initialResizeTimer);
      }
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [minWidth, isResizing, isMaximized, panelState.isOpen]);
}
