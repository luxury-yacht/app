/**
 * frontend/src/shared/components/tables/hooks/useGridTableContextMenuItems.tsx
 *
 * React hook for useGridTableContextMenuItems.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback } from 'react';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { SortAscIcon, SortDescIcon } from '@shared/components/icons/MenuIcons';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

// Builds context menu item lists for GridTable cells/headers/empty areas,
// combining custom items with sort actions while avoiding duplicates.

export type ContextMenuSource = 'cell' | 'header' | 'empty';

export interface UseGridTableContextMenuItemsParams<T> {
  columns: GridColumnDefinition<T>[];
  getCustomContextMenuItems?: (item: T, columnKey: string) => ContextMenuItem[];
  onSort?: (columnKey: string, targetDirection?: 'asc' | 'desc' | null) => void;
  sortConfig?: { key: string; direction: 'asc' | 'desc' | null } | null;
}

export function useGridTableContextMenuItems<T>({
  columns,
  getCustomContextMenuItems,
  onSort,
  sortConfig,
}: UseGridTableContextMenuItemsParams<T>) {
  return useCallback(
    (columnKey: string, item: T | null, source: ContextMenuSource): ContextMenuItem[] => {
      if (source === 'empty') {
        return [];
      }

      const items: ContextMenuItem[] = [];

      if (source === 'cell' && getCustomContextMenuItems && item) {
        const customItems = getCustomContextMenuItems(item, columnKey);
        if (customItems.length > 0) {
          // Insert a divider after "Open" to separate navigation from actions
          const openIndex = customItems.findIndex((ci) => 'label' in ci && ci.label === 'Open');
          if (openIndex !== -1 && customItems.length > openIndex + 1) {
            // Check if there's already a divider after Open
            const nextItem = customItems[openIndex + 1];
            if (!('divider' in nextItem && nextItem.divider)) {
              customItems.splice(openIndex + 1, 0, { divider: true });
            }
          }
          items.push(...customItems);
        }
      }

      const column = columns.find((col) => col.key === columnKey);

      if (column?.sortable && onSort) {
        if (items.length > 0) {
          items.push({ divider: true });
        }

        const isCurrentlySorted = sortConfig?.key === columnKey;
        const currentDirection = isCurrentlySorted ? (sortConfig?.direction ?? null) : null;

        // Pass the target direction directly instead of cycling through the
        // state machine with multiple onSort calls. This avoids stale-closure
        // bugs and setTimeout leaks (see gridtable.md issues 2 and 9).
        items.push(
          {
            label: `Sort ${column.header} Asc`,
            icon: <SortAscIcon />,
            onClick: () => onSort(columnKey, 'asc'),
            disabled: currentDirection === 'asc',
          },
          {
            label: `Sort ${column.header} Desc`,
            icon: <SortDescIcon />,
            onClick: () => onSort(columnKey, 'desc'),
            disabled: currentDirection === 'desc',
          },
          {
            label: 'Clear Sort',
            icon: '×',
            onClick: () => onSort(columnKey, null),
            disabled: !isCurrentlySorted,
          }
        );
      }

      return items;
    },
    [columns, getCustomContextMenuItems, onSort, sortConfig]
  );
}
