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

const addDropdownOption = (
  map: Map<string, DropdownOption>,
  raw: string | null | undefined,
  normalize: (value: string) => string
): void => {
  if (typeof raw !== 'string') {
    return;
  }
  const value = normalize(raw.trim());
  const key = value.toLowerCase();
  if (value && !map.has(key)) {
    map.set(key, { value, label: value });
  }
};

const collectStringOptions = <T>(
  provided: string[] | undefined,
  data: T[],
  getValue: (row: T) => string | null | undefined,
  normalize: (value: string) => string,
  queryBacked: boolean
): DropdownOption[] => {
  const map = new Map<string, DropdownOption>();
  if (provided?.length) {
    provided.forEach((value) => {
      addDropdownOption(map, value, normalize);
    });
  } else if (!queryBacked) {
    data.forEach((row) => {
      addDropdownOption(map, getValue(row), normalize);
    });
  }
  return Array.from(map.values()).sort((first, second) => first.label.localeCompare(second.label));
};

const collectClusterOptions = <T>(
  provided: DropdownOption[] | undefined,
  data: T[],
  getCluster: ((row: T) => string | null | undefined) | undefined,
  queryBacked: boolean
): DropdownOption[] => {
  if (queryBacked) {
    return [];
  }
  const map = new Map<string, DropdownOption>();
  if (provided?.length) {
    for (const option of provided) {
      const value = option.value.trim();
      if (value && !map.has(value)) {
        map.set(value, { ...option, value, label: option.label.trim() || value });
      }
    }
  } else {
    data.forEach((row) => {
      addDropdownOption(map, getCluster?.(row), (value) => value);
    });
  }
  return Array.from(map.values()).sort((first, second) => first.label.localeCompare(second.label));
};

const buildNamespaceOptions = (
  namespaces: DropdownOption[],
  includeClusterScoped: boolean
): DropdownOption[] => {
  if (!includeClusterScoped) {
    return namespaces;
  }
  const clusterScoped = { value: '', label: 'cluster-scoped' } satisfies DropdownOption;
  if (namespaces.length === 0) {
    return [clusterScoped];
  }
  return [
    clusterScoped,
    { value: '__namespace-separator__', label: '', group: 'header' },
    ...namespaces,
  ];
};

const buildBaseFilterOptions = (options: GridTableFilterOptions | undefined) => ({
  searchBehavior: options?.searchBehavior ?? ('local' as const),
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
});

export function buildGridTableFilterOptions<T>({
  filteringEnabled,
  options,
  data,
  accessors,
  defaultGetKind,
  defaultGetNamespace,
}: BuildGridTableFilterOptionsParams<T>): InternalFilterOptions {
  const baseOptions = buildBaseFilterOptions(options);

  if (!filteringEnabled) {
    return {
      ...baseOptions,
      kinds: [],
      namespaces: [],
      clusters: [],
      queryFacets: [],
    };
  }

  const queryBacked = baseOptions.searchBehavior === 'query';
  const kinds = collectStringOptions(
    options?.kinds,
    data,
    (row) => accessors.getKind?.(row) ?? defaultGetKind(row),
    (value) => value,
    queryBacked
  );
  const namespaces = collectStringOptions(
    options?.namespaces,
    data,
    (row) => accessors.getNamespace?.(row) ?? defaultGetNamespace(row),
    (value) => (isTableNoValueText(value) ? '' : value),
    queryBacked
  );
  const clusters = collectClusterOptions(
    options?.clusters,
    data,
    accessors.getCluster,
    queryBacked
  );

  return {
    ...baseOptions,
    kinds,
    namespaces: buildNamespaceOptions(
      namespaces,
      options?.includeClusterScopedSyntheticNamespace ?? false
    ),
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

interface LocalFilterMatcher<T> {
  activeFilters: GridTableFilterState;
  accessors: GridTableFilterAccessors<T>;
  defaultGetKind: (row: T) => string | null;
  defaultGetNamespace: (row: T) => string | null;
  defaultGetSearchText: (row: T) => string[];
  searchNeedle: string;
  kindSet: Set<string>;
  namespaceSet: Set<string>;
  clusterSet: Set<string>;
  filterKinds: boolean;
  filterNamespaces: boolean;
  filterClusters: boolean;
}

const normalizeFilterValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const matchesSelection = (
  shouldFilter: boolean,
  value: string,
  selected: Set<string>,
  normalize: (value: string) => string,
  requireValue = true
): boolean => !shouldFilter || Boolean((!requireValue || value) && selected.has(normalize(value)));

const normalizeSearchValues = (values: unknown): unknown[] => {
  if (Array.isArray(values)) {
    return values.slice();
  }
  return typeof values === 'string' ? [values] : [];
};

const matchesRowSearch = <T>(
  row: T,
  kind: string,
  namespace: string,
  matcher: LocalFilterMatcher<T>
): boolean => {
  if (!matcher.searchNeedle) {
    return true;
  }
  const rawValues = matcher.accessors.getSearchText?.(row) ?? matcher.defaultGetSearchText(row);
  const searchValues = normalizeSearchValues(rawValues);
  if (kind) {
    searchValues.push(kind);
  }
  if (namespace) {
    searchValues.push(namespace);
  }
  return searchValues.some((candidate) => {
    if (typeof candidate !== 'string') {
      return false;
    }
    const comparable = matcher.activeFilters.caseSensitive ? candidate : candidate.toLowerCase();
    return comparable.includes(matcher.searchNeedle);
  });
};

const createLocalRowPredicate =
  <T>(matcher: LocalFilterMatcher<T>) =>
  (row: T): boolean => {
    const cluster = normalizeFilterValue(matcher.accessors.getCluster?.(row));
    if (!matchesSelection(matcher.filterClusters, cluster, matcher.clusterSet, (value) => value)) {
      return false;
    }
    const kind = normalizeFilterValue(
      matcher.accessors.getKind?.(row) ?? matcher.defaultGetKind(row)
    );
    if (
      !matchesSelection(matcher.filterKinds, kind, matcher.kindSet, (value) => value.toLowerCase())
    ) {
      return false;
    }
    const namespaceCandidate = normalizeFilterValue(
      matcher.accessors.getNamespace?.(row) ?? matcher.defaultGetNamespace(row)
    );
    const namespace = isTableNoValueText(namespaceCandidate) ? '' : namespaceCandidate;
    if (
      !matchesSelection(
        matcher.filterNamespaces,
        namespace,
        matcher.namespaceSet,
        (value) => value.toLowerCase(),
        false
      )
    ) {
      return false;
    }
    return matchesRowSearch(row, kind, namespace, matcher);
  };

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
  return data.filter(
    createLocalRowPredicate({
      activeFilters,
      accessors,
      defaultGetKind,
      defaultGetNamespace,
      defaultGetSearchText,
      searchNeedle,
      kindSet,
      namespaceSet,
      clusterSet,
      filterKinds: activeFilters.kinds.mode === 'some',
      filterNamespaces: activeFilters.namespaces.mode === 'some',
      filterClusters: activeFilters.clusters.mode === 'some',
    })
  );
}
