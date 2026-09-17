/**
 * frontend/src/shared/components/tables/hooks/useGridTableRowRenderer.tsx
 *
 * React hook for useGridTableRowRenderer.
 * Encapsulates state and side effects for the shared components.
 */

import { AriaGridCell, AriaGridRow } from '@shared/components/tables/AriaGridPrimitives';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { getStableRowId } from '@shared/components/tables/GridTable.utils';
import type { ColumnRenderModel } from '@shared/components/tables/hooks/useGridTableColumnVirtualization';
import type { MeasureRowRefFn } from '@shared/components/tables/hooks/useGridTableVirtualization';
import type React from 'react';
import { useCallback, useMemo } from 'react';

// Returns row/cell render callbacks for GridTable, wiring hover handlers,
// context menus, and slotting for virtualization measurements.

export type RenderRowContentFn<T> = (
  item: T,
  absoluteIndex: number,
  shouldMeasure: boolean,
  elementKey: string,
  slotId?: string,
  virtualTop?: number
) => React.ReactNode;

export interface UseGridTableRowRendererParams<T> {
  keyExtractor: (item: T, index: number) => string;
  getRowClassName?: (item: T, index: number) => string | undefined | null;
  isRowSelected?: (item: T, index: number) => boolean;
  getRowStyle?: (item: T, index: number) => React.CSSProperties | undefined;
  handleRowClick: (item: T, index: number, event: React.MouseEvent) => void;
  handleRowMouseEnter: (element: HTMLDivElement) => void;
  handleRowMouseLeave: (element?: HTMLDivElement | null) => void;
  columnRenderModels: Array<ColumnRenderModel<T>>;
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
  measureRowRef: MeasureRowRefFn;
}

function rowPresentation<T>(
  item: T,
  index: number,
  virtualTop: number | undefined,
  options: Pick<
    UseGridTableRowRendererParams<T>,
    'getRowClassName' | 'isRowSelected' | 'getRowStyle'
  >
) {
  const { getRowClassName, isRowSelected, getRowStyle } = options;
  const rowExtraClass = getRowClassName?.(item, index);
  const selected = isRowSelected?.(item, index) ?? false;
  const rowClassName = [
    'gridtable-row',
    selected ? 'gridtable-row--selected' : '',
    rowExtraClass || '',
  ]
    .filter(Boolean)
    .join(' ');
  const configuredRowStyle = getRowStyle ? getRowStyle(item, index) : undefined;
  const rowInlineStyle =
    virtualTop === undefined
      ? configuredRowStyle
      : {
          ...configuredRowStyle,
          position: 'absolute' as const,
          transform: `translateY(${virtualTop}px)`,
        };
  const isSelected = selected;
  const isFocused = rowClassName.includes('gridtable-row--focused');

  return { rowClassName, rowInlineStyle, isSelected, isFocused };
}

export function useGridTableRowRenderer<T>({
  keyExtractor,
  getRowClassName,
  isRowSelected,
  getRowStyle,
  handleRowClick,
  handleRowMouseEnter,
  handleRowMouseLeave,
  columnRenderModels,
  columnVirtualizationConfig,
  columnWindowRange,
  handleContextMenu,
  getCachedCellContent,
  measureRowRef,
}: UseGridTableRowRendererParams<T>): RenderRowContentFn<T> {
  // Every row renders the same column window. Resolve it once, retaining both sticky edges.
  const visibleColumnModels = useMemo(() => {
    if (!columnVirtualizationConfig.enabled) {
      return columnRenderModels;
    }
    const total = columnRenderModels.length;
    const stickyStart = Math.min(columnVirtualizationConfig.stickyStart, total);
    const stickyEnd = Math.min(columnVirtualizationConfig.stickyEnd, total - stickyStart);
    return columnRenderModels.filter(
      (_model, index) =>
        index < stickyStart ||
        index >= total - stickyEnd ||
        !(index < columnWindowRange.startIndex || index > columnWindowRange.endIndex)
    );
  }, [columnRenderModels, columnVirtualizationConfig, columnWindowRange]);

  const renderCell = useCallback(
    (model: ColumnRenderModel<T>, item: T, absoluteIndex: number) => {
      const cell = getCachedCellContent(model.column, item);
      const disableShortcuts =
        typeof model.column.disableShortcuts === 'function'
          ? model.column.disableShortcuts(item)
          : model.column.disableShortcuts === true;

      return (
        <AriaGridCell
          key={model.key}
          className={`grid-cell ${model.className}`}
          data-column={model.key}
          data-align={model.column.alignData ?? 'left'}
          data-has-context-menu="true"
          onContextMenu={(e) => handleContextMenu(e, model.key, item, absoluteIndex)}
          style={model.cellStyle}
          data-gridtable-shortcut-optout={disableShortcuts ? 'true' : undefined}
          data-gridtable-row-action={model.column.rowAction}
        >
          <span className="grid-cell-content">{cell.content}</span>
        </AriaGridCell>
      );
    },
    [getCachedCellContent, handleContextMenu]
  );

  return useCallback(
    (
      item: T,
      absoluteIndex: number,
      shouldMeasure: boolean,
      elementKey: string,
      slotId?: string,
      virtualTop?: number
    ): React.ReactNode => {
      const rowKey = keyExtractor(item, absoluteIndex);
      const { rowClassName, rowInlineStyle, isSelected, isFocused } = rowPresentation(
        item,
        absoluteIndex,
        virtualTop,
        { getRowClassName, isRowSelected, getRowStyle }
      );

      // When shouldMeasure is true (virtualized rows), attach a ref callback
      // that reports the row's height to the virtualizer for variable-height support.
      const setMeasurementRef = shouldMeasure
        ? (node: HTMLDivElement | null) => measureRowRef(rowKey, node)
        : undefined;

      // Build a DOM-safe id for aria-activedescendant references.
      const rowId = getStableRowId(rowKey);

      return (
        <AriaGridRow
          key={elementKey}
          id={rowId}
          className={rowClassName}
          style={rowInlineStyle}
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
          {visibleColumnModels.map((model) => renderCell(model, item, absoluteIndex))}
        </AriaGridRow>
      );
    },
    [
      keyExtractor,
      getRowClassName,
      isRowSelected,
      getRowStyle,
      handleRowClick,
      handleRowMouseEnter,
      handleRowMouseLeave,
      visibleColumnModels,
      renderCell,
      measureRowRef,
    ]
  );
}
