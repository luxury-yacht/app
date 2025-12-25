/**
 * frontend/src/core/contexts/ObjectPanelStateContext.tsx
 *
 * Manages object panel state including visibility, selected object, and navigation history.
 * Provides context for components to access and modify object panel state.
 */
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { KubernetesObjectReference, NavigationHistoryEntry } from '@/types/view-state';

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

export const ObjectPanelStateProvider: React.FC<ObjectPanelStateProviderProps> = ({ children }) => {
  const [showObjectPanel, setShowObjectPanel] = useState(false);
  const [selectedObject, setSelectedObject] = useState<KubernetesObjectReference | null>(null);
  const [navigationHistory, setNavigationHistory] = useState<NavigationHistoryEntry[]>([]);
  const [navigationIndex, setNavigationIndex] = useState(-1);

  const onRowClick = useCallback(
    (data: KubernetesObjectReference) => {
      setSelectedObject(data);
      setShowObjectPanel(true);

      // Add to navigation history
      setNavigationHistory((prev) => {
        const newHistory = [...prev.slice(0, navigationIndex + 1), data];
        setNavigationIndex(newHistory.length - 1);
        return newHistory;
      });
    },
    [navigationIndex]
  );

  const onCloseObjectPanel = useCallback(() => {
    setShowObjectPanel(false);
    setSelectedObject(null);
    setNavigationHistory([]);
    setNavigationIndex(-1);
  }, []);

  const onNavigate = useCallback(
    (index: number) => {
      if (index >= 0 && index < navigationHistory.length) {
        setNavigationIndex(index);
        setSelectedObject(navigationHistory[index]);
      }
    },
    [navigationHistory]
  );

  const value = useMemo(
    () => ({
      showObjectPanel,
      selectedObject,
      navigationHistory,
      navigationIndex,
      setShowObjectPanel,
      setSelectedObject,
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
    ]
  );

  return (
    <ObjectPanelStateContext.Provider value={value}>{children}</ObjectPanelStateContext.Provider>
  );
};
