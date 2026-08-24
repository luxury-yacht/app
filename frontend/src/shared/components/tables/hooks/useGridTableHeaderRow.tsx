/**
 * frontend/src/shared/components/tables/hooks/useGridTableHeaderRow.tsx
 *
 * React hook for useGridTableHeaderRow.
 * Encapsulates state and side effects for the shared components.
 */

import { AriaGridColumnHeader, AriaGridRow } from '@shared/components/tables/AriaGridPrimitives';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { isSortableColumn } from '@shared/components/tables/GridTable.utils';
import {
  getColumnMaxWidth,
  getColumnMinWidth,
} from '@shared/components/tables/hooks/gridTableColumnWidthMath';
import type { ColumnRenderModel } from '@shared/components/tables/hooks/useGridTableColumnVirtualization';
import type React from 'react';

export interface UseGridTableHeaderRowParams<T> {
  columnRenderModels: Array<ColumnRenderModel<T>>;
  enableColumnResizing: boolean;
  handleHeaderContextMenu?: (event: React.MouseEvent, columnKey: string) => void;
  handleHeaderClick: (column: GridColumnDefinition<T>) => void;
  renderSortIndicator: (columnKey: string) => React.ReactNode;
  handleResizeStart: (event: React.MouseEvent, leftKey: string, rightKey: string) => void;
  handleResizeKeyDown: (event: React.KeyboardEvent, columnKey: string) => void;
  autoSizeColumn: (columnKey: string) => void;
  sortConfig?: { key: string; direction: 'asc' | 'desc' | null } | null;
}

export function useGridTableHeaderRow<T>({
  columnRenderModels,
  enableColumnResizing,
  handleHeaderContextMenu,
  handleHeaderClick,
  renderSortIndicator,
  handleResizeStart,
  handleResizeKeyDown,
  autoSizeColumn,
  sortConfig,
}: UseGridTableHeaderRowParams<T>): React.ReactNode {
  return (
    <AriaGridRow className="gridtable-header">
      {columnRenderModels.map((model, index) => {
        const { column } = model;
        const isSortable = isSortableColumn(column);
        const nextColumn = columnRenderModels[index + 1]?.column;
        const showResizeHandle =
          enableColumnResizing &&
          !!nextColumn &&
          column.resizable !== false &&
          nextColumn.resizable !== false;

        // Compute aria-sort for this header cell.
        const ariaSortValue = (() => {
          if (!isSortable) {
            return undefined;
          }
          if (sortConfig?.key !== column.key || !sortConfig.direction) {
            return 'none';
          }
          return sortConfig.direction === 'asc' ? 'ascending' : 'descending';
        })();

        return (
          <AriaGridColumnHeader
            key={column.key}
            className={`grid-cell grid-cell-header ${column.className || ''}`}
            aria-sort={ariaSortValue}
            data-column={column.key}
            data-align={column.alignHeader ?? 'left'}
            data-sortable={isSortable}
            onContextMenu={
              handleHeaderContextMenu ? (e) => handleHeaderContextMenu(e, column.key) : undefined
            }
            style={model.cellStyle}
          >
            <span className="header-content">
              {isSortable ? (
                <button
                  type="button"
                  className="gridtable-sort-button"
                  onClick={() => handleHeaderClick(column)}
                  aria-label={`Sort by ${typeof column.header === 'string' ? column.header : column.key}`}
                >
                  {column.header}
                  {renderSortIndicator(column.key)}
                </button>
              ) : (
                <span>{column.header}</span>
              )}
            </span>
            {!!showResizeHandle && (
              <hr
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, column.key, nextColumn.key)}
                onKeyDown={(event) => handleResizeKeyDown(event, column.key)}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  autoSizeColumn(column.key);
                }}
                aria-label={`Resize ${typeof column.header === 'string' ? column.header : column.key} column`}
                aria-orientation="vertical"
                aria-valuemin={getColumnMinWidth(column)}
                aria-valuemax={getColumnMaxWidth(column)}
                aria-valuenow={model.width}
                tabIndex={0}
              />
            )}
          </AriaGridColumnHeader>
        );
      })}
    </AriaGridRow>
  );
}
