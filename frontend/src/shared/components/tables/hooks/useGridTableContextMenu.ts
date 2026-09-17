/**
 * frontend/src/shared/components/tables/hooks/useGridTableContextMenu.ts
 *
 * React hook for useGridTableContextMenu.
 * Encapsulates state and side effects for the shared components.
 */

import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { isSortableColumn } from '@shared/components/tables/GridTable.utils';
import { useCallback, useState } from 'react';

// Encapsulates the bare context menu state/actions (open/close and position),
// leaving item construction to callers. Used by GridTable context menu wiring.

export interface GridTableContextMenuState<T> {
  position: { x: number; y: number };
  columnKey: string;
  item: T | null;
}

interface UseGridTableContextMenuOptions<T> {
  enableContextMenu: boolean;
  columns: GridColumnDefinition<T>[];
  getCustomContextMenuItems?: (item: T, columnKey: string) => ContextMenuItem[] | null | undefined;
  onSort?: (columnKey: string, targetDirection?: 'asc' | 'desc' | null) => void;
}

export interface GridTableContextMenuHandlers<T> {
  contextMenu: GridTableContextMenuState<T> | null;
  openCellContextMenu: (event: React.MouseEvent, columnKey: string, item: T | null) => boolean;
  openCellContextMenuFromKeyboard: (
    columnKey: string,
    item: T | null,
    anchorElement?: HTMLElement | null
  ) => boolean;
  closeContextMenu: () => void;
}

export function useGridTableContextMenu<T>({
  enableContextMenu,
  columns,
  getCustomContextMenuItems,
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
      const isSortable = isSortableColumn(column) && Boolean(onSort);

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
      });
      return true;
    },
    [canOpenCellContextMenu]
  );

  return {
    contextMenu,
    openCellContextMenu,
    openCellContextMenuFromKeyboard,
    closeContextMenu,
  };
}
