import { getTabbableElements } from '@shared/components/modals/getTabbableElements';
import { getFocusPortalOwner } from '@shared/utils/focusOwnership';
import { focusPanelById } from '@ui/dockable/useDockablePanelState';
import { useShortcuts } from '@ui/shortcuts';
import {
  type AppRegion,
  getFocusRegions,
  isFocusTargetAvailable,
  regionContains,
} from '@ui/shortcuts/focusRegions';
import { hasNativeTabHandling } from '@ui/shortcuts/utils';
import { useEffect, useRef } from 'react';

const getRegionControls = (region: AppRegion) =>
  region.roots
    .flatMap((root) => [...(root.tabIndex >= 0 ? [root] : []), ...getTabbableElements(root)])
    .filter((element) => regionContains(region, element) && isFocusTargetAvailable(element));

const getEntryTarget = (region: AppRegion): HTMLElement => {
  const root = region.roots[0];
  // Inactive panels suppress tab stops. Their selected tab remains an entry
  // target; focusing the panel restores its normal tab stops.
  const preferred = root.querySelector<HTMLElement>(
    '.dockable-panel__header [role="tab"][aria-selected="true"], .sidebar-item.active'
  );
  if (preferred && isFocusTargetAvailable(preferred)) {
    return preferred;
  }
  return getRegionControls(region)[0] ?? root;
};

const focusRegion = (region: AppRegion, saved: HTMLElement | undefined) => {
  const root = region.roots[0];
  if (root.dataset.activePanelId) {
    focusPanelById(root.dataset.activePanelId);
  }
  const target =
    saved &&
    regionContains(region, saved) &&
    isFocusTargetAvailable(saved) &&
    (root.dataset.appRegion !== 'sidebar' || saved.dataset.sidebarFocusable === 'true')
      ? saved
      : getEntryTarget(region);
  target.focus();
  return region.roots.some((element) => element.contains(document.activeElement));
};

// Sidebar arrow navigation focuses descendants of its single tab stop.
const focusAfterCompositeControl = (controls: HTMLElement[], backwards: boolean) => {
  const index = controls.findIndex((control) => control.contains(document.activeElement));
  if (index < 0) {
    return false;
  }
  controls[(index + (backwards ? -1 : 1) + controls.length) % controls.length].focus();
  return true;
};

const navigateLocally = (event: KeyboardEvent | undefined): boolean => {
  if (!event || hasNativeTabHandling(event.target)) {
    return false;
  }
  const region = getFocusRegions().find((candidate) =>
    regionContains(candidate, document.activeElement)
  );
  if (!region) {
    return false;
  }
  const controls = getRegionControls(region);
  const index = controls.indexOf(document.activeElement as HTMLElement);
  if (index === -1 && focusAfterCompositeControl(controls, event.shiftKey)) {
    return true;
  }
  if (index >= 0) {
    controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
    return true;
  }
  const target = (event.shiftKey ? controls[controls.length - 1] : controls[0]) ?? region.roots[0];
  target.focus();
  return true;
};

export function useAppRegionNavigation() {
  const savedFocus = useRef(new WeakMap<HTMLElement, HTMLElement>());
  useEffect(() => {
    const rememberFocus = () => {
      const target = document.activeElement;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const region = getFocusRegions().find((candidate) => regionContains(candidate, target));
      if (region) {
        savedFocus.current.set(region.roots[0], getFocusPortalOwner(target) ?? target);
      }
    };
    document.addEventListener('focusin', rememberFocus);
    return () => {
      document.removeEventListener('focusin', rememberFocus);
    };
  }, []);

  const cycle = (direction: number) => {
    const regions = getFocusRegions();
    if (!regions.length) {
      return false;
    }
    const current = regions.findIndex((candidate) =>
      regionContains(candidate, document.activeElement)
    );
    const entryIndex = direction > 0 ? 0 : regions.length - 1;
    const index =
      current < 0 ? entryIndex : (current + direction + regions.length) % regions.length;
    const region = regions[index];
    return focusRegion(region, savedFocus.current.get(region.roots[0]));
  };

  useShortcuts(
    [
      {
        key: 'Tab',
        modifiers: { ctrl: true },
        handler: () => cycle(1),
        description: 'Focus next region',
        helpOrder: 20,
      },
      {
        key: 'Tab',
        modifiers: { ctrl: true, shift: true },
        handler: () => cycle(-1),
        description: 'Focus previous region',
        helpOrder: 21,
      },
      {
        key: 'Tab',
        handler: navigateLocally,
        description: 'Next control in region',
        helpOrder: 10,
      },
      {
        key: 'Tab',
        modifiers: { shift: true },
        handler: navigateLocally,
        description: 'Previous control in region',
        helpOrder: 11,
      },
    ],
    { category: 'Navigation', priority: 200 }
  );
}
