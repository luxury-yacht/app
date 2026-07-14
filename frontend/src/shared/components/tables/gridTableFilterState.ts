import type { GridTableFilterState } from '@shared/components/tables/GridTable.types';

export const DEFAULT_GRID_TABLE_FILTER_STATE: GridTableFilterState = {
  search: '',
  kinds: [],
  namespaces: [],
  caseSensitive: false,
  includeMetadata: false,
};

export const normalizeGridTableFilterArray = (values?: string[]): string[] => {
  if (!values || values.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    if (typeof raw !== 'string') {
      continue;
    }
    const trimmed = raw.trim();
    const key = trimmed === '' ? '__empty__' : trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
};

export const normalizeGridTableIdentityFilterArray = (values?: string[]): string[] => {
  if (!values || values.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    if (typeof raw !== 'string') {
      continue;
    }
    const value = raw.trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
};

export const normalizeGridTableQueryFacets = (
  facets?: Record<string, string[]>
): Record<string, string[]> => {
  if (!facets || typeof facets !== 'object') {
    return {};
  }
  const normalized: Record<string, string[]> = {};
  for (const rawKey of Object.keys(facets).sort()) {
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    const values = normalizeGridTableFilterArray(facets[rawKey]);
    if (values.length > 0) {
      normalized[key] = values;
    }
  }
  return normalized;
};

export const normalizeGridTableFilterState = (
  state?: Partial<GridTableFilterState>
): GridTableFilterState => {
  const queryFacets = normalizeGridTableQueryFacets(state?.queryFacets);
  const clusters = normalizeGridTableIdentityFilterArray(state?.clusters);
  return {
    search: state?.search?.trim() ?? '',
    kinds: normalizeGridTableFilterArray(state?.kinds),
    namespaces: normalizeGridTableFilterArray(state?.namespaces),
    ...(clusters.length > 0 ? { clusters } : {}),
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
  a.kinds.length === b.kinds.length &&
  a.namespaces.length === b.namespaces.length &&
  (a.clusters?.length ?? 0) === (b.clusters?.length ?? 0) &&
  a.kinds.every((value, index) => value === b.kinds[index]) &&
  a.namespaces.every((value, index) => value === b.namespaces[index]) &&
  (a.clusters ?? []).every((value, index) => value === b.clusters?.[index]) &&
  JSON.stringify(normalizeGridTableQueryFacets(a.queryFacets)) ===
    JSON.stringify(normalizeGridTableQueryFacets(b.queryFacets));

export const hasNarrowingGridTableFilters = (state: GridTableFilterState): boolean =>
  state.search.trim() !== '' ||
  state.kinds.length > 0 ||
  state.namespaces.length > 0 ||
  (state.clusters?.length ?? 0) > 0 ||
  Object.keys(normalizeGridTableQueryFacets(state.queryFacets)).length > 0;

export const hasNonDefaultGridTableFilters = (state: GridTableFilterState): boolean =>
  hasNarrowingGridTableFilters(state) || state.caseSensitive || state.includeMetadata;
