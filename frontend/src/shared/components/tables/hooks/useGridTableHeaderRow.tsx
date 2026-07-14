/**
 * frontend/src/shared/components/tables/hooks/useGridTableHeaderRow.tsx
 *
 * React hook for useGridTableHeaderRow.
 * Encapsulates state and side effects for the shared components.
 */

import { AriaGridColumnHeader, AriaGridRow } from '@shared/components/tables/AriaGridPrimitives';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { isSortableColumn } from '@shared/components/tables/GridTable.utils';
import type React from 'react';

export interface UseGridTableHeaderRowParams<T> {
  renderedColumns: GridColumnDefinition<T>[];
  enableColumnResizing: boolean;
  isFixedColumnKey: (key: string) => boolean;
  handleHeaderContextMenu?: (event: React.MouseEvent, columnKey: string) => void;
  columnWidths: Record<string, number>;
  handleHeaderClick: (column: GridColumnDefinition<T>) => void;
  renderSortIndicator: (columnKey: string) => React.ReactNode;
  handleResizeStart: (event: React.MouseEvent, leftKey: string, rightKey: string) => void;
  handleResizeKeyDown: (event: React.KeyboardEvent, columnKey: string) => void;
  getColumnMinWidth: (column: GridColumnDefinition<T>) => number;
  getColumnMaxWidth: (column: GridColumnDefinition<T>) => number;
  autoSizeColumn: (columnKey: string) => void;
  sortConfig?: { key: string; direction: 'asc' | 'desc' | null } | null;
}

export function useGridTableHeaderRow<T>({
  renderedColumns,
  enableColumnResizing,
  isFixedColumnKey,
  handleHeaderContextMenu,
  columnWidths,
  handleHeaderClick,
  renderSortIndicator,
  handleResizeStart,
  handleResizeKeyDown,
  getColumnMinWidth,
  getColumnMaxWidth,
  autoSizeColumn,
  sortConfig,
}: UseGridTableHeaderRowParams<T>): React.ReactNode {
  return (
    <AriaGridRow className="gridtable-header">
      {renderedColumns.map((column, index) => {
        const isSortable = isSortableColumn(column);
        const nextColumn = renderedColumns[index + 1];
        const showResizeHandle =
          enableColumnResizing &&
          !!nextColumn &&
          !isFixedColumnKey(column.key) &&
          !isFixedColumnKey(nextColumn.key);
        const showKindSeparator = column.key === 'kind' && !!nextColumn && !showResizeHandle;

        // Compute aria-sort for this header cell.
        const ariaSortValue = (() => {
          if (!isSortable) {
            return undefined;
          }
          if (!sortConfig || sortConfig.key !== column.key || !sortConfig.direction) {
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
            style={{
              width: `${columnWidths[column.key]}px`,
              minWidth: `${columnWidths[column.key]}px`,
              maxWidth: `${columnWidths[column.key]}px`,
              flexShrink: 0,
            }}
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
                aria-valuenow={columnWidths[column.key]}
                tabIndex={0}
              />
            )}
            {!!showKindSeparator && <div className="column-separator" aria-hidden="true" />}
          </AriaGridColumnHeader>
        );
      })}
    </AriaGridRow>
  );
}
