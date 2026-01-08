/**
 * frontend/src/core/refresh/components/diagnostics/CapabilityChecksTable.tsx
 *
 * UI component for CapabilityChecksTable.
 * Handles rendering and interactions for the shared components.
 */

import React from 'react';
import type { CapabilityBatchRow } from './diagnosticsPanelTypes';

interface CapabilityChecksTableProps {
  rows: CapabilityBatchRow[];
  summary: string;
}

export const CapabilityChecksTable: React.FC<CapabilityChecksTableProps> = ({ rows, summary }) => {
  return (
    <div className="diagnostics-section">
      <div className="diagnostics-section-header">
        <div className="diagnostics-section-title-group">
          <span className="diagnostics-section-subtitle">{summary}</span>
        </div>
      </div>
      <div className="diagnostics-permissions-table-wrapper">
        <table className="diagnostics-permissions-table diagnostics-permissions-table--batches">
          <thead>
            <tr>
              <th>Namespace</th>
              <th>Pending</th>
              <th>In Flight</th>
              <th>Runtime</th>
              <th>Duration</th>
              <th>Completed</th>
              <th>Result</th>
              <th>Failures</th>
              <th>Checks</th>
              <th>Error</th>
              <th>Descriptors</th>
              <th>Features</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="diagnostics-empty">
                <td colSpan={12}>No namespace capability requests recorded yet.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.key}
                  className={
                    row.consecutiveFailureCount > 1 ? 'diagnostics-permission-denied' : undefined
                  }
                >
                  <td>{row.namespace}</td>
                  <td>{row.pendingCount}</td>
                  <td>{row.inFlightCount}</td>
                  <td title={row.runtimeMs ? `${row.runtimeMs}ms elapsed` : ''}>
                    {row.runtimeDisplay}
                  </td>
                  <td>{row.lastDurationDisplay}</td>
                  <td title={row.lastCompleted.tooltip}>{row.lastCompleted.display}</td>
                  <td>{row.lastResult}</td>
                  <td>{row.consecutiveFailureCount}</td>
                  <td>{row.totalChecks}</td>
                  <td className="diagnostics-permission-reason">{row.lastError ?? '—'}</td>
                  <td className="diagnostics-permission-reason">
                    <span
                      className="diagnostics-permissions-table__descriptor"
                      title={row.descriptorSummary ?? undefined}
                    >
                      {row.descriptorSummary ? row.descriptorSummary : '—'}
                    </span>
                  </td>
                  <td className="diagnostics-permission-reason">
                    <span
                      className="diagnostics-permissions-table__feature"
                      title={row.featureSummary ?? undefined}
                    >
                      {row.featureSummary ? row.featureSummary : '—'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
