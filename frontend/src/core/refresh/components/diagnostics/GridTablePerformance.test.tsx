import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  GridTablePerformance,
  buildDominantTimingMetric,
  buildTablePerformanceOverview,
  buildTablePerformanceSignals,
} from './GridTablePerformance';
import type { GridTablePerformanceEntry } from '@shared/components/tables/performance/gridTablePerformanceStore';
import ReactDOM from 'react-dom/client';
import { act } from 'react';

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
  mode: 'local',
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

describe('GridTablePerformance', () => {
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

  it('ignores one-off timing spikes until a metric has multiple samples', () => {
    const signals = buildTablePerformanceSignals(
      createRow({
        sort: createTimingStats(1, 12, 12, 12),
        render: createTimingStats(2, 15, 20, 20),
      })
    );

    expect(signals).toEqual([]);
  });

  it('down-ranks broad replacement for live tables into an informational signal', () => {
    const signals = buildTablePerformanceSignals(
      createRow({
        mode: 'live',
        inputReferenceChanges: 9,
      })
    );

    expect(signals).toEqual([
      expect.objectContaining({
        label: 'Live churn',
        severity: 'info',
      }),
    ]);
  });

  it('renders the most suspicious rows first with signal labels and churn ratios', () => {
    const markup = renderToStaticMarkup(
      <GridTablePerformance
        onReset={() => undefined}
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
    expect(markup).toContain('Mode');
    expect(markup).toContain('Local');
    expect(markup).toContain('Post-Cap');
    expect(markup).toContain('Visible');
    expect(markup).toContain('9 (90%)');
    expect(markup).toContain('Reset Samples');
    expect(markup).toContain('Worst Offender');
    expect(markup).toContain('Filter Options (ms)');
    expect(markup).toContain('Avg / Max / Latest');
    expect(markup).not.toContain(
      'Rolling GridTable measurements for the instrumented large-data views.'
    );
  });

  it('renders explicit table modes for divergent view families', () => {
    const markup = renderToStaticMarkup(
      <GridTablePerformance
        onReset={() => undefined}
        summary="Rolling GridTable measurements for the instrumented large-data views."
        rows={[
          createRow({
            label: 'All Namespaces Browse',
            mode: 'query',
          }),
          createRow({
            label: 'All Namespaces Workloads',
            mode: 'live',
          }),
        ]}
      />
    );

    expect(markup).toContain('Query');
    expect(markup).toContain('Live');
    expect(markup).toContain(
      'Query-backed table: Input is the upstream query result size before the shared cap is applied.'
    );
  });

  it('builds a compact profiling overview for the current sample set', () => {
    const overview = buildTablePerformanceOverview([
      createRow({
        label: 'Namespace Config',
      }),
      createRow({
        label: 'All Namespaces Browse',
        inputReferenceChanges: 9,
        render: createTimingStats(6, 9, 18, 10),
      }),
    ]);

    expect(overview).toEqual({
      instrumentedTables: 2,
      flaggedTables: 1,
      worstOffenderLabel: 'All Namespaces Browse',
      worstOffenderSignals: 2,
    });
  });

  it('excludes informational live-churn notes from flagged-table counts', () => {
    const overview = buildTablePerformanceOverview([
      createRow({
        label: 'All Namespaces Workloads',
        mode: 'live',
        inputReferenceChanges: 9,
      }),
    ]);

    expect(overview).toEqual({
      instrumentedTables: 1,
      flaggedTables: 0,
      worstOffenderLabel: null,
      worstOffenderSignals: 0,
    });
  });

  it('identifies the dominant measured stage for a row', () => {
    const dominantMetric = buildDominantTimingMetric(
      createRow({
        filterPass: createTimingStats(3, 7.5, 10, 8),
        render: createTimingStats(4, 12, 20, 15),
      })
    );

    expect(dominantMetric).toEqual({
      label: 'Render (12.00ms avg)',
      title:
        'Render is the heaviest measured stage for this table. Average 12.00ms, max 20.00ms, latest 15.00ms.',
    });
  });

  it('can narrow the view to flagged tables only', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);

    await act(async () => {
      root.render(
        <GridTablePerformance
          onReset={() => undefined}
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
            }),
          ]}
        />
      );
      await Promise.resolve();
    });

    const toggle = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Show Flagged Only'
    );
    expect(toggle).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const bodyText = host.querySelector('tbody')?.textContent ?? '';
    expect(bodyText).toContain('All Namespaces Browse');
    expect(bodyText).not.toContain('Namespace Config');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    host.remove();
  });
});
