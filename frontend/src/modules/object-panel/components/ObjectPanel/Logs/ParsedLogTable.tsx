import GridTable, {
  GRIDTABLE_VIRTUALIZATION_DEFAULT,
  type GridColumnDefinition,
} from '@shared/components/tables/GridTable';
import { type MouseEvent, useCallback } from 'react';
import type { ParsedLogEntry } from './logViewerReducer';
import { getParsedLogRowKey } from './parsedLogUtils';

interface ParsedLogTableProps {
  rows: ParsedLogEntry[];
  columns: GridColumnDefinition<ParsedLogEntry>[];
  expandedRows: Set<string>;
  onToggleRow: (rowKey: string) => void;
}

const ParsedLogTable = ({ rows, columns, expandedRows, onToggleRow }: ParsedLogTableProps) => {
  const handleTableClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('.gridtable-row');
      const rowKey = row?.dataset.rowKey;
      if (rowKey) {
        onToggleRow(rowKey);
      }
    },
    [onToggleRow]
  );

  const handleRowKeyboard = useCallback(
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
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: click delegation preserves GridTable row behavior and GridTable owns keyboard activation.
    <div onClick={handleTableClick} style={{ height: '100%' }}>
      <GridTable
        data={rows}
        columns={columns}
        keyExtractor={(item: ParsedLogEntry) => getParsedLogRowKey(item)}
        onRowClick={handleRowKeyboard}
        getRowClassName={getRowClassName}
        className="parsed-logs-table"
        tableClassName="gridtable-parsed-logs"
        virtualization={GRIDTABLE_VIRTUALIZATION_DEFAULT}
        isKindColumnKey={() => false}
      />
    </div>
  );
};

export default ParsedLogTable;
