/**
 * frontend/src/shared/components/tables/hooks/useGridTableRowRenderer.tsx
 *
 * React hook for useGridTableRowRenderer.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback } from 'react';
import type React from 'react';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { getStableRowId } from '@shared/components/tables/GridTable.utils';

// Returns row/cell render callbacks for GridTable, wiring hover handlers,
// context menus, and slotting for virtualization measurements.

export type RenderRowContentFn<T> = (
  item: T,
  absoluteIndex: number,
  attachMeasurementRef: boolean,
  elementKey: string,
  slotId?: string
) => React.ReactNode;

export interface UseGridTableRowRendererParams<T> {
  keyExtractor: (item: T, index: number) => string;
  getRowClassName?: (item: T, index: number) => string | undefined | null;
  getRowStyle?: (item: T, index: number) => React.CSSProperties | undefined;
  handleRowClick: (item: T, index: number, event: React.MouseEvent) => void;
  handleRowMouseEnter: (element: HTMLDivElement) => void;
  handleRowMouseLeave: (element?: HTMLDivElement | null) => void;
  columnRenderModelsWithOffsets: Array<{
    column: GridColumnDefinition<T>;
    key: string;
    className: string;
    cellStyle: React.CSSProperties;
    start: number;
    end: number;
    width: number;
  }>;
  columnVirtualizationConfig: {
    enabled: boolean;
    overscanColumns: number;
    stickyStart: number;
    stickyEnd: number;
  };
  columnWindowRange: { startIndex: number; endIndex: number };
  handleContextMenu: (
    event: React.MouseEvent,
    columnKey: string,
    item: T | null,
    rowIndex: number
  ) => void;
  getCachedCellContent: (
    column: GridColumnDefinition<T>,
    item: T
  ) => {
    content: React.ReactNode;
    text: string;
  };
  firstVirtualRowRef: React.RefObject<HTMLDivElement | null>;
}

export function useGridTableRowRenderer<T>({
  keyExtractor,
  getRowClassName,
  getRowStyle,
  handleRowClick,
  handleRowMouseEnter,
  handleRowMouseLeave,
  columnRenderModelsWithOffsets,
  columnVirtualizationConfig,
  columnWindowRange,
  handleContextMenu,
  getCachedCellContent,
  firstVirtualRowRef,
}: UseGridTableRowRendererParams<T>): RenderRowContentFn<T> {
  return useCallback(
    (
      item: T,
      absoluteIndex: number,
      attachMeasurementRef: boolean,
      elementKey: string,
      slotId?: string
    ): React.ReactNode => {
      const rowKey = keyExtractor(item, absoluteIndex);
      const rowExtraClass = getRowClassName?.(item, absoluteIndex);
      const rowClassName = ['gridtable-row', rowExtraClass || ''].filter(Boolean).join(' ');
      const rowInlineStyle = getRowStyle ? getRowStyle(item, absoluteIndex) : undefined;
      const isSelected = rowClassName.includes('gridtable-row--selected');
      const isFocused = rowClassName.includes('gridtable-row--focused');

      const setMeasurementRef = attachMeasurementRef
        ? (node: HTMLDivElement | null) => {
            if (node) {
              firstVirtualRowRef.current = node;
            }
          }
        : undefined;

      // Build a DOM-safe id for aria-activedescendant references.
      const rowId = getStableRowId(rowKey);

      return (
        <div
          key={elementKey}
          id={rowId}
          className={rowClassName}
          style={rowInlineStyle}
          role="row"
          aria-selected={isFocused || isSelected || undefined}
          data-row-key={rowKey}
          data-grid-slot={slotId}
          onClick={(e) => handleRowClick(item, absoluteIndex, e)}
          ref={setMeasurementRef}
          onMouseEnter={(e) => handleRowMouseEnter(e.currentTarget)}
          onMouseLeave={(e) => handleRowMouseLeave(e.currentTarget)}
          data-row-selected={isSelected ? 'true' : undefined}
          data-row-focused={isFocused ? 'true' : undefined}
        >
          {columnRenderModelsWithOffsets.map((model, columnIndex) => {
            if (columnVirtualizationConfig.enabled) {
              const total = columnRenderModelsWithOffsets.length;
              const stickyStart = Math.min(columnVirtualizationConfig.stickyStart, total);
              const stickyEnd = Math.min(columnVirtualizationConfig.stickyEnd, total - stickyStart);
              const isSticky = columnIndex < stickyStart || columnIndex >= total - stickyEnd;
              if (!isSticky) {
                if (
                  columnIndex < columnWindowRange.startIndex ||
                  columnIndex > columnWindowRange.endIndex
                ) {
                  return null;
                }
              }
            }
            const cell = getCachedCellContent(model.column, item);
            const disableShortcuts =
              typeof model.column.disableShortcuts === 'function'
                ? model.column.disableShortcuts(item)
                : model.column.disableShortcuts === true;

            return (
              <div
                key={model.key}
                className={`grid-cell ${model.className}`}
                role="gridcell"
                data-column={model.key}
                data-has-context-menu="true"
                onContextMenu={(e) => handleContextMenu(e, model.key, item, absoluteIndex)}
                style={model.cellStyle}
                title={cell.text}
                data-gridtable-shortcut-optout={disableShortcuts ? 'true' : undefined}
              >
                <span className="grid-cell-content">{cell.content}</span>
              </div>
            );
          })}
        </div>
      );
    },
    [
      keyExtractor,
      getRowClassName,
      getRowStyle,
      handleRowClick,
      handleRowMouseEnter,
      handleRowMouseLeave,
      columnRenderModelsWithOffsets,
      columnVirtualizationConfig,
      columnWindowRange,
      handleContextMenu,
      getCachedCellContent,
      firstVirtualRowRef,
    ]
  );
}
