/**
 * frontend/src/core/refresh/components/diagnostics/CapabilityChecksTable.tsx
 *
 * UI component for CapabilityChecksTable.
 * Handles rendering and interactions for the shared components.
 */

import React, { useCallback, useState } from 'react';
import type { CapabilityBatchRow } from './diagnosticsPanelTypes';

interface CapabilityChecksTableProps {
  currentRows: CapabilityBatchRow[];
  previousRows: CapabilityBatchRow[];
  summary: string;
}

/** Renders a single data row within the capability checks table. */
const CapabilityRow: React.FC<{
  row: CapabilityBatchRow;
  isCollapsed: boolean;
  onToggle: (key: string) => void;
}> = ({ row, isCollapsed, onToggle }) => (
  <tr
    key={row.key}
    className={row.consecutiveFailureCount > 1 ? 'diagnostics-permission-denied' : undefined}
    onClick={() => onToggle(row.key)}
    style={{ cursor: 'pointer' }}
  >
    <td>{row.scope}</td>
    <td>{row.inFlightCount ? row.inFlightCount : '—'}</td>
    <td title={row.runtimeMs ? `${row.runtimeMs}ms elapsed` : ''}>{row.runtimeDisplay}</td>
    <td>{row.lastDurationDisplay}</td>
    <td title={row.age.tooltip}>{row.age.display}</td>
    <td>{row.lastResult}</td>
    <td>{row.consecutiveFailureCount}</td>
    <td>{row.totalChecks}</td>
    <td className="diagnostics-permission-reason">{row.lastError ?? '—'}</td>
    <td>{row.method ?? '—'}</td>
    <td>{row.ssrrIncomplete != null ? (row.ssrrIncomplete ? 'Yes' : 'No') : '—'}</td>
    <td>{row.ssrrRuleCount ?? '—'}</td>
    <td>{row.ssarFallbackCount ?? '—'}</td>
    <td>
      {row.descriptorsByFeature && row.descriptorsByFeature.length > 0 ? (
        <span
          className={
            `diagnostics-table-descriptor` +
            (!isCollapsed ? ' diagnostics-table-cell-expanded' : '')
          }
          onClick={() => onToggle(row.key)}
        >
          {!isCollapsed
            ? row.descriptorsByFeature.map(({ feature, resources }) => (
                <div key={feature} className="diagnostics-checks-group">
                  {resources.map((r, i) => (
                    <div key={r} className="diagnostics-checks-row">
                      <span className="diagnostics-checks-feature">{i === 0 ? feature : ''}</span>
                      <span className="diagnostics-checks-resource">{r}</span>
                    </div>
                  ))}
                </div>
              ))
            : 'Click to expand'}
        </span>
      ) : (
        <span className="diagnostics-table-descriptor">—</span>
      )}
    </td>
  </tr>
);

const COLUMN_COUNT = 14;

export const CapabilityChecksTable: React.FC<CapabilityChecksTableProps> = ({
  currentRows,
  previousRows,
  summary,
}) => {
  // Track which rows are expanded (collapsed by default).
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRowExpanded = useCallback((key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const totalRows = currentRows.length + previousRows.length;

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
              <th>Scope</th>
              <th>In Flight</th>
              <th>Runtime</th>
              <th>Duration</th>
              <th>Age</th>
              <th>Result</th>
              <th>Failures</th>
              <th>Checks</th>
              <th>Error</th>
              <th>Method</th>
              <th>Incomplete</th>
              <th>Rules</th>
              <th>SSAR Fallback</th>
              <th>Checks</th>
            </tr>
          </thead>
          {totalRows === 0 ? (
            <tbody>
              <tr className="diagnostics-empty">
                <td colSpan={COLUMN_COUNT}>No namespace capability requests recorded yet.</td>
              </tr>
            </tbody>
          ) : (
            <>
              {/* Current checks — Cluster + actively viewed namespace. */}
              <tbody>
                <tr className="diagnostics-table-section-header">
                  <td colSpan={COLUMN_COUNT}>Current Checks</td>
                </tr>
                {currentRows.length === 0 ? (
                  <tr className="diagnostics-empty">
                    <td colSpan={COLUMN_COUNT}>No current checks.</td>
                  </tr>
                ) : (
                  currentRows.map((row) => (
                    <CapabilityRow
                      key={row.key}
                      row={row}
                      isCollapsed={!expandedRows.has(row.key)}
                      onToggle={toggleRowExpanded}
                    />
                  ))
                )}
              </tbody>
              {/* Previous checks — namespaces no longer being viewed. */}
              {previousRows.length > 0 && (
                <tbody>
                  <tr className="diagnostics-table-section-header">
                    <td colSpan={COLUMN_COUNT}>Previous Checks</td>
                  </tr>
                  {previousRows.map((row) => (
                    <CapabilityRow
                      key={row.key}
                      row={row}
                      isCollapsed={!expandedRows.has(row.key)}
                      onToggle={toggleRowExpanded}
                    />
                  ))}
                </tbody>
              )}
            </>
          )}
        </table>
      </div>
    </div>
  );
};
