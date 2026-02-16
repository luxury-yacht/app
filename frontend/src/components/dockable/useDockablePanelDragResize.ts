/**
 * useDockablePanelDragResize.ts
 *
 * Hook to manage drag and resize interactions for dockable panels.
 * Handles mouse events, updates panel size/position, and manages cursor styles.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import type { DockPosition } from './useDockablePanelState';
import { LAYOUT, getContentBounds } from './dockablePanelLayout';
// Note: clientX/clientY and getBoundingClientRect() are already in CSS coordinates,
// so no zoom conversion is needed for drag/resize (see ZoomContext docs).

interface DockablePanelState {
  position: DockPosition;
  size: { width: number; height: number };
  floatingPosition: { x: number; y: number };
  isOpen: boolean;
  setSize: (size: { width: number; height: number }) => void;
  setFloatingPosition: (position: { x: number; y: number }) => void;
}

interface DockablePanelDragResizeOptions {
  panelState: DockablePanelState;
  panelRef: RefObject<HTMLDivElement | null>;
  safeMinWidth: number;
  safeMinHeight: number;
  isMaximized: boolean;
}

/**
 * Handle drag/resize interactions and cursor updates for dockable panels.
 */
export function useDockablePanelDragResize(options: DockablePanelDragResizeOptions) {
  const {
    panelState,
    panelRef,
    safeMinWidth,
    safeMinHeight,
    isMaximized,
  } = options;
  const panelStateRef = useRef(panelState);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string>('');
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    left: 0,
    top: 0,
  });

  useEffect(() => {
    // Keep the latest panel state for global event handlers without re-binding them.
    panelStateRef.current = panelState;
  }, [panelState]);

  // Handle dragging for floating panels
  const handleMouseDownDrag = useCallback(
    (e: ReactMouseEvent) => {
      if (isMaximized) return;
      if (panelState.position !== 'floating') return;

      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;

      // clientX/clientY and getBoundingClientRect() are already in CSS coordinates —
      // no zoom conversion needed (see ZoomContext docs).
      setIsDragging(true);
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      e.preventDefault();
    },
    [panelState.position, panelRef, isMaximized]
  );

  // Handle resizing
  const handleMouseDownResize = useCallback(
    (e: ReactMouseEvent, direction: string) => {
      if (isMaximized) return;
      e.stopPropagation();
      // clientX/clientY are already in CSS coordinates — no zoom conversion needed.
      const content = getContentBounds();
      setIsResizing(true);
      setResizeDirection(direction);
      setResizeStart({
        width: panelState.size.width,
        height: panelState.size.height,
        x: e.clientX - content.left,
        y: e.clientY - content.top,
        left: panelState.floatingPosition.x,
        top: panelState.floatingPosition.y,
      });
      e.preventDefault();
    },
    [panelState.size, panelState.floatingPosition, isMaximized]
  );

  // Detect resize edge for floating panels
  const getResizeDirection = useCallback(
    (e: ReactMouseEvent) => {
      if (panelState.position !== 'floating' || !panelRef.current) return '';

      const rect = panelRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const isTop = y < LAYOUT.RESIZE_TOP_EDGE_SIZE;
      const isLeft = x < LAYOUT.RESIZE_EDGE_SIZE;
      const isRight = x > rect.width - LAYOUT.RESIZE_EDGE_SIZE;
      const isBottom = y > rect.height - LAYOUT.RESIZE_EDGE_SIZE;

      if (isTop && isLeft) return 'nw';
      if (isTop && isRight) return 'ne';
      if (isBottom && isLeft) return 'sw';
      if (isBottom && isRight) return 'se';
      if (isTop) return 'n';
      if (isBottom) return 's';
      if (isLeft) return 'w';
      if (isRight) return 'e';

      return '';
    },
    [panelState.position, panelRef]
  );

  // Handle mouse down for floating panel (drag or resize)
  const handleFloatingMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (isMaximized) return;
      if (panelState.position !== 'floating') return;

      const direction = getResizeDirection(e);
      if (direction) {
        handleMouseDownResize(e, direction);
      }
    },
    [panelState.position, getResizeDirection, handleMouseDownResize, isMaximized]
  );

  const dragFrameRef = useRef<number | null>(null);
  const pendingDragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const sizeFrameRef = useRef<number | null>(null);
  const pendingSizeRef = useRef<{
    width: number;
    height: number;
    position: { x: number; y: number } | null;
  } | null>(null);

  const flushDragPosition = useCallback(() => {
    dragFrameRef.current = null;
    const pending = pendingDragPositionRef.current;
    if (!pending) {
      return;
    }
    pendingDragPositionRef.current = null;
    panelStateRef.current.setFloatingPosition(pending);
  }, [panelStateRef]);

  const scheduleFloatingPosition = useCallback(
    (position: { x: number; y: number }) => {
      pendingDragPositionRef.current = position;
      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        flushDragPosition();
        return;
      }
      if (dragFrameRef.current != null) {
        return;
      }
      dragFrameRef.current = window.requestAnimationFrame(flushDragPosition);
    },
    [flushDragPosition]
  );

  const flushSizeUpdate = useCallback(() => {
    sizeFrameRef.current = null;
    const pending = pendingSizeRef.current;
    if (!pending) {
      return;
    }
    pendingSizeRef.current = null;
    const currentPanelState = panelStateRef.current;
    currentPanelState.setSize({ width: pending.width, height: pending.height });
    if (currentPanelState.position === 'floating' && pending.position) {
      currentPanelState.setFloatingPosition(pending.position);
    }
  }, [panelStateRef]);

  const scheduleSizeUpdate = useCallback(
    (size: { width: number; height: number }, floatingPosition?: { x: number; y: number }) => {
      const currentPanelState = panelStateRef.current;
      const currentSize = currentPanelState.size;
      const hasSizeChange =
        Math.abs(currentSize.width - size.width) >= 0.5 ||
        Math.abs(currentSize.height - size.height) >= 0.5;
      const nextFloatingPosition =
        currentPanelState.position === 'floating'
          ? (floatingPosition ?? currentPanelState.floatingPosition)
          : null;
      const hasPositionChange =
        currentPanelState.position === 'floating' &&
        nextFloatingPosition != null &&
        (Math.abs(nextFloatingPosition.x - currentPanelState.floatingPosition.x) >= 0.5 ||
          Math.abs(nextFloatingPosition.y - currentPanelState.floatingPosition.y) >= 0.5);
      // Skip redundant size updates to avoid thrashing resize observers downstream.
      if (!hasSizeChange && !hasPositionChange) {
        return;
      }
      pendingSizeRef.current = {
        width: size.width,
        height: size.height,
        position: currentPanelState.position === 'floating' ? (floatingPosition ?? null) : null,
      };
      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        flushSizeUpdate();
        return;
      }
      if (sizeFrameRef.current != null) {
        return;
      }
      sizeFrameRef.current = window.requestAnimationFrame(flushSizeUpdate);
    },
    [flushSizeUpdate, panelStateRef]
  );

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        if (dragFrameRef.current != null) {
          window.cancelAnimationFrame(dragFrameRef.current);
        }
        if (sizeFrameRef.current != null) {
          window.cancelAnimationFrame(sizeFrameRef.current);
        }
      }
      dragFrameRef.current = null;
      sizeFrameRef.current = null;
      pendingDragPositionRef.current = null;
      pendingSizeRef.current = null;
    };
  }, []);

  // Set class on document.body during drag to disable underlying pointer events
  useEffect(() => {
    if (!isDragging) return;

    document.body.classList.add('dockable-panel-dragging');

    return () => {
      document.body.classList.remove('dockable-panel-dragging');
    };
  }, [isDragging]);

  // Set cursor on document.body during resize using a class to allow !important override
  useEffect(() => {
    if (!isResizing || !resizeDirection) return;

    const className = `dockable-panel-resizing-${resizeDirection}`;
    document.body.classList.add('dockable-panel-resizing', className);

    return () => {
      document.body.classList.remove('dockable-panel-resizing', className);
    };
  }, [isResizing, resizeDirection]);

  // Mouse move handler
  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPanelState = panelStateRef.current;
      // Don't update position if panel is not open (prevents race conditions during close)
      if (!currentPanelState.isOpen) return;

      // clientX/clientY and getContentBounds() are already in CSS coordinates —
      // no zoom conversion needed (see ZoomContext docs).
      const content = getContentBounds();
      const mouseX = e.clientX - content.left;
      const mouseY = e.clientY - content.top;

      if (isDragging && currentPanelState.position === 'floating') {
        const minDistanceFromEdge = LAYOUT.MIN_EDGE_DISTANCE;
        const newX = Math.max(
          0,
          Math.min(content.width - currentPanelState.size.width, mouseX - dragOffset.x)
        );
        const newY = Math.max(
          minDistanceFromEdge,
          Math.min(content.height - currentPanelState.size.height, mouseY - dragOffset.y)
        );

        scheduleFloatingPosition({ x: newX, y: newY });
      } else if (isResizing) {
        const deltaX = mouseX - resizeStart.x;
        const deltaY = mouseY - resizeStart.y;

        let newWidth = resizeStart.width;
        let newHeight = resizeStart.height;
        let newLeft = resizeStart.left;
        let newTop = resizeStart.top;

        if (currentPanelState.position === 'right') {
          // For right-docked panels, dragging left (negative deltaX) increases width
          newWidth = Math.max(
            safeMinWidth,
            Math.min(content.width, resizeStart.width - deltaX)
          );
        } else if (currentPanelState.position === 'bottom') {
          // For bottom-docked panels, dragging up (negative deltaY) increases height
          newHeight = Math.max(
            safeMinHeight,
            Math.min(content.height, resizeStart.height - deltaY)
          );
        } else if (currentPanelState.position === 'floating') {
          // Handle multi-directional resizing for floating panels
          if (resizeDirection.includes('e')) {
            // Don't allow resizing beyond the right edge of the content area
            const maxAllowedWidth = content.width - resizeStart.left;
            newWidth = Math.max(
              safeMinWidth,
              Math.min(maxAllowedWidth, resizeStart.width + deltaX)
            );
          }
          if (resizeDirection.includes('w')) {
            const proposedWidth = resizeStart.width - deltaX;
            if (proposedWidth >= safeMinWidth) {
              newWidth = Math.min(content.width, proposedWidth);
              newLeft = Math.max(0, resizeStart.left + deltaX); // Don't go beyond left edge
              // Adjust width if we hit the left edge
              if (resizeStart.left + deltaX < 0) {
                newWidth = resizeStart.width + resizeStart.left;
                newLeft = 0;
              }
            } else {
              // Clamp at minimum width; pin the right edge in place.
              newWidth = safeMinWidth;
              newLeft = resizeStart.left + resizeStart.width - safeMinWidth;
            }
          }
          if (resizeDirection.includes('s')) {
            // Allow resizing down to the bottom of the content area
            const maxAvailableHeight = content.height - resizeStart.top;
            newHeight = Math.max(
              safeMinHeight,
              Math.min(maxAvailableHeight, resizeStart.height + deltaY)
            );
          }
          if (resizeDirection.includes('n')) {
            const proposedHeight = resizeStart.height - deltaY;
            if (proposedHeight >= safeMinHeight) {
              newHeight = Math.min(content.height, proposedHeight);
              // Don't allow dragging above the top of the content area.
              newTop = Math.max(0, resizeStart.top + deltaY);
              // Adjust height if we hit the top edge.
              if (resizeStart.top + deltaY < 0) {
                newHeight = resizeStart.height + resizeStart.top;
              }
            } else {
              // Clamp at minimum height; pin the bottom edge in place.
              newHeight = safeMinHeight;
              newTop = resizeStart.top + resizeStart.height - safeMinHeight;
            }
          }
        }

        const nextSize = { width: newWidth, height: newHeight };
        const nextPosition =
          currentPanelState.position === 'floating' ? { x: newLeft, y: newTop } : undefined;
        scheduleSizeUpdate(nextSize, nextPosition);
      }
    };

    const handleMouseUp = () => {
      if (pendingDragPositionRef.current) {
        flushDragPosition();
      }
      if (pendingSizeRef.current) {
        flushSizeUpdate();
      }
      setIsDragging(false);
      setIsResizing(false);
      setResizeDirection('');
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    isDragging,
    isResizing,
    resizeDirection,
    dragOffset,
    resizeStart,
    safeMinWidth,
    safeMinHeight,
    scheduleFloatingPosition,
    scheduleSizeUpdate,
    flushDragPosition,
    flushSizeUpdate,
  ]);

  // Header clicks always start a drag — resize is handled by the dedicated
  // CSS resize-zone overlay divs which sit above the header at z-index 10.
  const handleHeaderMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      handleMouseDownDrag(e);
    },
    [handleMouseDownDrag]
  );

  return {
    isDragging,
    isResizing,
    handleHeaderMouseDown,
    handleMouseDownResize,
    handleFloatingMouseDown,
  };
}
