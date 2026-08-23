import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import {
  buildInitialMeasuredColumnWidthPlan,
  clampColumnWidth,
  resolveColumnWidth,
} from '@shared/components/tables/hooks/gridTableColumnWidthMath';
import { describe, expect, it, vi } from 'vitest';

type Row = { id: string };

const column = (key: string, config: Partial<GridColumnDefinition<Row>> = {}) => ({
  key,
  header: key,
  render: () => key,
  ...config,
});

const getColumnMinWidth = (col: GridColumnDefinition<Row>) =>
  typeof col.minWidth === 'number' ? col.minWidth : 72;
const getColumnMaxWidth = (col: GridColumnDefinition<Row>) =>
  typeof col.maxWidth === 'number' ? col.maxWidth : Number.POSITIVE_INFINITY;
const bounds = { getColumnMinWidth, getColumnMaxWidth };

describe('gridTableColumnWidthMath', () => {
  it('clamps and resolves widths from state, natural size, and column defaults', () => {
    const name = column('name', { minWidth: 100, maxWidth: 200, width: '180px' });

    expect(clampColumnWidth(name, 80, bounds)).toBe(100);
    expect(clampColumnWidth(name, 240, bounds)).toBe(200);
    expect(
      resolveColumnWidth({ column: name, baseWidths: {}, naturalWidths: { name: 160 }, ...bounds })
    ).toBe(160);
    expect(resolveColumnWidth({ column: name, baseWidths: {}, naturalWidths: {}, ...bounds })).toBe(
      180
    );
  });

  it('builds initial widths from external, manual, auto, and declared sources', () => {
    const columns = [
      column('name', { autoWidth: true }),
      column('manual'),
      column('external'),
      column('declared', { width: 110 }),
      column('fallback'),
    ];
    const measureColumnWidth = vi.fn(() => 130);

    const plan = buildInitialMeasuredColumnWidthPlan({
      renderedColumns: columns,
      columnWidths: { manual: 170, fallback: 150 },
      measuredAutoWidths: { name: 180 },
      externalColumnWidths: { external: 140 },
      manuallyResizedColumnKeys: new Set(['manual']),
      measureColumnWidth,
      ...bounds,
    });

    expect(plan.widths).toEqual({
      name: 180,
      manual: 170,
      external: 140,
      declared: 110,
      fallback: 150,
    });
    expect(plan.naturalWidths).toEqual(plan.widths);
    expect(measureColumnWidth).not.toHaveBeenCalled();
  });
});
