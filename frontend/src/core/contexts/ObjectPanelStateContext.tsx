/**
 * frontend/src/core/contexts/ObjectPanelStateContext.tsx
 *
 * Manages object panel state for multi-tab object panels.
 * Each opened object gets its own tab with a unique panelId derived from its identity.
 * Provides context for components to open, close, and track open object panels.
 */
import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import type { KubernetesObjectReference } from '@/types/view-state';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

/**
 * Generate a stable, unique panel ID from a Kubernetes object reference.
 * Format: obj:{clusterId}:{kind}:{namespace}:{name}
 */
export function objectPanelId(ref: KubernetesObjectReference): string {
  const c = ref.clusterId?.trim() ?? '';
  const k = (ref.kind ?? '').toLowerCase();
  const ns = ref.namespace?.trim() ?? '_';
  const n = ref.name?.trim() ?? '';
  return `obj:${c}:${k}:${ns}:${n}`;
}

interface ObjectPanelState {
  // Map of panelId → objectRef for all open object panels
  openPanels: Map<string, KubernetesObjectReference>;
}

const DEFAULT_OBJECT_PANEL_STATE: ObjectPanelState = {
  openPanels: new Map(),
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
      if (activeClusterIds.length === 0) {
        return prev.__default__ ? { __default__: prev.__default__ } : {};
      }
      const allowed = new Set(activeClusterIds);
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
        return { openPanels: nextPanels };
      });

      return panelId;
    },
    [hydrateClusterMeta, updateActiveState]
  );

  const closePanel = useCallback(
    (panelId: string) => {
      updateActiveState((prev) => {
        if (!prev.openPanels.has(panelId)) {
          return prev;
        }
        const nextPanels = new Map(prev.openPanels);
        nextPanels.delete(panelId);
        return { openPanels: nextPanels };
      });
    },
    [updateActiveState]
  );

  const onCloseObjectPanel = useCallback(() => {
    updateActiveState(() => DEFAULT_OBJECT_PANEL_STATE);
  }, [updateActiveState]);

  const value = useMemo(
    () => ({
      showObjectPanel,
      openPanels,
      onRowClick,
      closePanel,
      onCloseObjectPanel,
      setShowObjectPanel: (show: boolean) => {
        if (!show) {
          updateActiveState(() => DEFAULT_OBJECT_PANEL_STATE);
        }
      },
      hydrateClusterMeta,
    }),
    [
      showObjectPanel,
      openPanels,
      onRowClick,
      closePanel,
      onCloseObjectPanel,
      hydrateClusterMeta,
      updateActiveState,
    ]
  );

  return (
    <ObjectPanelStateContext.Provider value={value}>{children}</ObjectPanelStateContext.Provider>
  );
};
