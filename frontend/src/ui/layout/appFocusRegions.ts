import { type RefObject, useEffect } from 'react';
import { getTabbableElements } from '@shared/components/modals/getTabbableElements';
import { useKeyboardSurface } from '@ui/shortcuts';
import { hasNativeTabHandling } from '@ui/shortcuts/utils';

export type TopLevelAppRegion = 'header' | 'sidebar' | 'content';

const PROGRAMMATIC_FOCUS_CLASS = 'keyboard-programmatic-focus';

const TOP_LEVEL_REGION_SELECTOR: Record<TopLevelAppRegion, string> = {
  header: '[data-app-region="header"]',
  sidebar: '[data-app-region="sidebar"]',
  content: '[data-app-region="content"]',
};

const lastFocusedElementByRegion = new Map<TopLevelAppRegion, HTMLElement>();
let lastFocusedTopLevelRegion: TopLevelAppRegion | null = null;
let lastProgrammaticFocusElement: HTMLElement | null = null;

const clearProgrammaticFocusIndicator = (except?: HTMLElement | null) => {
  if (
    lastProgrammaticFocusElement &&
    lastProgrammaticFocusElement !== except &&
    lastProgrammaticFocusElement.isConnected
  ) {
    lastProgrammaticFocusElement.classList.remove(PROGRAMMATIC_FOCUS_CLASS);
  }

  if (!except || lastProgrammaticFocusElement !== except) {
    lastProgrammaticFocusElement = except ?? null;
  }
};

export const focusElementWithProgrammaticIndicator = (element: HTMLElement | null) => {
  if (!element) {
    return false;
  }

  clearProgrammaticFocusIndicator(element);
  element.classList.add(PROGRAMMATIC_FOCUS_CLASS);
  element.focus();
  return document.activeElement === element;
};

const getLastHeaderControl = () =>
  document.querySelector<HTMLElement>('[data-app-header-last-focusable="true"]');

const getHeaderRoot = () => document.querySelector<HTMLElement>(TOP_LEVEL_REGION_SELECTOR.header);

const getActiveClusterTab = () =>
  document.querySelector<HTMLElement>('.cluster-tabs-wrapper [role="tab"][tabindex="0"]');

const getVisibleSidebar = () => document.querySelector<HTMLElement>('.sidebar:not(.collapsed)');

const getSelectedSidebarItem = () =>
  document.querySelector<HTMLElement>('.sidebar:not(.collapsed) .sidebar-item.active');

const getFirstSidebarItem = () =>
  document.querySelector<HTMLElement>('.sidebar:not(.collapsed) [data-sidebar-focusable="true"]');

const getContentRoot = () => document.querySelector<HTMLElement>(TOP_LEVEL_REGION_SELECTOR.content);

const getRegionFromElement = (element: Element | null): TopLevelAppRegion | null => {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  for (const [region, selector] of Object.entries(TOP_LEVEL_REGION_SELECTOR) as Array<
    [TopLevelAppRegion, string]
  >) {
    if (element.closest(selector)) {
      return region;
    }
  }

  return null;
};

const focusSavedRegionElement = (region: TopLevelAppRegion) => {
  const root = document.querySelector<HTMLElement>(TOP_LEVEL_REGION_SELECTOR[region]);
  const element = lastFocusedElementByRegion.get(region);
  if (!root || !element || !element.isConnected || !root.contains(element)) {
    return false;
  }

  return focusElementWithProgrammaticIndicator(element);
};

const focusHeaderRegion = () => {
  if (focusSavedRegionElement('header')) {
    return true;
  }

  const headerRoot = getHeaderRoot();
  if (!headerRoot) {
    return false;
  }

  const firstHeaderTarget = getTabbableElements(headerRoot)[0] ?? getLastHeaderControl();
  if (!firstHeaderTarget) {
    return false;
  }

  return focusElementWithProgrammaticIndicator(firstHeaderTarget);
};

export const focusPreviousRegionBeforeSidebar = () => {
  const activeClusterTab = getActiveClusterTab();
  if (activeClusterTab) {
    return focusElementWithProgrammaticIndicator(activeClusterTab);
  }

  const lastHeaderControl = getLastHeaderControl();
  if (lastHeaderControl) {
    return focusElementWithProgrammaticIndicator(lastHeaderControl);
  }

  return false;
};

const focusTopLevelAppRegion = (region: TopLevelAppRegion) => {
  if (region === 'header') {
    return focusHeaderRegion();
  }

  if (region === 'sidebar') {
    if (focusSavedRegionElement('sidebar')) {
      return true;
    }

    const selectedSidebarItem = getSelectedSidebarItem();
    if (selectedSidebarItem) {
      return focusElementWithProgrammaticIndicator(selectedSidebarItem);
    }

    const firstSidebarItem = getFirstSidebarItem();
    if (firstSidebarItem) {
      return focusElementWithProgrammaticIndicator(firstSidebarItem);
    }

    const visibleSidebar = getVisibleSidebar();
    if (visibleSidebar) {
      return focusElementWithProgrammaticIndicator(visibleSidebar);
    }

    return false;
  }

  if (focusSavedRegionElement('content')) {
    return true;
  }

  const contentRoot = getContentRoot();
  if (!contentRoot) {
    return false;
  }

  const firstContentTarget = getTabbableElements(contentRoot)[0];
  if (!firstContentTarget) {
    return false;
  }

  return focusElementWithProgrammaticIndicator(firstContentTarget);
};

export const focusLastFocusedTopLevelAppRegion = () => {
  if (lastFocusedTopLevelRegion) {
    return focusTopLevelAppRegion(lastFocusedTopLevelRegion);
  }

  return (
    focusTopLevelAppRegion('content') || focusTopLevelAppRegion('sidebar') || focusHeaderRegion()
  );
};

export const useTopLevelAppRegionTracking = (active = true) => {
  useEffect(() => {
    if (!active || typeof document === 'undefined') {
      return;
    }

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const region = getRegionFromElement(target);
      if (!target || !region) {
        clearProgrammaticFocusIndicator(target);
        return;
      }

      clearProgrammaticFocusIndicator(target);
      lastFocusedTopLevelRegion = region;
      lastFocusedElementByRegion.set(region, target);
    };

    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [active]);
};

const focusPreviousRegionBeforeContent = () => {
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

      if (hasNativeTabHandling(event.target)) {
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

export const __resetTopLevelAppRegionTrackingForTests = () => {
  lastFocusedElementByRegion.clear();
  lastFocusedTopLevelRegion = null;
  clearProgrammaticFocusIndicator(null);
};
