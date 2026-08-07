/**
 * frontend/src/ui/layout/AppLayout.tsx
 *
 * Module source for AppLayout.
 * Implements AppLayout logic for the UI layer.
 */

import captainK8s from '@assets/captain-k8s-color.png';
// Assets
import logo from '@assets/luxury-yacht-logo.png';
import React, { useCallback, useEffect, useRef, useState } from 'react';
// App Stuff
import '@/App.css';
import { useViewState } from '@core/contexts/ViewStateContext';
import ClusterOverview from '@modules/cluster/components/ClusterOverview';
import { ClusterResourcesManager } from '@modules/cluster/components/ClusterResourcesManager';
import GlobalViews from '@modules/global/components/GlobalViews';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import AllNamespacesView from '@modules/namespace/components/AllNamespacesView';
import NamespaceResourcesViews from '@modules/namespace/components/NsResourcesViews';
import { isAllNamespaces } from '@modules/namespace/constants';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { NamespaceResourcesProvider } from '@modules/namespace/contexts/NsResourcesContext';
import {
  type ObjectMapDebugSnapshot,
  setObjectMapDebugOverlayVisible,
  useObjectMapDebugSnapshots,
} from '@modules/object-map/objectMapDebugStore';
import { useObjectPanelState } from '@modules/object-panel/contexts/ObjectPanelStateContext';
// Error Handling
import { ErrorNotificationSystem } from '@shared/components/errors/ErrorNotificationSystem';
import { CopyIcon } from '@shared/components/icons/LogIcons';
import { withLazyBoundary } from '@shared/utils/react/withLazyBoundary';
// Command Palette
import { CommandPalette } from '@ui/command-palette/CommandPalette';
import { useCommandPaletteCommands } from '@ui/command-palette/CommandPaletteCommands';
import { getAllPanelStates, useDockablePanelContext } from '@ui/dockable';
import { useDockablePanelEmptySpaceDropTarget } from '@ui/dockable/DockablePanelContentArea';
import { usePanelSurfaceCycling } from '@ui/dockable/usePanelSurfaceCycling';
import { PanelErrorBoundary, RouteErrorBoundary } from '@ui/errors';
// Content Components
import AppHeader from '@ui/layout/AppHeader';
import {
  useContentRegionShiftTabHandoff,
  useTopLevelAppRegionTracking,
} from '@ui/layout/appFocusRegions';
import ClusterTabs from '@ui/layout/ClusterTabs';
import { getClusterSelectionPhase } from '@ui/layout/clusterSelectionPhase';
import { DebugOverlay } from '@ui/layout/DebugOverlay';
import { IconDebugOverlay } from '@ui/layout/IconDebugOverlay';
import { useAppDebugShortcuts } from '@ui/layout/useAppDebugShortcuts';
import type { NamespaceViewType } from '@ui/navigation/types';
// Auth Failure Overlay
import { AuthFailureOverlay } from '@ui/overlays/AuthFailureOverlay';
import { eventBus } from '@/core/events';
import { shouldShowActiveClusterAuthFailure } from '@/core/navigation/workspace';
import { DiagnosticsPanel } from '@/core/refresh/components/DiagnosticsPanel';
import {
  getSidebarWidthFromKey,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '@/hooks/useSidebarResize';
import BrowseView from '@/modules/browse/components/BrowseView';
import { isMacPlatform } from '@/utils/platform';

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
const AppLogsPanel = withLazyBoundary(
  () => import('@ui/panels/app-logs/AppLogsPanel'),
  'Loading Application Logs Panel...'
);

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
  onTabChange,
}: {
  selectedNamespace?: string;
  activeNamespaceTab: NamespaceViewType | null;
  onTabChange: (tab: NamespaceViewType) => void;
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
          onTabChange={onTabChange}
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
        <ClusterResourcesManager
          activeTab={viewState.activeClusterTab}
          onTabChange={viewState.setActiveClusterView}
        />
      </RouteErrorBoundary>
    );
  }
  if (viewState.viewType === 'namespace') {
    return (
      <NamespaceRouteContent
        selectedNamespace={namespace.selectedNamespace}
        activeNamespaceTab={viewState.activeNamespaceTab}
        onTabChange={viewState.setActiveNamespaceTab}
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

const ClusterSelectionOverlay = ({ phase }: { phase: string }) => {
  if (phase !== 'empty') {
    return null;
  }
  return (
    <div className="no-active-clusters-overlay" role="status">
      <div className="no-active-clusters-message">
        No active clusters. Press <kbd>{isMacPlatform() ? '⌘' : 'Ctrl'}</kbd>+<kbd>O</kbd> or click
        Open Cluster.
      </div>
    </div>
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

interface AppDebugOverlaysProps {
  panel: boolean;
  focus: boolean;
  error: boolean;
  map: boolean;
  icon: boolean;
  closePanel: () => void;
  closeFocus: () => void;
  closeError: () => void;
  closeMap: () => void;
  closeIcon: () => void;
}

const AppDebugOverlays = (props: AppDebugOverlaysProps) => (
  <>
    {props.panel ? <PanelDebugOverlay onClose={props.closePanel} /> : null}
    {props.focus ? <KeyboardFocusOverlay onClose={props.closeFocus} /> : null}
    {props.error ? <ErrorBoundaryDebugOverlay onClose={props.closeError} /> : null}
    {props.map ? <MapDebugOverlay onClose={props.closeMap} /> : null}
    {props.icon ? <IconDebugOverlay onClose={props.closeIcon} /> : null}
  </>
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
  const [isMapDebugOverlayVisible, setIsMapDebugOverlayVisible] = useState(false);
  const [isIconDebugOverlayVisible, setIsIconDebugOverlayVisible] = useState(false);
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
    onToggleMapDebug: () => setIsMapDebugOverlayVisible((prev) => !prev),
    onToggleIconDebug: () => setIsIconDebugOverlayVisible((prev) => !prev),
  });
  useContentRegionShiftTabHandoff(contentBodyRef, hasActiveClusters);
  useTopLevelAppRegionTracking(hasActiveClusters);
  usePanelSurfaceCycling({
    tabGroups,
    focusPanel,
    setLastFocusedGroupKey,
  });

  useEffect(() => {
    setObjectMapDebugOverlayVisible(isMapDebugOverlayVisible);
    return () => setObjectMapDebugOverlayVisible(false);
  }, [isMapDebugOverlayVisible]);

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
      <AppHeader />
      <ClusterTabs onOpenCluster={handleOpenCluster} />

      <main
        ref={emptySpaceDropRef as (el: HTMLElement | null) => void}
        className={`app-main ${hasActiveClusters ? '' : 'app-main-inactive'}`}
      >
        <Sidebar />
        <SidebarResizer viewState={viewState} />

        <div className="content">
          <div ref={contentBodyRef} className="content-body" data-app-region="content">
            <div className="content-body__main">{routeContent}</div>
          </div>
        </div>
        <ClusterSelectionOverlay phase={clusterSelectionPhase} />
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
      <ErrorNotificationSystem />
      <CommandPalette commands={commands} />
      <AppDebugOverlays
        panel={isPanelDebugOverlayVisible}
        focus={isFocusOverlayVisible}
        error={isErrorOverlayVisible}
        map={isMapDebugOverlayVisible}
        icon={isIconDebugOverlayVisible}
        closePanel={() => setIsPanelDebugOverlayVisible(false)}
        closeFocus={() => setIsFocusOverlayVisible(false)}
        closeError={() => setIsErrorOverlayVisible(false)}
        closeMap={() => setIsMapDebugOverlayVisible(false)}
        closeIcon={() => setIsIconDebugOverlayVisible(false)}
      />
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

const formatDisabledState = (disabled: boolean | null): string => {
  if (disabled === null) {
    return 'n/a';
  }
  return disabled ? 'true' : 'false';
};

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
    ['Disabled', formatDisabledState(focusInfo.disabled)],
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
  const dataFocusArea = element.dataset.focusArea;
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

const getFocusArea = (element: HTMLElement) => {
  const direct = element.dataset.focusArea;
  if (direct) {
    return direct;
  }
  return element.closest<HTMLElement>('[data-focus-area]')?.dataset.focusArea ?? null;
};

const getFocusSummary = (
  element: HTMLElement,
  focusArea: string | null,
  label: string | null,
  text: string | null
) => {
  if (focusArea) {
    return focusArea;
  }
  if (label) {
    return label;
  }
  const tag = element.tagName.toLowerCase();
  if (element.id) {
    return `${tag}#${element.id}`;
  }
  if (text) {
    return `${tag} "${text}"`;
  }
  return tag;
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

  const focusArea = getFocusArea(element);
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
    summary: getFocusSummary(element, focusArea, label, summarizedText),
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
        overlayElement?.contains(event.target as Node)
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
          <CopyIcon width={18} height={18} />
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
        <div className="debug-overlay__value">{formatDisabledState(focusInfo.disabled)}</div>
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
  tabGroups.right.tabs.forEach((panelId) => {
    assignedGroupsByPanelId.set(panelId, 'right');
  });
  tabGroups.bottom.tabs.forEach((panelId) => {
    assignedGroupsByPanelId.set(panelId, 'bottom');
  });
  tabGroups.floating.forEach((group) => {
    group.tabs.forEach((panelId) => {
      assignedGroupsByPanelId.set(panelId, `floating:${group.groupId}`);
    });
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

const formatObjectMapDebugRef = (ref: ObjectMapDebugSnapshot['seedRef']): string => {
  const namespace = ref.namespace ? `${ref.namespace}/` : '';
  const api = `${ref.group || 'core'}/${ref.version}`;
  return `${ref.clusterId} ${api} ${ref.kind} ${namespace}${ref.name}`;
};

const formatObjectMapDebugBounds = (bounds: ObjectMapDebugSnapshot['layout']['bounds']): string =>
  `x ${Math.round(bounds.minX)}..${Math.round(bounds.maxX)}, y ${Math.round(bounds.minY)}..${Math.round(bounds.maxY)}`;

const formatObjectMapDebugVector = (value: [number, number]): string =>
  `${value[0].toFixed(1)}, ${value[1].toFixed(1)}`;

const formatObjectMapDebugMs = (value: number | null): string => {
  if (value === null) {
    return 'unknown';
  } else {
    return `${value.toFixed(value < 10 ? 2 : 1)} ms`;
  }
};

const formatDebugBoolean = (value: boolean) => (value ? 'true' : 'false');

const formatRendererCounts = (map: ObjectMapDebugSnapshot) => {
  if (!map.renderer) {
    return 'unknown';
  }
  return `${map.renderer.renderedNodeCount} objects / ${map.renderer.renderedEdgeCount} links`;
};

const formatSelectedKinds = (map: ObjectMapDebugSnapshot) =>
  map.selectedKinds.mode === 'some' ? map.selectedKinds.values.join(', ') : map.selectedKinds.mode;

const formatEnabledEdgeTypes = (map: ObjectMapDebugSnapshot) => {
  if (!map.enabledEdgeTypes) {
    return 'all';
  }
  return map.enabledEdgeTypes.join(', ') || 'none';
};

const formatMapSearch = (map: ObjectMapDebugSnapshot) =>
  map.search.query ? `"${map.search.query}" (${map.search.matches})` : 'none';

const ObjectMapViewportDebug = ({ map }: { map: ObjectMapDebugSnapshot }) => {
  if (!map.renderer?.viewport) {
    return <div className="debug-overlay__meta">No renderer viewport snapshot.</div>;
  }
  return (
    <dl className="map-debug-grid">
      <dt>ready</dt>
      <dd>{formatDebugBoolean(map.renderer.graphReady)}</dd>
      <dt>zoom</dt>
      <dd>{map.renderer.viewport.zoom.toFixed(3)}</dd>
      <dt>position</dt>
      <dd>{formatObjectMapDebugVector(map.renderer.viewport.position)}</dd>
      <dt>size</dt>
      <dd>{formatObjectMapDebugVector(map.renderer.viewport.size)}</dd>
      <dt>cards</dt>
      <dd>{map.renderer.cardDetailLevel}</dd>
      <dt>links</dt>
      <dd>{map.renderer.edgeDetailLevel}</dd>
    </dl>
  );
};

const ObjectMapTimingDebug = ({ map }: { map: ObjectMapDebugSnapshot }) => {
  const applyMode = map.renderer?.timings.graphDataApplyMode;
  return (
    <dl className="map-debug-grid">
      <dt>model</dt>
      <dd>{formatObjectMapDebugMs(map.timings.modelMs)}</dd>
      <dt>visible</dt>
      <dd>{formatObjectMapDebugMs(map.timings.visibleStateMs)}</dd>
      <dt>g6 data</dt>
      <dd>{formatObjectMapDebugMs(map.renderer?.timings.g6DataMs ?? null)}</dd>
      <dt>g6 apply</dt>
      <dd>
        {formatObjectMapDebugMs(map.renderer?.timings.graphDataApplyMs ?? null)}
        {applyMode ? ` (${applyMode})` : ''}
      </dd>
      <dt>selection</dt>
      <dd>{formatObjectMapDebugMs(map.renderer?.timings.selectionStateApplyMs ?? null)}</dd>
    </dl>
  );
};

const ObjectMapDebugEntry = ({ map }: { map: ObjectMapDebugSnapshot }) => (
  <div className="map-debug-entry">
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Map</div>
      <div className="debug-overlay__value">{map.id}</div>
      <div className="debug-overlay__meta">
        {map.clusterName ?? map.clusterId} - updated {new Date(map.updatedAt).toLocaleTimeString()}
      </div>
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Seed</div>
      <div className="debug-overlay__value">{formatObjectMapDebugRef(map.seedRef)}</div>
      <div className="debug-overlay__meta">seed node: {map.seedNodeId || 'none'}</div>
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">State</div>
      <dl className="map-debug-grid">
        <dt>auto-fit</dt>
        <dd>{map.autoFit ? 'on' : 'off'}</dd>
        <dt>focus</dt>
        <dd>{map.focusMode ? 'on' : 'off'}</dd>
        <dt>active</dt>
        <dd>{map.activeNodeId ?? 'none'}</dd>
        <dt>preserve</dt>
        <dd>{map.preserveViewportNodeId ?? 'none'}</dd>
      </dl>
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Counts</div>
      <dl className="map-debug-grid">
        <dt>payload</dt>
        <dd>
          {map.payload.nodes} objects / {map.payload.edges} links
        </dd>
        <dt>layout</dt>
        <dd>
          {map.layout.nodes} objects / {map.layout.edges} links
        </dd>
        <dt>visible</dt>
        <dd>
          {map.visibleLayout.nodes} objects / {map.visibleLayout.edges} links
        </dd>
        <dt>rendered</dt>
        <dd>{formatRendererCounts(map)}</dd>
      </dl>
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Viewport</div>
      <ObjectMapViewportDebug map={map} />
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Timings</div>
      <ObjectMapTimingDebug map={map} />
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Filters</div>
      <dl className="map-debug-grid">
        <dt>kinds</dt>
        <dd>{formatSelectedKinds(map)}</dd>
        <dt>links</dt>
        <dd>{formatEnabledEdgeTypes(map)}</dd>
        <dt>search</dt>
        <dd>{formatMapSearch(map)}</dd>
      </dl>
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Bounds</div>
      <dl className="map-debug-grid">
        <dt>layout</dt>
        <dd>{formatObjectMapDebugBounds(map.layout.bounds)}</dd>
        <dt>visible</dt>
        <dd>{formatObjectMapDebugBounds(map.visibleLayout.bounds)}</dd>
      </dl>
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Limits</div>
      <dl className="map-debug-grid">
        <dt>max depth</dt>
        <dd>{map.payload.maxDepth}</dd>
        <dt>max objects</dt>
        <dd>{map.payload.maxNodes}</dd>
        <dt>truncated</dt>
        <dd>{formatDebugBoolean(map.payload.truncated)}</dd>
        <dt>warnings</dt>
        <dd>{map.payload.warnings}</dd>
      </dl>
    </div>
  </div>
);

const ObjectMapDebugEntries = ({ maps }: { maps: ObjectMapDebugSnapshot[] }) => {
  if (maps.length === 0) {
    return <div className="debug-overlay__meta">No object maps are mounted.</div>;
  }
  return maps.map((map) => <ObjectMapDebugEntry key={map.id} map={map} />);
};

const MapDebugOverlay: React.FC<OverlayCloseProps> = ({ onClose }) => {
  const maps = useObjectMapDebugSnapshots();

  return (
    <DebugOverlay title="Map Debug (Ctrl+Alt+M)" testId="map-debug-overlay" onClose={onClose}>
      <ObjectMapDebugEntries maps={maps} />
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
