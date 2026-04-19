import React, { useMemo, useState } from 'react';
import type { GridTablePerformanceEntry } from '@shared/components/tables/performance/gridTablePerformanceStore';
import {
  buildGridTableReferenceChurnSignal,
  getGridTableModeLabel,
  getGridTableModeTitle,
  getGridTableRowCountTitle,
  type GridTablePerformanceSignal,
} from '@shared/components/tables/performance/gridTableDiagnosticsMode';

interface GridTablePerformanceProps {
  rows: GridTablePerformanceEntry[];
  emptyMessage?: string;
  onReset?: () => void;
  summary: string;
}

type TablePerformanceOverview = {
  instrumentedTables: number;
  flaggedTables: number;
  worstOffenderLabel: string | null;
  worstOffenderSignals: number;
};

type DominantTimingMetric = {
  label: string;
  title: string;
};

const TimingHeader: React.FC<{ label: string }> = ({ label }) => (
  <span className="diagnostics-table-heading-metric">
    <span>{label} (ms)</span>
    <span>Avg / Max / Latest</span>
  </span>
);

const formatTiming = (samples: number, averageMs: number, maxMs: number, latestMs: number) =>
  samples > 0 ? `${averageMs.toFixed(2)} / ${maxMs.toFixed(2)} / ${latestMs.toFixed(2)}` : '—';

const formatPercent = (value: number) => `${(value * 100).toFixed(0)}%`;

const formatReferenceChurn = (inputReferenceChanges: number, updates: number) => {
  if (updates <= 0) {
    return '—';
  }

  return `${inputReferenceChanges} (${formatPercent(inputReferenceChanges / updates)})`;
};

const isTimingSignal = (averageMs: number, maxMs: number, averageThresholdMs: number) =>
  averageMs >= averageThresholdMs || maxMs >= averageThresholdMs * 2;

const getWarningSignals = (signals: GridTablePerformanceSignal[]) =>
  signals.filter((signal) => signal.severity === 'warning');

const getWarningSignalCount = (row: GridTablePerformanceEntry) =>
  getWarningSignals(buildTablePerformanceSignals(row)).length;

export const buildTablePerformanceSignals = (
  row: GridTablePerformanceEntry
): GridTablePerformanceSignal[] => {
  const signals: GridTablePerformanceSignal[] = [];

  const churnSignal = buildGridTableReferenceChurnSignal(row);
  if (churnSignal) {
    signals.push(churnSignal);
  }

  if (
    row.filterOptions.samples > 0 &&
    isTimingSignal(row.filterOptions.averageMs, row.filterOptions.maxMs, 4)
  ) {
    signals.push({
      label: 'Filter options slow',
      severity: 'warning',
      title: `Filter option derivation averages ${row.filterOptions.averageMs.toFixed(2)}ms and peaked at ${row.filterOptions.maxMs.toFixed(2)}ms.`,
    });
  }

  if (
    row.filterPass.samples > 0 &&
    isTimingSignal(row.filterPass.averageMs, row.filterPass.maxMs, 6)
  ) {
    signals.push({
      label: 'Filter pass slow',
      severity: 'warning',
      title: `Filter pass averages ${row.filterPass.averageMs.toFixed(2)}ms and peaked at ${row.filterPass.maxMs.toFixed(2)}ms.`,
    });
  }

  if (row.sort.samples > 0 && isTimingSignal(row.sort.averageMs, row.sort.maxMs, 6)) {
    signals.push({
      label: 'Sort slow',
      severity: 'warning',
      title: `Sort averages ${row.sort.averageMs.toFixed(2)}ms and peaked at ${row.sort.maxMs.toFixed(2)}ms.`,
    });
  }

  if (row.render.samples > 0 && isTimingSignal(row.render.averageMs, row.render.maxMs, 8)) {
    signals.push({
      label: 'Render slow',
      severity: 'warning',
      title: `Render averages ${row.render.averageMs.toFixed(2)}ms and peaked at ${row.render.maxMs.toFixed(2)}ms.`,
    });
  }

  return signals;
};

const sortRowsBySeverity = (rows: GridTablePerformanceEntry[]) =>
  [...rows].sort((a, b) => {
    const aSignals = buildTablePerformanceSignals(a);
    const bSignals = buildTablePerformanceSignals(b);
    const aWarningCount = getWarningSignals(aSignals).length;
    const bWarningCount = getWarningSignals(bSignals).length;
    if (bWarningCount !== aWarningCount) {
      return bWarningCount - aWarningCount;
    }
    if (bSignals.length !== aSignals.length) {
      return bSignals.length - aSignals.length;
    }
    if (b.inputRows !== a.inputRows) {
      return b.inputRows - a.inputRows;
    }
    return a.label.localeCompare(b.label);
  });

export const buildTablePerformanceOverview = (
  rows: GridTablePerformanceEntry[]
): TablePerformanceOverview => {
  const sortedRows = sortRowsBySeverity(rows);
  const flaggedTables = rows.filter((row) => getWarningSignalCount(row) > 0).length;
  const worstRow = sortedRows.find((row) => getWarningSignalCount(row) > 0) ?? null;
  const worstSignals = worstRow ? getWarningSignals(buildTablePerformanceSignals(worstRow)) : [];

  return {
    instrumentedTables: rows.length,
    flaggedTables,
    worstOffenderLabel: worstSignals.length > 0 ? (worstRow?.label ?? null) : null,
    worstOffenderSignals: worstSignals.length,
  };
};

export const buildDominantTimingMetric = (
  row: GridTablePerformanceEntry
): DominantTimingMetric | null => {
  const metrics = [
    {
      key: 'filterOptions',
      label: 'Filter options',
      stats: row.filterOptions,
    },
    {
      key: 'filterPass',
      label: 'Filter pass',
      stats: row.filterPass,
    },
    {
      key: 'sort',
      label: 'Sort',
      stats: row.sort,
    },
    {
      key: 'render',
      label: 'Render',
      stats: row.render,
    },
  ].filter((metric) => metric.stats.samples > 0);

  if (metrics.length === 0) {
    return null;
  }

  const dominant = metrics.reduce((current, candidate) =>
    candidate.stats.averageMs > current.stats.averageMs ? candidate : current
  );

  return {
    label: `${dominant.label} (${dominant.stats.averageMs.toFixed(2)}ms avg)`,
    title: `${dominant.label} is the heaviest measured stage for this table. Average ${dominant.stats.averageMs.toFixed(2)}ms, max ${dominant.stats.maxMs.toFixed(2)}ms, latest ${dominant.stats.latestMs.toFixed(2)}ms.`,
  };
};

export const GridTablePerformance: React.FC<GridTablePerformanceProps> = ({
  rows,
  emptyMessage,
  onReset,
  summary: _summary,
}) => {
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const resolvedEmptyMessage =
    emptyMessage || 'No instrumented GridTable performance diagnostics have been recorded yet.';
  const sortedRows = sortRowsBySeverity(rows);
  const overview = buildTablePerformanceOverview(rows);
  const visibleRows = useMemo(
    () =>
      showFlaggedOnly ? sortedRows.filter((row) => getWarningSignalCount(row) > 0) : sortedRows,
    [showFlaggedOnly, sortedRows]
  );
  const visibleEmptyMessage = showFlaggedOnly
    ? 'No warning-level table signals in the current sample set.'
    : resolvedEmptyMessage;

  return (
    <div className="diagnostics-section">
      <div className="diagnostics-section-header">
        <div className="diagnostics-table-performance-summary">
          <div className="diagnostics-table-performance-summary-item">
            <span className="diagnostics-table-performance-summary-label">Flagged:</span>
            <span className="diagnostics-table-performance-summary-value">
              {overview.flaggedTables}
            </span>
          </div>
          <div className="diagnostics-table-performance-summary-item">
            <span className="diagnostics-table-performance-summary-label">Worst Offender:</span>
            <span className="diagnostics-table-performance-summary-value">
              {overview.worstOffenderLabel ?? 'None'}
            </span>
          </div>
          {onReset ? (
            <div className="diagnostics-section-actions">
              <button
                className="diagnostics-section-toggle"
                onClick={() => setShowFlaggedOnly((current) => !current)}
                type="button"
              >
                {showFlaggedOnly ? 'Show All Tables' : 'Show Flagged Only'}
              </button>
              <button className="diagnostics-section-toggle" onClick={onReset} type="button">
                Reset Samples
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="diagnostics-table-wrapper">
        <table className="diagnostics-table">
          <thead>
            <tr>
              <th>Table</th>
              <th>Mode</th>
              <th>Input</th>
              <th>Capped</th>
              <th>Displayed</th>
              <th>Updates</th>
              <th>Ref Changes</th>
              <th>Dominant Cost</th>
              <th>Signals</th>
              <th>
                <TimingHeader label="Filter Options" />
              </th>
              <th>
                <TimingHeader label="Filter Pass" />
              </th>
              <th>
                <TimingHeader label="Sort" />
              </th>
              <th>
                <TimingHeader label="Render" />
              </th>
              <th>Last Render</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr className="diagnostics-empty">
                <td colSpan={14}>{visibleEmptyMessage}</td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const signals = buildTablePerformanceSignals(row);
                const signalsTitle = signals.map((signal) => signal.title).join('\n');
                const dominantTiming = buildDominantTimingMetric(row);

                return (
                  <tr key={row.label}>
                    <td>
                      <span className="diagnostics-domain">{row.label}</span>
                    </td>
                    <td title={getGridTableModeTitle(row.mode)}>
                      <span
                        className={`diagnostics-table-mode diagnostics-table-mode--${row.mode}`}
                      >
                        {getGridTableModeLabel(row.mode)}
                      </span>
                    </td>
                    <td title={getGridTableRowCountTitle(row.mode, 'input')}>{row.inputRows}</td>
                    <td title={getGridTableRowCountTitle(row.mode, 'source')}>{row.sourceRows}</td>
                    <td title={getGridTableRowCountTitle(row.mode, 'displayed')}>
                      {row.displayedRows}
                    </td>
                    <td>{row.updates}</td>
                    <td
                      className={
                        signals.some(
                          (signal) =>
                            signal.severity === 'warning' && signal.label === 'Broad replacement'
                        )
                          ? 'diagnostics-count-warning'
                          : undefined
                      }
                      title={
                        row.updates > 0
                          ? `Input rows changed reference on ${row.inputReferenceChanges} of ${row.updates} updates.`
                          : undefined
                      }
                    >
                      {formatReferenceChurn(row.inputReferenceChanges, row.updates)}
                    </td>
                    <td title={dominantTiming?.title ?? undefined}>
                      {dominantTiming?.label ?? '—'}
                    </td>
                    <td
                      className="diagnostics-table-performance-signals"
                      title={signalsTitle || undefined}
                    >
                      {signals.length > 0
                        ? signals.map((signal) => (
                            <span
                              key={signal.label}
                              className={`diagnostics-table-performance-signal diagnostics-table-performance-signal--${signal.severity}`}
                            >
                              {signal.label}
                            </span>
                          ))
                        : '—'}
                    </td>
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
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
