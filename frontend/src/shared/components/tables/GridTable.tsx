/**
 * frontend/src/shared/components/tables/GridTable.tsx
 *
 * UI component for GridTable.
 * Handles rendering and interactions for the shared components.
 *
 * All hook orchestration lives in useGridTableController — this file is
 * a thin render shell.
 */

import LoadingSpinner from '@shared/components/LoadingSpinner';
import type React from 'react';
import { memo } from 'react';
import '@styles/components/gridtables.css';
import type { GridTableProps } from '@shared/components/tables/GridTable.types';
import GridTableBody from '@shared/components/tables/GridTableBody';
import GridTableHeader from '@shared/components/tables/GridTableHeader';
import GridTableInitialLoading from '@shared/components/tables/GridTableInitialLoading';
import GridTableLayout from '@shared/components/tables/GridTableLayout';
import { useGridTableController } from '@shared/components/tables/hooks/useGridTableController';

export type {
  ColumnWidthInput,
  ColumnWidthState,
  GridColumnDefinition,
  GridTableDiagnosticsMode,
  GridTableFilterAccessors,
  GridTableFilterConfig,
  GridTableFilterOptions,
  GridTableFilterState,
  GridTableProps,
  GridTableVirtualizationOptions,
  InternalFilterOptions,
} from '@shared/components/tables/GridTable.types';
export { GRIDTABLE_VIRTUALIZATION_DEFAULT } from '@shared/components/tables/GridTable.types';

const GridTable = memo(function GridTableComponent<T>(props: GridTableProps<T>) {
  const {
    // Destructure render-only props that aren't passed to the controller
    embedded = false,
    className = '',
    tableClassName = '',
    loading = false,
    hideHeader = false,
    useShortNames = false,
    emptyMessage = 'No data available',
    paginationControls,
    allowHorizontalOverflow = true,
    showTrailingColumnBoundary = true,
    keyExtractor,
  } = props;

  const {
    wrapperRef,
    gridRef,
    tableRef,
    headerInnerRef,
    tableData,
    filtersNode,
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
    getRowTop,
    scrollbarWidth,
    tableContentWidth,
    tableViewportWidth,
    renderRowContent,
    headerRow,
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
      gridRef={gridRef}
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
      getRowTop={getRowTop}
      renderRowContent={renderRowContent}
      onWrapperFocus={handleWrapperFocus}
      onWrapperBlur={handleWrapperBlur}
      contentWidth={tableContentWidth}
      allowHorizontalOverflow={allowHorizontalOverflow}
      viewportWidth={tableViewportWidth}
      loading={loading}
      hasActiveFilters={hasActiveFilters}
      onClearFilters={onClearFilters}
    />
  );

  const footerNode = paginationControls ? (
    <div className="gridtable-pagination">{paginationControls}</div>
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
