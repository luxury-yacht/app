/**
 * frontend/src/shared/components/tables/hooks/useColumnResizeController.ts
 *
 * React hook for useColumnResizeController.
 * Encapsulates state and side effects for the shared components.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import {
  clampAutoSizeColumnWidth,
  clampColumnWidth,
  getColumnMaxWidth,
  getColumnMinWidth,
} from '@shared/components/tables/hooks/gridTableColumnWidthMath';
import { acquireColumnResizeCursor } from '@shared/utils/columnResizeCursor';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

// Manages drag-to-resize and double-click autosize for GridTable headers. Keeps
// track of the active resize gesture, applies width changes within min/max
// constraints, and records which columns were manually resized for persistence.

interface ResizeState {
  leftKey: string;
  rightKey: string;
  startX: number;
  leftStartWidth: number;
}

const KEYBOARD_RESIZE_STEP = 16;

export interface ColumnResizeControllerOptions<T> {
  columns: GridColumnDefinition<T>[];
  renderedColumns: GridColumnDefinition<T>[];
  columnWidths: Record<string, number>;
  setColumnWidths: (updater: React.SetStateAction<Record<string, number>>) => void;
  manuallyResizedColumnsRef: React.RefObject<Set<string>>;
  measureColumnWidth: (column: GridColumnDefinition<T>) => number;
  enableColumnResizing: boolean;
  onManualResize?: (event: {
    type: 'dragStart' | 'drag' | 'dragEnd' | 'autoSize' | 'reset';
    columns: string[];
  }) => void;
}

export interface ColumnResizeController {
  handleResizeStart: (event: React.MouseEvent, leftKey: string, rightKey: string) => void;
  handleResizeKeyDown: (event: React.KeyboardEvent, columnKey: string) => void;
  autoSizeColumn: (columnKey: string) => void;
  resetManualResizes: () => void;
}

export function useColumnResizeController<T>({
  columns,
  renderedColumns,
  columnWidths,
  setColumnWidths,
  manuallyResizedColumnsRef,
  measureColumnWidth,
  enableColumnResizing,
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
      if (
        !leftColumn ||
        !rightColumn ||
        leftColumn.resizable === false ||
        rightColumn.resizable === false
      ) {
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
    [columnWidths, enableColumnResizing, onManualResize]
  );

  const handleResizeKeyDown = useCallback(
    (event: React.KeyboardEvent, columnKey: string) => {
      if (!enableColumnResizing) {
        return;
      }
      const column = columnsRef.current.find((candidate) => candidate.key === columnKey);
      if (!column || column.resizable === false) {
        return;
      }

      const minimum = getColumnMinWidth(column);
      const maximum = getColumnMaxWidth(column);
      const current = columnWidths[columnKey] ?? minimum;
      let nextWidth: number;
      switch (event.key) {
        case 'ArrowLeft':
          nextWidth = current - KEYBOARD_RESIZE_STEP;
          break;
        case 'ArrowRight':
          nextWidth = current + KEYBOARD_RESIZE_STEP;
          break;
        case 'Home':
          nextWidth = minimum;
          break;
        case 'End':
          nextWidth = maximum;
          break;
        default:
          return;
      }

      event.preventDefault();
      event.stopPropagation();
      const clampedWidth = clampColumnWidth(column, nextWidth);
      onManualResize?.({ type: 'dragStart', columns: [columnKey] });
      onManualResize?.({ type: 'drag', columns: [columnKey] });
      setColumnWidths((previous) => ({ ...previous, [columnKey]: clampedWidth }));
      manuallyResizedColumnsRef.current.add(columnKey);
      onManualResize?.({ type: 'dragEnd', columns: [columnKey] });
    },
    [columnWidths, enableColumnResizing, manuallyResizedColumnsRef, onManualResize, setColumnWidths]
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
      const rightColumnExists = columnsRef.current.some((col) => col.key === resizing.rightKey);
      if (!leftColumn || !rightColumnExists) {
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

      if (resizeRafRef.current === null || resizeRafRef.current === undefined) {
        const applyResize = () => {
          resizeRafRef.current = null;
          const pending = pendingResizeRef.current;
          if (pending === null || pending === undefined) {
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
      if (
        resizeRafRef.current !== null &&
        resizeRafRef.current !== undefined &&
        typeof window !== 'undefined'
      ) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      const pending = pendingResizeRef.current;
      if (pending !== null && pending !== undefined) {
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
    const releaseCursor = acquireColumnResizeCursor();
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      releaseCursor();
      document.body.style.userSelect = '';
      if (
        resizeRafRef.current !== null &&
        resizeRafRef.current !== undefined &&
        typeof window !== 'undefined'
      ) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      pendingResizeRef.current = null;
    };
  }, [enableColumnResizing, manuallyResizedColumnsRef, onManualResize, resizing, setColumnWidths]);

  const autoSizeColumn = useCallback(
    (columnKey: string) => {
      if (!enableColumnResizing) {
        return;
      }
      const columnsSnapshot = columnsRef.current;

      const column = columnsSnapshot.find((col) => col.key === columnKey);
      if (!column || column.resizable === false) {
        return;
      }

      const measuredWidth = measureColumnWidth(column);
      const clampedWidth = clampAutoSizeColumnWidth(column, measuredWidth);

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
    handleResizeKeyDown,
    autoSizeColumn,
    resetManualResizes,
  };
}
