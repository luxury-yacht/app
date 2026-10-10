/**
 * frontend/src/shared/components/tables/rowDetailToggle.tsx
 *
 * Turns a count column's cell into the control that opens and closes its row's
 * detail (GridTableProps.rowDetail), shown as "2/3 ›".
 */

import '@shared/components/tables/GridTableRowDetail.css';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { getGridTableRowDetailId } from '@shared/components/tables/GridTable.utils';

export interface RowDetailToggleOptions<T> {
  /** The row's keyExtractor key. */
  getRowKey: (item: T) => string;
  isOpen: (item: T) => boolean;
  onToggle: (item: T) => void;
  /** Accessible name; it replaces the visible count, so include it. */
  getLabel: (item: T, open: boolean) => string;
  /** The cell's visible text, so auto-width also leaves room for the chevron. */
  getText: (item: T) => string;
}

export function withRowDetailToggle<T>(
  column: GridColumnDefinition<T>,
  options: RowDetailToggleOptions<T>
): GridColumnDefinition<T> {
  return {
    ...column,
    measurementText: (item) => `${options.getText(item)} ›`,
    render: (item) => {
      const open = options.isOpen(item);
      return (
        <button
          type="button"
          className="gridtable-cell-button gridtable-link object-panel-link gridtable-row-detail-toggle"
          aria-expanded={open}
          aria-controls={open ? getGridTableRowDetailId(options.getRowKey(item)) : undefined}
          aria-label={options.getLabel(item, open)}
          data-gridtable-shortcut-optout="true"
          data-gridtable-rowclick="suppress"
          onClick={() => options.onToggle(item)}
        >
          {column.render(item)}
          <svg
            className="gridtable-row-detail-toggle__chevron"
            viewBox="0 0 8 8"
            width="8"
            height="8"
            aria-hidden="true"
          >
            <path d="M2 1 L6 4 L2 7 Z" fill="currentColor" />
          </svg>
        </button>
      );
    },
  };
}
