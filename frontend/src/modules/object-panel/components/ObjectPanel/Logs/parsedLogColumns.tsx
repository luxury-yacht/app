/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/parsedLogColumns.tsx
 *
 * Shared parsed-log data columns for the container-logs and node-logs tabs:
 * promote well-known timestamp and level fields to appear first, then add the
 * remaining user-data columns. Container metadata columns (API timestamp, pod,
 * container) are built by containerLogColumns and precede these.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { buildCsv } from './logExport';
import type { ParsedLogEntry } from './logViewerReducer';
import { formatParsedValue } from './parsedLogUtils';

// Each log source supplies its value policy; visible column order and CSV escaping are shared.
export function buildParsedLogCsv(
  entries: ParsedLogEntry[],
  columns: GridColumnDefinition<ParsedLogEntry>[],
  getValue: (entry: ParsedLogEntry, key: string) => string
): string {
  if (entries.length === 0 || columns.length === 0) {
    return '';
  }
  const headers = columns.map((column) =>
    typeof column.header === 'string' ? column.header : column.key
  );
  const rows = entries.map((entry) => columns.map((column) => getValue(entry, column.key)));
  return buildCsv([headers, ...rows]);
}

const PARSED_COLUMN_MIN_WIDTH = 50;
export const PARSED_TIMESTAMP_MIN_WIDTH = 80;
const PARSED_COLUMN_AUTOSIZE_MAX_WIDTH = 520;
export const PARSED_TIMESTAMP_AUTOSIZE_MAX_WIDTH = 280;

export function buildParsedLogDataColumns(
  derivedFieldKeys: string[],
  existingKeys: ReadonlySet<string> = new Set<string>()
): GridColumnDefinition<ParsedLogEntry>[] {
  const columns: GridColumnDefinition<ParsedLogEntry>[] = [];

  const timestampCandidates = ['timestamp', 'time', 'ts'];
  const jsonTimestampKey = derivedFieldKeys.find((key) => timestampCandidates.includes(key));
  if (jsonTimestampKey) {
    columns.push({
      key: jsonTimestampKey,
      header: jsonTimestampKey,
      sortable: false,
      minWidth: PARSED_TIMESTAMP_MIN_WIDTH,
      autoSizeMaxWidth: PARSED_TIMESTAMP_AUTOSIZE_MAX_WIDTH,
      render: (item: ParsedLogEntry) => formatParsedValue(item.data[jsonTimestampKey]),
    });
  }

  const levelCandidates = ['level', 'severity', 'log_level'];
  const jsonLevelKey = derivedFieldKeys.find((key) => levelCandidates.includes(key));
  if (jsonLevelKey) {
    columns.push({
      key: jsonLevelKey,
      header: jsonLevelKey,
      sortable: false,
      minWidth: PARSED_COLUMN_MIN_WIDTH,
      autoSizeMaxWidth: PARSED_COLUMN_AUTOSIZE_MAX_WIDTH,
      render: (item: ParsedLogEntry) => formatParsedValue(item.data[jsonLevelKey]),
    });
  }

  const addedKeys = new Set([...existingKeys, ...columns.map((column) => column.key)]);
  derivedFieldKeys.forEach((key) => {
    if (addedKeys.has(key)) {
      return;
    }
    columns.push({
      key,
      header: key,
      sortable: false,
      minWidth: PARSED_COLUMN_MIN_WIDTH,
      autoSizeMaxWidth: PARSED_COLUMN_AUTOSIZE_MAX_WIDTH,
      render: (item: ParsedLogEntry) => (
        <div className="parsed-log-cell">{formatParsedValue(item.data[key])}</div>
      ),
    });
  });

  return columns;
}
