import type { SortConfig } from '@hooks/useTableSort';

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { ALL_MULTISELECT_FILTER } from '@shared/components/dropdowns/multiSelectFilterSelection';
import type {
  GridTableFilterOptions,
  GridTableFilterState,
} from '@shared/components/tables/GridTable';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { useCallback, useState } from 'react';

export interface QueryBackedTableState {
  filters: GridTableFilterState;
  sortConfig: SortConfig | null;
}

export function useQueryBackedTableState(defaultSort: SortConfig): {
  tableState: QueryBackedTableState;
  handleTableStateChange: (next: QueryBackedTableState) => void;
} {
  const [tableState, setTableState] = useState<QueryBackedTableState>({
    filters: DEFAULT_GRID_TABLE_FILTER_STATE,
    sortConfig: defaultSort,
  });

  const handleTableStateChange = useCallback((next: QueryBackedTableState) => {
    setTableState((previous) => (queryBackedTableStateEquals(previous, next) ? previous : next));
  }, []);

  return { tableState, handleTableStateChange };
}

export function mergeQueryBackedFilterOptions(
  base: Partial<GridTableFilterOptions> | undefined,
  query: Partial<GridTableFilterOptions>
): Partial<GridTableFilterOptions> {
  return {
    ...base,
    ...query,
  };
}

export function excludeQueryFacetsFromFilterOptions(
  options: Partial<GridTableFilterOptions>,
  excludedKeys: readonly string[] | undefined
): Partial<GridTableFilterOptions> {
  if (!excludedKeys?.length || !options.queryFacets?.length) {
    return options;
  }
  const excluded = new Set(excludedKeys);
  const queryFacets = options.queryFacets.filter((facet) => !excluded.has(facet.key));
  if (queryFacets.length === options.queryFacets.length) {
    return options;
  }
  return {
    ...options,
    queryFacets: queryFacets.length > 0 ? queryFacets : undefined,
  };
}

export function excludeQueryFacetsFromTableState(
  state: QueryBackedTableState,
  excludedKeys: readonly string[] | undefined
): QueryBackedTableState {
  if (!excludedKeys?.length || !state.filters.queryFacets) {
    return state;
  }
  const excluded = new Set(excludedKeys);
  const queryFacets = Object.fromEntries(
    Object.entries(state.filters.queryFacets).filter(([key]) => !excluded.has(key))
  );
  if (Object.keys(queryFacets).length === Object.keys(state.filters.queryFacets).length) {
    return state;
  }
  const { queryFacets: _excludedQueryFacets, ...filters } = state.filters;
  return {
    ...state,
    filters: {
      ...filters,
      ...(Object.keys(queryFacets).length > 0 ? { queryFacets } : {}),
    },
  };
}

const normalizeOptionSet = (values: string[] | undefined): Set<string> =>
  new Set((values ?? []).map((value) => value.trim()).filter(Boolean));

const isAllNamespacesFilterSentinel = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return normalized === ALL_NAMESPACES_SCOPE || normalized === 'all' || normalized === '*';
};

/**
 * Picks the option list for a faceted filter dimension (namespaces, kinds).
 * Backend facets are computed AFTER the dimension's own filter is applied, so
 * once a value is selected the facets collapse to just that value — the
 * explicit metadata list (namespace context, the view's static kind
 * vocabulary) must win whenever it knows more than the loaded rows do.
 */
export function queryBackedFacetFilterOptions(
  explicitValues: string[] | undefined,
  queryFacetValues: string[] | undefined,
  fallbackValues: string[] | undefined = undefined
): string[] | undefined {
  if (!explicitValues || explicitValues.length === 0) {
    return queryFacetValues;
  }
  if (!queryFacetValues || queryFacetValues.length === 0) {
    return explicitValues;
  }
  const explicit = normalizeOptionSet(explicitValues);
  const fallback = normalizeOptionSet(fallbackValues);
  const explicitHasMetadataBeyondFallback =
    fallback.size === 0 ||
    explicit.size > fallback.size ||
    [...explicit].some((value) => !fallback.has(value));
  return explicitHasMetadataBeyondFallback ? explicitValues : queryFacetValues;
}

export function removeQueryBackedNamespaceFilterSentinels(
  filters: GridTableFilterState
): GridTableFilterState {
  if (filters.namespaces.mode !== 'some') {
    return filters;
  }
  const namespaceFilters = filters.namespaces.values.filter(
    (namespace) => !isAllNamespacesFilterSentinel(namespace)
  );
  return namespaceFilters.length === filters.namespaces.values.length
    ? filters
    : {
        ...filters,
        namespaces:
          namespaceFilters.length > 0
            ? { mode: 'some', values: namespaceFilters }
            : ALL_MULTISELECT_FILTER,
      };
}

export function normalizeQueryBackedNamespaceQueryFilters(
  filters: GridTableFilterState,
  availableNamespaces: string[] | undefined
): GridTableFilterState {
  const available = normalizeOptionSet(availableNamespaces);
  if (filters.namespaces.mode !== 'some') {
    return filters;
  }
  const selected = normalizeOptionSet(filters.namespaces.values);
  if (available.size === 0 || selected.size !== available.size) {
    return filters;
  }
  for (const namespace of available) {
    if (!selected.has(namespace)) {
      return filters;
    }
  }
  return { ...filters, namespaces: ALL_MULTISELECT_FILTER };
}

function queryBackedTableStateEquals(left: QueryBackedTableState, right: QueryBackedTableState) {
  return (
    left.sortConfig?.key === right.sortConfig?.key &&
    left.sortConfig?.direction === right.sortConfig?.direction &&
    JSON.stringify(left.filters) === JSON.stringify(right.filters)
  );
}
