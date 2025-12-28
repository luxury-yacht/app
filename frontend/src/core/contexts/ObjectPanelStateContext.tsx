/**
 * frontend/src/core/contexts/ObjectPanelStateContext.tsx
 *
 * Manages object panel state including visibility, selected object, and navigation history.
 * Provides context for components to access and modify object panel state.
 */
import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import type { KubernetesObjectReference, NavigationHistoryEntry } from '@/types/view-state';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

interface ObjectPanelState {
  showObjectPanel: boolean;
  selectedObject: KubernetesObjectReference | null;
  navigationHistory: NavigationHistoryEntry[];
  navigationIndex: number;
}

const DEFAULT_OBJECT_PANEL_STATE: ObjectPanelState = {
  showObjectPanel: false,
  selectedObject: null,
  navigationHistory: [],
  navigationIndex: -1,
};

interface ObjectPanelStateContextType {
  showObjectPanel: boolean;
  selectedObject: KubernetesObjectReference | null;
  navigationHistory: NavigationHistoryEntry[];
  navigationIndex: number;

  setShowObjectPanel: (show: boolean) => void;
  setSelectedObject: (obj: KubernetesObjectReference | null) => void;
  onRowClick: (data: KubernetesObjectReference) => void;
  onCloseObjectPanel: () => void;
  onNavigate: (index: number) => void;
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
  const { selectedClusterId, selectedClusterIds } = useKubeconfig();
  // Ensure a stable fallback array when kubeconfig mocks omit selectedClusterIds.
  const activeClusterIds = selectedClusterIds ?? EMPTY_CLUSTER_IDS;
  // Keep object panel state scoped per cluster tab to avoid cross-tab state leakage.
  const [objectPanelStateByCluster, setObjectPanelStateByCluster] = useState<
    Record<string, ObjectPanelState>
  >({});
  const clusterKey = selectedClusterId || '__default__';
  const activeState = objectPanelStateByCluster[clusterKey] ?? DEFAULT_OBJECT_PANEL_STATE;
  const { showObjectPanel, selectedObject, navigationHistory, navigationIndex } = activeState;

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

  const onRowClick = useCallback(
    (data: KubernetesObjectReference) => {
      updateActiveState((prev) => {
        const nextHistory = [...prev.navigationHistory.slice(0, prev.navigationIndex + 1), data];
        return {
          showObjectPanel: true,
          selectedObject: data,
          navigationHistory: nextHistory,
          navigationIndex: nextHistory.length - 1,
        };
      });
    },
    [updateActiveState]
  );

  const onCloseObjectPanel = useCallback(() => {
    updateActiveState(() => DEFAULT_OBJECT_PANEL_STATE);
  }, [updateActiveState]);

  const onNavigate = useCallback(
    (index: number) => {
      if (index >= 0 && index < navigationHistory.length) {
        updateActiveState((prev) => ({
          ...prev,
          navigationIndex: index,
          selectedObject: prev.navigationHistory[index] ?? null,
        }));
      }
    },
    [navigationHistory, updateActiveState]
  );

  const value = useMemo(
    () => ({
      showObjectPanel,
      selectedObject,
      navigationHistory,
      navigationIndex,
      setShowObjectPanel: (show: boolean) => {
        updateActiveState((prev) => ({ ...prev, showObjectPanel: show }));
      },
      setSelectedObject: (obj: KubernetesObjectReference | null) => {
        updateActiveState((prev) => ({ ...prev, selectedObject: obj }));
      },
      onRowClick,
      onCloseObjectPanel,
      onNavigate,
    }),
    [
      showObjectPanel,
      selectedObject,
      navigationHistory,
      navigationIndex,
      onRowClick,
      onCloseObjectPanel,
      onNavigate,
      updateActiveState,
    ]
  );

  return (
    <ObjectPanelStateContext.Provider value={value}>{children}</ObjectPanelStateContext.Provider>
  );
};
