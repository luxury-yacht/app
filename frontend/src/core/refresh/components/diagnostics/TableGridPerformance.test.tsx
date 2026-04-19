import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TableGridPerformance, buildTablePerformanceSignals } from './TableGridPerformance';
import type { GridTablePerformanceEntry } from '@shared/components/tables/performance/gridTablePerformanceStore';

const createTimingStats = (samples = 0, averageMs = 0, maxMs = 0, latestMs = 0) => ({
  samples,
  averageMs,
  maxMs,
  latestMs,
});

const createRow = (
  overrides: Partial<GridTablePerformanceEntry> = {}
): GridTablePerformanceEntry => ({
  label: 'All Namespaces Pods',
  updates: 10,
  inputReferenceChanges: 1,
  inputRows: 2000,
  sourceRows: 1000,
  displayedRows: 800,
  lastUpdated: 1,
  lastRenderPhase: 'update',
  filterOptions: createTimingStats(),
  filterPass: createTimingStats(),
  sort: createTimingStats(),
  render: createTimingStats(),
  ...overrides,
});

describe('TableGridPerformance', () => {
  it('flags suspicious broad replacement and recompute signals', () => {
    const signals = buildTablePerformanceSignals(
      createRow({
        inputReferenceChanges: 9,
        filterPass: createTimingStats(4, 7.5, 18, 8),
        sort: createTimingStats(3, 8, 15, 7),
      })
    );

    expect(signals.map((signal) => signal.label)).toEqual([
      'Broad replacement',
      'Filter pass slow',
      'Sort slow',
    ]);
  });

  it('renders the most suspicious rows first with signal labels and churn ratios', () => {
    const markup = renderToStaticMarkup(
      <TableGridPerformance
        summary="Rolling GridTable measurements for the instrumented large-data views."
        rows={[
          createRow({
            label: 'Namespace Config',
            inputReferenceChanges: 1,
          }),
          createRow({
            label: 'All Namespaces Browse',
            inputReferenceChanges: 9,
            filterOptions: createTimingStats(4, 5, 11, 4),
            render: createTimingStats(6, 9, 18, 10),
          }),
        ]}
      />
    );

    expect(markup.indexOf('All Namespaces Browse')).toBeLessThan(
      markup.indexOf('Namespace Config')
    );
    expect(markup).toContain('Broad replacement');
    expect(markup).toContain('Filter options slow');
    expect(markup).toContain('Render slow');
    expect(markup).toContain('9 / 10 (90%)');
  });
});
