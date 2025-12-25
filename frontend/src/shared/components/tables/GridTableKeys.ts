/**
 * frontend/src/shared/components/tables/GridTableKeys.ts
 *
 * UI component for GridTableKeys.
 * Handles rendering and interactions for the shared components.
 */

import { useCallback } from 'react';
import type { RefObject } from 'react';
import { useKeyboardNavigationScope } from '@ui/shortcuts';
import { KeyboardScopePriority } from '@ui/shortcuts/priorities';

interface GridTableKeyboardOptions {
  filteringEnabled: boolean;
  showKindDropdown: boolean;
  showNamespaceDropdown: boolean;
  filtersContainerRef: RefObject<HTMLDivElement | null>;
  filterFocusIndexRef: RefObject<number | null>;
  wrapperRef: RefObject<HTMLDivElement | null>;
  tableDataLength: number;
  focusedRowIndex: number | null;
  jumpToIndex: (index: number) => boolean;
}

export const useGridTableKeyboardScopes = ({
  filteringEnabled,
  showKindDropdown,
  showNamespaceDropdown,
  filtersContainerRef,
  filterFocusIndexRef,
  wrapperRef,
  tableDataLength,
  focusedRowIndex,
  jumpToIndex,
}: GridTableKeyboardOptions) => {
  const getFilterTargets = useCallback((): HTMLElement[] => {
    if (!filteringEnabled || !filtersContainerRef.current) {
      return [];
    }
    const container = filtersContainerRef.current;
    const targets: HTMLElement[] = [];

    const addTarget = (element: HTMLElement | null) => {
      if (element && element.tabIndex !== -1 && !element.hasAttribute('disabled')) {
        targets.push(element);
      }
    };

    if (showKindDropdown) {
      addTarget(
        container.querySelector<HTMLElement>(
          '[data-gridtable-filter-role="kind"] .dropdown-trigger'
        )
      );
    }
    if (showNamespaceDropdown) {
      addTarget(
        container.querySelector<HTMLElement>(
          '[data-gridtable-filter-role="namespace"] .dropdown-trigger'
        )
      );
    }
    addTarget(container.querySelector<HTMLElement>('[data-gridtable-filter-role="search"]'));
    addTarget(container.querySelector<HTMLElement>('[data-gridtable-filter-role="reset"]'));

    return targets;
  }, [filteringEnabled, filtersContainerRef, showKindDropdown, showNamespaceDropdown]);

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

  const filterTabEnterHandler = useCallback(
    ({ direction }: { direction: 'forward' | 'backward' }) => {
      const targets = getFilterTargets();
      if (targets.length === 0) {
        return;
      }
      const index = direction === 'backward' ? targets.length - 1 : 0;
      focusFilterAtIndex(index);
    },
    [focusFilterAtIndex, getFilterTargets]
  );

  const tableTabNavigationHandler = useCallback(
    ({ direction, event }: { direction: 'forward' | 'backward'; event: KeyboardEvent }) => {
      const filterTargets = getFilterTargets();
      if (direction === 'backward' && filterTargets.length > 0) {
        event.preventDefault();
        focusFilterAtIndex(filterTargets.length - 1);
        return 'handled';
      }
      event.preventDefault();
      filterFocusIndexRef.current = null;
      return 'bubble';
    },
    [focusFilterAtIndex, filterFocusIndexRef, getFilterTargets]
  );

  const tableTabEnterHandler = useCallback(
    ({ direction }: { direction: 'forward' | 'backward' }) => {
      filterFocusIndexRef.current = null;
      const element = wrapperRef.current;
      if (element) {
        element.focus();
      }
      if (focusedRowIndex === null && tableDataLength > 0) {
        const targetIndex = direction === 'backward' ? tableDataLength - 1 : 0;
        jumpToIndex(targetIndex);
      }
    },
    [filterFocusIndexRef, focusedRowIndex, jumpToIndex, tableDataLength, wrapperRef]
  );

  useKeyboardNavigationScope({
    ref: filtersContainerRef,
    priority: KeyboardScopePriority.GRIDTABLE_FILTERS,
    disabled: !filteringEnabled,
    onNavigate: filterTabNavigationHandler,
    onEnter: filterTabEnterHandler,
  });

  useKeyboardNavigationScope({
    ref: wrapperRef,
    priority: KeyboardScopePriority.GRIDTABLE_BODY,
    onNavigate: tableTabNavigationHandler,
    onEnter: tableTabEnterHandler,
  });
};
