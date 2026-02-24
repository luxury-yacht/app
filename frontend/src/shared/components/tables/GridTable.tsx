/**
 * frontend/src/shared/components/tables/GridTable.tsx
 *
 * UI component for GridTable.
 * Handles rendering and interactions for the shared components.
 *
 * All hook orchestration lives in useGridTableController — this file is
 * a thin render shell.
 */

import React, { memo } from 'react';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import '@styles/components/gridtables.css';
import GridTableBody from '@shared/components/tables/GridTableBody';
import GridTableLayout from '@shared/components/tables/GridTableLayout';
import GridTableHeader from '@shared/components/tables/GridTableHeader';
import GridTableInitialLoading from '@shared/components/tables/GridTableInitialLoading';
import type { GridTableProps } from '@shared/components/tables/GridTable.types';
import { useGridTableController } from '@shared/components/tables/hooks/useGridTableController';

export { GRIDTABLE_VIRTUALIZATION_DEFAULT } from '@shared/components/tables/GridTable.types';
export type {
  GridColumnDefinition,
  GridTableFilterAccessors,
  GridTableFilterConfig,
  GridTableFilterOptions,
  GridTableFilterState,
  GridTableProps,
  GridTableVirtualizationOptions,
  InternalFilterOptions,
  ColumnWidthInput,
  ColumnWidthState,
} from '@shared/components/tables/GridTable.types';

const GridTable = memo(function GridTable<T>(props: GridTableProps<T>) {
  const {
    // Destructure render-only props that aren't passed to the controller
    embedded = false,
    className = '',
    tableClassName = '',
    loading = false,
    hideHeader = false,
    useShortNames = false,
    emptyMessage = 'No data available',
    hasMore = false,
    isRequestingMore = false,
    loadMoreLabel = 'Load more',
    showLoadMoreButton = true,
    showPaginationStatus = true,
    allowHorizontalOverflow = true,
    keyExtractor,
  } = props;

  const {
    wrapperRef,
    tableRef,
    headerInnerRef,
    tableData,
    filtersNode,
    focusedRowKey,
    handleWrapperFocus,
    handleWrapperBlur,
    hoverState,
    contextMenuNode,
    handleWrapperContextMenu,
    shouldVirtualize,
    virtualRows,
    virtualRange,
    totalVirtualHeight,
    virtualOffset,
    firstVirtualRowRef,
    scrollbarWidth,
    tableContentWidth,
    tableViewportWidth,
    renderRowContent,
    headerRow,
    paginationEnabled,
    resolvedPaginationStatus,
    loadMoreSentinelRef,
    handleManualLoadMore,
    showLoadingOverlay,
    loadingOverlayMessage,
    wrapWithProfiler,
  } = useGridTableController<T>(props);

  const headerNode = (
    <GridTableHeader
      headerInnerRef={headerInnerRef}
      tableClassName={tableClassName}
      useShortNames={useShortNames}
      scrollbarWidth={scrollbarWidth}
      headerRow={headerRow}
      hideHeader={hideHeader}
    />
  );

  const bodyNode = (
    <GridTableBody
      wrapperRef={wrapperRef}
      tableRef={tableRef}
      tableClassName={tableClassName}
      useShortNames={useShortNames}
      hoverState={hoverState}
      onWrapperContextMenu={handleWrapperContextMenu}
      tableData={tableData}
      keyExtractor={keyExtractor}
      emptyMessage={emptyMessage}
      shouldVirtualize={shouldVirtualize}
      virtualRows={virtualRows}
      virtualRangeStart={virtualRange.start}
      totalVirtualHeight={totalVirtualHeight}
      virtualOffset={virtualOffset}
      renderRowContent={renderRowContent}
      firstVirtualRowRef={firstVirtualRowRef}
      paginationEnabled={paginationEnabled}
      paginationStatus={resolvedPaginationStatus}
      showPaginationStatus={showPaginationStatus}
      showLoadMoreButton={showLoadMoreButton}
      loadMoreLabel={loadMoreLabel}
      hasMore={hasMore}
      isRequestingMore={isRequestingMore}
      onManualLoadMore={handleManualLoadMore}
      sentinelRef={loadMoreSentinelRef}
      onWrapperFocus={handleWrapperFocus}
      onWrapperBlur={handleWrapperBlur}
      contentWidth={tableContentWidth}
      allowHorizontalOverflow={allowHorizontalOverflow}
      viewportWidth={tableViewportWidth}
      loading={loading}
      focusedRowKey={focusedRowKey}
    />
  );

  const loadingOverlayNode = showLoadingOverlay ? (
    <div className="gridtable-loading-overlay" role="status" aria-live="polite">
      <LoadingSpinner message={loadingOverlayMessage} />
    </div>
  ) : null;

  if (loading && tableData.length === 0) {
    return wrapWithProfiler(
      <GridTableInitialLoading
        embedded={embedded}
        className={className}
        message="Loading resources..."
      />
    );
  }

  const mainContent = (
    <GridTableLayout
      embedded={embedded}
      className={className}
      loading={loading}
      loadingOverlay={loadingOverlayNode}
      filters={filtersNode}
      header={headerNode}
      body={bodyNode}
      contextMenu={contextMenuNode}
    />
  );

  return wrapWithProfiler(mainContent);
}) as <T>(props: GridTableProps<T>) => React.ReactElement;

export default GridTable;
