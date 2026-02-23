/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs.ts
 *
 * Hook for useObjectPanelTabs.
 * Manages tabs within the object panel based on object capabilities and type.
 * Returns available tabs and handles keyboard shortcuts for navigation and tab switching.
 */
import { useEffect, useMemo } from 'react';

import { useShortcut, useShortcuts } from '@ui/shortcuts';
import { KeyboardShortcutPriority } from '@ui/shortcuts/priorities';

import { TABS } from '@modules/object-panel/components/ObjectPanel/constants';
import type {
  ComputedCapabilities,
  PanelAction,
  PanelObjectData,
  ViewType,
} from '@modules/object-panel/components/ObjectPanel/types';

interface UseObjectPanelTabsArgs {
  capabilities: ComputedCapabilities;
  objectData: PanelObjectData | null;
  isHelmRelease: boolean;
  isEvent: boolean;
  isOpen: boolean;
  dispatch: React.Dispatch<PanelAction>;
  close: () => void;
  currentTab: ViewType;
}

interface ObjectPanelTabsResult {
  availableTabs: Array<{ id: string; label: string }>;
}

export const useObjectPanelTabs = ({
  capabilities,
  objectData,
  isHelmRelease,
  isEvent,
  isOpen,
  dispatch,
  close,
  currentTab,
}: UseObjectPanelTabsArgs): ObjectPanelTabsResult => {
  const objectKind = objectData?.kind?.toLowerCase() ?? null;

  const availableTabs = useMemo(() => {
    const orderedTabs = [
      TABS.DETAILS,
      TABS.PODS,
      TABS.LOGS,
      TABS.EVENTS,
      TABS.YAML,
      TABS.SHELL,
      TABS.MANIFEST,
      TABS.VALUES,
      TABS.MAINTENANCE,
    ];

    return orderedTabs.filter((tab) => {
      if (isHelmRelease) {
        if (tab.id === 'events' || tab.id === 'yaml' || tab.id === 'pods') {
          return false;
        }
      } else if (tab.id === 'manifest' || tab.id === 'values') {
        return false;
      }

      if (isEvent && (tab.id === 'events' || tab.id === 'yaml')) {
        return false;
      }

      if ('onlyForKinds' in tab && Array.isArray(tab.onlyForKinds) && tab.onlyForKinds.length > 0) {
        if (!objectKind || !tab.onlyForKinds.includes(objectKind)) {
          return false;
        }
      }

      if ('alwaysShow' in tab && tab.alwaysShow) {
        return true;
      }

      if ('requiresCapability' in tab && tab.requiresCapability) {
        return capabilities[tab.requiresCapability as keyof typeof capabilities];
      }

      return true;
    });
  }, [capabilities, isEvent, isHelmRelease, objectKind]);

  useEffect(() => {
    if (!objectData) {
      return;
    }

    const isViewAvailable = availableTabs.some((tab) => tab.id === currentTab);
    if (!isViewAvailable && currentTab !== 'details') {
      dispatch({ type: 'SET_ACTIVE_TAB', payload: 'details' });
    }
  }, [availableTabs, currentTab, dispatch, objectData]);

  useShortcut({
    key: 'Escape',
    handler: () => {
      if (isOpen) {
        close();
        return true;
      }
      return false;
    },
    description: 'Close object panel',
    category: 'Object Panel',
    enabled: isOpen,
    view: 'global',
    priority: isOpen ? KeyboardShortcutPriority.OBJECT_PANEL_ESCAPE : 0,
  });

  // Derive tab shortcuts from the visible tabs so shortcut numbers always
  // match the rendered tab bar (e.g., key "1" = first visible tab, "2" =
  // second, etc.). Supports up to 9 tabs (keys 1–9).
  const tabShortcuts = useMemo(
    () =>
      availableTabs.slice(0, 9).map((tab, index) => ({
        key: String(index + 1),
        handler: () => {
          if (isOpen) {
            dispatch({ type: 'SET_ACTIVE_TAB', payload: tab.id as ViewType });
            return true;
          }
          return false;
        },
        description: `Switch to ${tab.label} tab`,
        enabled: isOpen,
      })),
    [availableTabs, isOpen, dispatch]
  );

  useShortcuts(tabShortcuts, {
    category: 'Object Panel',
    view: 'global',
    priority: isOpen ? 20 : 0,
  });

  return {
    availableTabs,
  };
};
