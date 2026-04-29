/**
 * frontend/src/ui/layout/AppLayout.tsx
 *
 * Module source for AppLayout.
 * Implements AppLayout logic for the UI layer.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
// Assets
import logo from '@assets/luxury-yacht-logo.png';
import captainK8s from '@assets/captain-k8s-color.png';
// App Stuff
import '@/App.css';
import { withLazyBoundary } from '@shared/utils/react/withLazyBoundary';
import { DebugOverlay } from '@ui/layout/DebugOverlay';
import { CopyIcon } from '@shared/components/icons/LogIcons';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanelState } from '@/core/contexts/ObjectPanelStateContext';
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
import { PanelErrorBoundary, RouteErrorBoundary } from '@ui/errors';
import { DiagnosticsPanel } from '@/core/refresh/components/DiagnosticsPanel';
import { getAllPanelStates, useDockablePanelContext } from '@ui/dockable';
import { useDockablePanelEmptySpaceDropTarget } from '@ui/dockable/DockablePanelContentArea';
import { usePanelSurfaceCycling } from '@ui/dockable/usePanelSurfaceCycling';
// Auth Failure Overlay
import { AuthFailureOverlay } from '@ui/overlays/AuthFailureOverlay';
import { useAppDebugShortcuts } from '@ui/layout/useAppDebugShortcuts';
import {
  useContentRegionShiftTabHandoff,
  useTopLevelAppRegionTracking,
} from '@ui/layout/appFocusRegions';

const Sidebar = withLazyBoundary(() => import('@ui/layout/Sidebar'), 'Loading sidebar...');

const SettingsModal = withLazyBoundary(
  () => import('@ui/modals/SettingsModal'),
  'Loading settings...'
);
const AboutModal = withLazyBoundary(() => import('@ui/modals/AboutModal'), 'Loading about...');
const ObjectDiffModal = withLazyBoundary(
  () => import('@ui/modals/ObjectDiffModal'),
  'Loading diff viewer...'
);
const CreateResourceModal = withLazyBoundary(
  () => import('@ui/modals/CreateResourceModal'),
  'Loading create resource...'
);
const AppLogsPanel = withLazyBoundary(
  () => import('@ui/panels/app-logs/AppLogsPanel'),
  'Loading Application Logs Panel...'
);
// ObjectPanel is imported eagerly because panels are only rendered on-demand
// (when openPanels has entries). A lazy boundary would flash a loading spinner
// on the first click before the chunk loads.
import ObjectPanel from '@modules/object-panel/components/ObjectPanel/ObjectPanel';
const DevTestErrorBoundaryLazy = React.lazy(() => import('@ui/errors/TestErrorBoundary'));

export const AppLayout: React.FC = () => {
  const namespace = useNamespace();
  const viewState = useViewState();
  const kubeconfig = useKubeconfig();
  const { tabGroups, focusPanel, setLastFocusedGroupKey } = useDockablePanelContext();
  const { openPanels, closePanel } = useObjectPanelState();
  const commands = useCommandPaletteCommands();
  const contentBodyRef = useRef<HTMLDivElement | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isFocusOverlayVisible, setIsFocusOverlayVisible] = useState(false);
  const [isErrorOverlayVisible, setIsErrorOverlayVisible] = useState(false);
  const [isPanelDebugOverlayVisible, setIsPanelDebugOverlayVisible] = useState(false);
  const hasActiveClusters = kubeconfig.selectedClusterIds.length > 0;
  // Empty-space drop target for dockable tabs: dropping a tab in empty
  // content area spawns a new floating group at the cursor. The ref is
  // merged onto the existing `<main>` element below — no new wrapper,
  // no `display: contents`. `useTabDropTarget`'s `stopPropagation` in
  // its drop handler guarantees that drops inside a tab bar's own
  // drop target never bubble up to this container target.
  const { ref: emptySpaceDropRef } = useDockablePanelEmptySpaceDropTarget();
  const handleAboutClose = () => {
    viewState.setIsAboutOpen(false);
  };

  useAppDebugShortcuts({
    onTogglePanelDebug: () => setIsPanelDebugOverlayVisible((prev) => !prev),
    onToggleFocusDebug: () => setIsFocusOverlayVisible((prev) => !prev),
    onToggleErrorDebug: () => setIsErrorOverlayVisible((prev) => !prev),
  });
  useContentRegionShiftTabHandoff(contentBodyRef, hasActiveClusters);
  useTopLevelAppRegionTracking(hasActiveClusters);
  usePanelSurfaceCycling({
    tabGroups,
    focusPanel,
    setLastFocusedGroupKey,
  });

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
    <div className="app-container">
      <AppHeader contentTitle={getContentTitle()} />
      <ClusterTabs />

      <main
        ref={emptySpaceDropRef as (el: HTMLElement | null) => void}
        className={`app-main ${hasActiveClusters ? '' : 'app-main-inactive'}`}
      >
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
          <div ref={contentBodyRef} className="content-body" data-app-region="content">
            <div className="content-body__main">
              {hasActiveClusters ? (
                viewState.viewType === 'cluster' ? (
                  viewState.activeClusterTab === 'browse' ? (
                    <RouteErrorBoundary routeName="browse">
                      <div className="view-content">
                        <BrowseView />
                      </div>
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
                        <NamespaceResourcesProvider
                          namespace={namespace.selectedNamespace}
                          activeView={viewState.activeNamespaceTab}
                        >
                          <AllNamespacesView activeTab={viewState.activeNamespaceTab} />
                        </NamespaceResourcesProvider>
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
                      <img src={captainK8s} alt="Captain K8s" className="welcome-logo" />
                      <img src={logo} alt="Luxury Yacht" className="welcome-logo" />

                      <p>Select a view from the sidebar to get started</p>
                    </div>
                  )
                ) : viewState.viewType === 'overview' ? (
                  <RouteErrorBoundary routeName="cluster-overview">
                    <div className="view-content view-content--cluster-overview">
                      <ClusterOverview
                        clusterContext={kubeconfig.selectedKubeconfig || 'Default'}
                      />
                    </div>
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

      <PanelErrorBoundary onClose={() => viewState.setShowAppLogsPanel(false)} panelName="app-logs">
        <AppLogsPanel
          isOpen={viewState.showAppLogsPanel}
          onClose={() => viewState.setShowAppLogsPanel(false)}
        />
      </PanelErrorBoundary>

      <PanelErrorBoundary onClose={() => setShowDiagnostics(false)} panelName="diagnostics">
        <DiagnosticsPanel isOpen={showDiagnostics} onClose={() => setShowDiagnostics(false)} />
      </PanelErrorBoundary>

      {Array.from(openPanels.entries()).map(([panelId, objectRef]) => (
        <PanelErrorBoundary
          key={panelId}
          onClose={() => closePanel(panelId)}
          panelName="object-details"
        >
          <ObjectPanel panelId={panelId} objectRef={objectRef} />
        </PanelErrorBoundary>
      ))}

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
      <PanelErrorBoundary
        onClose={() => viewState.setIsCreateResourceOpen(false)}
        panelName="create-resource"
      >
        <CreateResourceModal
          isOpen={viewState.isCreateResourceOpen}
          onClose={() => viewState.setIsCreateResourceOpen(false)}
        />
      </PanelErrorBoundary>
      <ErrorNotificationSystem />
      <CommandPalette commands={commands} />
      {isPanelDebugOverlayVisible && (
        <PanelDebugOverlay onClose={() => setIsPanelDebugOverlayVisible(false)} />
      )}
      {isFocusOverlayVisible && (
        <KeyboardFocusOverlay onClose={() => setIsFocusOverlayVisible(false)} />
      )}
      {isErrorOverlayVisible && (
        <ErrorBoundaryDebugOverlay onClose={() => setIsErrorOverlayVisible(false)} />
      )}
    </div>
  );
};

interface FocusDebugInfo {
  summary: string;
  tag: string;
  role: string | null;
  label: string | null;
  text: string | null;
  id: string | null;
  classes: string | null;
  tabIndex: number | null;
  disabled: boolean | null;
  focusArea: string | null;
  surface: string | null;
  path: string;
}

const serializeFocusInfo = (focusInfo: FocusDebugInfo) =>
  [
    ['Summary', focusInfo.summary],
    ['Tag', focusInfo.tag],
    ['Role', focusInfo.role ?? 'none'],
    ['Label', focusInfo.label ?? 'none'],
    ['Text', focusInfo.text ?? 'none'],
    ['Id', focusInfo.id ?? 'none'],
    ['Classes', focusInfo.classes ?? 'none'],
    ['Tab Index', focusInfo.tabIndex !== null ? String(focusInfo.tabIndex) : 'none'],
    ['Disabled', focusInfo.disabled === null ? 'n/a' : focusInfo.disabled ? 'true' : 'false'],
    ['Focus Area', focusInfo.focusArea ?? 'none'],
    ['Surface', focusInfo.surface ?? 'none'],
    ['Path', focusInfo.path],
  ]
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');

const getFocusableLabel = (element: HTMLElement) =>
  element.getAttribute('aria-label') ||
  element.getAttribute('aria-labelledby') ||
  (element instanceof HTMLInputElement && element.name ? `input[name="${element.name}"]` : null);

const describePathSegment = (element: HTMLElement) => {
  const tag = element.tagName.toLowerCase();
  const dataFocusArea = element.getAttribute('data-focus-area');
  if (dataFocusArea) {
    return `${tag}[data-focus-area="${dataFocusArea}"]`;
  }
  if (element.id) {
    return `${tag}#${element.id}`;
  }
  const classes = Array.from(element.classList).slice(0, 2);
  if (classes.length > 0) {
    return `${tag}.${classes.join('.')}`;
  }
  return tag;
};

const getSurfaceDescription = (element: HTMLElement) => {
  const modalSurface = element.closest<HTMLElement>('[data-modal-surface="true"]');
  if (modalSurface) {
    return 'modal';
  }

  const roles = ['dialog', 'navigation', 'tablist', 'listbox', 'menu'];
  for (const role of roles) {
    const match = element.closest<HTMLElement>(`[role="${role}"]`);
    if (match) {
      return role;
    }
  }

  const classMatches: Array<[selector: string, label: string]> = [
    ['.dropdown', 'dropdown'],
    ['.context-menu', 'context menu'],
    ['.object-panel', 'object panel'],
    ['.sidebar', 'sidebar'],
    ['.app-header', 'header'],
  ];
  for (const [selector, label] of classMatches) {
    if (element.closest(selector)) {
      return label;
    }
  }

  return null;
};

const describeFocusTarget = (element: Element | null): FocusDebugInfo => {
  if (!(element instanceof HTMLElement)) {
    return {
      summary: 'No active element',
      tag: 'none',
      role: null,
      label: null,
      text: null,
      id: null,
      classes: null,
      tabIndex: null,
      disabled: null,
      focusArea: null,
      surface: null,
      path: 'none',
    };
  }

  const focusArea =
    element.getAttribute('data-focus-area') ||
    element.closest<HTMLElement>('[data-focus-area]')?.getAttribute('data-focus-area') ||
    null;
  const label = getFocusableLabel(element);
  const text = element.textContent?.trim() || null;
  const summarizedText = text ? text.slice(0, 120) : null;
  const pathSegments: string[] = [];
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 4; depth += 1) {
    pathSegments.push(describePathSegment(current));
    current = current.parentElement;
  }

  return {
    summary:
      focusArea ||
      label ||
      (element.id ? `${element.tagName.toLowerCase()}#${element.id}` : null) ||
      (summarizedText ? `${element.tagName.toLowerCase()} "${summarizedText}"` : null) ||
      element.tagName.toLowerCase(),
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    label,
    text: summarizedText,
    id: element.id || null,
    classes: element.className.trim() || null,
    tabIndex: element.tabIndex >= 0 ? element.tabIndex : null,
    disabled: 'disabled' in element ? Boolean((element as HTMLInputElement).disabled) : null,
    focusArea,
    surface: getSurfaceDescription(element),
    path: pathSegments.join(' <- '),
  };
};

interface OverlayCloseProps {
  // Each debug overlay is toggleable, so the shell gets a close callback.
  onClose: () => void;
}

const KeyboardFocusOverlay: React.FC<OverlayCloseProps> = ({ onClose }) => {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const overlayPointerInteractionRef = useRef(false);
  const [focusInfo, setFocusInfo] = useState<FocusDebugInfo>(() => describeFocusTarget(null));
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(serializeFocusInfo(focusInfo));
  }, [focusInfo]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const updateDescription = (event?: Event) => {
      const overlayElement = overlayRef.current;
      const activeElement = document.activeElement;
      const eventTarget = event?.target instanceof Node ? event.target : null;
      const activeElementIsDocumentFallback =
        activeElement === document.body || activeElement === document.documentElement;

      if (
        overlayElement &&
        ((activeElement instanceof Node && overlayElement.contains(activeElement)) ||
          (eventTarget && overlayElement.contains(eventTarget)) ||
          (activeElementIsDocumentFallback && overlayPointerInteractionRef.current))
      ) {
        return;
      }

      overlayPointerInteractionRef.current = false;
      setFocusInfo(describeFocusTarget(activeElement));
    };

    const handlePointerDown = (event: PointerEvent) => {
      const overlayElement = overlayRef.current;
      overlayPointerInteractionRef.current = Boolean(
        overlayElement && overlayElement.contains(event.target as Node)
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      overlayPointerInteractionRef.current = false;
      updateDescription(event);
    };

    updateDescription();
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('focusin', updateDescription);
    window.addEventListener('focusout', updateDescription);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('focusin', updateDescription);
      window.removeEventListener('focusout', updateDescription);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <DebugOverlay
      title="Keyboard Focus (Ctrl+Alt+K)"
      testId="keyboard-focus-overlay"
      overlayRef={overlayRef}
      headerActions={
        <button
          type="button"
          className="debug-overlay__close"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => void handleCopy()}
          aria-label="Copy keyboard focus details"
          title="Copy keyboard focus details"
        >
          <CopyIcon width={14} height={14} />
        </button>
      }
      onClose={onClose}
    >
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Summary</div>
        <div className="debug-overlay__value" title={focusInfo.summary}>
          {focusInfo.summary}
        </div>
      </div>
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Tag</div>
        <div className="debug-overlay__value">{focusInfo.tag}</div>
      </div>
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Role</div>
        <div className="debug-overlay__value">{focusInfo.role ?? 'none'}</div>
      </div>
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Label</div>
        <div className="debug-overlay__value">{focusInfo.label ?? 'none'}</div>
      </div>
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Text</div>
        <div className="debug-overlay__value">{focusInfo.text ?? 'none'}</div>
      </div>
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Id</div>
        <div className="debug-overlay__value">{focusInfo.id ?? 'none'}</div>
      </div>
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Classes</div>
        <div className="debug-overlay__value">{focusInfo.classes ?? 'none'}</div>
      </div>
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Tab Index</div>
        <div className="debug-overlay__value">
          {focusInfo.tabIndex !== null ? String(focusInfo.tabIndex) : 'none'}
        </div>
      </div>
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Disabled</div>
        <div className="debug-overlay__value">
          {focusInfo.disabled === null ? 'n/a' : focusInfo.disabled ? 'true' : 'false'}
        </div>
      </div>
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Focus Area</div>
        <div className="debug-overlay__value">{focusInfo.focusArea ?? 'none'}</div>
      </div>
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Surface</div>
        <div className="debug-overlay__value">{focusInfo.surface ?? 'none'}</div>
      </div>
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Path</div>
        <div className="debug-overlay__value" title={focusInfo.path}>
          {focusInfo.path}
        </div>
      </div>
    </DebugOverlay>
  );
};

const PanelDebugOverlay: React.FC<OverlayCloseProps> = ({ onClose }) => {
  const { tabGroups, panelRegistrations } = useDockablePanelContext();
  const [focusedPanelId, setFocusedPanelId] = useState<string | null>(null);

  useEffect(() => {
    const resolveFocusedPanelId = () => {
      const states = getAllPanelStates();
      let nextFocusedPanelId: string | null = null;
      let highestZIndex = Number.NEGATIVE_INFINITY;

      Object.entries(states).forEach(([panelId, state]) => {
        if (!state.isOpen) {
          return;
        }
        if (state.zIndex > highestZIndex) {
          highestZIndex = state.zIndex;
          nextFocusedPanelId = panelId;
        }
      });

      setFocusedPanelId((previous) =>
        previous === nextFocusedPanelId ? previous : nextFocusedPanelId
      );
    };

    const scheduleResolve = () => {
      window.setTimeout(resolveFocusedPanelId, 0);
    };

    resolveFocusedPanelId();
    window.addEventListener('focusin', scheduleResolve);
    window.addEventListener('keydown', scheduleResolve);
    document.addEventListener('mousedown', scheduleResolve, true);
    document.addEventListener('click', scheduleResolve, true);
    const intervalId = window.setInterval(resolveFocusedPanelId, 250);

    return () => {
      window.removeEventListener('focusin', scheduleResolve);
      window.removeEventListener('keydown', scheduleResolve);
      document.removeEventListener('mousedown', scheduleResolve, true);
      document.removeEventListener('click', scheduleResolve, true);
      window.clearInterval(intervalId);
    };
  }, []);

  const assignedGroupsByPanelId = new Map<string, string>();
  tabGroups.right.tabs.forEach((panelId) => assignedGroupsByPanelId.set(panelId, 'right'));
  tabGroups.bottom.tabs.forEach((panelId) => assignedGroupsByPanelId.set(panelId, 'bottom'));
  tabGroups.floating.forEach((group) => {
    group.tabs.forEach((panelId) =>
      assignedGroupsByPanelId.set(panelId, `floating:${group.groupId}`)
    );
  });

  const registeredPanels = Array.from(panelRegistrations.values()).sort((a, b) =>
    a.title.localeCompare(b.title)
  );
  const ungroupedRegisteredPanels = registeredPanels.filter(
    (registration) => !assignedGroupsByPanelId.has(registration.panelId)
  );

  const groupedPanelIds = [
    ...tabGroups.right.tabs,
    ...tabGroups.bottom.tabs,
    ...tabGroups.floating.flatMap((group) => group.tabs),
  ];
  const unregisteredGroupedPanelIds = groupedPanelIds.filter(
    (panelId) => !panelRegistrations.has(panelId)
  );

  const groups = [
    {
      id: 'right',
      label: 'right',
      tabs: tabGroups.right.tabs,
      activeTab: tabGroups.right.activeTab,
    },
    {
      id: 'bottom',
      label: 'bottom',
      tabs: tabGroups.bottom.tabs,
      activeTab: tabGroups.bottom.activeTab,
    },
    ...tabGroups.floating.map((group) => ({
      id: `floating:${group.groupId}`,
      label: `floating:${group.groupId}`,
      tabs: group.tabs,
      activeTab: group.activeTab,
    })),
  ];

  return (
    <DebugOverlay title="Panel Debug (Ctrl+Alt+P)" testId="panel-debug-overlay" onClose={onClose}>
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Hierarchy ({registeredPanels.length} registered)</div>
        <div className="panel-debug-tree">
          {groups.map((group) => (
            <div
              key={group.id}
              className={`panel-debug-tree__group${focusedPanelId && group.tabs.includes(focusedPanelId) ? ' panel-debug-tree__group--focused' : ''}`}
            >
              <div className="panel-debug-tree__group-header">
                <span className="panel-debug-tree__group-name">{group.label}</span>
                <span className="panel-debug-tree__group-count">{group.tabs.length}</span>
              </div>
              {group.tabs.length === 0 ? (
                <div className="panel-debug-tree__empty">No tabs</div>
              ) : (
                <ul className="panel-debug-tree__tabs">
                  {group.tabs.map((panelId) => {
                    const registration = panelRegistrations.get(panelId);
                    const tabTitle = registration?.title ?? panelId;
                    const isActive = panelId === group.activeTab;
                    return (
                      <li key={panelId} className="panel-debug-tree__tab-item">
                        <span className="panel-debug-tree__branch" aria-hidden="true">
                          └
                        </span>
                        <div className="panel-debug-tree__tab-content">
                          <div className="panel-debug-tree__tab-row">
                            <span
                              className={`panel-debug-tree__status-dot${isActive ? ' panel-debug-tree__status-dot--active' : ''}`}
                              aria-hidden="true"
                            />
                            <span className="panel-debug-tree__tab-title" title={tabTitle}>
                              {tabTitle}
                            </span>
                          </div>
                          <div className="panel-debug-tree__tab-id" title={panelId}>
                            {panelId}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Integrity</div>
        <div className="panel-debug-tree__integrity-row">
          <span>unassigned registered</span>
          <strong>{ungroupedRegisteredPanels.length}</strong>
        </div>
        {ungroupedRegisteredPanels.length > 0 ? (
          <ul className="panel-debug-tree__ids">
            {ungroupedRegisteredPanels.map((panel) => (
              <li key={panel.panelId} title={panel.panelId}>
                {panel.panelId}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="panel-debug-tree__integrity-row">
          <span>unregistered grouped</span>
          <strong>{unregisteredGroupedPanelIds.length}</strong>
        </div>
        {unregisteredGroupedPanelIds.length > 0 ? (
          <ul className="panel-debug-tree__ids">
            {unregisteredGroupedPanelIds.map((panelId) => (
              <li key={panelId} title={panelId}>
                {panelId}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </DebugOverlay>
  );
};

const ErrorBoundaryDebugOverlay: React.FC<OverlayCloseProps> = ({ onClose }) => {
  return (
    <DebugOverlay
      title="Error Boundary Tests (Ctrl+Alt+E)"
      testId="error-debug-overlay"
      onClose={onClose}
    >
      <React.Suspense fallback={<div className="debug-overlay__meta">Loading error tests...</div>}>
        <DevTestErrorBoundaryLazy embedded />
      </React.Suspense>
    </DebugOverlay>
  );
};
