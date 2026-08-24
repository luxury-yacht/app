import type {
  ColumnWidthState,
  GridColumnDefinition,
  GridTableVirtualizationOptions,
} from '@shared/components/tables/GridTable.types';
import { useColumnResizeController } from '@shared/components/tables/hooks/useColumnResizeController';
import { useGridTableColumnMeasurer } from '@shared/components/tables/hooks/useGridTableColumnMeasurer';
import {
  type ColumnRenderModel,
  useGridTableColumnVirtualization,
} from '@shared/components/tables/hooks/useGridTableColumnVirtualization';
import { useGridTableColumnWidths } from '@shared/components/tables/hooks/useGridTableColumnWidths';

import type React from 'react';
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo } from 'react';

export const getVisibleAutoColumnKeys = <T>({
  columnRenderModels,
  columnVirtualizationConfig,
  columnWindowRange,
}: {
  columnRenderModels: Array<ColumnRenderModel<T>>;
  columnVirtualizationConfig: {
    enabled: boolean;
    stickyStart: number;
    stickyEnd: number;
  };
  columnWindowRange: { startIndex: number; endIndex: number };
}): string[] => {
  if (columnRenderModels.length === 0) {
    return [];
  }
  if (!columnVirtualizationConfig.enabled) {
    return columnRenderModels.filter((model) => model.column.autoWidth).map((model) => model.key);
  }
  const total = columnRenderModels.length;
  if (total === 0) {
    return [];
  }
  const stickyStart = Math.min(columnVirtualizationConfig.stickyStart, total);
  const stickyEnd = Math.min(
    columnVirtualizationConfig.stickyEnd,
    Math.max(0, total - stickyStart)
  );
  const visibleKeys = new Set<string>();
  columnRenderModels.forEach((model, index) => {
    if (!model.column.autoWidth) {
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
  columnVirtualizationConfig: {
    enabled: boolean;
    overscanColumns: number;
    stickyStart: number;
    stickyEnd: number;
  };
  columnRenderModels: Array<ColumnRenderModel<T>>;
  columnWindowRange: { startIndex: number; endIndex: number };
  updateColumnWindowRange: () => void;
  tableContentWidth: number;
  handleResizeStart: (event: React.MouseEvent, leftKey: string, rightKey: string) => void;
  handleResizeKeyDown: (event: React.KeyboardEvent, columnKey: string) => void;
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
    columnRenderModels,
    columnWindowRange,
    updateColumnWindowRange,
  } = useGridTableColumnVirtualization({
    renderedColumns,
    columnWidths,
    virtualization,
    wrapperRef,
  });

  const tableContentWidth = useMemo(() => {
    if (columnRenderModels.length === 0) {
      return 0;
    }
    const lastModel = columnRenderModels[columnRenderModels.length - 1];
    return Number.isFinite(lastModel.end) ? lastModel.end : 0;
  }, [columnRenderModels]);

  useEffect(() => {
    void columnVirtualizationConfig.enabled;
    markAllAutoColumnsDirty();
  }, [markAllAutoColumnsDirty, columnVirtualizationConfig.enabled]);

  const visibleAutoColumnKeys = useMemo(
    () =>
      getVisibleAutoColumnKeys({
        columnRenderModels,
        columnVirtualizationConfig,
        columnWindowRange,
      }),
    [columnRenderModels, columnVirtualizationConfig, columnWindowRange]
  );

  const markVisibleAutoColumnsDirty = useCallback(() => {
    if (visibleAutoColumnKeys.length === 0) {
      return;
    }
    markColumnsDirty(visibleAutoColumnKeys);
  }, [markColumnsDirty, visibleAutoColumnKeys]);

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
    columnVirtualizationConfig,
    columnRenderModels,
    columnWindowRange,
    updateColumnWindowRange,
    tableContentWidth,
    handleResizeStart,
    handleResizeKeyDown,
    autoSizeColumn,
    markVisibleAutoColumnsDirty,
    canResetAutoWidthColumns,
    resetAutoWidthColumns,
  };
}
