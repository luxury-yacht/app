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
              <th>Stream</th>
              <th>Active Domains</th>
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
                <td colSpan={11}>{resolvedEmptyMessage}</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.rowKey}>
                  <td>
                    <span className="diagnostics-domain" title={row.rowKey}>
                      {row.label}
                    </span>
                  </td>
                  <td title={row.activeDomainsTooltip ?? ''}>{row.activeDomains}</td>
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
    </div>
  );
};
