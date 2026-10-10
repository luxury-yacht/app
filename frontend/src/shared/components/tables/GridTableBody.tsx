/**
 * frontend/src/shared/components/tables/GridTableBody.tsx
 *
 * UI component for GridTableBody.
 * Handles rendering and interactions for the shared components.
 */

import {
  AriaGrid,
  AriaGridCell,
  AriaGridRow,
  AriaGridRowGroup,
} from '@shared/components/tables/AriaGridPrimitives';
import type { GridTableFilteredEmptyState } from '@shared/components/tables/GridTable.types';
import type { RenderRowDetailFn } from '@shared/components/tables/hooks/useGridTableRowDetail';
import type { RenderRowContentFn } from '@shared/components/tables/hooks/useGridTableRowRenderer';
import type React from 'react';
import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

interface HoverState {
  visible: boolean;
  selected: boolean;
  focused: boolean;
  top: number;
  height: number;
}

interface GridTableBodyProps<T> {
  wrapperRef: RefObject<HTMLDivElement | null>;
  gridRef: RefObject<HTMLTableElement | null>;
  tableRef: RefObject<HTMLTableSectionElement | null>;
  tableClassName: string;
  useShortNames: boolean;
  hoverState: HoverState;
  tableData: T[];
  keyExtractor: (item: T, index: number) => string;
  emptyMessage: string;
  filteredEmptyState?: GridTableFilteredEmptyState;
  shouldVirtualize: boolean;
  virtualRows: T[];
  virtualRangeStart: number;
  totalVirtualHeight: number;
  getRowTop: (index: number) => number;
  renderRowContent: RenderRowContentFn<T>;
  /** Index of the row whose detail is open, or null. */
  rowDetailIndex?: number | null;
  renderRowDetail?: RenderRowDetailFn<T>;
  onWrapperFocus: (event: React.FocusEvent<HTMLElement>) => void;
  onWrapperBlur: (event: React.FocusEvent<HTMLElement>) => void;
  onWrapperBackgroundClick: () => void;
  contentWidth: number;
  viewportWidth: number;
  /** Whether data is currently loading — drives aria-busy on the grid container. */
  loading: boolean;
  /** Whether any filter is actively narrowing results. */
  hasActiveFilters: boolean;
  /** Callback to clear all active filters. */
  onClearFilters: () => void;
}

const noRowDetail = () => null;

function GridTableEmptyRow({
  emptyMessage,
  filteredEmptyState,
  hasActiveFilters,
  onClearFilters,
}: Readonly<{
  emptyMessage: string;
  filteredEmptyState?: GridTableFilteredEmptyState;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}>) {
  const clearFilters = (event: React.MouseEvent) => {
    event.preventDefault();
    onClearFilters();
  };
  let filterGuidance: React.ReactNode = null;
  if (hasActiveFilters && filteredEmptyState) {
    filterGuidance = (
      <>
        <div className="gridtable-empty-filter-hint">{filteredEmptyState.description}</div>
        <div className="gridtable-empty-filter-actions">
          <button
            type="button"
            className="gridtable-empty-filter-hint__link"
            onClick={clearFilters}
          >
            {filteredEmptyState.clearFiltersLabel ?? 'Clear filters'}
          </button>
          {!!filteredEmptyState.secondaryAction && (
            <>
              <span aria-hidden="true">•</span>
              <button
                type="button"
                className="gridtable-empty-filter-hint__link"
                onClick={filteredEmptyState.secondaryAction.onClick}
              >
                {filteredEmptyState.secondaryAction.label}
              </button>
            </>
          )}
        </div>
      </>
    );
  } else if (hasActiveFilters) {
    filterGuidance = (
      <div className="gridtable-empty-filter-hint">
        Filters are enabled that may be hiding objects.{' '}
        <button type="button" className="gridtable-empty-filter-hint__link" onClick={clearFilters}>
          Clear filters
        </button>
      </div>
    );
  }
  return (
    <AriaGridRow>
      <AriaGridCell colSpan={1000}>
        <div className="gridtable-empty">
          {hasActiveFilters ? 'No matching items' : (emptyMessage ?? '')}
          {filterGuidance}
        </div>
      </AriaGridCell>
    </AriaGridRow>
  );
}

interface VirtualRowsInput<T> {
  tableData: T[];
  virtualRows: T[];
  virtualRangeStart: number;
  keyExtractor: (item: T, index: number) => string;
  getRowTop: (index: number) => number;
  renderRowContent: RenderRowContentFn<T>;
  rowDetailIndex: number | null;
  renderRowDetail: RenderRowDetailFn<T>;
}

function renderVirtualRows<T>({
  tableData,
  virtualRows,
  virtualRangeStart,
  keyExtractor,
  getRowTop,
  renderRowContent,
  rowDetailIndex,
  renderRowDetail,
}: VirtualRowsInput<T>): React.ReactNode[] {
  const renderRow = (item: T, index: number, slotId: string) => [
    renderRowContent(item, index, true, keyExtractor(item, index), slotId, getRowTop(index)),
    renderRowDetail(item, index, true),
  ];
  const rows = virtualRows.flatMap((item, idx) =>
    renderRow(item, virtualRangeStart + idx, `slot-${idx}`)
  );
  // The open row stays mounted outside the virtual window so its detail keeps its state.
  const openRowOutsideWindow =
    rowDetailIndex !== null &&
    (rowDetailIndex < virtualRangeStart ||
      rowDetailIndex >= virtualRangeStart + virtualRows.length);
  if (openRowOutsideWindow) {
    rows.push(...renderRow(tableData[rowDetailIndex], rowDetailIndex, 'open-row'));
  }
  return rows;
}

function GridTableBody<T>({
  wrapperRef,
  gridRef,
  tableRef,
  tableClassName,
  useShortNames,
  hoverState,
  tableData,
  keyExtractor,
  emptyMessage,
  filteredEmptyState,
  shouldVirtualize,
  virtualRows,
  virtualRangeStart,
  totalVirtualHeight,
  getRowTop,
  renderRowContent,
  rowDetailIndex = null,
  renderRowDetail = noRowDetail,
  onWrapperFocus,
  onWrapperBlur,
  onWrapperBackgroundClick,
  contentWidth,
  viewportWidth,
  loading,
  hasActiveFilters,
  onClearFilters,
}: Readonly<GridTableBodyProps<T>>) {
  const stretchDecisionRef = useRef<boolean | null>(null);

  if (!shouldVirtualize) {
    stretchDecisionRef.current = null;
  }

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    const isGridCellTarget = (target: EventTarget | null): target is HTMLElement =>
      target instanceof HTMLElement && Boolean(target.closest('.grid-cell'));

    const handleMouseDownCapture = (event: MouseEvent) => {
      if (event.button !== 2 || !isGridCellTarget(event.target)) {
        return;
      }
      window.getSelection()?.removeAllRanges();
      event.preventDefault();
    };

    const handleContextMenuCapture = (event: MouseEvent) => {
      if (!isGridCellTarget(event.target)) {
        return;
      }
      window.getSelection()?.removeAllRanges();
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.target !== wrapper) {
        return;
      }
      onWrapperBackgroundClick();
    };

    wrapper.addEventListener('mousedown', handleMouseDownCapture, true);
    wrapper.addEventListener('contextmenu', handleContextMenuCapture, true);
    wrapper.addEventListener('click', handleClick);

    return () => {
      wrapper.removeEventListener('mousedown', handleMouseDownCapture, true);
      wrapper.removeEventListener('contextmenu', handleContextMenuCapture, true);
      wrapper.removeEventListener('click', handleClick);
    };
  }, [onWrapperBackgroundClick, wrapperRef]);

  const virtualWidth = (() => {
    if (!shouldVirtualize || contentWidth <= 0) {
      stretchDecisionRef.current = false;
      return undefined;
    }
    const lastDecision = stretchDecisionRef.current;
    const nextDecision =
      lastDecision ?? (viewportWidth === 0 || contentWidth > viewportWidth + 0.5);
    if (nextDecision) {
      stretchDecisionRef.current = !(viewportWidth > 0 && contentWidth <= viewportWidth - 1);
    } else if (viewportWidth === 0 || contentWidth > viewportWidth + 1) {
      stretchDecisionRef.current = true;
    }
    return stretchDecisionRef.current ? `${contentWidth}px` : undefined;
  })();

  const renderRows = () => {
    if (tableData.length === 0) {
      return (
        <GridTableEmptyRow
          emptyMessage={emptyMessage}
          filteredEmptyState={filteredEmptyState}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={onClearFilters}
        />
      );
    }

    if (shouldVirtualize) {
      return renderVirtualRows({
        tableData,
        virtualRows,
        virtualRangeStart,
        keyExtractor,
        getRowTop,
        renderRowContent,
        rowDetailIndex,
        renderRowDetail,
      });
    }

    return tableData.flatMap((item, index) => [
      renderRowContent(item, index, false, keyExtractor(item, index)),
      renderRowDetail(item, index, false),
    ]);
  };

  return (
    <div ref={wrapperRef} className="gridtable-wrapper">
      <AriaGrid
        ref={gridRef}
        className={`gridtable gridtable--body ${tableClassName} ${useShortNames ? 'short-names' : ''}`}
        onFocus={onWrapperFocus}
        onBlur={onWrapperBlur}
        tabIndex={0}
        aria-busy={loading || undefined}
        aria-label="Data table"
      >
        <caption
          className={[
            'gridtable-hover-overlay',
            hoverState.visible ? 'is-visible' : '',
            hoverState.selected ? 'is-selected' : '',
            hoverState.focused ? 'is-focused' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{
            transform: `translateY(${hoverState.top}px)`,
            height: `${hoverState.height}px`,
          }}
        />

        <AriaGridRowGroup
          ref={tableRef}
          className={[
            shouldVirtualize ? 'gridtable-virtual-body' : '',
            tableData.length === 0 ? 'gridtable-empty-body' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={
            shouldVirtualize
              ? { height: `${totalVirtualHeight}px`, width: virtualWidth }
              : undefined
          }
        >
          {renderRows()}
        </AriaGridRowGroup>
      </AriaGrid>
    </div>
  );
}

export default GridTableBody;
