/**
 * frontend/src/shared/components/tables/useGridTableFilters.ts
 *
 * React hook for useGridTableFilters.
 * Encapsulates state and side effects for the shared components.
 */

import type {
  GridTableFilterConfig,
  GridTableFilterState,
  InternalFilterOptions,
} from '@shared/components/tables/GridTable.types';
import {
  applyGridTableFilters,
  buildGridTableFilterOptions,
  resolveGridTableFilterAccessors,
} from '@shared/components/tables/gridTableFilterEngine';
import {
  areGridTableFilterStatesEqual,
  DEFAULT_GRID_TABLE_FILTER_STATE,
  normalizeGridTableFilterState,
} from '@shared/components/tables/gridTableFilterState';
import { recordGridTablePerformanceSample } from '@shared/components/tables/performance/gridTablePerformanceStore';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseGridTableFiltersParams<T> {
  data: T[];
  filters?: GridTableFilterConfig<T>;
  diagnosticsLabel?: string;
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
  /** Whether the built-in case-sensitive search toggle is active. */
  caseSensitive: boolean;
  /** Toggle the built-in case-sensitive search state. */
  toggleCaseSensitive: () => void;
}

export function useGridTableFilters<T>({
  data,
  filters,
  diagnosticsLabel,
  defaultGetKind,
  defaultGetNamespace,
  defaultGetSearchText,
}: UseGridTableFiltersParams<T>): UseGridTableFiltersResult<T> {
  const filteringEnabled = Boolean(filters?.enabled);
  const isControlled = filteringEnabled && filters?.value !== undefined;

  const [internalFilters, setInternalFilters] = useState<GridTableFilterState>(() =>
    normalizeGridTableFilterState(filters?.initial)
  );

  // Track the last-applied initial filter signature so that a new object
  // reference with identical content doesn't reset user-typed search text.
  const lastAppliedInitialRef = useRef<string>(
    filters?.initial ? JSON.stringify(normalizeGridTableFilterState(filters.initial)) : ''
  );
  const filterOptionsDurationRef = useRef<number | null>(null);
  const filterPassDurationRef = useRef<number | null>(null);

  const getNow = useCallback(
    () =>
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now(),
    []
  );

  useEffect(() => {
    if (!filteringEnabled || isControlled || !filters?.initial) {
      return;
    }
    const normalized = normalizeGridTableFilterState(filters.initial);
    const signature = JSON.stringify(normalized);
    if (signature === lastAppliedInitialRef.current) {
      return;
    }
    lastAppliedInitialRef.current = signature;
    setInternalFilters(normalized);
  }, [filteringEnabled, isControlled, filters?.initial]);

  const controlledValue = filters?.value;
  const activeFilters = useMemo(() => {
    if (!filteringEnabled) {
      return DEFAULT_GRID_TABLE_FILTER_STATE;
    }
    return normalizeGridTableFilterState(isControlled ? controlledValue : internalFilters);
  }, [filteringEnabled, isControlled, controlledValue, internalFilters]);

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

  // Toggle the case-sensitive flag through the shared filter state.
  const toggleCaseSensitive = useCallback(() => {
    const next = normalizeGridTableFilterState({
      ...activeFilters,
      caseSensitive: !activeFilters.caseSensitive,
    });
    setFiltersState(next);
  }, [activeFilters, setFiltersState]);

  const filterAccessors = useMemo(
    () =>
      resolveGridTableFilterAccessors({
        accessors: filters?.accessors,
        defaultGetKind,
        defaultGetNamespace,
        defaultGetSearchText,
      }),
    [filters?.accessors, defaultGetKind, defaultGetNamespace, defaultGetSearchText]
  );

  const resolvedFilterOptions = useMemo<InternalFilterOptions>(() => {
    const startedAt = getNow();
    const resolved = buildGridTableFilterOptions({
      filteringEnabled,
      options: filters?.options,
      data,
      accessors: filterAccessors,
      defaultGetKind,
      defaultGetNamespace,
    });
    filterOptionsDurationRef.current = getNow() - startedAt;
    return resolved;
  }, [
    filteringEnabled,
    filters?.options,
    data,
    filterAccessors,
    defaultGetKind,
    defaultGetNamespace,
    getNow,
  ]);

  const tableData = useMemo(() => {
    const startedAt = getNow();
    const filtered = applyGridTableFilters({
      filteringEnabled,
      searchBehavior: resolvedFilterOptions.searchBehavior,
      data,
      activeFilters,
      accessors: filterAccessors,
      defaultGetKind,
      defaultGetNamespace,
      defaultGetSearchText,
    });
    filterPassDurationRef.current = getNow() - startedAt;
    return filtered;
  }, [
    filteringEnabled,
    data,
    activeFilters,
    resolvedFilterOptions.searchBehavior,
    filterAccessors,
    defaultGetKind,
    defaultGetNamespace,
    defaultGetSearchText,
    getNow,
  ]);

  useEffect(() => {
    void resolvedFilterOptions;
    if (
      !diagnosticsLabel ||
      filterOptionsDurationRef.current === null ||
      filterOptionsDurationRef.current === undefined
    ) {
      return;
    }
    recordGridTablePerformanceSample(
      diagnosticsLabel,
      'filterOptions',
      filterOptionsDurationRef.current
    );
  }, [diagnosticsLabel, resolvedFilterOptions]);

  useEffect(() => {
    void tableData;
    void filterSignature;
    if (
      !diagnosticsLabel ||
      filterPassDurationRef.current === null ||
      filterPassDurationRef.current === undefined
    ) {
      return;
    }
    recordGridTablePerformanceSample(diagnosticsLabel, 'filterPass', filterPassDurationRef.current);
  }, [diagnosticsLabel, tableData, filterSignature]);

  const updateFilters = useCallback(
    (changes: Partial<GridTableFilterState>) => {
      if (!filteringEnabled) {
        return;
      }
      const nextState = normalizeGridTableFilterState({
        ...activeFilters,
        ...changes,
      });
      if (areGridTableFilterStatesEqual(nextState, activeFilters)) {
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
    setFiltersState(DEFAULT_GRID_TABLE_FILTER_STATE);
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
    caseSensitive: activeFilters.caseSensitive,
    toggleCaseSensitive,
  };
}
