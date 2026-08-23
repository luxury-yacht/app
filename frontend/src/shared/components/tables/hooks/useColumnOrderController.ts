import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { orderColumns, reconcileColumnOrder } from '@shared/components/tables/gridTableColumnOrder';
import { useCallback, useEffect, useMemo, useState } from 'react';

export { reconcileColumnOrder } from '@shared/components/tables/gridTableColumnOrder';

interface ColumnOrderControllerOptions<T> {
  columns: GridColumnDefinition<T>[];
  columnOrder?: string[] | null;
  onColumnOrderChange?: (order: string[]) => void;
}

export interface ColumnOrderController<T> {
  orderedColumns: GridColumnDefinition<T>[];
  effectiveColumnOrder: string[];
  moveColumn: (key: string, offset: -1 | 1) => void;
  reorderColumn: (key: string, targetIndex: number) => void;
  canResetColumnOrder: boolean;
  resetColumnOrder: () => void;
}

const areOrdersEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((key, index) => key === right[index]);

export function useColumnOrderController<T>({
  columns,
  columnOrder,
  onColumnOrderChange,
}: ColumnOrderControllerOptions<T>): ColumnOrderController<T> {
  const declaredOrder = useMemo(() => reconcileColumnOrder(columns, null), [columns]);
  const [localOrder, setLocalOrder] = useState<string[]>(declaredOrder);

  const effectiveColumnOrder = useMemo(
    () => reconcileColumnOrder(columns, columnOrder ?? localOrder),
    [columnOrder, columns, localOrder]
  );

  useEffect(() => {
    if (columnOrder !== null && columnOrder !== undefined) {
      return;
    }
    setLocalOrder((current) => {
      const reconciled = reconcileColumnOrder(columns, current);
      return areOrdersEqual(current, reconciled) ? current : reconciled;
    });
  }, [columnOrder, columns]);

  const moveColumn = useCallback(
    (key: string, offset: -1 | 1) => {
      const currentIndex = effectiveColumnOrder.indexOf(key);
      const nextIndex = currentIndex + offset;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= effectiveColumnOrder.length) {
        return;
      }
      const next = [...effectiveColumnOrder];
      [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
      if (columnOrder === null || columnOrder === undefined) {
        setLocalOrder(next);
      }
      onColumnOrderChange?.(next);
    },
    [columnOrder, effectiveColumnOrder, onColumnOrderChange]
  );

  const reorderColumn = useCallback(
    (key: string, targetIndex: number) => {
      const currentIndex = effectiveColumnOrder.indexOf(key);
      if (
        currentIndex < 0 ||
        targetIndex < 0 ||
        targetIndex >= effectiveColumnOrder.length ||
        currentIndex === targetIndex
      ) {
        return;
      }
      const next = [...effectiveColumnOrder];
      const [movedKey] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, movedKey);
      if (columnOrder === null || columnOrder === undefined) {
        setLocalOrder(next);
      }
      onColumnOrderChange?.(next);
    },
    [columnOrder, effectiveColumnOrder, onColumnOrderChange]
  );

  const canResetColumnOrder = !areOrdersEqual(effectiveColumnOrder, declaredOrder);
  const resetColumnOrder = useCallback(() => {
    if (areOrdersEqual(effectiveColumnOrder, declaredOrder)) {
      return;
    }
    const next = [...declaredOrder];
    if (columnOrder === null || columnOrder === undefined) {
      setLocalOrder(next);
    }
    onColumnOrderChange?.(next);
  }, [columnOrder, declaredOrder, effectiveColumnOrder, onColumnOrderChange]);

  const orderedColumns = useMemo(
    () => orderColumns(columns, effectiveColumnOrder),
    [columns, effectiveColumnOrder]
  );

  return {
    orderedColumns,
    effectiveColumnOrder,
    moveColumn,
    reorderColumn,
    canResetColumnOrder,
    resetColumnOrder,
  };
}
