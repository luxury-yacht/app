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
  onWrapperContextMenu: (event: React.MouseEvent) => void;
  tableData: T[];
  keyExtractor: (item: T, index: number) => string;
  emptyMessage: string;
  shouldVirtualize: boolean;
  virtualRows: T[];
  virtualRangeStart: number;
  totalVirtualHeight: number;
  getRowTop: (index: number) => number;
  renderRowContent: RenderRowContentFn<T>;
  onWrapperFocus: (event: React.FocusEvent<HTMLElement>) => void;
  onWrapperBlur: (event: React.FocusEvent<HTMLElement>) => void;
  contentWidth: number;
  allowHorizontalOverflow: boolean;
  viewportWidth: number;
  /** Whether data is currently loading — drives aria-busy on the grid container. */
  loading: boolean;
  /** Whether any filter is actively narrowing results. */
  hasActiveFilters: boolean;
  /** Callback to clear all active filters. */
  onClearFilters: () => void;
}

function GridTableBody<T>({
  wrapperRef,
  gridRef,
  tableRef,
  tableClassName,
  useShortNames,
  hoverState,
  onWrapperContextMenu,
  tableData,
  keyExtractor,
  emptyMessage,
  shouldVirtualize,
  virtualRows,
  virtualRangeStart,
  totalVirtualHeight,
  getRowTop,
  renderRowContent,
  onWrapperFocus,
  onWrapperBlur,
  contentWidth,
  allowHorizontalOverflow,
  viewportWidth,
  loading,
  hasActiveFilters,
  onClearFilters,
}: GridTableBodyProps<T>) {
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

    wrapper.addEventListener('mousedown', handleMouseDownCapture, true);
    wrapper.addEventListener('contextmenu', handleContextMenuCapture, true);

    return () => {
      wrapper.removeEventListener('mousedown', handleMouseDownCapture, true);
      wrapper.removeEventListener('contextmenu', handleContextMenuCapture, true);
    };
  }, [wrapperRef]);

  const virtualWidth = (() => {
    if (!shouldVirtualize || !allowHorizontalOverflow || contentWidth <= 0) {
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
        <AriaGridRow>
          <AriaGridCell colSpan={1000}>
            <div className="gridtable-empty">
              {hasActiveFilters ? 'No matching items' : (emptyMessage ?? '')}
              {!!hasActiveFilters && (
                <div className="gridtable-empty-filter-hint">
                  Filters are enabled that may be hiding objects.{' '}
                  <button
                    type="button"
                    className="gridtable-empty-filter-hint__link"
                    onClick={(e) => {
                      e.preventDefault();
                      onClearFilters();
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>
          </AriaGridCell>
        </AriaGridRow>
      );
    }

    if (shouldVirtualize) {
      return virtualRows.map((item, idx) => {
        const absoluteIndex = virtualRangeStart + idx;
        const rowKey = keyExtractor(item, absoluteIndex);
        return renderRowContent(
          item,
          absoluteIndex,
          true,
          rowKey,
          `slot-${idx}`,
          getRowTop(absoluteIndex)
        );
      });
    }

    return tableData.map((item, index) =>
      renderRowContent(item, index, false, keyExtractor(item, index))
    );
  };

  return (
    <div ref={wrapperRef} className="gridtable-wrapper">
      <AriaGrid
        ref={gridRef}
        className={`gridtable gridtable--body ${tableClassName} ${useShortNames ? 'short-names' : ''}`}
        onContextMenu={onWrapperContextMenu}
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
