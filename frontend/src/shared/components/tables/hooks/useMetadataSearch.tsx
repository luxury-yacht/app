/**
 * frontend/src/shared/components/tables/hooks/useMetadataSearch.tsx
 *
 * Reusable hook that provides an "Include Metadata" search toggle for GridTable.
 * When active, the search filter includes label and annotation key/value pairs
 * alongside the default search fields.
 *
 * The toggle state is stored in GridTableFilterState.includeMetadata so it
 * persists across cluster switches and is captured in favorites.
 */

import { useCallback, useMemo } from 'react';
import { MetadataIcon } from '@shared/components/icons/MenuIcons';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import type { GridTableFilterState } from '@shared/components/tables/GridTable.types';

export interface UseMetadataSearchOptions<T> {
  /** Whether to create the metadata toggle item. */
  enabled?: boolean;
  /** Return the default (non-metadata) search strings for a row. */
  getDefaultValues: (row: T) => string[];
  /** Return metadata maps (e.g. labels, annotations) to include when the toggle is on. */
  getMetadataMaps: (row: T) => (Record<string, string> | undefined)[];
  /** Current filter state (provides includeMetadata). */
  filters: GridTableFilterState;
  /** Called when includeMetadata changes. */
  onFiltersChange: (next: GridTableFilterState) => void;
}

export interface UseMetadataSearchResult<T> {
  /** Whether the metadata toggle is currently active. */
  includeMetadata: boolean;
  /** Set the metadata toggle state directly (used to restore from favorites). */
  setIncludeMetadata: (value: boolean) => void;
  /** IconBar toggle item for the metadata search toggle. */
  metadataToggle: IconBarItem | null;
  /** Custom getSearchText accessor to pass to filters.accessors.getSearchText. */
  getSearchText: (row: T) => string[];
}

/**
 * Provides a metadata-aware search toggle for any GridTable view.
 *
 * Usage:
 * ```tsx
 * const { metadataToggle, getSearchText } = useMetadataSearch({
 *   getDefaultValues: (row) => [row.name, row.kind],
 *   getMetadataMaps: (row) => [row.labels, row.annotations],
 *   filters: persistedFilters,
 *   onFiltersChange: setPersistedFilters,
 * });
 * // Then pass metadataToggle in filters.options.preActions
 * // and getSearchText to filters.accessors.getSearchText
 * ```
 */
export function useMetadataSearch<T>(
  options: UseMetadataSearchOptions<T>
): UseMetadataSearchResult<T> {
  const { enabled = true, getDefaultValues, getMetadataMaps, filters, onFiltersChange } = options;
  const includeMetadata = filters.includeMetadata;

  const setIncludeMetadata = useCallback(
    (value: boolean) => {
      onFiltersChange({ ...filters, includeMetadata: value });
    },
    [filters, onFiltersChange]
  );

  const metadataToggle = useMemo<IconBarItem | null>(
    () =>
      enabled
        ? {
            type: 'toggle' as const,
            id: 'include-metadata',
            icon: <MetadataIcon width={16} height={16} />,
            active: includeMetadata,
            onClick: () => setIncludeMetadata(!includeMetadata),
            title: 'Include metadata',
          }
        : null,
    [enabled, includeMetadata, setIncludeMetadata]
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

  return { includeMetadata, setIncludeMetadata, metadataToggle, getSearchText };
}
