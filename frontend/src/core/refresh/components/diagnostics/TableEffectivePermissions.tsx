/**
 * frontend/src/core/refresh/components/diagnostics/PermissionsTable.tsx
 *
 * UI component for PermissionsTable.
 * Handles rendering and interactions for the shared components.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { PermissionRow } from './diagnosticsPanelTypes';

interface PermissionsTableProps {
  rows: PermissionRow[];
}

const INITIAL_VISIBLE_ROWS = 250;
const ROW_INCREMENT = 250;

const matchesSearch = (row: PermissionRow, query: string): boolean => {
  if (!query) {
    return true;
  }
  return [
    row.scope,
    row.descriptorLabel,
    row.feature,
    row.resource,
    row.verb,
    row.allowed,
    row.lastError,
    row.reason,
    row.descriptorKey,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
};

export const EffectivePermissionsTable: React.FC<PermissionsTableProps> = ({ rows }) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_ROWS);
  const [searchTerm, setSearchTerm] = useState('');

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

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredRows = useMemo(
    () => rows.filter((row) => matchesSearch(row, normalizedSearch)),
    [normalizedSearch, rows]
  );
  const visibleRows = useMemo(
    () => filteredRows.slice(0, visibleLimit),
    [filteredRows, visibleLimit]
  );
  const hiddenRowCount = Math.max(filteredRows.length - visibleRows.length, 0);
  const showMoreRows = useCallback(() => {
    setVisibleLimit((current) => Math.min(current + ROW_INCREMENT, filteredRows.length));
  }, [filteredRows.length]);

  useEffect(() => {
    setVisibleLimit(INITIAL_VISIBLE_ROWS);
    setExpandedRows(new Set());
  }, [normalizedSearch]);

  return (
    <div className="diagnostics-section">
      <div className="diagnostics-section-header diagnostics-section-header--toolbar">
        <div className="diagnostics-section-title-group">
          <span className="diagnostics-section-subtitle">
            {filteredRows.length}
            {normalizedSearch ? ` OF ${rows.length}` : ''} CHECKS
            {hiddenRowCount > 0 ? ` • Showing ${visibleRows.length}` : ''}
          </span>
        </div>
        <div className="diagnostics-permissions-actions">
          <label className="diagnostics-section-filter">
            <span className="diagnostics-section-filter-label">Search</span>
            <input
              className="diagnostics-section-input"
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.currentTarget.value)}
            />
          </label>
          {hiddenRowCount > 0 && (
            <button className="diagnostics-section-toggle" onClick={showMoreRows} type="button">
              Show {Math.min(ROW_INCREMENT, hiddenRowCount)} More
            </button>
          )}
        </div>
      </div>
      <div className="diagnostics-table-wrapper">
        <table className="diagnostics-table">
          <thead>
            <tr>
              <th>Scope</th>
              <th>Descriptor</th>
              <th>Feature</th>
              <th>In Flight</th>
              <th>Duration</th>
              <th>Age</th>
              <th>Failures</th>
              <th>Allowed</th>
              <th>Error</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="diagnostics-empty">
                <td colSpan={10}>No capability data available yet.</td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr className="diagnostics-empty">
                <td colSpan={10}>No permissions match the current search.</td>
              </tr>
            ) : (
              visibleRows.map((row) => (
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
                  <td>{row.scope}</td>
                  <td>{row.descriptorLabel}</td>
                  <td>
                    <span className="diagnostics-table-feature" title={row.feature ?? undefined}>
                      {row.feature ?? '—'}
                    </span>
                  </td>
                  <td>{row.inFlightCount ? row.inFlightCount : '—'}</td>
                  <td>{row.lastDurationDisplay}</td>
                  <td title={row.age.tooltip}>{row.age.display}</td>
                  <td>{row.consecutiveFailureCount}</td>
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
