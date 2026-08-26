import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

export const areColumnOrdersEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((key, index) => key === right[index]);

function assertUniqueColumnKeys<T>(columns: readonly GridColumnDefinition<T>[]): void {
  const seen = new Set<string>();
  for (const column of columns) {
    if (seen.has(column.key)) {
      throw new Error(`GridTable column keys must be unique: "${column.key}"`);
    }
    seen.add(column.key);
  }
}

export function reconcileColumnOrder<T>(
  columns: readonly GridColumnDefinition<T>[],
  requestedOrder: readonly string[] | null | undefined
): string[] {
  assertUniqueColumnKeys(columns);
  const declaredKeys = columns.map((column) => column.key);
  if (!requestedOrder) {
    return declaredKeys;
  }

  const declaredKeySet = new Set(declaredKeys);
  const seen = new Set<string>();
  const reconciled: string[] = [];
  for (const key of requestedOrder) {
    if (declaredKeySet.has(key) && !seen.has(key)) {
      seen.add(key);
      reconciled.push(key);
    }
  }
  for (const key of declaredKeys) {
    if (!seen.has(key)) {
      reconciled.push(key);
    }
  }
  return reconciled;
}

export function orderColumns<T>(
  columns: readonly GridColumnDefinition<T>[],
  order: readonly string[]
): GridColumnDefinition<T>[] {
  const byKey = new Map(columns.map((column) => [column.key, column] as const));
  return order.flatMap((key) => {
    const column = byKey.get(key);
    return column ? [column] : [];
  });
}

export function reorderVisibleColumnOrder(
  fullOrder: readonly string[],
  key: string,
  visibleKeys: readonly string[],
  insertIndex: number
): string[] | null {
  const sourceIndex = fullOrder.indexOf(key);
  const visibleSourceIndex = visibleKeys.indexOf(key);
  if (
    sourceIndex < 0 ||
    visibleSourceIndex < 0 ||
    visibleKeys.length === 0 ||
    insertIndex < 0 ||
    insertIndex > visibleKeys.length
  ) {
    return null;
  }

  const nextVisibleOrder = [...visibleKeys];
  nextVisibleOrder.splice(visibleSourceIndex, 1);
  const adjustedVisibleInsertIndex =
    visibleSourceIndex < insertIndex ? insertIndex - 1 : insertIndex;
  nextVisibleOrder.splice(adjustedVisibleInsertIndex, 0, key);
  if (areColumnOrdersEqual(nextVisibleOrder, visibleKeys)) {
    return null;
  }

  const boundaryKey =
    insertIndex < visibleKeys.length
      ? visibleKeys[insertIndex]
      : visibleKeys[visibleKeys.length - 1];
  const boundaryKeyIndex = fullOrder.indexOf(boundaryKey);
  if (boundaryKeyIndex < 0) {
    return null;
  }
  const fullInsertIndex =
    insertIndex < visibleKeys.length ? boundaryKeyIndex : boundaryKeyIndex + 1;
  const adjustedFullInsertIndex =
    sourceIndex < fullInsertIndex ? fullInsertIndex - 1 : fullInsertIndex;

  const next = [...fullOrder];
  const [movedKey] = next.splice(sourceIndex, 1);
  next.splice(adjustedFullInsertIndex, 0, movedKey);
  return next;
}
