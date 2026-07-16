/**
 * frontend/src/core/refresh/components/diagnostics/TableKubernetesAPIClients.tsx
 *
 * Renders Kubernetes API client usage in the diagnostics panel.
 */

import { TableCellValue } from '@shared/components/tables/tableNoValue';
import type React from 'react';
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
                  <td>
                    <TableCellValue>{row.configured}</TableCellValue>
                  </td>
                  <td>
                    <TableCellValue>{row.qps1s}</TableCellValue>
                  </td>
                  <td>
                    <TableCellValue>{row.qps10s}</TableCellValue>
                  </td>
                  <td>
                    <TableCellValue>{row.qps60s}</TableCellValue>
                  </td>
                  <td>
                    <TableCellValue>{row.peakQPS1s}</TableCellValue>
                  </td>
                  <td>
                    <TableCellValue>{row.totalRequests}</TableCellValue>
                  </td>
                  <td>
                    <TableCellValue>{row.status429}</TableCellValue>
                  </td>
                  <td>
                    <TableCellValue>{row.status5xx}</TableCellValue>
                  </td>
                  <td>
                    <TableCellValue>{row.errors}</TableCellValue>
                  </td>
                  <td title={row.lastRequestTooltip}>
                    <TableCellValue>{row.lastRequest}</TableCellValue>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
