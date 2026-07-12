import type { ContextMenuItem } from '@shared/components/ContextMenu';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { useGridTableContextMenuWiring } from '@shared/components/tables/hooks/useGridTableContextMenuWiring';
import { useGridTableExternalFocus } from '@shared/components/tables/hooks/useGridTableExternalFocus';
import { useGridTableFocusNavigation } from '@shared/components/tables/hooks/useGridTableFocusNavigation';
import { useGridTableHoverFallback } from '@shared/components/tables/hooks/useGridTableHoverFallback';
import type {
  HoverState,
  UpdateHoverOptions,
} from '@shared/components/tables/hooks/useGridTableHoverSync';
import { useGridTableHoverSync } from '@shared/components/tables/hooks/useGridTableHoverSync';
import type React from 'react';
import type { ReactNode, RefObject } from 'react';
import { useCallback, useLayoutEffect } from 'react';

const GRIDTABLE_SHORTCUT_OPT_OUT_SELECTOR = '[data-gridtable-shortcut-optout="true"]';
const GRIDTABLE_ROWCLICK_SUPPRESS_SELECTOR = '[data-gridtable-rowclick="suppress"]';
const GRIDTABLE_ROWCLICK_ALLOW_SELECTOR = '[data-gridtable-rowclick="allow"]';
const GRIDTABLE_INTERACTIVE_STOP_SELECTOR =
  'button, a[href], input, textarea, select, summary, [role="button"], [role="menuitem"], [data-gridtable-interactive="true"]';
const GRIDTABLE_ROW_TABSTOP_SELECTOR = GRIDTABLE_INTERACTIVE_STOP_SELECTOR.split(',')
  .map((selector) => `.gridtable-row ${selector.trim()}`)
  .join(', ');

interface UseGridTableInteractionWiringOptions<T> {
  tableData: T[];
  columns: GridColumnDefinition<T>[];
  keyExtractor: (item: T, index: number) => string;
  getRowClassName?: (item: T, index: number) => string | undefined | null;
  onRowClick?: (item: T) => void;
  onRowPointerClick?: (item: T) => void;
  enableContextMenu: boolean;
  getCustomContextMenuItems?: (item: T, columnKey: string) => ContextMenuItem[];
  sortConfig?: { key: string; direction: 'asc' | 'desc' | null };
  onSort?: (key: string, targetDirection?: 'asc' | 'desc' | null) => void;
  wrapperRef: RefObject<HTMLDivElement | null>;
  gridRef: RefObject<HTMLTableElement | null>;
  headerInnerRef: RefObject<HTMLDivElement | null>;
  hideHeader: boolean;
  contextMenuActiveRef: RefObject<boolean>;
}

interface GridTableInteractionWiring<T> {
  hoverState: HoverState;
  hoverRowRef: RefObject<HTMLDivElement | null>;
  updateHoverForElement: (element: HTMLDivElement | null, options?: UpdateHoverOptions) => void;
  scheduleHeaderSync: () => void;
  focusedRowIndex: number | null;
  focusedRowKey: string | null;
  focusByIndex: (index: number) => void;
  suppressFocusedRowHighlight: () => void;
  shortcutsActive: boolean;
  lastNavigationMethodRef: RefObject<'pointer' | 'keyboard'>;
  handleWrapperFocus: (event: React.FocusEvent<HTMLElement>) => void;
  handleWrapperBlur: (event: React.FocusEvent<HTMLElement>) => void;
  handleRowClick: (item: T, index: number, event: React.MouseEvent) => void;
  getRowClassNameWithFocus: (item: T, index: number) => string;
  contextMenuNode: ReactNode;
  handleCellContextMenu: (
    event: React.MouseEvent,
    columnKey: string,
    item: T | null,
    rowIndex: number
  ) => void;
  handleWrapperContextMenu: (event: React.MouseEvent) => void;
  openFocusedRowContextMenu: () => boolean;
  isContextMenuVisible: boolean;
  handleRowMouseEnter: (element: HTMLDivElement) => void;
  handleRowMouseLeave: (element?: HTMLDivElement | null) => void;
  activateFocusedRow: () => boolean;
}

export function useGridTableInteractionWiring<T>({
  tableData,
  columns,
  keyExtractor,
  getRowClassName,
  onRowClick,
  onRowPointerClick,
  enableContextMenu,
  getCustomContextMenuItems,
  sortConfig,
  onSort,
  wrapperRef,
  gridRef,
  headerInnerRef,
  hideHeader,
  contextMenuActiveRef,
}: UseGridTableInteractionWiringOptions<T>): GridTableInteractionWiring<T> {
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
    setFocusedRowKey,
    focusByIndex,
    suppressFocusedRowHighlight,
    isWrapperFocused,
    shortcutsActive,
    lastNavigationMethodRef,
    handleWrapperFocus,
    handleWrapperBlur,
    handleRowClick,
    getRowClassNameWithFocus,
  } = useGridTableFocusNavigation<T>({
    tableData,
    keyExtractor,
    onRowClick,
    onRowPointerClick,
    isShortcutOptOutTarget,
    wrapperRef,
    focusRef: gridRef,
    updateHoverForElement,
    getRowClassName,
    shouldIgnoreRowClick,
  });

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    wrapper.querySelectorAll<HTMLElement>(GRIDTABLE_ROW_TABSTOP_SELECTOR).forEach((element) => {
      if (element.tabIndex !== -1) {
        element.tabIndex = -1;
      }
    });
  });

  useGridTableExternalFocus<T>({
    tableData,
    keyExtractor,
    setFocusedRowKey,
    wrapperRef,
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
    focusedRowIndex,
    focusedRowKey,
    wrapperRef,
    focusRef: gridRef,
    contextMenuActiveRef,
  });

  const handleRowMouseEnterWithReset = useCallback(
    (element: HTMLDivElement) => {
      if (isWrapperFocused && !shortcutsActive && !contextMenuActiveRef.current) {
        setFocusedRowKey(null);
      }
      handleRowMouseEnter(element);
    },
    [contextMenuActiveRef, handleRowMouseEnter, isWrapperFocused, shortcutsActive, setFocusedRowKey]
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

  const activateFocusedRow = useCallback(() => {
    if (
      focusedRowIndex === null ||
      focusedRowIndex === undefined ||
      focusedRowIndex < 0 ||
      focusedRowIndex >= tableData.length
    ) {
      return false;
    }
    const item = tableData[focusedRowIndex];
    onRowClick?.(item);
    return true;
  }, [focusedRowIndex, onRowClick, tableData]);

  useGridTableHoverFallback({
    hoverStateVisible: hoverState.visible,
    wrapperRef,
    updateHoverForElement,
    tableLength: tableData.length,
  });

  return {
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
    handleRowMouseEnter: handleRowMouseEnterWithReset,
    handleRowMouseLeave: handleRowMouseLeaveWithReset,
    activateFocusedRow,
  };
}
