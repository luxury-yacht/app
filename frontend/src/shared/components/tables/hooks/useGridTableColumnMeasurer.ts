import type {
  ColumnWidthInput,
  GridColumnDefinition,
} from '@shared/components/tables/GridTable.types';
import { isSortableColumn } from '@shared/components/tables/GridTable.utils';
import React, { useCallback } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const MEASUREMENT_SAMPLE_LIMIT = 400;

const detachNode = (node: HTMLElement): void => {
  node.parentNode?.removeChild(node);
};

const measureHeaderWidth = <T>(column: GridColumnDefinition<T>): number => {
  const node = document.createElement('div');
  node.className = 'grid-cell-header';
  node.style.position = 'absolute';
  node.style.visibility = 'hidden';
  node.style.left = '-9999px';
  node.style.whiteSpace = 'nowrap';
  node.style.width = 'auto';
  node.textContent = column.header;
  document.body.appendChild(node);
  try {
    return node.scrollWidth > 0 && isSortableColumn(column)
      ? node.scrollWidth + 20
      : node.scrollWidth;
  } finally {
    detachNode(node);
  }
};

const selectMeasurementSamples = <T>(tableData: T[]): T[] => {
  if (tableData.length <= MEASUREMENT_SAMPLE_LIMIT) {
    return tableData;
  }
  const step = Math.max(1, Math.ceil(tableData.length / MEASUREMENT_SAMPLE_LIMIT));
  const samples = tableData.filter((_item, index) => index % step === 0);
  const last = tableData[tableData.length - 1];
  if (samples[samples.length - 1] !== last) {
    samples.push(last);
  }
  return samples;
};

const setMeasuredContent = (node: HTMLDivElement, content: React.ReactNode): void => {
  if (React.isValidElement(content)) {
    node.innerHTML = renderToStaticMarkup(content);
  } else {
    node.textContent = String(content ?? '');
  }
};

export interface ColumnMeasurerOptions<T> {
  tableData: T[];
  parseWidthInputToNumber: (input: ColumnWidthInput | undefined) => number | null;
  defaultColumnWidth: number;
  getColumnMinWidth: (column: GridColumnDefinition<T>) => number;
  getColumnMaxWidth: (column: GridColumnDefinition<T>) => number;
}

export function useGridTableColumnMeasurer<T>({
  tableData,
  parseWidthInputToNumber,
  defaultColumnWidth,
  getColumnMinWidth,
  getColumnMaxWidth,
}: ColumnMeasurerOptions<T>) {
  const measureColumnWidth = useCallback(
    (column: GridColumnDefinition<T>): number => {
      if (typeof document === 'undefined') {
        return (
          parseWidthInputToNumber(column.width) ??
          parseWidthInputToNumber(column.minWidth) ??
          defaultColumnWidth
        );
      }
      const cell = document.createElement('div');
      cell.className = `grid-cell ${column.className ?? ''}`;
      cell.style.position = 'absolute';
      cell.style.visibility = 'hidden';
      cell.style.left = '-9999px';
      cell.style.whiteSpace = 'nowrap';
      cell.style.width = 'auto';
      document.body.appendChild(cell);
      let measuredWidth = measureHeaderWidth(column);
      try {
        for (const item of selectMeasurementSamples(tableData)) {
          setMeasuredContent(cell, column.render(item));
          measuredWidth = Math.max(measuredWidth, cell.getBoundingClientRect().width);
        }
      } finally {
        detachNode(cell);
      }

      const contentWidth = Math.ceil(measuredWidth > 0 ? measuredWidth : defaultColumnWidth);
      const minimum = Math.max(contentWidth, getColumnMinWidth(column));
      const configuredMaximum = getColumnMaxWidth(column);
      const autoSizeMaximum = parseWidthInputToNumber(column.autoSizeMaxWidth);
      const maximum =
        autoSizeMaximum === null ? configuredMaximum : Math.min(configuredMaximum, autoSizeMaximum);
      return Number.isFinite(maximum) ? Math.min(minimum, maximum) : minimum;
    },
    [defaultColumnWidth, getColumnMaxWidth, getColumnMinWidth, parseWidthInputToNumber, tableData]
  );

  return { measureColumnWidth };
}
