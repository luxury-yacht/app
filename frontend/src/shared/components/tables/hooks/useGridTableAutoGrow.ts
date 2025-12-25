/**
 * frontend/src/shared/components/tables/hooks/useGridTableAutoGrow.ts
 *
 * React hook for useGridTableAutoGrow.
 * Encapsulates state and side effects for the shared components.
 */

import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

// Ensures kind/type columns stay fully readable: when kind columns are present,
// measure them after render and grow widths (and the table) to fit their labels.

interface UseGridTableAutoGrowOptions<T> {
  tableRef: RefObject<HTMLDivElement | null>;
  tableDataLength: number;
  renderedColumns: GridColumnDefinition<T>[];
  isKindColumnKey: (key: string) => boolean;
  externalColumnWidths: Record<string, number> | null;
  measureColumnWidth: (column: GridColumnDefinition<T>) => number;
  setColumnWidths: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
  reconcileWidthsToContainer: (
    base: Record<string, number>,
    containerWidth: number
  ) => Record<string, number>;
  updateNaturalWidth?: (key: string, width: number) => void;
}

export function useGridTableAutoGrow<T>({
  tableRef,
  tableDataLength,
  renderedColumns,
  isKindColumnKey,
  externalColumnWidths,
  measureColumnWidth,
  setColumnWidths,
  reconcileWidthsToContainer,
  updateNaturalWidth,
}: UseGridTableAutoGrowOptions<T>) {
  useEffect(() => {
    if (!tableRef.current || tableDataLength === 0) {
      return;
    }

    const hasAutoGrowFixedColumn = renderedColumns.some((col) => isKindColumnKey(col.key));
    if (!hasAutoGrowFixedColumn) {
      return;
    }

    const container = tableRef.current.closest('.gridtable-wrapper') as HTMLElement | null;
    if (!container) {
      return;
    }

    setColumnWidths((prev) => {
      let changed = false;
      const next = { ...prev };

      renderedColumns.forEach((col) => {
        if (!isKindColumnKey(col.key)) {
          return;
        }

        const currentWidth = prev[col.key] ?? externalColumnWidths?.[col.key] ?? 0;
        const measuredWidth = measureColumnWidth(col);
        updateNaturalWidth?.(col.key, measuredWidth);

        if (measuredWidth > currentWidth + 0.5) {
          next[col.key] = measuredWidth;
          changed = true;
        }
      });

      if (!changed) {
        return prev;
      }

      return reconcileWidthsToContainer(next, container.clientWidth);
    });
  }, [
    tableRef,
    tableDataLength,
    renderedColumns,
    isKindColumnKey,
    externalColumnWidths,
    measureColumnWidth,
    setColumnWidths,
    reconcileWidthsToContainer,
    updateNaturalWidth,
  ]);
}
