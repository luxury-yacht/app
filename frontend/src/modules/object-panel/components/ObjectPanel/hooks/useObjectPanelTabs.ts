/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs.ts
 *
 * Manages tabs within the object panel based on object capabilities and type.
 * Returns available tabs and handles keyboard shortcuts for navigation and tab switching.
 */
import { useEffect, useMemo } from 'react';

import { useShortcuts } from '@ui/shortcuts';

import { TABS } from '@modules/object-panel/components/ObjectPanel/constants';
import { hasCompleteObjectMapReference } from '@modules/object-panel/components/ObjectPanel/objectMapSupport';
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
  /**
   * Persist the active sub-tab. Lifted out of `dispatch` because the
   * sub-tab now lives in ObjectPanelStateContext (per-cluster) instead
   * of the ObjectPanel's local useReducer — see ObjectPanel.tsx for the
   * rationale.
   */
  setActiveTab: (tab: ViewType) => void;
  /** Dispatch for the remaining (transient, non-tab) panel reducer state. */
  dispatch: React.Dispatch<PanelAction>;
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
  setActiveTab,
  dispatch: _dispatch,
  currentTab,
}: UseObjectPanelTabsArgs): ObjectPanelTabsResult => {
  const objectKind = objectData?.kind?.toLowerCase() ?? null;

  const availableTabs = useMemo(() => {
    const orderedTabs = [
      TABS.DETAILS,
      TABS.PODS,
      TABS.JOBS,
      TABS.LOGS,
      TABS.EVENTS,
      TABS.YAML,
      TABS.MAP,
      TABS.SHELL,
      TABS.MANIFEST,
      TABS.VALUES,
      TABS.MAINTENANCE,
    ];

    return orderedTabs.filter((tab) => {
      if (isHelmRelease) {
        if (
          tab.id === 'events' ||
          tab.id === 'yaml' ||
          tab.id === 'pods' ||
          tab.id === 'jobs' ||
          tab.id === 'map'
        ) {
          return false;
        }
      } else if (tab.id === 'manifest' || tab.id === 'values') {
        return false;
      }

      if (isEvent && (tab.id === 'events' || tab.id === 'yaml' || tab.id === 'map')) {
        return false;
      }

      if (tab.id === 'map') {
        return hasCompleteObjectMapReference(objectData);
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
  }, [capabilities, isEvent, isHelmRelease, objectData, objectKind]);

  useEffect(() => {
    if (!objectData) {
      return;
    }

    const isViewAvailable = availableTabs.some((tab) => tab.id === currentTab);
    if (!isViewAvailable && currentTab !== 'details') {
      setActiveTab('details');
    }
  }, [availableTabs, currentTab, setActiveTab, objectData]);

  // Derive tab shortcuts from the visible tabs so shortcut numbers always
  // match the rendered tab bar (e.g., key "1" = first visible tab, "2" =
  // second, etc.). Supports up to 9 tabs (keys 1–9).
  const tabShortcuts = useMemo(
    () =>
      availableTabs.slice(0, 9).map((tab, index) => ({
        key: String(index + 1),
        handler: () => {
          if (isOpen) {
            setActiveTab(tab.id as ViewType);
            return true;
          }
          return false;
        },
        description: `Switch to ${tab.label} tab`,
        enabled: isOpen,
      })),
    [availableTabs, isOpen, setActiveTab]
  );

  useShortcuts(tabShortcuts, {
    category: 'Object Panel',
    priority: isOpen ? 20 : 0,
  });

  return {
    availableTabs,
  };
};
