/**
 * useDockablePanelDragResize.ts
 *
 * Hook to manage drag and resize interactions for dockable panels.
 * Handles mouse events, updates panel size/position, and manages cursor styles.
 */

import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getContentBounds } from './dockablePanelLayout';
import type { DockPosition } from './useDockablePanelState';

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

const KEYBOARD_RESIZE_STEP = 16;
const KEYBOARD_MOVE_STEP = 16;
const KEYBOARD_MOVE_DIRECTIONS: Partial<Record<string, { x: number; y: number }>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

type PanelSize = DockablePanelState['size'];
type FloatingPosition = DockablePanelState['floatingPosition'];
type ContentBounds = ReturnType<typeof getContentBounds>;

interface ResizeStart {
  width: number;
  height: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

interface ResizeGeometry {
  size: PanelSize;
  position?: FloatingPosition;
}

interface ResizeCalculation {
  position: DockPosition;
  direction: string;
  start: ResizeStart;
  mouseX: number;
  mouseY: number;
  safeMinWidth: number;
  safeMinHeight: number;
  content: ContentBounds;
}

type DockedResizeAction = number | 'minimum' | 'maximum';

const DOCKED_RESIZE_ACTIONS: Record<
  'right' | 'bottom',
  Partial<Record<string, DockedResizeAction>>
> = {
  right: {
    ArrowLeft: KEYBOARD_RESIZE_STEP,
    ArrowRight: -KEYBOARD_RESIZE_STEP,
    Home: 'minimum',
    End: 'maximum',
  },
  bottom: {
    ArrowUp: KEYBOARD_RESIZE_STEP,
    ArrowDown: -KEYBOARD_RESIZE_STEP,
    Home: 'minimum',
    End: 'maximum',
  },
};

const calculateDockedKeyboardSize = (
  key: string,
  position: 'right' | 'bottom',
  current: number,
  minimum: number,
  maximum: number
): number | null => {
  const action = DOCKED_RESIZE_ACTIONS[position][key];
  if (action === undefined) {
    return null;
  }
  if (action === 'minimum') {
    return minimum;
  }
  if (action === 'maximum') {
    return maximum;
  }
  return Math.min(Math.max(current + action, minimum), maximum);
};

const calculateFloatingDragPosition = (
  mouseX: number,
  mouseY: number,
  dragOffset: FloatingPosition,
  panelState: DockablePanelState,
  content: ContentBounds
): FloatingPosition => ({
  x: Math.max(0, Math.min(content.width - panelState.size.width, mouseX - dragOffset.x)),
  y: Math.max(0, Math.min(content.height - panelState.size.height, mouseY - dragOffset.y)),
});

const resizeFromWest = (
  start: ResizeStart,
  deltaX: number,
  safeMinWidth: number,
  contentWidth: number
) => {
  const proposedWidth = start.width - deltaX;
  if (proposedWidth < safeMinWidth) {
    return {
      width: safeMinWidth,
      left: start.left + start.width - safeMinWidth,
    };
  }
  const proposedLeft = start.left + deltaX;
  if (proposedLeft < 0) {
    return { width: start.width + start.left, left: 0 };
  }
  return {
    width: Math.min(contentWidth, proposedWidth),
    left: proposedLeft,
  };
};

const calculateFloatingHorizontalResize = (
  direction: string,
  start: ResizeStart,
  deltaX: number,
  safeMinWidth: number,
  content: ContentBounds
) => {
  if (direction.includes('w')) {
    return resizeFromWest(start, deltaX, safeMinWidth, content.width);
  }
  if (direction.includes('e')) {
    const maxAllowedWidth = content.width - start.left;
    return {
      width: Math.max(safeMinWidth, Math.min(maxAllowedWidth, start.width + deltaX)),
      left: start.left,
    };
  }
  return { width: start.width, left: start.left };
};

const resizeFromNorth = (
  start: ResizeStart,
  deltaY: number,
  safeMinHeight: number,
  contentHeight: number
) => {
  const proposedHeight = start.height - deltaY;
  if (proposedHeight < safeMinHeight) {
    return {
      height: safeMinHeight,
      top: start.top + start.height - safeMinHeight,
    };
  }
  const proposedTop = start.top + deltaY;
  return {
    height: proposedTop < 0 ? start.height + start.top : Math.min(contentHeight, proposedHeight),
    top: Math.max(0, proposedTop),
  };
};

const calculateFloatingVerticalResize = (
  direction: string,
  start: ResizeStart,
  deltaY: number,
  safeMinHeight: number,
  content: ContentBounds
) => {
  if (direction.includes('n')) {
    return resizeFromNorth(start, deltaY, safeMinHeight, content.height);
  }
  if (direction.includes('s')) {
    const maxAvailableHeight = content.height - start.top;
    return {
      height: Math.max(safeMinHeight, Math.min(maxAvailableHeight, start.height + deltaY)),
      top: start.top,
    };
  }
  return { height: start.height, top: start.top };
};

const calculateFloatingResize = (
  direction: string,
  start: ResizeStart,
  deltaX: number,
  deltaY: number,
  safeMinWidth: number,
  safeMinHeight: number,
  content: ContentBounds
): ResizeGeometry => {
  const horizontal = calculateFloatingHorizontalResize(
    direction,
    start,
    deltaX,
    safeMinWidth,
    content
  );
  const vertical = calculateFloatingVerticalResize(
    direction,
    start,
    deltaY,
    safeMinHeight,
    content
  );
  return {
    size: { width: horizontal.width, height: vertical.height },
    position: { x: horizontal.left, y: vertical.top },
  };
};

const calculateResizeGeometry = ({
  position,
  direction,
  start,
  mouseX,
  mouseY,
  safeMinWidth,
  safeMinHeight,
  content,
}: ResizeCalculation): ResizeGeometry => {
  const deltaX = mouseX - start.x;
  const deltaY = mouseY - start.y;
  if (position === 'right') {
    return {
      size: {
        width: Math.max(safeMinWidth, Math.min(content.width, start.width - deltaX)),
        height: start.height,
      },
    };
  }
  if (position === 'bottom') {
    return {
      size: {
        width: start.width,
        height: Math.max(safeMinHeight, Math.min(content.height, start.height - deltaY)),
      },
    };
  }
  return calculateFloatingResize(
    direction,
    start,
    deltaX,
    deltaY,
    safeMinWidth,
    safeMinHeight,
    content
  );
};

const hasMeaningfulSizeChange = (current: PanelSize, next: PanelSize) =>
  Math.abs(current.width - next.width) >= 0.5 || Math.abs(current.height - next.height) >= 0.5;

const hasMeaningfulPositionChange = (current: FloatingPosition, next: FloatingPosition | null) =>
  next !== null && (Math.abs(next.x - current.x) >= 0.5 || Math.abs(next.y - current.y) >= 0.5);

interface PendingSizeUpdate extends PanelSize {
  position: FloatingPosition | null;
}

const createPendingSizeUpdate = (
  panelState: DockablePanelState,
  size: PanelSize,
  floatingPosition: FloatingPosition | undefined
): PendingSizeUpdate | null => {
  const comparisonPosition =
    panelState.position === 'floating' ? (floatingPosition ?? panelState.floatingPosition) : null;
  if (
    !hasMeaningfulSizeChange(panelState.size, size) &&
    !hasMeaningfulPositionChange(panelState.floatingPosition, comparisonPosition)
  ) {
    return null;
  }
  return {
    ...size,
    position: panelState.position === 'floating' ? (floatingPosition ?? null) : null,
  };
};

const cancelScheduledFrame = (frameRef: RefObject<number | null>) => {
  const frame = frameRef.current;
  if (
    typeof window !== 'undefined' &&
    typeof window.cancelAnimationFrame === 'function' &&
    frame !== null
  ) {
    window.cancelAnimationFrame(frame);
  }
  frameRef.current = null;
};

/**
 * Handle drag/resize interactions and cursor updates for dockable panels.
 */
export function useDockablePanelDragResize(options: DockablePanelDragResizeOptions) {
  const { panelState, panelRef, safeMinWidth, safeMinHeight, isMaximized } = options;
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
    (e: ReactMouseEvent | MouseEvent) => {
      if (isMaximized) {
        return;
      }
      if (panelState.position !== 'floating') {
        return;
      }

      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

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
      if (isMaximized) {
        return;
      }
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

  const handleDockedKeyboardResize = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, position: 'right' | 'bottom') => {
      const content = getContentBounds();
      const isRightDock = position === 'right';
      const minimum = isRightDock ? safeMinWidth : safeMinHeight;
      const maximum = Math.max(minimum, isRightDock ? content.width : content.height);
      const current = isRightDock ? panelState.size.width : panelState.size.height;
      const nextValue = calculateDockedKeyboardSize(event.key, position, current, minimum, maximum);
      if (nextValue === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      panelState.setSize({
        ...panelState.size,
        width: isRightDock ? nextValue : panelState.size.width,
        height: isRightDock ? panelState.size.height : nextValue,
      });
    },
    [panelState, safeMinHeight, safeMinWidth]
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
  }, []);

  const scheduleFloatingPosition = useCallback(
    (position: { x: number; y: number }) => {
      pendingDragPositionRef.current = position;
      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        flushDragPosition();
        return;
      }
      if (dragFrameRef.current !== null && dragFrameRef.current !== undefined) {
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
  }, []);

  const scheduleSizeUpdate = useCallback(
    (size: { width: number; height: number }, floatingPosition?: { x: number; y: number }) => {
      const currentPanelState = panelStateRef.current;
      const pending = createPendingSizeUpdate(currentPanelState, size, floatingPosition);
      if (!pending) {
        return;
      }
      pendingSizeRef.current = pending;
      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        flushSizeUpdate();
        return;
      }
      if (sizeFrameRef.current !== null && sizeFrameRef.current !== undefined) {
        return;
      }
      sizeFrameRef.current = window.requestAnimationFrame(flushSizeUpdate);
    },
    [flushSizeUpdate]
  );

  useEffect(() => {
    return () => {
      cancelScheduledFrame(dragFrameRef);
      cancelScheduledFrame(sizeFrameRef);
      pendingDragPositionRef.current = null;
      pendingSizeRef.current = null;
    };
  }, []);

  // Set class on document.body during drag to disable underlying pointer events
  useEffect(() => {
    if (!isDragging) {
      return;
    }

    document.body.classList.add('dockable-panel-dragging');

    return () => {
      document.body.classList.remove('dockable-panel-dragging');
    };
  }, [isDragging]);

  // Set cursor on document.body during resize using a class to allow !important override
  useEffect(() => {
    if (!isResizing || !resizeDirection) {
      return;
    }

    const className = `dockable-panel-resizing-${resizeDirection}`;
    document.body.classList.add('dockable-panel-resizing', className);

    return () => {
      document.body.classList.remove('dockable-panel-resizing', className);
    };
  }, [isResizing, resizeDirection]);

  // Mouse move handler
  useEffect(() => {
    if (!isDragging && !isResizing) {
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      const currentPanelState = panelStateRef.current;
      // Don't update position if panel is not open (prevents race conditions during close)
      if (!currentPanelState.isOpen) {
        return;
      }

      // clientX/clientY and getContentBounds() are already in CSS coordinates —
      // no zoom conversion needed (see ZoomContext docs).
      const content = getContentBounds();
      const mouseX = e.clientX - content.left;
      const mouseY = e.clientY - content.top;

      if (isDragging && currentPanelState.position === 'floating') {
        scheduleFloatingPosition(
          calculateFloatingDragPosition(mouseX, mouseY, dragOffset, currentPanelState, content)
        );
        return;
      }
      if (isResizing) {
        const nextGeometry = calculateResizeGeometry({
          position: currentPanelState.position,
          direction: resizeDirection,
          start: resizeStart,
          mouseX,
          mouseY,
          safeMinWidth,
          safeMinHeight,
          content,
        });
        scheduleSizeUpdate(nextGeometry.size, nextGeometry.position);
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

  // The header owns floating-panel pointer dragging after filtering interactive targets.
  const handleHeaderMouseDown = useCallback(
    (e: MouseEvent) => {
      handleMouseDownDrag(e);
    },
    [handleMouseDownDrag]
  );

  const handleHeaderKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (isMaximized || panelState.position !== 'floating') {
        return;
      }
      const direction = KEYBOARD_MOVE_DIRECTIONS[event.key];
      if (!direction) {
        return;
      }
      event.preventDefault();
      const content = getContentBounds();
      const maxX = Math.max(content.left, content.left + content.width - panelState.size.width);
      const maxY = Math.max(content.top, content.top + content.height - panelState.size.height);
      panelState.setFloatingPosition({
        x: Math.min(
          maxX,
          Math.max(content.left, panelState.floatingPosition.x + direction.x * KEYBOARD_MOVE_STEP)
        ),
        y: Math.min(
          maxY,
          Math.max(content.top, panelState.floatingPosition.y + direction.y * KEYBOARD_MOVE_STEP)
        ),
      });
    },
    [isMaximized, panelState]
  );

  return {
    isDragging,
    isResizing,
    handleHeaderMouseDown,
    handleHeaderKeyDown,
    handleMouseDownResize,
    handleDockedKeyboardResize,
  };
}
