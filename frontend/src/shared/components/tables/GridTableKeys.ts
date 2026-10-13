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
  gridRef: RefObject<HTMLTableElement | null>;
  /** Whether Space expands rows here; without a toggle the table claims Space. */
  hasRowExpandToggle: boolean;
  suppressFocusedRowHighlight: () => void;
}

// Esc in a filter bar returns to the table's rows and keeps the filter, instead
// of the search box clearing itself. A control with an open menu keeps its Esc.
const returnToRowsOnEscape = (event: KeyboardEvent, grid: HTMLTableElement | null): boolean => {
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (!grid || !target || target.getAttribute('aria-expanded') === 'true') {
    return false;
  }
  grid.focus({ preventScroll: true });
  return true;
};

export const useGridTableKeyboardScopes = ({
  filteringEnabled,
  filtersContainerRef,
  filterFocusIndexRef,
  wrapperRef,
  gridRef,
  hasRowExpandToggle,
  suppressFocusedRowHighlight,
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
      const activeIndex = targets.indexOf(event.target as HTMLElement);
      if (activeIndex === -1) {
        return 'handled';
      }
      const nextIndex = activeIndex + (direction === 'forward' ? 1 : -1);
      if (nextIndex < 0 || nextIndex >= targets.length) {
        filterFocusIndexRef.current = null;
        return 'bubble';
      }
      event.preventDefault();
      focusFilterAtIndex(nextIndex);
      return 'handled';
    },
    [focusFilterAtIndex, filterFocusIndexRef, getFilterTargets]
  );

  const handleTableKeyDown = useCallback(
    (event: KeyboardEvent): true | undefined => {
      if (event.key === 'Tab') {
        suppressFocusedRowHighlight();
        filterFocusIndexRef.current = null;
      }
      // Space only expands rows. On this table itself (not a row control, nor
      // a nested table) when its rows do not expand, claim it so it neither
      // acts nor scrolls the body.
      if (event.key === ' ' && !hasRowExpandToggle && event.target === gridRef.current) {
        return true;
      }
      // The header is a separate sibling between filters and body. Leave the
      // event unclaimed so the containing region can visit controls in DOM order.
      return undefined;
    },
    [filterFocusIndexRef, gridRef, hasRowExpandToggle, suppressFocusedRowHighlight]
  );

  const handleFilterKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        return returnToRowsOnEscape(event, gridRef.current);
      }
      if (event.key !== 'Tab') {
        return false;
      }
      const direction = event.shiftKey ? 'backward' : 'forward';
      const result = filterTabNavigationHandler({ direction, event });
      if (result === 'handled') {
        return true;
      }
      return false;
    },
    [filterTabNavigationHandler, gridRef]
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
