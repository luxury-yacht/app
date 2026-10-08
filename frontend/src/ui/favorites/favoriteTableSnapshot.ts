/**
 * frontend/src/ui/favorites/favoriteTableSnapshot.ts
 *
 * Equality for the table state a favorite saves. The favorite toggle uses it to
 * match the live table against saved favorites; the save modal uses it to
 * detect edits.
 */

import { areGridTableFilterStatesEqual } from '@shared/components/tables/gridTableFilterState';
import type { FavoriteTableSnapshot } from '@/core/persistence/favorites';
import { compareUtf16Strings } from '@/shared/utils/sort';

const visibilitySignature = (visibility: Record<string, boolean>): string =>
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
  visibilitySignature(left.tableState.columnVisibility) ===
    visibilitySignature(right.tableState.columnVisibility) &&
  JSON.stringify(left.tableState.columnOrder ?? []) ===
    JSON.stringify(right.tableState.columnOrder ?? []);
