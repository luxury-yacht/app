/**
 * frontend/src/shared/components/tables/gridTableCsv.ts
 *
 * Shared CSV builder for GridTable. Both the "copy visible rows" action and the
 * "export all matching rows" action produce their CSV here, so the exported file
 * matches the on-screen table (same columns, same rendered cell text) regardless of
 * which action the user picks.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { normalizeTableNoValueText } from '@shared/components/tables/tableNoValue';
import dayjs from 'dayjs';
import type { ReactNode } from 'react';

/** Quote a CSV cell (and double inner quotes) when it contains a comma, quote, or newline. */
const escapeCsvCell = (value: string): string => {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
};

/**
 * Build a CSV string from grid rows using the table's displayed columns. The header
 * is each column's rendered header text (falling back to its key); each cell is the
 * column's rendered content as plain text.
 */
export function buildGridTableCsv<T>(
  rows: T[],
  columns: GridColumnDefinition<T>[],
  getTextContent: (node: ReactNode) => string
): string {
  if (!columns.length) {
    return '';
  }
  const headerRow = columns.map((column) =>
    escapeCsvCell(getTextContent(column.header).trim() || column.key)
  );
  const dataRows = rows.map((item) =>
    columns.map((column) =>
      escapeCsvCell(normalizeTableNoValueText(getTextContent(column.render(item)).trim()))
    )
  );
  return [headerRow, ...dataRows].map((row) => row.join(',')).join('\n');
}

/**
 * Build the file name offered in the export save dialog:
 * `luxury-yacht-<base>-<YYYYMMDDHHmmss>.csv`, where `base` is the view's
 * export name (e.g. its view id) and the timestamp is the local export time.
 */
export function buildCsvExportFilename(base: string, exportedAt: Date): string {
  return `luxury-yacht-${base}-${dayjs(exportedAt).format('YYYYMMDDHHmmss')}.csv`;
}
