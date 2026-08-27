import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import {
  DEFAULT_COLUMN_WIDTH,
  getTextContent,
  isSortableColumn,
  parseWidthInputToNumber,
} from '@shared/components/tables/GridTable.utils';
import {
  clampAutoSizeColumnWidth,
  getColumnMinWidth,
} from '@shared/components/tables/hooks/gridTableColumnWidthMath';
import { getAppZoomFactor } from '@shared/utils/appZoom';
import React, { type ReactNode, useCallback } from 'react';

const AUTO_WIDTH_PAINT_GUTTER_PX = 1;

const detachNode = (node: HTMLElement): void => {
  node.remove();
};

const createHeaderMeasurementNode = (): HTMLDivElement => {
  const node = document.createElement('div');
  node.className = 'grid-cell-header';
  node.style.position = 'absolute';
  node.style.visibility = 'hidden';
  node.style.left = '-9999px';
  node.style.whiteSpace = 'nowrap';
  node.style.width = 'auto';
  return node;
};

const copyMeasurementAttributes = (element: HTMLElement, props: Record<string, unknown>): void => {
  if (typeof props.className === 'string') {
    element.className = props.className;
  }
  if (props.style && typeof props.style === 'object') {
    Object.assign(element.style, props.style);
  }
  for (const [name, value] of Object.entries(props)) {
    if (
      (name.startsWith('data-') || name.startsWith('aria-') || name === 'title') &&
      (typeof value === 'string' || typeof value === 'number')
    ) {
      element.setAttribute(name, String(value));
    }
  }
};

const appendInertMeasurementContent = (parent: HTMLElement, content: ReactNode): void => {
  if (typeof content === 'string' || typeof content === 'number') {
    parent.appendChild(document.createTextNode(String(content)));
    return;
  }
  if (Array.isArray(content)) {
    for (const child of content) {
      appendInertMeasurementContent(parent, child);
    }
    return;
  }
  if (!React.isValidElement(content)) {
    return;
  }

  const props = content.props as Record<string, unknown> & { children?: ReactNode };
  if (typeof content.type !== 'string') {
    parent.appendChild(document.createTextNode(getTextContent(content)));
    return;
  }

  const element = document.createElement(content.type);
  copyMeasurementAttributes(element, props);
  appendInertMeasurementContent(element, props.children);
  parent.appendChild(element);
};

const createCellMeasurementNode = <T>(column: GridColumnDefinition<T>, item: T): HTMLDivElement => {
  const cell = document.createElement('div');
  cell.className = `grid-cell gridtable-column-measurement-sample ${column.className ?? ''}`;
  cell.style.position = 'absolute';
  cell.style.visibility = 'hidden';
  cell.style.left = '-9999px';
  cell.style.whiteSpace = 'nowrap';
  cell.style.width = 'auto';
  const content = document.createElement('span');
  content.className = 'grid-cell-content';
  if (column.measurementElement) {
    const measurement = column.measurementElement(item);
    const element = document.createElement(measurement.tagName);
    element.className = measurement.className ?? '';
    element.textContent = measurement.textContent;
    content.appendChild(element);
  } else if (column.measurementText) {
    content.textContent = column.measurementText(item);
  } else {
    appendInertMeasurementContent(content, column.render(item));
  }
  cell.appendChild(content);
  return cell;
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
      const header = createHeaderMeasurementNode();
      header.textContent = column.header;
      const measurementNodes: HTMLDivElement[] = [];
      const measuredSampleKeys = column.measurementSampleKey ? new Set<string>() : null;
      for (const item of tableData) {
        if (measuredSampleKeys && column.measurementSampleKey) {
          const sampleKey = column.measurementSampleKey(item);
          if (measuredSampleKeys.has(sampleKey)) {
            continue;
          }
          measuredSampleKeys.add(sampleKey);
        }
        measurementNodes.push(createCellMeasurementNode(column, item));
      }

      const fragment = document.createDocumentFragment();
      fragment.append(header, ...measurementNodes);
      document.body.appendChild(fragment);

      try {
        let measuredWidth =
          header.scrollWidth > 0 && isSortableColumn(column)
            ? header.scrollWidth + 20
            : header.scrollWidth;
        const zoomFactor = getAppZoomFactor();
        for (const cell of measurementNodes) {
          measuredWidth = Math.max(measuredWidth, cell.getBoundingClientRect().width / zoomFactor);
        }

        const contentWidth =
          measuredWidth > 0
            ? Math.ceil(measuredWidth) + AUTO_WIDTH_PAINT_GUTTER_PX
            : DEFAULT_COLUMN_WIDTH;
        return clampAutoSizeColumnWidth(column, Math.max(contentWidth, getColumnMinWidth(column)));
      } finally {
        detachNode(header);
        for (const cell of measurementNodes) {
          detachNode(cell);
        }
      }
    },
    [tableData]
  );

  return { measureColumnWidth };
}
