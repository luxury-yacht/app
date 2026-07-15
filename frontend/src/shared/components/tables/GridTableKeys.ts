/**
 * frontend/src/shared/components/tables/GridTableKeys.ts
 *
 * UI component for GridTableKeys.
 * Handles rendering and interactions for the shared components.
 */

import { getTabbableElements } from '@shared/components/modals/getTabbableElements';
import { useKeyboardSurface } from '@ui/shortcuts';
import { KeyboardScopePriority } from '@ui/shortcuts/priorities';
import type { RefObject } from 'react';
import { useCallback } from 'react';

interface GridTableKeyboardOptions {
  filteringEnabled: boolean;
  filtersContainerRef: RefObject<HTMLDivElement | null>;
  filterFocusIndexRef: RefObject<number | null>;
  wrapperRef: RefObject<HTMLDivElement | null>;
  focusRef: RefObject<HTMLTableElement | null>;
  tableDataLength: number;
  focusedRowKey: string | null;
  suppressFocusedRowHighlight: () => void;
  jumpToIndex: (index: number) => boolean;
}

export const useGridTableKeyboardScopes = ({
  filteringEnabled,
  filtersContainerRef,
  filterFocusIndexRef,
  wrapperRef,
  focusRef,
  tableDataLength,
  focusedRowKey,
  suppressFocusedRowHighlight,
  jumpToIndex,
}: GridTableKeyboardOptions) => {
  const getFilterTargets = useCallback((): HTMLElement[] => {
    if (!filteringEnabled || !filtersContainerRef.current) {
      return [];
    }
    return getTabbableElements(filtersContainerRef.current);
  }, [filteringEnabled, filtersContainerRef]);

  const focusFilterAtIndex = useCallback(
    (index: number) => {
      const targets = getFilterTargets();
      if (index < 0 || index >= targets.length) {
        return false;
      }
      const target = targets[index];
      target.focus();
      filterFocusIndexRef.current = index;
      return true;
    },
    [filterFocusIndexRef, getFilterTargets]
  );

  const filterTabNavigationHandler = useCallback(
    ({ direction, event }: { direction: 'forward' | 'backward'; event: KeyboardEvent }) => {
      const targets = getFilterTargets();
      if (targets.length === 0) {
        return 'bubble';
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const activeIndex = target ? targets.indexOf(target) : -1;
      if (activeIndex === -1) {
        return 'handled';
      }
      if (direction === 'forward') {
        if (activeIndex >= targets.length - 1) {
          filterFocusIndexRef.current = null;
          return 'bubble';
        }
        event.preventDefault();
        focusFilterAtIndex(activeIndex + 1);
        return 'handled';
      }
      if (activeIndex <= 0) {
        filterFocusIndexRef.current = null;
        return 'bubble';
      }
      event.preventDefault();
      focusFilterAtIndex(activeIndex - 1);
      return 'handled';
    },
    [focusFilterAtIndex, filterFocusIndexRef, getFilterTargets]
  );

  const tableTabNavigationHandler = useCallback(
    ({ direction, event }: { direction: 'forward' | 'backward'; event: KeyboardEvent }) => {
      const filterTargets = getFilterTargets();
      if (direction === 'backward' && filterTargets.length > 0) {
        suppressFocusedRowHighlight();
        event.preventDefault();
        focusFilterAtIndex(filterTargets.length - 1);
        return 'handled';
      }
      suppressFocusedRowHighlight();
      filterFocusIndexRef.current = null;
      return 'bubble';
    },
    [focusFilterAtIndex, filterFocusIndexRef, getFilterTargets, suppressFocusedRowHighlight]
  );

  const tableTabEnterHandler = useCallback(
    ({ direction }: { direction: 'forward' | 'backward' }) => {
      filterFocusIndexRef.current = null;
      const element = focusRef.current;
      if (element) {
        element.focus();
      }
      if (focusedRowKey === null && tableDataLength > 0) {
        const targetIndex = direction === 'backward' ? tableDataLength - 1 : 0;
        jumpToIndex(targetIndex);
      }
    },
    [filterFocusIndexRef, focusRef, focusedRowKey, jumpToIndex, tableDataLength]
  );

  const handleTableKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return false;
      }
      const direction = event.shiftKey ? 'backward' : 'forward';
      const result = tableTabNavigationHandler({ direction, event });
      if (result === 'handled') {
        return true;
      }
      return false;
    },
    [tableTabNavigationHandler]
  );

  const handleFilterKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return false;
      }
      const direction = event.shiftKey ? 'backward' : 'forward';
      const result = filterTabNavigationHandler({ direction, event });
      if (result === 'handled') {
        return true;
      }
      if (result === 'bubble' && direction === 'forward') {
        tableTabEnterHandler({ direction });
        event.preventDefault();
        return true;
      }
      return false;
    },
    [filterTabNavigationHandler, tableTabEnterHandler]
  );

  useKeyboardSurface({
    kind: 'region',
    rootRef: filtersContainerRef,
    active: filteringEnabled,
    priority: KeyboardScopePriority.GRIDTABLE_FILTERS,
    onKeyDown: handleFilterKeyDown,
  });

  useKeyboardSurface({
    kind: 'region',
    rootRef: wrapperRef,
    active: true,
    priority: KeyboardScopePriority.GRIDTABLE_BODY,
    onKeyDown: handleTableKeyDown,
  });
};
