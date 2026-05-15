import { describe, expect, it } from 'vitest';

import { getVisibleAutoColumnKeys } from '@shared/components/tables/hooks/useGridTableColumnLayout';
import type { ColumnRenderModel } from '@shared/components/tables/hooks/useGridTableColumnVirtualization';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

interface Row {
  name: string;
}

const columns: GridColumnDefinition<Row>[] = [
  { key: 'kind', header: 'Kind', autoWidth: true, render: (row) => row.name },
  { key: 'name', header: 'Name', render: (row) => row.name },
  { key: 'status', header: 'Status', autoWidth: true, render: (row) => row.name },
  { key: 'age', header: 'Age', autoWidth: true, render: (row) => row.name },
];

const models = columns.map(
  (column, index): ColumnRenderModel<Row> => ({
    column,
    key: column.key,
    className: '',
    cellStyle: { width: '100px' },
    start: index * 100,
    end: (index + 1) * 100,
    width: 100,
  })
);

describe('getVisibleAutoColumnKeys', () => {
  it('returns every auto-width column when column virtualization is disabled', () => {
    expect(
      getVisibleAutoColumnKeys({
        renderedColumns: columns,
        columnRenderModelsWithOffsets: models,
        columnVirtualizationConfig: { enabled: false, stickyStart: 1, stickyEnd: 1 },
        columnWindowRange: { startIndex: 1, endIndex: 1 },
      })
    ).toEqual(['kind', 'status', 'age']);
  });

  it('includes sticky and visible auto-width columns when virtualization is enabled', () => {
    expect(
      getVisibleAutoColumnKeys({
        renderedColumns: columns,
        columnRenderModelsWithOffsets: models,
        columnVirtualizationConfig: { enabled: true, stickyStart: 1, stickyEnd: 1 },
        columnWindowRange: { startIndex: 1, endIndex: 2 },
      })
    ).toEqual(['kind', 'status', 'age']);
  });

  it('omits non-sticky auto-width columns outside the visible window', () => {
    expect(
      getVisibleAutoColumnKeys({
        renderedColumns: columns,
        columnRenderModelsWithOffsets: models,
        columnVirtualizationConfig: { enabled: true, stickyStart: 1, stickyEnd: 0 },
        columnWindowRange: { startIndex: 1, endIndex: 1 },
      })
    ).toEqual(['kind']);
  });
});
