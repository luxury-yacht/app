/**
 * frontend/src/core/refresh/components/diagnostics/CapabilityChecksTable.tsx
 *
 * UI component for CapabilityChecksTable.
 * Handles rendering and interactions for the shared components.
 */

import React, { useCallback, useState } from 'react';
import type { CapabilityBatchRow } from './diagnosticsPanelTypes';

/** Split a comma-separated summary string into sorted individual items. */
const splitAndSort = (summary: string): string[] =>
  summary
    .split(', ')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

/**
 * Group descriptors by resource type, consolidating verbs.
 * Input format: "pods/list, pods/delete, deployments/get, pods/list (status)"
 * Output: [{ resource: "deployments", verbs: "get" }, { resource: "pods", verbs: "delete, list, list (status)" }]
 */
const groupDescriptors = (summary: string): { resource: string; verbs: string }[] => {
  const items = summary
    .split(', ')
    .map((s) => s.trim())
    .filter(Boolean);
  const groups = new Map<string, string[]>();

  for (const item of items) {
    const slashIdx = item.indexOf('/');
    if (slashIdx === -1) {
      // Unexpected format — keep as-is under its own key.
      groups.set(item, []);
      continue;
    }
    const resource = item.substring(0, slashIdx);
    const verb = item.substring(slashIdx + 1);
    if (!groups.has(resource)) {
      groups.set(resource, []);
    }
    groups.get(resource)!.push(verb);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([resource, verbs]) => ({
      resource,
      verbs: verbs.length === 0 ? '' : [...verbs].sort((a, b) => a.localeCompare(b)).join(', '),
    }));
};

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
  >
    <td>{row.namespace}</td>
    <td>{row.pendingCount}</td>
    <td>{row.inFlightCount}</td>
    <td title={row.runtimeMs ? `${row.runtimeMs}ms elapsed` : ''}>{row.runtimeDisplay}</td>
    <td>{row.lastDurationDisplay}</td>
    <td title={row.lastCompleted.tooltip}>{row.lastCompleted.display}</td>
    <td>{row.lastResult}</td>
    <td>{row.consecutiveFailureCount}</td>
    <td>{row.totalChecks}</td>
    <td className="diagnostics-permission-reason">{row.lastError ?? '—'}</td>
    <td>
      {row.descriptorSummary ? (
        <span
          className={
            `diagnostics-table-descriptor` +
            (!isCollapsed ? ' diagnostics-table-cell-expanded' : '')
          }
          title={!isCollapsed ? undefined : row.descriptorSummary}
          onClick={() => onToggle(row.key)}
        >
          {!isCollapsed
            ? groupDescriptors(row.descriptorSummary).map(({ resource, verbs }) => (
                <div key={resource}>
                  <span className="diagnostics-descriptor-resource">{resource}:</span> {verbs}
                </div>
              ))
            : 'Click to expand'}
        </span>
      ) : (
        <span className="diagnostics-table-descriptor">—</span>
      )}
    </td>
    <td>
      {row.featureSummary ? (
        <span
          className={
            `diagnostics-table-feature` + (!isCollapsed ? ' diagnostics-table-cell-expanded' : '')
          }
          title={!isCollapsed ? undefined : row.featureSummary}
          onClick={() => onToggle(row.key)}
        >
          {!isCollapsed
            ? splitAndSort(row.featureSummary).map((item) => <div key={item}>{item}</div>)
            : 'Click to expand'}
        </span>
      ) : (
        <span className="diagnostics-table-feature">—</span>
      )}
    </td>
  </tr>
);

const COLUMN_COUNT = 12;

export const CapabilityChecksTable: React.FC<CapabilityChecksTableProps> = ({
  currentRows,
  previousRows,
  summary,
}) => {
  // Track which rows have their descriptor/feature columns collapsed (expanded by default).
  const [collapsedRows, setCollapsedRows] = useState<Set<string>>(new Set());

  const toggleRowExpanded = useCallback((key: string) => {
    setCollapsedRows((prev) => {
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
                      isCollapsed={collapsedRows.has(row.key)}
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
                      isCollapsed={collapsedRows.has(row.key)}
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
