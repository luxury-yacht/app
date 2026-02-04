/**
 * frontend/src/ui/layout/AppLayout.tsx
 *
 * Module source for AppLayout.
 * Implements AppLayout logic for the UI layer.
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
// Assets
import logo from '@assets/luxury-yacht-logo.png';
import captainK8s from '@assets/captain-k8s-color.png';
// App Stuff
import '@/App.css';
import { withLazyBoundary } from '@components/hoc/withLazyBoundary';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { eventBus } from '@/core/events';
// Content Components
import AppHeader from '@ui/layout/AppHeader';
import ClusterTabs from '@ui/layout/ClusterTabs';
import ClusterOverview from '@modules/cluster/components/ClusterOverview';
import type { ClusterViewType, NamespaceViewType } from '@ui/navigation/types';
import { ClusterResourcesManager } from '@modules/cluster/components/ClusterResourcesManager';
import { ClusterResourcesProvider } from '@modules/cluster/contexts/ClusterResourcesContext';
import BrowseView from '@/modules/browse/components/BrowseView';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { NamespaceResourcesManager } from '@modules/namespace/components/NsResourcesManager';
import { NamespaceResourcesProvider } from '@modules/namespace/contexts/NsResourcesContext';
import AllNamespacesView from '@modules/namespace/components/AllNamespacesView';
import { ALL_NAMESPACES_DISPLAY_NAME, isAllNamespaces } from '@modules/namespace/constants';
// Command Palette
import { CommandPalette } from '@ui/command-palette/CommandPalette';
import { useCommandPaletteCommands } from '@ui/command-palette/CommandPaletteCommands';
// Error Handling
import { ErrorNotificationSystem } from '@shared/components/errors/ErrorNotificationSystem';
import { PanelErrorBoundary, RouteErrorBoundary } from '@components/errors';
import { DiagnosticsPanel } from '@/core/refresh/components/DiagnosticsPanel';
import { DockablePanelProvider } from '@/components/dockable';
// Auth Failure Overlay
import { AuthFailureOverlay } from '@/components/overlays/AuthFailureOverlay';

const Sidebar = withLazyBoundary(() => import('@ui/layout/Sidebar'), 'Loading sidebar...');

const SettingsModal = withLazyBoundary(
  () => import('@/components/modals/SettingsModal'),
  'Loading settings...'
);
const AboutModal = withLazyBoundary(
  () => import('@/components/modals/AboutModal'),
  'Loading about...'
);
const ObjectDiffModal = withLazyBoundary(
  () => import('@/components/modals/ObjectDiffModal'),
  'Loading diff viewer...'
);
const AppLogsPanel = withLazyBoundary(
  () => import('@/components/content/AppLogsPanel/AppLogsPanel'),
  'Loading app logs panel...'
);
const ObjectPanel = withLazyBoundary(
  () => import('@modules/object-panel/components/ObjectPanel/ObjectPanel'),
  'Loading object panel...'
);
const PortForwardsPanel = withLazyBoundary(
  () => import('@modules/port-forward').then((m) => ({ default: m.PortForwardsPanel })),
  'Loading port forwards panel...'
);

const DevTestErrorBoundaryLazy = React.lazy(() => import('@components/errors/TestErrorBoundary'));

export const AppLayout: React.FC = () => {
  const namespace = useNamespace();
  const viewState = useViewState();
  const kubeconfig = useKubeconfig();
  const commands = useCommandPaletteCommands();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isFocusOverlayVisible, setIsFocusOverlayVisible] = useState(false);
  const [isErrorOverlayVisible, setIsErrorOverlayVisible] = useState(false);
  const hasActiveClusters = kubeconfig.selectedClusterIds.length > 0;
  const handleAboutClose = () => {
    viewState.setIsAboutOpen(false);
  };

  useEffect(() => {
    const handleDebugShortcut = (event: KeyboardEvent) => {
      const isCtrlOrCmd = event.ctrlKey || event.metaKey;
      if (!isCtrlOrCmd || !event.shiftKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        setIsFocusOverlayVisible((prev) => !prev);
      } else if (key === 'e') {
        event.preventDefault();
        setIsErrorOverlayVisible((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleDebugShortcut);
    return () => window.removeEventListener('keydown', handleDebugShortcut);
  }, []);

  useEffect(() => {
    return eventBus.on('view:toggle-diagnostics', () => {
      setShowDiagnostics((prev) => !prev);
    });
  }, []);

  const getContentTitle = () => {
    if (!hasActiveClusters) {
      return 'No Active Clusters';
    }
    // Return empty string for welcome page (no view selected)
    if (!viewState.viewType) {
      return '';
    }

    const clusterLabel = kubeconfig.selectedClusterName || kubeconfig.selectedClusterId || '';
    const namespaceLabel =
      viewState.viewType === 'namespace' && namespace.selectedNamespace
        ? isAllNamespaces(namespace.selectedNamespace)
          ? ALL_NAMESPACES_DISPLAY_NAME
          : namespace.selectedNamespace
        : '';
    const viewLabel = (() => {
      if (viewState.viewType === 'overview') {
        return 'Cluster Overview';
      }

      if (viewState.viewType === 'cluster' && viewState.activeClusterTab) {
        const tabTitlesCluster: Record<string, string> = {
          browse: 'Browse',
          nodes: 'Nodes',
          rbac: 'RBAC',
          storage: 'Storage',
          config: 'Config',
          crds: 'CRDs',
          custom: 'Custom Resources',
          events: 'Events',
        };
        return tabTitlesCluster[viewState.activeClusterTab] || 'Cluster Resources';
      }

      if (viewState.viewType === 'namespace' && viewState.activeNamespaceTab) {
        const tabTitlesNamespace: Record<string, string> = {
          objects: 'All Objects',
          workloads: 'Workloads',
          pods: 'Pods',
          autoscaling: 'Autoscaling',
          config: 'Config',
          custom: 'Custom Resources',
          events: 'Events',
          helm: 'Helm',
          network: 'Network',
          quotas: 'Quotas',
          rbac: 'RBAC',
          storage: 'Storage',
        };
        return tabTitlesNamespace[viewState.activeNamespaceTab] || 'Namespace';
      }

      const titles: Record<string, string> = {
        cluster: 'Cluster Resources',
        namespace: 'Namespace',
      };
      return titles[viewState.viewType] || '';
    })();

    const clusterText = clusterLabel ? `cluster: ${clusterLabel}` : '';
    const namespaceText = namespaceLabel ? `namespace: ${namespaceLabel}` : '';
    const viewText = viewLabel ? `view: ${viewLabel}` : '';
    return [clusterText, namespaceText, viewText].filter(Boolean).join(' • ');
  };

  return (
    <DockablePanelProvider>
      <div className="app-container">
        <AppHeader
          contentTitle={getContentTitle()}
          onAboutClick={() => viewState.setIsAboutOpen(true)}
        />
        <ClusterTabs />

        <main className={`app-main ${hasActiveClusters ? '' : 'app-main-inactive'}`}>
          <Sidebar />
          {viewState.isSidebarVisible && (
            <div
              className="sidebar-resizer"
              onMouseDown={(e) => {
                e.preventDefault();
                viewState.setIsResizing(true);
              }}
            />
          )}

          <div className="content">
            <div className="content-body">
              {hasActiveClusters ? (
                viewState.viewType === 'cluster' ? (
                  viewState.activeClusterTab === 'browse' ? (
                    <RouteErrorBoundary routeName="browse">
                      <BrowseView />
                    </RouteErrorBoundary>
                  ) : (
                    <RouteErrorBoundary routeName="cluster">
                      <ClusterResourcesProvider activeView={viewState.activeClusterTab}>
                        <ClusterResourcesManager
                          activeTab={viewState.activeClusterTab}
                          onTabChange={(tab: string) =>
                            viewState.setActiveClusterView(tab as ClusterViewType)
                          }
                        />
                      </ClusterResourcesProvider>
                    </RouteErrorBoundary>
                  )
                ) : viewState.viewType === 'namespace' ? (
                  namespace.selectedNamespace ? (
                    isAllNamespaces(namespace.selectedNamespace) ? (
                      <RouteErrorBoundary routeName="namespace-all">
                        <AllNamespacesView activeTab={viewState.activeNamespaceTab} />
                      </RouteErrorBoundary>
                    ) : (
                      <RouteErrorBoundary routeName="namespace">
                        <NamespaceResourcesProvider
                          namespace={namespace.selectedNamespace}
                          activeView={viewState.activeNamespaceTab}
                        >
                          <NamespaceResourcesManager
                            namespace={namespace.selectedNamespace}
                            activeTab={viewState.activeNamespaceTab}
                            onTabChange={(tab: NamespaceViewType) =>
                              viewState.setActiveNamespaceTab(tab)
                            }
                          />
                        </NamespaceResourcesProvider>
                      </RouteErrorBoundary>
                    )
                  ) : (
                    <div className="welcome">
                      <img src={captainK8s} alt="Captain K8s" className="captain-k8s" />
                      <img src={logo} alt="Luxury Yacht" className="welcome-logo" />
                    </div>
                  )
                ) : viewState.viewType === 'overview' ? (
                  <RouteErrorBoundary routeName="cluster-overview">
                    <ClusterOverview clusterContext={kubeconfig.selectedKubeconfig || 'Default'} />
                  </RouteErrorBoundary>
                ) : (
                  <div className="welcome">
                    <img src={captainK8s} alt="Captain K8s" className="welcome-logo" />
                    <img src={logo} alt="Luxury Yacht" className="welcome-logo" />

                    <p>Select a view from the sidebar to get started</p>
                  </div>
                )
              ) : null}
            </div>
          </div>
          {!hasActiveClusters && (
            <div className="no-active-clusters-overlay" role="status">
              {/* Block interactions and loading when no clusters are active. */}
              <div className="no-active-clusters-message">
                No active clusters. Select a cluster from the kubeconfig dropdown.
              </div>
            </div>
          )}
          {/* Per-cluster auth failure overlay - blocks sidebar and content when active cluster has auth error */}
          {hasActiveClusters && <AuthFailureOverlay />}
        </main>

        <PanelErrorBoundary onClose={() => {}} panelName="app-logs">
          <AppLogsPanel />
        </PanelErrorBoundary>

        <PanelErrorBoundary onClose={() => {}} panelName="port-forwards">
          <PortForwardsPanel />
        </PanelErrorBoundary>

        <PanelErrorBoundary onClose={() => setShowDiagnostics(false)} panelName="diagnostics">
          <DiagnosticsPanel isOpen={showDiagnostics} onClose={() => setShowDiagnostics(false)} />
        </PanelErrorBoundary>

        <PanelErrorBoundary
          onClose={() => viewState.setShowObjectPanel(false)}
          panelName="object-details"
        >
          <ObjectPanel />
        </PanelErrorBoundary>

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
            onClose={() => viewState.setIsObjectDiffOpen(false)}
          />
        </PanelErrorBoundary>
        <ErrorNotificationSystem />
        <CommandPalette commands={commands} />
        {isFocusOverlayVisible && <KeyboardFocusOverlay />}
        {isErrorOverlayVisible && (
          <React.Suspense fallback={null}>
            <DevTestErrorBoundaryLazy />
          </React.Suspense>
        )}
      </div>
    </DockablePanelProvider>
  );
};

const describeFocusTarget = (element: Element | null): string => {
  if (!element) {
    return 'No active element';
  }

  const target =
    (element instanceof HTMLElement && element.getAttribute('data-focus-area')) ||
    element.closest<HTMLElement>('[data-focus-area]')?.getAttribute('data-focus-area');
  if (target) {
    return target;
  }

  if (element instanceof HTMLElement) {
    const ariaLabel =
      element.getAttribute('aria-label') ||
      element.getAttribute('aria-labelledby') ||
      (element instanceof HTMLInputElement && element.name
        ? `input[name="${element.name}"]`
        : null);
    if (ariaLabel) {
      return ariaLabel;
    }
    if (element.id) {
      return `${element.tagName.toLowerCase()}#${element.id}`;
    }
    const text = element.textContent?.trim();
    if (text) {
      return `${element.tagName.toLowerCase()} "${text.slice(0, 60)}"`;
    }
    return element.tagName.toLowerCase();
  }

  return element.tagName.toLowerCase();
};

const KeyboardFocusOverlay: React.FC = () => {
  const [sidebarElement, setSidebarElement] = useState<HTMLElement | null>(null);
  const [description, setDescription] = useState('No active element');

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const updateDescription = () => {
      setDescription(describeFocusTarget(document.activeElement));
    };

    updateDescription();
    window.addEventListener('focusin', updateDescription);
    window.addEventListener('focusout', updateDescription);
    window.addEventListener('keydown', updateDescription);

    return () => {
      window.removeEventListener('focusin', updateDescription);
      window.removeEventListener('focusout', updateDescription);
      window.removeEventListener('keydown', updateDescription);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const existing = document.querySelector('.sidebar');
    if (existing instanceof HTMLElement) {
      setSidebarElement(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const sidebar = document.querySelector('.sidebar');
      if (sidebar instanceof HTMLElement) {
        setSidebarElement(sidebar);
        observer.disconnect();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!sidebarElement) {
    return null;
  }

  return createPortal(
    <div className="keyboard-focus-overlay">
      <div className="keyboard-focus-overlay__label">Focus target</div>
      <div className="keyboard-focus-overlay__value" title={description}>
        {description}
      </div>
    </div>,
    sidebarElement
  );
};
