/**
 * frontend/src/core/refresh/components/diagnostics/DiagnosticsStreamsTable.tsx
 *
 * UI component for DiagnosticsStreamsTable.
 * Renders stream telemetry details for the diagnostics panel.
 */

import React from 'react';
import type { DiagnosticsStreamRow } from './diagnosticsPanelTypes';

interface DiagnosticsStreamsTableProps {
  rows: DiagnosticsStreamRow[];
  emptyMessage?: string;
}

export const DiagnosticsStreamsTable: React.FC<DiagnosticsStreamsTableProps> = ({
  rows,
  emptyMessage,
}) => {
  const resolvedEmptyMessage = emptyMessage || 'Stream telemetry is not available yet.';
  return (
    <div className="diagnostics-table-wrapper">
      <table className="diagnostics-table diagnostics-streams-table">
        <thead>
          <tr>
            <th>Stream</th>
            <th>Sessions</th>
            <th>Delivered</th>
            <th>Dropped</th>
            <th>Errors</th>
            <th>Resyncs</th>
            <th>Fallbacks</th>
            <th>Last Connect</th>
            <th>Last Event</th>
            <th>Last Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="diagnostics-empty">
              <td colSpan={10}>{resolvedEmptyMessage}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.rowKey}>
                <td>
                  <span className="diagnostics-domain" title={row.rowKey}>
                    {row.label}
                  </span>
                </td>
                <td>{row.sessions}</td>
                <td>{row.delivered}</td>
                <td>{row.dropped}</td>
                <td>{row.errors}</td>
                <td title={row.resyncsTooltip ?? ''}>{row.resyncs ?? '—'}</td>
                <td title={row.fallbacksTooltip ?? ''}>{row.fallbacks ?? '—'}</td>
                <td title={row.lastConnectTooltip}>{row.lastConnect}</td>
                <td title={row.lastEventTooltip}>{row.lastEvent}</td>
                <td className="diagnostics-error">{row.lastError}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};
