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
import React, { useCallback, useEffect, useRef } from 'react';

// Caches rendered cell content per column/value so virtualization and hover
// syncing don't force expensive rerenders. Separates object/primitive caches and
// keeps kind-class normalization/text extraction consistent.

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
  isKindColumnKey: (key: string) => boolean;
  getTextContent: (node: React.ReactNode) => string;
  normalizeKindClass: (value: string) => string;
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

interface KindElementMetadata {
  canonicalKind: string | undefined;
  interactive: boolean;
}

const getKindElementMetadata = (content: React.ReactNode): KindElementMetadata => {
  if (!React.isValidElement<Record<string, unknown>>(content)) {
    return { canonicalKind: undefined, interactive: false };
  }
  const props = content.props;
  const explicitKindValue = props?.['data-kind-value'];
  const canonicalKind =
    typeof explicitKindValue === 'string' && explicitKindValue.trim().length > 0
      ? explicitKindValue
      : undefined;
  const interactive =
    props?.['data-kind-interactive'] === 'true' ||
    typeof props?.onClick === 'function' ||
    typeof props?.onKeyDown === 'function' ||
    props?.role === 'button';
  return { canonicalKind, interactive };
};

const appendClassToken = (tokens: string[], token: string | undefined): void => {
  if (token && !tokens.includes(token)) {
    tokens.push(token);
  }
};

const buildKindClassName = (
  existingClassName: unknown,
  normalizedClass: string,
  interactive: boolean
): string => {
  const tokens = typeof existingClassName === 'string' ? existingClassName.split(/\s+/) : [];
  const classTokens = tokens.map((token) => token.trim()).filter(Boolean);
  appendClassToken(classTokens, 'kind-badge');
  appendClassToken(classTokens, normalizedClass);
  appendClassToken(classTokens, interactive ? 'clickable' : undefined);
  return classTokens.join(' ');
};

const renderKindContent = (
  rawContent: React.ReactNode,
  rawText: string,
  normalizeKindClass: (value: string) => string
): React.ReactNode => {
  const metadata = getKindElementMetadata(rawContent);
  const trimmedDisplay = rawText.trim();
  const normalizedClass = normalizeKindClass(metadata.canonicalKind ?? trimmedDisplay);
  if (React.isValidElement<Record<string, unknown>>(rawContent)) {
    return React.cloneElement(rawContent, {
      className: buildKindClassName(
        rawContent.props.className,
        normalizedClass,
        metadata.interactive
      ),
    });
  }
  if (trimmedDisplay.length === 0) {
    return rawContent;
  }
  return (
    <span className={buildKindClassName(undefined, normalizedClass, metadata.interactive)}>
      {rawContent}
    </span>
  );
};

const renderCellValue = <T,>(
  column: GridColumnDefinition<T>,
  item: T,
  isKindColumnKey: (key: string) => boolean,
  getTextContent: (node: React.ReactNode) => string,
  normalizeKindClass: (value: string) => string
): CachedCellValue => {
  const rawContent = column.render(item);
  const rawText = getTextContent(rawContent);
  const noValue = isTableNoValueText(rawText);
  let content: React.ReactNode = noValue ? renderTableNoValue() : rawContent;
  if (isKindColumnKey(column.key)) {
    content = renderKindContent(rawContent, rawText, normalizeKindClass);
  }
  return { content, text: noValue ? TABLE_NO_VALUE_TEXT : rawText };
};

export function useGridTableCellCache<T>({
  renderedColumns,
  isKindColumnKey,
  getTextContent,
  normalizeKindClass,
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
      return storeCachedCell(
        entry,
        item,
        renderCellValue(column, item, isKindColumnKey, getTextContent, normalizeKindClass)
      );
    },
    [getTextContent, isKindColumnKey, normalizeKindClass]
  );

  return { getCachedCellContent };
}
