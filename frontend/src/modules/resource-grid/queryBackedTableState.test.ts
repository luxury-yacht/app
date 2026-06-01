import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import {
  normalizeQueryBackedNamespaceFilters,
  queryBackedNamespaceFilterOptions,
} from './queryBackedTableState';

describe('queryBackedTableState', () => {
  it('keeps explicit namespace options instead of collapsing to filtered query facets', () => {
    expect(queryBackedNamespaceFilterOptions(['team-a', 'team-b'], ['team-a'])).toEqual([
      'team-a',
      'team-b',
    ]);
  });

  it('treats selecting every namespace as all namespaces for query scope state', () => {
    expect(
      normalizeQueryBackedNamespaceFilters(
        {
          ...DEFAULT_GRID_TABLE_FILTER_STATE,
          namespaces: ['team-b', 'team-a'],
        },
        ['team-a', 'team-b']
      )
    ).toEqual({
      ...DEFAULT_GRID_TABLE_FILTER_STATE,
      namespaces: [],
    });
  });

  it('drops persisted all-namespace sentinel values before building query scope state', () => {
    expect(
      normalizeQueryBackedNamespaceFilters(
        {
          ...DEFAULT_GRID_TABLE_FILTER_STATE,
          namespaces: ['namespace:all'],
        },
        []
      )
    ).toEqual({
      ...DEFAULT_GRID_TABLE_FILTER_STATE,
      namespaces: [],
    });
  });

  it('drops unvalidated persisted namespace filters when no namespace options are loaded yet', () => {
    expect(
      normalizeQueryBackedNamespaceFilters(
        {
          ...DEFAULT_GRID_TABLE_FILTER_STATE,
          namespaces: ['stale-namespace'],
        },
        []
      )
    ).toEqual({
      ...DEFAULT_GRID_TABLE_FILTER_STATE,
      namespaces: [],
    });
  });

  it('preserves real namespace subsets', () => {
    const filters = {
      ...DEFAULT_GRID_TABLE_FILTER_STATE,
      namespaces: ['team-a'],
    };

    expect(normalizeQueryBackedNamespaceFilters(filters, ['team-a', 'team-b'])).toBe(filters);
  });
});
