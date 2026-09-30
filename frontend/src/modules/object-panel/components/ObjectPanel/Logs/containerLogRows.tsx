/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/containerLogRows.tsx
 *
 * Container Logs raw-view rows, built from the entries: each entry's first row
 * carries its timestamp, pod and container, and the copy text reads the same.
 */

import type React from 'react';
import { useMemo, useRef } from 'react';
import type { ContainerLogsEntry } from '@/core/refresh/types';
import type { LogDisplayMode, LogTimestampMode } from '../types';
import {
  formatContainerLabel,
  type LogContainerKind,
  logContainerKind,
} from './containerLogFilters';
import { formatTimestampForMode } from './containerLogTimestamps';
import { LogMetadataButton } from './LogMetadataButton';
import { formatRawOrPrettyJsonLine } from './parsedLogUtils';
import type { RenderedLogRow } from './RawLogViewer';

const EMPTY_CONTAINER_LOG_PLACEHOLDER = '[container emitted an empty log]';

export const shouldDisplayPodContainerMetadata = (
  selectedContainerFilterCount: number,
  singlePodSelectableContainerCount: number
): boolean =>
  selectedContainerFilterCount !== 1 &&
  !(selectedContainerFilterCount === 0 && singlePodSelectableContainerCount === 1);

export type ContainerLogFormatOptions = {
  displayMode: LogDisplayMode;
  showAnsiColors: boolean;
  timestampMode: LogTimestampMode;
  apiTimestampFormat: string;
  apiTimestampUseLocalTimeZone: boolean;
  isWorkload: boolean;
  showContainerMetadata: boolean;
};

/** Where a line came from; workload views also name the pod. */
type ContainerLogSource = { pod: string | null; container: string; kind: LogContainerKind };

type ContainerLogRowMetadata = { timestamp: string; source: ContainerLogSource | null };

/**
 * A raw-view row. An entry's first row carries the entry's metadata; the
 * continuation rows of a pretty-printed JSON line carry none.
 */
export interface ContainerLogRow extends RenderedLogRow {
  metadata?: ContainerLogRowMetadata;
}

type ContainerLogDisplay = {
  rows: ContainerLogRow[];
  /** The shown lines as the copy action writes them, built when asked for. */
  copyText: () => string;
};

type EntryDisplay = { rows: ContainerLogRow[]; copyLine: string };

type JsonOf = (entry: ContainerLogsEntry) => Record<string, unknown> | null;

const containerLogRowMetadata = (
  entry: ContainerLogsEntry,
  options: ContainerLogFormatOptions
): ContainerLogRowMetadata => ({
  timestamp: formatTimestampForMode(
    entry.timestamp ?? '',
    options.timestampMode,
    options.apiTimestampFormat,
    options.apiTimestampUseLocalTimeZone
  ),
  source:
    options.isWorkload || options.showContainerMetadata
      ? {
          pod: options.isWorkload ? entry.pod : null,
          container: entry.container,
          kind: logContainerKind(entry),
        }
      : null,
});

const isJsonView = (displayMode: LogDisplayMode) =>
  displayMode === 'pretty' || displayMode === 'structured';

const containerLogMessage = (
  entry: ContainerLogsEntry,
  options: ContainerLogFormatOptions,
  jsonOf: JsonOf
): string => {
  const content = formatRawOrPrettyJsonLine(
    entry.line,
    options.displayMode,
    options.showAnsiColors,
    isJsonView(options.displayMode) ? jsonOf(entry) : null
  );
  return content.trim().length > 0 ? content : EMPTY_CONTAINER_LOG_PLACEHOLDER;
};

const formatContainerLogSource = (source: ContainerLogSource): string => {
  const label = formatContainerLabel(source.container, source.kind);
  return source.pod === null ? label : `${source.pod}/${label}`;
};

// The copied line reads like the row: `[timestamp] [pod/container] message`.
const formatContainerLogCopyLine = (
  { timestamp, source }: ContainerLogRowMetadata,
  message: string
): string =>
  [
    timestamp ? `[${timestamp}]` : '',
    source ? `[${formatContainerLogSource(source)}]` : '',
    message,
  ]
    .filter(Boolean)
    .join(' ');

const buildEntryDisplay = (
  entry: ContainerLogsEntry,
  entryKey: string | number,
  options: ContainerLogFormatOptions,
  jsonOf: JsonOf
): EntryDisplay => {
  const metadata = containerLogRowMetadata(entry, options);
  const message = containerLogMessage(entry, options, jsonOf);
  const rows = message.split('\n').map((segment, segmentIndex) => ({
    key: `${entryKey}:${segmentIndex}`,
    line: segment,
    metadata: segmentIndex === 0 ? metadata : undefined,
  }));
  return { rows, copyLine: formatContainerLogCopyLine(metadata, message) };
};

const NO_ROWS: ContainerLogRow[] = [];

/**
 * The raw view's rows and copy text. Each entry is formatted once for the
 * current options, so a stream batch formats only its new entries; the copy
 * text is joined only when copying. `options` must keep its identity until an
 * option changes. The table view shows no rows.
 */
export function useContainerLogDisplay({
  entries,
  emptyStateMessage,
  jsonOf,
  options,
}: {
  entries: ContainerLogsEntry[];
  emptyStateMessage: string;
  jsonOf: JsonOf;
  options: ContainerLogFormatOptions;
}): ContainerLogDisplay {
  const cache = useRef<{
    options: ContainerLogFormatOptions | null;
    byEntry: WeakMap<ContainerLogsEntry, EntryDisplay>;
  }>({
    options: null,
    byEntry: new WeakMap(),
  });
  // Row keys outlive option changes; an entry without a sequence gets an id.
  const ids = useRef({ byEntry: new WeakMap<ContainerLogsEntry, string>(), next: 0 });
  return useMemo(() => {
    if (options.displayMode === 'parsed') {
      return { rows: NO_ROWS, copyText: () => '' };
    }
    if (entries.length === 0) {
      // The empty-state message shows as the log's only line.
      return {
        rows: emptyStateMessage ? [{ key: 'empty', line: emptyStateMessage }] : NO_ROWS,
        copyText: () => emptyStateMessage,
      };
    }
    if (cache.current.options !== options) {
      cache.current = { options, byEntry: new WeakMap() };
    }
    const { byEntry } = cache.current;
    const keyFor = (entry: ContainerLogsEntry): string | number => {
      if (entry._seq !== undefined) {
        return entry._seq;
      }
      let id = ids.current.byEntry.get(entry);
      if (id === undefined) {
        id = `entry:${ids.current.next++}`;
        ids.current.byEntry.set(entry, id);
      }
      return id;
    };
    const rows: ContainerLogRow[] = [];
    const displays = entries.map((entry) => {
      let display = byEntry.get(entry);
      if (!display) {
        display = buildEntryDisplay(entry, keyFor(entry), options, jsonOf);
        byEntry.set(entry, display);
      }
      for (const row of display.rows) {
        rows.push(row);
      }
      return display;
    });
    return { rows, copyText: () => displays.map((display) => display.copyLine).join('\n') };
  }, [emptyStateMessage, entries, jsonOf, options]);
}

type RenderLogMessage = (message: string, keyPrefix: string) => React.ReactNode;
type SelectContainerFilter = (container: string, kind: LogContainerKind) => void;

// Workload views color a line's metadata with its pod's color.
const podColorStyle = (podColor: string | undefined): React.CSSProperties | undefined =>
  podColor === undefined ? undefined : ({ '--pod-color': podColor } as React.CSSProperties);

const renderContainerLogSource = ({
  source,
  podColor,
  selectPod,
  selectContainer,
}: {
  source: ContainerLogSource;
  podColor: string | undefined;
  selectPod: (pod: string) => void;
  selectContainer: SelectContainerFilter;
}): React.ReactNode => {
  const { pod } = source;
  const label = formatContainerLabel(source.container, source.kind);
  return (
    <span
      className={
        pod === null ? 'log-viewer-metadata' : 'log-viewer-metadata log-viewer-metadata--bold'
      }
      style={podColorStyle(podColor)}
    >
      {'['}
      {pod !== null && (
        <>
          <LogMetadataButton
            subject="pod"
            name={pod}
            podColor={podColor}
            onSelect={() => selectPod(pod)}
          />
          {'/'}
        </>
      )}
      <LogMetadataButton
        subject="container"
        name={label}
        podColor={podColor}
        onSelect={() => selectContainer(source.container, source.kind)}
      />
      {']'}
    </span>
  );
};

export const renderContainerLogRow = ({
  row,
  podColors,
  selectPod,
  selectContainer,
  renderMessage,
}: {
  row: ContainerLogRow;
  podColors: Record<string, string>;
  selectPod: (pod: string) => void;
  selectContainer: SelectContainerFilter;
  renderMessage: RenderLogMessage;
}): React.ReactNode => {
  const message = renderMessage(row.line, `line-${row.key}`);
  const { timestamp = '', source = null } = row.metadata ?? {};
  const pod = source?.pod ?? null;
  const podColor = pod === null ? undefined : podColors[pod] || podColors.__fallback__;
  return (
    <div className="log-viewer-line">
      {!!timestamp && (
        <>
          <span
            className={
              podColor === undefined ? 'log-viewer-metadata' : 'log-viewer-metadata pod-color-text'
            }
            style={podColorStyle(podColor)}
          >
            [{timestamp}]
          </span>{' '}
        </>
      )}
      {source ? (
        <>{renderContainerLogSource({ source, podColor, selectPod, selectContainer })} </>
      ) : null}
      {message}
    </div>
  );
};
