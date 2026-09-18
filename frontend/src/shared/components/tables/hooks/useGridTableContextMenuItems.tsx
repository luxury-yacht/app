/**
 * frontend/src/shared/components/tables/hooks/useGridTableContextMenuItems.tsx
 *
 * React hook for useGridTableContextMenuItems.
 * Encapsulates state and side effects for the shared components.
 */

import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { SortAscIcon, SortDescIcon } from '@shared/components/icons/SharedIcons';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { isSortableColumn } from '@shared/components/tables/GridTable.utils';
import { useCallback } from 'react';

// Builds context menu item lists for GridTable cells,
// combining custom items with sort actions while avoiding duplicates.

export interface UseGridTableContextMenuItemsParams<T> {
  columns: GridColumnDefinition<T>[];
  getCustomContextMenuItems?: (item: T, columnKey: string) => ContextMenuItem[];
  onSort?: (columnKey: string, targetDirection?: 'asc' | 'desc' | null) => void;
  sortConfig?: { key: string; direction: 'asc' | 'desc' | null } | null;
}

type CustomContextMenuItems<T> = (item: T, columnKey: string) => ContextMenuItem[];
type GridTableSortHandler = (columnKey: string, targetDirection?: 'asc' | 'desc' | null) => void;
type GridTableSortConfig = UseGridTableContextMenuItemsParams<never>['sortConfig'];

const findNavigationSectionEnd = (items: ContextMenuItem[]): number => {
  const diffIndex = items.findIndex(
    (item) => item.actionId === OBJECT_ACTION_IDS.diff || ('label' in item && item.label === 'Diff')
  );
  if (diffIndex !== -1) {
    return diffIndex;
  }
  return items.findIndex(
    (item) =>
      item.actionId === OBJECT_ACTION_IDS.viewDetails || ('label' in item && item.label === 'Open')
  );
};

const isDivider = (item: ContextMenuItem | undefined): boolean =>
  Boolean(item && 'divider' in item && item.divider);

const insertNavigationDivider = (items: ContextMenuItem[]): void => {
  const sectionEnd = findNavigationSectionEnd(items);
  const nextIndex = sectionEnd + 1;
  if (sectionEnd !== -1 && items.length > nextIndex && !isDivider(items[nextIndex])) {
    items.splice(nextIndex, 0, { divider: true });
  }
};

function getCellItems<T>(
  item: T | null,
  columnKey: string,
  getCustomContextMenuItems: CustomContextMenuItems<T> | undefined
): ContextMenuItem[] {
  if (!getCustomContextMenuItems || !item) {
    return [];
  }
  const items = getCustomContextMenuItems(item, columnKey);
  insertNavigationDivider(items);
  return items;
}

const appendSortDivider = (items: ContextMenuItem[]): void => {
  if (items.length > 0 && !isDivider(items[items.length - 1])) {
    items.push({ divider: true });
  }
};

const defaultSortLabels = { ascending: 'Sort Ascending', descending: 'Sort Descending' };

export function buildGridTableSortItems(
  columnKey: string,
  onSort: GridTableSortHandler | undefined,
  sortConfig: GridTableSortConfig,
  labels = defaultSortLabels
): ContextMenuItem[] {
  const isCurrentlySorted = sortConfig?.key === columnKey;
  const currentDirection = isCurrentlySorted ? (sortConfig?.direction ?? null) : null;
  return [
    {
      label: labels.ascending,
      icon: <SortAscIcon />,
      onClick: () => onSort?.(columnKey, 'asc'),
      disabled: currentDirection === 'asc',
    },
    {
      label: labels.descending,
      icon: <SortDescIcon />,
      onClick: () => onSort?.(columnKey, 'desc'),
      disabled: currentDirection === 'desc',
    },
    {
      label: 'Clear Sort',
      icon: '×',
      onClick: () => onSort?.(columnKey, null),
      disabled: !isCurrentlySorted,
    },
  ];
}

export function useGridTableContextMenuItems<T>({
  columns,
  getCustomContextMenuItems,
  onSort,
  sortConfig,
}: UseGridTableContextMenuItemsParams<T>) {
  return useCallback(
    (columnKey: string, item: T | null): ContextMenuItem[] => {
      const items = getCellItems(item, columnKey, getCustomContextMenuItems);
      const column = columns.find((col) => col.key === columnKey);
      if (!column || !isSortableColumn(column) || !onSort) {
        return items;
      }
      appendSortDivider(items);
      // Direct target directions avoid stale state cycling and timer cleanup.
      items.push(
        ...buildGridTableSortItems(columnKey, onSort, sortConfig, {
          ascending: `Sort ${column.header} Asc`,
          descending: `Sort ${column.header} Desc`,
        })
      );
      return items;
    },
    [columns, getCustomContextMenuItems, onSort, sortConfig]
  );
}
