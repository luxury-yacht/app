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

import type { GridTableProps } from '@shared/components/tables/GridTable.types';
import {
  isKindColumnKey as defaultIsKindColumnKey,
  getTextContent,
  isFixedColumnKey,
  normalizeKindClass,
} from '@shared/components/tables/GridTable.utils';
import { useGridTableKeyboardScopes } from '@shared/components/tables/GridTableKeys';
import { hasNarrowingGridTableFilters } from '@shared/components/tables/gridTableFilterState';
import { useColumnVisibilityController } from '@shared/components/tables/hooks/useColumnVisibilityController';
import { useGridTableCellCache } from '@shared/components/tables/hooks/useGridTableCellCache';
import { useGridTableColumnLayout } from '@shared/components/tables/hooks/useGridTableColumnLayout';
import { useGridTableColumnsDropdown } from '@shared/components/tables/hooks/useGridTableColumnsDropdown';
import { useGridTableExternalWidths } from '@shared/components/tables/hooks/useGridTableExternalWidths';
import { useGridTableFiltersWiring } from '@shared/components/tables/hooks/useGridTableFiltersWiring';
import { useGridTableHeaderActions } from '@shared/components/tables/hooks/useGridTableHeaderActions';
import { useGridTableHeaderRow } from '@shared/components/tables/hooks/useGridTableHeaderRow';
import { useGridTableHeaderSyncEffects } from '@shared/components/tables/hooks/useGridTableHeaderSyncEffects';
import type { HoverState } from '@shared/components/tables/hooks/useGridTableHoverSync';
import { useGridTableInteractionWiring } from '@shared/components/tables/hooks/useGridTableInteractionWiring';
import { useGridTableKeyboardNavigation } from '@shared/components/tables/hooks/useGridTableKeyboardNavigation';
import { useGridTableLocalPagination } from '@shared/components/tables/hooks/useGridTableLocalPagination';
import { useGridTableProfiler } from '@shared/components/tables/hooks/useGridTableProfiler';
import type { RenderRowContentFn } from '@shared/components/tables/hooks/useGridTableRowRenderer';
import { useGridTableRowRenderer } from '@shared/components/tables/hooks/useGridTableRowRenderer';
import { useGridTableShortcuts } from '@shared/components/tables/hooks/useGridTableShortcuts';
import { useGridTableVirtualization } from '@shared/components/tables/hooks/useGridTableVirtualization';
import {
  recordGridTablePerformanceSample,
  recordGridTablePerformanceSnapshot,
  recordGridTableScrollFrameSample,
} from '@shared/components/tables/performance/gridTablePerformanceStore';
import type { MutableRefObject, ReactElement, ReactNode, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

// Stable default to avoid re-creating lock lists on every render.
const DEFAULT_NON_HIDEABLE_COLUMNS: string[] = [];

type GridTableProfilerOptions = NonNullable<Parameters<typeof useGridTableProfiler>[0]>;

const getProfilerOptions = (diagnosticsLabel: string | undefined): GridTableProfilerOptions => {
  const sampleLabel = diagnosticsLabel ? `${diagnosticsLabel} scroll` : 'GridTable scroll';
  if (!diagnosticsLabel) {
    return { sampleLabel, sampleWindowMs: 2000, minSampleCount: 10 };
  }
  return {
    sampleLabel,
    sampleWindowMs: 2000,
    minSampleCount: 10,
    onFrameSample: (sample) => {
      recordGridTableScrollFrameSample(diagnosticsLabel, sample);
    },
    onRenderSample: (phase, actualDuration) => {
      recordGridTablePerformanceSample(diagnosticsLabel, 'render', actualDuration, {
        renderPhase: phase,
      });
    },
  };
};

interface LocalPaginationResult<T> {
  data: T[];
  controls: ReactNode;
  onPrevious?: () => void;
  onNext?: () => void;
  canPagePrevious: boolean;
  canPageNext: boolean;
}

interface PaginationFallbacks {
  controls: ReactNode;
  onPrevious?: () => void;
  onNext?: () => void;
  canPagePrevious: boolean;
  canPageNext: boolean;
}

interface ResolvedPagination<T> extends PaginationFallbacks {
  data: T[];
}

function resolvePagination<T>(
  localEnabled: boolean,
  localPage: LocalPaginationResult<T>,
  fallbacks: PaginationFallbacks
): ResolvedPagination<T> {
  return localEnabled
    ? {
        data: localPage.data,
        controls: localPage.controls,
        onPrevious: localPage.onPrevious,
        onNext: localPage.onNext,
        canPagePrevious: localPage.canPagePrevious,
        canPageNext: localPage.canPageNext,
      }
    : { data: localPage.data, ...fallbacks };
}

interface LoadingOverlayState {
  show: boolean;
  message: string;
}

const resolveLoadingOverlay = (
  loading: boolean,
  displayedRowCount: number,
  loadingOverlay: { show: boolean; message?: string } | undefined
): LoadingOverlayState => ({
  show: loadingOverlay?.show ?? (loading && displayedRowCount > 0),
  message: loadingOverlay?.message ?? 'Refreshing...',
});

interface ClusterKeyCheckOptions<T> {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  keyExtractorRef: MutableRefObject<(item: T, index: number) => string>;
  clusterKeyCheckRef: MutableRefObject<boolean>;
  warnDevOnce: (message: string) => void;
}

function checkClusterScopedKey<T>({
  data,
  keyExtractor,
  keyExtractorRef,
  clusterKeyCheckRef,
  warnDevOnce,
}: ClusterKeyCheckOptions<T>): void {
  if (keyExtractorRef.current !== keyExtractor) {
    keyExtractorRef.current = keyExtractor;
    clusterKeyCheckRef.current = false;
  }
  if (!import.meta.env.DEV || clusterKeyCheckRef.current || data.length === 0) {
    return;
  }
  clusterKeyCheckRef.current = true;
  const sampleKey = keyExtractor(data[0], 0);
  if (!sampleKey.includes('|')) {
    warnDevOnce(
      `GridTable: keyExtractor returned "${sampleKey}" which does not appear ` +
        `cluster-scoped (missing "|" separator). Use buildClusterScopedKey() ` +
        'to prevent key collisions in multi-cluster views.'
    );
  }
}

// ---------------------------------------------------------------------------
// Return type — every value the render section of GridTable consumes
// ---------------------------------------------------------------------------

export interface GridTableControllerResult<T> {
  // Refs needed by sub-components
  wrapperRef: RefObject<HTMLDivElement | null>;
  gridRef: RefObject<HTMLTableElement | null>;
  tableRef: RefObject<HTMLTableSectionElement | null>;
  headerInnerRef: RefObject<HTMLTableElement | null>;

  // Filtered data
  tableData: T[];
  filtersNode: ReactNode;
  paginationControls: ReactNode;

  // Focus
  focusedRowKey: string | null;
  handleWrapperFocus: (e: React.FocusEvent<HTMLElement>) => void;
  handleWrapperBlur: (e: React.FocusEvent<HTMLElement>) => void;
  handleWrapperBackgroundClick: () => void;

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
  getRowTop: (index: number) => number;
  scrollbarWidth: number;

  // Columns
  tableContentWidth: number;
  tableViewportWidth: number;

  // Rendering
  renderRowContent: RenderRowContentFn<T>;
  headerRow: ReactNode;

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
  onRowPointerClick,
  onRowSelectionToggle,
  onRowSelectionClear,
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
  paginationControls: externalPaginationControls,
  localPagination,
  onPagePrevious,
  onPageNext,
  canPagePrevious = false,
  canPageNext = false,
  virtualization,
  loadingOverlay,
  filters,
  fetchAllRows,
  exportFilename,
  diagnosticsLabel,
  diagnosticsMode = 'local',
  allowHorizontalOverflow = true,
  isKindColumnKey = defaultIsKindColumnKey,
}: GridTableProps<T>): GridTableControllerResult<T> {
  const totalDataCount = Array.isArray(inputData) ? inputData.length : 0;
  const sourceData = useMemo<T[]>(
    () => (Array.isArray(inputData) ? inputData : ([] as T[])),
    [inputData]
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const tableRef = useRef<HTMLTableSectionElement>(null);
  const headerInnerRef = useRef<HTMLTableElement | null>(null);
  const previousInputDataRef = useRef(inputData);
  const contextMenuActiveRef = useRef(false);
  const clusterKeyCheckRef = useRef(false);
  const keyExtractorRef = useRef(keyExtractor);

  const externalColumnWidths = useGridTableExternalWidths(controlledColumnWidths);

  const { wrapWithProfiler, warnDevOnce, startFrameSampler, stopFrameSampler } =
    useGridTableProfiler(getProfilerOptions(diagnosticsLabel));

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
    filtersNode,
    handleFilterReset,
  } = useGridTableFiltersWiring<T>({
    data: sourceData,
    totalDataCount,
    filters,
    diagnosticsLabel,
    columnsDropdown: columnsDropdownConfig ?? undefined,
    exportColumns: renderedColumns,
    getTextContent,
    fetchAllRows,
    exportFilename,
    hasAllLocalMatches: Boolean(localPagination),
  });

  const localPage = useGridTableLocalPagination({
    data: filteredData,
    config: localPagination,
    resetIdentity: `${filterSignature}|${sortConfig?.key ?? ''}|${sortConfig?.direction ?? ''}`,
  });
  const {
    data: tableData,
    controls: paginationControls,
    onPrevious: resolvedPagePrevious,
    onNext: resolvedPageNext,
    canPagePrevious: resolvedCanPagePrevious,
    canPageNext: resolvedCanPageNext,
  } = resolvePagination(Boolean(localPagination), localPage, {
    controls: externalPaginationControls,
    onPrevious: onPagePrevious,
    onNext: onPageNext,
    canPagePrevious,
    canPageNext,
  });

  useEffect(() => {
    if (!diagnosticsLabel) {
      previousInputDataRef.current = inputData;
      return;
    }

    const inputReferenceChanged = previousInputDataRef.current !== inputData;
    recordGridTablePerformanceSnapshot(diagnosticsLabel, {
      mode: diagnosticsMode,
      inputRows: totalDataCount,
      sourceRows: totalDataCount,
      displayedRows: tableData.length,
      inputReferenceChanged,
    });
    previousInputDataRef.current = inputData;
  }, [diagnosticsLabel, diagnosticsMode, inputData, tableData.length, totalDataCount]);

  // Whether any filter is actively narrowing results (search text, kind, or namespace selections).
  const hasActiveFilters = filteringEnabled && hasNarrowingGridTableFilters(activeFilters);

  const { message: loadingOverlayMessage, show: showLoadingOverlay } = resolveLoadingOverlay(
    loading,
    tableData.length,
    loadingOverlay
  );

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
    handleWrapperBackgroundClick,
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
    onRowPointerClick,
    onRowSelectionClear,
    enableContextMenu,
    getCustomContextMenuItems,
    sortConfig,
    onSort,
    wrapperRef,
    gridRef,
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
    handleResizeKeyDown,
    getColumnMinWidth,
    getColumnMaxWidth,
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

  // The dirty queue hashes rendered cells before measuring. Row virtualization changes that
  // visible signature without changing the callback identity, so both range bounds must invalidate
  // this effect after the new virtual rows commit.
  useEffect(() => {
    void virtualRange.start;
    void virtualRange.end;
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
    filtersContainerRef,
    filterFocusIndexRef,
    wrapperRef,
    focusRef: gridRef,
    tableDataLength: tableData.length,
    focusedRowKey,
    suppressFocusedRowHighlight,
    jumpToIndex,
  });

  const selectFocusedRow = useCallback(() => {
    if (
      !onRowSelectionToggle ||
      focusedRowIndex === null ||
      focusedRowIndex < 0 ||
      focusedRowIndex >= tableData.length
    ) {
      return false;
    }
    onRowSelectionToggle(tableData[focusedRowIndex]);
    return true;
  }, [focusedRowIndex, onRowSelectionToggle, tableData]);

  useGridTableShortcuts({
    shortcutsActive,
    enableContextMenu,
    onOpenFocusedRow: activateFocusedRow,
    onSelectFocusedRow: onRowSelectionToggle ? selectFocusedRow : undefined,
    onOpenContextMenu: openFocusedRowContextMenu,
    moveSelectionByDelta,
    jumpToIndex,
    getPageSizeRef,
    onPagePrevious: resolvedPagePrevious,
    onPageNext: resolvedPageNext,
    canPagePrevious: resolvedCanPagePrevious,
    canPageNext: resolvedCanPageNext,
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

  checkClusterScopedKey({
    data: tableData,
    keyExtractor,
    keyExtractorRef,
    clusterKeyCheckRef,
    warnDevOnce,
  });

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

  const headerRow = useGridTableHeaderRow({
    renderedColumns,
    enableColumnResizing,
    isFixedColumnKey,
    handleHeaderContextMenu,
    columnWidths,
    handleHeaderClick,
    renderSortIndicator,
    handleResizeStart,
    handleResizeKeyDown,
    getColumnMinWidth,
    getColumnMaxWidth,
    autoSizeColumn,
    sortConfig,
  });

  return {
    wrapperRef,
    gridRef,
    tableRef,
    headerInnerRef,
    tableData,
    filtersNode,
    paginationControls,
    focusedRowKey,
    handleWrapperFocus,
    handleWrapperBlur,
    handleWrapperBackgroundClick,
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
    onClearFilters: handleFilterReset,
    wrapWithProfiler,
  };
}
