/**
 * frontend/src/hooks/useSidebarResize.ts
 *
 * Hook for useSidebarResize.
 * Handles sidebar resize drag behavior with document-level mouse tracking.
 */
import { useEffect, useState, useCallback } from 'react';

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
  minWidth = 200,
  maxWidth = 600,
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
    if (!isResizing) return;

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);
}
