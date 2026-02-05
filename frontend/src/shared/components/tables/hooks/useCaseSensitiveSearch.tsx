/**
 * frontend/src/shared/components/tables/hooks/useCaseSensitiveSearch.tsx
 *
 * Reusable hook that provides a case-sensitive search toggle for GridTable.
 * Returns a search action for the filter bar and the current boolean state
 * to pass into filters.options.caseSensitive.
 */

import { useMemo, useState } from 'react';
import { CaseSensitiveIcon } from '@shared/components/icons/MenuIcons';
import type { SearchInputAction } from '@shared/components/inputs/SearchInput';

export interface UseCaseSensitiveSearchResult {
  /** Whether the case-sensitive toggle is currently active. */
  caseSensitive: boolean;
  /** Search action config to merge into filters.options.searchActions. */
  searchActions: SearchInputAction[];
}

/**
 * Provides a case-sensitive search toggle for any GridTable view.
 *
 * Usage:
 * ```tsx
 * const { caseSensitive, searchActions: csActions } = useCaseSensitiveSearch();
 * // Merge csActions into filters.options.searchActions
 * // Pass caseSensitive to filters.options.caseSensitive
 * ```
 */
export function useCaseSensitiveSearch(): UseCaseSensitiveSearchResult {
  const [caseSensitive, setCaseSensitive] = useState(false);

  const searchActions = useMemo<SearchInputAction[]>(
    () => [
      {
        id: 'case-sensitive',
        icon: <CaseSensitiveIcon width={14} height={14} />,
        active: caseSensitive,
        onToggle: () => setCaseSensitive((prev) => !prev),
        tooltip: 'Match case',
      },
    ],
    [caseSensitive],
  );

  return { caseSensitive, searchActions };
}
