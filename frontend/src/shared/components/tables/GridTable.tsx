/**
 * frontend/src/shared/components/tables/GridTable.tsx
 *
 * UI component for GridTable.
 * Handles rendering and interactions for the shared components.
 */

import React, { useCallback, memo, useRef, useEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import '@styles/components/gridtables.css';
import { useGridTableHoverSync } from '@shared/components/tables/hooks/useGridTableHoverSync';
import { useGridTableColumnVirtualization } from '@shared/components/tables/hooks/useGridTableColumnVirtualization';
import { useGridTableVirtualization } from '@shared/components/tables/hooks/useGridTableVirtualization';
import { useGridTableRowRenderer } from '@shared/components/tables/hooks/useGridTableRowRenderer';
import { useGridTableHeaderRow } from '@shared/components/tables/hooks/useGridTableHeaderRow';
import { useColumnResizeController } from '@shared/components/tables/hooks/useColumnResizeController';
import { useContainerWidthObserver } from '@shared/components/tables/hooks/useContainerWidthObserver';
import { useColumnVisibilityController } from '@shared/components/tables/hooks/useColumnVisibilityController';
import { useGridTableProfiler } from '@shared/components/tables/hooks/useGridTableProfiler';
import { useGridTableColumnMeasurer } from '@shared/components/tables/hooks/useGridTableColumnMeasurer';
import { useGridTableCellCache } from '@shared/components/tables/hooks/useGridTableCellCache';
import { useGridTableColumnWidths } from '@shared/components/tables/hooks/useGridTableColumnWidths';
import { useGridTablePagination } from '@shared/components/tables/hooks/useGridTablePagination';
import { useGridTableHoverFallback } from '@shared/components/tables/hooks/useGridTableHoverFallback';
import { useGridTableHeaderSyncEffects } from '@shared/components/tables/hooks/useGridTableHeaderSyncEffects';
import { useGridTableAutoGrow } from '@shared/components/tables/hooks/useGridTableAutoGrow';
import { useGridTableExternalWidths } from '@shared/components/tables/hooks/useGridTableExternalWidths';
import { useGridTableFiltersWiring } from '@shared/components/tables/hooks/useGridTableFiltersWiring';
import { useGridTableColumnsDropdown } from '@shared/components/tables/hooks/useGridTableColumnsDropdown';
import { useGridTableContextMenuWiring } from '@shared/components/tables/hooks/useGridTableContextMenuWiring';
import { useGridTableFocusNavigation } from '@shared/components/tables/hooks/useGridTableFocusNavigation';
import { useGridTableShortcuts } from '@shared/components/tables/hooks/useGridTableShortcuts';
import GridTableBody from '@shared/components/tables/GridTableBody';
import GridTableLayout from '@shared/components/tables/GridTableLayout';
import GridTableHeader from '@shared/components/tables/GridTableHeader';
import GridTableInitialLoading from '@shared/components/tables/GridTableInitialLoading';
import { useKeyboardContext } from '@ui/shortcuts';
import { useGridTableKeyboardScopes } from '@shared/components/tables/GridTableKeys';
import {
  type GridColumnDefinition,
  type GridTableProps,
} from '@shared/components/tables/GridTable.types';
import {
  DEFAULT_COLUMN_MIN_WIDTH,
  DEFAULT_COLUMN_WIDTH,
  getTextContent,
  isFixedColumnKey,
  isKindColumnKey,
  normalizeKindClass,
  parseWidthInputToNumber,
} from '@shared/components/tables/GridTable.utils';

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

const GRIDTABLE_SHORTCUT_OPT_OUT_SELECTOR = '[data-gridtable-shortcut-optout="true"]';
const GRIDTABLE_ROWCLICK_SUPPRESS_SELECTOR = '[data-gridtable-rowclick="suppress"]';
const GRIDTABLE_ROWCLICK_ALLOW_SELECTOR = '[data-gridtable-rowclick="allow"]';
const GRIDTABLE_INTERACTIVE_STOP_SELECTOR =
  'button, a[href], input, textarea, select, summary, [role="button"], [role="menuitem"], [data-gridtable-interactive="true"]';

const getColumnMinWidth = <T,>(column: GridColumnDefinition<T>) => {
  const parsed = parseWidthInputToNumber(column.minWidth);
  if (parsed != null) {
    return parsed;
  }
  return DEFAULT_COLUMN_MIN_WIDTH;
};

const getColumnMaxWidth = <T,>(column: GridColumnDefinition<T>) => {
  const parsed = parseWidthInputToNumber(column.maxWidth);
  if (parsed != null) {
    return parsed;
  }
  return Number.POSITIVE_INFINITY;
};

// Stable default to avoid re-creating lock lists on every render.
const DEFAULT_NON_HIDEABLE_COLUMNS: string[] = [];

// Shallow compare width maps so we can skip no-op reconciliations.
const areWidthMapsEqual = (a: Record<string, number>, b: Record<string, number>): boolean => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
};

const GridTable = memo(function GridTable<T>({
  data: inputData,
  columns,
  keyExtractor,
  getRowClassName,
  getRowStyle,
  onRowClick,
  onSort,
  sortConfig,
  embedded = false,
  className = '',
  tableClassName = '',
  loading = false,
  hideHeader = false,
  enableContextMenu = false,
  getCustomContextMenuItems,
  useShortNames = false,
  initialColumnWidths,
  columnWidths: controlledColumnWidths = null,
  onColumnWidthsChange,
  enableColumnResizing = true,
  columnVisibility = null,
  onColumnVisibilityChange,
  nonHideableColumns = DEFAULT_NON_HIDEABLE_COLUMNS,
  enableColumnVisibilityMenu = true,
  emptyMessage = 'No data available',
  hasMore = false,
  onRequestMore,
  isRequestingMore = false,
  autoLoadMore = true,
  loadMoreLabel = 'Load more',
  showLoadMoreButton = true,
  showPaginationStatus = true,
  virtualization,
  loadingOverlay,
  filters,
  allowHorizontalOverflow = true,
}: GridTableProps<T>) {
  const sourceData = useMemo<T[]>(
    () => (Array.isArray(inputData) ? inputData : ([] as T[])),
    [inputData]
  );
  const { pushContext: pushShortcutContext, popContext: popShortcutContext } = useKeyboardContext();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const tableRefMutable = tableRef as RefObject<HTMLElement | null>;
  const headerInnerRef = useRef<HTMLDivElement | null>(null);
  const paginationEnabled = Boolean(onRequestMore);
  const contextMenuActiveRef = useRef(false);
  const [tableViewportWidth, setTableViewportWidth] = useState(0);
  const isShortcutOptOutTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return Boolean(target.closest(GRIDTABLE_SHORTCUT_OPT_OUT_SELECTOR));
  }, []);

  const shouldIgnoreRowClick = useCallback((event: React.MouseEvent) => {
    if (event.defaultPrevented || event.isDefaultPrevented?.() || event.isPropagationStopped?.()) {
      return true;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const isOptInTarget = Boolean(target.closest(GRIDTABLE_ROWCLICK_ALLOW_SELECTOR));
    if (!isOptInTarget && target.closest(GRIDTABLE_ROWCLICK_SUPPRESS_SELECTOR)) {
      return true;
    }
    if (!isOptInTarget && target.closest(GRIDTABLE_INTERACTIVE_STOP_SELECTOR)) {
      return true;
    }
    return false;
  }, []);
  const externalColumnWidths = useGridTableExternalWidths(controlledColumnWidths);

  const { wrapWithProfiler, warnDevOnce, startFrameSampler, stopFrameSampler } =
    useGridTableProfiler({
      sampleLabel: 'GridTable scroll',
      sampleWindowMs: 2000,
      minSampleCount: 10,
    });

  const { renderedColumns, isColumnVisible, applyVisibilityChanges, lockedColumns } =
    useColumnVisibilityController<T>({
      columns,
      columnVisibility,
      nonHideableColumns,
      onColumnVisibilityChange,
    });

  const columnsDropdownConfig = useGridTableColumnsDropdown({
    columns,
    lockedColumns,
    isColumnVisible,
    applyVisibilityChanges,
    enableColumnVisibilityMenu,
  });

  const {
    filteringEnabled,
    tableData,
    filterSignature,
    filtersContainerRef,
    filterFocusIndexRef,
    showKindDropdown,
    showNamespaceDropdown,
    filtersNode,
  } = useGridTableFiltersWiring<T>({
    data: sourceData,
    filters,
    columnsDropdown: columnsDropdownConfig ?? undefined,
  });

  const loadingOverlayMessage = loadingOverlay?.message ?? 'Refreshing...';
  const showLoadingOverlay = loadingOverlay ? loadingOverlay.show : loading && tableData.length > 0;

  // References to the table and scroll wrapper
  const {
    hoverState,
    hoverRowRef,
    updateHoverForElement,
    handleRowMouseEnter,
    handleRowMouseLeave,
    scheduleHeaderSync,
  } = useGridTableHoverSync({
    wrapperRef,
    headerInnerRef,
    hideHeader,
  });

  const {
    focusedRowIndex,
    focusedRowKey,
    setFocusedRowIndex,
    isWrapperFocused,
    shortcutsActive,
    lastNavigationMethodRef,
    handleWrapperFocus,
    handleWrapperBlur,
    handleRowActivation,
    handleRowClick,
    getRowClassNameWithFocus,
    clampRowIndex,
  } = useGridTableFocusNavigation<T>({
    tableData,
    keyExtractor,
    onRowClick,
    isShortcutOptOutTarget,
    wrapperRef,
    updateHoverForElement,
    getRowClassName,
    shouldIgnoreRowClick,
  });

  const {
    contextMenuNode,
    handleCellContextMenu,
    handleWrapperContextMenu,
    openFocusedRowContextMenu,
    isContextMenuVisible,
  } = useGridTableContextMenuWiring<T>({
    enableContextMenu,
    columns,
    tableData,
    sortConfig,
    getCustomContextMenuItems,
    onSort,
    keyExtractor,
    focusedRowIndex,
    focusedRowKey,
    wrapperRef,
    handleRowActivation,
    contextMenuActiveRef,
  });

  const handleRowMouseEnterWithReset = useCallback(
    (element: HTMLDivElement) => {
      // Only reset keyboard focus when transitioning to mouse while table is focused.
      // When unfocused, preserve the selection.
      if (isWrapperFocused && !shortcutsActive && !contextMenuActiveRef.current) {
        setFocusedRowIndex(null);
      }
      handleRowMouseEnter(element);
    },
    [
      contextMenuActiveRef,
      handleRowMouseEnter,
      isWrapperFocused,
      shortcutsActive,
      setFocusedRowIndex,
    ]
  );

  const handleRowMouseLeaveWithReset = useCallback(
    (element?: HTMLDivElement | null) => {
      if (contextMenuActiveRef.current) {
        return;
      }
      handleRowMouseLeave(element);
    },
    [contextMenuActiveRef, handleRowMouseLeave]
  );

  const getPageSizeRef = useRef(1);

  const moveSelectionByDelta = useCallback(
    (delta: number) => {
      if (tableData.length === 0) {
        return false;
      }
      lastNavigationMethodRef.current = 'keyboard';
      setFocusedRowIndex((prev) => {
        const base = prev == null ? (delta > 0 ? -1 : tableData.length) : prev;
        const next = clampRowIndex(base + delta);
        return next;
      });
      return true;
    },
    [clampRowIndex, tableData.length, lastNavigationMethodRef, setFocusedRowIndex]
  );

  const jumpToIndex = useCallback(
    (index: number) => {
      if (tableData.length === 0) {
        return false;
      }
      const next = clampRowIndex(index);
      if (next === -1) {
        return false;
      }
      lastNavigationMethodRef.current = 'keyboard';
      setFocusedRowIndex(next);
      return true;
    },
    [clampRowIndex, tableData.length, lastNavigationMethodRef, setFocusedRowIndex]
  );

  useGridTableKeyboardScopes({
    filteringEnabled,
    showKindDropdown,
    showNamespaceDropdown,
    filtersContainerRef,
    filterFocusIndexRef,
    wrapperRef,
    tableDataLength: tableData.length,
    focusedRowIndex,
    jumpToIndex,
  });

  const activateFocusedRow = useCallback(() => {
    if (focusedRowIndex == null || focusedRowIndex < 0 || focusedRowIndex >= tableData.length) {
      return false;
    }
    const item = tableData[focusedRowIndex];
    onRowClick?.(item);
    return true;
  }, [focusedRowIndex, onRowClick, tableData]);

  useGridTableShortcuts({
    shortcutsActive,
    enableContextMenu,
    onOpenFocusedRow: activateFocusedRow,
    onOpenContextMenu: openFocusedRowContextMenu,
    moveSelectionByDelta,
    jumpToIndex,
    getPageSizeRef,
    tableDataLength: tableData.length,
    pushShortcutContext: (opts) => pushShortcutContext(opts),
    popShortcutContext,
    isContextMenuVisible,
  });

  const { measureColumnWidth } = useGridTableColumnMeasurer<T>({
    tableRef: tableRefMutable,
    tableData,
    parseWidthInputToNumber,
    defaultColumnWidth: DEFAULT_COLUMN_WIDTH,
    isKindColumnKey,
    getTextContent,
    normalizeKindClass,
    getColumnMinWidth,
    getColumnMaxWidth,
  });

  const {
    columnWidths,
    setColumnWidths,
    manuallyResizedColumnsRef,
    reconcileWidthsToContainer,
    updateNaturalWidth,
    isInitialized: columnWidthsInitialized,
    markColumnsDirty,
    markAllAutoColumnsDirty,
    handleManualResizeEvent,
  } = useGridTableColumnWidths<T>({
    columns,
    renderedColumns,
    tableRef: tableRefMutable,
    tableData,
    initialColumnWidths,
    controlledColumnWidths,
    externalColumnWidths,
    enableColumnResizing,
    onColumnWidthsChange,
    useShortNames,
    measureColumnWidth,
    allowHorizontalOverflow,
  });

  const {
    columnVirtualizationConfig,
    columnRenderModelsWithOffsets,
    columnWindowRange,
    updateColumnWindowRange,
  } = useGridTableColumnVirtualization({
    renderedColumns,
    columnWidths,
    virtualization,
    wrapperRef,
  });

  const tableContentWidth = useMemo(() => {
    if (columnRenderModelsWithOffsets.length === 0) {
      return 0;
    }
    const lastModel = columnRenderModelsWithOffsets[columnRenderModelsWithOffsets.length - 1];
    return Number.isFinite(lastModel.end) ? lastModel.end : 0;
  }, [columnRenderModelsWithOffsets]);

  const { getCachedCellContent } = useGridTableCellCache<T>({
    renderedColumns,
    isKindColumnKey,
    getTextContent,
    normalizeKindClass,
    data: tableData,
  });

  const rowControllerPoolRef = useRef<Array<{ id: string }>>([]);

  useEffect(() => {
    markAllAutoColumnsDirty();
  }, [markAllAutoColumnsDirty, columnVirtualizationConfig.enabled, allowHorizontalOverflow]);

  useGridTableHoverFallback({
    hoverStateVisible: hoverState.visible,
    wrapperRef,
    updateHoverForElement,
    tableLength: tableData.length,
  });

  const {
    shouldVirtualize,
    virtualRows,
    virtualRange,
    virtualRowHeight,
    totalVirtualHeight,
    virtualOffset,
    firstVirtualRowRef,
    scrollbarWidth,
  } = useGridTableVirtualization({
    data: tableData,
    virtualization,
    wrapperRef,
    warnDevOnce,
    keyExtractor,
    filterSignature,
    filteringEnabled,
    scheduleHeaderSync,
    updateHoverForElement,
    hoverRowRef,
    startFrameSampler,
    stopFrameSampler,
    updateColumnWindowRange,
    hideHeader,
  });

  const visibleAutoColumnKeys = useMemo(() => {
    if (renderedColumns.length === 0) {
      return [];
    }
    if (!columnVirtualizationConfig.enabled) {
      return renderedColumns.filter((column) => column.autoWidth).map((column) => column.key);
    }
    const total = columnRenderModelsWithOffsets.length;
    if (total === 0) {
      return [];
    }
    const stickyStart = Math.min(columnVirtualizationConfig.stickyStart, total);
    const stickyEnd = Math.min(
      columnVirtualizationConfig.stickyEnd,
      Math.max(0, total - stickyStart)
    );
    const visibleKeys = new Set<string>();
    columnRenderModelsWithOffsets.forEach((model, index) => {
      const column = renderedColumns[index];
      if (!column?.autoWidth) {
        return;
      }
      const isSticky = index < stickyStart || index >= total - stickyEnd;
      if (
        isSticky ||
        (index >= columnWindowRange.startIndex && index <= columnWindowRange.endIndex)
      ) {
        visibleKeys.add(model.key);
      }
    });
    return Array.from(visibleKeys);
  }, [
    columnRenderModelsWithOffsets,
    columnVirtualizationConfig.enabled,
    columnVirtualizationConfig.stickyEnd,
    columnVirtualizationConfig.stickyStart,
    columnWindowRange.endIndex,
    columnWindowRange.startIndex,
    renderedColumns,
  ]);

  useEffect(() => {
    if (visibleAutoColumnKeys.length === 0) {
      return;
    }
    markColumnsDirty(visibleAutoColumnKeys);
  }, [markColumnsDirty, visibleAutoColumnKeys, virtualRange.end, virtualRange.start]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      getPageSizeRef.current = 1;
      return;
    }

    const computePageSize = () => {
      const height = wrapper.clientHeight || 1;
      if (height <= 0) {
        getPageSizeRef.current = 1;
        return;
      }

      if (shouldVirtualize && virtualRowHeight > 0) {
        getPageSizeRef.current = Math.max(1, Math.round(height / virtualRowHeight));
        return;
      }

      const firstRow = wrapper.querySelector<HTMLElement>('.gridtable-row');
      const rowHeight = firstRow?.getBoundingClientRect().height || 44;
      getPageSizeRef.current = Math.max(1, Math.round(height / Math.max(rowHeight, 1)));
    };

    computePageSize();

    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(computePageSize) : null;
    if (observer) {
      observer.observe(wrapper);
    }

    return () => {
      observer?.disconnect();
    };
  }, [shouldVirtualize, virtualRowHeight, wrapperRef, tableData.length]);

  useEffect(() => {
    if (!shortcutsActive || !focusedRowKey) {
      return;
    }
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const allowAutoScroll = lastNavigationMethodRef.current === 'keyboard';
    const escapedKey =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(focusedRowKey)
        : focusedRowKey;
    // Both data-row-key and .gridtable-row are on the same element, so use
    // a compound selector (not a descendant selector).
    const rowElement = wrapper.querySelector<HTMLDivElement>(
      `.gridtable-row[data-row-key="${escapedKey}"]`
    );
    if (rowElement) {
      if (allowAutoScroll && typeof rowElement.scrollIntoView === 'function') {
        rowElement.scrollIntoView({ block: 'nearest' });
      }
      updateHoverForElement(rowElement);
      return;
    }
    if (
      allowAutoScroll &&
      shouldVirtualize &&
      virtualRowHeight > 0 &&
      focusedRowIndex != null &&
      focusedRowIndex >= 0
    ) {
      // Mimic scrollIntoView({ block: 'nearest' }) - only scroll if row is outside visible area
      const rowTop = focusedRowIndex * virtualRowHeight;
      const rowBottom = rowTop + virtualRowHeight;
      const viewportTop = wrapper.scrollTop;
      const viewportBottom = viewportTop + wrapper.clientHeight;

      if (rowTop < viewportTop) {
        // Row is above viewport - scroll up to show it at top
        wrapper.scrollTo({ top: rowTop, behavior: 'auto' });
      } else if (rowBottom > viewportBottom) {
        // Row is below viewport - scroll down to show it at bottom
        wrapper.scrollTo({ top: rowBottom - wrapper.clientHeight, behavior: 'auto' });
      }
      // If row is already visible, don't scroll
    }
  }, [
    focusedRowIndex,
    focusedRowKey,
    shortcutsActive,
    shouldVirtualize,
    updateHoverForElement,
    virtualRowHeight,
    wrapperRef,
    lastNavigationMethodRef,
  ]);

  useGridTableHeaderSyncEffects({
    hideHeader,
    wrapperRef,
    scheduleHeaderSync,
    updateHoverForElement,
    hoverRowRef,
    updateColumnWindowRange,
    virtualizationHandlesScroll: shouldVirtualize,
  });

  useGridTableAutoGrow({
    tableRef,
    tableDataLength: tableData.length,
    renderedColumns,
    isKindColumnKey,
    externalColumnWidths,
    measureColumnWidth,
    setColumnWidths,
    reconcileWidthsToContainer: (base, width) => reconcileWidthsToContainer(base, width),
    updateNaturalWidth,
  });

  const recalculateForContainerWidth = useCallback(
    (incomingWidth: number) => {
      if (!incomingWidth || incomingWidth <= 0) {
        return;
      }
      setTableViewportWidth((prev) =>
        Math.abs(prev - incomingWidth) < 0.5 ? prev : incomingWidth
      );
      setColumnWidths((prev) => {
        if (allowHorizontalOverflow && !columnWidthsInitialized) {
          return prev;
        }
        const next = reconcileWidthsToContainer(prev, incomingWidth);
        // Avoid state updates when reconciled widths match the current map.
        return areWidthMapsEqual(prev, next) ? prev : next;
      });
    },
    [
      allowHorizontalOverflow,
      columnWidthsInitialized,
      reconcileWidthsToContainer,
      setColumnWidths,
      setTableViewportWidth,
    ]
  );

  useContainerWidthObserver({
    tableRef: tableRefMutable,
    onContainerWidth: recalculateForContainerWidth,
    tableDataLength: tableData.length,
  });

  const { handleResizeStart, autoSizeColumn, resetManualResizes } = useColumnResizeController<T>({
    columns,
    renderedColumns,
    columnWidths,
    setColumnWidths,
    manuallyResizedColumnsRef,
    getColumnMinWidth,
    getColumnMaxWidth,
    measureColumnWidth,
    enableColumnResizing,
    isFixedColumnKey,
    onManualResize: handleManualResizeEvent,
  });

  useEffect(() => {
    if (!enableColumnResizing) {
      resetManualResizes();
    }
  }, [enableColumnResizing, resetManualResizes]);

  // Render sort indicator
  const renderSortIndicator = useCallback((columnKey: string) => {
    if (!sortConfig || sortConfig.key !== columnKey) {
      return null;
    }
    return (
      <span className="sort-indicator">
        {sortConfig.direction === 'asc' ? '↑' : sortConfig.direction === 'desc' ? '↓' : ''}
      </span>
    );
  }, [sortConfig]);

  // Handle header click for sorting
  const handleHeaderClick = useCallback((column: GridColumnDefinition<T>) => {
    if (column.sortable && onSort) {
      onSort(column.key);
    }
  }, [onSort]);

  const renderRowContent = useGridTableRowRenderer({
    keyExtractor,
    getRowClassName: getRowClassNameWithFocus,
    getRowStyle,
    handleRowClick,
    handleRowMouseEnter: handleRowMouseEnterWithReset,
    handleRowMouseLeave: handleRowMouseLeaveWithReset,
    columnRenderModelsWithOffsets,
    columnVirtualizationConfig,
    columnWindowRange,
    handleContextMenu: handleCellContextMenu,
    getCachedCellContent,
    firstVirtualRowRef,
  });

  const { loadMoreSentinelRef, handleManualLoadMore, paginationStatus } = useGridTablePagination({
    paginationEnabled,
    autoLoadMore,
    hasMore,
    isRequestingMore,
    onRequestMore,
    tableDataLength: tableData.length,
    tableRef: tableRefMutable,
  });

  const resolvedPaginationStatus = useMemo(() => {
    if (!showPaginationStatus) {
      return '';
    }
    return paginationStatus;
  }, [paginationStatus, showPaginationStatus]);

  const headerRow = useGridTableHeaderRow({
    renderedColumns,
    enableColumnResizing,
    isFixedColumnKey,
    columnWidths,
    handleHeaderClick,
    renderSortIndicator,
    handleResizeStart,
    autoSizeColumn,
  });

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
      rowControllerPoolRef={rowControllerPoolRef}
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
    />
  );

  const loadingOverlayNode = showLoadingOverlay ? (
    <div className="gridtable-loading-overlay">
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
