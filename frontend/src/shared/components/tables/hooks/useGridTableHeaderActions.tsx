/**
 * frontend/src/shared/components/tables/hooks/useGridTableHeaderActions.tsx
 *
 * Header sorting and context-menu actions for GridTable.
 */

import type { ContextMenuItem } from '@shared/components/ContextMenu';
import ContextMenu from '@shared/components/ContextMenu';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { isSortableColumn } from '@shared/components/tables/GridTable.utils';
import type React from 'react';
import type { MutableRefObject } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { buildGridTableSortItems } from './useGridTableContextMenuItems';

type SortDirection = 'asc' | 'desc' | null;
type SortConfig = { key: string; direction: SortDirection };
type OnSort = (key: string, targetDirection?: SortDirection) => void;
type ApplyVisibilityChanges = (mutator: (next: Record<string, boolean>) => boolean) => void;

type UseGridTableHeaderActionsOptions<T> = {
  columns: GridColumnDefinition<T>[];
  lockedColumns: Set<string>;
  sortConfig?: SortConfig | null;
  onSort?: OnSort;
  applyVisibilityChanges: ApplyVisibilityChanges;
  contextMenuActiveRef: MutableRefObject<boolean>;
};

function buildHeaderContextMenuItems<T>(
  column: GridColumnDefinition<T>,
  {
    lockedColumns,
    onSort,
    sortConfig,
    applyVisibilityChanges,
  }: Pick<
    UseGridTableHeaderActionsOptions<T>,
    'lockedColumns' | 'onSort' | 'sortConfig' | 'applyVisibilityChanges'
  >
): ContextMenuItem[] {
  const items: ContextMenuItem[] = isSortableColumn(column)
    ? buildGridTableSortItems(column.key, onSort, sortConfig)
    : [];

  if (lockedColumns.has(column.key)) {
    return items.length ? items : [{ label: 'No Actions', disabled: true }];
  }
  if (items.length) {
    items.push({ divider: true });
  }
  items.push({
    label: 'Hide Column',
    onClick: () =>
      applyVisibilityChanges((next) => {
        next[column.key] = false;
        return true;
      }),
  });

  return items;
}

export function useGridTableHeaderActions<T>({
  columns,
  lockedColumns,
  sortConfig,
  onSort,
  applyVisibilityChanges,
  contextMenuActiveRef,
}: UseGridTableHeaderActionsOptions<T>) {
  const [headerContextMenu, setHeaderContextMenu] = useState<{
    position: { x: number; y: number };
    columnKey: string;
  } | null>(null);
  const headerContextMenuColumnKey = headerContextMenu?.columnKey;

  const renderSortIndicator = useCallback(
    (columnKey: string) => {
      if (sortConfig?.key !== columnKey) {
        return null;
      }
      let indicator = '';
      if (sortConfig.direction === 'asc') {
        indicator = '↑';
      } else if (sortConfig.direction === 'desc') {
        indicator = '↓';
      }
      return <span className="sort-indicator">{indicator}</span>;
    },
    [sortConfig]
  );

  const handleHeaderClick = useCallback(
    (column: GridColumnDefinition<T>) => {
      if (isSortableColumn(column) && onSort) {
        onSort(column.key);
      }
    },
    [onSort]
  );

  const handleHeaderContextMenu = useCallback(
    (event: React.MouseEvent, columnKey: string) => {
      event.preventDefault();
      contextMenuActiveRef.current = true;
      setHeaderContextMenu({ position: { x: event.clientX, y: event.clientY }, columnKey });
    },
    [contextMenuActiveRef]
  );

  const headerContextMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!headerContextMenuColumnKey) {
      return [];
    }

    const column = columns.find((candidate) => candidate.key === headerContextMenuColumnKey);
    if (!column) {
      return [];
    }

    return buildHeaderContextMenuItems(column, {
      lockedColumns,
      onSort,
      sortConfig,
      applyVisibilityChanges,
    });
  }, [
    applyVisibilityChanges,
    columns,
    headerContextMenuColumnKey,
    lockedColumns,
    onSort,
    sortConfig,
  ]);

  const headerContextMenuNode = useMemo(() => {
    if (!headerContextMenu || !headerContextMenuColumnKey) {
      return null;
    }
    return (
      <ContextMenu
        items={headerContextMenuItems}
        position={headerContextMenu.position}
        onClose={() => {
          contextMenuActiveRef.current = false;
          setHeaderContextMenu(null);
        }}
      />
    );
  }, [contextMenuActiveRef, headerContextMenuColumnKey, headerContextMenuItems, headerContextMenu]);

  return {
    renderSortIndicator,
    handleHeaderClick,
    handleHeaderContextMenu,
    headerContextMenuNode,
  };
}
