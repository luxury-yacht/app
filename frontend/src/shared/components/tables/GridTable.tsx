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
import GridTablePagination from '@shared/components/tables/GridTablePagination';
import type { GridTableProps } from '@shared/components/tables/GridTable.types';
import { useGridTableController } from '@shared/components/tables/hooks/useGridTableController';

export { GRIDTABLE_VIRTUALIZATION_DEFAULT } from '@shared/components/tables/GridTable.types';
export type {
  GridColumnDefinition,
  GridTableFilterAccessors,
  GridTableFilterConfig,
  GridTableFilterOptions,
  GridTableFilterState,
  GridTableDiagnosticsMode,
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
    hasPrevious = false,
    isRequestingMore = false,
    loadMoreLabel = 'Load more',
    previousPageLabel = 'Previous page',
    showLoadMoreButton = true,
    showPaginationStatus = true,
    paginationControls,
    allowHorizontalOverflow = true,
    showTrailingColumnBoundary = true,
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
    headerContextMenuNode,
    handleWrapperContextMenu,
    shouldVirtualize,
    virtualRows,
    virtualRange,
    totalVirtualHeight,
    virtualOffset,
    scrollbarWidth,
    tableContentWidth,
    tableViewportWidth,
    renderRowContent,
    headerRow,
    paginationEnabled,
    resolvedPaginationStatus,
    loadMoreSentinelRef,
    handleManualLoadMore,
    handleManualLoadPrevious,
    showLoadingOverlay,
    loadingOverlayMessage,
    hasActiveFilters,
    onClearFilters,
    wrapWithProfiler,
  } = useGridTableController<T>(props);

  const trailingBoundaryOffset =
    showTrailingColumnBoundary &&
    tableContentWidth > 0 &&
    tableViewportWidth > 0 &&
    tableContentWidth < tableViewportWidth - 0.5
      ? tableContentWidth
      : null;

  const headerNode = (
    <GridTableHeader
      headerInnerRef={headerInnerRef}
      tableClassName={tableClassName}
      useShortNames={useShortNames}
      scrollbarWidth={scrollbarWidth}
      headerRow={headerRow}
      hideHeader={hideHeader}
      trailingBoundaryOffset={trailingBoundaryOffset}
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
      paginationEnabled={paginationEnabled}
      hasMore={hasMore}
      sentinelRef={loadMoreSentinelRef}
      onWrapperFocus={handleWrapperFocus}
      onWrapperBlur={handleWrapperBlur}
      contentWidth={tableContentWidth}
      allowHorizontalOverflow={allowHorizontalOverflow}
      viewportWidth={tableViewportWidth}
      loading={loading}
      focusedRowKey={focusedRowKey}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
    />
  );

  const footerNode = paginationEnabled ? (
    <GridTablePagination
      hasMore={hasMore}
      hasPrevious={hasPrevious}
      isRequestingMore={isRequestingMore}
      showLoadMoreButton={showLoadMoreButton}
      showPaginationStatus={showPaginationStatus}
      paginationControls={paginationControls}
      loadMoreLabel={loadMoreLabel}
      previousPageLabel={previousPageLabel}
      paginationStatus={resolvedPaginationStatus}
      onManualLoadMore={handleManualLoadMore}
      onManualLoadPrevious={handleManualLoadPrevious}
    />
  ) : null;

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
      footer={footerNode}
      contextMenu={
        <>
          {contextMenuNode}
          {headerContextMenuNode}
        </>
      }
    />
  );

  return wrapWithProfiler(mainContent);
}) as <T>(props: GridTableProps<T>) => React.ReactElement;

export default GridTable;
