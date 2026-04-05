/**
 * frontend/src/core/refresh/components/diagnostics/PermissionsTable.tsx
 *
 * UI component for PermissionsTable.
 * Handles rendering and interactions for the shared components.
 */

import React, { useCallback, useState } from 'react';
import type { PermissionRow } from './diagnosticsPanelTypes';

interface PermissionsTableProps {
  rows: PermissionRow[];
  showAllPermissions: boolean;
  onToggleShowAll: () => void;
}

export const EffectivePermissionsTable: React.FC<PermissionsTableProps> = ({
  rows,
  showAllPermissions,
  onToggleShowAll,
}) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = useCallback((id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);
  return (
    <div className="diagnostics-section">
      <div className="diagnostics-section-header">
        <div className="diagnostics-section-title-group">
          <span className="diagnostics-section-subtitle">{rows.length} CHECKS</span>
        </div>
        <div className="diagnostics-permissions-actions">
          <label className="diagnostics-permissions-toggle">
            <input
              type="checkbox"
              checked={showAllPermissions}
              onChange={() => onToggleShowAll()}
            />
            <span style={{ color: 'var(--color-text-secondary)' }}>Show All</span>
          </label>
        </div>
      </div>
      <div className="diagnostics-table-wrapper">
        <table className="diagnostics-table">
          <thead>
            <tr>
              <th>Namespace</th>
              <th>Descriptor</th>
              <th>Feature</th>
              <th>In Flight</th>
              <th>Duration</th>
              <th>Age</th>
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
                <td colSpan={12}>No capability data available yet.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={
                    [
                      row.isDenied ? 'diagnostics-permission-denied' : '',
                      expandedRows.has(row.id) ? 'diagnostics-row-expanded' : '',
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  onClick={() => toggleRow(row.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>{row.namespace}</td>
                  <td>{row.descriptorLabel}</td>
                  <td>
                    <span className="diagnostics-table-feature" title={row.feature ?? undefined}>
                      {row.feature ?? '—'}
                    </span>
                  </td>
                  <td>{row.inFlightCount ? row.inFlightCount : '—'}</td>
                  <td>{row.lastDurationDisplay}</td>
                  <td title={row.age.tooltip}>{row.age.display}</td>
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
