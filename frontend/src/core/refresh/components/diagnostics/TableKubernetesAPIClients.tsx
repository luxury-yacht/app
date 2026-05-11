/**
 * frontend/src/core/refresh/components/diagnostics/TableKubernetesAPIClients.tsx
 *
 * Renders Kubernetes API client usage in the diagnostics panel.
 */

import React from 'react';
import type { KubernetesAPIClientRow } from './diagnosticsPanelTypes';

interface KubernetesAPIClientsTableProps {
  rows: KubernetesAPIClientRow[];
  summary: string;
}

export const KubernetesAPIClientsTable: React.FC<KubernetesAPIClientsTableProps> = ({
  rows,
  summary,
}) => {
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
              <th>Cluster</th>
              <th>QPS / Burst</th>
              <th>1s QPS</th>
              <th>10s QPS</th>
              <th>60s QPS</th>
              <th>Peak 1s</th>
              <th>Requests</th>
              <th>429s</th>
              <th>5xx</th>
              <th>Errors</th>
              <th>Last Request</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="diagnostics-empty">
                <td colSpan={11}>Kubernetes API client telemetry is not available yet.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <span className="diagnostics-domain" title={row.clusterTooltip}>
                      {row.cluster}
                    </span>
                  </td>
                  <td>{row.configured}</td>
                  <td>{row.qps1s}</td>
                  <td>{row.qps10s}</td>
                  <td>{row.qps60s}</td>
                  <td>{row.peakQPS1s}</td>
                  <td>{row.totalRequests}</td>
                  <td>{row.status429}</td>
                  <td>{row.status5xx}</td>
                  <td>{row.errors}</td>
                  <td title={row.lastRequestTooltip}>{row.lastRequest}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
