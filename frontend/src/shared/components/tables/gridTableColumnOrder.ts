import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

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
