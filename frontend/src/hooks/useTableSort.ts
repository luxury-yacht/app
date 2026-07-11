/**
 * frontend/src/hooks/useTableSort.ts
 *
 * Hook for useTableSort.
 * Provides sorting functionality for tables, including special handling for age and timestamp columns.
 * Supports both controlled and uncontrolled sorting states.
 */

import { recordGridTablePerformanceSample } from '@shared/components/tables/performance/gridTablePerformanceStore';
import { useEffect, useMemo, useRef, useState } from 'react';

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

// Parse Kubernetes-style age strings into seconds for sorting.
const parseAge = (ageStr: string): number => {
  if (!ageStr || ageStr === '-') {
    return 0;
  }

  const units: Record<string, number> = {
    y: 365 * 86400,
    mo: 30 * 86400,
    d: 86400,
    h: 3600,
    m: 60,
    s: 1,
  };

  let totalSeconds = 0;
  const matches = ageStr.match(/(\d+)(y|mo|d|h|m|s)/g);

  if (matches) {
    for (const match of matches) {
      const matchResult = match.match(/(\d+)(y|mo|d|h|m|s)/);
      if (matchResult) {
        const [, num, unit] = matchResult;
        if (num && unit && units[unit]) {
          totalSeconds += Number.parseInt(num, 10) * units[unit];
        }
      }
    }
  }

  return totalSeconds;
};

interface SortCacheEntry<T> {
  key: string;
  direction: SortDirection;
  order: string[];
  valuesByKey: Map<string, unknown>;
  sortedRows: T[];
}

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
    const computeNext = (prev: SortConfig): SortConfig => {
      if (targetDirection !== undefined) {
        return { key, direction: targetDirection };
      }
      if (prev.key === key) {
        const nextDirection =
          prev.direction === 'asc' ? 'desc' : prev.direction === 'desc' ? null : 'asc';
        return { key, direction: nextDirection };
      }
      return { key, direction: defaultDirection };
    };

    if (isControlled) {
      const next = computeNext(controlledSort ?? sortConfig);
      onChange?.(next);
      return;
    }

    setSortConfig((prevConfig) => computeNext(prevConfig));
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

    // Handle null or undefined data
    if (!data) {
      return [];
    }

    if (disableLocalSort) {
      sortDurationRef.current = null;
      sortCacheRef.current = null;
      return data;
    }

    if (!effectiveSort.key || !effectiveSort.direction) {
      sortDurationRef.current = null;
      sortCacheRef.current = null;
      return data;
    }

    if (data.length <= 1) {
      sortDurationRef.current = 0;
      sortCacheRef.current = null;
      return data;
    }

    const extractor = sortValueExtractors?.[effectiveSort.key];
    const directionMultiplier = effectiveSort.direction === 'asc' ? 1 : -1;
    const keyByItem = new Map<T, string>();
    const decorated = data.map((item, index) => {
      const rawValue = extractor
        ? extractor(item)
        : (item as Record<string, unknown>)[effectiveSort.key];
      const normalizedValue =
        effectiveSort.key.toLowerCase() === 'age' && typeof rawValue === 'string'
          ? parseAge(rawValue)
          : rawValue;
      const key = rowIdentity?.(item, index);
      if (key) {
        keyByItem.set(item, key);
      }
      return {
        item,
        index,
        key,
        value: normalizedValue,
      };
    });

    const previousCache = sortCacheRef.current;
    if (
      rowIdentity &&
      previousCache &&
      previousCache.key === effectiveSort.key &&
      previousCache.direction === effectiveSort.direction &&
      previousCache.order.length === decorated.length
    ) {
      const currentByKey = new Map<string, { item: T; value: unknown }>();
      let canReusePreviousOrder = true;

      for (const entry of decorated) {
        if (!entry.key || currentByKey.has(entry.key)) {
          canReusePreviousOrder = false;
          break;
        }
        currentByKey.set(entry.key, { item: entry.item, value: entry.value });
        if (!areSortValuesEqual(previousCache.valuesByKey.get(entry.key), entry.value)) {
          canReusePreviousOrder = false;
        }
      }

      if (canReusePreviousOrder) {
        const orderedRows: T[] = [];
        const nextValuesByKey = new Map<string, unknown>();

        for (const key of previousCache.order) {
          const current = currentByKey.get(key);
          if (!current) {
            canReusePreviousOrder = false;
            break;
          }
          orderedRows.push(current.item);
          nextValuesByKey.set(key, current.value);
        }

        if (canReusePreviousOrder) {
          const reusedRows =
            orderedRows.length === previousCache.sortedRows.length &&
            orderedRows.every((item, index) => item === previousCache.sortedRows[index])
              ? previousCache.sortedRows
              : orderedRows;

          sortCacheRef.current = {
            key: effectiveSort.key,
            direction: effectiveSort.direction,
            order: previousCache.order,
            valuesByKey: nextValuesByKey,
            sortedRows: reusedRows,
          };
          sortDurationRef.current = getNow() - startedAt;
          return reusedRows;
        }
      }
    }

    const sorted = decorated
      .sort((a, b) => {
        const aValue = a.value;
        const bValue = b.value;

        // Handle null/undefined values
        if (
          (aValue === null || aValue === undefined) &&
          (bValue === null || bValue === undefined)
        ) {
          return a.index - b.index;
        }
        if (aValue === null || aValue === undefined) {
          return 1;
        }
        if (bValue === null || bValue === undefined) {
          return -1;
        }

        // Special handling for timestamp columns (if they exist)
        if (
          effectiveSort.key === 'timestamp' &&
          typeof aValue === 'number' &&
          typeof bValue === 'number'
        ) {
          const comparison = aValue - bValue;
          return comparison !== 0 ? directionMultiplier * comparison : a.index - b.index;
        }

        // Compare values
        let comparison = 0;
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          comparison = stringCollator.compare(aValue, bValue);
        } else if (typeof aValue === 'number' && typeof bValue === 'number') {
          comparison = aValue - bValue;
        } else {
          comparison = stringCollator.compare(String(aValue), String(bValue));
        }

        return comparison !== 0 ? directionMultiplier * comparison : a.index - b.index;
      })
      .map(({ item }) => item);

    if (rowIdentity) {
      const order: string[] = [];
      const valuesByKey = new Map<string, unknown>();
      let cacheable = true;

      for (const entry of decorated) {
        if (!entry.key || valuesByKey.has(entry.key)) {
          cacheable = false;
          break;
        }
        valuesByKey.set(entry.key, entry.value);
      }

      if (cacheable) {
        for (const row of sorted) {
          const key = keyByItem.get(row);
          if (!key || !valuesByKey.has(key)) {
            cacheable = false;
            break;
          }
          order.push(key);
        }
      }

      sortCacheRef.current = cacheable
        ? {
            key: effectiveSort.key,
            direction: effectiveSort.direction,
            order,
            valuesByKey,
            sortedRows: sorted,
          }
        : null;
    } else {
      sortCacheRef.current = null;
    }

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
