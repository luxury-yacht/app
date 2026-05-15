import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { parseWidthInputToNumber } from '@shared/components/tables/GridTable.utils';

type WidthBounds<T> = {
  getColumnMinWidth: (column: GridColumnDefinition<T>) => number;
  getColumnMaxWidth: (column: GridColumnDefinition<T>) => number;
};

type WidthResolutionOptions<T> = WidthBounds<T> & {
  column: GridColumnDefinition<T>;
  baseWidths: Record<string, number>;
  naturalWidths: Record<string, number>;
};

type ReconcileColumnWidthsOptions<T> = WidthBounds<T> & {
  baseWidths: Record<string, number>;
  renderedColumns: GridColumnDefinition<T>[];
  naturalWidths: Record<string, number>;
  containerWidth: number;
  allowHorizontalOverflow: boolean;
  forceFit?: boolean;
  enableColumnResizing: boolean;
  externalColumnWidths: Record<string, number> | null;
  manuallyResizedColumnKeys: ReadonlySet<string>;
  isFixedColumnKey: (key: string) => boolean;
};

type BuildInitialMeasuredWidthsOptions<T> = WidthBounds<T> & {
  renderedColumns: GridColumnDefinition<T>[];
  columnWidths: Record<string, number>;
  measuredFixedWidths: Record<string, number>;
  measuredAutoWidths: Record<string, number>;
  externalColumnWidths: Record<string, number> | null;
  manuallyResizedColumnKeys: ReadonlySet<string>;
  containerWidth: number;
  allowHorizontalOverflow: boolean;
  isFixedColumnKey: (key: string) => boolean;
  measureColumnWidth: (column: GridColumnDefinition<T>) => number;
};

export type InitialMeasuredWidthPlan = {
  widths: Record<string, number>;
  naturalWidths: Record<string, number>;
};

const isFiniteColumnWidth = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const clampColumnWidth = <T>(
  column: GridColumnDefinition<T>,
  width: number,
  { getColumnMinWidth, getColumnMaxWidth }: WidthBounds<T>
): number => Math.max(getColumnMinWidth(column), Math.min(getColumnMaxWidth(column), width));

export const resolveColumnWidth = <T>({
  column,
  baseWidths,
  naturalWidths,
  getColumnMinWidth,
  getColumnMaxWidth,
}: WidthResolutionOptions<T>): number => {
  let width = baseWidths[column.key];
  if (!isFiniteColumnWidth(width)) {
    width = naturalWidths[column.key];
  }
  if (!isFiniteColumnWidth(width)) {
    width = parseWidthInputToNumber(column.width) ?? getColumnMinWidth(column);
  }
  return clampColumnWidth(column, width, { getColumnMinWidth, getColumnMaxWidth });
};

const resolveColumnWidthMap = <T>({
  baseWidths,
  renderedColumns,
  naturalWidths,
  getColumnMinWidth,
  getColumnMaxWidth,
}: Pick<
  ReconcileColumnWidthsOptions<T>,
  'baseWidths' | 'renderedColumns' | 'naturalWidths' | 'getColumnMinWidth' | 'getColumnMaxWidth'
>): Record<string, number> => {
  const resolvedWidths: Record<string, number> = {};
  renderedColumns.forEach((column) => {
    resolvedWidths[column.key] = resolveColumnWidth({
      column,
      baseWidths,
      naturalWidths,
      getColumnMinWidth,
      getColumnMaxWidth,
    });
  });
  return resolvedWidths;
};

const getColumnsWithMissingWidths = <T>(
  columns: GridColumnDefinition<T>[],
  widths: Record<string, number>
): Set<string> => {
  const missing = new Set<string>();
  columns.forEach((column) => {
    if (!isFiniteColumnWidth(widths[column.key])) {
      missing.add(column.key);
    }
  });
  return missing;
};

const growFlexColumnsToFill = <T>({
  resolvedWidths,
  flexColumns,
  containerWidth,
  getColumnMaxWidth,
}: {
  resolvedWidths: Record<string, number>;
  flexColumns: GridColumnDefinition<T>[];
  containerWidth: number;
  getColumnMaxWidth: (column: GridColumnDefinition<T>) => number;
}): Record<string, number> => {
  if (flexColumns.length === 0) {
    return resolvedWidths;
  }

  const next = { ...resolvedWidths };
  const naturalTotal = flexColumns.reduce((sum, column) => sum + (next[column.key] ?? 0), 0);
  const targetTotal = Math.max(containerWidth, naturalTotal);
  let remaining = Math.max(0, targetTotal - naturalTotal);
  let adjustable = flexColumns.filter(
    (column) => next[column.key] < getColumnMaxWidth(column) - 0.5
  );

  while (remaining > 0 && adjustable.length > 0) {
    const share = Math.max(1, Math.floor(remaining / adjustable.length));
    const nextAdjustable: GridColumnDefinition<T>[] = [];

    adjustable.forEach((column) => {
      if (remaining <= 0) {
        return;
      }
      const key = column.key;
      const max = getColumnMaxWidth(column);
      const current = next[key];
      const capacity = Math.max(0, max - current);
      if (capacity <= 0.5) {
        return;
      }
      const delta = Math.min(share, capacity, remaining);
      next[key] = current + delta;
      remaining -= delta;
      if (capacity - delta > 0.5) {
        nextAdjustable.push(column);
      }
    });

    adjustable = nextAdjustable;
  }

  return next;
};

const distributeFlexWidths = <T>({
  resolvedWidths,
  flexColumns,
  targetFlexWidth,
  hasMissingColumns,
  originalWidths,
  getColumnMinWidth,
  getColumnMaxWidth,
}: WidthBounds<T> & {
  resolvedWidths: Record<string, number>;
  flexColumns: GridColumnDefinition<T>[];
  targetFlexWidth: number;
  hasMissingColumns: boolean;
  originalWidths: Record<string, number>;
}): Record<string, number> => {
  if (targetFlexWidth <= 0 || flexColumns.length === 0) {
    return resolvedWidths;
  }
  if (!hasMissingColumns) {
    return resolvedWidths;
  }

  const updated: Record<string, number> = { ...resolvedWidths };
  let mutated = false;
  const currentFlexTotal = flexColumns.reduce((sum, column) => sum + (updated[column.key] ?? 0), 0);

  if (currentFlexTotal <= 0) {
    const widthPer = Math.floor(targetFlexWidth / flexColumns.length);
    const remainder = targetFlexWidth - widthPer * flexColumns.length;

    flexColumns.forEach((column, index) => {
      const width = clampColumnWidth(column, widthPer + (index === 0 ? remainder : 0), {
        getColumnMinWidth,
        getColumnMaxWidth,
      });
      if (updated[column.key] !== width) {
        updated[column.key] = width;
        mutated = true;
      }
    });

    return mutated || hasMissingColumns ? updated : originalWidths;
  }

  const scale = targetFlexWidth / currentFlexTotal;
  flexColumns.forEach((column) => {
    const previousWidth = updated[column.key] ?? 0;
    const width = clampColumnWidth(column, Math.round(previousWidth * scale), {
      getColumnMinWidth,
      getColumnMaxWidth,
    });
    if (width !== previousWidth) {
      updated[column.key] = width;
      mutated = true;
    }
  });

  const adjustedFlexTotal = flexColumns.reduce(
    (sum, column) => sum + (updated[column.key] ?? 0),
    0
  );
  let delta = Math.round(targetFlexWidth - adjustedFlexTotal);

  if (delta !== 0) {
    const adjustables = [...flexColumns].reverse();
    for (const column of adjustables) {
      const key = column.key;
      const min = getColumnMinWidth(column);
      const max = getColumnMaxWidth(column);
      const current = updated[key] ?? 0;

      if (delta > 0 && current < max) {
        const increase = Math.min(delta, max - current);
        if (increase > 0) {
          updated[key] = current + increase;
          delta -= increase;
          mutated = true;
        }
      } else if (delta < 0 && current > min) {
        const decrease = Math.min(Math.abs(delta), current - min);
        if (decrease > 0) {
          updated[key] = current - decrease;
          delta += decrease;
          mutated = true;
        }
      }

      if (delta === 0) {
        break;
      }
    }
  }

  return mutated || hasMissingColumns ? updated : originalWidths;
};

export const reconcileColumnWidthsToContainer = <T>({
  baseWidths,
  renderedColumns,
  naturalWidths,
  containerWidth,
  allowHorizontalOverflow,
  forceFit = false,
  enableColumnResizing,
  externalColumnWidths,
  manuallyResizedColumnKeys,
  isFixedColumnKey,
  getColumnMinWidth,
  getColumnMaxWidth,
}: ReconcileColumnWidthsOptions<T>): Record<string, number> => {
  if (!containerWidth || containerWidth <= 0 || renderedColumns.length === 0) {
    return baseWidths;
  }

  const missingColumns = getColumnsWithMissingWidths(renderedColumns, baseWidths);
  const resolvedWidths = resolveColumnWidthMap({
    baseWidths,
    renderedColumns,
    naturalWidths,
    getColumnMinWidth,
    getColumnMaxWidth,
  });

  if (allowHorizontalOverflow) {
    if (!forceFit) {
      return resolvedWidths;
    }

    const flexColumns = renderedColumns.filter(
      (column) => !isFixedColumnKey(column.key) && !manuallyResizedColumnKeys.has(column.key)
    );
    return growFlexColumnsToFill({
      resolvedWidths,
      flexColumns,
      containerWidth,
      getColumnMaxWidth,
    });
  }

  const lockedKeys = new Set<string>();
  if (!enableColumnResizing && externalColumnWidths) {
    Object.keys(externalColumnWidths).forEach((key) => lockedKeys.add(key));
  }
  manuallyResizedColumnKeys.forEach((key) => lockedKeys.add(key));

  const fixedColumns = renderedColumns.filter(
    (column) => isFixedColumnKey(column.key) || lockedKeys.has(column.key)
  );
  const fixedColumnKeys = new Set(fixedColumns.map((column) => column.key));
  const flexColumns = renderedColumns.filter((column) => !fixedColumnKeys.has(column.key));
  if (flexColumns.length === 0) {
    return resolvedWidths;
  }

  const fixedWidth = fixedColumns.reduce(
    (sum, column) => sum + (resolvedWidths[column.key] ?? 0),
    0
  );
  return distributeFlexWidths({
    resolvedWidths,
    flexColumns,
    targetFlexWidth: containerWidth - fixedWidth,
    hasMissingColumns: missingColumns.size > 0,
    originalWidths: baseWidths,
    getColumnMinWidth,
    getColumnMaxWidth,
  });
};

const resolveMeasuredWidth = <T>({
  column,
  candidate,
  fallback,
  getColumnMinWidth,
  getColumnMaxWidth,
}: WidthBounds<T> & {
  column: GridColumnDefinition<T>;
  candidate: number | undefined;
  fallback: () => number;
}): number =>
  clampColumnWidth(column, isFiniteColumnWidth(candidate) ? candidate : fallback(), {
    getColumnMinWidth,
    getColumnMaxWidth,
  });

const resolveFallbackColumnWidth = <T>(
  column: GridColumnDefinition<T>,
  bounds: WidthBounds<T>
): number =>
  clampColumnWidth(
    column,
    parseWidthInputToNumber(column.width) ?? bounds.getColumnMinWidth(column),
    bounds
  );

export const buildInitialMeasuredColumnWidthPlan = <T>({
  renderedColumns,
  columnWidths,
  measuredFixedWidths,
  measuredAutoWidths,
  externalColumnWidths,
  manuallyResizedColumnKeys,
  containerWidth,
  allowHorizontalOverflow,
  isFixedColumnKey,
  measureColumnWidth,
  getColumnMinWidth,
  getColumnMaxWidth,
}: BuildInitialMeasuredWidthsOptions<T>): InitialMeasuredWidthPlan => {
  const bounds = { getColumnMinWidth, getColumnMaxWidth };

  if (allowHorizontalOverflow) {
    const naturalWidths: Record<string, number> = {};
    renderedColumns.forEach((column) => {
      let width: number | undefined;
      if (manuallyResizedColumnKeys.has(column.key) && columnWidths[column.key] != null) {
        width = columnWidths[column.key];
      } else if (isFixedColumnKey(column.key)) {
        width = measuredFixedWidths[column.key];
      } else if (column.autoWidth) {
        width = measuredAutoWidths[column.key];
      } else {
        width = parseWidthInputToNumber(column.width) ?? columnWidths[column.key];
      }

      naturalWidths[column.key] = resolveMeasuredWidth({
        column,
        candidate: width,
        fallback: () => measureColumnWidth(column),
        ...bounds,
      });
    });
    return { widths: naturalWidths, naturalWidths };
  }

  const widths: Record<string, number> = {};
  let fixedTotal = 0;

  renderedColumns.forEach((column) => {
    if (isFixedColumnKey(column.key)) {
      const width = resolveMeasuredWidth({
        column,
        candidate: externalColumnWidths?.[column.key] ?? measuredFixedWidths[column.key],
        fallback: () => measureColumnWidth(column),
        ...bounds,
      });
      widths[column.key] = width;
      fixedTotal += width;
    } else if (column.autoWidth && !manuallyResizedColumnKeys.has(column.key)) {
      const width = resolveMeasuredWidth({
        column,
        candidate: externalColumnWidths?.[column.key] ?? measuredAutoWidths[column.key],
        fallback: () => measureColumnWidth(column),
        ...bounds,
      });
      widths[column.key] = width;
      fixedTotal += width;
    }
  });

  const flexColumns = renderedColumns.filter(
    (column) =>
      !isFixedColumnKey(column.key) &&
      !(column.autoWidth && !manuallyResizedColumnKeys.has(column.key))
  );
  let remaining = containerWidth - fixedTotal;
  const flexWithoutExternal: GridColumnDefinition<T>[] = [];

  flexColumns.forEach((column) => {
    const externalWidth = externalColumnWidths?.[column.key];
    if (isFiniteColumnWidth(externalWidth)) {
      const width = clampColumnWidth(column, externalWidth, bounds);
      widths[column.key] = width;
      remaining -= width;
    } else {
      flexWithoutExternal.push(column);
    }
  });

  if (flexWithoutExternal.length > 0) {
    if (remaining > 0) {
      const baseWidth = Math.floor(remaining / flexWithoutExternal.length);
      const remainder = remaining - baseWidth * flexWithoutExternal.length;

      flexWithoutExternal.forEach((column, index) => {
        widths[column.key] = clampColumnWidth(
          column,
          baseWidth + (index === 0 ? remainder : 0),
          bounds
        );
      });
    } else {
      flexWithoutExternal.forEach((column) => {
        widths[column.key] = resolveFallbackColumnWidth(column, bounds);
      });
    }
  }

  renderedColumns.forEach((column) => {
    if (column.key in widths) {
      return;
    }
    const existingWidth = columnWidths[column.key];
    widths[column.key] = isFiniteColumnWidth(existingWidth)
      ? clampColumnWidth(column, existingWidth, bounds)
      : resolveFallbackColumnWidth(column, bounds);
  });

  return { widths, naturalWidths: { ...widths } };
};
