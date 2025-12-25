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
  contextMenuActiveRef: RefObject<boolean>;
  getRowClassName?: (item: T, index: number) => string | null | undefined;
  shouldIgnoreRowClick: (event: React.MouseEvent) => boolean;
};

type FocusNavigationResult<T> = {
  focusedRowIndex: number | null;
  focusedRowKey: string | null;
  setFocusedRowIndex: React.Dispatch<React.SetStateAction<number | null>>;
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
  clampRowIndex: (value: number) => number;
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
  contextMenuActiveRef,
  getRowClassName,
  shouldIgnoreRowClick,
}: FocusNavigationOptions<T>): FocusNavigationResult<T> {
  const [isWrapperFocused, setIsWrapperFocused] = useState(false);
  const [isShortcutsSuppressed, setIsShortcutsSuppressed] = useState(false);
  const [focusedRowIndex, setFocusedRowIndex] = useState<number | null>(null);
  const pendingPointerFocusRef = useRef(false);
  const lastNavigationMethodRef = useRef<'pointer' | 'keyboard'>('pointer');

  const clampRowIndex = useCallback(
    (value: number) => {
      if (tableData.length === 0) {
        return -1;
      }
      return Math.min(Math.max(value, 0), tableData.length - 1);
    },
    [tableData.length]
  );

  const focusedRowKey = useMemo(() => {
    if (focusedRowIndex == null || focusedRowIndex < 0 || focusedRowIndex >= tableData.length) {
      return null;
    }
    return keyExtractor(tableData[focusedRowIndex], focusedRowIndex);
  }, [focusedRowIndex, keyExtractor, tableData]);

  const handleWrapperFocus = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const shouldSuppress = isShortcutOptOutTarget(event.target);
      setIsWrapperFocused(true);
      setIsShortcutsSuppressed(shouldSuppress);

      if (shouldSuppress) {
        setFocusedRowIndex(null);
        return;
      }

      if (pendingPointerFocusRef.current) {
        pendingPointerFocusRef.current = false;
        return;
      }

      if (tableData.length > 0) {
        lastNavigationMethodRef.current = 'keyboard';
        setFocusedRowIndex((prev) => {
          if (prev == null || prev < 0 || prev >= tableData.length) {
            return 0;
          }
          return prev;
        });
      }
    },
    [isShortcutOptOutTarget, tableData.length]
  );

  const handleWrapperBlur = useCallback(
    (_event: React.FocusEvent<HTMLDivElement>) => {
      setIsWrapperFocused(false);
      setIsShortcutsSuppressed(false);
      if (contextMenuActiveRef.current) {
        return;
      }
      setFocusedRowIndex(null);
      updateHoverForElement(null);
    },
    [contextMenuActiveRef, updateHoverForElement]
  );

  const handleRowActivation = useCallback(
    (item: T, index: number, source: 'pointer' | 'keyboard') => {
      wrapperRef.current?.focus();
      lastNavigationMethodRef.current = source;
      setFocusedRowIndex(clampRowIndex(index));

      if (source === 'keyboard') {
        onRowClick?.(item);
      }
    },
    [clampRowIndex, onRowClick, wrapperRef]
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
    if (focusedRowIndex == null) {
      return;
    }
    if (tableData.length === 0) {
      setFocusedRowIndex(null);
      return;
    }
    const clamped = clampRowIndex(focusedRowIndex);
    if (clamped !== focusedRowIndex) {
      setFocusedRowIndex(clamped);
      return;
    }
    const rowKey = keyExtractor(tableData[clamped], clamped);
    const escapedKey =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(rowKey) : rowKey;
    const currentRow = wrapperRef.current?.querySelector<HTMLElement>(
      `[data-row-key="${escapedKey}"] .gridtable-row`
    );
    if (currentRow && currentRow instanceof HTMLDivElement) {
      updateHoverForElement(currentRow);
    }
  }, [clampRowIndex, focusedRowIndex, keyExtractor, tableData, updateHoverForElement, wrapperRef]);

  const shortcutsActive = isWrapperFocused && !isShortcutsSuppressed;

  return {
    focusedRowIndex,
    focusedRowKey,
    setFocusedRowIndex,
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
    clampRowIndex,
  };
}
