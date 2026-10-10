/**
 * frontend/src/shared/components/logs/LogTable.tsx
 *
 * Log lines in a GridTable: the container Logs tab's Table format and
 * Application Logs. Enter or a click on a row expands it to show every cell in
 * full; otherwise long values are cut to one line, like every table cell.
 */

import './LogTable.css';
import GridTable, {
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
  type GridColumnDefinition,
} from '@shared/components/tables/GridTable';
import { useCallback } from 'react';

interface LogTableProps<T> {
  rows: T[];
  columns: GridColumnDefinition<T>[];
  keyExtractor: (row: T) => string;
  expandedRows: ReadonlySet<string>;
  onToggleRow: (rowKey: string) => void;
  /** The view's own wrapper class, for its placement and any view-only paint. */
  className: string;
}

const LogTable = <T,>({
  rows,
  columns,
  keyExtractor,
  expandedRows,
  onToggleRow,
  className,
}: LogTableProps<T>) => {
  // GridTable also passes the row index; keys come from the row alone.
  const rowKey = useCallback((row: T) => keyExtractor(row), [keyExtractor]);

  const handleRowActivation = useCallback(
    (row: T) => {
      onToggleRow(keyExtractor(row));
    },
    [keyExtractor, onToggleRow]
  );

  const getRowClassName = useCallback(
    (row: T) => (expandedRows.has(keyExtractor(row)) ? 'parsed-row-expanded' : undefined),
    [expandedRows, keyExtractor]
  );

  return (
    <GridTable
      data={rows}
      columns={columns}
      keyExtractor={rowKey}
      onRowClick={handleRowActivation}
      onRowPointerClick={handleRowActivation}
      getRowClassName={getRowClassName}
      className={className}
      tableClassName="gridtable-parsed-logs"
      virtualization={GRIDTABLE_VIRTUALIZATION_DEFAULT}
    />
  );
};

export default LogTable;
