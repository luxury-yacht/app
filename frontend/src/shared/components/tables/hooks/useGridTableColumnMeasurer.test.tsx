/**
 * frontend/src/shared/components/tables/hooks/useGridTableColumnMeasurer.test.tsx
 *
 * Test suite for useGridTableColumnMeasurer.
 * Covers key behaviors and edge cases for useGridTableColumnMeasurer.
 */

import { createKindColumn } from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { useGridTableColumnMeasurer } from '@shared/components/tables/hooks/useGridTableColumnMeasurer';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

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
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
  }
  document.documentElement.style.removeProperty('--app-zoom-factor');
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const renderHarness = async (tableData: SampleRow[]) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  let measureColumnWidth: ((column: GridColumnDefinition<SampleRow>) => number) | null = null;

  const Harness: React.FC = () => {
    const { measureColumnWidth: measure } = useGridTableColumnMeasurer<SampleRow>({
      tableData,
      parseWidthInputToNumber: (input) => {
        if (typeof input === 'number') {
          return input;
        }
        if (!input || input === 'auto') {
          return null;
        }
        const numeric = Number.parseFloat(input);
        return Number.isFinite(numeric) ? numeric : null;
      },
      defaultColumnWidth: 150,
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
        measured = requireValue(
          measureColumnWidth,
          'expected test value in useGridTableColumnMeasurer.test.tsx'
        )(column);
      });
      return measured;
    },
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
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

  it('uses DOM measurements for rendered column content', async () => {
    const headerWidths = [180];
    const cellWidths = [210, 240];
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return headerWidths.length
          ? requireValue(
              headerWidths.shift(),
              'expected test value in useGridTableColumnMeasurer.test.tsx'
            )
          : 0;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = () => {
      const width = cellWidths.length
        ? requireValue(
            cellWidths.shift(),
            'expected test value in useGridTableColumnMeasurer.test.tsx'
          )
        : 0;
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

  it('converts zoomed visual measurements back to CSS width with paint clearance', async () => {
    document.documentElement.style.setProperty('--app-zoom-factor', '0.8');
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return 120;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        width: 204.125,
        height: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 204.125,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const harness = await renderHarness([{ name: 'PriorityLevelConfiguration' }]);

    expect(harness.measure(columns[0])).toBe(257);
    await harness.cleanup();
  });

  it('measures each distinct declared sample only once', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return 120;
      },
    });
    const getBoundingClientRect = vi.fn(
      () =>
        ({
          width: 180,
          height: 0,
          top: 0,
          left: 0,
          bottom: 0,
          right: 180,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect
    );
    HTMLElement.prototype.getBoundingClientRect = getBoundingClientRect;
    const kindColumn = createKindColumn<SampleRow>({
      getKind: (row) => row.kind ?? '',
    });
    const harness = await renderHarness([
      { name: 'alpha', kind: 'Pod' },
      { name: 'beta', kind: 'Pod' },
      { name: 'gamma', kind: 'Job' },
    ]);

    harness.measure(kindColumn);

    expect(getBoundingClientRect).toHaveBeenCalledTimes(2);
    await harness.cleanup();
  });

  it('includes the final row when measuring large datasets', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return 120;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = function () {
      const text = this.textContent ?? '';
      const width = text.length * 10;
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

    const tableData: SampleRow[] = Array.from({ length: 401 }, (_value, index) => ({
      name: `row-${index}`,
      kind: index === 400 ? 'ExtremelyVerboseCustomResourceKind' : 'Pod',
    }));

    const harness = await renderHarness(tableData);

    const measurement = harness.measure(columns[1]);
    expect(measurement).toBeGreaterThanOrEqual('ExtremelyVerboseCustomResourceKind'.length * 10);

    await harness.cleanup();
  });

  it('includes the widest row anywhere in a 500-row page', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return 120;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = function () {
      const width = (this.textContent ?? '').length * 10;
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

    const widestName = 'cert-manager-controller-certificatesigningrequests';
    const tableData: SampleRow[] = Array.from({ length: 500 }, (_value, index) => ({
      name: index === 1 ? widestName : `row-${index}`,
    }));
    const harness = await renderHarness(tableData);

    const measurement = harness.measure(columns[0]);

    expect(measurement).toBeGreaterThanOrEqual(widestName.length * 10);
    await harness.cleanup();
  });

  it('removes temporary measurement nodes after use', async () => {
    const harness = await renderHarness([{ name: 'alpha', kind: 'Deployment' }]);

    harness.measure(columns[1]);
    expect(document.body.querySelector('.grid-cell')).toBeNull();

    await harness.cleanup();
  });
});
