import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import {
  areColumnOrdersEqual,
  orderColumns,
  reconcileColumnOrder,
  reorderVisibleColumnOrder,
} from '@shared/components/tables/gridTableColumnOrder';
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
  reorderVisibleColumn: (key: string, visibleKeys: string[], insertIndex: number) => void;
  canResetColumnOrder: boolean;
  resetColumnOrder: () => void;
}

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

  const applyColumnOrder = useCallback(
    (next: string[]) => {
      if (columnOrder === null || columnOrder === undefined) {
        setLocalOrder(next);
      }
      onColumnOrderChange?.(next);
    },
    [columnOrder, onColumnOrderChange]
  );

  useEffect(() => {
    if (columnOrder !== null && columnOrder !== undefined) {
      return;
    }
    setLocalOrder((current) => {
      const reconciled = reconcileColumnOrder(columns, current);
      return areColumnOrdersEqual(current, reconciled) ? current : reconciled;
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
      applyColumnOrder(next);
    },
    [applyColumnOrder, effectiveColumnOrder]
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
      applyColumnOrder(next);
    },
    [applyColumnOrder, effectiveColumnOrder]
  );

  const reorderVisibleColumn = useCallback(
    (key: string, visibleKeys: string[], insertIndex: number) => {
      const next = reorderVisibleColumnOrder(effectiveColumnOrder, key, visibleKeys, insertIndex);
      if (!next) {
        return;
      }
      applyColumnOrder(next);
    },
    [applyColumnOrder, effectiveColumnOrder]
  );

  const canResetColumnOrder = !areColumnOrdersEqual(effectiveColumnOrder, declaredOrder);
  const resetColumnOrder = useCallback(() => {
    if (areColumnOrdersEqual(effectiveColumnOrder, declaredOrder)) {
      return;
    }
    const next = [...declaredOrder];
    applyColumnOrder(next);
  }, [applyColumnOrder, declaredOrder, effectiveColumnOrder]);

  const orderedColumns = useMemo(
    () => orderColumns(columns, effectiveColumnOrder),
    [columns, effectiveColumnOrder]
  );

  return {
    orderedColumns,
    effectiveColumnOrder,
    moveColumn,
    reorderColumn,
    reorderVisibleColumn,
    canResetColumnOrder,
    resetColumnOrder,
  };
}
