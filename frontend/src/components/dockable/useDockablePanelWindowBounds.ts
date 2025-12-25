/**
 * useDockablePanelWindowBounds.ts
 *
 * Hook to constrain dockable panel size and position within window bounds.
 * Handles debouncing, dock positions, and respects user resize operations.
 */

import { useEffect, useRef } from 'react';
import type { DockPosition } from './useDockablePanelState';
import { LAYOUT } from './dockablePanelLayout';

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
  minHeight: number;
  isResizing: boolean;
  isMaximized: boolean;
}

/**
 * Hook to constrain panel size and position within window bounds.
 * Handles debouncing, dock positions, and respects user resize operations.
 */
export function useWindowBoundsConstraint(
  panelState: DockablePanelState,
  options: WindowBoundsOptions
) {
  const { minWidth, minHeight, isResizing, isMaximized } = options;
  const panelStateRef = useRef(panelState);

  // We use a ref to hold the latest panel state so the resize handler
  // can access it without needing to resubscribe on every state change.
  useEffect(() => {
    panelStateRef.current = panelState;
  }, [panelState]);

  useEffect(() => {
    // If the panel is maximized, there's nothing to do.
    if (isMaximized) {
      return;
    }

    let resizeTimer: NodeJS.Timeout;

    const handleWindowResize = () => {
      // If the window object is not available, return early.
      if (typeof window === 'undefined') {
        return;
      }

      // Debounce resize handling so we don't thrash during rapid resizes.
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        // Get the latest panel state.
        const currentPanelState = panelStateRef.current;

        // Skip if panel is closed or user is actively resizing.
        if (!currentPanelState.isOpen || isResizing) return;

        const currentSize = currentPanelState.size;
        const currentPosition = currentPanelState.floatingPosition;
        let needsUpdate = false;
        let newSize = { ...currentSize };
        let newPosition = { ...currentPosition };

        // If the panel is floating, constrain its size and position within window bounds.
        if (currentPanelState.position === 'floating') {
          const maxWidth = window.innerWidth - LAYOUT.WINDOW_MARGIN;
          const maxHeight = window.innerHeight - LAYOUT.WINDOW_MARGIN;

          // Constrain width.
          if (currentSize.width > maxWidth) {
            newSize.width = maxWidth;
            needsUpdate = true;
          }

          // Constrain height.
          if (currentSize.height > maxHeight) {
            newSize.height = maxHeight;
            needsUpdate = true;
          }

          // Constrain position.
          const rightEdge = currentPosition.x + newSize.width;
          const bottomEdge = currentPosition.y + newSize.height;

          // Ensure panel stays within right edge.
          if (rightEdge > window.innerWidth) {
            newPosition.x = Math.max(
              LAYOUT.MIN_EDGE_DISTANCE,
              window.innerWidth - newSize.width - 20
            );
            needsUpdate = true;
          }

          // Ensure panel stays within bottom edge.
          if (bottomEdge > window.innerHeight) {
            newPosition.y = Math.max(
              LAYOUT.MIN_EDGE_DISTANCE,
              window.innerHeight - newSize.height - 20
            );
            needsUpdate = true;
          }

          // Ensure panel stays within left edge.
          if (currentPosition.x < LAYOUT.MIN_EDGE_DISTANCE) {
            newPosition.x = LAYOUT.MIN_EDGE_DISTANCE;
            needsUpdate = true;
          }

          // Ensure panel stays within top edge.
          if (currentPosition.y < LAYOUT.MIN_EDGE_DISTANCE) {
            newPosition.y = LAYOUT.MIN_EDGE_DISTANCE;
            needsUpdate = true;
          }
        } else if (currentPanelState.position === 'right') {
          const maxWidth = window.innerWidth - LAYOUT.SIDEBAR_WIDTH;
          if (currentSize.width > maxWidth) {
            newSize.width = Math.max(minWidth, maxWidth);
            needsUpdate = true;
          }
          // If the panel is docked to the bottom, constrain its height.
        } else if (currentPanelState.position === 'bottom') {
          const maxHeight = window.innerHeight - LAYOUT.BOTTOM_RESERVED_HEIGHT;
          if (currentSize.height > maxHeight) {
            newSize.height = maxHeight;
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          if (newSize.width !== currentSize.width || newSize.height !== currentSize.height) {
            currentPanelState.setSize(newSize);
          }
          if (
            currentPanelState.position === 'floating' &&
            (newPosition.x !== currentPosition.x || newPosition.y !== currentPosition.y)
          ) {
            currentPanelState.setFloatingPosition(newPosition);
          }
        }
      }, LAYOUT.RESIZE_DEBOUNCE_MS);
    };

    window.addEventListener('resize', handleWindowResize);
    setTimeout(handleWindowResize, LAYOUT.RESIZE_DEBOUNCE_MS);

    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [minWidth, minHeight, isResizing, isMaximized]);
}
