import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { describe, expect, it } from 'vitest';
import {
  normalizeQueryBackedNamespaceQueryFilters,
  queryBackedFacetFilterOptions,
  removeQueryBackedNamespaceFilterSentinels,
} from './queryBackedTableState';

describe('queryBackedTableState', () => {
  it('keeps explicit namespace options instead of collapsing to filtered query facets', () => {
    expect(queryBackedFacetFilterOptions(['team-a', 'team-b'], ['team-a'])).toEqual([
      'team-a',
      'team-b',
    ]);
  });

  it('keeps explicit namespace metadata when it includes namespaces beyond the loaded row fallback', () => {
    expect(queryBackedFacetFilterOptions(['team-a', 'team-b'], ['team-a'], ['team-a'])).toEqual([
      'team-a',
      'team-b',
    ]);
  });

  it('uses query facet namespaces when explicit options are only the loaded row fallback', () => {
    expect(queryBackedFacetFilterOptions(['team-a'], ['team-a', 'team-b'], ['team-a'])).toEqual([
      'team-a',
      'team-b',
    ]);
  });

  it('preserves an explicit selection containing every namespace', () => {
    const filters = {
      ...DEFAULT_GRID_TABLE_FILTER_STATE,
      namespaces: ['team-b', 'team-a'],
    };

    expect(removeQueryBackedNamespaceFilterSentinels(filters)).toBe(filters);
  });

  it('omits an explicit all-namespace selection from the backend query', () => {
    expect(
      normalizeQueryBackedNamespaceQueryFilters(
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
      removeQueryBackedNamespaceFilterSentinels({
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        namespaces: ['namespace:all'],
      })
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

    expect(removeQueryBackedNamespaceFilterSentinels(filters)).toBe(filters);
  });
});
