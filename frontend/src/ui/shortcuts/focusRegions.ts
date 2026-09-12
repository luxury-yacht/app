import { getFocusPortalOwner } from '@shared/utils/focusOwnership';

const REGION_SELECTOR = '[data-app-region], .dockable-panel';

export interface AppRegion {
  roots: HTMLElement[];
}

export const isFocusTargetAvailable = (element: HTMLElement): boolean => {
  if (
    !element.isConnected ||
    element.matches(':disabled') ||
    element.closest('[hidden], [inert], [aria-hidden="true"], .sidebar.collapsed')
  ) {
    return false;
  }
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
  }
  return true;
};

export const getFocusRegions = (): AppRegion[] => {
  const regions: AppRegion[] = [];
  for (const name of ['header', 'sidebar', 'content']) {
    const roots = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-app-region="${name}"]`)
    ).filter(isFocusTargetAvailable);
    if (roots.length) {
      regions.push({ roots });
    }
  }
  const additionalRoots = ['.dockable-panel', '[data-app-region="notifications"]'].flatMap(
    (selector) => Array.from(document.querySelectorAll<HTMLElement>(selector))
  );
  regions.push(
    ...additionalRoots.filter(isFocusTargetAvailable).map((root) => ({ roots: [root] }))
  );
  return regions;
};

export const regionContains = (region: AppRegion, element: Element | null) => {
  const target = getFocusPortalOwner(element) ?? element;
  const owner = target?.closest<HTMLElement>(REGION_SELECTOR);
  return owner !== undefined && owner !== null && region.roots.includes(owner);
};
