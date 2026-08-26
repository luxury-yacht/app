import type React from 'react';
import { useState } from 'react';

const GRIDTABLE_COLUMN_DRAG_DATA_TYPE = 'application/x-luxury-yacht-grid-column';

type ColumnDropPosition = 'before' | 'after';

interface HeaderDragProps {
  draggable: true;
  'data-dragging': true | undefined;
  'data-drop-position': ColumnDropPosition | undefined;
  onDragStart: React.DragEventHandler<HTMLTableCellElement>;
  onDragOver: React.DragEventHandler<HTMLTableCellElement>;
  onDragLeave: React.DragEventHandler<HTMLTableCellElement>;
  onDrop: React.DragEventHandler<HTMLTableCellElement>;
  onDragEnd: React.DragEventHandler<HTMLTableCellElement>;
}

interface UseGridTableHeaderReorderOptions {
  visibleColumnKeys: string[];
  onReorderVisibleColumn: (key: string, visibleKeys: string[], insertIndex: number) => void;
}

const hasGridColumnDragType = (dataTransfer: DataTransfer): boolean => {
  for (let index = 0; index < dataTransfer.types.length; index += 1) {
    if (dataTransfer.types[index] === GRIDTABLE_COLUMN_DRAG_DATA_TYPE) {
      return true;
    }
  }
  return false;
};

const getInsertIndex = (
  event: React.DragEvent<HTMLTableCellElement>,
  columnIndex: number
): number => {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX < rect.left + rect.width / 2 ? columnIndex : columnIndex + 1;
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
  visibleColumnKeys,
  onReorderVisibleColumn,
}: UseGridTableHeaderReorderOptions): (key: string, index: number) => HeaderDragProps {
  const [draggingColumnKey, setDraggingColumnKey] = useState<string | null>(null);
  const [dropInsertIndex, setDropInsertIndex] = useState<number | null>(null);

  const clearDragState = () => {
    setDraggingColumnKey(null);
    setDropInsertIndex(null);
  };

  return (key, index) => ({
    draggable: true,
    'data-dragging': draggingColumnKey === key || undefined,
    'data-drop-position': getDropPosition(index, visibleColumnKeys.length, dropInsertIndex),
    onDragStart: (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.resize-handle')) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData(GRIDTABLE_COLUMN_DRAG_DATA_TYPE, key);
      event.dataTransfer.effectAllowed = 'move';
      setDraggingColumnKey(key);
    },
    onDragOver: (event) => {
      if (!draggingColumnKey || !hasGridColumnDragType(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropInsertIndex(getInsertIndex(event, index));
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
      if (!draggingColumnKey || !hasGridColumnDragType(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onReorderVisibleColumn(draggingColumnKey, visibleColumnKeys, getInsertIndex(event, index));
      clearDragState();
    },
    onDragEnd: clearDragState,
  });
}
