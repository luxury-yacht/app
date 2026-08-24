import type {
  ColumnWidthState,
  GridColumnDefinition,
} from '@shared/components/tables/GridTable.types';
import {
  DEFAULT_COLUMN_MIN_WIDTH,
  parseWidthInputToNumber,
} from '@shared/components/tables/GridTable.utils';

type BuildInitialMeasuredWidthsOptions<T> = {
  renderedColumns: GridColumnDefinition<T>[];
  columnWidths: Record<string, number>;
  measuredAutoWidths: Record<string, number>;
  externalColumnWidths: Record<string, number> | null;
  manuallyResizedColumnKeys: ReadonlySet<string>;
  measureColumnWidth: (column: GridColumnDefinition<T>) => number;
};

export type InitialMeasuredWidthPlan = {
  widths: Record<string, number>;
  naturalWidths: Record<string, number>;
};

const isFiniteColumnWidth = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const isUserOwnedColumnWidth = <T>(
  state: ColumnWidthState,
  column: GridColumnDefinition<T>
): boolean =>
  state.source === 'user' ||
  (!state.source && Boolean(column.autoWidth) && state.autoWidth === false);

export const getColumnMinWidth = <T>(column: GridColumnDefinition<T>): number =>
  parseWidthInputToNumber(column.minWidth) ?? DEFAULT_COLUMN_MIN_WIDTH;

export const getColumnMaxWidth = <T>(column: GridColumnDefinition<T>): number =>
  parseWidthInputToNumber(column.maxWidth) ?? Number.POSITIVE_INFINITY;

const getColumnAutoSizeMaxWidth = <T>(column: GridColumnDefinition<T>): number => {
  const configuredMaximum = getColumnMaxWidth(column);
  const autoSizeMaximum = parseWidthInputToNumber(column.autoSizeMaxWidth);
  return autoSizeMaximum === null
    ? configuredMaximum
    : Math.min(configuredMaximum, autoSizeMaximum);
};

export const clampColumnWidth = <T>(column: GridColumnDefinition<T>, width: number): number =>
  Math.max(getColumnMinWidth(column), Math.min(getColumnMaxWidth(column), width));

export const clampAutoSizeColumnWidth = <T>(
  column: GridColumnDefinition<T>,
  width: number
): number =>
  Math.max(getColumnMinWidth(column), Math.min(getColumnAutoSizeMaxWidth(column), width));

export const resolveColumnWidth = <T>({
  column,
  baseWidths,
  naturalWidths,
}: {
  column: GridColumnDefinition<T>;
  baseWidths: Record<string, number>;
  naturalWidths: Record<string, number>;
}): number => {
  let width = parseWidthInputToNumber(column.width) ?? getColumnMinWidth(column);
  if (isFiniteColumnWidth(naturalWidths[column.key])) {
    width = naturalWidths[column.key];
  }
  if (isFiniteColumnWidth(baseWidths[column.key])) {
    width = baseWidths[column.key];
  }
  return clampColumnWidth(column, width);
};

export const buildInitialMeasuredColumnWidthPlan = <T>({
  renderedColumns,
  columnWidths,
  measuredAutoWidths,
  externalColumnWidths,
  manuallyResizedColumnKeys,
  measureColumnWidth,
}: BuildInitialMeasuredWidthsOptions<T>): InitialMeasuredWidthPlan => {
  const naturalWidths: Record<string, number> = {};
  for (const column of renderedColumns) {
    const externalWidth = externalColumnWidths?.[column.key];
    const configuredWidth = parseWidthInputToNumber(column.width);
    let candidate: number | undefined;
    if (manuallyResizedColumnKeys.has(column.key)) {
      candidate = externalWidth ?? columnWidths[column.key];
    } else if (column.autoWidth) {
      candidate = measuredAutoWidths[column.key];
    } else {
      candidate = isFiniteColumnWidth(externalWidth)
        ? externalWidth
        : (configuredWidth ?? columnWidths[column.key]);
    }
    naturalWidths[column.key] = clampColumnWidth(
      column,
      isFiniteColumnWidth(candidate) ? candidate : measureColumnWidth(column)
    );
  }
  return { widths: naturalWidths, naturalWidths };
};
