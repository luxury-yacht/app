import type {
  ColumnWidthState,
  GridColumnDefinition,
  GridTableVirtualizationOptions,
} from '@shared/components/tables/GridTable.types';
import {
  getColumnMaxWidth,
  getColumnMinWidth,
} from '@shared/components/tables/hooks/gridTableColumnWidthMath';
import { useColumnResizeController } from '@shared/components/tables/hooks/useColumnResizeController';
import { useContainerWidthObserver } from '@shared/components/tables/hooks/useContainerWidthObserver';
import { useGridTableColumnMeasurer } from '@shared/components/tables/hooks/useGridTableColumnMeasurer';
import {
  type ColumnRenderModel,
  useGridTableColumnVirtualization,
} from '@shared/components/tables/hooks/useGridTableColumnVirtualization';
import { useGridTableColumnWidths } from '@shared/components/tables/hooks/useGridTableColumnWidths';

import type React from 'react';
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

export const getVisibleAutoColumnKeys = <T>({
  renderedColumns,
  columnRenderModelsWithOffsets,
  columnVirtualizationConfig,
  columnWindowRange,
}: {
  renderedColumns: GridColumnDefinition<T>[];
  columnRenderModelsWithOffsets: Array<ColumnRenderModel<T>>;
  columnVirtualizationConfig: {
    enabled: boolean;
    stickyStart: number;
    stickyEnd: number;
  };
  columnWindowRange: { startIndex: number; endIndex: number };
}): string[] => {
  if (renderedColumns.length === 0) {
    return [];
  }
  if (!columnVirtualizationConfig.enabled) {
    return renderedColumns.filter((column) => column.autoWidth).map((column) => column.key);
  }
  const total = columnRenderModelsWithOffsets.length;
  if (total === 0) {
    return [];
  }
  const stickyStart = Math.min(columnVirtualizationConfig.stickyStart, total);
  const stickyEnd = Math.min(
    columnVirtualizationConfig.stickyEnd,
    Math.max(0, total - stickyStart)
  );
  const visibleKeys = new Set<string>();
  columnRenderModelsWithOffsets.forEach((model, index) => {
    const column = renderedColumns[index];
    if (!column?.autoWidth) {
      return;
    }
    const isSticky = index < stickyStart || index >= total - stickyEnd;
    if (
      isSticky ||
      (index >= columnWindowRange.startIndex && index <= columnWindowRange.endIndex)
    ) {
      visibleKeys.add(model.key);
    }
  });
  return Array.from(visibleKeys);
};

interface UseGridTableColumnLayoutOptions<T> {
  columns: GridColumnDefinition<T>[];
  renderedColumns: GridColumnDefinition<T>[];
  tableRef: RefObject<HTMLDivElement | null>;
  wrapperRef: RefObject<HTMLDivElement | null>;
  tableData: T[];
  controlledColumnWidths?: Record<string, ColumnWidthState> | null;
  externalColumnWidths: Record<string, number> | null;
  enableColumnResizing: boolean;
  onColumnWidthsChange?: (widths: Record<string, ColumnWidthState>) => void;
  useShortNames: boolean;
  virtualization?: GridTableVirtualizationOptions;
}

interface GridTableColumnLayout<T> {
  columnWidths: Record<string, number>;
  columnVirtualizationConfig: {
    enabled: boolean;
    overscanColumns: number;
    stickyStart: number;
    stickyEnd: number;
  };
  columnRenderModelsWithOffsets: Array<ColumnRenderModel<T>>;
  columnWindowRange: { startIndex: number; endIndex: number };
  updateColumnWindowRange: () => void;
  tableContentWidth: number;
  tableViewportWidth: number;
  handleResizeStart: (event: React.MouseEvent, leftKey: string, rightKey: string) => void;
  handleResizeKeyDown: (event: React.KeyboardEvent, columnKey: string) => void;
  getColumnMinWidth: (column: GridColumnDefinition<T>) => number;
  getColumnMaxWidth: (column: GridColumnDefinition<T>) => number;
  autoSizeColumn: (columnKey: string) => void;
  markVisibleAutoColumnsDirty: () => void;
  canResetAutoWidthColumns: boolean;
  resetAutoWidthColumns: () => void;
}

export function useGridTableColumnLayout<T>({
  columns,
  renderedColumns,
  tableRef,
  wrapperRef,
  tableData,
  controlledColumnWidths,
  externalColumnWidths,
  enableColumnResizing,
  onColumnWidthsChange,
  useShortNames,
  virtualization,
}: UseGridTableColumnLayoutOptions<T>): GridTableColumnLayout<T> {
  const [tableViewportWidth, setTableViewportWidth] = useState(0);
  const tableRefMutable = tableRef as RefObject<HTMLElement | null>;

  const { measureColumnWidth } = useGridTableColumnMeasurer<T>({
    tableData,
  });

  const {
    columnWidths,
    setColumnWidths,
    manuallyResizedColumnsRef,
    markColumnsDirty,
    markAllAutoColumnsDirty,
    handleManualResizeEvent,
    canResetAutoWidthColumns,
    resetAutoWidthColumns,
  } = useGridTableColumnWidths<T>({
    columns,
    renderedColumns,
    tableRef: tableRefMutable,
    tableData,
    controlledColumnWidths,
    externalColumnWidths,
    enableColumnResizing,
    onColumnWidthsChange,
    useShortNames,
    measureColumnWidth,
  });

  const {
    columnVirtualizationConfig,
    columnRenderModelsWithOffsets,
    columnWindowRange,
    updateColumnWindowRange,
  } = useGridTableColumnVirtualization({
    renderedColumns,
    columnWidths,
    virtualization,
    wrapperRef,
  });

  const tableContentWidth = useMemo(() => {
    if (columnRenderModelsWithOffsets.length === 0) {
      return 0;
    }
    const lastModel = columnRenderModelsWithOffsets[columnRenderModelsWithOffsets.length - 1];
    return Number.isFinite(lastModel.end) ? lastModel.end : 0;
  }, [columnRenderModelsWithOffsets]);

  useEffect(() => {
    void columnVirtualizationConfig.enabled;
    markAllAutoColumnsDirty();
  }, [markAllAutoColumnsDirty, columnVirtualizationConfig.enabled]);

  const visibleAutoColumnKeys = useMemo(
    () =>
      getVisibleAutoColumnKeys({
        renderedColumns,
        columnRenderModelsWithOffsets,
        columnVirtualizationConfig,
        columnWindowRange,
      }),
    [columnRenderModelsWithOffsets, columnVirtualizationConfig, columnWindowRange, renderedColumns]
  );

  const markVisibleAutoColumnsDirty = useCallback(() => {
    if (visibleAutoColumnKeys.length === 0) {
      return;
    }
    markColumnsDirty(visibleAutoColumnKeys);
  }, [markColumnsDirty, visibleAutoColumnKeys]);

  const recalculateForContainerWidth = useCallback((incomingWidth: number) => {
    if (!incomingWidth || incomingWidth <= 0) {
      return;
    }
    setTableViewportWidth((prev) => (Math.abs(prev - incomingWidth) < 0.5 ? prev : incomingWidth));
  }, []);

  useContainerWidthObserver({
    tableRef: tableRefMutable,
    onContainerWidth: recalculateForContainerWidth,
    tableDataLength: tableData.length,
  });

  const { handleResizeStart, handleResizeKeyDown, autoSizeColumn, resetManualResizes } =
    useColumnResizeController<T>({
      columns,
      renderedColumns,
      columnWidths,
      setColumnWidths,
      manuallyResizedColumnsRef,
      measureColumnWidth,
      enableColumnResizing,
      onManualResize: handleManualResizeEvent,
    });

  useEffect(() => {
    if (!enableColumnResizing) {
      resetManualResizes();
    }
  }, [enableColumnResizing, resetManualResizes]);

  return {
    columnWidths,
    columnVirtualizationConfig,
    columnRenderModelsWithOffsets,
    columnWindowRange,
    updateColumnWindowRange,
    tableContentWidth,
    tableViewportWidth,
    handleResizeStart,
    handleResizeKeyDown,
    getColumnMinWidth,
    getColumnMaxWidth,
    autoSizeColumn,
    markVisibleAutoColumnsDirty,
    canResetAutoWidthColumns,
    resetAutoWidthColumns,
  };
}
