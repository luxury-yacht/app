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
import { type KindFacets, lookupKindFacets } from '@shared/kinds/kindFacets';
import { useShortcuts } from '@ui/shortcuts';
import { useEffect, useMemo } from 'react';
import { resolveResourceMetricsScope } from '@/core/resource-metrics';

interface UseObjectPanelTabsArgs {
  capabilities: ComputedCapabilities;
  objectData: PanelObjectData | null;
  isHelmRelease: boolean;
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

interface TabContext {
  facets: KindFacets | null;
  objectData: PanelObjectData | null;
  capabilities: ComputedCapabilities;
  isHelmRelease: boolean;
}

// Whether each tab is offered. Kind-dependent tabs read the object's kind facets
// (a custom resource that shares a built-in kind name has none); a kind without
// facets keeps the generic Events and YAML tabs. Helm releases read their
// manifest and values from the Helm path instead of the object.
const TAB_GATES: Record<PanelTab['id'], (context: TabContext) => boolean> = {
  details: () => true,
  map: ({ objectData }) => hasCompleteObjectMapReference(objectData),
  pods: ({ facets }) => (facets?.panel.pods ?? 'none') !== 'none',
  jobs: ({ facets }) => facets?.panel.jobs ?? false,
  logs: ({ capabilities }) => capabilities.hasObjPanelLogs,
  metrics: ({ objectData }) => resolveResourceMetricsScope(objectData).kind === 'domain',
  events: ({ facets }) => facets?.panel.eventsTab ?? true,
  yaml: ({ facets }) => facets?.panel.yamlTab ?? true,
  shell: ({ capabilities }) => capabilities.hasShell,
  manifest: ({ isHelmRelease }) => isHelmRelease,
  values: ({ isHelmRelease }) => isHelmRelease,
};

const ORDERED_TABS: readonly PanelTab[] = [
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

export const useObjectPanelTabs = ({
  capabilities,
  objectData,
  isHelmRelease,
  isOpen,
  setActiveTab,
  currentTab,
}: UseObjectPanelTabsArgs): ObjectPanelTabsResult => {
  const availableTabs = useMemo(() => {
    const context: TabContext = {
      facets: lookupKindFacets(objectData),
      objectData,
      capabilities,
      isHelmRelease,
    };
    return ORDERED_TABS.filter((tab) => TAB_GATES[tab.id](context));
  }, [capabilities, isHelmRelease, objectData]);

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
