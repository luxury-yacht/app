/**
 * frontend/src/ui/favorites/favoriteTableSnapshot.ts
 *
 * The one comparison of a favorite's saved table settings, used both to light
 * the heart for a matching view and to detect edits in the save modal.
 */

import { areGridTableFilterStatesEqual } from '@shared/components/tables/gridTableFilterState';
import type { FavoriteTableSnapshot } from '@/core/persistence/favorites';
import { compareUtf16Strings } from '@/shared/utils/sort';

const sortedVisibility = (visibility: Record<string, boolean>) =>
  JSON.stringify(
    Object.entries(visibility).sort(([leftKey], [rightKey]) =>
      compareUtf16Strings(leftKey, rightKey)
    )
  );

export const favoriteTableSnapshotsEqual = (
  left: FavoriteTableSnapshot,
  right: FavoriteTableSnapshot
): boolean =>
  areGridTableFilterStatesEqual(left.filters, right.filters) &&
  left.tableState.sortColumn === right.tableState.sortColumn &&
  left.tableState.sortDirection === right.tableState.sortDirection &&
  sortedVisibility(left.tableState.columnVisibility) ===
    sortedVisibility(right.tableState.columnVisibility) &&
  JSON.stringify(left.tableState.columnOrder ?? []) ===
    JSON.stringify(right.tableState.columnOrder ?? []);
