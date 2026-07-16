/**
 * frontend/src/core/refresh/components/diagnostics/CapabilityChecksTable.tsx
 *
 * UI component for CapabilityChecksTable.
 * Handles rendering and interactions for the shared components.
 */

import { TABLE_NO_VALUE_TEXT, TableCellValue } from '@shared/components/tables/tableNoValue';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { permissionFeatureLabel } from '@/core/capabilities';
import type { CapabilityBatchRow } from './diagnosticsPanelTypes';

interface CapabilityChecksTableProps {
  currentRows: CapabilityBatchRow[];
  previousRows: CapabilityBatchRow[];
  summary: string;
}

const INITIAL_VISIBLE_ROWS = 250;
const ROW_INCREMENT = 250;

const displayInFlightCount = (count: number | null | undefined): number | string =>
  count !== null && count !== undefined && count > 0 ? count : TABLE_NO_VALUE_TEXT;

const displayIncomplete = (incomplete: boolean | null | undefined): string => {
  if (incomplete === null || incomplete === undefined) {
    return TABLE_NO_VALUE_TEXT;
  }
  return incomplete ? 'Yes' : 'No';
};

const matchesSearch = (row: CapabilityBatchRow, query: string): boolean => {
  if (!query) {
    return true;
  }
  const descriptorText =
    row.descriptorsByFeature
      ?.flatMap(({ feature, resources }) => [
        permissionFeatureLabel(feature) ?? feature,
        ...resources,
      ])
      .join(' ') ?? '';
  return [
    row.scope,
    row.lastResult,
    row.lastError,
    row.method,
    row.ssrrIncomplete === null || row.ssrrIncomplete === undefined
      ? null
      : row.ssrrIncomplete
        ? 'incomplete'
        : 'complete',
    row.ssrrRuleCount,
    row.ssarFallbackCount,
    row.totalChecks,
    descriptorText,
  ]
    .filter((value) => value !== null && value !== undefined)
    .some((value) => String(value).toLowerCase().includes(query));
};

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
    <td>
      <TableCellValue>{displayInFlightCount(row.inFlightCount)}</TableCellValue>
    </td>
    <td title={row.runtimeMs ? `${row.runtimeMs}ms elapsed` : ''}>
      <TableCellValue>{row.runtimeDisplay}</TableCellValue>
    </td>
    <td>
      <TableCellValue>{row.lastDurationDisplay}</TableCellValue>
    </td>
    <td title={row.age.tooltip}>
      <TableCellValue>{row.age.display}</TableCellValue>
    </td>
    <td>{row.lastResult}</td>
    <td>{row.consecutiveFailureCount}</td>
    <td>{row.totalChecks}</td>
    <td className="diagnostics-permission-reason">
      <TableCellValue>{row.lastError ?? TABLE_NO_VALUE_TEXT}</TableCellValue>
    </td>
    <td>
      <TableCellValue>{row.method ?? TABLE_NO_VALUE_TEXT}</TableCellValue>
    </td>
    <td>
      <TableCellValue>{displayIncomplete(row.ssrrIncomplete)}</TableCellValue>
    </td>
    <td>
      <TableCellValue>{row.ssrrRuleCount ?? TABLE_NO_VALUE_TEXT}</TableCellValue>
    </td>
    <td>
      <TableCellValue>{row.ssarFallbackCount ?? TABLE_NO_VALUE_TEXT}</TableCellValue>
    </td>
    <td>
      {row.descriptorsByFeature && row.descriptorsByFeature.length > 0 ? (
        <button
          type="button"
          className={
            'diagnostics-table-descriptor' +
            (!isCollapsed ? ' diagnostics-table-cell-expanded' : '')
          }
          onClick={() => onToggle(row.key)}
        >
          {!isCollapsed
            ? row.descriptorsByFeature.map(({ feature, resources }) => (
                <div key={feature} className="diagnostics-checks-group">
                  {resources.map((r, i) => (
                    <div key={r} className="diagnostics-checks-row">
                      <span className="diagnostics-checks-feature">
                        {i === 0 ? (permissionFeatureLabel(feature) ?? feature) : ''}
                      </span>
                      <span className="diagnostics-checks-resource">{r}</span>
                    </div>
                  ))}
                </div>
              ))
            : 'Click to expand'}
        </button>
      ) : (
        <span className="diagnostics-table-descriptor">
          <TableCellValue>{TABLE_NO_VALUE_TEXT}</TableCellValue>
        </span>
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
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_VISIBLE_ROWS);
  const [searchTerm, setSearchTerm] = useState('');

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

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredCurrentRows = useMemo(
    () => currentRows.filter((row) => matchesSearch(row, normalizedSearch)),
    [currentRows, normalizedSearch]
  );
  const filteredPreviousRows = useMemo(
    () => previousRows.filter((row) => matchesSearch(row, normalizedSearch)),
    [previousRows, normalizedSearch]
  );
  const totalRows = currentRows.length + previousRows.length;
  const filteredTotalRows = filteredCurrentRows.length + filteredPreviousRows.length;
  const { visibleCurrentRows, visiblePreviousRows, visibleRowsCount } = useMemo(() => {
    const visibleCurrent = filteredCurrentRows.slice(0, visibleLimit);
    const remaining = Math.max(visibleLimit - visibleCurrent.length, 0);
    const visiblePrevious = filteredPreviousRows.slice(0, remaining);
    return {
      visibleCurrentRows: visibleCurrent,
      visiblePreviousRows: visiblePrevious,
      visibleRowsCount: visibleCurrent.length + visiblePrevious.length,
    };
  }, [filteredCurrentRows, filteredPreviousRows, visibleLimit]);
  const hiddenRowCount = Math.max(filteredTotalRows - visibleRowsCount, 0);
  const showMoreRows = useCallback(() => {
    setVisibleLimit((current) => Math.min(current + ROW_INCREMENT, filteredTotalRows));
  }, [filteredTotalRows]);

  useEffect(() => {
    void normalizedSearch;
    setVisibleLimit(INITIAL_VISIBLE_ROWS);
    setExpandedRows(new Set());
  }, [normalizedSearch]);

  return (
    <div className="diagnostics-section">
      <div className="diagnostics-section-header diagnostics-section-header--toolbar">
        <div className="diagnostics-section-title-group">
          <span className="diagnostics-section-subtitle">
            {summary}
            {normalizedSearch ? ` • ${filteredTotalRows} MATCHES` : ''}
            {hiddenRowCount > 0 ? ` • Showing ${visibleRowsCount}` : ''}
          </span>
        </div>
        <div className="diagnostics-section-actions">
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
          ) : filteredTotalRows === 0 ? (
            <tbody>
              <tr className="diagnostics-empty">
                <td colSpan={COLUMN_COUNT}>No capability checks match the current search.</td>
              </tr>
            </tbody>
          ) : (
            <>
              {/* Current checks — Cluster + actively viewed namespace. */}
              <tbody>
                <tr className="diagnostics-table-section-header">
                  <td colSpan={COLUMN_COUNT}>Current Checks</td>
                </tr>
                {visibleCurrentRows.length === 0 ? (
                  <tr className="diagnostics-empty">
                    <td colSpan={COLUMN_COUNT}>No current checks.</td>
                  </tr>
                ) : (
                  visibleCurrentRows.map((row) => (
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
              {visiblePreviousRows.length > 0 && (
                <tbody>
                  <tr className="diagnostics-table-section-header">
                    <td colSpan={COLUMN_COUNT}>Previous Checks</td>
                  </tr>
                  {visiblePreviousRows.map((row) => (
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
