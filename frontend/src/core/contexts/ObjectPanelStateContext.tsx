/**
 * frontend/src/core/contexts/ObjectPanelStateContext.tsx
 *
 * Manages object panel state for multi-tab object panels.
 * Each opened object gets its own tab with a unique panelId derived from its identity.
 * Provides context for components to open, close, and track open object panels.
 */
import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import type { KubernetesObjectReference } from '@/types/view-state';
import type { ViewType } from '@modules/object-panel/components/ObjectPanel/types';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { clearPanelState } from '@ui/dockable/useDockablePanelState';
import { handoffLayoutBeforeClose } from '@ui/dockable/useDockablePanelState';
import { refreshOrchestrator } from '@/core/refresh';
import { getObjectPanelKind } from '@modules/object-panel/components/ObjectPanel/hooks/getObjectPanelKind';
import { clearLogViewerPrefs } from '@modules/object-panel/components/ObjectPanel/Logs/logViewerPrefsCache';
import { clearContainerLogsStreamScopeParams } from '@modules/object-panel/components/ObjectPanel/Logs/containerLogsStreamScopeParamsCache';

/**
 * Evict every scoped-domain entry that belongs to a single object panel.
 *
 * The five scopes (object-details, object-events, object-yaml,
 * object-helm-manifest, object-helm-values, container-logs) live in the
 * global refresh store keyed by cluster-prefixed scope strings, so an
 * unmount alone does NOT free them — that's deliberate, so a transient
 * unmount caused by a cluster switch can render from cache on the way
 * back. The cache should only be freed when the user actually closes
 * the panel for good, which is what this helper enforces.
 */
const evictPanelScopes = (ref: KubernetesObjectReference): void => {
  const { detailScope, eventsScope, containerLogsScope, mapScope, helmScope } =
    getObjectPanelKind(ref);
  if (detailScope) {
    refreshOrchestrator.resetScopedDomain('object-details', detailScope);
    refreshOrchestrator.resetScopedDomain('object-yaml', detailScope);
  }
  if (eventsScope) {
    refreshOrchestrator.resetScopedDomain('object-events', eventsScope);
  }
  if (containerLogsScope) {
    refreshOrchestrator.resetScopedDomain('container-logs', containerLogsScope);
    clearContainerLogsStreamScopeParams(containerLogsScope);
  }
  if (mapScope) {
    refreshOrchestrator.resetScopedDomain('object-map', mapScope);
  }
  if (helmScope) {
    refreshOrchestrator.resetScopedDomain('object-helm-manifest', helmScope);
    refreshOrchestrator.resetScopedDomain('object-helm-values', helmScope);
  }
};

/**
 * Generate a stable, unique panel ID from a Kubernetes object reference.
 *
 * When the ref carries group and version (new, GVK-aware path), the id
 * format is:
 *   obj:{clusterId}:{group}/{version}/{kind}:{namespace}:{name}
 *
 * When the ref is kind-only (legacy path, no group/version), the id
 * format is:
 *   obj:{clusterId}:{kind}:{namespace}:{name}
 *
 * The split format is deliberate: two DBInstance objects from different
 * CRD groups now get different panel ids and can coexist, but built-in
 * resources and any caller that hasn't been migrated to pass group/version
 * still produces the exact same id as before so persisted panel state and
 * focus tracking are unaffected.
 */
export function objectPanelId(ref: KubernetesObjectReference): string {
  const c = ref.clusterId?.trim() ?? '';
  const k = (ref.kind ?? '').toLowerCase();
  const ns = ref.namespace?.trim() ?? '_';
  const n = ref.name?.trim() ?? '';
  const group = ref.group?.trim() ?? '';
  const version = ref.version?.trim() ?? '';

  // Only include the GVK segment when the caller supplied a version — we
  // treat "has version" as the signal that the ref is GVK-aware. An empty
  // group with a version (e.g. core/v1) still gets the GVK form, encoded
  // as "/v1/" so the id is still parseable.
  if (version) {
    return `obj:${c}:${group}/${version}/${k}:${ns}:${n}`;
  }
  return `obj:${c}:${k}:${ns}:${n}`;
}

interface ObjectPanelState {
  // Map of panelId → objectRef for all open object panels
  openPanels: Map<string, KubernetesObjectReference>;
  // Map of panelId → which sub-tab (Details/YAML/Events/etc.) is active
  // for that panel. Lifted out of ObjectPanel's useReducer so the active
  // sub-tab survives cluster switches: ObjectPanel components unmount
  // when the cluster switches away (because openPanels is per-cluster
  // and AppLayout iterates the active cluster's slice), so any
  // useReducer state inside the panel is lost on remount. Persisting
  // the activeTab here means switching back restores the same sub-tab.
  activeTabs: Map<string, ViewType>;
}

const DEFAULT_OBJECT_PANEL_STATE: ObjectPanelState = {
  openPanels: new Map(),
  activeTabs: new Map(),
};

interface ObjectPanelStateContextType {
  // Derived: true if any object panel is open
  showObjectPanel: boolean;
  // The full map of open panels
  openPanels: Map<string, KubernetesObjectReference>;

  // Open/activate a panel for the given object reference.
  // If the object is already open, activates the existing tab.
  // Returns the panelId for the object.
  onRowClick: (data: KubernetesObjectReference) => string;

  // Close a single object panel by its panelId.
  closePanel: (panelId: string) => void;

  // Close all object panels (backward compat).
  onCloseObjectPanel: () => void;

  // When set to false, closes all panels.
  setShowObjectPanel: (show: boolean) => void;

  // Hydrate cluster metadata onto an object reference.
  hydrateClusterMeta: (data: KubernetesObjectReference) => KubernetesObjectReference;

  /**
   * Read the persisted active sub-tab for an object panel. Returns
   * undefined if no tab has been explicitly set; the panel can fall
   * back to its own default in that case.
   */
  getObjectPanelActiveTab: (panelId: string) => ViewType | undefined;

  /**
   * Persist the active sub-tab for an object panel into the active
   * cluster's slice. Survives unmount/remount cycles caused by cluster
   * switching.
   */
  setObjectPanelActiveTab: (panelId: string, tab: ViewType) => void;
}

const ObjectPanelStateContext = createContext<ObjectPanelStateContextType | undefined>(undefined);

export const useObjectPanelState = () => {
  const context = useContext(ObjectPanelStateContext);
  if (!context) {
    throw new Error('useObjectPanelState must be used within ObjectPanelStateProvider');
  }
  return context;
};

interface ObjectPanelStateProviderProps {
  children: React.ReactNode;
}

const EMPTY_CLUSTER_IDS: string[] = [];

export const ObjectPanelStateProvider: React.FC<ObjectPanelStateProviderProps> = ({ children }) => {
  const { selectedClusterId, selectedClusterName, selectedClusterIds } = useKubeconfig();
  // Ensure a stable fallback array when kubeconfig mocks omit selectedClusterIds.
  const activeClusterIds = selectedClusterIds ?? EMPTY_CLUSTER_IDS;
  // Keep object panel state scoped per cluster tab to avoid cross-tab state leakage.
  const [objectPanelStateByCluster, setObjectPanelStateByCluster] = useState<
    Record<string, ObjectPanelState>
  >({});
  const clusterKey = selectedClusterId || '__default__';
  const activeState = objectPanelStateByCluster[clusterKey] ?? DEFAULT_OBJECT_PANEL_STATE;
  const { openPanels } = activeState;
  const showObjectPanel = openPanels.size > 0;

  const updateActiveState = useCallback(
    (updater: (prev: ObjectPanelState) => ObjectPanelState) => {
      setObjectPanelStateByCluster((prev) => {
        const current = prev[clusterKey] ?? DEFAULT_OBJECT_PANEL_STATE;
        const next = updater(current);
        return {
          ...prev,
          [clusterKey]: next,
        };
      });
    },
    [clusterKey]
  );

  // Clean up state for removed cluster tabs.
  useEffect(() => {
    setObjectPanelStateByCluster((prev) => {
      const allowed = new Set(activeClusterIds);
      // Free the global refresh-store entries AND the LogViewer prefs
      // cache for any panels in clusters that are about to be dropped —
      // those panels will never remount, so their cached scopes and
      // prefs would otherwise leak forever.
      Object.entries(prev).forEach(([key, value]) => {
        const keepingThisCluster =
          key === '__default__' || (activeClusterIds.length > 0 && allowed.has(key));
        if (keepingThisCluster) {
          return;
        }
        value.openPanels.forEach((ref, panelId) => {
          evictPanelScopes(ref);
          clearLogViewerPrefs(panelId);
        });
      });
      if (activeClusterIds.length === 0) {
        return prev.__default__ ? { __default__: prev.__default__ } : {};
      }
      const next: Record<string, ObjectPanelState> = {};
      Object.entries(prev).forEach(([key, value]) => {
        if (key === '__default__' || allowed.has(key)) {
          next[key] = value;
        }
      });
      return next;
    });
  }, [activeClusterIds]);

  const hydrateClusterMeta = useCallback(
    (data: KubernetesObjectReference): KubernetesObjectReference => {
      const clusterId = data.clusterId?.trim() || selectedClusterId?.trim() || undefined;
      const clusterName = data.clusterName?.trim() || selectedClusterName?.trim() || undefined;
      // Fill in missing cluster metadata so detail scopes stay aligned to the active tab.
      if (!clusterId && !clusterName) {
        return data;
      }
      return {
        ...data,
        clusterId,
        clusterName,
      };
    },
    [selectedClusterId, selectedClusterName]
  );

  const onRowClick = useCallback(
    (data: KubernetesObjectReference): string => {
      const enriched = hydrateClusterMeta(data);
      const panelId = objectPanelId(enriched);

      updateActiveState((prev) => {
        // If panel already exists, no state change needed (activation handled by dockable system).
        if (prev.openPanels.has(panelId)) {
          return prev;
        }
        // Add new panel to the map.
        const nextPanels = new Map(prev.openPanels);
        nextPanels.set(panelId, enriched);
        return { ...prev, openPanels: nextPanels };
      });

      return panelId;
    },
    [hydrateClusterMeta, updateActiveState]
  );

  const closePanel = useCallback(
    (panelId: string) => {
      updateActiveState((prev) => {
        if (!prev.openPanels.has(panelId) && !prev.activeTabs.has(panelId)) {
          return prev;
        }
        // Evict the global refresh-store entries AND the LogViewer prefs
        // cache for this panel BEFORE removing the ref from openPanels
        // — once the ref is gone we can't compute the scope keys
        // anymore. The unmount destructors in ObjectPanelContent /
        // useObjectPanelRefresh deliberately preserve cached state on
        // unmount so transient unmounts (cluster switches) keep their
        // content; this is the only place that actually frees that
        // cache.
        const ref = prev.openPanels.get(panelId);
        if (ref) {
          evictPanelScopes(ref);
        }
        clearLogViewerPrefs(panelId);
        const nextPanels = new Map(prev.openPanels);
        nextPanels.delete(panelId);
        const nextActiveTabs = new Map(prev.activeTabs);
        nextActiveTabs.delete(panelId);
        return { openPanels: nextPanels, activeTabs: nextActiveTabs };
      });
      // Clear the dockable panel state so reopening gets fresh defaults
      // instead of remembering the old dock position.
      handoffLayoutBeforeClose(panelId);
      clearPanelState(panelId);
    },
    [updateActiveState]
  );

  const onCloseObjectPanel = useCallback(() => {
    // Clear dockable state, scoped-domain caches, AND LogViewer prefs
    // for every open object panel in the active cluster before closing.
    const current = objectPanelStateByCluster[clusterKey] ?? DEFAULT_OBJECT_PANEL_STATE;
    current.openPanels.forEach((ref, panelId) => {
      evictPanelScopes(ref);
      clearLogViewerPrefs(panelId);
      handoffLayoutBeforeClose(panelId);
      clearPanelState(panelId);
    });
    updateActiveState(() => DEFAULT_OBJECT_PANEL_STATE);
  }, [updateActiveState, objectPanelStateByCluster, clusterKey]);

  const getObjectPanelActiveTab = useCallback(
    (panelId: string): ViewType | undefined => {
      return activeState.activeTabs.get(panelId);
    },
    [activeState]
  );

  const setObjectPanelActiveTab = useCallback(
    (panelId: string, tab: ViewType) => {
      updateActiveState((prev) => {
        if (prev.activeTabs.get(panelId) === tab) {
          return prev;
        }
        const nextActiveTabs = new Map(prev.activeTabs);
        nextActiveTabs.set(panelId, tab);
        return { ...prev, activeTabs: nextActiveTabs };
      });
    },
    [updateActiveState]
  );

  const value = useMemo(
    () => ({
      showObjectPanel,
      openPanels,
      onRowClick,
      closePanel,
      onCloseObjectPanel,
      setShowObjectPanel: (show: boolean) => {
        if (!show) {
          // Same eviction path as onCloseObjectPanel — anything else
          // would leak the active cluster's panel scopes.
          onCloseObjectPanel();
        }
      },
      hydrateClusterMeta,
      getObjectPanelActiveTab,
      setObjectPanelActiveTab,
    }),
    [
      showObjectPanel,
      openPanels,
      onRowClick,
      closePanel,
      onCloseObjectPanel,
      hydrateClusterMeta,
      getObjectPanelActiveTab,
      setObjectPanelActiveTab,
    ]
  );

  return (
    <ObjectPanelStateContext.Provider value={value}>{children}</ObjectPanelStateContext.Provider>
  );
};
