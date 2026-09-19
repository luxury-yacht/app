/**
 * frontend/src/core/refresh/components/diagnostics/PermissionsTable.tsx
 *
 * UI component for PermissionsTable.
 * Handles rendering and interactions for the shared components.
 */

import { TABLE_NO_VALUE_TEXT, TableCellValue } from '@shared/components/tables/tableNoValue';
import type React from 'react';
import { useMemo } from 'react';
import type { PermissionRow } from './diagnosticsPanelTypes';

import {
  DIAGNOSTICS_ROW_INCREMENT,
  useDiagnosticsTableControls,
} from './useDiagnosticsTableControls';
import { displayInFlightCount } from './diagnosticsPanelUtils';

interface PermissionsTableProps {
  rows: PermissionRow[];
}

const matchesSearch = (row: PermissionRow, query: string): boolean => {
  if (!query) {
    return true;
  }
  return [
    row.scope,
    row.descriptorLabel,
    row.featureLabel,
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
  const {
    searchTerm,
    setSearchTerm,
    normalizedSearch,
    visibleLimit,
    expandedRows,
    toggleRow,
    showMoreRows,
  } = useDiagnosticsTableControls();

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesSearch(row, normalizedSearch)),
    [normalizedSearch, rows]
  );
  const visibleRows = useMemo(
    () => filteredRows.slice(0, visibleLimit),
    [filteredRows, visibleLimit]
  );
  const hiddenRowCount = Math.max(filteredRows.length - visibleRows.length, 0);

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
            <button
              className="diagnostics-section-toggle"
              onClick={() => showMoreRows(filteredRows.length)}
              type="button"
            >
              Show {Math.min(DIAGNOSTICS_ROW_INCREMENT, hiddenRowCount)} More
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
            {rows.length === 0 && (
              <tr className="diagnostics-empty">
                <td colSpan={10}>No capability data available yet.</td>
              </tr>
            )}
            {rows.length > 0 && filteredRows.length === 0 && (
              <tr className="diagnostics-empty">
                <td colSpan={10}>No permissions match the current search.</td>
              </tr>
            )}
            {filteredRows.length > 0 &&
              visibleRows.map((row) => (
                <tr
                  key={row.id}
                  className={
                    [
                      'diagnostics-row-interactive',
                      row.isDenied ? 'diagnostics-permission-denied' : '',
                      expandedRows.has(row.id) ? 'diagnostics-row-expanded' : '',
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  onClick={() => toggleRow(row.id)}
                >
                  <td>{row.scope}</td>
                  <td>{row.descriptorLabel}</td>
                  <td>
                    <span className="diagnostics-table-feature" title={row.feature ?? undefined}>
                      <TableCellValue>
                        {row.featureLabel ?? row.feature ?? TABLE_NO_VALUE_TEXT}
                      </TableCellValue>
                    </span>
                  </td>
                  <td>
                    <TableCellValue>{displayInFlightCount(row.inFlightCount)}</TableCellValue>
                  </td>
                  <td>
                    <TableCellValue>{row.lastDurationDisplay}</TableCellValue>
                  </td>
                  <td title={row.age.tooltip}>
                    <TableCellValue>{row.age.display}</TableCellValue>
                  </td>
                  <td>{row.consecutiveFailureCount}</td>
                  <td>{row.allowed}</td>
                  <td className="diagnostics-permission-reason">
                    <TableCellValue>{row.lastError ?? TABLE_NO_VALUE_TEXT}</TableCellValue>
                  </td>
                  <td className="diagnostics-permission-reason">
                    <TableCellValue>{row.reason ?? TABLE_NO_VALUE_TEXT}</TableCellValue>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
