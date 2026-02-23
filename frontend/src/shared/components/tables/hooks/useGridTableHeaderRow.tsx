/**
 * frontend/src/shared/components/tables/hooks/useGridTableHeaderRow.tsx
 *
 * React hook for useGridTableHeaderRow.
 * Encapsulates state and side effects for the shared components.
 */

import type React from 'react';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

export interface UseGridTableHeaderRowParams<T> {
  renderedColumns: GridColumnDefinition<T>[];
  enableColumnResizing: boolean;
  isFixedColumnKey: (key: string) => boolean;
  handleHeaderContextMenu?: (event: React.MouseEvent, columnKey: string) => void;
  columnWidths: Record<string, number>;
  handleHeaderClick: (column: GridColumnDefinition<T>) => void;
  renderSortIndicator: (columnKey: string) => React.ReactNode;
  handleResizeStart: (event: React.MouseEvent, leftKey: string, rightKey: string) => void;
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
  autoSizeColumn,
  sortConfig,
}: UseGridTableHeaderRowParams<T>): React.ReactNode {
  return (
    <div className="gridtable-header" role="row">
      {renderedColumns.map((column, index) => {
        const nextColumn = renderedColumns[index + 1];
        const showResizeHandle =
          enableColumnResizing &&
          !!nextColumn &&
          !isFixedColumnKey(column.key) &&
          !isFixedColumnKey(nextColumn.key);

        // Compute aria-sort for this header cell.
        const ariaSortValue = (() => {
          if (!column.sortable) return undefined;
          if (!sortConfig || sortConfig.key !== column.key || !sortConfig.direction) return 'none';
          return sortConfig.direction === 'asc' ? 'ascending' : 'descending';
        })();

        return (
          <div
            key={column.key}
            className={`grid-cell grid-cell-header ${column.className || ''}`}
            role="columnheader"
            aria-sort={ariaSortValue}
            data-column={column.key}
            data-sortable={column.sortable || false}
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
              <span
                onClick={() => column.sortable && handleHeaderClick(column)}
                {...(column.sortable
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': `Sort by ${typeof column.header === 'string' ? column.header : column.key}`,
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleHeaderClick(column);
                        }
                      },
                    }
                  : undefined)}
              >
                {column.header}
                {column.sortable && renderSortIndicator(column.key)}
              </span>
            </span>
            {showResizeHandle && (
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, column.key, nextColumn.key)}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  autoSizeColumn(column.key);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
