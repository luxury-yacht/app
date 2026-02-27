/**
 * frontend/src/shared/components/tables/hooks/useGridTableColumnMeasurer.test.tsx
 *
 * Test suite for useGridTableColumnMeasurer.
 * Covers key behaviors and edge cases for useGridTableColumnMeasurer.
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { useGridTableColumnMeasurer } from '@shared/components/tables/hooks/useGridTableColumnMeasurer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SampleRow = { name: string; kind?: string };

const columns: GridColumnDefinition<SampleRow>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name },
  {
    key: 'kind',
    header: 'Kind',
    sortable: true,
    render: (row) => <span data-kind-value={row.kind ?? ''}>{row.kind ?? ''}</span>,
  },
];

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
const originalScrollWidthDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollWidth'
);

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  if (originalScrollWidthDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', originalScrollWidthDescriptor);
  } else {
    delete (HTMLElement.prototype as any).scrollWidth;
  }
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const renderHarness = async (tableData: SampleRow[]) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const tableHost = document.createElement('div');
  document.body.appendChild(tableHost);
  const root = ReactDOM.createRoot(container);

  let measureColumnWidth: ((column: GridColumnDefinition<SampleRow>) => number) | null = null;

  const Harness: React.FC = () => {
    const tableRef = React.useRef<HTMLElement | null>(tableHost);
    const { measureColumnWidth: measure } = useGridTableColumnMeasurer<SampleRow>({
      tableRef,
      tableData,
      parseWidthInputToNumber: (input) => {
        if (typeof input === 'number') return input;
        if (!input || input === 'auto') return null;
        const numeric = Number.parseFloat(input);
        return Number.isFinite(numeric) ? numeric : null;
      },
      defaultColumnWidth: 150,
      isKindColumnKey: (key) => key === 'kind',
      getTextContent: (node) => {
        if (typeof node === 'string') return node;
        if (Array.isArray(node)) {
          return node.map((item) => (typeof item === 'string' ? item : '')).join('');
        }
        if (React.isValidElement(node)) {
          const props = node.props as { children?: React.ReactNode };
          if (typeof props.children === 'string') return props.children;
        }
        return '';
      },
      normalizeKindClass: (value) => value.toLowerCase(),
      getColumnMinWidth: () => 72,
      getColumnMaxWidth: () => Number.POSITIVE_INFINITY,
    });

    measureColumnWidth = measure;
    return null;
  };

  await act(async () => {
    root.render(<Harness />);
  });

  return {
    measure: (column: GridColumnDefinition<SampleRow>) => {
      if (!measureColumnWidth) {
        throw new Error('measureColumnWidth not initialised');
      }
      let measured = 0;
      // The measurement path creates and unmounts a temporary React root.
      // Keep that work inside act() so React test warnings stay clean.
      act(() => {
        measured = measureColumnWidth!(column);
      });
      return measured;
    },
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      tableHost.remove();
    },
  };
};

describe('useGridTableColumnMeasurer', () => {
  it('falls back to default width when DOM metrics are zero', async () => {
    const harness = await renderHarness([{ name: 'alpha' }]);

    const measurement = harness.measure(columns[0]);
    expect(measurement).toBe(150);

    await harness.cleanup();
  });

  it('uses DOM measurements and normalises kind badge content', async () => {
    const headerWidths = [180];
    const cellWidths = [210, 240];
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return headerWidths.length ? headerWidths.shift()! : 0;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = function () {
      const width = cellWidths.length ? cellWidths.shift()! : 0;
      return {
        width,
        height: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: width,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };

    const harness = await renderHarness([
      { name: 'alpha', kind: 'Deployment' },
      { name: 'beta', kind: 'Job' },
    ]);

    const measurement = harness.measure(columns[1]);
    expect(measurement).toBeGreaterThanOrEqual(240);

    await harness.cleanup();
  });
});
