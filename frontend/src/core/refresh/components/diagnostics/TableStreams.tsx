/**
 * frontend/src/core/refresh/components/diagnostics/DiagnosticsStreamsTable.tsx
 *
 * UI component for DiagnosticsStreamsTable.
 * Renders stream telemetry details for the diagnostics panel.
 */

import {
  isTableNoValueText,
  TABLE_NO_VALUE_TEXT,
  TableCellValue,
} from '@shared/components/tables/tableNoValue';
import type React from 'react';
import type { DiagnosticsStreamRow } from './diagnosticsPanelTypes';
import { formatLastUpdated } from './diagnosticsPanelUtils';

interface DiagnosticsStreamsTableProps {
  rows: DiagnosticsStreamRow[];
  emptyMessage?: string;
  summary: string;
}

export const DiagnosticsStreamsTable: React.FC<DiagnosticsStreamsTableProps> = ({
  rows,
  emptyMessage,
  summary,
}) => {
  const resolvedEmptyMessage = emptyMessage || 'Stream telemetry is not available yet.';
  return (
    <div className="diagnostics-section">
      <div className="diagnostics-section-header">
        <div className="diagnostics-section-title-group">
          <span className="diagnostics-section-subtitle">{summary}</span>
        </div>
      </div>
      <div className="diagnostics-table-wrapper">
        <table className="diagnostics-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Delivered</th>
              <th>Dropped</th>
              <th>Errors</th>
              <th>Resyncs</th>
              <th>Fallbacks</th>
              <th>Last Event</th>
              <th>Last Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="diagnostics-empty">
                <td colSpan={8}>{resolvedEmptyMessage}</td>
              </tr>
            ) : (
              rows.map((row) => <StreamTableRow key={row.rowKey} row={row} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// LastErrorCell colours an actual error with the warning colour and appends the
// relative age of when it occurred; the no-value marker stays dimmed and shows no age.
const LastErrorCell: React.FC<{ value: string; at?: number }> = ({ value, at }) => {
  const hasError = Boolean(value) && !isTableNoValueText(value);
  if (!hasError) {
    return (
      <td>
        <TableCellValue>{value}</TableCellValue>
      </td>
    );
  }
  const age = at ? formatLastUpdated(at) : null;
  return (
    <td className="diagnostics-error-warning" title={age?.tooltip}>
      {value}
      {age ? <span className="diagnostics-error-age"> · {age.display}</span> : null}
    </td>
  );
};

// StreamTableRow renders one node of the streams tree: a stream header
// (socket-level: Sessions/Last Connect live here, since one socket spans all
// clusters), a cluster group label, or a per-domain leaf.
const StreamTableRow: React.FC<{ row: DiagnosticsStreamRow }> = ({ row }) => {
  if (row.kind === 'stream') {
    return (
      <tr className="diagnostics-stream-row">
        <td className="diagnostics-stream-name" title={row.rowKey}>
          <span className="diagnostics-domain">{row.label}</span>
          <span className="diagnostics-stream-socket" title={row.lastConnectTooltip}>
            {` · Sessions ${row.sessions} · Last Connect ${row.lastConnect}`}
          </span>
        </td>
        <td>{row.delivered}</td>
        <td>{row.dropped}</td>
        <td>{row.errors}</td>
        <td>
          <TableCellValue>{TABLE_NO_VALUE_TEXT}</TableCellValue>
        </td>
        <td>
          <TableCellValue>{TABLE_NO_VALUE_TEXT}</TableCellValue>
        </td>
        <td title={row.lastEventTooltip}>
          <TableCellValue>{row.lastEvent}</TableCellValue>
        </td>
        <LastErrorCell value={row.lastError} at={row.lastErrorAt} />
      </tr>
    );
  }
  if (row.kind === 'cluster') {
    // A cluster row is either a group label (domain leaves follow, no metrics) or,
    // for cluster-leaf streams (catalog), the leaf itself carrying its metrics.
    if (!row.leaf) {
      return (
        <tr className="diagnostics-cluster-row">
          <td className="diagnostics-cluster-name">{row.cluster}</td>
          <td />
          <td />
          <td />
          <td />
          <td />
          <td />
          <td />
        </tr>
      );
    }
    return (
      <tr className="diagnostics-cluster-row">
        <td className="diagnostics-cluster-name">{row.cluster}</td>
        <td>{row.leaf.delivered}</td>
        <td>{row.leaf.dropped}</td>
        <td>{row.leaf.errors}</td>
        <td>
          <TableCellValue>{TABLE_NO_VALUE_TEXT}</TableCellValue>
        </td>
        <td>
          <TableCellValue>{TABLE_NO_VALUE_TEXT}</TableCellValue>
        </td>
        <td title={row.leaf.lastEventTooltip}>
          <TableCellValue>{row.leaf.lastEvent}</TableCellValue>
        </td>
        <LastErrorCell value={row.leaf.lastError} at={row.leaf.lastErrorAt} />
      </tr>
    );
  }
  return (
    <tr className="diagnostics-domain-row">
      <td className="diagnostics-domain-name">{row.domain}</td>
      <td>{row.delivered}</td>
      <td>{row.dropped}</td>
      <td>{row.errors}</td>
      <td title={row.resyncsTooltip ?? ''}>
        <TableCellValue>{row.resyncs ?? TABLE_NO_VALUE_TEXT}</TableCellValue>
      </td>
      <td title={row.fallbacksTooltip ?? ''}>
        <TableCellValue>{row.fallbacks ?? TABLE_NO_VALUE_TEXT}</TableCellValue>
      </td>
      <td title={row.lastEventTooltip}>
        <TableCellValue>{row.lastEvent}</TableCellValue>
      </td>
      <LastErrorCell value={row.lastError} at={row.lastErrorAt} />
    </tr>
  );
};
