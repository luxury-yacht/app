import type {
  ColumnWidthState,
  GridColumnDefinition,
} from '@shared/components/tables/GridTable.types';
import { parseWidthInputToNumber } from '@shared/components/tables/GridTable.utils';

type WidthBounds<T> = {
  getColumnMinWidth: (column: GridColumnDefinition<T>) => number;
  getColumnMaxWidth: (column: GridColumnDefinition<T>) => number;
};

type BuildInitialMeasuredWidthsOptions<T> = WidthBounds<T> & {
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
}: WidthBounds<T> & {
  column: GridColumnDefinition<T>;
  baseWidths: Record<string, number>;
  naturalWidths: Record<string, number>;
}): number => {
  const width = isFiniteColumnWidth(baseWidths[column.key])
    ? baseWidths[column.key]
    : isFiniteColumnWidth(naturalWidths[column.key])
      ? naturalWidths[column.key]
      : (parseWidthInputToNumber(column.width) ?? getColumnMinWidth(column));
  return clampColumnWidth(column, width, { getColumnMinWidth, getColumnMaxWidth });
};

export const buildInitialMeasuredColumnWidthPlan = <T>({
  renderedColumns,
  columnWidths,
  measuredAutoWidths,
  externalColumnWidths,
  manuallyResizedColumnKeys,
  measureColumnWidth,
  getColumnMinWidth,
  getColumnMaxWidth,
}: BuildInitialMeasuredWidthsOptions<T>): InitialMeasuredWidthPlan => {
  const bounds = { getColumnMinWidth, getColumnMaxWidth };
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
      isFiniteColumnWidth(candidate) ? candidate : measureColumnWidth(column),
      bounds
    );
  }
  return { widths: naturalWidths, naturalWidths };
};
