/**
 * frontend/src/core/refresh/components/diagnostics/DiagnosticsTable.tsx
 *
 * UI component for DiagnosticsTable.
 * Handles rendering and interactions for the shared components.
 */

import { TABLE_NO_VALUE_TEXT, TableCellValue } from '@shared/components/tables/tableNoValue';
import type React from 'react';
import type { DiagnosticsRow, SummaryCardData } from './diagnosticsPanelTypes';

interface DiagnosticsTableProps {
  rows: DiagnosticsRow[];
}

const displayTelemetryCounts = (row: DiagnosticsRow): string =>
  row.telemetrySuccess === undefined
    ? TABLE_NO_VALUE_TEXT
    : `${row.telemetrySuccess} / ${row.telemetryFailure ?? 0}`;

export const DiagnosticsTable: React.FC<DiagnosticsTableProps> = ({ rows }) => {
  return (
    <div className="diagnostics-table-wrapper">
      <table className="diagnostics-table">
        <thead>
          <tr>
            <th>Domain</th>
            <th>Scope</th>
            <th>Role</th>
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
            <th>Sync Wait</th>
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
              <td colSpan={20}>
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
                    <TableCellValue>{row.scope}</TableCellValue>
                  )}
                </td>
                <td title={row.roleTooltip ?? ''}>
                  <TableCellValue>{row.role}</TableCellValue>
                </td>
                <td>
                  <TableCellValue>{row.namespace}</TableCellValue>
                </td>
                <td title={row.modeTooltip ?? ''}>
                  <TableCellValue>{row.mode}</TableCellValue>
                </td>
                <td title={row.healthTooltip ?? ''}>
                  <TableCellValue>{row.healthStatus}</TableCellValue>
                </td>
                <td>
                  <TableCellValue>{row.status}</TableCellValue>
                </td>
                <td title={row.pollingTooltip ?? ''}>
                  <TableCellValue>{row.pollingStatus}</TableCellValue>
                </td>
                <td>
                  <TableCellValue>{row.interval}</TableCellValue>
                </td>
                <td className={row.countClassName} title={row.countTooltip ?? ''}>
                  <TableCellValue>{row.countDisplay}</TableCellValue>
                </td>
                <td>
                  <TableCellValue>{row.version}</TableCellValue>
                </td>
                <td title={row.lastUpdatedTooltip}>
                  <TableCellValue>{row.lastUpdated}</TableCellValue>
                </td>
                <td title={row.telemetryTooltip ?? ''}>
                  <TableCellValue>{row.telemetryStatus ?? TABLE_NO_VALUE_TEXT}</TableCellValue>
                </td>
                <td>
                  <TableCellValue>{row.duration ?? TABLE_NO_VALUE_TEXT}</TableCellValue>
                </td>
                <td title="Peak time a Build for this domain waited on the informer-sync gate (initial-LIST gating) before building">
                  <TableCellValue>{row.syncWait ?? TABLE_NO_VALUE_TEXT}</TableCellValue>
                </td>
                <td title={row.metricsTooltip}>
                  <TableCellValue>{row.metricsStatus}</TableCellValue>
                </td>
                <td>
                  <TableCellValue>{displayTelemetryCounts(row)}</TableCellValue>
                </td>
                <td>
                  <TableCellValue>{row.dropped}</TableCellValue>
                </td>
                <td className={row.stale ? 'diagnostics-stale-cell' : undefined}>
                  {row.stale ? 'Yes' : 'No'}
                </td>
                <td className="diagnostics-error">
                  <TableCellValue>{row.error}</TableCellValue>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

interface DiagnosticsSummaryCardsProps {
  orchestratorSummary: SummaryCardData;
  metricsSummary: SummaryCardData;
  eventSummary: SummaryCardData;
  catalogSummary: SummaryCardData;
  logSummary: SummaryCardData;
}

export const DiagnosticsSummaryCards: React.FC<DiagnosticsSummaryCardsProps> = ({
  orchestratorSummary,
  metricsSummary,
  eventSummary,
  catalogSummary,
  logSummary,
}) => {
  return (
    <div className="diagnostics-summary">
      <SummaryCard heading="Orchestrator" data={orchestratorSummary} />
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
