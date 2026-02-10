/**
 * frontend/src/core/refresh/components/diagnostics/DiagnosticsTable.tsx
 *
 * UI component for DiagnosticsTable.
 * Handles rendering and interactions for the shared components.
 */

import React from 'react';
import type { DiagnosticsRow } from './diagnosticsPanelTypes';
import type { SummaryCardData } from './diagnosticsPanelTypes';

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
            <th>Scope</th>
            <th>Namespace</th>
            <th>Mode</th>
            <th>Health</th>
            <th>Status</th>
            <th>Polling</th>
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
              <td colSpan={18}>
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
                <td title={row.scopeTooltip ?? ''}>
                  {row.scopeEntries && row.scopeEntries.length > 0 ? (
                    <span className="diagnostics-scope-entries">
                      {row.scopeEntries.map((entry) => (
                        <div key={entry.clusterName}>
                          {entry.clusterName}
                          {entry.label === 'Active' && (
                            <span className="diagnostics-scope-label"> (active)</span>
                          )}
                        </div>
                      ))}
                    </span>
                  ) : (
                    row.scope
                  )}
                </td>
                <td>{row.namespace}</td>
                <td title={row.modeTooltip ?? ''}>{row.mode}</td>
                <td title={row.healthTooltip ?? ''}>{row.healthStatus}</td>
                <td>{row.status}</td>
                <td title={row.pollingTooltip ?? ''}>{row.pollingStatus}</td>
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

interface DiagnosticsSummaryCardsProps {
  orchestratorPendingRequests: number;
  metricsSummary: SummaryCardData;
  eventSummary: SummaryCardData;
  catalogSummary: SummaryCardData;
  logSummary: SummaryCardData;
}

export const DiagnosticsSummaryCards: React.FC<DiagnosticsSummaryCardsProps> = ({
  orchestratorPendingRequests,
  metricsSummary,
  eventSummary,
  catalogSummary,
  logSummary,
}) => {
  return (
    <div className="diagnostics-summary">
      <div className="diagnostics-summary-card">
        <span className="diagnostics-summary-heading">Orchestrator</span>
        <span className="diagnostics-summary-primary">
          Pending Requests: {orchestratorPendingRequests}
        </span>
      </div>
      <SummaryCard heading="Metrics" data={metricsSummary} />
      <SummaryCard heading="Events" data={eventSummary} />
      <SummaryCard heading="Catalog Stream" data={catalogSummary} />
      <SummaryCard heading="Logs" data={logSummary} />
    </div>
  );
};

interface SummaryCardProps {
  heading: string;
  data: SummaryCardData;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ heading, data }) => {
  return (
    <div className="diagnostics-summary-card">
      <span className="diagnostics-summary-heading">{heading}</span>
      <span
        className={`diagnostics-summary-primary${data.className ? ` ${data.className}` : ''}`}
        title={data.title ?? ''}
      >
        {data.primary}
      </span>
      {data.secondary ? (
        <span className="diagnostics-summary-secondary" title={data.title ?? ''}>
          {data.secondary}
        </span>
      ) : null}
    </div>
  );
};
