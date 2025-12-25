/**
 * frontend/src/shared/components/tables/hooks/useGridTableCellCache.tsx
 *
 * React hook for useGridTableCellCache.
 * Encapsulates state and side effects for the shared components.
 */

import React, { useCallback, useEffect, useRef } from 'react';

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

// Caches rendered cell content per column/value so virtualization and hover
// syncing don't force expensive rerenders. Separates object/primitive caches and
// keeps kind-class normalization/text extraction consistent.

// Max entries per column's primitive cache before eviction
const PRIMITIVE_CACHE_MAX_SIZE = 500;

interface CachedCell<T> {
  render: GridColumnDefinition<T>['render'];
  objectCache?: WeakMap<object, { content: React.ReactNode; text: string }>;
  primitiveCache?: Map<unknown, { content: React.ReactNode; text: string }>;
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
      let entry = columnRenderCacheRef.current.get(column.key);
      if (!entry || entry.render !== column.render) {
        entry = { render: column.render };
        columnRenderCacheRef.current.set(column.key, entry);
      }

      const storeResult = (result: { content: React.ReactNode; text: string }) => {
        if (typeof item === 'object' && item !== null) {
          if (!entry!.objectCache) {
            entry!.objectCache = new WeakMap();
          }
          entry!.objectCache.set(item as object, result);
        } else {
          if (!entry!.primitiveCache) {
            entry!.primitiveCache = new Map();
          }
          // Evict oldest entries if cache exceeds size limit
          if (entry!.primitiveCache.size >= PRIMITIVE_CACHE_MAX_SIZE) {
            // Map iterates in insertion order, so first key is oldest
            const firstKey = entry!.primitiveCache.keys().next().value;
            if (firstKey !== undefined) {
              entry!.primitiveCache.delete(firstKey);
            }
          }
          entry!.primitiveCache.set(item as unknown, result);
        }
        return result;
      };

      if (typeof item === 'object' && item !== null) {
        if (!entry.objectCache) {
          entry.objectCache = new WeakMap();
        } else {
          const cached = entry.objectCache.get(item as object);
          if (cached) {
            return cached;
          }
        }
      } else if (entry.primitiveCache) {
        const cached = entry.primitiveCache.get(item as unknown);
        if (cached) {
          return cached;
        }
      }

      const rawContent = entry.render(item);
      const rawText = getTextContent(rawContent);

      let content: React.ReactNode = rawContent;
      const text = rawText;

      if (isKindColumnKey(column.key)) {
        let canonicalKind: string | undefined;
        let isInteractiveElement = false;

        if (React.isValidElement(rawContent)) {
          const props = rawContent.props as Record<string, any>;
          const explicitKindValue = props?.['data-kind-value'];
          if (typeof explicitKindValue === 'string' && explicitKindValue.trim().length > 0) {
            canonicalKind = explicitKindValue;
          }
          isInteractiveElement =
            props?.['data-kind-interactive'] === 'true' ||
            typeof props?.onClick === 'function' ||
            typeof props?.onKeyDown === 'function' ||
            props?.role === 'button';
        }

        const trimmedDisplay = rawText.trim();
        const normalizedClass = normalizeKindClass(
          canonicalKind && canonicalKind.length > 0 ? canonicalKind : trimmedDisplay
        );

        if (React.isValidElement(rawContent)) {
          const props = rawContent.props as Record<string, any>;
          const existingClassName: string = props?.className ?? '';
          const classTokens = existingClassName
            .split(/\s+/)
            .map((token) => token.trim())
            .filter(Boolean);

          if (!classTokens.includes('kind-badge')) {
            classTokens.push('kind-badge');
          }
          if (!classTokens.includes(normalizedClass)) {
            classTokens.push(normalizedClass);
          }
          if (isInteractiveElement && !classTokens.includes('clickable')) {
            classTokens.push('clickable');
          }

          content = React.cloneElement(rawContent, {
            className: classTokens.join(' '),
          } as any);
        } else if (trimmedDisplay.length > 0) {
          const badgeClasses = ['kind-badge', normalizedClass];
          if (isInteractiveElement) {
            badgeClasses.push('clickable');
          }

          content = <span className={badgeClasses.join(' ')}>{rawContent}</span>;
        }
      }

      return storeResult({ content, text });
    },
    [getTextContent, isKindColumnKey, normalizeKindClass]
  );

  return { getCachedCellContent };
}
