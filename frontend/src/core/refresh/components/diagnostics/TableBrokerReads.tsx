import React, { useDeferredValue, useMemo, useState } from 'react';

import type { BrokerReadRow } from './diagnosticsPanelTypes';

interface BrokerReadsTableProps {
  rows: BrokerReadRow[];
  summary: string;
}

type BrokerFilter = 'all' | 'Cluster Data' | 'App State';

export const BrokerReadsTable: React.FC<BrokerReadsTableProps> = ({ rows, summary }) => {
  const [brokerFilter, setBrokerFilter] = useState<BrokerFilter>('all');
  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
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
      const haystack = [
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
        .toLowerCase();
      return haystack.includes(deferredQuery);
    });
  }, [brokerFilter, deferredQuery, rows, showIssuesOnly]);

  const filteredSummary =
    filteredRows.length === rows.length
      ? summary
      : `${summary} • Showing: ${filteredRows.length}/${rows.length}`;

  return (
    <div className="diagnostics-section">
      <div className="diagnostics-section-header">
        <div className="diagnostics-section-title-group">
          <span className="diagnostics-section-subtitle">{filteredSummary}</span>
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
            {rows.length === 0 ? (
              <tr className="diagnostics-empty">
                <td colSpan={14}>No brokered reads recorded yet.</td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr className="diagnostics-empty">
                <td colSpan={14}>No brokered reads match the current filters.</td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={row.key}>
                  <td>{row.broker}</td>
                  <td>
                    <div className="diagnostics-table-stack">
                      <span className="diagnostics-domain">{row.label}</span>
                      <span className="diagnostics-table-secondary">{row.resource}</span>
                    </div>
                  </td>
                  <td title={row.scopeTooltip}>{row.scope}</td>
                  <td>{row.adapter}</td>
                  <td>{row.reason}</td>
                  <td>{row.inFlightCount}</td>
                  <td>{row.totalRequests}</td>
                  <td>{row.successCount}</td>
                  <td>{row.blockedCount}</td>
                  <td>{row.errorCount}</td>
                  <td>{row.lastStatus}</td>
                  <td>{row.lastDuration}</td>
                  <td title={row.lastUpdatedTooltip}>{row.lastUpdated}</td>
                  <td className="diagnostics-error">{row.lastError}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
