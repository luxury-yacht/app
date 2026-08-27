import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import {
  DEFAULT_COLUMN_WIDTH,
  isSortableColumn,
  parseWidthInputToNumber,
} from '@shared/components/tables/GridTable.utils';
import {
  clampAutoSizeColumnWidth,
  getColumnMinWidth,
} from '@shared/components/tables/hooks/gridTableColumnWidthMath';
import { getAppZoomFactor } from '@shared/utils/appZoom';
import { type ReactNode, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

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

const setMeasuredContent = (root: Root, content: ReactNode): void => {
  flushSync(() => {
    root.render(content);
  });
};

export interface ColumnMeasurerOptions<T> {
  tableData: T[];
}

export function useGridTableColumnMeasurer<T>({ tableData }: ColumnMeasurerOptions<T>) {
  const measureColumnWidth = useCallback(
    (column: GridColumnDefinition<T>): number => {
      if (typeof document === 'undefined') {
        return (
          parseWidthInputToNumber(column.width) ??
          parseWidthInputToNumber(column.minWidth) ??
          DEFAULT_COLUMN_WIDTH
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
      const contentRoot = createRoot(content);
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
          setMeasuredContent(contentRoot, column.render(item));
          measuredWidth = Math.max(measuredWidth, cell.getBoundingClientRect().width / zoomFactor);
        }
      } finally {
        flushSync(() => {
          contentRoot.unmount();
        });
        detachNode(cell);
      }

      const contentWidth =
        measuredWidth > 0
          ? Math.ceil(measuredWidth) + AUTO_WIDTH_PAINT_GUTTER_PX
          : DEFAULT_COLUMN_WIDTH;
      return clampAutoSizeColumnWidth(column, Math.max(contentWidth, getColumnMinWidth(column)));
    },
    [tableData]
  );

  return { measureColumnWidth };
}
