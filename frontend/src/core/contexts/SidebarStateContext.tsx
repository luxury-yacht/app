/**
 * SidebarStateContext
 *
 * Manages sidebar-specific state including visibility, width, and selection.
 * Split from ViewStateContext to reduce re-render scope.
 */
import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';

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

export const SidebarStateProvider: React.FC<SidebarStateProviderProps> = ({ children }) => {
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarSelection, setSidebarSelection] = useState<SidebarSelectionType>({
    type: 'overview',
    value: 'overview',
  });

  // Sync sidebar state with backend on mount and changes
  useEffect(() => {
    import('@wailsjs/go/backend/App').then(({ SetSidebarVisible }) => {
      SetSidebarVisible(isSidebarVisible);
    });
  }, [isSidebarVisible]);

  const toggleSidebar = useCallback(() => {
    setIsSidebarVisible((prev) => {
      const newState = !prev;
      import('@wailsjs/go/backend/App').then(({ SetSidebarVisible }) => {
        SetSidebarVisible(newState);
      });
      return newState;
    });
  }, []);

  const value = useMemo(
    () => ({
      isSidebarVisible,
      sidebarWidth,
      isResizing,
      sidebarSelection,
      toggleSidebar,
      setSidebarWidth,
      setIsResizing,
      setSidebarSelection,
    }),
    [isSidebarVisible, sidebarWidth, isResizing, sidebarSelection, toggleSidebar]
  );

  return <SidebarStateContext.Provider value={value}>{children}</SidebarStateContext.Provider>;
};
