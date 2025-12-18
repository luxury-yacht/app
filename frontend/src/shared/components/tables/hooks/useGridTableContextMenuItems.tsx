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
  onSort?: (columnKey: string) => void;
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

        items.push(
          {
            label: `Sort ${column.header} Asc`,
            icon: <SortAscIcon />,
            onClick: () => onSort(columnKey),
            disabled: currentDirection === 'asc',
          },
          {
            label: `Sort ${column.header} Desc`,
            icon: <SortDescIcon />,
            onClick: () => {
              if (currentDirection !== 'desc') {
                onSort(columnKey);
                if (currentDirection !== 'asc') {
                  setTimeout(() => onSort(columnKey), 0);
                }
              }
            },
            disabled: currentDirection === 'desc',
          },
          {
            label: 'Clear Sort',
            icon: '×',
            onClick: () => {
              if (currentDirection === 'asc') {
                onSort(columnKey);
                setTimeout(() => onSort(columnKey), 0);
              } else if (currentDirection === 'desc') {
                onSort(columnKey);
              }
            },
            disabled: !isCurrentlySorted,
          }
        );
      }

      return items;
    },
    [columns, getCustomContextMenuItems, onSort, sortConfig]
  );
}
