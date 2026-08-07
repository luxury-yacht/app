/**
 * frontend/src/shared/components/tables/hooks/useGridTableColumnMeasurer.ts
 *
 * React hook for useGridTableColumnMeasurer.
 * Encapsulates state and side effects for the shared components.
 */

import type {
  ColumnWidthInput,
  GridColumnDefinition,
} from '@shared/components/tables/GridTable.types';
import { isSortableColumn } from '@shared/components/tables/GridTable.utils';
import React, { useCallback, useEffect, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Provides DOM-based column width measurement helpers for GridTable:
// - measures arbitrary column content
// - special-cases kind badges so they render without clipping
// - respects column min/max widths when reporting sizes to auto-width logic

interface KindBadgeMeasurer {
  host: HTMLElement | null;
  container: HTMLDivElement;
  content: HTMLSpanElement;
  badge: HTMLSpanElement;
}

interface KindBadgeSample {
  canonicalKind: string;
  displayText: string;
  interactive: boolean;
}

interface CellMeasurer {
  node: HTMLDivElement;
}

const MEASUREMENT_SAMPLE_LIMIT = 400;

const detachNode = (node: HTMLElement | null) => {
  if (!node) {
    return;
  }
  if (node.parentNode) {
    node.parentNode.removeChild(node);
    return;
  }
  node.remove();
};

const getFallbackWidth = <T>(
  column: GridColumnDefinition<T>,
  parseWidthInputToNumber: (input: ColumnWidthInput | undefined) => number | null,
  defaultColumnWidth: number
): number =>
  parseWidthInputToNumber(column.width) ??
  parseWidthInputToNumber(column.minWidth) ??
  defaultColumnWidth;

const measureHeaderWidth = <T>(column: GridColumnDefinition<T>): number => {
  const measurer = document.createElement('div');
  measurer.className = 'grid-cell-header';
  measurer.style.position = 'absolute';
  measurer.style.visibility = 'hidden';
  measurer.style.left = '-9999px';
  measurer.style.whiteSpace = 'nowrap';
  measurer.style.width = 'auto';
  measurer.textContent = column.header;
  document.body.appendChild(measurer);
  try {
    const width = measurer.scrollWidth;
    return width > 0 && isSortableColumn(column) ? width + 20 : width;
  } finally {
    detachNode(measurer);
  }
};

const buildKindBadgeSample = (
  contentNode: React.ReactNode,
  getTextContent: (node: React.ReactNode) => string
): KindBadgeSample => {
  const displayText = getTextContent(contentNode).trim();
  if (!React.isValidElement(contentNode)) {
    return { canonicalKind: displayText, displayText, interactive: false };
  }
  const props = contentNode.props as Record<string, unknown>;
  const explicit = props?.['data-kind-value'];
  const canonicalKind =
    typeof explicit === 'string' && explicit.trim().length > 0 ? explicit.trim() : displayText;
  const interactive =
    props?.['data-kind-interactive'] === 'true' ||
    typeof props?.onClick === 'function' ||
    typeof props?.onKeyDown === 'function' ||
    props?.role === 'button';
  return { canonicalKind, displayText, interactive };
};

const getKindBadgeSampleKey = (sample: KindBadgeSample): string =>
  `${sample.canonicalKind}::${sample.displayText}::${sample.interactive ? '1' : '0'}`;

const applyKindBadgeSample = (
  measurer: KindBadgeMeasurer,
  sample: KindBadgeSample,
  normalizeKindClass: (value: string) => string
): void => {
  const classes = ['kind-badge', normalizeKindClass(sample.canonicalKind)];
  if (sample.interactive) {
    classes.push('clickable');
  }
  measurer.badge.className = classes.join(' ');
  measurer.badge.textContent = sample.displayText;
};

const measureKindBadges = <T>(
  column: GridColumnDefinition<T>,
  tableData: T[],
  measurer: KindBadgeMeasurer,
  getTextContent: (node: React.ReactNode) => string,
  normalizeKindClass: (value: string) => string
): number => {
  const seenBadges = new Set<string>();
  let maxWidth = 0;
  for (const item of tableData) {
    const sample = buildKindBadgeSample(column.render(item), getTextContent);
    const sampleKey = getKindBadgeSampleKey(sample);
    if (seenBadges.has(sampleKey)) {
      continue;
    }
    seenBadges.add(sampleKey);
    applyKindBadgeSample(measurer, sample, normalizeKindClass);
    maxWidth = Math.max(maxWidth, measurer.container.getBoundingClientRect().width);
    if (seenBadges.size >= MEASUREMENT_SAMPLE_LIMIT) {
      break;
    }
  }
  return maxWidth;
};

const createCellMeasurer = (): CellMeasurer => {
  const node = document.createElement('div');
  node.className = 'grid-cell';
  node.style.position = 'absolute';
  node.style.visibility = 'hidden';
  node.style.left = '-9999px';
  node.style.whiteSpace = 'nowrap';
  node.style.width = 'auto';
  document.body.appendChild(node);
  return { node };
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

const setCellMeasurerContent = (measurer: CellMeasurer, content: React.ReactNode): void => {
  if (React.isValidElement(content)) {
    measurer.node.innerHTML = renderToStaticMarkup(content);
    return;
  }
  measurer.node.textContent = String(content ?? '');
};

const measureCells = <T>(
  column: GridColumnDefinition<T>,
  tableData: T[],
  measurer: CellMeasurer
): number => {
  let maxWidth = 0;
  for (const item of selectMeasurementSamples(tableData)) {
    setCellMeasurerContent(measurer, column.render(item));
    maxWidth = Math.max(maxWidth, measurer.node.getBoundingClientRect().width);
  }
  return maxWidth;
};

const measureColumnContent = <T>(
  column: GridColumnDefinition<T>,
  tableData: T[],
  kindMeasurer: KindBadgeMeasurer | null,
  cellMeasurer: CellMeasurer | null,
  getTextContent: (node: React.ReactNode) => string,
  normalizeKindClass: (value: string) => string
): number => {
  if (kindMeasurer) {
    return measureKindBadges(column, tableData, kindMeasurer, getTextContent, normalizeKindClass);
  }
  return measureCells(column, tableData, cellMeasurer as CellMeasurer);
};

const cleanupMeasurers = (
  kindMeasurer: KindBadgeMeasurer | null,
  cellMeasurer: CellMeasurer | null
): void => {
  if (cellMeasurer) {
    detachNode(cellMeasurer.node);
  }
  if (kindMeasurer) {
    kindMeasurer.badge.textContent = '';
  }
};

const clampMeasuredWidth = <T>(
  measuredWidth: number,
  column: GridColumnDefinition<T>,
  defaultColumnWidth: number,
  getColumnMinWidth: (column: GridColumnDefinition<T>) => number,
  getColumnMaxWidth: (column: GridColumnDefinition<T>) => number,
  parseWidthInputToNumber: (input: ColumnWidthInput | undefined) => number | null
): number => {
  const contentWidth = Math.ceil(measuredWidth > 0 ? measuredWidth : defaultColumnWidth);
  const minimumWidth = Math.max(contentWidth, getColumnMinWidth(column));
  const configuredMaximum = getColumnMaxWidth(column);
  const autoSizeMaximum = parseWidthInputToNumber(column.autoSizeMaxWidth);
  const maximumWidth =
    autoSizeMaximum === null ? configuredMaximum : Math.min(configuredMaximum, autoSizeMaximum);
  return Number.isFinite(maximumWidth) ? Math.min(minimumWidth, maximumWidth) : minimumWidth;
};

export interface ColumnMeasurerOptions<T> {
  tableRef: React.RefObject<HTMLElement | null>;
  tableData: T[];
  parseWidthInputToNumber: (input: ColumnWidthInput | undefined) => number | null;
  defaultColumnWidth: number;
  isKindColumnKey: (key: string) => boolean;
  getTextContent: (node: React.ReactNode) => string;
  normalizeKindClass: (value: string) => string;
  getColumnMinWidth: (column: GridColumnDefinition<T>) => number;
  getColumnMaxWidth: (column: GridColumnDefinition<T>) => number;
}

export function useGridTableColumnMeasurer<T>({
  tableRef,
  tableData,
  parseWidthInputToNumber,
  defaultColumnWidth,
  isKindColumnKey,
  getTextContent,
  normalizeKindClass,
  getColumnMinWidth,
  getColumnMaxWidth,
}: ColumnMeasurerOptions<T>) {
  const kindBadgeMeasureRef = useRef<KindBadgeMeasurer | null>(null);

  const ensureKindBadgeMeasurer = useCallback((): KindBadgeMeasurer | null => {
    if (typeof document === 'undefined') {
      return null;
    }
    const host = tableRef.current ?? document.body;
    let measurer = kindBadgeMeasureRef.current;
    if (!measurer) {
      const container = document.createElement('div');
      container.className = 'grid-cell';
      container.style.position = 'absolute';
      container.style.visibility = 'hidden';
      container.style.pointerEvents = 'none';
      container.style.left = '-9999px';
      container.style.top = '-9999px';

      const content = document.createElement('span');
      content.className = 'grid-cell-content';
      container.appendChild(content);

      const badge = document.createElement('span');
      badge.className = 'kind-badge';
      content.appendChild(badge);

      host.appendChild(container);
      measurer = { host, container, content, badge };
      kindBadgeMeasureRef.current = measurer;
    } else if (measurer.host !== host) {
      detachNode(measurer.container);
      host.appendChild(measurer.container);
      measurer.host = host;
    }
    return measurer;
  }, [tableRef]);

  useEffect(() => {
    return () => {
      if (kindBadgeMeasureRef.current?.container) {
        detachNode(kindBadgeMeasureRef.current.container);
      }
      kindBadgeMeasureRef.current = null;
    };
  }, []);

  const measureColumnWidth = useCallback(
    (column: GridColumnDefinition<T>): number => {
      if (typeof document === 'undefined') {
        return getFallbackWidth(column, parseWidthInputToNumber, defaultColumnWidth);
      }
      const kindMeasurer = isKindColumnKey(column.key) ? ensureKindBadgeMeasurer() : null;
      const cellMeasurer = kindMeasurer ? null : createCellMeasurer();
      let measuredWidth = measureHeaderWidth(column);
      try {
        const cellsWidth = measureColumnContent(
          column,
          tableData,
          kindMeasurer,
          cellMeasurer,
          getTextContent,
          normalizeKindClass
        );
        measuredWidth = Math.max(measuredWidth, cellsWidth);
      } finally {
        cleanupMeasurers(kindMeasurer, cellMeasurer);
      }
      return clampMeasuredWidth(
        measuredWidth,
        column,
        defaultColumnWidth,
        getColumnMinWidth,
        getColumnMaxWidth,
        parseWidthInputToNumber
      );
    },
    [
      tableData,
      parseWidthInputToNumber,
      defaultColumnWidth,
      isKindColumnKey,
      ensureKindBadgeMeasurer,
      getTextContent,
      normalizeKindClass,
      getColumnMinWidth,
      getColumnMaxWidth,
    ]
  );

  return { measureColumnWidth };
}
