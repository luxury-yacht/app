import type {
  ColumnWidthInput,
  GridColumnDefinition,
} from '@shared/components/tables/GridTable.types';
import { isSortableColumn } from '@shared/components/tables/GridTable.utils';
import { getAppZoomFactor } from '@shared/utils/appZoom';
import React, { useCallback } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const AUTO_WIDTH_PAINT_GUTTER_PX = 1;

const detachNode = (node: HTMLElement): void => {
  node.remove();
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

const setMeasuredContent = (node: HTMLElement, content: React.ReactNode): void => {
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
      const content = document.createElement('span');
      content.className = 'grid-cell-content';
      cell.appendChild(content);
      document.body.appendChild(cell);
      let measuredWidth = measureHeaderWidth(column);
      const zoomFactor = getAppZoomFactor();
      const measuredSampleKeys = column.measurementSampleKey ? new Set<string>() : null;
      try {
        for (const item of tableData) {
          if (measuredSampleKeys && column.measurementSampleKey) {
            const sampleKey = column.measurementSampleKey(item);
            if (measuredSampleKeys.has(sampleKey)) {
              continue;
            }
            measuredSampleKeys.add(sampleKey);
          }
          setMeasuredContent(content, column.render(item));
          measuredWidth = Math.max(measuredWidth, cell.getBoundingClientRect().width / zoomFactor);
        }
      } finally {
        detachNode(cell);
      }

      const contentWidth =
        measuredWidth > 0
          ? Math.ceil(measuredWidth) + AUTO_WIDTH_PAINT_GUTTER_PX
          : defaultColumnWidth;
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
