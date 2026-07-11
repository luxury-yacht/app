import GridTable, {
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
  type GridColumnDefinition,
} from '@shared/components/tables/GridTable';
import { useCallback } from 'react';
import type { ParsedLogEntry } from './logViewerReducer';
import { getParsedLogRowKey } from './parsedLogUtils';

interface ParsedLogTableProps {
  rows: ParsedLogEntry[];
  columns: GridColumnDefinition<ParsedLogEntry>[];
  expandedRows: Set<string>;
  onToggleRow: (rowKey: string) => void;
}

const ParsedLogTable = ({ rows, columns, expandedRows, onToggleRow }: ParsedLogTableProps) => {
  const handleRowActivation = useCallback(
    (item: ParsedLogEntry) => {
      onToggleRow(getParsedLogRowKey(item));
    },
    [onToggleRow]
  );

  const getRowClassName = useCallback(
    (item: ParsedLogEntry, index: number) =>
      expandedRows.has(getParsedLogRowKey(item, index)) ? 'parsed-row-expanded' : undefined,
    [expandedRows]
  );

  return (
    <GridTable
      data={rows}
      columns={columns}
      keyExtractor={(item: ParsedLogEntry) => getParsedLogRowKey(item)}
      onRowClick={handleRowActivation}
      onRowPointerClick={handleRowActivation}
      getRowClassName={getRowClassName}
      className="parsed-logs-table"
      tableClassName="gridtable-parsed-logs"
      virtualization={GRIDTABLE_VIRTUALIZATION_DEFAULT}
      isKindColumnKey={() => false}
    />
  );
};

export default ParsedLogTable;
