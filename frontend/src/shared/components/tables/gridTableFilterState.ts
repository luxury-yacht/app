import {
  ALL_MULTISELECT_FILTER,
  isNarrowingFilterSelection,
  type MultiSelectFilterSelection,
  normalizeExactMultiSelectFilterSelection,
  normalizeMultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import type { GridTableFilterState } from '@shared/components/tables/GridTable.types';

export const DEFAULT_GRID_TABLE_FILTER_STATE: GridTableFilterState = {
  search: '',
  kinds: ALL_MULTISELECT_FILTER,
  namespaces: ALL_MULTISELECT_FILTER,
  clusters: ALL_MULTISELECT_FILTER,
  caseSensitive: false,
  includeMetadata: false,
};

export const normalizeGridTableQueryFacets = (
  facets?: Record<string, MultiSelectFilterSelection>
): Record<string, MultiSelectFilterSelection> => {
  if (!facets || typeof facets !== 'object') {
    return {};
  }
  const normalized: Record<string, MultiSelectFilterSelection> = {};
  for (const rawKey of Object.keys(facets).sort()) {
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    const selection = normalizeMultiSelectFilterSelection(facets[rawKey]);
    if (selection.mode !== 'all') {
      normalized[key] = selection;
    }
  }
  return normalized;
};

export const normalizeGridTableFilterState = (
  state?: Partial<GridTableFilterState>
): GridTableFilterState => {
  const queryFacets = normalizeGridTableQueryFacets(state?.queryFacets);
  return {
    search: state?.search?.trim() ?? '',
    kinds: normalizeMultiSelectFilterSelection(state?.kinds ?? ALL_MULTISELECT_FILTER),
    namespaces: normalizeMultiSelectFilterSelection(state?.namespaces ?? ALL_MULTISELECT_FILTER),
    clusters: normalizeExactMultiSelectFilterSelection(state?.clusters ?? ALL_MULTISELECT_FILTER),
    ...(Object.keys(queryFacets).length > 0 ? { queryFacets } : {}),
    caseSensitive: state?.caseSensitive ?? false,
    includeMetadata: state?.includeMetadata ?? false,
  };
};

export const areGridTableFilterStatesEqual = (
  a: GridTableFilterState,
  b: GridTableFilterState
): boolean =>
  a.search === b.search &&
  a.caseSensitive === b.caseSensitive &&
  a.includeMetadata === b.includeMetadata &&
  JSON.stringify(normalizeMultiSelectFilterSelection(a.kinds)) ===
    JSON.stringify(normalizeMultiSelectFilterSelection(b.kinds)) &&
  JSON.stringify(normalizeMultiSelectFilterSelection(a.namespaces)) ===
    JSON.stringify(normalizeMultiSelectFilterSelection(b.namespaces)) &&
  JSON.stringify(normalizeExactMultiSelectFilterSelection(a.clusters)) ===
    JSON.stringify(normalizeExactMultiSelectFilterSelection(b.clusters)) &&
  JSON.stringify(normalizeGridTableQueryFacets(a.queryFacets)) ===
    JSON.stringify(normalizeGridTableQueryFacets(b.queryFacets));

export const hasNarrowingGridTableFilters = (state: GridTableFilterState): boolean =>
  state.search.trim() !== '' ||
  isNarrowingFilterSelection(state.kinds) ||
  isNarrowingFilterSelection(state.namespaces) ||
  isNarrowingFilterSelection(state.clusters) ||
  Object.keys(normalizeGridTableQueryFacets(state.queryFacets)).length > 0;

export const hasNonDefaultGridTableFilters = (state: GridTableFilterState): boolean =>
  hasNarrowingGridTableFilters(state) || state.caseSensitive || state.includeMetadata;
