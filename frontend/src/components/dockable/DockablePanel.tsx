import React, { useEffect, useRef, useState, useCallback, memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  closeDockedPanels,
  registerPanelCloseHandler,
  unregisterPanelCloseHandler,
  useDockablePanelState,
  PanelCloseReason,
} from './useDockablePanelState';
import { useDockablePanelContext, useDockablePanelHost } from './DockablePanelProvider';
import {
  DockRightIcon,
  DockBottomIcon,
  FloatPanelIcon,
  MaximizePanelIcon,
  RestorePanelIcon,
} from '@shared/components/icons/MenuIcons';
import './DockablePanel.css';

// Layout constants
const LAYOUT = {
  /** Minimum distance panels should maintain from window edges */
  MIN_EDGE_DISTANCE: 50,
  /** Margin to leave when constraining panel size to window */
  WINDOW_MARGIN: 100,
  /** Approximate width of the sidebar for layout calculations */
  SIDEBAR_WIDTH: 250,
  /** Space reserved for header and content when bottom-docked */
  BOTTOM_RESERVED_HEIGHT: 150,
  /** Height of the app header */
  APP_HEADER_HEIGHT: 45,
  /** Size of the resize detection zone on panel edges */
  RESIZE_EDGE_SIZE: 8,
  /** Size of the resize detection zone on top edge (smaller to avoid header conflict) */
  RESIZE_TOP_EDGE_SIZE: 4,
  /** Debounce delay for window resize handling */
  RESIZE_DEBOUNCE_MS: 100,
} as const;

// Read the CSS token so drag/resizes match the actual header height.
const getAppHeaderHeight = (): number => {
  if (typeof document === 'undefined') {
    return LAYOUT.APP_HEADER_HEIGHT;
  }
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--app-header-height');
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : LAYOUT.APP_HEADER_HEIGHT;
};

/**
 * Hook to constrain panel size and position within window bounds.
 * Handles debouncing, dock positions, and respects user resize operations.
 */
function useWindowBoundsConstraint(
  panelState: ReturnType<typeof useDockablePanelState>,
  options: {
    minWidth: number;
    minHeight: number;
    isResizing: boolean;
    isMaximized: boolean;
  }
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

export type DockPosition = 'right' | 'bottom' | 'floating';

interface DockablePanelProps {
  // Unique identifier for this panel instance
  panelId: string;

  // Content to render inside the panel
  children: React.ReactNode;

  // Optional title for the panel header
  title?: string;

  // Optional initial position
  defaultPosition?: DockPosition;

  // Optional initial size
  defaultSize?: { width?: number; height?: number };

  // Optional min/max constraints
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;

  // Callbacks
  onClose?: () => void;
  onPositionChange?: (position: DockPosition) => void;

  // Whether the panel is currently open
  isOpen?: boolean;

  // Custom header content (replaces default title)
  headerContent?: React.ReactNode;

  // Class names for styling
  className?: string;
  contentClassName?: string;

  // Maximize support
  allowMaximize?: boolean;
  onMaximizeChange?: (isMaximized: boolean) => void;
  maximizeTargetSelector?: string;
  panelRef?: React.Ref<HTMLDivElement>;
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  try {
    (ref as React.RefObject<T | null>).current = value;
  } catch (error) {
    console.error('DockablePanel: failed to assign ref', error);
  }
}

const DockablePanelInner: React.FC<DockablePanelProps> = (props) => {
  const {
    panelId,
    children,
    title = 'Panel',
    defaultPosition = 'right',
    defaultSize = { width: 400, height: 300 },
    minWidth = 200,
    minHeight = 150,
    maxWidth,
    maxHeight,
    onClose,
    onPositionChange,
    headerContent,
    className = '',
    contentClassName = '',
    allowMaximize = false,
    onMaximizeChange,
    maximizeTargetSelector = '.content-body',
    panelRef: forwardedPanelRef,
  } = props;
  const isControlled = typeof props.isOpen !== 'undefined';
  const resolvedIsOpen = props.isOpen ?? true;
  // Validate constraints
  const safeMinWidth = Math.max(100, minWidth);
  const safeMinHeight = Math.max(100, minHeight);
  const safeMaxWidth = maxWidth ? Math.max(safeMinWidth, maxWidth) : undefined;
  const safeMaxHeight = maxHeight ? Math.max(safeMinHeight, maxHeight) : undefined;
  const panelState = useDockablePanelState(panelId);
  const panelStateRef = useRef(panelState);
  const { registerPanel, unregisterPanel } = useDockablePanelContext();
  const panelHostNode = useDockablePanelHost();
  const panelRef = useRef<HTMLDivElement>(null);
  const setPanelRef = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      assignRef(forwardedPanelRef, node);
    },
    [forwardedPanelRef]
  );
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
  const [isMaximized, setIsMaximized] = useState(false);
  const [maximizedRect, setMaximizedRect] = useState<DOMRect | null>(null);
  const restoreStateRef = useRef<{
    position: DockPosition;
    size: { width: number; height: number };
    floatingPosition: { x: number; y: number };
  } | null>(null);
  const maximizeTargetRef = useRef<HTMLElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const skipNextControlledSyncRef = useRef(false);
  const appHeaderHeightRef = useRef<number>(LAYOUT.APP_HEADER_HEIGHT);

  useEffect(() => {
    // Keep the latest panel state for global event handlers without re-binding them.
    panelStateRef.current = panelState;
  }, [panelState]);

  const resolveMaximizeTarget = useCallback((): HTMLElement | null => {
    if (typeof document === 'undefined') {
      return null;
    }
    const explicit = maximizeTargetSelector ? document.querySelector(maximizeTargetSelector) : null;
    if (explicit instanceof HTMLElement) {
      return explicit;
    }
    const fallback = document.querySelector('.content-body');
    return fallback instanceof HTMLElement ? fallback : null;
  }, [maximizeTargetSelector]);

  useEffect(() => {
    if (!isMaximized) {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      maximizeTargetRef.current = null;
      setMaximizedRect(null);
      return;
    }

    const updateRect = () => {
      if (typeof window === 'undefined') {
        return;
      }

      const target = maximizeTargetRef.current ?? resolveMaximizeTarget();
      if (target) {
        maximizeTargetRef.current = target;
        setMaximizedRect(target.getBoundingClientRect());
        return;
      }

      const headerHeightRaw =
        typeof document !== 'undefined'
          ? getComputedStyle(document.documentElement).getPropertyValue('--app-header-height')
          : '';
      const headerHeight = parseInt(headerHeightRaw, 10) || 0;
      const rect = new DOMRect(
        0,
        headerHeight,
        window.innerWidth,
        Math.max(0, window.innerHeight - headerHeight)
      );
      setMaximizedRect(rect);
    };

    maximizeTargetRef.current = resolveMaximizeTarget();
    updateRect();

    const handleResize = () => updateRect();

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);

    if (maximizeTargetRef.current && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateRect());
      observer.observe(maximizeTargetRef.current);
      resizeObserverRef.current = observer;
    } else {
      resizeObserverRef.current = null;
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [isMaximized, resolveMaximizeTarget]);

  useEffect(() => {
    if (panelState.isOpen) {
      return;
    }
    if (isMaximized) {
      setIsMaximized(false);
      onMaximizeChange?.(false);
    }
    restoreStateRef.current = null;
  }, [panelState.isOpen, isMaximized, onMaximizeChange]);

  useEffect(() => {
    if (!panelState.isOpen) {
      unregisterPanel(panelId);
      return;
    }
    registerPanel(panelId, panelState.position);
    return () => {
      unregisterPanel(panelId);
    };
  }, [panelId, panelState.isOpen, panelState.position, registerPanel, unregisterPanel]);

  // Initialize panel state
  useEffect(() => {
    if (!panelState.isInitialized) {
      panelState.initialize({
        position: defaultPosition,
        size: defaultSize,
        isOpen: resolvedIsOpen,
      });
    }
  }, [panelState, defaultPosition, defaultSize, resolvedIsOpen]);

  // Update open state for controlled panels
  useEffect(() => {
    if (!isControlled) {
      return;
    }
    if (skipNextControlledSyncRef.current) {
      skipNextControlledSyncRef.current = false;
      return;
    }
    if (panelState.isInitialized && resolvedIsOpen !== panelState.isOpen) {
      panelState.setOpen(resolvedIsOpen);
    }
  }, [isControlled, resolvedIsOpen, panelState]);

  useEffect(() => {
    const handleExternalClose = (reason: PanelCloseReason) => {
      if (isControlled) {
        skipNextControlledSyncRef.current = true;
      }
      panelState.setOpen(false);
      if (reason === 'dock-conflict' || reason === 'external') {
        onClose?.();
      }
    };

    registerPanelCloseHandler(panelId, handleExternalClose);
    return () => {
      unregisterPanelCloseHandler(panelId, handleExternalClose);
    };
  }, [panelId, panelState, onClose, isControlled]);

  // Manage body class to disable hover effects during floating panel drag
  useEffect(() => {
    if (panelState.position === 'floating' && isDragging) {
      document.body.classList.add('gridtable-disable-hover');
    } else {
      document.body.classList.remove('gridtable-disable-hover');
    }
    // Always clean up on unmount
    return () => {
      document.body.classList.remove('gridtable-disable-hover');
    };
  }, [isDragging, panelState.position]);

  // Handle window resize to keep panels within bounds
  useWindowBoundsConstraint(panelState, {
    minWidth: safeMinWidth,
    minHeight: safeMinHeight,
    isResizing,
    isMaximized,
  });

  // Handle position changes
  useEffect(() => {
    if (onPositionChange && panelState.position) {
      onPositionChange(panelState.position);
    }
  }, [panelState.position, onPositionChange]);

  // Handle dragging for floating panels
  const handleMouseDownDrag = useCallback(
    (e: React.MouseEvent) => {
      if (isMaximized) return;
      if (panelState.position !== 'floating') return;

      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;

      appHeaderHeightRef.current = getAppHeaderHeight();
      setIsDragging(true);
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      e.preventDefault();
    },
    [panelState.position, isMaximized]
  );

  // Handle resizing
  const handleMouseDownResize = useCallback(
    (e: React.MouseEvent, direction: string) => {
      if (isMaximized) return;
      e.stopPropagation();
      appHeaderHeightRef.current = getAppHeaderHeight();
      setIsResizing(true);
      setResizeDirection(direction);
      setResizeStart({
        width: panelState.size.width,
        height: panelState.size.height,
        x: e.clientX,
        y: e.clientY,
        left: panelState.floatingPosition.x,
        top: panelState.floatingPosition.y,
      });
      e.preventDefault();
    },
    [panelState.size, panelState.floatingPosition, isMaximized]
  );

  // Detect resize edge for floating panels
  const getResizeDirection = useCallback(
    (e: React.MouseEvent) => {
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
    [panelState.position]
  );

  // Handle mouse down for floating panel (drag or resize)
  const handleFloatingMouseDown = useCallback(
    (e: React.MouseEvent) => {
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

  // Mouse move handler
  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPanelState = panelStateRef.current;
      // Don't update position if panel is not open (prevents race conditions during close)
      if (!currentPanelState.isOpen) return;

      if (isDragging && currentPanelState.position === 'floating') {
        const headerHeight = appHeaderHeightRef.current;
        const minDistanceFromEdge = LAYOUT.MIN_EDGE_DISTANCE;
        const newX = Math.max(
          minDistanceFromEdge,
          Math.min(window.innerWidth - currentPanelState.size.width, e.clientX - dragOffset.x)
        );
        const newY = Math.max(
          Math.max(headerHeight, minDistanceFromEdge),
          Math.min(window.innerHeight - currentPanelState.size.height, e.clientY - dragOffset.y)
        );

        scheduleFloatingPosition({ x: newX, y: newY });
      } else if (isResizing) {
        const deltaX = e.clientX - resizeStart.x;
        const deltaY = e.clientY - resizeStart.y;

        let newWidth = resizeStart.width;
        let newHeight = resizeStart.height;
        let newLeft = resizeStart.left;
        let newTop = resizeStart.top;

        if (currentPanelState.position === 'right') {
          // For right-docked panels, dragging left (negative deltaX) increases width
          const sidebarWidth = LAYOUT.SIDEBAR_WIDTH;
          const maxAvailableWidth = window.innerWidth - sidebarWidth;
          newWidth = Math.max(
            safeMinWidth,
            Math.min(safeMaxWidth || maxAvailableWidth, resizeStart.width - deltaX)
          );
        } else if (currentPanelState.position === 'bottom') {
          // For bottom-docked panels, dragging up (negative deltaY) increases height
          newHeight = Math.max(
            safeMinHeight,
            Math.min(safeMaxHeight || window.innerHeight, resizeStart.height - deltaY)
          );
        } else if (currentPanelState.position === 'floating') {
          // Handle multi-directional resizing for floating panels
          if (resizeDirection.includes('e')) {
            // Don't allow resizing beyond the right edge of the window
            const maxAllowedWidth = window.innerWidth - resizeStart.left;
            newWidth = Math.max(
              safeMinWidth,
              Math.min(safeMaxWidth || maxAllowedWidth, resizeStart.width + deltaX)
            );
          }
          if (resizeDirection.includes('w')) {
            const proposedWidth = resizeStart.width - deltaX;
            if (proposedWidth >= safeMinWidth) {
              newWidth = Math.min(safeMaxWidth || window.innerWidth, proposedWidth);
              newLeft = Math.max(0, resizeStart.left + deltaX); // Don't go beyond left edge
              // Adjust width if we hit the left edge
              if (resizeStart.left + deltaX < 0) {
                newWidth = resizeStart.width + resizeStart.left;
                newLeft = 0;
              }
            }
          }
          if (resizeDirection.includes('s')) {
            // Allow resizing down to the bottom of the window
            const maxAvailableHeight = window.innerHeight - resizeStart.top;
            newHeight = Math.max(
              safeMinHeight,
              Math.min(safeMaxHeight || maxAvailableHeight, resizeStart.height + deltaY)
            );
          }
          if (resizeDirection.includes('n')) {
            const proposedHeight = resizeStart.height - deltaY;
            const headerHeight = appHeaderHeightRef.current;
            if (proposedHeight >= safeMinHeight) {
              newHeight = Math.min(
                safeMaxHeight || window.innerHeight - headerHeight,
                proposedHeight
              );
              // Don't allow dragging above the header
              newTop = Math.max(headerHeight, resizeStart.top + deltaY);
              // Adjust height if we hit the header
              if (resizeStart.top + deltaY < headerHeight) {
                newHeight = resizeStart.height + resizeStart.top - headerHeight;
              }
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
    safeMaxWidth,
    safeMaxHeight,
    scheduleFloatingPosition,
    scheduleSizeUpdate,
    flushDragPosition,
    flushSizeUpdate,
  ]);

  // Handle close
  const handleClose = useCallback(() => {
    if (isControlled) {
      skipNextControlledSyncRef.current = true;
    }
    panelState.setOpen(false);
    onClose?.();
  }, [panelState, onClose, isControlled]);

  const handleToggleMaximize = useCallback(() => {
    if (!allowMaximize) {
      return;
    }

    if (isMaximized) {
      setIsMaximized(false);
      onMaximizeChange?.(false);
      const restore = restoreStateRef.current;
      restoreStateRef.current = null;

      if (restore) {
        if (panelState.position !== restore.position) {
          panelState.setPosition(restore.position);
        }
        if (restore.position === 'floating') {
          panelState.setSize({ ...restore.size });
          panelState.setFloatingPosition({ ...restore.floatingPosition });
        } else {
          panelState.setSize({ ...restore.size });
        }
      }
      return;
    }

    restoreStateRef.current = {
      position: panelState.position,
      size: { width: panelState.size.width, height: panelState.size.height },
      floatingPosition: { ...panelState.floatingPosition },
    };

    panelState.focus();
    setIsMaximized(true);
    onMaximizeChange?.(true);
  }, [allowMaximize, isMaximized, panelState, onMaximizeChange]);

  // Handle docking changes
  const handleDock = useCallback(
    (position: DockPosition) => {
      if (isMaximized) {
        return;
      }
      closeDockedPanels(position, panelId);
      panelState.setPosition(position);
    },
    [panelId, panelState, isMaximized]
  );

  // Handle cursor style for floating panels
  const [cursorStyle, setCursorStyle] = useState<string>('default');
  const cursorStyleRef = useRef(cursorStyle);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isMaximized || panelState.position !== 'floating' || isDragging || isResizing) return;

      const direction = getResizeDirection(e);
      const cursors: { [key: string]: string } = {
        n: 'ns-resize',
        s: 'ns-resize',
        e: 'ew-resize',
        w: 'ew-resize',
        ne: 'nesw-resize',
        sw: 'nesw-resize',
        nw: 'nwse-resize',
        se: 'nwse-resize',
      };

      const nextCursor = cursors[direction] || 'default';
      if (cursorStyleRef.current !== nextCursor) {
        cursorStyleRef.current = nextCursor;
        setCursorStyle(nextCursor);
      }
    },
    [panelState.position, isDragging, isResizing, getResizeDirection, isMaximized]
  );

  // Memoize panel classes and styles
  const panelClassName = useMemo(() => {
    const classes = ['dockable-panel', `dockable-panel--${panelState.position}`, className];
    if (isDragging) classes.push('dockable-panel--dragging');
    if (isResizing) classes.push('dockable-panel--resizing');
    if (panelState.position === 'floating') classes.push('dockable-panel--floating');
    if (isMaximized) classes.push('dockable-panel--maximized');
    return classes.join(' ');
  }, [panelState.position, className, isDragging, isResizing, isMaximized]);

  const panelStyle = useMemo<React.CSSProperties>(() => {
    const style: React.CSSProperties & Record<string, string | number> = {
      zIndex: panelState.zIndex,
    };
    if (isMaximized) {
      const rect = maximizedRect;
      if (rect) {
        style.top = `${rect.top}px`;
        style.left = `${rect.left}px`;
        style.width = `${rect.width}px`;
        style.height = `${rect.height}px`;
      } else {
        style.top = 'var(--app-header-height)';
        style.left = '0px';
        style.width = '100vw';
        style.height = 'calc(100vh - var(--app-header-height))';
      }
      style.right = 'auto';
      style.bottom = 'auto';
      style.transform = 'none';
      style.cursor = 'default';
      style['--dockable-panel-translate-x'] = '0px';
      style['--dockable-panel-translate-y'] = '0px';
      return style;
    }
    if (panelState.position === 'floating') {
      const roundedX = Math.round(panelState.floatingPosition.x);
      const roundedY = Math.round(panelState.floatingPosition.y);
      style.width = `${panelState.size.width}px`;
      style.height = `${panelState.size.height}px`;
      style.transform = `translate3d(${roundedX}px, ${roundedY}px, 0)`;
      style.top = 0;
      style.left = 0;
      style.cursor = cursorStyle;
      style['--dockable-panel-translate-x'] = `${roundedX}px`;
      style['--dockable-panel-translate-y'] = `${roundedY}px`;
    } else if (panelState.position === 'right') {
      style.width = `${panelState.size.width}px`;
      style.height = '100%';
    } else if (panelState.position === 'bottom') {
      style.height = `${panelState.size.height}px`;
      style.width = '100%';
    }
    return style;
  }, [
    panelState.position,
    panelState.floatingPosition,
    panelState.size,
    panelState.zIndex,
    cursorStyle,
    isMaximized,
    maximizedRect,
  ]);

  if (!panelState.isOpen) return null;

  const panelElement = (
    <div
      ref={setPanelRef}
      className={panelClassName}
      style={panelStyle}
      onMouseDown={(e) => {
        panelState.focus();
        if (isMaximized) {
          return;
        }
        if (panelState.position === 'floating') {
          handleFloatingMouseDown(e);
        }
      }}
      onMouseMove={isMaximized ? undefined : handleMouseMove}
      role="dialog"
      aria-label={title}
      aria-modal={panelState.position === 'floating'}
    >
      <div
        className="dockable-panel__header"
        onMouseDown={(e) => {
          // Check if we're on a resize edge first
          if (panelState.position === 'floating') {
            const direction = getResizeDirection(e);
            if (!direction) {
              handleMouseDownDrag(e);
            }
          } else {
            handleMouseDownDrag(e);
          }
        }}
        role="banner"
      >
        <div className="dockable-panel__header-content">
          {headerContent || <span className="dockable-panel__title">{title}</span>}
        </div>
        <div className="dockable-panel__controls" onMouseDown={(e) => e.stopPropagation()}>
          {/* When floating, show bottom and right buttons */}
          {!isMaximized && panelState.position === 'floating' && (
            <>
              <button
                className="dockable-panel__control-btn"
                onClick={() => handleDock('bottom')}
                title="Dock to bottom"
                aria-label="Dock panel to bottom"
              >
                <DockBottomIcon width={20} height={20} />
              </button>
              <button
                className="dockable-panel__control-btn"
                onClick={() => handleDock('right')}
                title="Dock to right"
                aria-label="Dock panel to right side"
              >
                <DockRightIcon width={20} height={20} />
              </button>
            </>
          )}
          {/* When docked right, show bottom and float buttons */}
          {!isMaximized && panelState.position === 'right' && (
            <>
              <button
                className="dockable-panel__control-btn"
                onClick={() => handleDock('bottom')}
                title="Dock to bottom"
                aria-label="Dock panel to bottom"
              >
                <DockBottomIcon width={20} height={20} />
              </button>
              <button
                className="dockable-panel__control-btn"
                onClick={() => handleDock('floating')}
                title="Float panel"
                aria-label="Undock panel to floating window"
              >
                <FloatPanelIcon width={20} height={20} />
              </button>
            </>
          )}
          {/* When docked bottom, show right and float buttons */}
          {!isMaximized && panelState.position === 'bottom' && (
            <>
              <button
                className="dockable-panel__control-btn"
                onClick={() => handleDock('right')}
                title="Dock to right"
                aria-label="Dock panel to right side"
              >
                <DockRightIcon width={20} height={20} />
              </button>
              <button
                className="dockable-panel__control-btn"
                onClick={() => handleDock('floating')}
                title="Float panel"
                aria-label="Undock panel to floating window"
              >
                <FloatPanelIcon width={20} height={20} />
              </button>
            </>
          )}
          {allowMaximize && (
            <button
              className="dockable-panel__control-btn"
              onClick={handleToggleMaximize}
              title={isMaximized ? 'Restore panel' : 'Maximize panel'}
              aria-label={isMaximized ? 'Restore panel size' : 'Maximize panel'}
            >
              {isMaximized ? (
                <RestorePanelIcon width={20} height={20} />
              ) : (
                <MaximizePanelIcon width={20} height={20} />
              )}
            </button>
          )}
          <button
            className="dockable-panel__control-btn dockable-panel__control-btn--close"
            onClick={handleClose}
            title="Close panel"
            aria-label="Close panel"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 2L14 14M2 14L14 2" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        </div>
      </div>

      <div className={`dockable-panel__content ${contentClassName}`} role="main">
        {children}
      </div>

      {/* Resize handles */}
      {!isMaximized && panelState.position === 'right' && (
        <div
          className="dockable-panel__resize-handle dockable-panel__resize-handle--left"
          onMouseDown={(e) => handleMouseDownResize(e, 'w')}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel width"
          tabIndex={0}
        />
      )}
      {!isMaximized && panelState.position === 'bottom' && (
        <div
          className="dockable-panel__resize-handle dockable-panel__resize-handle--top"
          onMouseDown={(e) => handleMouseDownResize(e, 'n')}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize panel height"
          tabIndex={0}
        />
      )}
      {!isMaximized && panelState.position === 'floating' && (
        <>
          {/* Invisible resize zones for floating panels */}
          <div
            className="dockable-panel__resize-zone dockable-panel__resize-zone--top"
            onMouseDown={(e) => handleMouseDownResize(e, 'n')}
          />
          <div
            className="dockable-panel__resize-zone dockable-panel__resize-zone--bottom"
            onMouseDown={(e) => handleMouseDownResize(e, 's')}
          />
          <div
            className="dockable-panel__resize-zone dockable-panel__resize-zone--left"
            onMouseDown={(e) => handleMouseDownResize(e, 'w')}
          />
          <div
            className="dockable-panel__resize-zone dockable-panel__resize-zone--right"
            onMouseDown={(e) => handleMouseDownResize(e, 'e')}
          />
          <div
            className="dockable-panel__resize-zone dockable-panel__resize-zone--top-left"
            onMouseDown={(e) => handleMouseDownResize(e, 'nw')}
          />
          <div
            className="dockable-panel__resize-zone dockable-panel__resize-zone--top-right"
            onMouseDown={(e) => handleMouseDownResize(e, 'ne')}
          />
          <div
            className="dockable-panel__resize-zone dockable-panel__resize-zone--bottom-left"
            onMouseDown={(e) => handleMouseDownResize(e, 'sw')}
          />
          <div
            className="dockable-panel__resize-zone dockable-panel__resize-zone--bottom-right"
            onMouseDown={(e) => handleMouseDownResize(e, 'se')}
          />
        </>
      )}
    </div>
  );

  if (!panelHostNode) {
    return null;
  }

  return createPortal(panelElement, panelHostNode);
};

const DockablePanel = memo<DockablePanelProps>((props) => {
  if (!props.panelId) {
    console.error('DockablePanel: panelId prop is required');
    return null;
  }

  return <DockablePanelInner {...props} />;
});

DockablePanel.displayName = 'DockablePanel';

export default DockablePanel;
