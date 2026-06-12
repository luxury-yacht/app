import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import {
  normalizeQueryBackedNamespaceFilters,
  queryBackedFacetFilterOptions,
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

  it('preserves persisted namespace filters while no namespace options are loaded', () => {
    // An empty option list means availability is UNKNOWN (cluster blip, options
    // still loading) — clearing here would permanently destroy persisted state
    // because the caller writes normalization results back to persistence.
    const filters = {
      ...DEFAULT_GRID_TABLE_FILTER_STATE,
      namespaces: ['team-a'],
    };

    expect(normalizeQueryBackedNamespaceFilters(filters, [])).toBe(filters);
  });

  it('preserves real namespace subsets', () => {
    const filters = {
      ...DEFAULT_GRID_TABLE_FILTER_STATE,
      namespaces: ['team-a'],
    };

    expect(normalizeQueryBackedNamespaceFilters(filters, ['team-a', 'team-b'])).toBe(filters);
  });
});
