import {
  buildGridTableReferenceChurnSignal,
  type GridTablePerformanceSignal,
  getGridTableModeLabel,
  getGridTableModeTitle,
  getGridTableRowCountLabel,
  getGridTableRowCountTitle,
} from '@shared/components/tables/performance/gridTableDiagnosticsMode';
import type { GridTablePerformanceEntry } from '@shared/components/tables/performance/gridTablePerformanceStore';
import { TABLE_NO_VALUE_TEXT, TableCellValue } from '@shared/components/tables/tableNoValue';
import type React from 'react';
import { useMemo, useState } from 'react';

interface GridTablePerformanceProps {
  rows: GridTablePerformanceEntry[];
  emptyMessage?: string;
  onReset?: () => void;
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

const MIN_TIMING_SIGNAL_SAMPLES = 3;

const TimingHeader: React.FC<{ label: string; detail?: string }> = ({
  label,
  detail = 'Avg / Max / Latest',
}) => (
  <span className="diagnostics-table-heading-metric">
    <span>{label} (ms)</span>
    <span>{detail}</span>
  </span>
);

const formatTiming = (samples: number, averageMs: number, maxMs: number, latestMs: number) =>
  samples > 0
    ? `${averageMs.toFixed(2)} / ${maxMs.toFixed(2)} / ${latestMs.toFixed(2)}`
    : TABLE_NO_VALUE_TEXT;

const formatPercent = (value: number) => `${(value * 100).toFixed(0)}%`;

const formatReferenceChurn = (inputReferenceChanges: number, updates: number) => {
  if (updates <= 0) {
    return TABLE_NO_VALUE_TEXT;
  }

  return `${inputReferenceChanges} (${formatPercent(inputReferenceChanges / updates)})`;
};

const formatScrollFrameTiming = (row: GridTablePerformanceEntry) => {
  if (!row.scrollFrame) {
    return TABLE_NO_VALUE_TEXT;
  }

  return `${row.scrollFrame.avgMs.toFixed(2)} / ${row.scrollFrame.p95Ms.toFixed(2)} / ${row.scrollFrame.maxMs.toFixed(2)} / ${row.scrollFrame.latestMs.toFixed(2)}`;
};

const isTimingSignal = (averageMs: number, maxMs: number, averageThresholdMs: number) =>
  averageMs >= averageThresholdMs || maxMs >= averageThresholdMs * 2;

const isSustainedTimingSignal = (averageMs: number, averageThresholdMs: number) =>
  averageMs >= averageThresholdMs;

export const buildTablePerformanceSignals = (
  row: GridTablePerformanceEntry
): GridTablePerformanceSignal[] => {
  const signals: GridTablePerformanceSignal[] = [];

  const churnSignal = buildGridTableReferenceChurnSignal(row);
  if (churnSignal) {
    signals.push(churnSignal);
  }

  if (
    row.filterOptions.samples >= MIN_TIMING_SIGNAL_SAMPLES &&
    isTimingSignal(row.filterOptions.averageMs, row.filterOptions.maxMs, 4)
  ) {
    signals.push({
      label: 'Filter options slow',
      severity: 'warning',
      title: `Filter option derivation averages ${row.filterOptions.averageMs.toFixed(2)}ms and peaked at ${row.filterOptions.maxMs.toFixed(2)}ms.`,
    });
  }

  if (
    row.filterPass.samples >= MIN_TIMING_SIGNAL_SAMPLES &&
    isTimingSignal(row.filterPass.averageMs, row.filterPass.maxMs, 6)
  ) {
    signals.push({
      label: 'Filter pass slow',
      severity: 'warning',
      title: `Filter pass averages ${row.filterPass.averageMs.toFixed(2)}ms and peaked at ${row.filterPass.maxMs.toFixed(2)}ms.`,
    });
  }

  if (
    row.sort.samples >= MIN_TIMING_SIGNAL_SAMPLES &&
    isTimingSignal(row.sort.averageMs, row.sort.maxMs, 6)
  ) {
    signals.push({
      label: 'Sort slow',
      severity: 'warning',
      title: `Sort averages ${row.sort.averageMs.toFixed(2)}ms and peaked at ${row.sort.maxMs.toFixed(2)}ms.`,
    });
  }

  if (
    row.render.samples >= MIN_TIMING_SIGNAL_SAMPLES &&
    isSustainedTimingSignal(row.render.averageMs, 8)
  ) {
    signals.push({
      label: 'Render slow',
      severity: 'warning',
      title: `Render averages ${row.render.averageMs.toFixed(2)}ms and peaked at ${row.render.maxMs.toFixed(2)}ms.`,
    });
  }

  if (
    row.scrollFrame &&
    (row.scrollFrame.avgMs >= 16.7 ||
      row.scrollFrame.p95Ms >= 16.7 ||
      row.scrollFrame.maxMs >= 33.4)
  ) {
    signals.push({
      label: 'Scroll jank',
      severity: 'warning',
      title: `Latest scroll sample averaged ${row.scrollFrame.avgMs.toFixed(2)}ms per frame with p95 ${row.scrollFrame.p95Ms.toFixed(2)}ms, max ${row.scrollFrame.maxMs.toFixed(2)}ms, and ${row.scrollFrame.overBudgetFrames} over-budget frames.`,
    });
  }

  return signals;
};

const buildPerformanceRows = (rows: GridTablePerformanceEntry[]) =>
  rows
    .map((row) => {
      const signals = buildTablePerformanceSignals(row);
      return {
        row,
        signals,
        warningCount: signals.filter((signal) => signal.severity === 'warning').length,
      };
    })
    .sort(
      (left, right) =>
        right.warningCount - left.warningCount ||
        right.signals.length - left.signals.length ||
        right.row.inputRows - left.row.inputRows ||
        left.row.label.localeCompare(right.row.label)
    );

const summarizePerformanceRows = (
  rows: ReturnType<typeof buildPerformanceRows>
): TablePerformanceOverview => {
  const flagged = rows.filter(({ warningCount }) => warningCount > 0);
  return {
    instrumentedTables: rows.length,
    flaggedTables: flagged.length,
    worstOffenderLabel: flagged[0]?.row.label ?? null,
    worstOffenderSignals: flagged[0]?.warningCount ?? 0,
  };
};

export const buildTablePerformanceOverview = (
  rows: GridTablePerformanceEntry[]
): TablePerformanceOverview => summarizePerformanceRows(buildPerformanceRows(rows));

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

  const [firstMetric, ...remainingMetrics] = metrics;
  const dominant = remainingMetrics.reduce(
    (current, candidate) =>
      candidate.stats.averageMs > current.stats.averageMs ? candidate : current,
    firstMetric
  );

  return {
    label: `${dominant.label} (${dominant.stats.averageMs.toFixed(2)}ms avg)`,
    title: `${dominant.label} is the heaviest measured stage for this table. Average ${dominant.stats.averageMs.toFixed(2)}ms, max ${dominant.stats.maxMs.toFixed(2)}ms, latest ${dominant.stats.latestMs.toFixed(2)}ms.`,
  };
};

const TimingCell: React.FC<{ stats: GridTablePerformanceEntry['sort'] }> = ({ stats }) => (
  <td>
    <TableCellValue>
      {formatTiming(stats.samples, stats.averageMs, stats.maxMs, stats.latestMs)}
    </TableCellValue>
  </td>
);

const ReferenceChurnCell: React.FC<{
  row: GridTablePerformanceEntry;
  signals: GridTablePerformanceSignal[];
}> = ({ row, signals }) => (
  <td
    className={
      signals.some(
        (signal) => signal.severity === 'warning' && signal.label === 'Broad replacement'
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
    <TableCellValue>{formatReferenceChurn(row.inputReferenceChanges, row.updates)}</TableCellValue>
  </td>
);

export const GridTablePerformance: React.FC<GridTablePerformanceProps> = ({
  rows,
  emptyMessage,
  onReset,
}) => {
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const resolvedEmptyMessage =
    emptyMessage || 'No instrumented GridTable performance diagnostics have been recorded yet.';
  const sortedRows = useMemo(() => buildPerformanceRows(rows), [rows]);
  const overview = summarizePerformanceRows(sortedRows);
  const visibleRows = useMemo(
    () =>
      showFlaggedOnly ? sortedRows.filter(({ warningCount }) => warningCount > 0) : sortedRows,
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
              <th>{getGridTableRowCountLabel('input')}</th>
              <th>{getGridTableRowCountLabel('source')}</th>
              <th>{getGridTableRowCountLabel('displayed')}</th>
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
              <th>
                <TimingHeader label="Scroll Frame" detail="Avg / P95 / Max / Latest" />
              </th>
              <th>Last Render</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr className="diagnostics-empty">
                <td colSpan={15}>{visibleEmptyMessage}</td>
              </tr>
            ) : (
              visibleRows.map(({ row, signals }) => {
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
                    <ReferenceChurnCell row={row} signals={signals} />
                    <td title={dominantTiming?.title ?? undefined}>
                      <TableCellValue>
                        {dominantTiming?.label ?? TABLE_NO_VALUE_TEXT}
                      </TableCellValue>
                    </td>
                    <td
                      className="diagnostics-table-performance-signals"
                      title={signalsTitle || undefined}
                    >
                      {signals.length > 0 ? (
                        signals.map((signal) => (
                          <span
                            key={signal.label}
                            className={`diagnostics-table-performance-signal diagnostics-table-performance-signal--${signal.severity}`}
                          >
                            {signal.label}
                          </span>
                        ))
                      ) : (
                        <TableCellValue>{TABLE_NO_VALUE_TEXT}</TableCellValue>
                      )}
                    </td>
                    <TimingCell stats={row.filterOptions} />
                    <TimingCell stats={row.filterPass} />
                    <TimingCell stats={row.sort} />
                    <TimingCell stats={row.render} />
                    <td
                      title={
                        row.scrollFrame
                          ? `Latest scroll sample: ${row.scrollFrame.frameSamples} frames, ${row.scrollFrame.overBudgetFrames} over budget, est ${row.scrollFrame.estFps.toFixed(1)} FPS across ${row.scrollFrame.windows} window(s).`
                          : undefined
                      }
                    >
                      <TableCellValue>{formatScrollFrameTiming(row)}</TableCellValue>
                    </td>
                    <td>
                      <TableCellValue>{row.lastRenderPhase ?? TABLE_NO_VALUE_TEXT}</TableCellValue>
                    </td>
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
