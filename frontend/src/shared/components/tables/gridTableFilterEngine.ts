import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import type {
  GridTableFilterAccessors,
  GridTableFilterOptions,
  GridTableFilterState,
  InternalFilterOptions,
} from '@shared/components/tables/GridTable.types';

interface ResolveGridTableFilterAccessorsOptions<T> {
  accessors?: GridTableFilterAccessors<T>;
  defaultGetKind: (row: T) => string | null;
  defaultGetNamespace: (row: T) => string | null;
  defaultGetSearchText: (row: T) => string[];
}

export function resolveGridTableFilterAccessors<T>({
  accessors,
  defaultGetKind,
  defaultGetNamespace,
  defaultGetSearchText,
}: ResolveGridTableFilterAccessorsOptions<T>): GridTableFilterAccessors<T> {
  return {
    getKind: accessors?.getKind ?? ((row: T) => defaultGetKind(row) ?? null),
    getNamespace: accessors?.getNamespace ?? ((row: T) => defaultGetNamespace(row) ?? null),
    getSearchText: accessors?.getSearchText ?? ((row: T) => defaultGetSearchText(row)),
  };
}

interface BuildGridTableFilterOptionsParams<T> {
  filteringEnabled: boolean;
  options?: GridTableFilterOptions;
  data: T[];
  accessors: GridTableFilterAccessors<T>;
  defaultGetKind: (row: T) => string | null;
  defaultGetNamespace: (row: T) => string | null;
}

export function buildGridTableFilterOptions<T>({
  filteringEnabled,
  options,
  data,
  accessors,
  defaultGetKind,
  defaultGetNamespace,
}: BuildGridTableFilterOptionsParams<T>): InternalFilterOptions {
  const baseOptions = {
    searchBehavior: options?.searchBehavior ?? 'local',
    searchPlaceholder: options?.searchPlaceholder,
    kindDropdownSearchable: options?.kindDropdownSearchable ?? false,
    kindDropdownBulkActions: options?.kindDropdownBulkActions ?? false,
    namespaceDropdownSearchable: options?.namespaceDropdownSearchable ?? false,
    namespaceDropdownBulkActions: options?.namespaceDropdownBulkActions ?? false,
    preActions: options?.preActions,
    postActions: options?.postActions,
    customActions: options?.customActions,
  };

  if (!filteringEnabled) {
    return {
      ...baseOptions,
      kinds: [],
      namespaces: [],
    };
  }

  const includeClusterScoped = options?.includeClusterScopedSyntheticNamespace ?? false;
  const clusterScopedOption = includeClusterScoped
    ? ({ value: '', label: 'cluster-scoped' } satisfies DropdownOption)
    : null;

  const addOption = (
    map: Map<string, DropdownOption>,
    raw: string | null | undefined,
    normalize: (value: string) => string
  ) => {
    if (typeof raw !== 'string') {
      return;
    }
    const value = normalize(raw.trim());
    if (!value) {
      return;
    }
    const key = value.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { value, label: value });
    }
  };

  const collectOptions = (
    provided: string[] | undefined,
    getValue: (row: T) => string | null | undefined,
    normalize: (value: string) => string
  ) => {
    const map = new Map<string, DropdownOption>();
    if (provided?.length) {
      provided.forEach((value) => addOption(map, value, normalize));
    } else {
      for (const row of data) {
        addOption(map, getValue(row), normalize);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  };

  const kinds = collectOptions(
    options?.kinds,
    (row) => accessors.getKind?.(row) ?? defaultGetKind(row),
    (value) => value
  );
  const namespaces = collectOptions(
    options?.namespaces,
    (row) => accessors.getNamespace?.(row) ?? defaultGetNamespace(row),
    (value) => (value === '—' ? '' : value)
  );
  const namespaceSeparator =
    clusterScopedOption && namespaces.length > 0
      ? ({
          value: '__namespace-separator__',
          label: '',
          group: 'header',
        } satisfies DropdownOption)
      : null;
  const namespaceOptions: DropdownOption[] = [];
  if (clusterScopedOption) {
    namespaceOptions.push(clusterScopedOption);
  }
  if (namespaceSeparator) {
    namespaceOptions.push(namespaceSeparator);
  }
  namespaceOptions.push(...namespaces);

  return {
    ...baseOptions,
    kinds,
    namespaces: namespaceOptions,
  };
}

interface ApplyGridTableFiltersParams<T> {
  filteringEnabled: boolean;
  data: T[];
  activeFilters: GridTableFilterState;
  accessors: GridTableFilterAccessors<T>;
  defaultGetKind: (row: T) => string | null;
  defaultGetNamespace: (row: T) => string | null;
  defaultGetSearchText: (row: T) => string[];
}

export function applyGridTableFilters<T>({
  filteringEnabled,
  data,
  activeFilters,
  accessors,
  defaultGetKind,
  defaultGetNamespace,
  defaultGetSearchText,
}: ApplyGridTableFiltersParams<T>): T[] {
  if (!filteringEnabled || data.length === 0) {
    return data;
  }

  const searchNeedle = activeFilters.caseSensitive
    ? activeFilters.search.trim()
    : activeFilters.search.trim().toLowerCase();
  const shouldFilterSearch = searchNeedle.length > 0;
  const kindSet = new Set(activeFilters.kinds.map((value) => value.toLowerCase()));
  const namespaceSet = new Set(activeFilters.namespaces.map((value) => value.toLowerCase()));
  const shouldFilterKinds = kindSet.size > 0;
  const shouldFilterNamespaces = namespaceSet.size > 0;

  return data.filter((row) => {
    const kindValueRaw = accessors.getKind?.(row) ?? defaultGetKind(row);
    const kindValue = typeof kindValueRaw === 'string' ? kindValueRaw.trim() : '';
    if (shouldFilterKinds && (!kindValue || !kindSet.has(kindValue.toLowerCase()))) {
      return false;
    }

    const namespaceValueRaw = accessors.getNamespace?.(row) ?? defaultGetNamespace(row);
    const namespaceCandidate =
      typeof namespaceValueRaw === 'string' ? namespaceValueRaw.trim() : '';
    const normalizedNamespace = namespaceCandidate === '—' ? '' : namespaceCandidate;

    if (shouldFilterNamespaces && !namespaceSet.has(normalizedNamespace.toLowerCase())) {
      return false;
    }

    if (!shouldFilterSearch) {
      return true;
    }

    const searchValuesRaw = accessors.getSearchText?.(row) ?? defaultGetSearchText(row);
    const searchValues = Array.isArray(searchValuesRaw)
      ? searchValuesRaw.slice()
      : typeof searchValuesRaw === 'string'
        ? [searchValuesRaw]
        : [];

    if (kindValue) {
      searchValues.push(kindValue);
    }
    if (normalizedNamespace) {
      searchValues.push(normalizedNamespace);
    }

    return searchValues.some(
      (candidate) =>
        typeof candidate === 'string' &&
        (activeFilters.caseSensitive
          ? candidate.includes(searchNeedle)
          : candidate.toLowerCase().includes(searchNeedle))
    );
  });
}
