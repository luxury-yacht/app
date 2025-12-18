import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

// Manages drag-to-resize and double-click autosize for GridTable headers. Keeps
// track of the active resize gesture, applies width changes within min/max
// constraints, and records which columns were manually resized for persistence.

interface ResizeState {
  leftKey: string;
  rightKey: string;
  startX: number;
  leftStartWidth: number;
}

export interface ColumnResizeControllerOptions<T> {
  columns: GridColumnDefinition<T>[];
  renderedColumns: GridColumnDefinition<T>[];
  columnWidths: Record<string, number>;
  setColumnWidths: (updater: React.SetStateAction<Record<string, number>>) => void;
  manuallyResizedColumnsRef: React.RefObject<Set<string>>;
  getColumnMinWidth: (column: GridColumnDefinition<T>) => number;
  getColumnMaxWidth: (column: GridColumnDefinition<T>) => number;
  measureColumnWidth: (column: GridColumnDefinition<T>) => number;
  enableColumnResizing: boolean;
  isFixedColumnKey: (key: string) => boolean;
  onManualResize?: (event: {
    type: 'dragStart' | 'drag' | 'dragEnd' | 'autoSize' | 'reset';
    columns: string[];
  }) => void;
}

export interface ColumnResizeController {
  handleResizeStart: (event: React.MouseEvent, leftKey: string, rightKey: string) => void;
  autoSizeColumn: (columnKey: string) => void;
  resetManualResizes: () => void;
}

export function useColumnResizeController<T>({
  columns,
  renderedColumns,
  columnWidths,
  setColumnWidths,
  manuallyResizedColumnsRef,
  getColumnMinWidth,
  getColumnMaxWidth,
  measureColumnWidth,
  enableColumnResizing,
  isFixedColumnKey,
  onManualResize,
}: ColumnResizeControllerOptions<T>): ColumnResizeController {
  const [resizing, setResizing] = useState<ResizeState | null>(null);

  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const renderedColumnsRef = useRef(renderedColumns);
  renderedColumnsRef.current = renderedColumns;
  const resizeRafRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<number | null>(null);

  const handleResizeStart = useCallback(
    (event: React.MouseEvent, leftKey: string, rightKey: string) => {
      if (!enableColumnResizing) {
        return;
      }

      const leftColumn = columnsRef.current.find((col) => col.key === leftKey);
      const rightColumn = columnsRef.current.find((col) => col.key === rightKey);
      if (!leftColumn || !rightColumn) {
        return;
      }
      if (isFixedColumnKey(leftKey) || isFixedColumnKey(rightKey)) {
        return;
      }

      event.preventDefault?.();
      event.stopPropagation?.();

      const leftWidth = columnWidths[leftKey] ?? getColumnMinWidth(leftColumn);

      setResizing({
        leftKey,
        rightKey,
        startX: event.clientX,
        leftStartWidth: leftWidth,
      });
      onManualResize?.({ type: 'dragStart', columns: [leftKey] });
      onManualResize?.({ type: 'drag', columns: [leftKey] });
    },
    [columnWidths, enableColumnResizing, getColumnMinWidth, isFixedColumnKey, onManualResize]
  );

  useEffect(() => {
    if (!enableColumnResizing) {
      return;
    }
    if (!resizing) {
      return;
    }
    if (typeof document === 'undefined') {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const leftColumn = columnsRef.current.find((col) => col.key === resizing.leftKey);
      const rightColumn = columnsRef.current.find((col) => col.key === resizing.rightKey);
      if (!leftColumn || !rightColumn) {
        return;
      }

      const diff = event.clientX - resizing.startX;
      const leftMin = getColumnMinWidth(leftColumn);
      const leftMax = getColumnMaxWidth(leftColumn);

      let nextLeft = Math.round(resizing.leftStartWidth + diff);
      if (nextLeft < leftMin) {
        nextLeft = leftMin;
      }
      if (nextLeft > leftMax) {
        nextLeft = leftMax;
      }

      pendingResizeRef.current = nextLeft;

      if (resizeRafRef.current == null) {
        const applyResize = () => {
          resizeRafRef.current = null;
          const pending = pendingResizeRef.current;
          if (pending == null) {
            return;
          }
          pendingResizeRef.current = null;
          setColumnWidths((prev) => ({
            ...prev,
            [resizing.leftKey]: pending,
          }));
          manuallyResizedColumnsRef.current.add(resizing.leftKey);
        };

        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          resizeRafRef.current = window.requestAnimationFrame(applyResize);
        } else {
          applyResize();
        }
      }
    };

    const handleMouseUp = () => {
      if (resizeRafRef.current != null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      const pending = pendingResizeRef.current;
      if (pending != null) {
        pendingResizeRef.current = null;
        setColumnWidths((prev) => ({
          ...prev,
          [resizing.leftKey]: pending,
        }));
        manuallyResizedColumnsRef.current.add(resizing.leftKey);
      } else {
        pendingResizeRef.current = null;
      }
      onManualResize?.({
        type: 'dragEnd',
        columns: [resizing.leftKey],
      });
      setResizing(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (resizeRafRef.current != null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      pendingResizeRef.current = null;
    };
  }, [
    enableColumnResizing,
    getColumnMaxWidth,
    getColumnMinWidth,
    manuallyResizedColumnsRef,
    onManualResize,
    resizing,
    setColumnWidths,
  ]);

  const autoSizeColumn = useCallback(
    (columnKey: string) => {
      if (!enableColumnResizing) {
        return;
      }
      if (isFixedColumnKey(columnKey)) {
        return;
      }

      const columnsSnapshot = columnsRef.current;

      const column = columnsSnapshot.find((col) => col.key === columnKey);
      if (!column) {
        return;
      }

      const measuredWidth = measureColumnWidth(column);
      const minWidth = getColumnMinWidth(column);
      const maxWidth = getColumnMaxWidth(column);
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, measuredWidth));

      manuallyResizedColumnsRef.current.delete(columnKey);

      setColumnWidths((prev) => {
        const currentWidth = prev[columnKey] ?? 0;
        if (Math.abs(currentWidth - clampedWidth) < 0.5) {
          return prev;
        }

        return { ...prev, [columnKey]: clampedWidth };
      });

      manuallyResizedColumnsRef.current.add(columnKey);
      onManualResize?.({ type: 'autoSize', columns: [columnKey] });
    },
    [
      enableColumnResizing,
      getColumnMaxWidth,
      getColumnMinWidth,
      isFixedColumnKey,
      manuallyResizedColumnsRef,
      measureColumnWidth,
      setColumnWidths,
      onManualResize,
    ]
  );

  const resetManualResizes = useCallback(() => {
    const manualKeys = Array.from(manuallyResizedColumnsRef.current);
    manuallyResizedColumnsRef.current.clear();
    if (manualKeys.length > 0) {
      onManualResize?.({ type: 'reset', columns: manualKeys });
    }
  }, [manuallyResizedColumnsRef, onManualResize]);

  return {
    handleResizeStart,
    autoSizeColumn,
    resetManualResizes,
  };
}
