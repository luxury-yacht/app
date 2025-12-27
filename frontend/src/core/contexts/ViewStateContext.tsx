/**
 * frontend/src/core/contexts/ViewStateContext.tsx
 *
 * Unified view state management. Composes specialized contexts for:
 * - Sidebar state (SidebarStateContext)
 * - Object panel state (ObjectPanelStateContext)
 * - Modal state (ModalStateContext)
 * - Navigation state (view type, tabs, navigation actions)
 *
 * This context manages core view/navigation state and provides a unified
 * useViewState() hook for backwards compatibility.
 *
 * For better performance, use the specialized hooks directly:
 * - useSidebarState() - sidebar visibility, width, selection
 * - useObjectPanelState() - object panel, navigation history
 * - useModalState() - settings and about modals
 */
import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import type { ViewType, NamespaceViewType, ClusterViewType } from '@/types/navigation/views';
import { getObjectKind, getObjectName, getObjectNamespace } from '@/types/view-state';
import { refreshOrchestrator } from '@/core/refresh';
import { eventBus } from '@/core/events';

// Import specialized contexts
import { SidebarStateProvider, useSidebarState } from './SidebarStateContext';
import { ObjectPanelStateProvider, useObjectPanelState } from './ObjectPanelStateContext';
import { ModalStateProvider, useModalState } from './ModalStateContext';

// Re-export types for backwards compatibility
export type { ViewType, NamespaceViewType, ClusterViewType };
export type { KubernetesObjectReference, NavigationHistoryEntry } from '@/types/view-state';
export type { SidebarSelectionType } from './SidebarStateContext';

/**
 * Navigation state - core view type and tab management
 */
interface NavigationStateContextType {
  viewType: ViewType;
  previousView: ViewType;
  activeNamespaceTab: NamespaceViewType;
  activeClusterTab: ClusterViewType | null;

  setViewType: (view: ViewType) => void;
  setPreviousView: (view: ViewType) => void;
  setActiveNamespaceTab: (tab: NamespaceViewType) => void;
  setActiveClusterView: (tab: ClusterViewType | null) => void;

  // Complex navigation actions
  navigateToClusterView: (viewType: ViewType) => void;
  navigateToNamespace: () => void;
  onNamespaceSelect: (namespace: string) => void;
  onClusterObjectsClick: () => void;
}

const NavigationStateContext = createContext<NavigationStateContextType | undefined>(undefined);

const useNavigationState = () => {
  const context = useContext(NavigationStateContext);
  if (!context) {
    throw new Error('useNavigationState must be used within NavigationStateProvider');
  }
  return context;
};

interface NavigationStateProviderProps {
  children: React.ReactNode;
}

const NavigationStateProvider: React.FC<NavigationStateProviderProps> = ({ children }) => {
  const [viewType, setViewTypeState] = useState<ViewType>('overview');
  const [previousView, setPreviousView] = useState<ViewType>('overview');
  const [activeNamespaceView, setActiveNamespaceView] = useState<NamespaceViewType>('workloads');
  const [activeClusterView, setActiveClusterViewState] = useState<ClusterViewType | null>(null);

  // Get sidebar state for navigation actions
  const { setSidebarSelection } = useSidebarState();

  // Enhanced setViewType that notifies RefreshManager
  const setViewType = useCallback(
    (view: ViewType) => {
      const viewIsChanging = view !== viewType;
      setViewTypeState(view);

      refreshOrchestrator.updateContext({ currentView: view });

      if (viewIsChanging) {
        void refreshOrchestrator.triggerManualRefreshForContext();
      }
    },
    [viewType]
  );

  const setActiveClusterView = useCallback((tab: ClusterViewType | null) => {
    setActiveClusterViewState(tab);
    refreshOrchestrator.updateContext({
      activeClusterView: tab ?? undefined,
    });
  }, []);

  // Complex navigation actions
  const navigateToClusterView = useCallback(
    (view: ViewType) => {
      setPreviousView(viewType);
      setViewType(view);
    },
    [viewType, setViewType]
  );

  const navigateToNamespace = useCallback(() => {
    setPreviousView(viewType);
    setViewType('namespace');
  }, [viewType, setViewType]);

  const onNamespaceSelect = useCallback(
    (namespace: string) => {
      setViewType('namespace');
      setSidebarSelection({ type: 'namespace', value: namespace });

      // Default to objects if coming from a non-namespace view
      const tabToUse = viewType === 'namespace' ? activeNamespaceView : 'objects';
      setActiveNamespaceView(tabToUse);
    },
    [setViewType, viewType, activeNamespaceView, setSidebarSelection]
  );

  const onClusterObjectsClick = useCallback(() => {
    navigateToClusterView('cluster' as ViewType);
    setSidebarSelection({ type: 'cluster', value: 'cluster' });
  }, [navigateToClusterView, setSidebarSelection]);

  // Listen for reset-views event
  useEffect(() => {
    const handleResetViews = () => {
      setViewType('overview');
      setPreviousView('overview');
      setSidebarSelection({ type: 'overview', value: 'overview' });
      setActiveNamespaceView('workloads');
      setActiveClusterView(null);
    };

    return eventBus.on('view:reset', handleResetViews);
  }, [setActiveClusterView, setViewType, setSidebarSelection]);

  const value = useMemo(
    () => ({
      viewType,
      previousView,
      activeNamespaceTab: activeNamespaceView,
      activeClusterTab: activeClusterView,
      setViewType,
      setPreviousView,
      setActiveNamespaceTab: setActiveNamespaceView,
      setActiveClusterView,
      navigateToClusterView,
      navigateToNamespace,
      onNamespaceSelect,
      onClusterObjectsClick,
    }),
    [
      viewType,
      previousView,
      activeNamespaceView,
      activeClusterView,
      setViewType,
      setActiveClusterView,
      navigateToClusterView,
      navigateToNamespace,
      onNamespaceSelect,
      onClusterObjectsClick,
    ]
  );

  return (
    <NavigationStateContext.Provider value={value}>{children}</NavigationStateContext.Provider>
  );
};

/**
 * Sync context - synchronizes object panel state with RefreshManager
 */
const RefreshSyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { viewType, activeNamespaceTab, activeClusterTab } = useNavigationState();
  const { showObjectPanel, selectedObject } = useObjectPanelState();

  // Single writer for view/object-panel refresh context updates.
  useEffect(() => {
    refreshOrchestrator.updateContext({
      currentView: viewType,
      activeNamespaceView: activeNamespaceTab,
      activeClusterView: activeClusterTab ?? undefined,
      objectPanel: {
        isOpen: showObjectPanel,
        objectKind: getObjectKind(selectedObject),
        objectName: getObjectName(selectedObject),
        objectNamespace: getObjectNamespace(selectedObject),
      },
    });
  }, [viewType, activeNamespaceTab, activeClusterTab, showObjectPanel, selectedObject]);

  return <>{children}</>;
};

/**
 * Unified ViewStateContext for backwards compatibility
 * Combines all specialized contexts into a single interface
 */
interface ViewStateContextType
  extends
    NavigationStateContextType,
    ReturnType<typeof useSidebarState>,
    ReturnType<typeof useObjectPanelState>,
    ReturnType<typeof useModalState> {}

const ViewStateContext = createContext<ViewStateContextType | undefined>(undefined);

/**
 * Unified hook for backwards compatibility.
 * For better performance, consider using specialized hooks:
 * - useSidebarState()
 * - useObjectPanelState()
 * - useModalState()
 */
export const useViewState = () => {
  const context = useContext(ViewStateContext);
  if (!context) {
    throw new Error('useViewState must be used within ViewStateProvider');
  }
  return context;
};

/**
 * Internal provider that combines all contexts
 */
const CombinedViewStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigationState = useNavigationState();
  const sidebarState = useSidebarState();
  const objectPanelState = useObjectPanelState();
  const modalState = useModalState();

  const combinedValue = useMemo(
    () => ({
      ...navigationState,
      ...sidebarState,
      ...objectPanelState,
      ...modalState,
    }),
    [navigationState, sidebarState, objectPanelState, modalState]
  );

  return <ViewStateContext.Provider value={combinedValue}>{children}</ViewStateContext.Provider>;
};

interface ViewStateProviderProps {
  children: React.ReactNode;
}

/**
 * Main ViewStateProvider that composes all specialized providers
 */
export const ViewStateProvider: React.FC<ViewStateProviderProps> = ({ children }) => {
  return (
    <SidebarStateProvider>
      <ObjectPanelStateProvider>
        <ModalStateProvider>
          <NavigationStateProvider>
            <RefreshSyncProvider>
              <CombinedViewStateProvider>{children}</CombinedViewStateProvider>
            </RefreshSyncProvider>
          </NavigationStateProvider>
        </ModalStateProvider>
      </ObjectPanelStateProvider>
    </SidebarStateProvider>
  );
};
