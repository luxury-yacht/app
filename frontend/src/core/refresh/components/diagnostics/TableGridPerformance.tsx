import React, { useMemo, useState } from 'react';
import type { GridTablePerformanceEntry } from '@shared/components/tables/performance/gridTablePerformanceStore';

interface TableGridPerformanceProps {
  rows: GridTablePerformanceEntry[];
  emptyMessage?: string;
  onReset?: () => void;
  summary: string;
}

type TablePerformanceSignal = {
  label: string;
  title: string;
  severity: 'warning' | 'info';
};

const MODE_LABELS: Record<GridTablePerformanceEntry['mode'], string> = {
  local: 'Local',
  query: 'Query',
  live: 'Live',
};

const MODE_TITLES: Record<GridTablePerformanceEntry['mode'], string> = {
  local: 'Local table behavior: search/filter/sort run over the loaded row set.',
  query:
    'Query-backed table behavior: search and/or filtering narrow the upstream dataset before it reaches the table.',
  live: 'Live table behavior: rows are expected to update frequently because key fields are time-varying or stream-driven.',
};

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

type RowCountKind = 'input' | 'source' | 'displayed';

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

const getWarningSignals = (signals: TablePerformanceSignal[]) =>
  signals.filter((signal) => signal.severity === 'warning');

const getWarningSignalCount = (row: GridTablePerformanceEntry) =>
  getWarningSignals(buildTablePerformanceSignals(row)).length;

const buildReferenceChurnSignal = (
  row: GridTablePerformanceEntry,
  replacementRatio: number
): TablePerformanceSignal | null => {
  if (row.mode === 'live') {
    if (replacementRatio < 0.8) {
      return null;
    }

    return {
      label: 'Live churn',
      severity: 'info',
      title: `Input rows were replaced on ${row.inputReferenceChanges} of ${row.updates} updates (${formatPercent(replacementRatio)}). Live tables are expected to churn; prioritize sort and render warnings before treating this as a feed bug.`,
    };
  }

  if (replacementRatio < 0.8) {
    return null;
  }

  if (row.mode === 'query') {
    return {
      label: 'Broad replacement',
      severity: 'warning',
      title: `Input rows were replaced on ${row.inputReferenceChanges} of ${row.updates} updates (${formatPercent(replacementRatio)}). Query-backed tables replace input rows when upstream query results change, so this is only suspicious when the query itself is stable.`,
    };
  }

  return {
    label: 'Broad replacement',
    severity: 'warning',
    title: `Input rows were replaced on ${row.inputReferenceChanges} of ${row.updates} updates (${formatPercent(replacementRatio)}). Local tables should usually reuse the input array when the effective row set is unchanged.`,
  };
};

const buildRowCountTitle = (row: GridTablePerformanceEntry, kind: RowCountKind) => {
  if (row.mode === 'query') {
    if (kind === 'input') {
      return 'Query-backed table: Input is the upstream query result size before the shared cap is applied.';
    }
    if (kind === 'source') {
      return 'Query-backed table: Capped is the query result size after the shared max-row cap is applied.';
    }
    return 'Query-backed table: Displayed is the post-cap row count after any remaining local filters run in GridTable.';
  }

  if (row.mode === 'live') {
    if (kind === 'input') {
      return 'Live table: Input is the incoming row count before the shared cap is applied. Frequent updates are expected.';
    }
    if (kind === 'source') {
      return 'Live table: Capped is the post-cap row count that GridTable works over before local filtering.';
    }
    return 'Live table: Displayed is the post-cap row count after local filters run in GridTable.';
  }

  if (kind === 'input') {
    return 'Local table: Input is the incoming row count before the shared cap is applied.';
  }
  if (kind === 'source') {
    return 'Local table: Capped is the post-cap row count that GridTable works over before local filtering.';
  }
  return 'Local table: Displayed is the post-cap row count after local filters run in GridTable.';
};

export const buildTablePerformanceSignals = (
  row: GridTablePerformanceEntry
): TablePerformanceSignal[] => {
  const signals: TablePerformanceSignal[] = [];

  if (row.updates >= 3) {
    const replacementRatio = row.inputReferenceChanges / row.updates;
    const churnSignal = buildReferenceChurnSignal(row, replacementRatio);
    if (churnSignal) {
      signals.push(churnSignal);
    }
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

export const TableGridPerformance: React.FC<TableGridPerformanceProps> = ({
  rows,
  emptyMessage,
  onReset,
  summary,
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
        <div className="diagnostics-section-title-group">
          <span className="diagnostics-section-subtitle">{summary}</span>
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
      {rows.length > 0 ? (
        <div className="diagnostics-table-performance-overview" role="presentation">
          <div className="diagnostics-summary-card">
            <span className="diagnostics-summary-heading">Instrumented Tables</span>
            <span className="diagnostics-summary-primary">{overview.instrumentedTables}</span>
            <span className="diagnostics-summary-secondary">Tables currently emitting samples</span>
          </div>
          <div className="diagnostics-summary-card">
            <span className="diagnostics-summary-heading">Flagged Tables</span>
            <span className="diagnostics-summary-primary">{overview.flaggedTables}</span>
            <span className="diagnostics-summary-secondary">
              Tables with warning-level churn or timing signals
            </span>
          </div>
          <div className="diagnostics-summary-card">
            <span className="diagnostics-summary-heading">Worst Offender</span>
            <span className="diagnostics-summary-primary">
              {overview.worstOffenderLabel ?? 'None'}
            </span>
            <span className="diagnostics-summary-secondary">
              {overview.worstOffenderLabel
                ? `${overview.worstOffenderSignals} signals currently active`
                : 'No active warning signals'}
            </span>
          </div>
        </div>
      ) : null}
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
                    <td title={MODE_TITLES[row.mode]}>
                      <span
                        className={`diagnostics-table-mode diagnostics-table-mode--${row.mode}`}
                      >
                        {MODE_LABELS[row.mode]}
                      </span>
                    </td>
                    <td title={buildRowCountTitle(row, 'input')}>{row.inputRows}</td>
                    <td title={buildRowCountTitle(row, 'source')}>{row.sourceRows}</td>
                    <td title={buildRowCountTitle(row, 'displayed')}>{row.displayedRows}</td>
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
