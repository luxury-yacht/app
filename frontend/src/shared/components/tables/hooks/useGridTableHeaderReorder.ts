import { getHorizontalDropInsertIndex, hasDragDataType } from '@shared/components/dragReorder';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

const GRIDTABLE_COLUMN_DRAG_DATA_TYPE = 'application/x-luxury-yacht-grid-column';

type ColumnDropPosition = 'before' | 'after';

interface HeaderDragProps {
  draggable?: true;
  'data-dragging'?: true;
  'data-drop-position'?: ColumnDropPosition;
  onDragStart?: React.DragEventHandler<HTMLTableCellElement>;
  onDragOver?: React.DragEventHandler<HTMLTableCellElement>;
  onDragLeave?: React.DragEventHandler<HTMLTableCellElement>;
  onDrop?: React.DragEventHandler<HTMLTableCellElement>;
  onDragEnd?: React.DragEventHandler<HTMLTableCellElement>;
}

interface UseGridTableHeaderReorderOptions {
  enabled: boolean;
  visibleColumnKeys: string[];
  onReorderVisibleColumn: (key: string, visibleKeys: string[], insertIndex: number) => void;
}

const getInsertIndex = (
  event: React.DragEvent<HTMLTableCellElement>,
  columnIndex: number
): number => {
  return columnIndex + getHorizontalDropInsertIndex([event.currentTarget], event.clientX);
};

const getDropPosition = (
  columnIndex: number,
  columnCount: number,
  insertIndex: number | null
): ColumnDropPosition | undefined => {
  if (insertIndex === null || columnCount === 0) {
    return undefined;
  }
  if (insertIndex === columnCount) {
    return columnIndex === columnCount - 1 ? 'after' : undefined;
  }
  return columnIndex === insertIndex ? 'before' : undefined;
};

/** Header drag behavior mirrors the tab strip's midpoint-based insertion model. */
export function useGridTableHeaderReorder({
  enabled,
  visibleColumnKeys,
  onReorderVisibleColumn,
}: UseGridTableHeaderReorderOptions): (key: string, index: number) => HeaderDragProps {
  const [draggingColumnKey, setDraggingColumnKey] = useState<string | null>(null);
  const [dropInsertIndex, setDropInsertIndex] = useState<number | null>(null);

  const clearDragState = useCallback(() => {
    setDraggingColumnKey(null);
    setDropInsertIndex(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      clearDragState();
    }
  }, [clearDragState, enabled]);

  return (key, index) =>
    enabled
      ? {
          draggable: true,
          'data-dragging': draggingColumnKey === key || undefined,
          'data-drop-position': getDropPosition(index, visibleColumnKeys.length, dropInsertIndex),
          onDragStart: (event) => {
            event.dataTransfer.setData(GRIDTABLE_COLUMN_DRAG_DATA_TYPE, key);
            event.dataTransfer.effectAllowed = 'move';
            setDraggingColumnKey(key);
          },
          onDragOver: (event) => {
            if (
              !draggingColumnKey ||
              !hasDragDataType(event.dataTransfer, GRIDTABLE_COLUMN_DRAG_DATA_TYPE)
            ) {
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            const nextInsertIndex = getInsertIndex(event, index);
            setDropInsertIndex((current) =>
              current === nextInsertIndex ? current : nextInsertIndex
            );
          },
          onDragLeave: (event) => {
            if (
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            ) {
              return;
            }
            setDropInsertIndex(null);
          },
          onDrop: (event) => {
            if (
              !draggingColumnKey ||
              !hasDragDataType(event.dataTransfer, GRIDTABLE_COLUMN_DRAG_DATA_TYPE)
            ) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            onReorderVisibleColumn(
              draggingColumnKey,
              visibleColumnKeys,
              getInsertIndex(event, index)
            );
            clearDragState();
          },
          onDragEnd: clearDragState,
        }
      : {};
}
