import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import {
  reconcileColumnOrder,
  reorderVisibleColumnOrder,
} from '@shared/components/tables/gridTableColumnOrder';
import { describe, expect, it } from 'vitest';

const columnsFor = (keys: string[]): GridColumnDefinition<unknown>[] =>
  keys.map((key) => ({ key, header: key, render: () => null }));

describe('reconcileColumnOrder', () => {
  it('returns the declared order when nothing is persisted', () => {
    expect(reconcileColumnOrder(columnsFor(['kind', 'name', 'age']), null)).toEqual([
      'kind',
      'name',
      'age',
    ]);
  });

  it('inserts newly declared columns at their declared position, not after the trailing column', () => {
    // A view replaced its 'details' column with three new columns declared
    // before 'age'; a persisted order must not push them after Age.
    const columns = columnsFor(['kind', 'name', 'context', 'network', 'summary', 'age']);
    expect(reconcileColumnOrder(columns, ['kind', 'name', 'details', 'age'])).toEqual([
      'kind',
      'name',
      'context',
      'network',
      'summary',
      'age',
    ]);
  });

  it('keeps the user reordering of existing columns while placing new ones after their declared predecessor', () => {
    const columns = columnsFor(['kind', 'name', 'context', 'age']);
    expect(reconcileColumnOrder(columns, ['name', 'kind', 'age'])).toEqual([
      'name',
      'context',
      'kind',
      'age',
    ]);
  });

  it('inserts a column declared first at the front when the persisted order predates it', () => {
    const columns = columnsFor(['kind', 'name', 'age']);
    expect(reconcileColumnOrder(columns, ['name', 'age'])).toEqual(['kind', 'name', 'age']);
  });

  it('keeps trailing declared columns (custom metadata) at the end', () => {
    const columns = columnsFor(['kind', 'name', 'age', 'meta:custom']);
    expect(reconcileColumnOrder(columns, ['kind', 'name', 'age'])).toEqual([
      'kind',
      'name',
      'age',
      'meta:custom',
    ]);
  });

  it('drops persisted keys the view no longer declares', () => {
    const columns = columnsFor(['kind', 'name', 'age']);
    expect(reconcileColumnOrder(columns, ['kind', 'details', 'name', 'age'])).toEqual([
      'kind',
      'name',
      'age',
    ]);
  });
});

describe('reorderVisibleColumnOrder', () => {
  it('does not rewrite hidden-column placement for a visually unchanged drop', () => {
    expect(reorderVisibleColumnOrder(['A', 'hidden', 'B'], 'A', ['A', 'B'], 1)).toBeNull();
    expect(reorderVisibleColumnOrder(['A', 'hidden', 'B'], 'B', ['A', 'B'], 1)).toBeNull();
  });

  it('maps a changed visible order into the complete order without dropping hidden keys', () => {
    expect(reorderVisibleColumnOrder(['A', 'hidden', 'B'], 'A', ['A', 'B'], 2)).toEqual([
      'hidden',
      'B',
      'A',
    ]);
    expect(reorderVisibleColumnOrder(['A', 'hidden', 'B'], 'B', ['A', 'B'], 0)).toEqual([
      'B',
      'A',
      'hidden',
    ]);
  });
});
