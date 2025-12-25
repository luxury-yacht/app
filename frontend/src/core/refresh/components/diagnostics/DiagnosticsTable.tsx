/**
 * frontend/src/core/refresh/components/diagnostics/DiagnosticsTable.tsx
 *
 * Shared diagnostics table for refresh domains.
 */
import React from 'react';
import type { DiagnosticsRow } from './diagnosticsPanelTypes';

interface DiagnosticsTableProps {
  rows: DiagnosticsRow[];
}

export const DiagnosticsTable: React.FC<DiagnosticsTableProps> = ({ rows }) => {
  return (
    <div className="diagnostics-table-wrapper">
      <table className="diagnostics-table">
        <thead>
          <tr>
            <th>Domain</th>
            <th>Namespace</th>
            <th>Status</th>
            <th>Interval</th>
            <th>Count</th>
            <th>Version</th>
            <th>Last Updated</th>
            <th>Telemetry</th>
            <th>Duration</th>
            <th>Metrics</th>
            <th>Polls</th>
            <th>Dropped</th>
            <th>Stale</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="diagnostics-empty">
              <td colSpan={14}>
                All refreshers are idle. Enable "Show idle" to view the full list.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.rowKey}>
                <td>
                  <span className="diagnostics-domain" title={row.rowKey}>
                    {row.label}
                  </span>
                </td>
                <td>{row.namespace}</td>
                <td>{row.status}</td>
                <td>{row.interval}</td>
                <td className={row.countClassName} title={row.countTooltip ?? ''}>
                  {row.countDisplay}
                </td>
                <td>{row.version}</td>
                <td title={row.lastUpdatedTooltip}>{row.lastUpdated}</td>
                <td title={row.telemetryTooltip ?? ''}>{row.telemetryStatus ?? '—'}</td>
                <td>{row.duration ?? '—'}</td>
                <td title={row.metricsTooltip}>{row.metricsStatus}</td>
                <td>
                  {row.telemetrySuccess !== undefined
                    ? `${row.telemetrySuccess} / ${row.telemetryFailure ?? 0}`
                    : '—'}
                </td>
                <td>{row.dropped}</td>
                <td className={row.stale ? 'diagnostics-stale-cell' : undefined}>
                  {row.stale ? 'Yes' : 'No'}
                </td>
                <td className="diagnostics-error">{row.error}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};
