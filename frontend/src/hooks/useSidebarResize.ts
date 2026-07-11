/**
 * frontend/src/hooks/useSidebarResize.ts
 *
 * Hook for useSidebarResize.
 * Handles sidebar resize drag behavior with document-level mouse tracking.
 */
import { useCallback, useEffect, useState } from 'react';

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 500;
const SIDEBAR_KEYBOARD_STEP = 16;

export function getSidebarWidthFromKey(
  currentWidth: number,
  key: string,
  minWidth = SIDEBAR_MIN_WIDTH,
  maxWidth = SIDEBAR_MAX_WIDTH
): number | null {
  const clamp = (width: number) => Math.max(minWidth, Math.min(maxWidth, width));
  if (key === 'ArrowLeft') {
    return clamp(currentWidth - SIDEBAR_KEYBOARD_STEP);
  }
  if (key === 'ArrowRight') {
    return clamp(currentWidth + SIDEBAR_KEYBOARD_STEP);
  }
  if (key === 'Home') {
    return minWidth;
  }
  if (key === 'End') {
    return maxWidth;
  }
  return null;
}

interface SidebarResizeOptions {
  isResizing: boolean;
  onWidthChange: (width: number) => void;
  onResizeEnd: () => void;
  minWidth?: number;
  maxWidth?: number;
}

/**
 * Handles sidebar resize drag behavior with document-level mouse tracking.
 */
export function useSidebarResize({
  isResizing: externalIsResizing,
  onWidthChange,
  onResizeEnd,
  minWidth = SIDEBAR_MIN_WIDTH,
  maxWidth = SIDEBAR_MAX_WIDTH,
}: SidebarResizeOptions): void {
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const newWidth = Math.max(minWidth, Math.min(maxWidth, e.clientX));
      onWidthChange(newWidth);
    },
    [minWidth, maxWidth, onWidthChange]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    onResizeEnd();
  }, [onResizeEnd]);

  // Sync with external isResizing state
  useEffect(() => {
    if (externalIsResizing && !isResizing) {
      setIsResizing(true);
    }
  }, [externalIsResizing, isResizing]);

  // Handle document-level mouse events during resize
  useEffect(() => {
    if (!isResizing) {
      return;
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.classList.add('sidebar-resizing');

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.classList.remove('sidebar-resizing');
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);
}
