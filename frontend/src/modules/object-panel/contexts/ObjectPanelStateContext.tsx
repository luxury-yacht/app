/**
 * frontend/src/modules/object-panel/contexts/ObjectPanelStateContext.tsx
 *
 * Owns object-panel tab state across the app: open object refs, active tabs,
 * canonical panel IDs, and full cache eviction when a panel is closed.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { clearContainerLogsStreamScopeParams } from '@modules/object-panel/components/ObjectPanel/Logs/containerLogsStreamScopeParamsCache';
import { clearLogViewerPrefs } from '@modules/object-panel/components/ObjectPanel/Logs/logViewerPrefsCache';
import type { ViewType } from '@modules/object-panel/components/ObjectPanel/types';
import {
  buildObjectPanelRef,
  getObjectPanelScopeEvictions,
  type ObjectPanelRef,
  objectPanelId,
} from '@modules/object-panel/objectPanelRef';
import { clearPanelState, handoffLayoutBeforeClose } from '@ui/dockable/useDockablePanelState';
import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { panelwindow } from '@/core/backend-api/models';
import { resetRefreshDomain } from '@/core/data-access';
import type { KubernetesObjectReference } from '@/types/view-state';

export { objectPanelId } from '@modules/object-panel/objectPanelRef';

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
const evictPanelScopes = (ref: ObjectPanelRef): void => {
  getObjectPanelScopeEvictions(ref).forEach(({ domain, scope }) => {
    resetRefreshDomain(domain, scope);
    if (domain === 'container-logs') {
      clearContainerLogsStreamScopeParams(scope);
    }
  });
};

interface ObjectPanelState {
  // Map of panelId → objectRef for all open object panels
  openPanels: Map<string, ObjectPanelRef>;
  // Map of panelId → which sub-tab (Details/YAML/Events/etc.) is active
  // for that panel. Lifted out of ObjectPanel's useReducer so the active
  // sub-tab survives cluster switches: ObjectPanel components unmount
  // when the cluster switches away (because openPanels is per-cluster
  // and AppLayout iterates the active cluster's slice), so any
  // useReducer state inside the panel is lost on remount. Persisting
  // the activeTab here means switching back restores the same sub-tab.
  activeTabs: Map<string, ViewType>;
  nativeLocations: Map<string, { windowName: string; groupId: string }>;
  dockedEdges: Map<string, 'right' | 'bottom'>;
}

const DEFAULT_OBJECT_PANEL_STATE: ObjectPanelState = {
  openPanels: new Map(),
  activeTabs: new Map(),
  nativeLocations: new Map(),
  dockedEdges: new Map(),
};

interface ObjectPanelStateContextType {
  // Derived: true if any object panel is open
  showObjectPanel: boolean;
  // The full map of open panels
  openPanels: Map<string, ObjectPanelRef>;
  nativeLocations: Map<string, { windowName: string; groupId: string }>;
  dockedEdges: Map<string, 'right' | 'bottom'>;

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
   * Persist the active sub-tab for an object panel into the active
   * cluster's slice. Survives unmount/remount cycles caused by cluster
   * switching.
   *
   * Reading the active tab is intentionally NOT on this context — use the
   * reactive useObjectPanelActiveTab hook. Keeping the read separate stops a
   * tab switch from churning this (otherwise stable) value and re-rendering
   * every consumer.
   */
  setObjectPanelActiveTab: (panelId: string, tab: ViewType) => void;
  commitPanelWindow: (snapshot: panelwindow.GroupSnapshot, windowName: string) => void;
  dockPanelWindow: (snapshot: panelwindow.GroupSnapshot, edge: 'right' | 'bottom') => void;
  removePanelWindow: (clusterId: string, windowName: string) => void;
  panelIdsForPanelWindow: (clusterId: string, windowName: string) => string[];
  getOwnedPanel: (
    clusterId: string,
    panelId: string
  ) => {
    objectRef: ObjectPanelRef;
    activeView: ViewType;
    nativeLocation?: { windowName: string; groupId: string };
    dockedEdge?: 'right' | 'bottom';
  } | null;
  upsertOwnedPanel: (
    objectRef: KubernetesObjectReference,
    activeView: ViewType,
    location:
      | { kind: 'docked'; edge: 'right' | 'bottom' }
      | { kind: 'panel-window'; windowName: string; groupId: string }
  ) => string;
  removeOwnedPanel: (clusterId: string, panelId: string) => void;
  panelIdsForCluster: (clusterId: string) => string[];
  nativeWindowNamesForCluster: (clusterId: string) => string[];
  syncPanelWindowSnapshot: (snapshot: panelwindow.GroupSnapshot, windowName: string) => void;
}

const ObjectPanelStateContext = createContext<ObjectPanelStateContextType | undefined>(undefined);

export const useObjectPanelState = () => {
  const context = useContext(ObjectPanelStateContext);
  if (!context) {
    throw new Error('useObjectPanelState must be used within ObjectPanelStateProvider');
  }
  return context;
};

export const useOptionalObjectPanelState = () => useContext(ObjectPanelStateContext);

/**
 * Volatile context carrying only the per-panel active-tab map. Kept separate
 * from ObjectPanelStateContext so switching a panel's sub-tab does not churn
 * the (otherwise stable) main context value and re-render every
 * useObjectPanelState() consumer. Only components that render tab-dependent
 * content subscribe here, via useObjectPanelActiveTab.
 */
const ObjectPanelActiveTabsContext = createContext<Map<string, ViewType>>(
  DEFAULT_OBJECT_PANEL_STATE.activeTabs
);

/**
 * Reactively read the persisted active sub-tab for an object panel. Returns
 * undefined when no tab has been set so the caller can fall back to its own
 * default. Re-renders the caller only when the active-tab map changes.
 */
export const useObjectPanelActiveTab = (panelId: string): ViewType | undefined =>
  useContext(ObjectPanelActiveTabsContext).get(panelId);

export const useObjectPanelActiveTabs = (): Map<string, ViewType> =>
  useContext(ObjectPanelActiveTabsContext);

interface ObjectPanelStateProviderProps {
  children: React.ReactNode;
  initialGroupSnapshot?: panelwindow.GroupSnapshot;
}

const EMPTY_CLUSTER_IDS: string[] = [];

const stateFromGroupSnapshot = (
  snapshot: panelwindow.GroupSnapshot | undefined
): Record<string, ObjectPanelState> => {
  if (!snapshot) {
    return {};
  }
  const openPanels = new Map<string, ObjectPanelRef>();
  const activeTabs = new Map<string, ViewType>();
  for (const tab of snapshot.tabs ?? []) {
    openPanels.set(
      tab.panelId,
      buildObjectPanelRef(tab.objectRef as unknown as KubernetesObjectReference)
    );
    activeTabs.set(tab.panelId, tab.activeView as ViewType);
  }
  return {
    [snapshot.clusterId]: {
      openPanels,
      activeTabs,
      nativeLocations: new Map(),
      dockedEdges: new Map(),
    },
  };
};

export const ObjectPanelStateProvider: React.FC<ObjectPanelStateProviderProps> = ({
  children,
  initialGroupSnapshot,
}) => {
  const { selectedClusterId, selectedClusterName, selectedClusterIds } = useKubeconfig();
  // Ensure a stable fallback array when kubeconfig mocks omit selectedClusterIds.
  const activeClusterIds = selectedClusterIds ?? EMPTY_CLUSTER_IDS;
  // Keep object panel state scoped per cluster tab to avoid cross-tab state leakage.
  const [objectPanelStateByCluster, setObjectPanelStateByCluster] = useState<
    Record<string, ObjectPanelState>
  >(() => stateFromGroupSnapshot(initialGroupSnapshot));
  const clusterKey = selectedClusterId || '__default__';
  const activeState = objectPanelStateByCluster[clusterKey] ?? DEFAULT_OBJECT_PANEL_STATE;
  const { openPanels } = activeState;
  const { nativeLocations } = activeState;
  const { dockedEdges } = activeState;
  const showObjectPanel = Array.from(openPanels.keys()).some(
    (panelId) => !nativeLocations.has(panelId)
  );

  // Mirror the per-cluster state in a ref so imperative callbacks (e.g.
  // onCloseObjectPanel) can read the current slice without depending on
  // objectPanelStateByCluster — that dependency would rebuild the callback,
  // and therefore the whole context value, on every tab switch.
  const stateByClusterRef = useRef(objectPanelStateByCluster);
  stateByClusterRef.current = objectPanelStateByCluster;

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
      Object.entries(prev).forEach(([key, storedValue]) => {
        const keepingThisCluster =
          key === '__default__' || (activeClusterIds.length > 0 && allowed.has(key));
        if (keepingThisCluster) {
          return;
        }
        storedValue.openPanels.forEach((ref, panelId) => {
          evictPanelScopes(ref);
          clearLogViewerPrefs(panelId);
        });
      });
      if (activeClusterIds.length === 0) {
        return prev.__default__ ? { __default__: prev.__default__ } : {};
      }
      const next: Record<string, ObjectPanelState> = {};
      Object.entries(prev).forEach(([key, storedValue]) => {
        if (key === '__default__' || allowed.has(key)) {
          next[key] = storedValue;
        }
      });
      return next;
    });
  }, [activeClusterIds]);

  const hydrateClusterMeta = useCallback(
    (data: KubernetesObjectReference): KubernetesObjectReference => {
      const clusterId = data.clusterId?.trim() || undefined;
      const clusterName =
        data.clusterName?.trim() ||
        (clusterId && clusterId === selectedClusterId?.trim()
          ? selectedClusterName?.trim() || undefined
          : undefined);
      if (clusterId === data.clusterId && clusterName === data.clusterName) {
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
      const panelRef = buildObjectPanelRef(enriched);
      const panelId = objectPanelId(panelRef);

      updateActiveState((prev) => {
        // If panel already exists, no state change needed (activation handled by dockable system).
        if (prev.openPanels.has(panelId)) {
          return prev;
        }
        // Add new panel to the map.
        const nextPanels = new Map(prev.openPanels);
        nextPanels.set(panelId, panelRef);
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
        const nextNativeLocations = new Map(prev.nativeLocations);
        const nextDockedEdges = new Map(prev.dockedEdges);
        nextNativeLocations.delete(panelId);
        nextDockedEdges.delete(panelId);
        return {
          openPanels: nextPanels,
          activeTabs: nextActiveTabs,
          nativeLocations: nextNativeLocations,
          dockedEdges: nextDockedEdges,
        };
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
    const current = stateByClusterRef.current[clusterKey] ?? DEFAULT_OBJECT_PANEL_STATE;
    current.openPanels.forEach((ref, panelId) => {
      evictPanelScopes(ref);
      clearLogViewerPrefs(panelId);
      handoffLayoutBeforeClose(panelId);
      clearPanelState(panelId);
    });
    updateActiveState(() => DEFAULT_OBJECT_PANEL_STATE);
  }, [updateActiveState, clusterKey]);

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

  const commitPanelWindow = useCallback(
    (snapshot: panelwindow.GroupSnapshot, windowName: string) => {
      if (snapshot.clusterId !== selectedClusterId) {
        setObjectPanelStateByCluster((previous) => {
          const current = previous[snapshot.clusterId] ?? DEFAULT_OBJECT_PANEL_STATE;
          const nextNativeLocations = new Map(current.nativeLocations);
          const nextDockedEdges = new Map(current.dockedEdges);
          for (const tab of snapshot.tabs ?? []) {
            nextNativeLocations.set(tab.panelId, { windowName, groupId: snapshot.groupId });
            nextDockedEdges.delete(tab.panelId);
          }
          return {
            ...previous,
            [snapshot.clusterId]: {
              ...current,
              nativeLocations: nextNativeLocations,
              dockedEdges: nextDockedEdges,
            },
          };
        });
        return;
      }
      updateActiveState((previous) => {
        const nextNativeLocations = new Map(previous.nativeLocations);
        const nextDockedEdges = new Map(previous.dockedEdges);
        for (const tab of snapshot.tabs ?? []) {
          nextNativeLocations.set(tab.panelId, { windowName, groupId: snapshot.groupId });
          nextDockedEdges.delete(tab.panelId);
        }
        return {
          ...previous,
          nativeLocations: nextNativeLocations,
          dockedEdges: nextDockedEdges,
        };
      });
    },
    [selectedClusterId, updateActiveState]
  );

  const dockPanelWindow = useCallback(
    (snapshot: panelwindow.GroupSnapshot, edge: 'right' | 'bottom') => {
      setObjectPanelStateByCluster((previous) => {
        const current = previous[snapshot.clusterId] ?? DEFAULT_OBJECT_PANEL_STATE;
        const nextPanels = new Map(current.openPanels);
        const nextActiveTabs = new Map(current.activeTabs);
        const nextNativeLocations = new Map(current.nativeLocations);
        const nextDockedEdges = new Map(current.dockedEdges);
        for (const tab of snapshot.tabs ?? []) {
          nextPanels.set(
            tab.panelId,
            buildObjectPanelRef(tab.objectRef as unknown as KubernetesObjectReference)
          );
          nextActiveTabs.set(tab.panelId, tab.activeView as ViewType);
          nextNativeLocations.delete(tab.panelId);
          nextDockedEdges.set(tab.panelId, edge);
        }
        return {
          ...previous,
          [snapshot.clusterId]: {
            openPanels: nextPanels,
            activeTabs: nextActiveTabs,
            nativeLocations: nextNativeLocations,
            dockedEdges: nextDockedEdges,
          },
        };
      });
    },
    []
  );

  const removePanelWindow = useCallback((clusterId: string, windowName: string) => {
    setObjectPanelStateByCluster((previous) => {
      const current = previous[clusterId];
      if (!current) {
        return previous;
      }
      const removedPanelIds = Array.from(current.nativeLocations.entries())
        .filter(([, location]) => location.windowName === windowName)
        .map(([panelId]) => panelId);
      if (removedPanelIds.length === 0) {
        return previous;
      }
      const nextOpenPanels = new Map(current.openPanels);
      const nextActiveTabs = new Map(current.activeTabs);
      const nextNativeLocations = new Map(current.nativeLocations);
      const nextDockedEdges = new Map(current.dockedEdges);
      for (const panelId of removedPanelIds) {
        const ref = nextOpenPanels.get(panelId);
        if (ref) {
          evictPanelScopes(ref);
        }
        clearLogViewerPrefs(panelId);
        nextOpenPanels.delete(panelId);
        nextActiveTabs.delete(panelId);
        nextNativeLocations.delete(panelId);
        nextDockedEdges.delete(panelId);
      }
      return {
        ...previous,
        [clusterId]: {
          openPanels: nextOpenPanels,
          activeTabs: nextActiveTabs,
          nativeLocations: nextNativeLocations,
          dockedEdges: nextDockedEdges,
        },
      };
    });
  }, []);

  const panelIdsForPanelWindow = useCallback(
    (clusterId: string, windowName: string): string[] =>
      Array.from(
        (
          stateByClusterRef.current[clusterId] ?? DEFAULT_OBJECT_PANEL_STATE
        ).nativeLocations.entries()
      )
        .filter(([, location]) => location.windowName === windowName)
        .map(([panelId]) => panelId),
    []
  );

  const getOwnedPanel = useCallback((clusterId: string, panelId: string) => {
    const current = stateByClusterRef.current[clusterId] ?? DEFAULT_OBJECT_PANEL_STATE;
    const objectRef = current.openPanels.get(panelId);
    if (!objectRef) {
      return null;
    }
    return {
      objectRef,
      activeView: current.activeTabs.get(panelId) ?? ('details' as ViewType),
      nativeLocation: current.nativeLocations.get(panelId),
      dockedEdge: current.dockedEdges.get(panelId),
    };
  }, []);

  const upsertOwnedPanel = useCallback(
    (
      data: KubernetesObjectReference,
      activeView: ViewType,
      location:
        | { kind: 'docked'; edge: 'right' | 'bottom' }
        | { kind: 'panel-window'; windowName: string; groupId: string }
    ): string => {
      const panelRef = buildObjectPanelRef(data);
      const panelId = objectPanelId(panelRef);
      setObjectPanelStateByCluster((previous) => {
        const current = previous[panelRef.clusterId] ?? DEFAULT_OBJECT_PANEL_STATE;
        const nextOpenPanels = new Map(current.openPanels);
        const nextActiveTabs = new Map(current.activeTabs);
        const nextNativeLocations = new Map(current.nativeLocations);
        const nextDockedEdges = new Map(current.dockedEdges);
        nextOpenPanels.set(panelId, panelRef);
        nextActiveTabs.set(panelId, activeView);
        if (location.kind === 'panel-window') {
          nextNativeLocations.set(panelId, {
            windowName: location.windowName,
            groupId: location.groupId,
          });
          nextDockedEdges.delete(panelId);
        } else {
          nextNativeLocations.delete(panelId);
          nextDockedEdges.set(panelId, location.edge);
        }
        return {
          ...previous,
          [panelRef.clusterId]: {
            openPanels: nextOpenPanels,
            activeTabs: nextActiveTabs,
            nativeLocations: nextNativeLocations,
            dockedEdges: nextDockedEdges,
          },
        };
      });
      return panelId;
    },
    []
  );

  const removeOwnedPanel = useCallback((clusterId: string, panelId: string) => {
    setObjectPanelStateByCluster((previous) => {
      const current = previous[clusterId];
      if (!current?.openPanels.has(panelId)) {
        return previous;
      }
      const objectRef = current.openPanels.get(panelId);
      if (objectRef) {
        evictPanelScopes(objectRef);
      }
      clearLogViewerPrefs(panelId);
      const nextOpenPanels = new Map(current.openPanels);
      const nextActiveTabs = new Map(current.activeTabs);
      const nextNativeLocations = new Map(current.nativeLocations);
      const nextDockedEdges = new Map(current.dockedEdges);
      nextOpenPanels.delete(panelId);
      nextActiveTabs.delete(panelId);
      nextNativeLocations.delete(panelId);
      nextDockedEdges.delete(panelId);
      return {
        ...previous,
        [clusterId]: {
          openPanels: nextOpenPanels,
          activeTabs: nextActiveTabs,
          nativeLocations: nextNativeLocations,
          dockedEdges: nextDockedEdges,
        },
      };
    });
  }, []);

  const panelIdsForCluster = useCallback(
    (clusterId: string): string[] =>
      Array.from(
        (stateByClusterRef.current[clusterId] ?? DEFAULT_OBJECT_PANEL_STATE).openPanels.keys()
      ),
    []
  );

  const nativeWindowNamesForCluster = useCallback(
    (clusterId: string): string[] =>
      Array.from(
        new Set(
          Array.from(
            (
              stateByClusterRef.current[clusterId] ?? DEFAULT_OBJECT_PANEL_STATE
            ).nativeLocations.values(),
            (location) => location.windowName
          )
        )
      ),
    []
  );

  const syncPanelWindowSnapshot = useCallback(
    (snapshot: panelwindow.GroupSnapshot, windowName: string) => {
      setObjectPanelStateByCluster((previous) => {
        const current = previous[snapshot.clusterId] ?? DEFAULT_OBJECT_PANEL_STATE;
        const incoming = new Set((snapshot.tabs ?? []).map((tab) => tab.panelId));
        const nextOpenPanels = new Map(current.openPanels);
        const nextActiveTabs = new Map(current.activeTabs);
        const nextNativeLocations = new Map(current.nativeLocations);
        const nextDockedEdges = new Map(current.dockedEdges);
        for (const [panelId, location] of current.nativeLocations) {
          if (location.windowName !== windowName || incoming.has(panelId)) {
            continue;
          }
          nextOpenPanels.delete(panelId);
          nextActiveTabs.delete(panelId);
          nextNativeLocations.delete(panelId);
          nextDockedEdges.delete(panelId);
        }
        for (const tab of snapshot.tabs ?? []) {
          nextOpenPanels.set(
            tab.panelId,
            buildObjectPanelRef({ ...tab.objectRef } as KubernetesObjectReference)
          );
          nextActiveTabs.set(tab.panelId, tab.activeView as ViewType);
          nextNativeLocations.set(tab.panelId, { windowName, groupId: snapshot.groupId });
          nextDockedEdges.delete(tab.panelId);
        }
        return {
          ...previous,
          [snapshot.clusterId]: {
            openPanels: nextOpenPanels,
            activeTabs: nextActiveTabs,
            nativeLocations: nextNativeLocations,
            dockedEdges: nextDockedEdges,
          },
        };
      });
    },
    []
  );

  const value = useMemo(
    () => ({
      showObjectPanel,
      openPanels,
      nativeLocations,
      dockedEdges,
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
      setObjectPanelActiveTab,
      commitPanelWindow,
      dockPanelWindow,
      removePanelWindow,
      panelIdsForPanelWindow,
      getOwnedPanel,
      upsertOwnedPanel,
      removeOwnedPanel,
      panelIdsForCluster,
      nativeWindowNamesForCluster,
      syncPanelWindowSnapshot,
    }),
    [
      showObjectPanel,
      openPanels,
      nativeLocations,
      dockedEdges,
      onRowClick,
      closePanel,
      onCloseObjectPanel,
      hydrateClusterMeta,
      setObjectPanelActiveTab,
      commitPanelWindow,
      dockPanelWindow,
      removePanelWindow,
      panelIdsForPanelWindow,
      getOwnedPanel,
      upsertOwnedPanel,
      removeOwnedPanel,
      panelIdsForCluster,
      nativeWindowNamesForCluster,
      syncPanelWindowSnapshot,
    ]
  );

  return (
    <ObjectPanelStateContext.Provider value={value}>
      <ObjectPanelActiveTabsContext.Provider value={activeState.activeTabs}>
        {children}
      </ObjectPanelActiveTabsContext.Provider>
    </ObjectPanelStateContext.Provider>
  );
};
