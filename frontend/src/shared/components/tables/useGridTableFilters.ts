/**
 * frontend/src/shared/components/tables/useGridTableFilters.ts
 *
 * React hook for useGridTableFilters.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import type {
  GridTableFilterAccessors,
  GridTableFilterConfig,
  GridTableFilterState,
  InternalFilterOptions,
} from '@shared/components/tables/GridTable.types';

const DEFAULT_FILTER_STATE: GridTableFilterState = {
  search: '',
  kinds: [],
  namespaces: [],
};

const normalizeFilterArray = (values?: string[]): string[] => {
  if (!values || values.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const emptyKey = '__empty__';
  const result: string[] = [];
  for (const raw of values) {
    if (typeof raw !== 'string') {
      continue;
    }
    const trimmed = raw.trim();
    const normalized = trimmed !== '' ? trimmed : '';
    if (normalized === '') {
      if (!seen.has(emptyKey)) {
        seen.add(emptyKey);
        result.push('');
      }
      continue;
    }
    const lowered = normalized.toLowerCase();
    if (!seen.has(lowered)) {
      seen.add(lowered);
      result.push(trimmed);
    }
  }
  return result;
};

const normalizeFilterState = (state?: Partial<GridTableFilterState>): GridTableFilterState => ({
  search: state?.search?.trim() ?? '',
  kinds: normalizeFilterArray(state?.kinds),
  namespaces: normalizeFilterArray(state?.namespaces),
});

const areFilterStatesEqual = (a: GridTableFilterState, b: GridTableFilterState): boolean =>
  a.search === b.search &&
  a.kinds.length === b.kinds.length &&
  a.namespaces.length === b.namespaces.length &&
  a.kinds.every((value, index) => value === b.kinds[index]) &&
  a.namespaces.every((value, index) => value === b.namespaces[index]);

export interface UseGridTableFiltersParams<T> {
  data: T[];
  filters?: GridTableFilterConfig<T>;
  defaultGetKind: (row: T) => string | null;
  defaultGetNamespace: (row: T) => string | null;
  defaultGetSearchText: (row: T) => string[];
}

export interface UseGridTableFiltersResult<T> {
  filteringEnabled: boolean;
  tableData: T[];
  activeFilters: GridTableFilterState;
  filterSignature: string;
  resolvedFilterOptions: InternalFilterOptions;
  handleFilterSearchChange: (value: string) => void;
  handleFilterKindsChange: (values: string[]) => void;
  handleFilterNamespacesChange: (values: string[]) => void;
  handleFilterReset: () => void;
}

export function useGridTableFilters<T>({
  data,
  filters,
  defaultGetKind,
  defaultGetNamespace,
  defaultGetSearchText,
}: UseGridTableFiltersParams<T>): UseGridTableFiltersResult<T> {
  const filteringEnabled = Boolean(filters?.enabled);
  const isControlled = filteringEnabled && filters?.value !== undefined;

  const [internalFilters, setInternalFilters] = useState<GridTableFilterState>(() =>
    normalizeFilterState(filters?.initial)
  );

  useEffect(() => {
    if (!filteringEnabled || isControlled || !filters?.initial) {
      return;
    }
    setInternalFilters(normalizeFilterState(filters.initial));
  }, [filteringEnabled, isControlled, filters?.initial]);

  const activeFilters = useMemo(() => {
    if (!filteringEnabled) {
      return DEFAULT_FILTER_STATE;
    }
    return normalizeFilterState(isControlled ? filters!.value : internalFilters);
  }, [filteringEnabled, isControlled, filters, internalFilters]);

  const filterSignature = useMemo(
    () => (filteringEnabled ? JSON.stringify(activeFilters) : ''),
    [filteringEnabled, activeFilters]
  );

  const setFiltersState = useCallback(
    (next: GridTableFilterState) => {
      filters?.onChange?.(next);
      if (!isControlled) {
        setInternalFilters(next);
      }
    },
    [filters, isControlled]
  );

  const filterAccessors = useMemo<GridTableFilterAccessors<T>>(() => {
    const getKind = filters?.accessors?.getKind ?? ((row: T) => defaultGetKind(row) ?? null);
    const getNamespace =
      filters?.accessors?.getNamespace ?? ((row: T) => defaultGetNamespace(row) ?? null);
    const getSearchText =
      filters?.accessors?.getSearchText ?? ((row: T) => defaultGetSearchText(row));

    return {
      getKind,
      getNamespace,
      getSearchText,
    };
  }, [filters?.accessors, defaultGetKind, defaultGetNamespace, defaultGetSearchText]);

  const resolvedFilterOptions = useMemo<InternalFilterOptions>(() => {
    const searchPlaceholder = filters?.options?.searchPlaceholder;
    const customActions = filters?.options?.customActions;
    if (!filteringEnabled) {
      return {
        searchPlaceholder,
        kinds: [],
        namespaces: [],
        customActions,
      };
    }

    const kindMap = new Map<string, DropdownOption>();
    const namespaceMap = new Map<string, DropdownOption>();
    const includeClusterScoped = filters?.options?.includeClusterScopedSyntheticNamespace ?? false;
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

    const providedKinds = filters?.options?.kinds;
    if (providedKinds && providedKinds.length > 0) {
      providedKinds.forEach((value) => addKind(value));
    } else {
      for (const row of data) {
        addKind(filterAccessors.getKind?.(row) ?? defaultGetKind(row));
      }
    }

    const providedNamespaces = filters?.options?.namespaces;
    if (providedNamespaces && providedNamespaces.length > 0) {
      providedNamespaces.forEach((value) => addNamespace(value));
    } else {
      for (const row of data) {
        addNamespace(filterAccessors.getNamespace?.(row) ?? defaultGetNamespace(row));
      }
    }

    const kinds = Array.from(kindMap.values()).sort((a, b) => a.label.localeCompare(b.label));
    const namespaces = Array.from(namespaceMap.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    // Insert a non-selectable separator only when the cluster-scoped option is shown.
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
      searchPlaceholder,
      kinds,
      namespaces: namespaceOptions,
      customActions,
    };
  }, [
    filteringEnabled,
    filters?.options,
    data,
    filterAccessors,
    defaultGetKind,
    defaultGetNamespace,
  ]);

  const tableData = useMemo(() => {
    if (!filteringEnabled || data.length === 0) {
      return data;
    }

    const searchNeedle = activeFilters.search.trim().toLowerCase();
    const shouldFilterSearch = searchNeedle.length > 0;
    const kindSet = new Set(activeFilters.kinds.map((value) => value.toLowerCase()));
    const namespaceSet = new Set(activeFilters.namespaces.map((value) => value.toLowerCase()));
    const shouldFilterKinds = kindSet.size > 0;
    const shouldFilterNamespaces = namespaceSet.size > 0;

    return data.filter((row) => {
      const kindValueRaw = filterAccessors.getKind?.(row) ?? defaultGetKind(row);
      const kindValue = typeof kindValueRaw === 'string' ? kindValueRaw.trim() : '';
      if (shouldFilterKinds && (!kindValue || !kindSet.has(kindValue.toLowerCase()))) {
        return false;
      }

      const namespaceValueRaw = filterAccessors.getNamespace?.(row) ?? defaultGetNamespace(row);
      const namespaceCandidate =
        typeof namespaceValueRaw === 'string' ? namespaceValueRaw.trim() : '';
      const normalizedNamespace = namespaceCandidate === '—' ? '' : namespaceCandidate;

      if (shouldFilterNamespaces && !namespaceSet.has(normalizedNamespace.toLowerCase())) {
        return false;
      }

      if (!shouldFilterSearch) {
        return true;
      }

      const searchValuesRaw = filterAccessors.getSearchText?.(row) ?? defaultGetSearchText(row);
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
          typeof candidate === 'string' && candidate.toLowerCase().includes(searchNeedle)
      );
    });
  }, [
    filteringEnabled,
    data,
    activeFilters,
    filterAccessors,
    defaultGetKind,
    defaultGetNamespace,
    defaultGetSearchText,
  ]);

  const updateFilters = useCallback(
    (changes: Partial<GridTableFilterState>) => {
      if (!filteringEnabled) {
        return;
      }
      const nextState = normalizeFilterState({
        ...activeFilters,
        ...changes,
      });
      if (areFilterStatesEqual(nextState, activeFilters)) {
        return;
      }
      setFiltersState(nextState);
    },
    [filteringEnabled, activeFilters, setFiltersState]
  );

  const handleFilterSearchChange = useCallback(
    (value: string) => {
      updateFilters({ search: value });
    },
    [updateFilters]
  );

  const handleFilterKindsChange = useCallback(
    (next: string[]) => {
      updateFilters({ kinds: next });
    },
    [updateFilters]
  );

  const handleFilterNamespacesChange = useCallback(
    (next: string[]) => {
      updateFilters({ namespaces: next });
    },
    [updateFilters]
  );

  const handleFilterReset = useCallback(() => {
    if (!filteringEnabled) {
      return;
    }
    setFiltersState(DEFAULT_FILTER_STATE);
    filters?.onReset?.();
  }, [filteringEnabled, setFiltersState, filters]);

  return {
    filteringEnabled,
    tableData,
    activeFilters,
    filterSignature,
    resolvedFilterOptions,
    handleFilterSearchChange,
    handleFilterKindsChange,
    handleFilterNamespacesChange,
    handleFilterReset,
  };
}
