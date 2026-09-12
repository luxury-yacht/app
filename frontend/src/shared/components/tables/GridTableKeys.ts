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
  suppressFocusedRowHighlight: () => void;
}

export const useGridTableKeyboardScopes = ({
  filteringEnabled,
  filtersContainerRef,
  filterFocusIndexRef,
  wrapperRef,
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
    (event: KeyboardEvent): undefined => {
      if (event.key === 'Tab') {
        suppressFocusedRowHighlight();
        filterFocusIndexRef.current = null;
      }
      // The header is a separate sibling between filters and body. Leave the
      // event unclaimed so the containing region can visit controls in DOM order.
    },
    [filterFocusIndexRef, suppressFocusedRowHighlight]
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
      return false;
    },
    [filterTabNavigationHandler]
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
