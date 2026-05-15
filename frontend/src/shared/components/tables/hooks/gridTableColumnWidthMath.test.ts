import { describe, expect, it, vi } from 'vitest';

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import {
  buildInitialMeasuredColumnWidthPlan,
  clampColumnWidth,
  reconcileColumnWidthsToContainer,
  resolveColumnWidth,
} from '@shared/components/tables/hooks/gridTableColumnWidthMath';

type Row = { id: string };

const column = (key: string, config: Partial<GridColumnDefinition<Row>> = {}) =>
  ({
    key,
    header: key,
    render: () => key,
    ...config,
  }) as GridColumnDefinition<Row>;

const getColumnMinWidth = (col: GridColumnDefinition<Row>) => {
  if (typeof col.minWidth === 'number') {
    return col.minWidth;
  }
  return 72;
};

const getColumnMaxWidth = (col: GridColumnDefinition<Row>) => {
  if (typeof col.maxWidth === 'number') {
    return col.maxWidth;
  }
  return Number.POSITIVE_INFINITY;
};

const bounds = { getColumnMinWidth, getColumnMaxWidth };
const isFixedColumnKey = (key: string) => key === 'kind' || key === 'type';

describe('gridTableColumnWidthMath', () => {
  it('clamps and resolves column widths from base, natural, and column defaults', () => {
    const col = column('name', { minWidth: 100, maxWidth: 200, width: '180px' });

    expect(clampColumnWidth(col, 80, bounds)).toBe(100);
    expect(clampColumnWidth(col, 240, bounds)).toBe(200);
    expect(
      resolveColumnWidth({
        column: col,
        baseWidths: {},
        naturalWidths: { name: 160 },
        ...bounds,
      })
    ).toBe(160);
    expect(
      resolveColumnWidth({
        column: col,
        baseWidths: {},
        naturalWidths: {},
        ...bounds,
      })
    ).toBe(180);
  });

  it('preserves natural widths when overflow is allowed unless force-fit is requested', () => {
    const columns = [column('kind'), column('name')];
    const baseWidths = { kind: 80, name: 120 };

    const natural = reconcileColumnWidthsToContainer({
      baseWidths,
      renderedColumns: columns,
      naturalWidths: {},
      containerWidth: 480,
      allowHorizontalOverflow: true,
      enableColumnResizing: true,
      externalColumnWidths: null,
      manuallyResizedColumnKeys: new Set(),
      isFixedColumnKey,
      ...bounds,
    });
    expect(natural).toEqual(baseWidths);

    const forceFit = reconcileColumnWidthsToContainer({
      baseWidths,
      renderedColumns: columns,
      naturalWidths: {},
      containerWidth: 480,
      allowHorizontalOverflow: true,
      forceFit: true,
      enableColumnResizing: true,
      externalColumnWidths: null,
      manuallyResizedColumnKeys: new Set(),
      isFixedColumnKey,
      ...bounds,
    });
    expect(forceFit.kind).toBe(80);
    expect(forceFit.name).toBeGreaterThan(120);
    expect(forceFit.kind + forceFit.name).toBeGreaterThanOrEqual(479);
  });

  it('fills missing non-overflow flex widths without changing complete width maps', () => {
    const columns = [column('kind'), column('name'), column('age')];

    expect(
      reconcileColumnWidthsToContainer({
        baseWidths: { kind: 90, name: 180, age: 100 },
        renderedColumns: columns,
        naturalWidths: {},
        containerWidth: 600,
        allowHorizontalOverflow: false,
        enableColumnResizing: true,
        externalColumnWidths: null,
        manuallyResizedColumnKeys: new Set(),
        isFixedColumnKey,
        ...bounds,
      })
    ).toEqual({ kind: 90, name: 180, age: 100 });

    expect(
      reconcileColumnWidthsToContainer({
        baseWidths: { kind: 120 },
        renderedColumns: [column('kind'), column('name'), column('misc')],
        naturalWidths: {},
        containerWidth: 520,
        allowHorizontalOverflow: false,
        enableColumnResizing: true,
        externalColumnWidths: null,
        manuallyResizedColumnKeys: new Set(),
        isFixedColumnKey,
        ...bounds,
      })
    ).toEqual({ kind: 120, name: 200, misc: 200 });
  });

  it('builds the initial measured width plan for fixed, auto, external, and fallback columns', () => {
    const columns = [
      column('kind'),
      column('name', { autoWidth: true }),
      column('manual', { width: 150 }),
      column('external'),
      column('fallback', { width: '110px' }),
    ];
    const measureColumnWidth = vi.fn((col: GridColumnDefinition<Row>) => {
      switch (col.key) {
        case 'kind':
          return 90;
        case 'name':
          return 180;
        default:
          return 130;
      }
    });

    const plan = buildInitialMeasuredColumnWidthPlan({
      renderedColumns: columns,
      columnWidths: { manual: 170 },
      measuredFixedWidths: { kind: 90 },
      measuredAutoWidths: { name: 180 },
      externalColumnWidths: { external: 140 },
      manuallyResizedColumnKeys: new Set(['manual']),
      containerWidth: 620,
      allowHorizontalOverflow: false,
      isFixedColumnKey,
      measureColumnWidth,
      ...bounds,
    });

    expect(plan.widths.kind).toBe(90);
    expect(plan.widths.name).toBe(180);
    expect(plan.widths.external).toBe(140);
    expect(plan.widths.manual).toBeGreaterThan(0);
    expect(plan.widths.fallback).toBeGreaterThan(0);
    expect(plan.naturalWidths).toEqual(plan.widths);
  });
});
