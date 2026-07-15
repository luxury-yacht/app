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

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import {
  ObjectPanelStateProvider,
  useObjectPanelState,
} from '@modules/object-panel/contexts/ObjectPanelStateContext';
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
import { requestContextRefresh } from '@/core/data-access';
import { eventBus } from '@/core/events';
import { shouldSyncClusterNavigationTarget } from '@/core/navigation/workspace';
import { refreshOrchestrator } from '@/core/refresh';
import type {
  ClusterViewType,
  GlobalViewType,
  NamespaceViewType,
  ViewType,
} from '@/types/navigation/views';
import { ModalStateProvider, useModalState } from './ModalStateContext';
// Import specialized contexts
import { SidebarStateProvider, useSidebarState } from './SidebarStateContext';

export type { KubernetesObjectReference } from '@/types/view-state';
export type { SidebarSelectionType } from './SidebarStateContext';
// Re-export types for backwards compatibility
export type { ClusterViewType, NamespaceViewType, ViewType };

/**
 * Navigation state - core view type and tab management
 */
interface NavigationStateContextType {
  viewType: ViewType;
  previousView: ViewType;
  activeNamespaceTab: NamespaceViewType;
  activeClusterTab: ClusterViewType | null;
  activeGlobalTab: GlobalViewType;

  setViewType: (view: ViewType) => void;
  setPreviousView: (view: ViewType) => void;
  setActiveNamespaceTab: (tab: NamespaceViewType) => void;
  setActiveClusterView: (tab: ClusterViewType | null) => void;
  setClusterNavigationTarget: (clusterId: string, target: ClusterNavigationTarget) => void;
  navigateToGlobal: (view?: GlobalViewType) => void;
  activateClusterWorkspace: (clusterId?: string) => void;

  // Complex navigation actions
  navigateToClusterView: (viewType: ViewType) => void;
  navigateToNamespace: () => void;
  onNamespaceSelect: (namespace: string) => void;
  onClusterObjectsClick: () => void;

  // Per-cluster view state lookup for background refresh
  getClusterNavigationState: (clusterId: string) => NavigationTabState;
}

const NavigationStateContext = createContext<NavigationStateContextType | undefined>(undefined);

export interface NavigationTabState {
  viewType: Exclude<ViewType, 'global'>;
  previousView: Exclude<ViewType, 'global'>;
  activeNamespaceView: NamespaceViewType;
  activeClusterView: ClusterViewType | null;
}

export type ClusterNavigationTarget =
  | {
      viewType: 'overview' | 'cluster';
      activeClusterView: ClusterViewType | null;
    }
  | {
      viewType: 'namespace';
      activeNamespaceView: NamespaceViewType;
    };

const DEFAULT_NAVIGATION_STATE: NavigationTabState = {
  viewType: 'overview',
  previousView: 'overview',
  activeNamespaceView: 'workloads',
  activeClusterView: null,
};

export type NavigationWorkspace = 'cluster' | 'global';

export const resolveNavigationWorkspace = (
  workspace: NavigationWorkspace,
  openClusterCount: number
): NavigationWorkspace => (workspace === 'global' && openClusterCount > 1 ? 'global' : 'cluster');

export const applyClusterNavigationTarget = (
  states: Record<string, NavigationTabState>,
  clusterId: string,
  target: ClusterNavigationTarget
): Record<string, NavigationTabState> => {
  const targetClusterId = clusterId.trim();
  if (!targetClusterId) {
    return states;
  }
  const current = states[targetClusterId] ?? DEFAULT_NAVIGATION_STATE;
  const destination =
    target.viewType === 'namespace'
      ? { activeNamespaceView: target.activeNamespaceView }
      : { activeClusterView: target.activeClusterView };
  return {
    ...states,
    [targetClusterId]: {
      ...current,
      previousView: current.viewType,
      viewType: target.viewType,
      ...destination,
    },
  };
};

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
  const { selectedClusterId, selectedClusterIds } = useKubeconfig();
  // Keep navigation state scoped per cluster tab to avoid cross-tab state bleed.
  const [navigationStateByCluster, setNavigationStateByCluster] = useState<
    Record<string, NavigationTabState>
  >({});
  const [workspace, setWorkspace] = useState<NavigationWorkspace>('cluster');
  const [activeGlobalView, setActiveGlobalViewState] = useState<GlobalViewType>('fleet');
  const clusterKey = selectedClusterId || '__default__';
  const activeState = navigationStateByCluster[clusterKey] ?? DEFAULT_NAVIGATION_STATE;
  const {
    viewType: activeClusterViewType,
    previousView,
    activeNamespaceView,
    activeClusterView,
  } = activeState;
  const resolvedWorkspace = resolveNavigationWorkspace(workspace, selectedClusterIds.length);
  const viewType: ViewType = resolvedWorkspace === 'global' ? 'global' : activeClusterViewType;

  // Keep a ref to the latest navigation state map for stable callback access.
  const navigationStateByClusterRef = useRef(navigationStateByCluster);
  navigationStateByClusterRef.current = navigationStateByCluster;

  // Lookup a specific cluster's last-viewed navigation state (for background refresh).
  const getClusterNavigationState = useCallback((clusterId: string): NavigationTabState => {
    return navigationStateByClusterRef.current[clusterId] ?? DEFAULT_NAVIGATION_STATE;
  }, []);

  // Get sidebar state for navigation actions
  const { setSidebarSelection } = useSidebarState();

  const updateActiveState = useCallback(
    (updater: (prev: NavigationTabState) => NavigationTabState) => {
      setNavigationStateByCluster((prev) => {
        const current = prev[clusterKey] ?? DEFAULT_NAVIGATION_STATE;
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
    setNavigationStateByCluster((prev) => {
      if (selectedClusterIds.length === 0) {
        return prev.__default__ ? { __default__: prev.__default__ } : {};
      }
      const allowed = new Set(selectedClusterIds);
      const next: Record<string, NavigationTabState> = {};
      Object.entries(prev).forEach(([key, storedValue]) => {
        if (key === '__default__' || allowed.has(key)) {
          next[key] = storedValue;
        }
      });
      return next;
    });
  }, [selectedClusterIds]);

  useEffect(() => {
    if (workspace === resolvedWorkspace) {
      return;
    }
    setWorkspace(resolvedWorkspace);
  }, [resolvedWorkspace, workspace]);

  // Enhanced setViewType that notifies RefreshManager
  const setViewType = useCallback(
    (view: ViewType) => {
      if (view === 'global') {
        if (selectedClusterIds.length > 1) {
          setWorkspace('global');
          refreshOrchestrator.updateContext({
            currentView: 'global',
            activeClusterView: undefined,
          });
          void requestContextRefresh({ reason: 'startup' });
        }
        return;
      }
      const viewIsChanging = view !== viewType;
      setWorkspace('cluster');
      updateActiveState((prev) => ({ ...prev, viewType: view }));

      refreshOrchestrator.updateContext({ currentView: view });

      if (viewIsChanging) {
        void requestContextRefresh({ reason: 'startup' });
      }
    },
    [selectedClusterIds.length, updateActiveState, viewType]
  );

  const navigateToGlobal = useCallback(
    (view?: GlobalViewType) => {
      if (selectedClusterIds.length < 2) {
        return;
      }
      if (view) {
        setActiveGlobalViewState(view);
      }
      setWorkspace('global');
      refreshOrchestrator.updateContext({
        currentView: 'global',
        activeClusterView: undefined,
      });
      void requestContextRefresh({ reason: 'startup' });
    },
    [selectedClusterIds.length]
  );

  const activateClusterWorkspace = useCallback(
    (clusterId?: string) => {
      const targetClusterId = clusterId?.trim() || selectedClusterId || clusterKey;
      const targetState =
        navigationStateByClusterRef.current[targetClusterId] ?? DEFAULT_NAVIGATION_STATE;
      setWorkspace('cluster');
      // When activating a different cluster, KubeconfigContext owns the
      // subsequent selectedClusterId transition and refresh. Writing the
      // target route into the still-current cluster context would briefly
      // pair one cluster's identity with another cluster's navigation.
      if (targetClusterId === selectedClusterId) {
        refreshOrchestrator.updateContext({
          currentView: targetState.viewType,
          activeNamespaceView: targetState.activeNamespaceView,
          activeClusterView: targetState.activeClusterView ?? undefined,
        });
        void requestContextRefresh({ reason: 'startup' });
      }
    },
    [clusterKey, selectedClusterId]
  );

  const setActiveClusterView = useCallback(
    (tab: ClusterViewType | null) => {
      updateActiveState((prev) => ({ ...prev, activeClusterView: tab }));
      refreshOrchestrator.updateContext({
        activeClusterView: tab ?? undefined,
      });
    },
    [updateActiveState]
  );

  const setClusterNavigationTarget = useCallback(
    (clusterId: string, target: ClusterNavigationTarget) => {
      const targetClusterId = clusterId.trim();
      if (!targetClusterId) {
        return;
      }
      setNavigationStateByCluster((previous) =>
        applyClusterNavigationTarget(previous, targetClusterId, target)
      );
      if (
        shouldSyncClusterNavigationTarget(targetClusterId, selectedClusterId, resolvedWorkspace)
      ) {
        refreshOrchestrator.updateContext(
          target.viewType === 'namespace'
            ? {
                currentView: target.viewType,
                activeNamespaceView: target.activeNamespaceView,
              }
            : {
                currentView: target.viewType,
                activeClusterView: target.activeClusterView ?? undefined,
              }
        );
        void requestContextRefresh({ reason: 'startup' });
      }
    },
    [resolvedWorkspace, selectedClusterId]
  );

  const setPreviousView = useCallback(
    (view: ViewType) => {
      updateActiveState((prev) => ({
        ...prev,
        previousView: view === 'global' ? prev.viewType : view,
      }));
    },
    [updateActiveState]
  );

  const setActiveNamespaceView = useCallback(
    (tab: NamespaceViewType) => {
      updateActiveState((prev) => ({ ...prev, activeNamespaceView: tab }));
      // Keep refresh context aligned so streaming targets follow the active tab.
      refreshOrchestrator.updateContext({
        activeNamespaceView: tab,
      });
    },
    [updateActiveState]
  );

  // Complex navigation actions
  const navigateToClusterView = useCallback(
    (view: ViewType) => {
      setPreviousView(viewType);
      setViewType(view);
    },
    [setPreviousView, viewType, setViewType]
  );

  const navigateToNamespace = useCallback(() => {
    setPreviousView(viewType);
    setViewType('namespace');
  }, [setPreviousView, viewType, setViewType]);

  const onNamespaceSelect = useCallback(
    (namespace: string) => {
      setViewType('namespace');
      setSidebarSelection({ type: 'namespace', value: namespace });

      // Default to browse if coming from a non-namespace view
      const tabToUse = viewType === 'namespace' ? activeNamespaceView : 'browse';
      setActiveNamespaceView(tabToUse);
    },
    [setViewType, viewType, activeNamespaceView, setActiveNamespaceView, setSidebarSelection]
  );

  const onClusterObjectsClick = useCallback(() => {
    navigateToClusterView('cluster');
    setSidebarSelection({ type: 'cluster', value: 'cluster' });
  }, [navigateToClusterView, setSidebarSelection]);

  // Listen for reset-views event
  useEffect(() => {
    const handleResetViews = () => {
      updateActiveState(() => DEFAULT_NAVIGATION_STATE);
      setWorkspace('cluster');
      setActiveGlobalViewState('fleet');
      setSidebarSelection({ type: 'overview', value: 'overview' });
    };

    return eventBus.on('view:reset', handleResetViews);
  }, [setSidebarSelection, updateActiveState]);

  const value = useMemo(
    () => ({
      viewType,
      previousView,
      activeNamespaceTab: activeNamespaceView,
      activeClusterTab: activeClusterView,
      activeGlobalTab: activeGlobalView,
      setViewType,
      setPreviousView,
      setActiveNamespaceTab: setActiveNamespaceView,
      setActiveClusterView,
      setClusterNavigationTarget,
      navigateToGlobal,
      activateClusterWorkspace,
      navigateToClusterView,
      navigateToNamespace,
      onNamespaceSelect,
      onClusterObjectsClick,
      getClusterNavigationState,
    }),
    [
      viewType,
      previousView,
      activeNamespaceView,
      activeClusterView,
      activeGlobalView,
      setViewType,
      setPreviousView,
      setActiveNamespaceView,
      setActiveClusterView,
      setClusterNavigationTarget,
      navigateToGlobal,
      activateClusterWorkspace,
      navigateToClusterView,
      navigateToNamespace,
      onNamespaceSelect,
      onClusterObjectsClick,
      getClusterNavigationState,
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
  const { showObjectPanel } = useObjectPanelState();

  // Single writer for view/object-panel refresh context updates.
  // Individual object panel refresh is managed per-instance via useObjectPanelRefresh.
  useEffect(() => {
    refreshOrchestrator.updateContext({
      currentView: viewType,
      activeNamespaceView: activeNamespaceTab,
      activeClusterView: viewType === 'cluster' ? (activeClusterTab ?? undefined) : undefined,
      objectPanel: {
        isOpen: showObjectPanel,
      },
    });
  }, [viewType, activeNamespaceTab, activeClusterTab, showObjectPanel]);

  return <>{children}</>;
};

/**
 * Unified ViewStateContext for backwards compatibility
 * Combines all specialized contexts into a single interface
 */
interface ViewStateContextType
  extends NavigationStateContextType,
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
