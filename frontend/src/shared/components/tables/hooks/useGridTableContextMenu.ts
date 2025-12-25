/**
 * frontend/src/shared/components/tables/hooks/useGridTableContextMenu.ts
 *
 * React hook for useGridTableContextMenu.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback, useState } from 'react';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

// Encapsulates the bare context menu state/actions (open/close, position, source),
// leaving item construction to callers. Used by GridTable context menu wiring.

export type GridTableContextMenuSource = 'cell' | 'empty';

export interface GridTableContextMenuState<T> {
  position: { x: number; y: number };
  columnKey: string;
  item: T | null;
  source: GridTableContextMenuSource;
  itemsOverride?: ContextMenuItem[];
}

interface UseGridTableContextMenuOptions<T> {
  enableContextMenu: boolean;
  columns: GridColumnDefinition<T>[];
  getCustomContextMenuItems?: (item: T, columnKey: string) => ContextMenuItem[] | null | undefined;
  getContextMenuItems: (
    columnKey: string,
    item: T | null,
    source: GridTableContextMenuSource
  ) => ContextMenuItem[];
  onSort?: (columnKey: string) => void;
}

export interface GridTableContextMenuHandlers<T> {
  contextMenu: GridTableContextMenuState<T> | null;
  openCellContextMenu: (event: React.MouseEvent, columnKey: string, item: T | null) => boolean;
  openCellContextMenuFromKeyboard: (
    columnKey: string,
    item: T | null,
    anchorElement?: HTMLElement | null
  ) => boolean;
  openWrapperContextMenu: (event: React.MouseEvent) => boolean;
  closeContextMenu: () => void;
}

export function useGridTableContextMenu<T>({
  enableContextMenu,
  columns,
  getCustomContextMenuItems,
  getContextMenuItems,
  onSort,
}: UseGridTableContextMenuOptions<T>): GridTableContextMenuHandlers<T> {
  const [contextMenu, setContextMenu] = useState<GridTableContextMenuState<T> | null>(null);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const canOpenCellContextMenu = useCallback(
    (columnKey: string, item: T | null) => {
      if (!enableContextMenu) {
        return false;
      }

      const column = columns.find((col) => col.key === columnKey);
      const hasCustomItems = Boolean(getCustomContextMenuItems && item);
      const isSortable = Boolean(column?.sortable && onSort);

      if (!hasCustomItems && !isSortable) {
        return false;
      }
      return true;
    },
    [columns, enableContextMenu, getCustomContextMenuItems, onSort]
  );

  const openCellContextMenu = useCallback(
    (event: React.MouseEvent, columnKey: string, item: T | null) => {
      if (event.metaKey || event.ctrlKey) {
        return false;
      }

      if (!canOpenCellContextMenu(columnKey, item)) {
        return false;
      }

      event.preventDefault();
      setContextMenu({
        position: { x: event.clientX, y: event.clientY },
        columnKey,
        item,
        source: 'cell',
      });
      return true;
    },
    [canOpenCellContextMenu]
  );

  const openCellContextMenuFromKeyboard = useCallback(
    (columnKey: string, item: T | null, anchorElement?: HTMLElement | null) => {
      if (!canOpenCellContextMenu(columnKey, item)) {
        return false;
      }

      const rect = anchorElement?.getBoundingClientRect();
      const fallbackX =
        typeof window !== 'undefined' && window.innerWidth ? window.innerWidth / 2 : 0;
      const fallbackY =
        typeof window !== 'undefined' && window.innerHeight ? window.innerHeight / 2 : 0;

      const position = rect
        ? { x: rect.left + 40, y: rect.top + rect.height / 2 }
        : { x: fallbackX, y: fallbackY };

      setContextMenu({
        position,
        columnKey,
        item,
        source: 'cell',
      });
      return true;
    },
    [canOpenCellContextMenu]
  );

  const openWrapperContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (event.metaKey || event.ctrlKey || !enableContextMenu) {
        return false;
      }

      const target = event.target as HTMLElement;
      const isInRow = Boolean(target.closest('.gridtable-row'));
      const isInCell = Boolean(target.closest('.grid-cell'));
      const isWrapperArea =
        target.classList.contains('gridtable-wrapper') ||
        target.classList.contains('gridtable') ||
        Boolean(target.closest('.gridtable-empty'));

      if (isInRow || isInCell || !isWrapperArea) {
        return false;
      }

      const items = getContextMenuItems('', null, 'empty');
      if (items.length === 0) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      setContextMenu({
        position: { x: event.clientX, y: event.clientY },
        columnKey: '',
        item: null,
        source: 'empty',
        itemsOverride: items,
      });
      return true;
    },
    [enableContextMenu, getContextMenuItems]
  );

  return {
    contextMenu,
    openCellContextMenu,
    openCellContextMenuFromKeyboard,
    openWrapperContextMenu,
    closeContextMenu,
  };
}
