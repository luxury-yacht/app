import { createResourceBarColumn } from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { getTextContent as getRenderedTextContent } from '@shared/components/tables/GridTable.utils';
import { describe, expect, it } from 'vitest';
import { buildCsvExportFilename, buildGridTableCsv } from './gridTableCsv';

interface Row {
  name: string;
  note: string;
}

// The CSV builder feeds each header/cell ReactNode through getTextContent; the real
// app renders to text, but for these rows the nodes are already strings.
const getTextContent = (node: unknown): string => String(node ?? '');

const columns = [
  { key: 'name', header: 'Name', render: (row: Row) => row.name },
  { key: 'note', header: 'Note', render: (row: Row) => row.note },
] as unknown as GridColumnDefinition<Row>[];

describe('buildGridTableCsv', () => {
  it('builds a header row + data rows from the displayed columns', () => {
    const csv = buildGridTableCsv(
      [
        { name: 'alpha', note: 'one' },
        { name: 'beta', note: 'two' },
      ],
      columns,
      getTextContent
    );

    expect(csv).toBe('Name,Note\nalpha,one\nbeta,two');
  });

  it('quotes and escapes cells containing commas, quotes, or newlines', () => {
    const csv = buildGridTableCsv([{ name: 'a,b', note: 'he said "hi"' }], columns, getTextContent);

    expect(csv).toBe('Name,Note\n"a,b","he said ""hi"""');
  });

  it('exports legacy and canonical no-value markers as the canonical hyphen', () => {
    const csv = buildGridTableCsv(
      [
        { name: 'legacy', note: '—' },
        { name: 'canonical', note: '-' },
      ],
      columns,
      getTextContent
    );

    expect(csv).toBe('Name,Note\nlegacy,-\ncanonical,-');
  });

  it('exports metric usage as plain millicores and KiB so spreadsheets can sort it', () => {
    interface MetricRow {
      name: string;
      cpuUsageMilli?: number;
      memoryUsageBytes?: number;
      metricsError?: string;
    }
    const metricColumns: GridColumnDefinition<MetricRow>[] = [
      { key: 'name', header: 'Name', render: (row) => row.name },
      createResourceBarColumn<MetricRow>({
        key: 'cpu',
        header: 'CPU',
        type: 'cpu',
        getUsage: (row) => row.cpuUsageMilli,
        getMetricsError: (row) => row.metricsError,
      }),
      createResourceBarColumn<MetricRow>({
        key: 'memory',
        header: 'Memory',
        type: 'memory',
        getUsage: (row) => row.memoryUsageBytes,
        getMetricsError: (row) => row.metricsError,
      }),
    ];

    const csv = buildGridTableCsv(
      [
        // 1.23 cores and 1560 MiB plus 123 bytes: neither rounds to a display step.
        { name: 'busy', cpuUsageMilli: 1234, memoryUsageBytes: 1560 * 1024 * 1024 + 123 },
        { name: 'idle', cpuUsageMilli: 0, memoryUsageBytes: 0 },
        { name: 'unsampled' },
        { name: 'failed', cpuUsageMilli: 5, memoryUsageBytes: 4096, metricsError: 'timeout' },
      ],
      metricColumns,
      getRenderedTextContent
    );

    expect(csv).toBe(
      [
        'Name,CPU (m),Memory (KiB)',
        'busy,1234,1597440',
        'idle,0,0',
        'unsampled,-,-',
        'failed,-,-',
      ].join('\n')
    );
  });

  it('returns an empty string when there are no columns', () => {
    expect(buildGridTableCsv([{ name: 'a', note: 'b' }], [], getTextContent)).toBe('');
  });
});

describe('buildCsvExportFilename', () => {
  it('wraps the per-view base name with the app prefix and a local timestamp', () => {
    const exportedAt = new Date(2026, 5, 10, 14, 22, 33); // 2026-06-10 14:22:33 local
    expect(buildCsvExportFilename('cluster-crds', exportedAt)).toBe(
      'luxury-yacht-cluster-crds-20260610142233.csv'
    );
  });

  it('zero-pads every timestamp component', () => {
    const exportedAt = new Date(2026, 0, 2, 3, 4, 5); // 2026-01-02 03:04:05 local
    expect(buildCsvExportFilename('browse', exportedAt)).toBe(
      'luxury-yacht-browse-20260102030405.csv'
    );
  });
});
