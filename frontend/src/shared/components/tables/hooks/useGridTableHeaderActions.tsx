/**
 * frontend/src/shared/components/tables/hooks/useGridTableHeaderActions.tsx
 *
 * Header sorting and context-menu actions for GridTable.
 */

import { useCallback, useMemo, useState } from 'react';
import type React from 'react';
import type { MutableRefObject } from 'react';
import ContextMenu from '@shared/components/ContextMenu';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { SortAscIcon, SortDescIcon } from '@shared/components/icons/SharedIcons';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

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

export function useGridTableHeaderActions<T>({
  columns,
  lockedColumns,
  sortConfig,
  onSort,
  applyVisibilityChanges,
  contextMenuActiveRef,
}: UseGridTableHeaderActionsOptions<T>) {
  const [headerContextMenuPosition, setHeaderContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [headerContextMenuColumnKey, setHeaderContextMenuColumnKey] = useState<string | null>(null);

  const renderSortIndicator = useCallback(
    (columnKey: string) => {
      if (!sortConfig || sortConfig.key !== columnKey) {
        return null;
      }
      return (
        <span className="sort-indicator">
          {sortConfig.direction === 'asc' ? '↑' : sortConfig.direction === 'desc' ? '↓' : ''}
        </span>
      );
    },
    [sortConfig]
  );

  const handleHeaderClick = useCallback(
    (column: GridColumnDefinition<T>) => {
      if (column.sortable && onSort) {
        onSort(column.key);
      }
    },
    [onSort]
  );

  const handleHeaderContextMenu = useCallback(
    (event: React.MouseEvent, columnKey: string) => {
      event.preventDefault();
      contextMenuActiveRef.current = true;
      setHeaderContextMenuPosition({ x: event.clientX, y: event.clientY });
      setHeaderContextMenuColumnKey(columnKey);
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

    const isSortable = Boolean(column.sortable);
    const isHideable = !lockedColumns.has(column.key);

    if (!isSortable && !isHideable) {
      return [{ label: 'No Actions', disabled: true }];
    }

    const isCurrentlySorted = sortConfig?.key === column.key;
    const currentDirection = isCurrentlySorted ? (sortConfig?.direction ?? null) : null;
    const items: ContextMenuItem[] = [];

    if (isSortable) {
      items.push(
        {
          label: 'Sort Ascending',
          icon: <SortAscIcon />,
          onClick: () => onSort?.(column.key, 'asc'),
          disabled: currentDirection === 'asc',
        },
        {
          label: 'Sort Descending',
          icon: <SortDescIcon />,
          onClick: () => onSort?.(column.key, 'desc'),
          disabled: currentDirection === 'desc',
        },
        {
          label: 'Clear Sort',
          icon: '×',
          onClick: () => onSort?.(column.key, null),
          disabled: !isCurrentlySorted,
        }
      );
    }

    if (isSortable && isHideable) {
      items.push({ divider: true });
    }

    if (isHideable) {
      items.push({
        label: 'Hide Column',
        onClick: () =>
          applyVisibilityChanges((next) => {
            next[column.key] = false;
            return true;
          }),
      });
    }

    return items;
  }, [
    applyVisibilityChanges,
    columns,
    headerContextMenuColumnKey,
    lockedColumns,
    onSort,
    sortConfig,
  ]);

  const headerContextMenuNode = useMemo(() => {
    if (!headerContextMenuPosition || !headerContextMenuColumnKey) {
      return null;
    }
    return (
      <ContextMenu
        items={headerContextMenuItems}
        position={headerContextMenuPosition}
        onClose={() => {
          contextMenuActiveRef.current = false;
          setHeaderContextMenuPosition(null);
          setHeaderContextMenuColumnKey(null);
        }}
      />
    );
  }, [
    contextMenuActiveRef,
    headerContextMenuColumnKey,
    headerContextMenuItems,
    headerContextMenuPosition,
  ]);

  return {
    renderSortIndicator,
    handleHeaderClick,
    handleHeaderContextMenu,
    headerContextMenuNode,
  };
}
