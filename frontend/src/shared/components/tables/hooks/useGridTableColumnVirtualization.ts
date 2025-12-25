/**
 * frontend/src/shared/components/tables/hooks/useGridTableColumnVirtualization.ts
 *
 * React hook for useGridTableColumnVirtualization.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import type {
  GridColumnDefinition,
  GridTableVirtualizationOptions,
} from '@shared/components/tables/GridTable.types';

// Computes which columns to render (and their offsets/styles) when column
// virtualization is enabled, while respecting sticky columns on both ends and
// updating the window range on scroll.

export interface ColumnRenderModel<T> {
  column: GridColumnDefinition<T>;
  key: string;
  className: string;
  cellStyle: CSSProperties;
  start: number;
  end: number;
  width: number;
}

export interface UseGridTableColumnVirtualizationParams<T> {
  renderedColumns: GridColumnDefinition<T>[];
  columnWidths: Record<string, number>;
  virtualization?: GridTableVirtualizationOptions;
  wrapperRef: RefObject<HTMLDivElement | null>;
}

export interface UseGridTableColumnVirtualizationResult<T> {
  columnVirtualizationConfig: {
    enabled: boolean;
    overscanColumns: number;
    stickyStart: number;
    stickyEnd: number;
  };
  columnRenderModels: Array<ColumnRenderModel<T>>;
  columnRenderModelsWithOffsets: Array<ColumnRenderModel<T>>;
  columnWindowRange: { startIndex: number; endIndex: number };
  updateColumnWindowRange: () => void;
}

export function useGridTableColumnVirtualization<T>({
  renderedColumns,
  columnWidths,
  virtualization,
  wrapperRef,
}: UseGridTableColumnVirtualizationParams<T>): UseGridTableColumnVirtualizationResult<T> {
  const columnVirtualizationConfig = useMemo(
    () => ({
      enabled: Boolean(virtualization?.columnWindow?.enabled),
      overscanColumns: Math.max(0, virtualization?.columnWindow?.overscanColumns ?? 1),
      stickyStart: Math.max(0, virtualization?.columnWindow?.stickyStart ?? 1),
      stickyEnd: Math.max(0, virtualization?.columnWindow?.stickyEnd ?? 0),
    }),
    [virtualization]
  );

  const columnRenderModels = useMemo(() => {
    return renderedColumns.map((column) => {
      const width = columnWidths[column.key] ?? 0;
      return {
        column,
        key: column.key,
        className: column.className || '',
        cellStyle: {
          width: `${width}px`,
          minWidth: `${width}px`,
          maxWidth: `${width}px`,
          flexShrink: 0,
        } as CSSProperties,
        start: 0,
        end: width,
        width,
      };
    });
  }, [renderedColumns, columnWidths]);

  const columnRenderModelsWithOffsets = useMemo(() => {
    let offset = 0;
    return columnRenderModels.map((model) => {
      const widthPx = Number.parseFloat(model.cellStyle.width as string);
      const safeWidth = Number.isFinite(widthPx) ? widthPx : 0;
      const start = offset;
      offset += safeWidth;
      return {
        ...model,
        start,
        end: offset,
        width: safeWidth,
      };
    });
  }, [columnRenderModels]);

  const [columnWindowRange, setColumnWindowRange] = useState(() => ({
    startIndex: 0,
    endIndex: Math.max(0, renderedColumns.length - 1),
  }));

  const ensureFullColumnWindow = useCallback(() => {
    setColumnWindowRange((prev) => {
      const fullRange = {
        startIndex: 0,
        endIndex: Math.max(0, columnRenderModelsWithOffsets.length - 1),
      };
      return prev.startIndex === fullRange.startIndex && prev.endIndex === fullRange.endIndex
        ? prev
        : fullRange;
    });
  }, [columnRenderModelsWithOffsets.length]);

  const updateColumnWindowRange = useCallback(() => {
    if (!columnVirtualizationConfig.enabled) {
      ensureFullColumnWindow();
      return;
    }

    const wrapper = wrapperRef.current;
    if (!wrapper || columnRenderModelsWithOffsets.length === 0) {
      ensureFullColumnWindow();
      return;
    }

    const viewportWidth = wrapper.clientWidth;
    const scrollLeft = wrapper.scrollLeft;
    const visibleStart = scrollLeft;
    const visibleEnd = scrollLeft + viewportWidth;

    let startIdx = 0;
    let endIdx = columnRenderModelsWithOffsets.length - 1;

    while (
      startIdx < columnRenderModelsWithOffsets.length &&
      columnRenderModelsWithOffsets[startIdx].end <= visibleStart
    ) {
      startIdx += 1;
    }

    while (endIdx >= 0 && columnRenderModelsWithOffsets[endIdx].start >= visibleEnd) {
      endIdx -= 1;
    }

    if (startIdx > endIdx) {
      startIdx = Math.max(0, Math.min(columnRenderModelsWithOffsets.length - 1, startIdx));
      endIdx = startIdx;
    }

    startIdx = Math.max(0, startIdx - columnVirtualizationConfig.overscanColumns);
    endIdx = Math.min(
      columnRenderModelsWithOffsets.length - 1,
      endIdx + columnVirtualizationConfig.overscanColumns
    );

    setColumnWindowRange((prev) =>
      prev.startIndex === startIdx && prev.endIndex === endIdx
        ? prev
        : { startIndex: startIdx, endIndex: endIdx }
    );
  }, [
    columnRenderModelsWithOffsets,
    columnVirtualizationConfig.enabled,
    columnVirtualizationConfig.overscanColumns,
    ensureFullColumnWindow,
    wrapperRef,
  ]);

  useEffect(() => {
    if (!columnVirtualizationConfig.enabled) {
      ensureFullColumnWindow();
      return;
    }
    updateColumnWindowRange();
  }, [
    columnVirtualizationConfig.enabled,
    ensureFullColumnWindow,
    updateColumnWindowRange,
    columnRenderModelsWithOffsets,
  ]);

  return {
    columnVirtualizationConfig,
    columnRenderModels,
    columnRenderModelsWithOffsets,
    columnWindowRange,
    updateColumnWindowRange,
  };
}
