/**
 * frontend/src/core/refresh/components/diagnostics/TableClusterData.tsx
 *
 * The Cluster Data tree: cluster -> [domain] -> scope.
 *
 * Eight columns, chosen so a reader can answer "is this working, how is it fed,
 * and how fresh is it" without scrolling sideways. A domain with one scope is
 * ONE row. Everything the columns leave out is one click away in the row's
 * expander rather than permanently on screen.
 *
 * The row model pre-formats every cell; this component only renders.
 */

import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { TABLE_NO_VALUE_TEXT, TableCellValue } from '@shared/components/tables/tableNoValue';
import type React from 'react';
import { useCallback, useState } from 'react';

import type {
  ClusterDataClusterRow,
  ClusterDataDomainRow,
  ClusterDataRow,
  ClusterDataScopeRow,
  ClusterDataTreeNode,
} from './diagnosticsPanelTypes';

const COLUMN_COUNT = 8;

// TreeGuides draws the connection lines from the row's own structure. Each
// guide is a real box of fixed width, so the depth of a row and the position of
// its rule are the same measurement — there is no indent arithmetic to get
// wrong, and a child can never appear to hang left of its parent.
const TreeGuides: React.FC<{ node: ClusterDataTreeNode; descender?: boolean }> = ({
  node,
  descender = false,
}) => (
  <span className="diagnostics-tree-guides" aria-hidden="true">
    {node.guides.map((guide, index) => (
      <span
        // Guides are positional by nature; index IS the identity here.
        // biome-ignore lint/suspicious/noArrayIndexKey: positional by definition
        key={index}
        className={`diagnostics-tree-guide diagnostics-tree-guide--${guide}`}
      />
    ))}
    <span className={`diagnostics-tree-guide diagnostics-tree-guide--${node.connector}`} />
    {/* A row with children continues the line downward into them, forming the
        arriving-horizontal-plus-stem junction. It occupies a full guide slot so
        its stem lands exactly on the children's own vertical. */}
    {descender ? (
      <span className="diagnostics-tree-guide diagnostics-tree-guide--descender" />
    ) : null}
  </span>
);

// Slots the first column reserves before its label: one per guide, one for the
// connector, and one more for a descender or an expander. Deriving the padding
// from this count is what keeps every label on the same x.
const slotCount = (node: ClusterDataTreeNode, descender: boolean): number =>
  node.guides.length + 1 + (descender ? 1 : 0);

const ClusterGroupRow: React.FC<{ row: ClusterDataClusterRow }> = ({ row }) => (
  <tr className="diagnostics-cluster-row">
    <td className="diagnostics-cluster-name" colSpan={COLUMN_COUNT}>
      <span className="diagnostics-cluster-label">{row.clusterName}</span>
      <span className="diagnostics-cluster-summary">{row.summary}</span>
      {row.issueSummary ? <span className="diagnostics-count-flag">{row.issueSummary}</span> : null}
    </td>
  </tr>
);

const DomainGroupRow: React.FC<{ row: ClusterDataDomainRow }> = ({ row }) => (
  <tr className="diagnostics-domain-row">
    <td
      className="diagnostics-domain-name"
      colSpan={COLUMN_COUNT}
      style={{ '--diagnostics-slots': slotCount(row, true) } as React.CSSProperties}
    >
      <TreeGuides node={row} descender />
      <span className="diagnostics-domain">{row.label}</span>
      <span className="diagnostics-table-secondary" title={row.summaryTooltip}>
        {` · ${row.summary}`}
      </span>
    </td>
  </tr>
);

const ScopeRow: React.FC<{
  row: ClusterDataScopeRow;
  expanded: boolean;
  onToggle: (rowKey: string) => void;
}> = ({ row, expanded, onToggle }) => (
  <>
    <tr className="diagnostics-scope-row">
      <td
        className="diagnostics-scope-name"
        style={{ '--diagnostics-slots': slotCount(row, false) } as React.CSSProperties}
      >
        <TreeGuides node={row} />
        <button
          type="button"
          className="diagnostics-row-expander"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} details for ${row.domainLabel || row.domain}`}
          onClick={() => onToggle(row.rowKey)}
        >
          {expanded ? '▼' : '▶'}
        </button>
        {/* A grouped row leaves this empty on purpose: the domain group row
            directly above already names the domain, and repeating it is what
            made the first version hard to scan. */}
        <span className="diagnostics-domain" title={row.rowKey}>
          {row.domainLabel}
        </span>
      </td>
      {/* Scope truncates, so the full value must always be in the title. */}
      <td title={row.scopeTooltip ?? row.scope}>
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
      <td title={row.health.tooltip}>
        <span className={`diagnostics-health diagnostics-health--${row.health.tone}`}>
          {row.health.label}
        </span>
      </td>
      <td title={row.feedTooltip}>
        <TableCellValue>{row.feed}</TableCellValue>
      </td>
      <td className={row.countClassName} title={row.countTooltip ?? ''}>
        <TableCellValue>{row.count}</TableCellValue>
      </td>
      <td title={row.updatedTooltip}>
        <TableCellValue>{row.updated}</TableCellValue>
      </td>
      <td title={row.activityTooltip}>
        <TableCellValue>{row.activity}</TableCellValue>
      </td>
      <td className="diagnostics-error" title={row.error}>
        {/* TableCellValue only recognises a no-value STRING, so wrapping an
            ErrorSurface in it never dims anything. Branch explicitly: a real
            error gets the reporting surface, absence gets the placeholder. */}
        {row.error ? (
          <ErrorSurface kind="status" message={row.error} />
        ) : (
          <TableCellValue>{TABLE_NO_VALUE_TEXT}</TableCellValue>
        )}
      </td>
    </tr>
    {expanded ? (
      <tr className="diagnostics-detail-row">
        <td colSpan={COLUMN_COUNT}>
          <dl className="diagnostics-detail-grid">
            {row.details.map((item) => (
              <div key={item.label} className="diagnostics-detail-item" title={item.tooltip ?? ''}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </td>
      </tr>
    ) : null}
  </>
);

interface ClusterDataTableProps {
  rows: ClusterDataRow[];
  summary: string;
}

export const ClusterDataTable: React.FC<ClusterDataTableProps> = ({ rows, summary }) => {
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((rowKey: string) => {
    setExpandedKeys((previous) => {
      const next = new Set(previous);
      if (!next.delete(rowKey)) {
        next.add(rowKey);
      }
      return next;
    });
  }, []);

  return (
    <div className="diagnostics-section">
      <div className="diagnostics-section-header">
        <div className="diagnostics-section-title-group">
          <span className="diagnostics-section-subtitle">{summary}</span>
        </div>
      </div>
      <div className="diagnostics-table-wrapper">
        <table className="diagnostics-table diagnostics-table--cluster-data">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Scope</th>
              <th>Health</th>
              <th>Feed</th>
              <th>Count</th>
              <th>Updated</th>
              <th>Activity</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="diagnostics-empty">
                <td colSpan={COLUMN_COUNT}>
                  All refreshers are idle. Enable "Show idle" to view the full list.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                if (row.kind === 'cluster') {
                  return <ClusterGroupRow key={row.rowKey} row={row} />;
                }
                if (row.kind === 'domain') {
                  return <DomainGroupRow key={row.rowKey} row={row} />;
                }
                return (
                  <ScopeRow
                    key={row.rowKey}
                    row={row}
                    expanded={expandedKeys.has(row.rowKey)}
                    onToggle={toggle}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
