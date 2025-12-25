/**
 * frontend/src/core/refresh/components/diagnostics/PermissionsTable.tsx
 *
 * Diagnostics table for permission status entries.
 */
import React from 'react';
import type { PermissionRow } from './diagnosticsPanelTypes';

interface PermissionsTableProps {
  rows: PermissionRow[];
  showAllPermissions: boolean;
  onToggleShowAll: () => void;
}

export const PermissionsTable: React.FC<PermissionsTableProps> = ({
  rows,
  showAllPermissions,
  onToggleShowAll,
}) => {
  return (
    <div className="diagnostics-permissions">
      <div className="diagnostics-permissions-header">
        <span className="diagnostics-permissions-title">Effective Permissions</span>
        <div className="diagnostics-permissions-actions">
          <button
            type="button"
            className="diagnostics-permissions-toggle"
            onClick={onToggleShowAll}
          >
            {showAllPermissions ? 'Show Scoped' : 'Show All'}
          </button>
          <span className="diagnostics-permissions-count">{rows.length} checks</span>
        </div>
      </div>
      <div className="diagnostics-permissions-table-wrapper">
        <table className="diagnostics-permissions-table">
          <thead>
            <tr>
              <th>Namespace</th>
              <th>Descriptor</th>
              <th>Feature</th>
              <th>Pending</th>
              <th>In Flight</th>
              <th>Runtime</th>
              <th>Duration</th>
              <th>Completed</th>
              <th>Result</th>
              <th>Failures</th>
              <th>Checks</th>
              <th>Allowed</th>
              <th>Error</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="diagnostics-empty">
                <td colSpan={14}>No capability data available yet.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={row.isDenied ? 'diagnostics-permission-denied' : undefined}
                >
                  <td>{row.namespace}</td>
                  <td>{row.descriptorLabel}</td>
                  <td>
                    <span
                      className="diagnostics-permissions-table__feature"
                      title={row.feature ?? undefined}
                    >
                      {row.feature ?? '—'}
                    </span>
                  </td>
                  <td>{row.pendingCount != null ? row.pendingCount : '—'}</td>
                  <td>{row.inFlightCount != null ? row.inFlightCount : '—'}</td>
                  <td>{row.runtimeDisplay}</td>
                  <td>{row.lastDurationDisplay}</td>
                  <td title={row.lastCompleted.tooltip}>{row.lastCompleted.display}</td>
                  <td>{row.lastResult}</td>
                  <td>{row.consecutiveFailureCount}</td>
                  <td>{row.totalChecks != null ? row.totalChecks : '—'}</td>
                  <td>{row.allowed}</td>
                  <td className="diagnostics-permission-reason">{row.lastError ?? '—'}</td>
                  <td className="diagnostics-permission-reason">{row.reason ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
