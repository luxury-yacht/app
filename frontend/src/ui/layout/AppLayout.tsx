/**
 * frontend/src/ui/layout/AppLayout.tsx
 *
 * Module source for AppLayout.
 * Implements AppLayout logic for the UI layer.
 */

import captainK8s from '@assets/captain-k8s-color.png';
// Assets
import logo from '@assets/luxury-yacht-logo.png';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
// App Stuff
import '@/App.css';
import { useViewState } from '@core/contexts/ViewStateContext';
import type { ClusterResourceManagerProps } from '@modules/cluster/components/ClusterResourcesManager';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { isAllNamespaces } from '@modules/namespace/constants';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { NamespaceResourcesProvider } from '@modules/namespace/contexts/NsResourcesContext';
import { useObjectPanelState } from '@modules/object-panel/contexts/ObjectPanelStateContext';
import {
  loadObjectPanel,
  preloadObjectPanelModules,
} from '@modules/object-panel/objectPanelLazyModules';
// Error Handling
import { ErrorNotificationSystem } from '@shared/components/errors/ErrorNotificationSystem';
import { withLazyBoundary } from '@shared/utils/react/withLazyBoundary';
// Command Palette
import { CommandPalette } from '@ui/command-palette/CommandPalette';
import { useCommandPaletteCommands } from '@ui/command-palette/CommandPaletteCommands';
import { PanelErrorBoundary, RouteErrorBoundary } from '@ui/errors';
// Content Components
import AppHeader from '@ui/layout/AppHeader';
import { AppRegionNavigation } from '@ui/layout/AppRegionNavigation';
import { ClusterSelectionOverlay } from '@ui/layout/ClusterSelectionOverlay';
import ClusterTabs from '@ui/layout/ClusterTabs';
import { getClusterSelectionPhase } from '@ui/layout/clusterSelectionPhase';
import { resolveObjectPanelMountTarget } from '@ui/layout/objectPanelMountTarget';
import type { NamespaceViewType } from '@ui/navigation/types';
// Auth Failure Overlay
import { AuthFailureOverlay } from '@ui/overlays/AuthFailureOverlay';
import { setLastSettingsTab } from '@ui/settings/settingsTabPreference';
import { eventBus } from '@/core/events';
import { shouldShowActiveClusterAuthFailure } from '@/core/navigation/workspace';
import { PanelLifecycleClusterSurface } from '@/core/panel-windows/panelLifecycleGuards';
import { DiagnosticsPanel } from '@/core/refresh/components/DiagnosticsPanel';
import { getDefaultObjectPanelPosition } from '@/core/settings/appPreferences';
import {
  getSidebarWidthFromKey,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '@/hooks/useSidebarResize';
import { AppDebugOverlays } from './AppDebugOverlays';

const Sidebar = withLazyBoundary(() => import('@ui/layout/Sidebar'), 'Loading sidebar...');
const ClusterOverview = withLazyBoundary(
  () => import('@modules/cluster/components/ClusterOverview'),
  'Loading cluster overview...'
);
const ClusterResourcesManager = withLazyBoundary<Readonly<ClusterResourceManagerProps>>(
  () =>
    import('@modules/cluster/components/ClusterResourcesManager').then((module) => ({
      default: module.ClusterResourcesManager,
    })),
  'Loading cluster resources...'
);
const GlobalViews = withLazyBoundary(
  () => import('@modules/global/components/GlobalViews'),
  'Loading global resources...'
);
const AllNamespacesView = withLazyBoundary(
  () => import('@modules/namespace/components/AllNamespacesView'),
  'Loading all namespaces...'
);
const NamespaceResourcesViews = withLazyBoundary(
  () => import('@modules/namespace/components/NsResourcesViews'),
  'Loading namespace resources...'
);
const BrowseView = withLazyBoundary(
  () => import('@/modules/browse/components/BrowseView'),
  'Loading Browse...'
);
// These surfaces render in portals; an inline fallback would add a row to the app grid.
const ObjectPanel = withLazyBoundary(loadObjectPanel, null);
const SettingsModal = withLazyBoundary(() => import('@ui/modals/SettingsModal'), null);
const AboutModal = withLazyBoundary(() => import('@ui/modals/AboutModal'), null);
const ObjectDiffModal = withLazyBoundary(() => import('@ui/modals/ObjectDiffModal'), null);
const AppLogsPanel = withLazyBoundary(() => import('@ui/panels/app-logs/AppLogsPanel'), null);

const WelcomeContent: React.FC = () => (
  <div className="welcome">
    <img src={captainK8s} alt="Captain K8s" className="welcome-logo" width={1024} height={1024} />
    <img src={logo} alt="Luxury Yacht" className="welcome-logo" width={827} height={500} />
    <p>Select a view from the sidebar to get started</p>
  </div>
);

type ViewStateValue = ReturnType<typeof useViewState>;
type NamespaceContextValue = ReturnType<typeof useNamespace>;
type KubeconfigContextValue = ReturnType<typeof useKubeconfig>;

const NamespaceRouteContent = ({
  selectedNamespace,
  activeNamespaceTab,
}: {
  selectedNamespace?: string;
  activeNamespaceTab: NamespaceViewType | null;
}) => {
  if (!selectedNamespace) {
    return <WelcomeContent />;
  }
  if (isAllNamespaces(selectedNamespace)) {
    return (
      <RouteErrorBoundary routeName="namespace-all">
        <NamespaceResourcesProvider namespace={selectedNamespace}>
          <AllNamespacesView activeTab={activeNamespaceTab || 'workloads'} />
        </NamespaceResourcesProvider>
      </RouteErrorBoundary>
    );
  }
  return (
    <RouteErrorBoundary routeName="namespace">
      <NamespaceResourcesProvider namespace={selectedNamespace}>
        <NamespaceResourcesViews
          namespace={selectedNamespace}
          activeTab={activeNamespaceTab || 'workloads'}
        />
      </NamespaceResourcesProvider>
    </RouteErrorBoundary>
  );
};

const AppRouteContent = ({
  hasActiveClusters,
  namespace,
  viewState,
  kubeconfig,
}: {
  hasActiveClusters: boolean;
  namespace: NamespaceContextValue;
  viewState: ViewStateValue;
  kubeconfig: KubeconfigContextValue;
}) => {
  if (!hasActiveClusters) {
    return null;
  }
  if (viewState.viewType === 'global') {
    return (
      <RouteErrorBoundary routeName="global">
        <GlobalViews activeView={viewState.activeGlobalTab} />
      </RouteErrorBoundary>
    );
  }
  if (viewState.viewType === 'cluster' && viewState.activeClusterTab === 'browse') {
    return (
      <RouteErrorBoundary routeName="browse">
        <div className="view-content">
          <BrowseView />
        </div>
      </RouteErrorBoundary>
    );
  }
  if (viewState.viewType === 'cluster') {
    return (
      <RouteErrorBoundary routeName="cluster">
        <ClusterResourcesManager activeTab={viewState.activeClusterTab} />
      </RouteErrorBoundary>
    );
  }
  if (viewState.viewType === 'namespace') {
    return (
      <NamespaceRouteContent
        selectedNamespace={namespace.selectedNamespace}
        activeNamespaceTab={viewState.activeNamespaceTab}
      />
    );
  }
  if (viewState.viewType === 'overview') {
    return (
      <RouteErrorBoundary routeName="cluster-overview">
        <div className="view-content view-content--cluster-overview">
          <ClusterOverview clusterContext={kubeconfig.selectedKubeconfig || 'Default'} />
        </div>
      </RouteErrorBoundary>
    );
  }
  return <WelcomeContent />;
};

const SidebarResizer = ({ viewState }: { viewState: ViewStateValue }) => {
  if (!viewState.isSidebarVisible) {
    return null;
  }
  return (
    <hr
      className="sidebar-resizer"
      data-app-region="sidebar"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={viewState.sidebarWidth}
      tabIndex={0}
      onMouseDown={(event) => {
        event.preventDefault();
        viewState.setIsResizing(true);
      }}
      onKeyDown={(event) => {
        const width = getSidebarWidthFromKey(viewState.sidebarWidth, event.key);
        if (width === null) {
          return;
        }
        event.preventDefault();
        viewState.setSidebarWidth(width);
      }}
    />
  );
};

const ActiveClusterAuthOverlay = ({
  hasActiveClusters,
  viewType,
}: {
  hasActiveClusters: boolean;
  viewType: ViewStateValue['viewType'];
}) =>
  shouldShowActiveClusterAuthFailure(hasActiveClusters, viewType) ? <AuthFailureOverlay /> : null;

export const AppLayout: React.FC = () => {
  const namespace = useNamespace();
  const viewState = useViewState();
  const kubeconfig = useKubeconfig();
  const { openPanels, nativeLocations, dockedEdges, pendingNativeOpenPanelIds, closePanel } =
    useObjectPanelState();
  const commands = useCommandPaletteCommands();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const hasActiveClusters = kubeconfig.selectedClusterIds.length > 0;
  const clusterSelectionPhase = getClusterSelectionPhase({
    hasSelectedClusters: hasActiveClusters,
    kubeconfigsLoading: kubeconfig.kubeconfigsLoading,
  });

  // The "+" opens the command palette in kubeconfig mode (the Open Cluster
  // surface). Stable so the memoized ClusterTabs doesn't re-render needlessly.
  const handleOpenCluster = useCallback(() => {
    eventBus.emit('command-palette:open-kubeconfigs');
  }, []);
  const handleOpenKubeconfigSettings = useCallback(() => {
    setLastSettingsTab('kubeconfigs');
    viewState.setIsSettingsOpen(true);
  }, [viewState.setIsSettingsOpen]);
  const handleAboutClose = () => {
    viewState.setIsAboutOpen(false);
  };

  useEffect(() => {
    const warmObjectPanelModules = () => {
      // Speculative loading is best-effort. The lazy boundaries surface a real
      // import failure if the user later opens the panel.
      void preloadObjectPanelModules().catch(() => undefined);
    };
    if (openPanels.size > 0) {
      warmObjectPanelModules();
      return;
    }
    if (typeof window.requestIdleCallback === 'function') {
      const idleCallbackId = window.requestIdleCallback(warmObjectPanelModules, { timeout: 1500 });
      return () => window.cancelIdleCallback(idleCallbackId);
    }
    const timeoutId = window.setTimeout(warmObjectPanelModules, 0);
    return () => window.clearTimeout(timeoutId);
  }, [openPanels.size]);

  useEffect(() => {
    return eventBus.on('view:toggle-diagnostics', () => {
      setShowDiagnostics((prev) => !prev);
    });
  }, []);

  const routeContent = (
    <AppRouteContent
      hasActiveClusters={hasActiveClusters}
      namespace={namespace}
      viewState={viewState}
      kubeconfig={kubeconfig}
    />
  );

  return (
    <div className="app-container">
      <AppRegionNavigation />
      <AppHeader />
      <ClusterTabs onOpenCluster={handleOpenCluster} />

      <main className={`app-main ${hasActiveClusters ? '' : 'app-main-inactive'}`}>
        <Sidebar />
        <SidebarResizer viewState={viewState} />

        <div className="content">
          <div className="content-body" data-app-region="content" tabIndex={-1}>
            <div className="content-body__main">
              <PanelLifecycleClusterSurface
                clusterId={viewState.viewType === 'global' ? '' : kubeconfig.selectedClusterId}
              >
                {routeContent}
              </PanelLifecycleClusterSurface>
            </div>
          </div>
        </div>
        <ClusterSelectionOverlay
          phase={clusterSelectionPhase}
          discoveryState={kubeconfig.kubeconfigDiscoveryState}
          searchPaths={kubeconfig.kubeconfigSearchPaths}
          onOpenKubeconfigSettings={handleOpenKubeconfigSettings}
        />
        <ActiveClusterAuthOverlay
          hasActiveClusters={hasActiveClusters}
          viewType={viewState.viewType}
        />
      </main>

      <PanelErrorBoundary onClose={() => viewState.setShowAppLogsPanel(false)} panelName="app-logs">
        <AppLogsPanel
          isOpen={viewState.showAppLogsPanel}
          onClose={() => viewState.setShowAppLogsPanel(false)}
        />
      </PanelErrorBoundary>

      <PanelErrorBoundary onClose={() => setShowDiagnostics(false)} panelName="diagnostics">
        <DiagnosticsPanel isOpen={showDiagnostics} onClose={() => setShowDiagnostics(false)} />
      </PanelErrorBoundary>

      {Array.from(openPanels.entries())
        .filter(([panelId]) => !nativeLocations.has(panelId))
        .map(([panelId, objectRef]) => {
          const mountTarget = resolveObjectPanelMountTarget(
            dockedEdges.get(panelId),
            getDefaultObjectPanelPosition(),
            pendingNativeOpenPanelIds.has(panelId) ? panelId : undefined
          );
          return (
            <PanelErrorBoundary
              key={panelId}
              onClose={() => closePanel(objectRef.clusterId, panelId)}
              panelName="object-details"
            >
              <ObjectPanel
                panelId={panelId}
                objectRef={objectRef}
                defaultPosition={mountTarget.position}
                defaultGroupKey={mountTarget.groupKey}
                suppressWorkspaceSurface={pendingNativeOpenPanelIds.has(panelId)}
              />
            </PanelErrorBoundary>
          );
        })}

      <PanelErrorBoundary onClose={() => viewState.setIsSettingsOpen(false)} panelName="settings">
        <SettingsModal
          isOpen={viewState.isSettingsOpen}
          onClose={() => viewState.setIsSettingsOpen(false)}
        />
      </PanelErrorBoundary>

      <PanelErrorBoundary onClose={handleAboutClose} panelName="about">
        <AboutModal isOpen={viewState.isAboutOpen} onClose={handleAboutClose} />
      </PanelErrorBoundary>
      <PanelErrorBoundary
        onClose={() => viewState.setIsObjectDiffOpen(false)}
        panelName="object-diff"
      >
        <ObjectDiffModal
          isOpen={viewState.isObjectDiffOpen}
          initialRequest={viewState.objectDiffOpenRequest}
          onClose={() => viewState.setIsObjectDiffOpen(false)}
        />
      </PanelErrorBoundary>
      <ErrorNotificationSystem />
      <CommandPalette commands={commands} />
      <AppDebugOverlays />
    </div>
  );
};
