import { useCallback, useMemo } from 'react';
import type { GroupKey, TabGroupState } from './tabGroupTypes';
import { useShortcut } from '@ui/shortcuts';
import { KeyCodes } from '@ui/shortcuts/constants';
import {
  focusElementWithProgrammaticIndicator,
  focusLastFocusedTopLevelAppRegion,
} from '@ui/layout/appFocusRegions';

interface UsePanelSurfaceCyclingOptions {
  tabGroups: TabGroupState;
  focusPanel: (panelId: string) => void;
  setLastFocusedGroupKey: (key: GroupKey) => void;
}

const getVisiblePanelSurfaces = (): HTMLDivElement[] =>
  Array.from(document.querySelectorAll<HTMLDivElement>('.dockable-panel')).filter((panel) => {
    const style = window.getComputedStyle(panel);
    return panel.isConnected && style.display !== 'none' && style.visibility !== 'hidden';
  });

const getPanelEntryTarget = (panel: HTMLElement): HTMLElement | null => {
  const activeTab = panel.querySelector<HTMLElement>(
    '.dockable-panel__header [role="tab"][tabindex="0"]'
  );
  if (activeTab) {
    return activeTab;
  }

  const firstHeaderControl = panel.querySelector<HTMLElement>(
    '.dockable-panel__header [role="tab"], .dockable-panel__header button, .dockable-panel__header [tabindex="0"]'
  );
  if (firstHeaderControl) {
    return firstHeaderControl;
  }

  return null;
};

const focusPanelSurface = (
  panel: HTMLElement,
  focusPanel: (panelId: string) => void,
  setLastFocusedGroupKey: (key: GroupKey) => void
) => {
  const activePanelId = panel.dataset.activePanelId;
  const groupKey = panel.dataset.groupKey;

  if (activePanelId) {
    focusPanel(activePanelId);
  }
  if (groupKey) {
    setLastFocusedGroupKey(groupKey as GroupKey);
  }

  const target = getPanelEntryTarget(panel);
  if (!target) {
    return false;
  }

  return focusElementWithProgrammaticIndicator(target);
};

export function usePanelSurfaceCycling({
  tabGroups,
  focusPanel,
  setLastFocusedGroupKey,
}: UsePanelSurfaceCyclingOptions) {
  const hasVisiblePanels = useMemo(
    () =>
      tabGroups.right.tabs.length > 0 ||
      tabGroups.bottom.tabs.length > 0 ||
      tabGroups.floating.some((group) => group.tabs.length > 0),
    [tabGroups]
  );

  const cyclePanels = useCallback(
    (direction: 'next' | 'prev') => {
      const panels = getVisiblePanelSurfaces();
      if (panels.length === 0) {
        return false;
      }

      const activeElement = document.activeElement as HTMLElement | null;
      const currentIndex = panels.findIndex(
        (panel) => activeElement && panel.contains(activeElement)
      );

      if (currentIndex === -1) {
        const target = direction === 'next' ? panels[0] : panels[panels.length - 1];
        return focusPanelSurface(target, focusPanel, setLastFocusedGroupKey);
      }

      if (direction === 'next') {
        if (currentIndex < panels.length - 1) {
          return focusPanelSurface(panels[currentIndex + 1], focusPanel, setLastFocusedGroupKey);
        }
        return focusLastFocusedTopLevelAppRegion();
      }

      if (currentIndex > 0) {
        return focusPanelSurface(panels[currentIndex - 1], focusPanel, setLastFocusedGroupKey);
      }
      return focusLastFocusedTopLevelAppRegion();
    },
    [focusPanel, setLastFocusedGroupKey]
  );

  const handleNext = useCallback(() => cyclePanels('next'), [cyclePanels]);
  const handlePrevious = useCallback(() => cyclePanels('prev'), [cyclePanels]);

  useShortcut({
    key: KeyCodes.ARROW_RIGHT,
    modifiers: { ctrl: true, alt: true },
    handler: handleNext,
    description: 'Focus next panel or main app region',
    category: 'Navigation',
    enabled: hasVisiblePanels,
    priority: 200,
  });

  useShortcut({
    key: KeyCodes.ARROW_DOWN,
    modifiers: { ctrl: true, alt: true },
    handler: handleNext,
    description: 'Focus next panel or main app region',
    category: 'Navigation',
    enabled: hasVisiblePanels,
    priority: 200,
  });

  useShortcut({
    key: KeyCodes.ARROW_LEFT,
    modifiers: { ctrl: true, alt: true },
    handler: handlePrevious,
    description: 'Focus previous panel or main app region',
    category: 'Navigation',
    enabled: hasVisiblePanels,
    priority: 200,
  });

  useShortcut({
    key: KeyCodes.ARROW_UP,
    modifiers: { ctrl: true, alt: true },
    handler: handlePrevious,
    description: 'Focus previous panel or main app region',
    category: 'Navigation',
    enabled: hasVisiblePanels,
    priority: 200,
  });
}
