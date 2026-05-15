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

export const normalizeGridTableFilterState = (
  state?: Partial<GridTableFilterState>
): GridTableFilterState => ({
  search: state?.search?.trim() ?? '',
  kinds: normalizeGridTableFilterArray(state?.kinds),
  namespaces: normalizeGridTableFilterArray(state?.namespaces),
  caseSensitive: state?.caseSensitive ?? false,
  includeMetadata: state?.includeMetadata ?? false,
});

export const areGridTableFilterStatesEqual = (
  a: GridTableFilterState,
  b: GridTableFilterState
): boolean =>
  a.search === b.search &&
  a.caseSensitive === b.caseSensitive &&
  a.includeMetadata === b.includeMetadata &&
  a.kinds.length === b.kinds.length &&
  a.namespaces.length === b.namespaces.length &&
  a.kinds.every((value, index) => value === b.kinds[index]) &&
  a.namespaces.every((value, index) => value === b.namespaces[index]);

export const hasNarrowingGridTableFilters = (state: GridTableFilterState): boolean =>
  state.search.trim() !== '' || state.kinds.length > 0 || state.namespaces.length > 0;

export const hasNonDefaultGridTableFilters = (state: GridTableFilterState): boolean =>
  hasNarrowingGridTableFilters(state) || state.caseSensitive || state.includeMetadata;
