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
  const searchBehavior = options?.searchBehavior ?? 'local';
  const searchPlaceholder = options?.searchPlaceholder;
  const kindDropdownSearchable = options?.kindDropdownSearchable ?? false;
  const kindDropdownBulkActions = options?.kindDropdownBulkActions ?? false;
  const namespaceDropdownSearchable = options?.namespaceDropdownSearchable ?? false;
  const namespaceDropdownBulkActions = options?.namespaceDropdownBulkActions ?? false;
  const preActions = options?.preActions;
  const postActions = options?.postActions;
  const customActions = options?.customActions;

  if (!filteringEnabled) {
    return {
      searchBehavior,
      searchPlaceholder,
      kindDropdownSearchable,
      kindDropdownBulkActions,
      namespaceDropdownSearchable,
      namespaceDropdownBulkActions,
      kinds: [],
      namespaces: [],
      preActions,
      postActions,
      customActions,
    };
  }

  const kindMap = new Map<string, DropdownOption>();
  const namespaceMap = new Map<string, DropdownOption>();
  const includeClusterScoped = options?.includeClusterScopedSyntheticNamespace ?? false;
  const clusterScopedOption = includeClusterScoped
    ? ({ value: '', label: 'cluster-scoped' } satisfies DropdownOption)
    : null;

  const addKind = (raw: string | null | undefined) => {
    if (typeof raw !== 'string') {
      return;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      return;
    }
    const lower = trimmed.toLowerCase();
    if (!kindMap.has(lower)) {
      kindMap.set(lower, { value: trimmed, label: trimmed });
    }
  };

  const addNamespace = (raw: string | null | undefined) => {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value || value === '—') {
      return;
    }
    const lower = value.toLowerCase();
    if (!namespaceMap.has(lower)) {
      namespaceMap.set(lower, { value, label: value });
    }
  };

  const providedKinds = options?.kinds;
  if (providedKinds && providedKinds.length > 0) {
    providedKinds.forEach((value) => addKind(value));
  } else {
    for (const row of data) {
      addKind(accessors.getKind?.(row) ?? defaultGetKind(row));
    }
  }

  const providedNamespaces = options?.namespaces;
  if (providedNamespaces && providedNamespaces.length > 0) {
    providedNamespaces.forEach((value) => addNamespace(value));
  } else {
    for (const row of data) {
      addNamespace(accessors.getNamespace?.(row) ?? defaultGetNamespace(row));
    }
  }

  const kinds = Array.from(kindMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  const namespaces = Array.from(namespaceMap.values()).sort((a, b) =>
    a.label.localeCompare(b.label)
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
    searchBehavior,
    searchPlaceholder,
    kindDropdownSearchable,
    kindDropdownBulkActions,
    namespaceDropdownSearchable,
    namespaceDropdownBulkActions,
    kinds,
    namespaces: namespaceOptions,
    preActions,
    postActions,
    customActions,
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
