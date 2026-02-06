/**
 * frontend/src/shared/components/tables/hooks/useMetadataSearch.tsx
 *
 * Reusable hook that provides an "Include Metadata" search toggle for GridTable.
 * When active, the search filter includes label and annotation key/value pairs
 * alongside the default search fields.
 */

import { useCallback, useMemo, useState } from 'react';
import { MetadataIcon } from '@shared/components/icons/MenuIcons';
import type { SearchInputAction } from '@shared/components/inputs/SearchInput';

export interface UseMetadataSearchOptions<T> {
  /** Return the default (non-metadata) search strings for a row. */
  getDefaultValues: (row: T) => string[];
  /** Return metadata maps (e.g. labels, annotations) to include when the toggle is on. */
  getMetadataMaps: (row: T) => (Record<string, string> | undefined)[];
}

export interface UseMetadataSearchResult<T> {
  /** Whether the metadata toggle is currently active. */
  includeMetadata: boolean;
  /** Search action config to pass to filters.options.searchActions. */
  searchActions: SearchInputAction[];
  /** Custom getSearchText accessor to pass to filters.accessors.getSearchText. */
  getSearchText: (row: T) => string[];
}

/**
 * Provides a metadata-aware search toggle for any GridTable view.
 *
 * Usage:
 * ```tsx
 * const { searchActions, getSearchText } = useMetadataSearch({
 *   getDefaultValues: (row) => [row.name, row.kind],
 *   getMetadataMaps: (row) => [row.labels, row.annotations],
 * });
 * // Then pass searchActions to filters.options.searchActions
 * // and getSearchText to filters.accessors.getSearchText
 * ```
 */
export function useMetadataSearch<T>(
  options: UseMetadataSearchOptions<T>
): UseMetadataSearchResult<T> {
  const { getDefaultValues, getMetadataMaps } = options;
  const [includeMetadata, setIncludeMetadata] = useState(false);

  const searchActions = useMemo<SearchInputAction[]>(
    () => [
      {
        id: 'include-metadata',
        icon: <MetadataIcon width={14} height={14} />,
        active: includeMetadata,
        onToggle: () => setIncludeMetadata((prev) => !prev),
        tooltip: 'Include metadata',
      },
    ],
    [includeMetadata]
  );

  const getSearchText = useCallback(
    (row: T): string[] => {
      const values: string[] = getDefaultValues(row).filter(Boolean);
      if (includeMetadata) {
        for (const map of getMetadataMaps(row)) {
          if (!map) continue;
          for (const [k, v] of Object.entries(map)) {
            values.push(k, v, `${k}: ${v}`);
          }
        }
      }
      return values;
    },
    [includeMetadata, getDefaultValues, getMetadataMaps]
  );

  return { includeMetadata, searchActions, getSearchText };
}
