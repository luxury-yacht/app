/**
 * frontend/src/shared/components/tables/hooks/useMetadataSearch.tsx
 *
 * The "Include metadata" search toggle for GridTable. While it is on, the search
 * also matches each row's label and annotation keys and values: the local filter
 * engine adds them for local tables, and query-backed tables send the flag to the
 * backend, which matches them there.
 *
 * The toggle state is stored in GridTableFilterState.includeMetadata so it
 * persists across cluster switches and is captured in favorites.
 */

import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { MetadataIcon } from '@shared/components/icons/SharedIcons';
import type { GridTableFilterState } from '@shared/components/tables/GridTable.types';
import { useMemo } from 'react';

export interface UseMetadataSearchOptions {
  /** Whether to create the metadata toggle item. */
  enabled: boolean;
  /** Current filter state (provides includeMetadata). */
  filters: GridTableFilterState;
  /** Called when includeMetadata changes. */
  onFiltersChange: (next: GridTableFilterState) => void;
}

/** Returns the IconBar toggle for metadata search, or null when it is not offered. */
export function useMetadataSearch({
  enabled,
  filters,
  onFiltersChange,
}: UseMetadataSearchOptions): IconBarItem | null {
  return useMemo<IconBarItem | null>(
    () =>
      enabled
        ? {
            type: 'toggle',
            id: 'include-metadata',
            icon: <MetadataIcon width={18} height={18} />,
            active: filters.includeMetadata,
            onClick: () =>
              onFiltersChange({ ...filters, includeMetadata: !filters.includeMetadata }),
            title: 'Include metadata',
          }
        : null,
    [enabled, filters, onFiltersChange]
  );
}
