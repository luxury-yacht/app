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

const appendSpan = (parent: HTMLElement, className: string): HTMLSpanElement => {
  const span = document.createElement('span');
  span.className = className;
  parent.appendChild(span);
  return span;
};

// Mirrors the rendered header cell (useGridTableHeaderRow) inside a header row,
// so row-level header styles such as uppercase labels apply to the measurement.
const createHeaderMeasurementNode = <T>(
  column: GridColumnDefinition<T>
): { row: HTMLDivElement; cell: HTMLDivElement } => {
  const row = document.createElement('div');
  row.className = 'gridtable-header';
  row.style.position = 'absolute';
  row.style.visibility = 'hidden';
  row.style.left = '-9999px';
  row.style.width = 'auto';
  const cell = document.createElement('div');
  cell.className = `grid-cell grid-cell-header ${column.className ?? ''}`;
  cell.dataset.align = column.alignHeader ?? 'left';
  cell.dataset.sortable = String(isSortableColumn(column));
  cell.style.whiteSpace = 'nowrap';
  cell.style.width = 'auto';
  const labelGroup = appendSpan(appendSpan(cell, 'header-content'), 'gridtable-header-label-group');
  appendSpan(labelGroup, 'gridtable-header-label').textContent = column.header;
  row.appendChild(cell);
  return { row, cell };
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

// One inert sample per row, or per distinct declared sample key.
const createCellMeasurementNodes = <T>(
  column: GridColumnDefinition<T>,
  tableData: T[]
): HTMLDivElement[] => {
  const nodes: HTMLDivElement[] = [];
  const measuredSampleKeys = column.measurementSampleKey ? new Set<string>() : null;
  for (const item of tableData) {
    const sampleKey = column.measurementSampleKey?.(item);
    if (measuredSampleKeys && sampleKey !== undefined) {
      if (measuredSampleKeys.has(sampleKey)) {
        continue;
      }
      measuredSampleKeys.add(sampleKey);
    }
    nodes.push(createCellMeasurementNode(column, item));
  }
  return nodes;
};

const measureHeaderWidth = <T>(
  column: GridColumnDefinition<T>,
  headerCell: HTMLElement
): number => {
  const width = headerCell.scrollWidth;
  // Sortable headers reserve room for the sort indicator.
  return width > 0 && isSortableColumn(column) ? width + 20 : width;
};

const measureWidestCell = (cells: HTMLElement[]): number => {
  const zoomFactor = getAppZoomFactor();
  let widest = 0;
  for (const cell of cells) {
    widest = Math.max(widest, cell.getBoundingClientRect().width / zoomFactor);
  }
  return widest;
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
      const header = createHeaderMeasurementNode(column);
      const measurementNodes = createCellMeasurementNodes(column, tableData);

      const fragment = document.createDocumentFragment();
      fragment.append(header.row, ...measurementNodes);
      document.body.appendChild(fragment);

      try {
        const measuredWidth = Math.max(
          measureHeaderWidth(column, header.cell),
          measureWidestCell(measurementNodes)
        );
        const contentWidth =
          measuredWidth > 0
            ? Math.ceil(measuredWidth) + AUTO_WIDTH_PAINT_GUTTER_PX
            : DEFAULT_COLUMN_WIDTH;
        return clampAutoSizeColumnWidth(column, Math.max(contentWidth, getColumnMinWidth(column)));
      } finally {
        detachNode(header.row);
        for (const cell of measurementNodes) {
          detachNode(cell);
        }
      }
    },
    [tableData]
  );

  return { measureColumnWidth };
}
