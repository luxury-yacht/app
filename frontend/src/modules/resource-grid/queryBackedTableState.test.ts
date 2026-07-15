import type { GridTableFilterState } from '@shared/components/tables/GridTable';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { describe, expect, it } from 'vitest';
import {
  excludeQueryFacetsFromFilterOptions,
  excludeQueryFacetsFromTableState,
  normalizeQueryBackedNamespaceQueryFilters,
  queryBackedFacetFilterOptions,
  removeQueryBackedNamespaceFilterSentinels,
} from './queryBackedTableState';

describe('queryBackedTableState', () => {
  it('excludes selected query facets from both controls and backend query state', () => {
    const options = excludeQueryFacetsFromFilterOptions(
      {
        queryFacets: [
          { key: 'statuses', label: 'Status', placeholder: 'All statuses', options: [] },
          { key: 'nodes', label: 'Node', placeholder: 'All nodes', options: [] },
        ],
      },
      ['statuses']
    );
    const state = excludeQueryFacetsFromTableState(
      {
        filters: {
          ...DEFAULT_GRID_TABLE_FILTER_STATE,
          queryFacets: {
            statuses: { mode: 'some', values: ['Running'] },
            nodes: { mode: 'some', values: ['node-a'] },
          },
        },
        sortConfig: { key: 'name', direction: 'asc' },
      },
      ['statuses']
    );

    expect(options.queryFacets?.map((facet) => facet.key)).toEqual(['nodes']);
    expect(state.filters.queryFacets).toEqual({
      nodes: { mode: 'some', values: ['node-a'] },
    });
  });

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
    const filters: GridTableFilterState = {
      ...DEFAULT_GRID_TABLE_FILTER_STATE,
      namespaces: { mode: 'some', values: ['team-b', 'team-a'] },
    };

    expect(removeQueryBackedNamespaceFilterSentinels(filters)).toBe(filters);
  });

  it('omits an explicit all-namespace selection from the backend query', () => {
    expect(
      normalizeQueryBackedNamespaceQueryFilters(
        {
          ...DEFAULT_GRID_TABLE_FILTER_STATE,
          namespaces: { mode: 'some', values: ['team-b', 'team-a'] },
        },
        ['team-a', 'team-b']
      )
    ).toEqual({
      ...DEFAULT_GRID_TABLE_FILTER_STATE,
      namespaces: { mode: 'all' },
    });
  });

  it('drops persisted all-namespace sentinel values before building query scope state', () => {
    expect(
      removeQueryBackedNamespaceFilterSentinels({
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        namespaces: { mode: 'some', values: ['namespace:all'] },
      })
    ).toEqual({
      ...DEFAULT_GRID_TABLE_FILTER_STATE,
      namespaces: { mode: 'all' },
    });
  });

  it('preserves real namespace subsets', () => {
    const filters: GridTableFilterState = {
      ...DEFAULT_GRID_TABLE_FILTER_STATE,
      namespaces: { mode: 'some', values: ['team-a'] },
    };

    expect(removeQueryBackedNamespaceFilterSentinels(filters)).toBe(filters);
  });
});
