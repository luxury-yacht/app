import React from 'react';

import type { BrokerReadRow } from './diagnosticsPanelTypes';

interface BrokerReadsTableProps {
  rows: BrokerReadRow[];
  summary: string;
}

export const BrokerReadsTable: React.FC<BrokerReadsTableProps> = ({ rows, summary }) => {
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
              <th>Broker</th>
              <th>Resource</th>
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
                <td colSpan={13}>No brokered reads recorded yet.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.broker}</td>
                  <td>
                    <span className="diagnostics-domain">{row.resource}</span>
                  </td>
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
