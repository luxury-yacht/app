/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs.ts
 *
 * Computes available object-panel tabs from capabilities, object identity, and
 * object type, then wires keyboard shortcuts for tab navigation.
 */

import { TABS } from '@modules/object-panel/components/ObjectPanel/constants';
import type {
  ComputedCapabilities,
  PanelObjectData,
  ViewType,
} from '@modules/object-panel/components/ObjectPanel/types';
import { hasCompleteObjectMapReference } from '@modules/object-panel/objectPanelRef';
import { useShortcuts } from '@ui/shortcuts';
import { useEffect, useMemo } from 'react';
import { resolveResourceMetricsScope } from '@/core/resource-metrics';

interface UseObjectPanelTabsArgs {
  capabilities: ComputedCapabilities;
  objectData: PanelObjectData | null;
  isHelmRelease: boolean;
  isEvent: boolean;
  isOpen: boolean;
  /**
   * Persist the active sub-tab — it lives in ObjectPanelStateContext
   * (per-cluster) so it survives the unmount/remount caused by cluster
   * switching. See ObjectPanel.tsx for the rationale.
   */
  setActiveTab: (tab: ViewType) => void;
  currentTab: ViewType;
}

interface ObjectPanelTabsResult {
  availableTabs: Array<{ id: string; label: string }>;
}

type PanelTab = (typeof TABS)[keyof typeof TABS];

// Helm releases show their manifest and values instead of the object tabs; Event objects have no
// events, YAML, or map of their own.
const HELM_HIDDEN_TABS = new Set(['events', 'yaml', 'pods', 'jobs', 'map', 'metrics']);
const HELM_ONLY_TABS = new Set(['manifest', 'values']);
const EVENT_HIDDEN_TABS = new Set(['events', 'yaml', 'map']);

const isHiddenForObjectType = (tabId: string, isHelmRelease: boolean, isEvent: boolean): boolean =>
  (isHelmRelease ? HELM_HIDDEN_TABS.has(tabId) : HELM_ONLY_TABS.has(tabId)) ||
  (isEvent && EVENT_HIDDEN_TABS.has(tabId));

const isAllowedForKind = (tab: PanelTab, objectKind: string | null): boolean => {
  const kinds: readonly string[] = 'onlyForKinds' in tab ? tab.onlyForKinds : [];
  return kinds.length === 0 || (objectKind !== null && kinds.includes(objectKind));
};

const hasRequiredCapability = (tab: PanelTab, capabilities: ComputedCapabilities): boolean => {
  if ('alwaysShow' in tab && tab.alwaysShow) {
    return true;
  }
  if ('requiresCapability' in tab && tab.requiresCapability) {
    return capabilities[tab.requiresCapability as keyof ComputedCapabilities];
  }
  return true;
};

export const useObjectPanelTabs = ({
  capabilities,
  objectData,
  isHelmRelease,
  isEvent,
  isOpen,
  setActiveTab,
  currentTab,
}: UseObjectPanelTabsArgs): ObjectPanelTabsResult => {
  const objectKind = objectData?.kind?.toLowerCase() ?? null;

  const availableTabs = useMemo(() => {
    const orderedTabs = [
      TABS.DETAILS,
      TABS.MAP,
      TABS.PODS,
      TABS.JOBS,
      TABS.LOGS,
      TABS.METRICS,
      TABS.EVENTS,
      TABS.YAML,
      TABS.SHELL,
      TABS.MANIFEST,
      TABS.VALUES,
    ];

    return orderedTabs.filter((tab) => {
      if (isHiddenForObjectType(tab.id, isHelmRelease, isEvent)) {
        return false;
      }
      // These tabs depend on the object's full identity, not just its kind.
      if (tab.id === 'map') {
        return hasCompleteObjectMapReference(objectData);
      }
      if (tab.id === 'metrics') {
        return resolveResourceMetricsScope(objectData).kind === 'domain';
      }
      return isAllowedForKind(tab, objectKind) && hasRequiredCapability(tab, capabilities);
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
        helpOrder: 50 + index,
        enabled: isOpen,
      })),
    [availableTabs, isOpen, setActiveTab]
  );

  useShortcuts(tabShortcuts, {
    category: 'Navigation',
    priority: isOpen ? 20 : 0,
  });

  return {
    availableTabs,
  };
};
