/**
 * frontend/src/hooks/useTableSort.ts
 *
 * Hook for useTableSort.
 * Provides sorting functionality for tables, including special handling for age and timestamp columns.
 * Supports both controlled and uncontrolled sorting states.
 */

import { recordGridTablePerformanceSample } from '@shared/components/tables/performance/gridTablePerformanceStore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseCompactAgeToSeconds } from '@/utils/ageFormatter';

export type SortDirection = 'asc' | 'desc' | null;

export interface SortConfig {
  key: string;
  direction: SortDirection;
}

export interface UseTableSortOptions<T> {
  controlledSort?: SortConfig | null;
  onChange?: (config: SortConfig) => void;
  diagnosticsLabel?: string;
  disableLocalSort?: boolean;
  // When provided, columns with a `sortValue` accessor are used to extract
  // comparison values instead of direct property access on the row.
  columns?: ReadonlyArray<{ key: string; sortValue?: (item: T) => unknown }>;
  // Optional stable row identity used to skip full resorting when a live table
  // rerenders but the active sort values and row set are unchanged.
  rowIdentity?: (item: T, index: number) => string;
}

const getNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const areSortValuesEqual = (a: unknown, b: unknown): boolean => Object.is(a, b);

interface SortCacheEntry<T> {
  key: string;
  direction: SortDirection;
  order: string[];
  valuesByKey: Map<string, unknown>;
  sortedRows: T[];
}

interface DecoratedSortRow<T> {
  item: T;
  index: number;
  key: string | undefined;
  value: unknown;
}

interface CurrentSortRow<T> {
  item: T;
  value: unknown;
}

const NEXT_SORT_DIRECTION: Record<'asc' | 'desc' | 'none', SortDirection> = {
  asc: 'desc',
  desc: null,
  none: 'asc',
};

const getNextSortConfig = (
  previous: SortConfig,
  key: string,
  targetDirection: SortDirection | undefined,
  defaultDirection: SortDirection
): SortConfig => {
  if (targetDirection !== undefined) {
    return { key, direction: targetDirection };
  }
  if (previous.key !== key) {
    return { key, direction: defaultDirection };
  }
  return { key, direction: NEXT_SORT_DIRECTION[previous.direction ?? 'none'] };
};

const normalizeSortValue = (sortKey: string, value: unknown): unknown =>
  sortKey.toLowerCase() === 'age' && typeof value === 'string'
    ? parseCompactAgeToSeconds(value)
    : value;

const decorateSortRows = <T>(
  data: T[],
  sortKey: string,
  extractor: ((item: T) => unknown) | undefined,
  rowIdentity: ((item: T, index: number) => string) | undefined
): DecoratedSortRow<T>[] =>
  data.map((item, index) => {
    const rawValue = extractor ? extractor(item) : (item as Record<string, unknown>)[sortKey];
    return {
      item,
      index,
      key: rowIdentity?.(item, index),
      value: normalizeSortValue(sortKey, rawValue),
    };
  });

const collectReusableRowsByKey = <T>(
  decorated: DecoratedSortRow<T>[],
  previousValues: Map<string, unknown>
): Map<string, CurrentSortRow<T>> | null => {
  const currentByKey = new Map<string, CurrentSortRow<T>>();
  for (const entry of decorated) {
    if (!entry.key || currentByKey.has(entry.key)) {
      return null;
    }
    if (!areSortValuesEqual(previousValues.get(entry.key), entry.value)) {
      return null;
    }
    currentByKey.set(entry.key, { item: entry.item, value: entry.value });
  }
  return currentByKey;
};

const restoreCachedOrder = <T>(
  previousCache: SortCacheEntry<T>,
  currentByKey: Map<string, CurrentSortRow<T>>
): { rows: T[]; valuesByKey: Map<string, unknown> } | null => {
  const rows: T[] = [];
  const valuesByKey = new Map<string, unknown>();
  for (const key of previousCache.order) {
    const current = currentByKey.get(key);
    if (!current) {
      return null;
    }
    rows.push(current.item);
    valuesByKey.set(key, current.value);
  }
  return { rows, valuesByKey };
};

const preserveSortedRowsReference = <T>(rows: T[], previousRows: T[]): T[] =>
  rows.length === previousRows.length && rows.every((item, index) => item === previousRows[index])
    ? previousRows
    : rows;

const tryReuseSortCache = <T>(
  previousCache: SortCacheEntry<T> | null,
  decorated: DecoratedSortRow<T>[],
  sortConfig: SortConfig,
  rowIdentity: ((item: T, index: number) => string) | undefined
): SortCacheEntry<T> | null => {
  if (
    !rowIdentity ||
    previousCache?.key !== sortConfig.key ||
    previousCache.direction !== sortConfig.direction ||
    previousCache.order.length !== decorated.length
  ) {
    return null;
  }
  const currentByKey = collectReusableRowsByKey(decorated, previousCache.valuesByKey);
  const restored = currentByKey ? restoreCachedOrder(previousCache, currentByKey) : null;
  if (!restored) {
    return null;
  }
  return {
    ...previousCache,
    valuesByKey: restored.valuesByKey,
    sortedRows: preserveSortedRowsReference(restored.rows, previousCache.sortedRows),
  };
};

const compareNullishValues = <T>(
  first: DecoratedSortRow<T>,
  second: DecoratedSortRow<T>
): number | null => {
  const firstMissing = first.value === null || first.value === undefined;
  const secondMissing = second.value === null || second.value === undefined;
  if (firstMissing && secondMissing) {
    return first.index - second.index;
  }
  if (firstMissing) {
    return 1;
  }
  if (secondMissing) {
    return -1;
  }
  return null;
};

const comparePresentValues = (first: unknown, second: unknown, collator: Intl.Collator): number => {
  if (typeof first === 'number' && typeof second === 'number') {
    return first - second;
  }
  if (typeof first === 'string' && typeof second === 'string') {
    return collator.compare(first, second);
  }
  return collator.compare(String(first), String(second));
};

const createSortComparator = <T>(
  direction: SortDirection,
  collator: Intl.Collator
): ((first: DecoratedSortRow<T>, second: DecoratedSortRow<T>) => number) => {
  const directionMultiplier = direction === 'asc' ? 1 : -1;
  return (first, second) => {
    const missingComparison = compareNullishValues(first, second);
    if (missingComparison !== null) {
      return missingComparison;
    }
    const comparison = comparePresentValues(first.value, second.value, collator);
    return comparison !== 0 ? directionMultiplier * comparison : first.index - second.index;
  };
};

const createSortCache = <T>(
  sortedEntries: DecoratedSortRow<T>[],
  sortedRows: T[],
  sortConfig: SortConfig,
  rowIdentity: ((item: T, index: number) => string) | undefined
): SortCacheEntry<T> | null => {
  if (!rowIdentity) {
    return null;
  }
  const order: string[] = [];
  const valuesByKey = new Map<string, unknown>();
  for (const entry of sortedEntries) {
    if (!entry.key || valuesByKey.has(entry.key)) {
      return null;
    }
    order.push(entry.key);
    valuesByKey.set(entry.key, entry.value);
  }
  return { key: sortConfig.key, direction: sortConfig.direction, order, valuesByKey, sortedRows };
};

const getPassthroughDuration = <T>(
  data: T[],
  disableLocalSort: boolean,
  sortConfig: SortConfig
): number | null | undefined => {
  if (disableLocalSort || !sortConfig.key || !sortConfig.direction) {
    return null;
  }
  return data.length <= 1 ? 0 : undefined;
};

export function useTableSort<T>(
  data: T[],
  defaultSortKey?: string,
  defaultDirection: SortDirection = 'asc',
  options?: UseTableSortOptions<T>
) {
  const controlledSort = options?.controlledSort;
  const onChange = options?.onChange;
  const isControlled = controlledSort !== undefined || Boolean(onChange);
  const diagnosticsLabel = options?.diagnosticsLabel;
  const disableLocalSort = options?.disableLocalSort ?? false;
  const columns = options?.columns;
  const rowIdentity = options?.rowIdentity;
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: defaultSortKey || '',
    direction: defaultSortKey ? defaultDirection : null,
  });
  const sortDurationRef = useRef<number | null>(null);
  const sortCacheRef = useRef<SortCacheEntry<T> | null>(null);

  const effectiveSort = controlledSort ?? sortConfig;
  const stringCollator = useMemo(() => new Intl.Collator(undefined, { numeric: true }), []);

  // Sort a column. When `targetDirection` is provided the sort jumps directly
  // to that state (used by context-menu "Sort Desc" / "Clear Sort"). When
  // omitted the direction cycles: asc → desc → null → asc.
  const handleSort = (key: string, targetDirection?: SortDirection) => {
    if (isControlled) {
      const next = getNextSortConfig(
        controlledSort ?? sortConfig,
        key,
        targetDirection,
        defaultDirection
      );
      onChange?.(next);
      return;
    }

    setSortConfig((previous) =>
      getNextSortConfig(previous, key, targetDirection, defaultDirection)
    );
  };

  // Build a lookup from column key → sortValue extractor. When a column
  // defines sortValue, that function is used instead of row[key].
  const sortValueExtractors = useMemo(() => {
    if (!columns) {
      return null;
    }
    const map: Record<string, (item: T) => unknown> = {};
    for (const col of columns) {
      if (col.sortValue) {
        map[col.key] = col.sortValue as (item: T) => unknown;
      }
    }
    return Object.keys(map).length > 0 ? map : null;
  }, [columns]);

  const sortedData = useMemo(() => {
    const startedAt = getNow();
    if (!data) {
      return [];
    }
    const passthroughDuration = getPassthroughDuration(data, disableLocalSort, effectiveSort);
    if (passthroughDuration !== undefined) {
      sortDurationRef.current = passthroughDuration;
      sortCacheRef.current = null;
      return data;
    }
    const extractor = sortValueExtractors?.[effectiveSort.key];
    const decorated = decorateSortRows(data, effectiveSort.key, extractor, rowIdentity);
    const reusedCache = tryReuseSortCache(
      sortCacheRef.current,
      decorated,
      effectiveSort,
      rowIdentity
    );
    if (reusedCache) {
      sortCacheRef.current = reusedCache;
      sortDurationRef.current = getNow() - startedAt;
      return reusedCache.sortedRows;
    }
    decorated.sort(createSortComparator(effectiveSort.direction, stringCollator));
    const sortedEntries = decorated;
    const sorted = sortedEntries.map(({ item }) => item);
    sortCacheRef.current = createSortCache(sortedEntries, sorted, effectiveSort, rowIdentity);
    sortDurationRef.current = getNow() - startedAt;
    return sorted;
  }, [data, disableLocalSort, effectiveSort, rowIdentity, sortValueExtractors, stringCollator]);

  useEffect(() => {
    void sortedData;
    if (
      !diagnosticsLabel ||
      sortDurationRef.current === null ||
      sortDurationRef.current === undefined
    ) {
      return;
    }
    recordGridTablePerformanceSample(diagnosticsLabel, 'sort', sortDurationRef.current);
  }, [diagnosticsLabel, sortedData]);

  return {
    sortedData,
    sortConfig: effectiveSort,
    handleSort,
  };
}
