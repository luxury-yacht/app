/** Container-log metadata columns; transport and filter state stay in LogViewer. */
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import type React from 'react';
import type { ParsedLogEntry } from './logViewerReducer';
import {
  PARSED_TIMESTAMP_AUTOSIZE_MAX_WIDTH,
  PARSED_TIMESTAMP_MIN_WIDTH,
} from './parsedLogColumns';
import { formatParsedValue } from './parsedLogUtils';

const PARSED_POD_COLUMN_MIN_WIDTH = 80;
const PARSED_METADATA_AUTOSIZE_MAX_WIDTH = 320;

interface ContainerLogColumnOptions {
  isWorkload: boolean;
  showTimestamp: boolean;
  podColors: Record<string, string>;
  formatTimestamp: (timestamp: string) => string;
  getContainerLabel: (entry: ParsedLogEntry) => string;
  onSelectPod: (pod: string) => void;
  onSelectContainer: (entry: ParsedLogEntry) => void;
}

// Container CSV reserves these keys for API metadata even when its columns are hidden.
export function containerLogExportValue(
  entry: ParsedLogEntry,
  key: string,
  formatTimestamp: (timestamp: string) => string
): string {
  switch (key) {
    case '_timestamp':
      return entry.timestamp ? formatTimestamp(entry.timestamp) : '-';
    case '_pod':
      return entry.pod || '-';
    case '_container':
      return entry.container || '-';
    default:
      return formatParsedValue(entry.data[key]);
  }
}

export function buildContainerLogMetadataColumns({
  isWorkload,
  showTimestamp,
  podColors,
  formatTimestamp,
  getContainerLabel,
  onSelectPod,
  onSelectContainer,
}: ContainerLogColumnOptions): GridColumnDefinition<ParsedLogEntry>[] {
  const timestampValue = (item: ParsedLogEntry): string =>
    item.timestamp ? formatTimestamp(item.timestamp) : '-';
  const columns: GridColumnDefinition<ParsedLogEntry>[] = [];

  // Always show metadata columns when relevant — don't gate on first entry.
  // API Timestamp is metadata we add on the client (not part of the log
  // payload), so in workload mode we color it with the same pod color as
  // the Pod column — visually grouping the metadata fields for a single
  // pod together when multiple pods are interleaved.
  if (showTimestamp) {
    columns.push({
      key: '_timestamp',
      header: 'API Timestamp',
      sortable: false,
      minWidth: PARSED_TIMESTAMP_MIN_WIDTH,
      autoSizeMaxWidth: PARSED_TIMESTAMP_AUTOSIZE_MAX_WIDTH,
      render: (item: ParsedLogEntry) => {
        const formatted = timestampValue(item);
        if (!isWorkload) {
          return formatted;
        }
        return (
          <span
            className="pod-color-text"
            style={
              {
                '--pod-color': podColors[item.pod || ''] || podColors.__fallback__,
              } as React.CSSProperties
            }
          >
            {formatted}
          </span>
        );
      },
    });
  }

  if (isWorkload) {
    columns.push({
      key: '_pod',
      header: 'Pod',
      sortable: false,
      minWidth: PARSED_POD_COLUMN_MIN_WIDTH,
      autoSizeMaxWidth: PARSED_METADATA_AUTOSIZE_MAX_WIDTH,
      render: (item: ParsedLogEntry) => {
        const pod = item.pod;
        return pod ? (
          <button
            type="button"
            className="log-viewer-metadata-button pod-color-text"
            tabIndex={-1}
            data-focus-trap-ignore="true"
            style={
              {
                '--pod-color': podColors[pod] || podColors.__fallback__,
              } as React.CSSProperties
            }
            onClick={(event) => {
              event.stopPropagation();
              onSelectPod(pod);
            }}
            title={`Show only logs from pod ${pod}`}
            aria-label={`Show only logs from pod ${pod}`}
          >
            {pod}
          </button>
        ) : (
          '-'
        );
      },
    });
  }

  columns.push({
    key: '_container',
    header: 'Container',
    sortable: false,
    minWidth: PARSED_POD_COLUMN_MIN_WIDTH,
    autoSizeMaxWidth: PARSED_METADATA_AUTOSIZE_MAX_WIDTH,
    render: (item: ParsedLogEntry) => {
      const container = item.container;
      const containerLabel = container ? getContainerLabel(item) : '';
      return container ? (
        <button
          type="button"
          className="log-viewer-metadata-button pod-color-text"
          tabIndex={-1}
          data-focus-trap-ignore="true"
          style={
            {
              '--pod-color': podColors[item.pod || ''] || podColors.__fallback__,
            } as React.CSSProperties
          }
          onClick={(event) => {
            event.stopPropagation();
            onSelectContainer(item);
          }}
          title={`Show only logs from container ${containerLabel}`}
          aria-label={`Show only logs from container ${containerLabel}`}
        >
          {container}
        </button>
      ) : (
        '-'
      );
    },
  });

  return columns;
}
