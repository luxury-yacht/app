/**
 * frontend/src/shared/components/tables/hooks/useGridTableFocusNavigation.ts
 *
 * React hook for useGridTableFocusNavigation.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

// Centralizes focus management for GridTable rows: tracks the focused row,
// handles wrapper focus/blur, pointer vs keyboard navigation, and keeps hover
// alignment in sync so the main component can stay focused on rendering.

type FocusNavigationOptions<T> = {
  tableData: T[];
  keyExtractor: (item: T, index: number) => string;
  onRowClick?: (item: T) => void;
  isShortcutOptOutTarget: (target: EventTarget | null) => boolean;
  wrapperRef: RefObject<HTMLDivElement | null>;
  updateHoverForElement: (element: HTMLDivElement | null) => void;
  getRowClassName?: (item: T, index: number) => string | null | undefined;
  shouldIgnoreRowClick: (event: React.MouseEvent) => boolean;
};

type FocusNavigationResult<T> = {
  focusedRowIndex: number | null;
  focusedRowKey: string | null;
  setFocusedRowKey: React.Dispatch<React.SetStateAction<string | null>>;
  focusByIndex: (index: number) => void;
  isWrapperFocused: boolean;
  isShortcutsSuppressed: boolean;
  shortcutsActive: boolean;
  pendingPointerFocusRef: RefObject<boolean>;
  lastNavigationMethodRef: RefObject<'pointer' | 'keyboard'>;
  handleWrapperFocus: (event: React.FocusEvent<HTMLDivElement>) => void;
  handleWrapperBlur: (event: React.FocusEvent<HTMLDivElement>) => void;
  handleRowActivation: (item: T, index: number, source: 'pointer' | 'keyboard') => void;
  handleRowClick: (item: T, index: number, event: React.MouseEvent) => void;
  getRowClassNameWithFocus: (item: T, index: number) => string;
};

// Centralizes focus, selection, and keyboard-friendly row activation logic so
// GridTable doesn't have to juggle it inline. Handles wrapper focus/blur,
// click/keyboard activation, and keeps the focused row in sync with data changes.
export function useGridTableFocusNavigation<T>({
  tableData,
  keyExtractor,
  onRowClick,
  isShortcutOptOutTarget,
  wrapperRef,
  updateHoverForElement,
  getRowClassName,
  shouldIgnoreRowClick,
}: FocusNavigationOptions<T>): FocusNavigationResult<T> {
  const [isWrapperFocused, setIsWrapperFocused] = useState(false);
  const [isShortcutsSuppressed, setIsShortcutsSuppressed] = useState(false);
  const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);
  const pendingPointerFocusRef = useRef(false);
  const lastNavigationMethodRef = useRef<'pointer' | 'keyboard'>('pointer');

  // Derive index from key — the key is the source of truth.
  const focusedRowIndex = useMemo(() => {
    if (focusedRowKey == null) return null;
    const idx = tableData.findIndex((item, i) => keyExtractor(item, i) === focusedRowKey);
    return idx === -1 ? null : idx;
  }, [focusedRowKey, keyExtractor, tableData]);

  // Helper to set focus by index — resolves to key immediately.
  const focusByIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= tableData.length) {
        setFocusedRowKey(null);
        return;
      }
      setFocusedRowKey(keyExtractor(tableData[index], index));
    },
    [keyExtractor, tableData]
  );

  const handleWrapperFocus = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const shouldSuppress = isShortcutOptOutTarget(event.target);
      setIsWrapperFocused(true);
      setIsShortcutsSuppressed(shouldSuppress);

      if (shouldSuppress) {
        setFocusedRowKey(null);
        return;
      }

      if (pendingPointerFocusRef.current) {
        pendingPointerFocusRef.current = false;
        return;
      }

      if (tableData.length > 0) {
        lastNavigationMethodRef.current = 'keyboard';
        setFocusedRowKey((prev) => {
          if (prev != null) {
            const stillExists = tableData.some((item, i) => keyExtractor(item, i) === prev);
            if (stillExists) return prev;
          }
          return keyExtractor(tableData[0], 0);
        });
      }
    },
    [isShortcutOptOutTarget, keyExtractor, tableData]
  );

  const handleWrapperBlur = useCallback((_event: React.FocusEvent<HTMLDivElement>) => {
    setIsWrapperFocused(false);
    setIsShortcutsSuppressed(false);
    // Keep the focused row visible even when the table loses focus.
    // Keyboard shortcuts are disabled via shortcutsActive when unfocused.
  }, []);

  const handleRowActivation = useCallback(
    (item: T, index: number, source: 'pointer' | 'keyboard') => {
      wrapperRef.current?.focus();
      lastNavigationMethodRef.current = source;
      const key = keyExtractor(item, index);
      setFocusedRowKey(key);

      if (source === 'keyboard') {
        onRowClick?.(item);
      }
    },
    [keyExtractor, onRowClick, wrapperRef]
  );

  const handleRowClick = useCallback(
    (item: T, index: number, event: React.MouseEvent) => {
      if (shouldIgnoreRowClick(event)) {
        return;
      }
      const isKeyboardActivation =
        event.detail === 0 && lastNavigationMethodRef.current === 'keyboard';
      handleRowActivation(item, index, isKeyboardActivation ? 'keyboard' : 'pointer');
    },
    [handleRowActivation, shouldIgnoreRowClick]
  );

  const getRowClassNameWithFocus = useCallback(
    (item: T, index: number) => {
      const base = getRowClassName?.(item, index) ?? '';
      if (!focusedRowKey) {
        return base;
      }
      const rowKey = keyExtractor(item, index);
      if (rowKey !== focusedRowKey) {
        return base;
      }
      return [base, 'gridtable-row--focused'].filter(Boolean).join(' ');
    },
    [focusedRowKey, keyExtractor, getRowClassName]
  );

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const handlePointerDown = () => {
      pendingPointerFocusRef.current = true;
      lastNavigationMethodRef.current = 'pointer';
    };
    wrapper.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      wrapper.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [wrapperRef]);

  useEffect(() => {
    if (focusedRowIndex == null || focusedRowKey == null) {
      return;
    }
    const escapedKey =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(focusedRowKey)
        : focusedRowKey;
    const currentRow = wrapperRef.current?.querySelector<HTMLElement>(
      `.gridtable-row[data-row-key="${escapedKey}"]`
    );
    if (currentRow && currentRow instanceof HTMLDivElement) {
      updateHoverForElement(currentRow);
    }
  }, [focusedRowIndex, focusedRowKey, updateHoverForElement, wrapperRef]);

  const shortcutsActive = isWrapperFocused && !isShortcutsSuppressed;

  return {
    focusedRowIndex,
    focusedRowKey,
    setFocusedRowKey,
    focusByIndex,
    isWrapperFocused,
    isShortcutsSuppressed,
    shortcutsActive,
    pendingPointerFocusRef,
    lastNavigationMethodRef,
    handleWrapperFocus,
    handleWrapperBlur,
    handleRowActivation,
    handleRowClick,
    getRowClassNameWithFocus,
  };
}
