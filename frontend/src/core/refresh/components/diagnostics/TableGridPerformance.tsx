import React from 'react';
import type { GridTablePerformanceEntry } from '@shared/components/tables/performance/gridTablePerformanceStore';

interface TableGridPerformanceProps {
  rows: GridTablePerformanceEntry[];
  emptyMessage?: string;
  summary: string;
}

const formatTiming = (samples: number, averageMs: number, maxMs: number, latestMs: number) =>
  samples > 0 ? `${averageMs.toFixed(2)} / ${maxMs.toFixed(2)} / ${latestMs.toFixed(2)}` : '—';

export const TableGridPerformance: React.FC<TableGridPerformanceProps> = ({
  rows,
  emptyMessage,
  summary,
}) => {
  const resolvedEmptyMessage =
    emptyMessage || 'No instrumented GridTable performance diagnostics have been recorded yet.';

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
              <th>Table</th>
              <th>Input</th>
              <th>Capped</th>
              <th>Displayed</th>
              <th>Updates</th>
              <th>Ref Changes</th>
              <th>Filter Options Avg / Max / Latest (ms)</th>
              <th>Filter Pass Avg / Max / Latest (ms)</th>
              <th>Sort Avg / Max / Latest (ms)</th>
              <th>Render Avg / Max / Latest (ms)</th>
              <th>Last Render</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="diagnostics-empty">
                <td colSpan={11}>{resolvedEmptyMessage}</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.label}>
                  <td>
                    <span className="diagnostics-domain">{row.label}</span>
                  </td>
                  <td>{row.inputRows}</td>
                  <td>{row.sourceRows}</td>
                  <td>{row.displayedRows}</td>
                  <td>{row.updates}</td>
                  <td>{row.inputReferenceChanges}</td>
                  <td>
                    {formatTiming(
                      row.filterOptions.samples,
                      row.filterOptions.averageMs,
                      row.filterOptions.maxMs,
                      row.filterOptions.latestMs
                    )}
                  </td>
                  <td>
                    {formatTiming(
                      row.filterPass.samples,
                      row.filterPass.averageMs,
                      row.filterPass.maxMs,
                      row.filterPass.latestMs
                    )}
                  </td>
                  <td>
                    {formatTiming(
                      row.sort.samples,
                      row.sort.averageMs,
                      row.sort.maxMs,
                      row.sort.latestMs
                    )}
                  </td>
                  <td>
                    {formatTiming(
                      row.render.samples,
                      row.render.averageMs,
                      row.render.maxMs,
                      row.render.latestMs
                    )}
                  </td>
                  <td>{row.lastRenderPhase ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
