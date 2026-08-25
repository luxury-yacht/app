/**
 * frontend/src/core/refresh/components/diagnostics/TableConnections.tsx
 *
 * Connections & Calls: the transport itself, plus every read that belongs to no
 * refresh domain.
 *
 * This view is deliberately FLAT. A socket, an event scope, a container-logs
 * target and an app-state read share no parent, so nesting them would invent a
 * hierarchy that does not exist. Anything that does have a domain parent lives
 * in the Cluster Data tree instead.
 *
 * The two tables live in SEPARATE sections. A section is a flex column whose
 * table wrapper claims the remaining height (`flex: 1 1 auto` with
 * `min-height: 0`), so putting a second wrapper in one section makes flex split
 * that height and clip the first table mid-row.
 */

import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import {
  isTableNoValueText,
  TABLE_NO_VALUE_TEXT,
  TableCellValue,
} from '@shared/components/tables/tableNoValue';
import type React from 'react';
import { useDeferredValue, useMemo, useState } from 'react';

import type { BrokerReadRow, ConnectionsRow } from './diagnosticsPanelTypes';
import { formatLastUpdated } from './diagnosticsPanelUtils';

const LEAF_KIND_LABELS: Record<'scope' | 'target', string> = {
  scope: 'event scope',
  target: 'log target',
};

type BrokerFilter = 'all' | 'Cluster Data' | 'App State';

const LastErrorCell: React.FC<{ value: string; at?: number }> = ({ value, at }) => {
  const hasError = Boolean(value) && !isTableNoValueText(value);
  if (!hasError) {
    return (
      <td>
        <TableCellValue>{value}</TableCellValue>
      </td>
    );
  }
  const age = at ? formatLastUpdated(at) : null;
  return (
    <td className="diagnostics-error-warning" title={age?.tooltip}>
      <ErrorSurface kind="status" message={value} />
      {age ? (
        <span className="diagnostics-error-age">
          <ErrorSurface kind="status" message={` · ${age.display}`} />
        </span>
      ) : null}
    </td>
  );
};

const ConnectionRow: React.FC<{ row: ConnectionsRow }> = ({ row }) => {
  if (row.kind === 'socket') {
    return (
      <tr className="diagnostics-stream-row">
        <td className="diagnostics-stream-name" title={row.rowKey}>
          <span className="diagnostics-domain">{row.label}</span>
          <span className="diagnostics-table-secondary"> · socket</span>
        </td>
        <td>
          <TableCellValue>{row.cluster}</TableCellValue>
        </td>
        <td>{row.sessions}</td>
        <td title={row.lastConnectTooltip}>
          <TableCellValue>{row.lastConnect}</TableCellValue>
        </td>
        <td>{row.delivered}</td>
        <td>{row.dropped}</td>
        <td>{row.errors}</td>
        <td title={row.lastEventTooltip}>
          <TableCellValue>{row.lastEvent}</TableCellValue>
        </td>
        <LastErrorCell value={row.lastError} at={row.lastErrorAt} />
      </tr>
    );
  }
  return (
    <tr className="diagnostics-connection-leaf-row">
      <td className="diagnostics-connection-leaf-name" title={row.rowKey}>
        <span>{row.leaf}</span>
        <span className="diagnostics-table-secondary">{` · ${LEAF_KIND_LABELS[row.leafKind]}`}</span>
      </td>
      <td>
        <TableCellValue>{row.cluster}</TableCellValue>
      </td>
      <td>
        <TableCellValue>{TABLE_NO_VALUE_TEXT}</TableCellValue>
      </td>
      <td>
        <TableCellValue>{TABLE_NO_VALUE_TEXT}</TableCellValue>
      </td>
      <td>{row.delivered}</td>
      <td>{row.dropped}</td>
      <td>{row.errors}</td>
      <td title={row.lastEventTooltip}>
        <TableCellValue>{row.lastEvent}</TableCellValue>
      </td>
      <LastErrorCell value={row.lastError} at={row.lastErrorAt} />
    </tr>
  );
};

interface ConnectionsTableProps {
  rows: ConnectionsRow[];
  callRows: BrokerReadRow[];
  summary: string;
  callsSummary: string;
}

export const ConnectionsTable: React.FC<ConnectionsTableProps> = ({
  rows,
  callRows,
  summary,
  callsSummary,
}) => {
  const [brokerFilter, setBrokerFilter] = useState<BrokerFilter>('all');
  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const filteredCallRows = useMemo(() => {
    return callRows.filter((row) => {
      if (brokerFilter !== 'all' && row.broker !== brokerFilter) {
        return false;
      }
      if (
        showIssuesOnly &&
        row.inFlightCount <= 0 &&
        row.blockedCount <= 0 &&
        row.errorCount <= 0
      ) {
        return false;
      }
      if (!deferredQuery) {
        return true;
      }
      return [
        row.broker,
        row.label,
        row.resource,
        row.scope,
        row.adapter,
        row.reason,
        row.lastStatus,
        row.lastError,
      ]
        .join(' ')
        .toLowerCase()
        .includes(deferredQuery);
    });
  }, [brokerFilter, callRows, deferredQuery, showIssuesOnly]);

  return (
    <>
      {/* Sizes to its own content so the reads table below keeps the remainder
          of the panel height. */}
      <div className="diagnostics-section diagnostics-section--content-height">
        <div className="diagnostics-section-header">
          <div className="diagnostics-section-title-group">
            <span className="diagnostics-section-subtitle">{summary}</span>
          </div>
        </div>
        <div className="diagnostics-table-wrapper">
          <table className="diagnostics-table">
            <thead>
              <tr>
                <th>Connection</th>
                <th>Cluster</th>
                <th>Sessions</th>
                <th>Last Connect</th>
                <th>Delivered</th>
                <th>Dropped</th>
                <th>Errors</th>
                <th>Last Event</th>
                <th>Last Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr className="diagnostics-empty">
                  <td colSpan={9}>No stream connections recorded yet.</td>
                </tr>
              ) : (
                rows.map((row) => <ConnectionRow key={row.rowKey} row={row} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="diagnostics-section">
        <div className="diagnostics-section-header">
          <div className="diagnostics-section-title-group">
            <span className="diagnostics-section-subtitle">
              {filteredCallRows.length === callRows.length
                ? callsSummary
                : `${callsSummary} • Showing: ${filteredCallRows.length}/${callRows.length}`}
            </span>
          </div>
          <div className="diagnostics-section-actions">
            <label className="diagnostics-section-filter">
              <span className="diagnostics-section-filter-label">Filter</span>
              <input
                data-diagnostics-focusable="true"
                className="diagnostics-section-input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter reads"
              />
            </label>
            <label className="diagnostics-section-filter">
              <span className="diagnostics-section-filter-label">Broker</span>
              <select
                data-diagnostics-focusable="true"
                className="diagnostics-section-select"
                value={brokerFilter}
                onChange={(event) => setBrokerFilter(event.target.value as BrokerFilter)}
              >
                <option value="all">All</option>
                <option value="Cluster Data">Cluster Data</option>
                <option value="App State">App State</option>
              </select>
            </label>
            <button
              data-diagnostics-focusable="true"
              type="button"
              className={`diagnostics-section-toggle${showIssuesOnly ? ' diagnostics-section-toggle--active' : ''}`}
              onClick={() => setShowIssuesOnly((previous) => !previous)}
            >
              {showIssuesOnly ? 'Showing Issues' : 'Issues Only'}
            </button>
          </div>
        </div>
        <div className="diagnostics-table-wrapper">
          <table className="diagnostics-table">
            <thead>
              <tr>
                <th>Broker</th>
                <th>Read</th>
                <th>Scope</th>
                <th>Adapter</th>
                <th>Reason</th>
                <th>In Flight</th>
                <th>Total</th>
                <th>Success</th>
                <th>Blocked</th>
                <th>Error</th>
                <th>Last Result</th>
                <th>Duration</th>
                <th>Updated</th>
                <th>Error / Block</th>
              </tr>
            </thead>
            <tbody>
              {callRows.length === 0 && (
                <tr className="diagnostics-empty">
                  <td colSpan={14}>No non-domain reads recorded yet.</td>
                </tr>
              )}
              {callRows.length > 0 && filteredCallRows.length === 0 && (
                <tr className="diagnostics-empty">
                  <td colSpan={14}>No reads match the current filters.</td>
                </tr>
              )}
              {filteredCallRows.length > 0 &&
                filteredCallRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.broker}</td>
                    <td>
                      <div className="diagnostics-table-stack">
                        <span className="diagnostics-domain">{row.label}</span>
                        <span className="diagnostics-table-secondary">{row.resource}</span>
                      </div>
                    </td>
                    <td title={row.scopeTooltip}>
                      <TableCellValue>{row.scope}</TableCellValue>
                    </td>
                    <td>
                      <TableCellValue>{row.adapter}</TableCellValue>
                    </td>
                    <td>
                      <TableCellValue>{row.reason}</TableCellValue>
                    </td>
                    <td>{row.inFlightCount}</td>
                    <td>{row.totalRequests}</td>
                    <td>{row.successCount}</td>
                    <td>{row.blockedCount}</td>
                    <td>{row.errorCount}</td>
                    <td>
                      <TableCellValue>{row.lastStatus}</TableCellValue>
                    </td>
                    <td>
                      <TableCellValue>{row.lastDuration}</TableCellValue>
                    </td>
                    <td title={row.lastUpdatedTooltip}>
                      <TableCellValue>{row.lastUpdated}</TableCellValue>
                    </td>
                    <td className="diagnostics-error">
                      {row.lastError && !isTableNoValueText(row.lastError) ? (
                        <ErrorSurface kind="status" message={row.lastError} />
                      ) : (
                        <TableCellValue>{TABLE_NO_VALUE_TEXT}</TableCellValue>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};
