/**
 * frontend/src/shared/components/tables/hooks/useGridTableContextMenuWiring.tsx
 *
 * React hook for useGridTableContextMenuWiring.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import ContextMenu from '@shared/components/ContextMenu';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { useGridTableContextMenuItems } from '@shared/components/tables/hooks/useGridTableContextMenuItems';
import { useGridTableContextMenu } from '@shared/components/tables/hooks/useGridTableContextMenu';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import type { MouseEvent, RefObject } from 'react';

// Owns GridTable's context menu lifecycle: builds items, opens from pointer or
// keyboard, tracks active state/restore target, and exposes the rendered node
// plus handlers so the main component only has to wire callbacks.

type ContextMenuWiringOptions<T> = {
  enableContextMenu: boolean;
  columns: GridColumnDefinition<T>[];
  tableData: T[];
  sortConfig: { key: string; direction: 'asc' | 'desc' | null } | undefined;
  getCustomContextMenuItems?: (item: T, columnKey: string) => ContextMenuItem[];
  onSort?: (key: string) => void;
  keyExtractor: (item: T, index: number) => string;
  focusedRowIndex: number | null;
  focusedRowKey: string | null;
  wrapperRef: RefObject<HTMLDivElement | null>;
  handleRowActivation: (item: T, index: number, source: 'pointer' | 'keyboard') => void;
  contextMenuActiveRef?: RefObject<boolean>;
};

// Builds all context-menu wiring for GridTable (items, open/close handlers, node rendering)
// so the main component doesn't have to juggle the refs and lifecycle details inline.
export function useGridTableContextMenuWiring<T>(options: ContextMenuWiringOptions<T>) {
  const {
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
    contextMenuActiveRef: externalContextMenuActiveRef,
  } = options;

  const [isContextMenuVisible, setIsContextMenuVisible] = useState(false);
  const internalContextMenuActiveRef = useRef(false);
  const contextMenuActiveRef = externalContextMenuActiveRef ?? internalContextMenuActiveRef;
  const contextMenuRestoreTargetRef = useRef<HTMLElement | null>(null);

  const getContextMenuItems = useGridTableContextMenuItems({
    columns,
    getCustomContextMenuItems,
    onSort,
    sortConfig,
  });

  const {
    contextMenu,
    openCellContextMenu,
    openCellContextMenuFromKeyboard,
    openWrapperContextMenu,
    closeContextMenu,
  } = useGridTableContextMenu<T>({
    enableContextMenu,
    columns,
    getCustomContextMenuItems,
    getContextMenuItems,
    onSort,
  });

  const beginContextMenuInteraction = useCallback(
    (fallbackTarget?: HTMLElement | null) => {
      contextMenuActiveRef.current = true;
      setIsContextMenuVisible(true);
      const activeEl =
        fallbackTarget ??
        (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null);
      contextMenuRestoreTargetRef.current = activeEl ?? wrapperRef.current;
    },
    [wrapperRef, contextMenuActiveRef]
  );

  const handleCloseContextMenu = useCallback(() => {
    closeContextMenu();
    contextMenuActiveRef.current = false;
    setIsContextMenuVisible(false);
    const target = contextMenuRestoreTargetRef.current ?? wrapperRef.current;
    contextMenuRestoreTargetRef.current = null;
    target?.focus();
  }, [closeContextMenu, wrapperRef, contextMenuActiveRef]);

  const handleCellContextMenu = useCallback(
    (event: MouseEvent, columnKey: string, item: T | null, rowIndex: number) => {
      if (!enableContextMenu) {
        return;
      }
      if (item) {
        handleRowActivation(item, rowIndex, 'pointer');
      }
      const opened = openCellContextMenu(event, columnKey, item);
      if (opened) {
        beginContextMenuInteraction(wrapperRef.current);
      }
    },
    [
      beginContextMenuInteraction,
      enableContextMenu,
      handleRowActivation,
      openCellContextMenu,
      wrapperRef,
    ]
  );

  const handleWrapperContextMenu = useCallback(
    (event: MouseEvent) => {
      if (!enableContextMenu) {
        return;
      }
      const opened = openWrapperContextMenu(event);
      if (opened) {
        beginContextMenuInteraction(wrapperRef.current);
      }
    },
    [beginContextMenuInteraction, enableContextMenu, openWrapperContextMenu, wrapperRef]
  );

  const openFocusedRowContextMenu = useCallback(() => {
    if (
      !enableContextMenu ||
      focusedRowIndex == null ||
      focusedRowIndex < 0 ||
      focusedRowIndex >= tableData.length
    ) {
      return false;
    }
    const item = tableData[focusedRowIndex];
    const derivedRowKey = focusedRowKey ?? keyExtractor(item, focusedRowIndex);
    if (!derivedRowKey) {
      return false;
    }
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return false;
    }
    const rows = wrapper.querySelectorAll<HTMLElement>('[data-row-key]');
    let rowElement: HTMLElement | null = null;
    for (const row of rows) {
      if (row.dataset.rowKey === derivedRowKey) {
        rowElement = row;
        break;
      }
    }
    if (!rowElement) {
      return false;
    }
    let anchorCell: HTMLElement | null =
      (contextMenu?.columnKey
        ? rowElement.querySelector<HTMLElement>(
            `.grid-cell[data-column="${contextMenu.columnKey}"]`
          )
        : null) ?? rowElement.querySelector<HTMLElement>('.grid-cell');

    const resolvedColumnKey = anchorCell?.dataset.column ?? contextMenu?.columnKey ?? '';
    if (!resolvedColumnKey) {
      return false;
    }

    const opened = openCellContextMenuFromKeyboard(
      resolvedColumnKey,
      item,
      anchorCell ?? rowElement
    );
    if (opened) {
      beginContextMenuInteraction(wrapperRef.current);
    }
    return opened;
  }, [
    beginContextMenuInteraction,
    contextMenu?.columnKey,
    enableContextMenu,
    focusedRowIndex,
    focusedRowKey,
    keyExtractor,
    openCellContextMenuFromKeyboard,
    tableData,
    wrapperRef,
  ]);

  const contextMenuNode = useMemo(
    () =>
      contextMenu ? (
        <ContextMenu
          items={
            contextMenu.itemsOverride ??
            getContextMenuItems(contextMenu.columnKey, contextMenu.item, contextMenu.source)
          }
          position={contextMenu.position}
          onClose={handleCloseContextMenu}
        />
      ) : null,
    [contextMenu, getContextMenuItems, handleCloseContextMenu]
  );

  return {
    contextMenuNode,
    handleCellContextMenu,
    handleWrapperContextMenu,
    openFocusedRowContextMenu,
    contextMenuActiveRef,
    isContextMenuVisible,
  };
}
