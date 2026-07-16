import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import type {
  GridTableFilterAccessors,
  GridTableFilterOptions,
  GridTableFilterState,
  InternalFilterOptions,
} from '@shared/components/tables/GridTable.types';
import { isTableNoValueText } from '@shared/components/tables/tableNoValue';

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
    getCluster: accessors?.getCluster,
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
    namespaceDropdownSearchable: options?.namespaceDropdownSearchable ?? false,
    namespaceDropdownBulkActions: options?.namespaceDropdownBulkActions ?? false,
    clusterDropdownSearchable: options?.clusterDropdownSearchable ?? false,
    clusterDropdownBulkActions: options?.clusterDropdownBulkActions ?? false,
    beforeNamespaceActions: options?.beforeNamespaceActions,
    queryFacets: options?.searchBehavior === 'query' ? (options.queryFacets ?? []) : [],
    preActions: options?.preActions,
    postActions: options?.postActions,
    customActions: options?.customActions,
    totalIsExact: options?.totalIsExact ?? true,
    partialDataLabel: options?.partialDataLabel,
  };

  if (!filteringEnabled) {
    return {
      ...baseOptions,
      kinds: [],
      namespaces: [],
      clusters: [],
      queryFacets: [],
    };
  }

  const includeClusterScoped = options?.includeClusterScopedSyntheticNamespace ?? false;
  const queryBacked = baseOptions.searchBehavior === 'query';
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
      provided.forEach((value) => {
        addOption(map, value, normalize);
      });
    } else if (!queryBacked) {
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
    (value) => (isTableNoValueText(value) ? '' : value)
  );
  const clusterMap = new Map<string, DropdownOption>();
  if (!queryBacked && options?.clusters?.length) {
    for (const option of options.clusters) {
      const value = option.value.trim();
      if (!value) {
        continue;
      }
      const key = value;
      if (!clusterMap.has(key)) {
        clusterMap.set(key, { ...option, value, label: option.label.trim() || value });
      }
    }
  } else if (!queryBacked) {
    for (const row of data) {
      addOption(clusterMap, accessors.getCluster?.(row), (value) => value);
    }
  }
  const clusters = Array.from(clusterMap.values()).sort((a, b) => a.label.localeCompare(b.label));
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
    clusters,
  };
}

interface ApplyGridTableFiltersParams<T> {
  filteringEnabled: boolean;
  searchBehavior?: 'local' | 'query';
  data: T[];
  activeFilters: GridTableFilterState;
  accessors: GridTableFilterAccessors<T>;
  defaultGetKind: (row: T) => string | null;
  defaultGetNamespace: (row: T) => string | null;
  defaultGetSearchText: (row: T) => string[];
}

export function applyGridTableFilters<T>({
  filteringEnabled,
  searchBehavior = 'local',
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

  if (searchBehavior === 'query') {
    return data;
  }

  if (
    activeFilters.kinds.mode === 'none' ||
    activeFilters.namespaces.mode === 'none' ||
    activeFilters.clusters.mode === 'none'
  ) {
    return [];
  }

  const searchNeedle = activeFilters.caseSensitive
    ? activeFilters.search.trim()
    : activeFilters.search.trim().toLowerCase();
  const shouldFilterSearch = searchNeedle.length > 0;
  const kindSet = new Set(
    activeFilters.kinds.mode === 'some'
      ? activeFilters.kinds.values.map((value) => value.toLowerCase())
      : []
  );
  const namespaceSet = new Set(
    activeFilters.namespaces.mode === 'some'
      ? activeFilters.namespaces.values.map((value) => value.toLowerCase())
      : []
  );
  const clusterSet = new Set(
    activeFilters.clusters.mode === 'some' ? activeFilters.clusters.values : []
  );
  const shouldFilterKinds = activeFilters.kinds.mode === 'some';
  const shouldFilterNamespaces = activeFilters.namespaces.mode === 'some';
  const shouldFilterClusters = activeFilters.clusters.mode === 'some';

  return data.filter((row) => {
    const clusterValueRaw = accessors.getCluster?.(row);
    const clusterValue = typeof clusterValueRaw === 'string' ? clusterValueRaw.trim() : '';
    if (shouldFilterClusters && (!clusterValue || !clusterSet.has(clusterValue))) {
      return false;
    }

    const kindValueRaw = accessors.getKind?.(row) ?? defaultGetKind(row);
    const kindValue = typeof kindValueRaw === 'string' ? kindValueRaw.trim() : '';
    if (shouldFilterKinds && (!kindValue || !kindSet.has(kindValue.toLowerCase()))) {
      return false;
    }

    const namespaceValueRaw = accessors.getNamespace?.(row) ?? defaultGetNamespace(row);
    const namespaceCandidate =
      typeof namespaceValueRaw === 'string' ? namespaceValueRaw.trim() : '';
    const normalizedNamespace = isTableNoValueText(namespaceCandidate) ? '' : namespaceCandidate;

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
