/**
 * frontend/src/shared/components/tables/hooks/useGridTableColumnMeasurer.ts
 *
 * React hook for useGridTableColumnMeasurer.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback, useEffect, useRef } from 'react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import type {
  ColumnWidthInput,
  GridColumnDefinition,
} from '@shared/components/tables/GridTable.types';

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
      measurer.host?.removeChild(measurer.container);
      host.appendChild(measurer.container);
      measurer.host = host;
    }
    return measurer;
  }, [tableRef]);

  useEffect(() => {
    return () => {
      if (kindBadgeMeasureRef.current?.container) {
        kindBadgeMeasureRef.current.container.remove();
      }
      kindBadgeMeasureRef.current = null;
    };
  }, []);

  const measureColumnWidth = useCallback(
    (column: GridColumnDefinition<T>): number => {
      if (typeof document === 'undefined') {
        return (
          parseWidthInputToNumber(column.width) ??
          parseWidthInputToNumber(column.minWidth) ??
          defaultColumnWidth
        );
      }

      let maxWidth = 0;

      const headerMeasurer = document.createElement('div');
      headerMeasurer.className = 'grid-cell-header';
      headerMeasurer.style.position = 'absolute';
      headerMeasurer.style.visibility = 'hidden';
      headerMeasurer.style.left = '-9999px';
      headerMeasurer.style.whiteSpace = 'nowrap';
      headerMeasurer.style.width = 'auto';
      headerMeasurer.textContent = column.header;
      document.body.appendChild(headerMeasurer);
      try {
        let headerWidth = headerMeasurer.scrollWidth;
        if (column.sortable) {
          headerWidth += 20;
        }
        maxWidth = Math.max(maxWidth, headerWidth);
      } finally {
        document.body.removeChild(headerMeasurer);
      }

      const isKindColumn = isKindColumnKey(column.key);
      const kindMeasurer = isKindColumn ? ensureKindBadgeMeasurer() : null;

      // Create an off-screen measurer node with a React root for direct DOM
      // rendering. This avoids the serialize→parse round-trip of renderToString/
      // renderToStaticMarkup — React elements are rendered straight into the DOM.
      const cellMeasurer =
        !isKindColumn || !kindMeasurer
          ? (() => {
              const node = document.createElement('div');
              node.className = 'grid-cell';
              node.style.position = 'absolute';
              node.style.visibility = 'hidden';
              node.style.left = '-9999px';
              node.style.whiteSpace = 'nowrap';
              node.style.width = 'auto';
              document.body.appendChild(node);
              return { node, root: createRoot(node) };
            })()
          : null;

      const measureLimit = 400;
      const sampleItems: T[] = [];
      if (tableData.length <= measureLimit) {
        sampleItems.push(...tableData);
      } else {
        const step = Math.max(1, Math.ceil(tableData.length / measureLimit));
        for (let index = 0; index < tableData.length; index += step) {
          sampleItems.push(tableData[index]);
        }
        const last = tableData[tableData.length - 1];
        if (sampleItems[sampleItems.length - 1] !== last) {
          sampleItems.push(last);
        }
      }

      // Wrap measurement loop in try/finally so cellMeasurer and kindMeasurer
      // are cleaned up even if column.render() or renderToString() throws.
      try {
        sampleItems.forEach((item) => {
          const contentNode = column.render(item);

          if (kindMeasurer) {
            const displayText = getTextContent(contentNode).trim();
            let canonicalKind = displayText;

            if (React.isValidElement(contentNode)) {
              const explicit = (contentNode.props as Record<string, unknown>)?.['data-kind-value'];
              if (typeof explicit === 'string' && explicit.trim().length > 0) {
                canonicalKind = explicit.trim();
              }
            }

            kindMeasurer.badge.className = `kind-badge ${normalizeKindClass(canonicalKind)}`;
            kindMeasurer.badge.textContent = displayText;

            const badgeWidth = kindMeasurer.container.getBoundingClientRect().width;
            maxWidth = Math.max(maxWidth, badgeWidth);
            return;
          }

          if (!cellMeasurer) {
            return;
          }

          if (React.isValidElement(contentNode)) {
            // Render directly into the DOM — avoids the synchronous
            // serialize→parse round-trip of renderToString/renderToStaticMarkup.
            flushSync(() => {
              cellMeasurer.root.render(contentNode);
            });
          } else {
            cellMeasurer.node.textContent = String(contentNode ?? '');
          }

          const width = cellMeasurer.node.getBoundingClientRect().width;
          maxWidth = Math.max(maxWidth, width);
        });
      } finally {
        if (cellMeasurer) {
          cellMeasurer.root.unmount();
          cellMeasurer.node.remove();
        }
        if (kindMeasurer) {
          kindMeasurer.badge.textContent = '';
        }
      }

      let measured = Math.ceil(maxWidth > 0 ? maxWidth : defaultColumnWidth);
      measured = Math.max(measured, getColumnMinWidth(column));
      const maxAllowed = getColumnMaxWidth(column);
      if (Number.isFinite(maxAllowed)) {
        measured = Math.min(measured, maxAllowed);
      }

      return measured;
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
