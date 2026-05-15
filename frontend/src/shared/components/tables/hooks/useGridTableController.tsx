/**
 * frontend/src/shared/components/tables/hooks/useGridTableController.tsx
 *
 * Orchestration hook for GridTable. Wires together all sub-hooks (filters,
 * hover, focus, context menu, shortcuts, column widths, virtualization,
 * pagination, row rendering, header row, etc.) and returns the minimal set
 * of values the render section needs.
 *
 * Extracted from GridTable.tsx — no behavioral change, purely mechanical.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode, RefObject } from 'react';
import { eventBus } from '@/core/events';
import { getMaxTableRows } from '@/core/settings/appPreferences';
import {
  recordGridTablePerformanceSample,
  recordGridTablePerformanceSnapshot,
  recordGridTableScrollFrameSample,
} from '@shared/components/tables/performance/gridTablePerformanceStore';
import type { HoverState } from '@shared/components/tables/hooks/useGridTableHoverSync';
import { useGridTableVirtualization } from '@shared/components/tables/hooks/useGridTableVirtualization';
import { useGridTableRowRenderer } from '@shared/components/tables/hooks/useGridTableRowRenderer';
import type { RenderRowContentFn } from '@shared/components/tables/hooks/useGridTableRowRenderer';
import { useGridTableHeaderRow } from '@shared/components/tables/hooks/useGridTableHeaderRow';
import { useColumnVisibilityController } from '@shared/components/tables/hooks/useColumnVisibilityController';
import { useGridTableProfiler } from '@shared/components/tables/hooks/useGridTableProfiler';
import { useGridTableCellCache } from '@shared/components/tables/hooks/useGridTableCellCache';
import { useGridTablePagination } from '@shared/components/tables/hooks/useGridTablePagination';
import { useGridTableHeaderSyncEffects } from '@shared/components/tables/hooks/useGridTableHeaderSyncEffects';
import { useGridTableExternalWidths } from '@shared/components/tables/hooks/useGridTableExternalWidths';
import { useGridTableFiltersWiring } from '@shared/components/tables/hooks/useGridTableFiltersWiring';
import { useGridTableColumnsDropdown } from '@shared/components/tables/hooks/useGridTableColumnsDropdown';
import { useGridTableShortcuts } from '@shared/components/tables/hooks/useGridTableShortcuts';
import { useGridTableKeyboardNavigation } from '@shared/components/tables/hooks/useGridTableKeyboardNavigation';
import { useGridTableColumnLayout } from '@shared/components/tables/hooks/useGridTableColumnLayout';
import { useGridTableInteractionWiring } from '@shared/components/tables/hooks/useGridTableInteractionWiring';
import { useGridTableHeaderActions } from '@shared/components/tables/hooks/useGridTableHeaderActions';
import { useGridTableKeyboardScopes } from '@shared/components/tables/GridTableKeys';
import type { GridTableProps } from '@shared/components/tables/GridTable.types';
import {
  getTextContent,
  isFixedColumnKey,
  isKindColumnKey as defaultIsKindColumnKey,
  normalizeKindClass,
} from '@shared/components/tables/GridTable.utils';
import { hasNarrowingGridTableFilters } from '@shared/components/tables/gridTableFilterState';

// Stable default to avoid re-creating lock lists on every render.
const DEFAULT_NON_HIDEABLE_COLUMNS: string[] = [];

// ---------------------------------------------------------------------------
// Return type — every value the render section of GridTable consumes
// ---------------------------------------------------------------------------

export interface GridTableControllerResult<T> {
  // Refs needed by sub-components
  wrapperRef: RefObject<HTMLDivElement | null>;
  tableRef: RefObject<HTMLDivElement | null>;
  headerInnerRef: RefObject<HTMLDivElement | null>;

  // Filtered data
  tableData: T[];
  filtersNode: ReactNode;

  // Focus
  focusedRowKey: string | null;
  handleWrapperFocus: (e: React.FocusEvent<HTMLDivElement>) => void;
  handleWrapperBlur: (e: React.FocusEvent<HTMLDivElement>) => void;

  // Hover
  hoverState: HoverState;

  // Context menu
  contextMenuNode: ReactNode;
  headerContextMenuNode: ReactNode;
  handleWrapperContextMenu: (e: React.MouseEvent) => void;

  // Virtualization
  shouldVirtualize: boolean;
  virtualRows: T[];
  virtualRange: { start: number; end: number };
  totalVirtualHeight: number;
  virtualOffset: number;
  scrollbarWidth: number;

  // Columns
  tableContentWidth: number;
  tableViewportWidth: number;

  // Rendering
  renderRowContent: RenderRowContentFn<T>;
  headerRow: ReactNode;

  // Pagination
  paginationEnabled: boolean;
  resolvedPaginationStatus: string;
  loadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  handleManualLoadMore: () => void;

  // Loading
  showLoadingOverlay: boolean;
  loadingOverlayMessage: string;

  // Filters
  hasActiveFilters: boolean;
  onClearFilters: () => void;

  // Profiler
  wrapWithProfiler: (node: ReactElement) => ReactElement;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export function useGridTableController<T>({
  data: inputData,
  columns,
  keyExtractor,
  getRowClassName,
  getRowStyle,
  onRowClick,
  onSort,
  sortConfig,
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
  hasMore = false,
  onRequestMore,
  isRequestingMore = false,
  autoLoadMore = true,
  showPaginationStatus = true,
  virtualization,
  loadingOverlay,
  filters,
  diagnosticsLabel,
  diagnosticsMode = 'local',
  allowHorizontalOverflow = true,
  isKindColumnKey = defaultIsKindColumnKey,
}: GridTableProps<T>): GridTableControllerResult<T> {
  const [maxTableRows, setMaxTableRows] = useState<number>(() => getMaxTableRows());
  const totalDataCount = Array.isArray(inputData) ? inputData.length : 0;
  const sourceData = useMemo<T[]>(
    () => (Array.isArray(inputData) ? inputData : ([] as T[])),
    [inputData]
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const tableRefMutable = tableRef as RefObject<HTMLElement | null>;
  const headerInnerRef = useRef<HTMLDivElement | null>(null);
  const previousInputDataRef = useRef(inputData);
  const paginationEnabled = Boolean(onRequestMore);
  const contextMenuActiveRef = useRef(false);
  const clusterKeyCheckRef = useRef(false);
  const keyExtractorRef = useRef(keyExtractor);

  useEffect(() => {
    return eventBus.on('settings:max-table-rows', (value) => {
      setMaxTableRows(value);
    });
  }, []);

  const externalColumnWidths = useGridTableExternalWidths(controlledColumnWidths);

  const { wrapWithProfiler, warnDevOnce, startFrameSampler, stopFrameSampler } =
    useGridTableProfiler({
      sampleLabel: diagnosticsLabel ? `${diagnosticsLabel} scroll` : 'GridTable scroll',
      sampleWindowMs: 2000,
      minSampleCount: 10,
      onFrameSample: diagnosticsLabel
        ? (sample) => {
            recordGridTableScrollFrameSample(diagnosticsLabel, sample);
          }
        : undefined,
      onRenderSample: diagnosticsLabel
        ? (phase, actualDuration) => {
            recordGridTablePerformanceSample(diagnosticsLabel, 'render', actualDuration, {
              renderPhase: phase,
            });
          }
        : undefined,
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
    tableData: filteredData,
    activeFilters,
    filterSignature,
    filtersContainerRef,
    filterFocusIndexRef,
    showKindDropdown,
    showNamespaceDropdown,
    filtersNode,
    handleFilterReset,
  } = useGridTableFiltersWiring<T>({
    data: sourceData,
    totalDataCount,
    maxDisplayRows: maxTableRows,
    filters,
    diagnosticsLabel,
    columnsDropdown: columnsDropdownConfig ?? undefined,
    exportColumns: renderedColumns,
    getTextContent,
  });

  const tableData = useMemo<T[]>(
    () => filteredData.slice(0, maxTableRows),
    [filteredData, maxTableRows]
  );

  useEffect(() => {
    if (!diagnosticsLabel) {
      previousInputDataRef.current = inputData;
      return;
    }

    const inputReferenceChanged = previousInputDataRef.current !== inputData;
    recordGridTablePerformanceSnapshot(diagnosticsLabel, {
      mode: diagnosticsMode,
      inputRows: totalDataCount,
      sourceRows: Math.min(totalDataCount, maxTableRows),
      displayedRows: tableData.length,
      inputReferenceChanged,
    });
    previousInputDataRef.current = inputData;
  }, [
    diagnosticsLabel,
    diagnosticsMode,
    inputData,
    maxTableRows,
    tableData.length,
    totalDataCount,
  ]);

  // Whether any filter is actively narrowing results (search text, kind, or namespace selections).
  const hasActiveFilters = filteringEnabled && hasNarrowingGridTableFilters(activeFilters);

  const loadingOverlayMessage = loadingOverlay?.message ?? 'Refreshing...';
  const showLoadingOverlay = loadingOverlay ? loadingOverlay.show : loading && tableData.length > 0;

  const {
    hoverState,
    hoverRowRef,
    updateHoverForElement,
    scheduleHeaderSync,
    focusedRowIndex,
    focusedRowKey,
    focusByIndex,
    suppressFocusedRowHighlight,
    shortcutsActive,
    lastNavigationMethodRef,
    handleWrapperFocus,
    handleWrapperBlur,
    handleRowClick,
    getRowClassNameWithFocus,
    contextMenuNode,
    handleCellContextMenu,
    handleWrapperContextMenu,
    openFocusedRowContextMenu,
    isContextMenuVisible,
    handleRowMouseEnter,
    handleRowMouseLeave,
    activateFocusedRow,
  } = useGridTableInteractionWiring<T>({
    tableData,
    columns,
    keyExtractor,
    getRowClassName,
    onRowClick,
    enableContextMenu,
    getCustomContextMenuItems,
    sortConfig,
    onSort,
    wrapperRef,
    headerInnerRef,
    hideHeader,
    contextMenuActiveRef,
  });

  const {
    columnWidths,
    columnVirtualizationConfig,
    columnRenderModelsWithOffsets,
    columnWindowRange,
    updateColumnWindowRange,
    tableContentWidth,
    tableViewportWidth,
    handleResizeStart,
    autoSizeColumn,
    markVisibleAutoColumnsDirty,
  } = useGridTableColumnLayout<T>({
    columns,
    renderedColumns,
    tableRef,
    wrapperRef,
    tableData,
    initialColumnWidths,
    controlledColumnWidths,
    externalColumnWidths,
    enableColumnResizing,
    onColumnWidthsChange,
    useShortNames,
    allowHorizontalOverflow,
    virtualization,
    isKindColumnKey,
    getTextContent,
  });

  const { getCachedCellContent } = useGridTableCellCache<T>({
    renderedColumns,
    isKindColumnKey,
    getTextContent,
    normalizeKindClass,
    data: tableData,
  });

  const {
    shouldVirtualize,
    virtualRows,
    virtualRange,
    virtualRowHeight,
    totalVirtualHeight,
    virtualOffset,
    measureRowRef,
    getRowTop,
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

  useEffect(() => {
    markVisibleAutoColumnsDirty();
  }, [markVisibleAutoColumnsDirty, virtualRange.end, virtualRange.start]);

  const { getPageSizeRef, moveSelectionByDelta, jumpToIndex } = useGridTableKeyboardNavigation({
    tableDataLength: tableData.length,
    focusedRowIndex,
    focusedRowKey,
    shortcutsActive,
    focusByIndex,
    lastNavigationMethodRef,
    wrapperRef,
    updateHoverForElement,
    shouldVirtualize,
    virtualRowHeight,
    getRowTop,
  });

  useGridTableKeyboardScopes({
    filteringEnabled,
    showKindDropdown,
    showNamespaceDropdown,
    filtersContainerRef,
    filterFocusIndexRef,
    wrapperRef,
    tableDataLength: tableData.length,
    focusedRowKey,
    suppressFocusedRowHighlight,
    jumpToIndex,
  });

  useGridTableShortcuts({
    shortcutsActive,
    enableContextMenu,
    onOpenFocusedRow: activateFocusedRow,
    onOpenContextMenu: openFocusedRowContextMenu,
    moveSelectionByDelta,
    jumpToIndex,
    getPageSizeRef,
    tableDataLength: tableData.length,
    isContextMenuVisible,
  });

  useGridTableHeaderSyncEffects({
    hideHeader,
    wrapperRef,
    scheduleHeaderSync,
    updateHoverForElement,
    hoverRowRef,
    updateColumnWindowRange,
    virtualizationHandlesScroll: shouldVirtualize,
  });

  if (keyExtractorRef.current !== keyExtractor) {
    keyExtractorRef.current = keyExtractor;
    clusterKeyCheckRef.current = false;
  }
  if (import.meta.env.DEV && !clusterKeyCheckRef.current && tableData.length > 0) {
    clusterKeyCheckRef.current = true;
    const sampleKey = keyExtractor(tableData[0], 0);
    if (!sampleKey.includes('|')) {
      warnDevOnce(
        `GridTable: keyExtractor returned "${sampleKey}" which does not appear ` +
          `cluster-scoped (missing "|" separator). Use buildClusterScopedKey() ` +
          `to prevent key collisions in multi-cluster views.`
      );
    }
  }

  const { renderSortIndicator, handleHeaderClick, handleHeaderContextMenu, headerContextMenuNode } =
    useGridTableHeaderActions<T>({
      columns,
      lockedColumns,
      sortConfig,
      onSort,
      applyVisibilityChanges,
      contextMenuActiveRef,
    });

  const renderRowContent = useGridTableRowRenderer({
    keyExtractor,
    getRowClassName: getRowClassNameWithFocus,
    getRowStyle,
    handleRowClick,
    handleRowMouseEnter,
    handleRowMouseLeave,
    columnRenderModelsWithOffsets,
    columnVirtualizationConfig,
    columnWindowRange,
    handleContextMenu: handleCellContextMenu,
    getCachedCellContent,
    measureRowRef,
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
    handleHeaderContextMenu,
    columnWidths,
    handleHeaderClick,
    renderSortIndicator,
    handleResizeStart,
    autoSizeColumn,
    sortConfig,
  });

  return {
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
    showLoadingOverlay,
    loadingOverlayMessage,
    hasActiveFilters,
    onClearFilters: handleFilterReset,
    wrapWithProfiler,
  };
}
