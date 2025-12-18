import { useMemo } from 'react';
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
}: UseGridTableHeaderRowParams<T>): React.ReactNode {
  return useMemo(
    () => (
      <div className="gridtable-header">
        {renderedColumns.map((column, index) => {
          const nextColumn = renderedColumns[index + 1];
          const showResizeHandle =
            enableColumnResizing &&
            !!nextColumn &&
            !isFixedColumnKey(column.key) &&
            !isFixedColumnKey(nextColumn.key);

          return (
            <div
              key={column.key}
              className={`grid-cell grid-cell-header ${column.className || ''}`}
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
                  style={{ cursor: column.sortable ? 'pointer' : 'default' }}
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
    ),
    [
      renderedColumns,
      enableColumnResizing,
      isFixedColumnKey,
      handleHeaderContextMenu,
      columnWidths,
      handleHeaderClick,
      renderSortIndicator,
      handleResizeStart,
      autoSizeColumn,
    ]
  );
}
