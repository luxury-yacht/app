/**
 * frontend/src/shared/components/tables/hooks/useGridTableRowDetail.tsx
 *
 * Open rows' full-width details (GridTableProps.rowDetail): which displayed
 * rows are open, each detail's measured height for the virtualizer, and the
 * detail rows.
 */

import '@shared/components/tables/GridTableRowDetail.css';
import { AriaGridCell, AriaGridRow } from '@shared/components/tables/AriaGridPrimitives';
import type { GridTableRowDetail } from '@shared/components/tables/GridTable.types';
import {
  getGridTableRowDetailId,
  revealVertically,
} from '@shared/components/tables/GridTable.utils';
import {
  type RowDetailNavigation,
  RowDetailNavigationContext,
} from '@shared/components/tables/rowDetailNavigation';
import { getAppZoomFactor } from '@shared/utils/appZoom';
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

const NO_OPEN_ROWS: ReadonlyMap<number, string> = new Map();
const NO_HEIGHTS: ReadonlyMap<string, number> = new Map();

export interface GridTableRowDetailState {
  /** Open rows among the displayed rows: index to row key, in table order. */
  openRows: ReadonlyMap<number, string>;
  /** Measured detail heights of those rows by row key; unmeasured ones are absent. */
  heights: ReadonlyMap<string, number>;
  /** Records a detail's height; null forgets it once the detail unmounts. */
  reportHeight: (rowKey: string, height: number | null) => void;
}

// `heights` with rowKey's height set, or removed for null; the same map when nothing changes.
const withDetailHeight = (
  heights: ReadonlyMap<string, number>,
  rowKey: string,
  height: number | null
): ReadonlyMap<string, number> => {
  const previous = heights.get(rowKey);
  if (height === null) {
    if (previous === undefined) {
      return heights;
    }
    const next = new Map(heights);
    next.delete(rowKey);
    return next;
  }
  if (previous !== undefined && Math.abs(previous - height) <= 0.5) {
    return heights;
  }
  return new Map(heights).set(rowKey, height);
};

export function useGridTableRowDetailState<T>(
  rowDetail: GridTableRowDetail<T> | undefined,
  tableData: T[],
  keyExtractor: (item: T, index: number) => string
): GridTableRowDetailState {
  const openRowKeys = rowDetail?.openRowKeys;
  const openRows = useMemo(() => {
    if (!openRowKeys?.length) {
      return NO_OPEN_ROWS;
    }
    const open = new Set(openRowKeys);
    const rows = new Map<number, string>();
    tableData.forEach((item, index) => {
      const rowKey = keyExtractor(item, index);
      if (open.has(rowKey)) {
        rows.set(index, rowKey);
      }
    });
    return rows;
  }, [keyExtractor, openRowKeys, tableData]);
  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(NO_HEIGHTS);
  const reportHeight = useCallback((rowKey: string, height: number | null) => {
    setMeasured((current) => withDetailHeight(current, rowKey, height));
  }, []);
  const heights = useMemo(() => {
    if (openRows.size === 0) {
      return NO_HEIGHTS;
    }
    const shown = new Map<string, number>();
    for (const rowKey of openRows.values()) {
      const height = measured.get(rowKey);
      if (height !== undefined) {
        shown.set(rowKey, height);
      }
    }
    return shown;
  }, [measured, openRows]);
  return { openRows, heights, reportHeight };
}

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || Boolean(target.closest('input, textarea, select')));

interface RowDetailRowProps {
  rowKey: string;
  label: string;
  /** Classes shared with the open row (GridTableRowDetail.getGroupClassName). */
  groupClassName?: string;
  /** Virtual-mode offset; undefined in normal flow. */
  top?: number;
  width?: number;
  maxHeight: number;
  onHeight: (rowKey: string, height: number | null) => void;
  consumeScroll: (rowKey: string) => boolean;
  /** Moves the keyboard back to this detail's row. */
  onReturnFocus: () => void;
  children: React.ReactNode;
}

function GridTableRowDetailRow({
  rowKey,
  label,
  groupClassName,
  top,
  width,
  maxHeight,
  onHeight,
  consumeScroll,
  onReturnFocus,
  children,
}: Readonly<RowDetailRowProps>) {
  const rowRef = useRef<HTMLTableRowElement | null>(null);
  const onHeightRef = useRef(onHeight);
  onHeightRef.current = onHeight;
  const onReturnFocusRef = useRef(onReturnFocus);
  onReturnFocusRef.current = onReturnFocus;

  useLayoutEffect(() => {
    const node = rowRef.current;
    if (!node) {
      return;
    }
    const report = () => {
      // The virtualizer works in CSS pixels; rects are zoomed under page zoom.
      const height = node.getBoundingClientRect().height / getAppZoomFactor();
      if (height > 0) {
        onHeightRef.current(rowKey, height);
      }
    };
    report();
    if (consumeScroll(rowKey)) {
      revealVertically(node);
    }
    // Keys pressed in the nested content bubble here after the content handled
    // them; an unhandled Escape returns to this detail's row.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onReturnFocusRef.current();
    };
    node.addEventListener('keydown', handleKeyDown);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(report);
    observer?.observe(node);
    return () => {
      node.removeEventListener('keydown', handleKeyDown);
      observer?.disconnect();
      onHeightRef.current(rowKey, null);
    };
  }, [consumeScroll, rowKey]);

  // Closing with focus inside (its own Close, or the row leaving the table)
  // would drop the keyboard to the page, so it returns to its open row.
  useLayoutEffect(() => {
    const node = rowRef.current;
    return () => {
      if (node?.contains(document.activeElement)) {
        onReturnFocusRef.current();
      }
    };
  }, []);

  return (
    <AriaGridRow
      ref={rowRef}
      className={groupClassName ? `gridtable-row-detail ${groupClassName}` : 'gridtable-row-detail'}
      data-gridtable-row-detail="true"
      data-row-detail-key={rowKey}
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
  /** The keyboard-navigation context each detail gives the table nested in it. */
  getNavigation: (rowKey: string) => RowDetailNavigation;
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
  getNavigation,
}: RowDetailRendererOptions<T>): RenderRowDetailFn<T> {
  const { openRows, heights, reportHeight } = state;
  // Each detail scrolls into view once when it opens; refreshes and remounts
  // don't scroll again. One that closes or leaves the displayed rows scrolls
  // again when it reopens.
  const scrolledKeysRef = useRef(new Set<string>());
  useEffect(() => {
    const open = new Set(openRows.values());
    for (const rowKey of scrolledKeysRef.current) {
      if (!open.has(rowKey)) {
        scrolledKeysRef.current.delete(rowKey);
      }
    }
  }, [openRows]);
  const consumeScroll = useCallback((rowKey: string) => {
    if (scrolledKeysRef.current.has(rowKey)) {
      return false;
    }
    scrolledKeysRef.current.add(rowKey);
    return true;
  }, []);

  const returnFocus = useCallback(
    (index: number) => {
      lastNavigationMethodRef.current = 'keyboard';
      focusByIndex(index);
      // The keyboard navigation reveals the row; see useGridTableScreenOrderNavigation.
      gridRef.current?.focus({ preventScroll: true });
    },
    [focusByIndex, gridRef, lastNavigationMethodRef]
  );

  return useCallback(
    (item: T, index: number, virtualized: boolean) => {
      const rowKey = openRows.get(index);
      if (!rowDetail || rowKey === undefined) {
        return null;
      }
      const height = heights.get(rowKey) ?? 0;
      return (
        <GridTableRowDetailRow
          key={`row-detail:${rowKey}`}
          rowKey={rowKey}
          label={rowDetail.getLabel(item)}
          groupClassName={rowDetail.getGroupClassName?.(item)}
          top={virtualized ? getRowTop(index + 1) - height : undefined}
          width={viewportWidth > 0 ? viewportWidth : undefined}
          maxHeight={Math.max(
            DETAIL_MIN_MAX_HEIGHT,
            Math.round(viewportHeight * DETAIL_MAX_VIEWPORT_SHARE)
          )}
          onHeight={reportHeight}
          consumeScroll={consumeScroll}
          onReturnFocus={() => returnFocus(index)}
        >
          <RowDetailNavigationContext.Provider value={getNavigation(rowKey)}>
            {rowDetail.render(item)}
          </RowDetailNavigationContext.Provider>
        </GridTableRowDetailRow>
      );
    },
    [
      consumeScroll,
      getNavigation,
      getRowTop,
      heights,
      openRows,
      reportHeight,
      returnFocus,
      rowDetail,
      viewportHeight,
      viewportWidth,
    ]
  );
}
