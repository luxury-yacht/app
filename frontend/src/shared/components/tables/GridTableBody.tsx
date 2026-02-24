/**
 * frontend/src/shared/components/tables/GridTableBody.tsx
 *
 * UI component for GridTableBody.
 * Handles rendering and interactions for the shared components.
 */

import React, { useRef } from 'react';
import type { RefObject } from 'react';
import type { RenderRowContentFn } from '@shared/components/tables/hooks/useGridTableRowRenderer';
import { getStableRowId } from '@shared/components/tables/GridTable.utils';
import GridTablePagination from '@shared/components/tables/GridTablePagination';

interface HoverState {
  visible: boolean;
  selected: boolean;
  focused: boolean;
  top: number;
  height: number;
}

interface GridTableBodyProps<T> {
  wrapperRef: RefObject<HTMLDivElement | null>;
  tableRef: RefObject<HTMLDivElement | null>;
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
  virtualOffset: number;
  renderRowContent: RenderRowContentFn<T>;
  rowControllerPoolRef: RefObject<Array<{ id: string }>>;
  firstVirtualRowRef: RefObject<HTMLDivElement | null>;
  paginationEnabled: boolean;
  paginationStatus: string;
  showPaginationStatus: boolean;
  showLoadMoreButton: boolean;
  loadMoreLabel: string;
  hasMore: boolean;
  isRequestingMore: boolean;
  onManualLoadMore: () => void;
  sentinelRef: RefObject<HTMLDivElement | null>;
  onWrapperFocus: (event: React.FocusEvent<HTMLDivElement>) => void;
  onWrapperBlur: (event: React.FocusEvent<HTMLDivElement>) => void;
  contentWidth: number;
  allowHorizontalOverflow: boolean;
  viewportWidth: number;
  /** Whether data is currently loading — drives aria-busy on the grid container. */
  loading: boolean;
  /** Key of the currently focused row — drives aria-activedescendant on the grid container. */
  focusedRowKey: string | null;
}

function GridTableBody<T>({
  wrapperRef,
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
  virtualOffset,
  renderRowContent,
  rowControllerPoolRef,
  firstVirtualRowRef,
  paginationEnabled,
  paginationStatus,
  showPaginationStatus,
  showLoadMoreButton,
  loadMoreLabel,
  hasMore,
  isRequestingMore,
  onManualLoadMore,
  sentinelRef,
  onWrapperFocus,
  onWrapperBlur,
  contentWidth,
  allowHorizontalOverflow,
  viewportWidth,
  loading,
  focusedRowKey,
}: GridTableBodyProps<T>) {
  const stretchDecisionRef = useRef<boolean | null>(null);

  if (!shouldVirtualize) {
    stretchDecisionRef.current = null;
  }

  const renderRows = () => {
    if (tableData.length === 0) {
      return <div className="gridtable-empty">{emptyMessage}</div>;
    }

    if (shouldVirtualize) {
      const controllers = rowControllerPoolRef.current;
      const targetSize = virtualRows.length;
      while (controllers.length < targetSize) {
        controllers.push({ id: `slot-${controllers.length}` });
      }

      firstVirtualRowRef.current = null;
      const shouldStretch = (() => {
        if (!allowHorizontalOverflow || contentWidth <= 0) {
          stretchDecisionRef.current = false;
          return false;
        }
        const lastDecision = stretchDecisionRef.current;
        const nextDecision =
          lastDecision ?? (viewportWidth === 0 || contentWidth > viewportWidth + 0.5);
        // Use a small hysteresis window so scrollbar jitter doesn't flip this every render.
        if (nextDecision) {
          if (viewportWidth > 0 && contentWidth <= viewportWidth - 1) {
            stretchDecisionRef.current = false;
          } else {
            stretchDecisionRef.current = true;
          }
        } else if (viewportWidth === 0 || contentWidth > viewportWidth + 1) {
          stretchDecisionRef.current = true;
        }
        return stretchDecisionRef.current ?? false;
      })();
      const resolvedWidth = shouldStretch ? `${contentWidth}px` : undefined;
      return (
        <div
          className="gridtable-virtual-body"
          style={{ height: `${totalVirtualHeight}px`, width: resolvedWidth }}
        >
          <div
            className="gridtable-virtual-inner"
            style={{
              transform: `translateY(${virtualOffset}px)`,
              width: resolvedWidth,
            }}
          >
            {virtualRows.map((item, idx) => {
              const controller = controllers[idx];
              const absoluteIndex = virtualRangeStart + idx;
              const rowKey = keyExtractor(item, absoluteIndex);
              return renderRowContent(item, absoluteIndex, idx === 0, rowKey, controller.id);
            })}
          </div>
        </div>
      );
    }

    return tableData.map((item, index) =>
      renderRowContent(item, index, false, keyExtractor(item, index))
    );
  };

  return (
    <div
      ref={wrapperRef}
      className="gridtable-wrapper"
      onContextMenu={onWrapperContextMenu}
      onFocus={onWrapperFocus}
      onBlur={onWrapperBlur}
      tabIndex={0}
      data-allow-shortcuts="true"
      role="grid"
      aria-busy={loading || undefined}
      aria-activedescendant={focusedRowKey ? getStableRowId(focusedRowKey) : undefined}
    >
      <div
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

      <div
        ref={tableRef}
        className={`gridtable gridtable--body ${tableClassName} ${useShortNames ? 'short-names' : ''}`}
        role="rowgroup"
      >
        {renderRows()}
        {paginationEnabled && (
          <GridTablePagination
            hasMore={hasMore}
            isRequestingMore={isRequestingMore}
            showLoadMoreButton={showLoadMoreButton}
            showPaginationStatus={showPaginationStatus}
            loadMoreLabel={loadMoreLabel}
            paginationStatus={paginationStatus}
            onManualLoadMore={onManualLoadMore}
            sentinelRef={sentinelRef}
          />
        )}
      </div>
    </div>
  );
}

export default GridTableBody;
