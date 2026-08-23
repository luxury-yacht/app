/**
 * frontend/src/shared/components/tables/hooks/useGridTableCellCache.tsx
 *
 * React hook for useGridTableCellCache.
 * Encapsulates state and side effects for the shared components.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import {
  isTableNoValueText,
  renderTableNoValue,
  TABLE_NO_VALUE_TEXT,
} from '@shared/components/tables/tableNoValue';
import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';

// Caches rendered cell content per column/value so virtualization and hover
// syncing don't force expensive rerenders. Separates object/primitive caches.

// Max entries per column's primitive cache before eviction
const PRIMITIVE_CACHE_MAX_SIZE = 500;

interface CachedCellValue {
  content: React.ReactNode;
  text: string;
}

interface CachedCell<T> {
  render: GridColumnDefinition<T>['render'];
  objectCache?: WeakMap<object, CachedCellValue>;
  primitiveCache?: Map<unknown, CachedCellValue>;
}

export interface CellCacheOptions<T> {
  renderedColumns: GridColumnDefinition<T>[];
  getTextContent: (node: React.ReactNode) => string;
  // Current data array - when reference changes, primitive caches are cleared
  // to prevent unbounded growth from old values
  data?: T[];
}

const isObjectCacheKey = (item: unknown): item is object =>
  typeof item === 'object' && item !== null;

const getColumnCache = <T,>(
  cache: Map<string, CachedCell<T>>,
  column: GridColumnDefinition<T>
): CachedCell<T> => {
  const existing = cache.get(column.key);
  if (existing?.render === column.render) {
    return existing;
  }
  const entry = { render: column.render };
  cache.set(column.key, entry);
  return entry;
};

const readCachedCell = <T,>(entry: CachedCell<T>, item: T): CachedCellValue | undefined => {
  if (isObjectCacheKey(item)) {
    return entry.objectCache?.get(item);
  }
  return entry.primitiveCache?.get(item);
};

const evictOldestPrimitive = (cache: Map<unknown, CachedCellValue>): void => {
  if (cache.size < PRIMITIVE_CACHE_MAX_SIZE) {
    return;
  }
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) {
    cache.delete(oldestKey);
  }
};

const storeCachedCell = <T,>(
  entry: CachedCell<T>,
  item: T,
  result: CachedCellValue
): CachedCellValue => {
  if (isObjectCacheKey(item)) {
    entry.objectCache ??= new WeakMap();
    entry.objectCache.set(item, result);
    return result;
  }
  entry.primitiveCache ??= new Map();
  evictOldestPrimitive(entry.primitiveCache);
  entry.primitiveCache.set(item, result);
  return result;
};

const renderCellValue = <T,>(
  column: GridColumnDefinition<T>,
  item: T,
  getTextContent: (node: React.ReactNode) => string
): CachedCellValue => {
  const rawContent = column.render(item);
  const rawText = getTextContent(rawContent);
  const noValue = isTableNoValueText(rawText);
  return {
    content: noValue ? renderTableNoValue() : rawContent,
    text: noValue ? TABLE_NO_VALUE_TEXT : rawText,
  };
};

export function useGridTableCellCache<T>({
  renderedColumns,
  getTextContent,
  data,
}: CellCacheOptions<T>) {
  const columnRenderCacheRef = useRef<Map<string, CachedCell<T>>>(new Map());
  const lastDataRef = useRef<T[] | undefined>(undefined);

  useEffect(() => {
    const visibleKeys = new Set(renderedColumns.map((column) => column.key));
    columnRenderCacheRef.current.forEach((_entry, key) => {
      if (!visibleKeys.has(key)) {
        columnRenderCacheRef.current.delete(key);
      }
    });
  }, [renderedColumns]);

  // Clear primitive caches when data reference changes to prevent unbounded growth
  useEffect(() => {
    if (data !== lastDataRef.current) {
      lastDataRef.current = data;
      // Clear all primitive caches - object caches use WeakMap so they self-evict
      columnRenderCacheRef.current.forEach((entry) => {
        if (entry.primitiveCache) {
          entry.primitiveCache.clear();
        }
      });
    }
  }, [data]);

  const getCachedCellContent = useCallback(
    (column: GridColumnDefinition<T>, item: T) => {
      const entry = getColumnCache(columnRenderCacheRef.current, column);
      const cached = readCachedCell(entry, item);
      if (cached) {
        return cached;
      }
      return storeCachedCell(entry, item, renderCellValue(column, item, getTextContent));
    },
    [getTextContent]
  );

  return { getCachedCellContent };
}
