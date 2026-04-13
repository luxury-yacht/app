import { type RefObject } from 'react';
import { getTabbableElements } from '@shared/components/modals/getTabbableElements';
import { useKeyboardSurface } from '@ui/shortcuts';

const getLastHeaderControl = () =>
  document.querySelector<HTMLElement>('[data-app-header-last-focusable="true"]');

const getActiveClusterTab = () =>
  document.querySelector<HTMLElement>('.cluster-tabs-wrapper [role="tab"][tabindex="0"]');

const getVisibleSidebar = () => document.querySelector<HTMLElement>('.sidebar:not(.collapsed)');

const getSelectedSidebarItem = () =>
  document.querySelector<HTMLElement>('.sidebar:not(.collapsed) .sidebar-item.active');

const getFirstSidebarItem = () =>
  document.querySelector<HTMLElement>('.sidebar:not(.collapsed) [data-sidebar-focusable="true"]');

export const focusPreviousRegionBeforeSidebar = () => {
  const activeClusterTab = getActiveClusterTab();
  if (activeClusterTab) {
    activeClusterTab.focus();
    return true;
  }

  const lastHeaderControl = getLastHeaderControl();
  if (lastHeaderControl) {
    lastHeaderControl.focus();
    return true;
  }

  return false;
};

export const focusPreviousRegionBeforeContent = () => {
  const selectedSidebarItem = getSelectedSidebarItem();
  if (selectedSidebarItem) {
    selectedSidebarItem.focus();
    return true;
  }

  const firstSidebarItem = getFirstSidebarItem();
  if (firstSidebarItem) {
    firstSidebarItem.focus();
    return true;
  }

  const visibleSidebar = getVisibleSidebar();
  if (visibleSidebar) {
    // Fallback only when the sidebar has no registered focusable items yet.
    visibleSidebar.focus();
    return true;
  }

  return focusPreviousRegionBeforeSidebar();
};

export const useContentRegionShiftTabHandoff = (
  contentRef: RefObject<HTMLElement | null>,
  active = true
) => {
  useKeyboardSurface({
    kind: 'region',
    rootRef: contentRef,
    active,
    priority: 30,
    captureWhenActive: true,
    onKeyDown: (event) => {
      if (
        event.key !== 'Tab' ||
        !event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return false;
      }

      const contentRoot = contentRef.current;
      if (!contentRoot) {
        return false;
      }

      const tabbables = getTabbableElements(contentRoot);
      if (tabbables.length === 0) {
        return false;
      }

      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement !== tabbables[0]) {
        return false;
      }

      return focusPreviousRegionBeforeContent();
    },
  });
};
