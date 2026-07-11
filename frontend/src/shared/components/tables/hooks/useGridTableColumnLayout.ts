import type {
  ColumnWidthInput,
  ColumnWidthState,
  GridColumnDefinition,
  GridTableVirtualizationOptions,
} from '@shared/components/tables/GridTable.types';
import {
  DEFAULT_COLUMN_MIN_WIDTH,
  DEFAULT_COLUMN_WIDTH,
  isFixedColumnKey,
  normalizeKindClass,
  parseWidthInputToNumber,
} from '@shared/components/tables/GridTable.utils';
import { useColumnResizeController } from '@shared/components/tables/hooks/useColumnResizeController';
import { useContainerWidthObserver } from '@shared/components/tables/hooks/useContainerWidthObserver';
import { useGridTableAutoGrow } from '@shared/components/tables/hooks/useGridTableAutoGrow';
import { useGridTableColumnMeasurer } from '@shared/components/tables/hooks/useGridTableColumnMeasurer';
import {
  type ColumnRenderModel,
  useGridTableColumnVirtualization,
} from '@shared/components/tables/hooks/useGridTableColumnVirtualization';
import { useGridTableColumnWidths } from '@shared/components/tables/hooks/useGridTableColumnWidths';

import type React from 'react';
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const getColumnMinWidth = <T>(column: GridColumnDefinition<T>) => {
  const parsed = parseWidthInputToNumber(column.minWidth);
  if (parsed !== null && parsed !== undefined) {
    return parsed;
  }
  return DEFAULT_COLUMN_MIN_WIDTH;
};

const getColumnMaxWidth = <T>(column: GridColumnDefinition<T>) => {
  const parsed = parseWidthInputToNumber(column.maxWidth);
  if (parsed !== null && parsed !== undefined) {
    return parsed;
  }
  return Number.POSITIVE_INFINITY;
};

const areWidthMapsEqual = (a: Record<string, number>, b: Record<string, number>): boolean => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
};

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
  initialColumnWidths?: Record<string, ColumnWidthInput>;
  controlledColumnWidths?: Record<string, ColumnWidthState> | null;
  externalColumnWidths: Record<string, number> | null;
  enableColumnResizing: boolean;
  onColumnWidthsChange?: (widths: Record<string, ColumnWidthState>) => void;
  useShortNames: boolean;
  allowHorizontalOverflow: boolean;
  virtualization?: GridTableVirtualizationOptions;
  isKindColumnKey: (key: string) => boolean;
  getTextContent: (node: React.ReactNode) => string;
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
}

export function useGridTableColumnLayout<T>({
  columns,
  renderedColumns,
  tableRef,
  wrapperRef,
  tableData,
  initialColumnWidths,
  controlledColumnWidths,
  externalColumnWidths,
  enableColumnResizing,
  onColumnWidthsChange,
  useShortNames,
  allowHorizontalOverflow,
  virtualization,
  isKindColumnKey,
  getTextContent,
}: UseGridTableColumnLayoutOptions<T>): GridTableColumnLayout<T> {
  const [tableViewportWidth, setTableViewportWidth] = useState(0);
  const tableRefMutable = tableRef as RefObject<HTMLElement | null>;

  const { measureColumnWidth } = useGridTableColumnMeasurer<T>({
    tableRef: tableRefMutable,
    tableData,
    parseWidthInputToNumber,
    defaultColumnWidth: DEFAULT_COLUMN_WIDTH,
    isKindColumnKey,
    getTextContent,
    normalizeKindClass,
    getColumnMinWidth,
    getColumnMaxWidth,
  });

  const {
    columnWidths,
    setColumnWidths,
    manuallyResizedColumnsRef,
    reconcileWidthsToContainer,
    updateNaturalWidth,
    isInitialized: columnWidthsInitialized,
    markColumnsDirty,
    markAllAutoColumnsDirty,
    handleManualResizeEvent,
  } = useGridTableColumnWidths<T>({
    columns,
    renderedColumns,
    tableRef: tableRefMutable,
    tableData,
    initialColumnWidths,
    controlledColumnWidths,
    externalColumnWidths,
    enableColumnResizing,
    onColumnWidthsChange,
    useShortNames,
    measureColumnWidth,
    allowHorizontalOverflow,
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
    void allowHorizontalOverflow;
    markAllAutoColumnsDirty();
  }, [markAllAutoColumnsDirty, columnVirtualizationConfig.enabled, allowHorizontalOverflow]);

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

  useGridTableAutoGrow({
    tableRef,
    tableDataLength: tableData.length,
    renderedColumns,
    isKindColumnKey,
    externalColumnWidths,
    measureColumnWidth,
    setColumnWidths,
    reconcileWidthsToContainer: (base, width) => reconcileWidthsToContainer(base, width),
    updateNaturalWidth,
  });

  const recalculateForContainerWidth = useCallback(
    (incomingWidth: number) => {
      if (!incomingWidth || incomingWidth <= 0) {
        return;
      }
      setTableViewportWidth((prev) =>
        Math.abs(prev - incomingWidth) < 0.5 ? prev : incomingWidth
      );
      setColumnWidths((prev) => {
        if (allowHorizontalOverflow && !columnWidthsInitialized) {
          return prev;
        }
        const next = reconcileWidthsToContainer(prev, incomingWidth);
        return areWidthMapsEqual(prev, next) ? prev : next;
      });
    },
    [allowHorizontalOverflow, columnWidthsInitialized, reconcileWidthsToContainer, setColumnWidths]
  );

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
      getColumnMinWidth,
      getColumnMaxWidth,
      measureColumnWidth,
      enableColumnResizing,
      isFixedColumnKey,
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
  };
}
