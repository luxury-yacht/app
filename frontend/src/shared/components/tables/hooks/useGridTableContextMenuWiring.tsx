/**
 * frontend/src/shared/components/tables/hooks/useGridTableContextMenuWiring.tsx
 *
 * React hook for useGridTableContextMenuWiring.
 * Encapsulates state and side effects for the shared components.
 */

import type { ContextMenuItem } from '@shared/components/ContextMenu';
import ContextMenu from '@shared/components/ContextMenu';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import {
  findGridTableCellByColumnKey,
  findGridTableRowByKey,
} from '@shared/components/tables/GridTable.utils';
import { useGridTableContextMenu } from '@shared/components/tables/hooks/useGridTableContextMenu';
import { useGridTableContextMenuItems } from '@shared/components/tables/hooks/useGridTableContextMenuItems';
import type { MouseEvent, RefObject } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';

// Owns GridTable's context menu lifecycle: builds items, opens from pointer or
// keyboard, tracks active state/restore target, and exposes the rendered node
// plus handlers so the main component only has to wire callbacks.

type ContextMenuWiringOptions<T> = {
  enableContextMenu: boolean;
  columns: GridColumnDefinition<T>[];
  tableData: T[];
  sortConfig: { key: string; direction: 'asc' | 'desc' | null } | undefined;
  getCustomContextMenuItems?: (item: T, columnKey: string) => ContextMenuItem[];
  onSort?: (key: string, targetDirection?: 'asc' | 'desc' | null) => void;
  focusedRowIndex: number | null;
  focusedRowKey: string | null;
  wrapperRef: RefObject<HTMLDivElement | null>;
  focusRef: RefObject<HTMLTableElement | null>;
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
    focusedRowIndex,
    focusedRowKey,
    wrapperRef,
    focusRef,
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
      contextMenuRestoreTargetRef.current = activeEl ?? focusRef.current;
    },
    [contextMenuActiveRef, focusRef]
  );

  const handleCloseContextMenu = useCallback(() => {
    closeContextMenu();
    contextMenuActiveRef.current = false;
    setIsContextMenuVisible(false);
    const target = contextMenuRestoreTargetRef.current ?? focusRef.current;
    contextMenuRestoreTargetRef.current = null;
    target?.focus();
  }, [closeContextMenu, contextMenuActiveRef, focusRef]);

  const handleCellContextMenu = useCallback(
    (event: MouseEvent, columnKey: string, item: T | null, _rowIndex: number) => {
      if (!enableContextMenu) {
        return;
      }
      const opened = openCellContextMenu(event, columnKey, item);
      if (opened) {
        beginContextMenuInteraction(focusRef.current);
      }
    },
    [beginContextMenuInteraction, enableContextMenu, focusRef, openCellContextMenu]
  );

  const handleWrapperContextMenu = useCallback(
    (event: MouseEvent) => {
      if (!enableContextMenu) {
        return;
      }
      const opened = openWrapperContextMenu(event);
      if (opened) {
        beginContextMenuInteraction(focusRef.current);
      }
    },
    [beginContextMenuInteraction, enableContextMenu, focusRef, openWrapperContextMenu]
  );

  const openFocusedRowContextMenu = useCallback(() => {
    if (
      !enableContextMenu ||
      focusedRowKey === null ||
      focusedRowKey === undefined ||
      focusedRowIndex === null ||
      focusedRowIndex === undefined ||
      focusedRowIndex >= tableData.length
    ) {
      return false;
    }
    const item = tableData[focusedRowIndex];
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return false;
    }
    const rowElement = findGridTableRowByKey(wrapper, focusedRowKey);
    if (!rowElement) {
      return false;
    }
    const anchorCell: HTMLElement | null =
      (contextMenu?.columnKey
        ? findGridTableCellByColumnKey(rowElement, contextMenu.columnKey)
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
      beginContextMenuInteraction(focusRef.current);
    }
    return opened;
  }, [
    beginContextMenuInteraction,
    contextMenu?.columnKey,
    enableContextMenu,
    focusedRowIndex,
    focusedRowKey,
    focusRef,
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
