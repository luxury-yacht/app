/**
 * frontend/src/shared/components/tables/hooks/useGridTableRowDetail.tsx
 *
 * One open row's full-width detail (GridTableProps.rowDetail): which row is
 * open, the detail's measured height for the virtualizer, and the detail row.
 */

import '@shared/components/tables/GridTableRowDetail.css';
import { AriaGridCell, AriaGridRow } from '@shared/components/tables/AriaGridPrimitives';
import type { GridTableRowDetail } from '@shared/components/tables/GridTable.types';
import { getGridTableRowDetailId } from '@shared/components/tables/GridTable.utils';
import type React from 'react';
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// The detail is capped to this share of the table viewport; its content scrolls inside.
const DETAIL_MAX_VIEWPORT_SHARE = 0.6;
// A short (or not yet measured) viewport still leaves room for a few rows.
const DETAIL_MIN_MAX_HEIGHT = 240;

export interface GridTableRowDetailState {
  /** The open row's key, or null when it is not among the displayed rows. */
  rowKey: string | null;
  index: number | null;
  height: number;
  reportHeight: (rowKey: string, height: number) => void;
}

export function useGridTableRowDetailState<T>(
  rowDetail: GridTableRowDetail<T> | undefined,
  tableData: T[],
  keyExtractor: (item: T, index: number) => string
): GridTableRowDetailState {
  const openRowKey = rowDetail?.openRowKey ?? null;
  const index = useMemo(() => {
    if (openRowKey === null) {
      return null;
    }
    const found = tableData.findIndex((item, i) => keyExtractor(item, i) === openRowKey);
    return found === -1 ? null : found;
  }, [keyExtractor, openRowKey, tableData]);
  const [measured, setMeasured] = useState<{ rowKey: string; height: number } | null>(null);
  const reportHeight = useCallback((measuredKey: string, measuredHeight: number) => {
    setMeasured((current) =>
      current?.rowKey === measuredKey && Math.abs(current.height - measuredHeight) <= 0.5
        ? current
        : { rowKey: measuredKey, height: measuredHeight }
    );
  }, []);
  const rowKey = index === null ? null : openRowKey;
  return {
    rowKey,
    index,
    height: measured !== null && measured.rowKey === rowKey ? measured.height : 0,
    reportHeight,
  };
}

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || Boolean(target.closest('input, textarea, select')));

interface RowDetailRowProps {
  rowKey: string;
  label: string;
  /** Virtual-mode offset; undefined in normal flow. */
  top?: number;
  width?: number;
  maxHeight: number;
  onHeight: (rowKey: string, height: number) => void;
  consumeScroll: (rowKey: string) => boolean;
  onEscape: (event: KeyboardEvent) => void;
  children: React.ReactNode;
}

function GridTableRowDetailRow({
  rowKey,
  label,
  top,
  width,
  maxHeight,
  onHeight,
  consumeScroll,
  onEscape,
  children,
}: Readonly<RowDetailRowProps>) {
  const rowRef = useRef<HTMLTableRowElement | null>(null);
  const onHeightRef = useRef(onHeight);
  onHeightRef.current = onHeight;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useLayoutEffect(() => {
    const node = rowRef.current;
    if (!node) {
      return;
    }
    const report = () => {
      const height = node.getBoundingClientRect().height;
      if (height > 0) {
        onHeightRef.current(rowKey, height);
      }
    };
    report();
    if (consumeScroll(rowKey)) {
      node.scrollIntoView?.({ block: 'nearest' });
    }
    // Keys pressed in the nested content bubble here after the content handled them.
    const handleKeyDown = (event: KeyboardEvent) => onEscapeRef.current(event);
    node.addEventListener('keydown', handleKeyDown);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(report);
    observer?.observe(node);
    return () => {
      node.removeEventListener('keydown', handleKeyDown);
      observer?.disconnect();
    };
  }, [consumeScroll, rowKey]);

  return (
    <AriaGridRow
      ref={rowRef}
      className="gridtable-row-detail"
      data-gridtable-row-detail="true"
      style={
        top === undefined ? undefined : { position: 'absolute', transform: `translateY(${top}px)` }
      }
    >
      <AriaGridCell className="gridtable-row-detail__cell" colSpan={1000}>
        <section
          id={getGridTableRowDetailId(rowKey)}
          className="gridtable-row-detail__content"
          aria-label={label}
          style={{ width, maxHeight }}
        >
          {children}
        </section>
      </AriaGridCell>
    </AriaGridRow>
  );
}

export type RenderRowDetailFn<T> = (
  item: T,
  index: number,
  virtualized: boolean
) => React.ReactNode;

interface RowDetailRendererOptions<T> {
  rowDetail: GridTableRowDetail<T> | undefined;
  state: GridTableRowDetailState;
  getRowTop: (index: number) => number;
  viewportWidth: number;
  viewportHeight: number;
  gridRef: RefObject<HTMLTableElement | null>;
  focusByIndex: (index: number) => void;
  lastNavigationMethodRef: RefObject<'pointer' | 'keyboard'>;
}

export function useGridTableRowDetailRenderer<T>({
  rowDetail,
  state,
  getRowTop,
  viewportWidth,
  viewportHeight,
  gridRef,
  focusByIndex,
  lastNavigationMethodRef,
}: RowDetailRendererOptions<T>): RenderRowDetailFn<T> {
  // A newly opened detail scrolls into view once; refreshes and remounts don't scroll again.
  const scrolledKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (state.rowKey === null) {
      scrolledKeyRef.current = null;
    }
  }, [state.rowKey]);
  const consumeScroll = useCallback((rowKey: string) => {
    if (scrolledKeyRef.current === rowKey) {
      return false;
    }
    scrolledKeyRef.current = rowKey;
    return true;
  }, []);

  // Escape inside the detail returns the keyboard to the open row.
  const openIndex = state.index;
  const handleEscape = useCallback(
    (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        openIndex === null ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      lastNavigationMethodRef.current = 'keyboard';
      focusByIndex(openIndex);
      gridRef.current?.focus();
    },
    [focusByIndex, gridRef, lastNavigationMethodRef, openIndex]
  );

  const { rowKey: openRowKey, height: detailHeight, reportHeight } = state;
  return useCallback(
    (item: T, index: number, virtualized: boolean) => {
      if (!rowDetail || openRowKey === null || index !== openIndex) {
        return null;
      }
      return (
        <GridTableRowDetailRow
          key={`row-detail:${openRowKey}`}
          rowKey={openRowKey}
          label={rowDetail.getLabel(item)}
          top={virtualized ? getRowTop(index + 1) - detailHeight : undefined}
          width={viewportWidth > 0 ? viewportWidth : undefined}
          maxHeight={Math.max(
            DETAIL_MIN_MAX_HEIGHT,
            Math.round(viewportHeight * DETAIL_MAX_VIEWPORT_SHARE)
          )}
          onHeight={reportHeight}
          consumeScroll={consumeScroll}
          onEscape={handleEscape}
        >
          {rowDetail.render(item)}
        </GridTableRowDetailRow>
      );
    },
    [
      consumeScroll,
      detailHeight,
      getRowTop,
      handleEscape,
      openIndex,
      openRowKey,
      reportHeight,
      rowDetail,
      viewportHeight,
      viewportWidth,
    ]
  );
}
