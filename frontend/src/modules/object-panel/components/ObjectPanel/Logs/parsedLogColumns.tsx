/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/parsedLogColumns.tsx
 *
 * Shared parsed-log data columns for the container-logs and node-logs tabs:
 * promote well-known timestamp and level fields to appear first, then add the
 * remaining user-data columns. Transport-specific metadata columns (API
 * timestamp, pod, container) stay in LogViewer and precede these.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import type { ParsedLogEntry } from './logViewerReducer';
import { formatParsedValue } from './parsedLogUtils';

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
