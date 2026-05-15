import type { RefObject } from 'react';
import { useGridTableKeyboardScopes } from '@shared/components/tables/GridTableKeys';
import type { UseGridTableHoverSyncResult } from '@shared/components/tables/hooks/useGridTableHoverSync';
import { useGridTableHeaderSyncEffects } from '@shared/components/tables/hooks/useGridTableHeaderSyncEffects';
import { useGridTableKeyboardNavigation } from '@shared/components/tables/hooks/useGridTableKeyboardNavigation';
import { useGridTableShortcuts } from '@shared/components/tables/hooks/useGridTableShortcuts';

interface UseGridTableKeyboardAndHeaderSyncOptions {
  filteringEnabled: boolean;
  showKindDropdown: boolean;
  showNamespaceDropdown: boolean;
  filtersContainerRef: RefObject<HTMLDivElement | null>;
  filterFocusIndexRef: RefObject<number | null>;
  wrapperRef: RefObject<HTMLDivElement | null>;
  tableDataLength: number;
  focusedRowIndex: number | null;
  focusedRowKey: string | null;
  suppressFocusedRowHighlight: () => void;
  shortcutsActive: boolean;
  focusByIndex: (index: number) => void;
  lastNavigationMethodRef: RefObject<'pointer' | 'keyboard'>;
  updateHoverForElement: UseGridTableHoverSyncResult['updateHoverForElement'];
  shouldVirtualize: boolean;
  virtualRowHeight: number;
  getRowTop: (index: number) => number;
  enableContextMenu: boolean;
  activateFocusedRow: () => boolean;
  openFocusedRowContextMenu: () => boolean;
  isContextMenuVisible: boolean;
  hideHeader: boolean;
  scheduleHeaderSync: UseGridTableHoverSyncResult['scheduleHeaderSync'];
  hoverRowRef: RefObject<HTMLDivElement | null>;
  updateColumnWindowRange: () => void;
}

export function useGridTableKeyboardAndHeaderSync({
  filteringEnabled,
  showKindDropdown,
  showNamespaceDropdown,
  filtersContainerRef,
  filterFocusIndexRef,
  wrapperRef,
  tableDataLength,
  focusedRowIndex,
  focusedRowKey,
  suppressFocusedRowHighlight,
  shortcutsActive,
  focusByIndex,
  lastNavigationMethodRef,
  updateHoverForElement,
  shouldVirtualize,
  virtualRowHeight,
  getRowTop,
  enableContextMenu,
  activateFocusedRow,
  openFocusedRowContextMenu,
  isContextMenuVisible,
  hideHeader,
  scheduleHeaderSync,
  hoverRowRef,
  updateColumnWindowRange,
}: UseGridTableKeyboardAndHeaderSyncOptions) {
  const { getPageSizeRef, moveSelectionByDelta, jumpToIndex } = useGridTableKeyboardNavigation({
    tableDataLength,
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
    tableDataLength,
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
    tableDataLength,
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
}
