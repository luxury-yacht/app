/**
 * frontend/src/core/contexts/SidebarStateContext.tsx
 *
 * Manages sidebar-specific state including visibility, width, and selection.
 * Provides context for components to access and modify sidebar state.
 */
import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

export type SidebarSelectionType =
  | { type: 'cluster'; value: 'cluster' }
  | { type: 'namespace'; value: string }
  | { type: 'overview'; value: 'overview' }
  | null;

interface SidebarStateContextType {
  isSidebarVisible: boolean;
  sidebarWidth: number;
  isResizing: boolean;
  sidebarSelection: SidebarSelectionType;

  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setIsResizing: (resizing: boolean) => void;
  setSidebarSelection: (selection: SidebarSelectionType) => void;
}

const SidebarStateContext = createContext<SidebarStateContextType | undefined>(undefined);

export const useSidebarState = () => {
  const context = useContext(SidebarStateContext);
  if (!context) {
    throw new Error('useSidebarState must be used within SidebarStateProvider');
  }
  return context;
};

interface SidebarStateProviderProps {
  children: React.ReactNode;
}

const DEFAULT_SIDEBAR_SELECTION: SidebarSelectionType = {
  type: 'overview',
  value: 'overview',
};

const canUpdateSidebarVisible = () =>
  typeof window !== 'undefined' && Boolean((window as any).go?.backend?.App?.SetSidebarVisible);

export const SidebarStateProvider: React.FC<SidebarStateProviderProps> = ({ children }) => {
  const { selectedClusterId, selectedClusterIds } = useKubeconfig();
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarSelections, setSidebarSelections] = useState<Record<string, SidebarSelectionType>>(
    {}
  );
  const clusterKey = selectedClusterId || '__default__';
  const sidebarSelection = useMemo(
    () => sidebarSelections[clusterKey] ?? DEFAULT_SIDEBAR_SELECTION,
    [sidebarSelections, clusterKey]
  );

  // Sync sidebar state with backend on mount and changes
  useEffect(() => {
    if (!canUpdateSidebarVisible()) {
      return;
    }
    import('@wailsjs/go/backend/App').then(({ SetSidebarVisible }) => {
      SetSidebarVisible(isSidebarVisible);
    });
  }, [isSidebarVisible]);

  const toggleSidebar = useCallback(() => {
    setIsSidebarVisible((prev) => {
      const newState = !prev;
      if (canUpdateSidebarVisible()) {
        import('@wailsjs/go/backend/App').then(({ SetSidebarVisible }) => {
          SetSidebarVisible(newState);
        });
      }
      return newState;
    });
  }, []);

  useEffect(() => {
    setSidebarSelections((prev) => {
      if (selectedClusterIds.length === 0) {
        return prev.__default__ ? { __default__: prev.__default__ } : {};
      }
      const allowed = new Set(selectedClusterIds);
      const next: Record<string, SidebarSelectionType> = {};
      Object.entries(prev).forEach(([key, value]) => {
        if (key === '__default__' || allowed.has(key)) {
          next[key] = value;
        }
      });
      return next;
    });
  }, [selectedClusterIds]);

  const value = useMemo(
    () => ({
      isSidebarVisible,
      sidebarWidth,
      isResizing,
      sidebarSelection,
      toggleSidebar,
      setSidebarWidth,
      setIsResizing,
      setSidebarSelection: (selection: SidebarSelectionType) => {
        setSidebarSelections((prev) => ({
          ...prev,
          [clusterKey]: selection,
        }));
      },
    }),
    [isSidebarVisible, sidebarWidth, isResizing, sidebarSelection, toggleSidebar, clusterKey]
  );

  return <SidebarStateContext.Provider value={value}>{children}</SidebarStateContext.Provider>;
};
