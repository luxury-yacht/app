/**
 * frontend/src/App.tsx
 *
 * Root application component.
 * Composes top-level providers, routes, and layout.
 */

import { useCallback, useEffect, useRef } from 'react';
import '@styles/index.css';
import './App.css';
import { AuthErrorProvider } from '@core/contexts/AuthErrorContext';
import { useClusterLifecycle } from '@core/contexts/ClusterLifecycleContext';
import { ErrorProvider } from '@core/contexts/ErrorContext';
import { FavoritesProvider } from '@core/contexts/FavoritesContext';
// Contexts
import { KubernetesProvider } from '@core/contexts/KubernetesProvider';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useZoom, ZoomProvider } from '@core/contexts/ZoomContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
// Error Boundary
import { AppErrorBoundary } from '@ui/errors';
// App components
import { AppLayout } from '@ui/layout/AppLayout';
import { ApplicationMenuShortcuts, GlobalShortcuts, KeyboardProvider } from '@ui/shortcuts';
import TextContextMenu from '@ui/shortcuts/components/TextContextMenu';
import { errorHandler } from '@utils/errorHandler';
import { installTypingAssistPolicyObserver } from '@utils/inputAssistPolicy';
import type { backend } from '@/core/backend-api/models';
import { setActivePermissionCluster } from '@/core/capabilities';
import { isClusterOperationalState } from '@/core/contexts/clusterLifecycleState';
import { requestContextRefresh } from '@/core/data-access';
import { openDevTools } from '@/core/desktop-runtime';
import { eventBus } from '@/core/events';
import { PanelLifecycleGuardProvider } from '@/core/panel-windows/panelLifecycleGuards';
import { WorkspacePanelCoordinator } from '@/core/panel-windows/WorkspacePanelCoordinator';
import {
  applyTheme,
  hydrateAppPreferences,
  matchThemeForCluster,
} from '@/core/settings/appPreferences';
import { autoApplyClusterTheme } from '@/core/settings/clusterThemeAutoApply';
// Custom hooks
import { useBackendErrorHandler } from '@/hooks/useBackendErrorHandler';
import { useSidebarResize } from '@/hooks/useSidebarResize';
import { useWailsRuntimeEvents } from '@/hooks/useWailsRuntimeEvents';
import {
  ApplicationMenuCommandProvider,
  executeBackendApplicationMenuCommand,
} from '@/ui/layout/ApplicationMenuCommandContext';
import {
  dispatchWorkspaceApplicationMenuCommand,
  type WorkspaceApplicationMenuActions,
} from '@/ui/layout/workspaceApplicationMenuCommands';
import { applyAppearanceOverrides, resolveAppearanceMode } from '@/utils/appearanceMode';

/**
 * AppContent - The main app content that uses the contexts
 */
function AppContent() {
  const viewState = useViewState();
  const { selectedClusterId, selectedClusterName } = useKubeconfig();
  const { resetZoom, zoomIn, zoomOut } = useZoom();
  const { getClusterState } = useClusterLifecycle();
  const selectedClusterOperational = selectedClusterId
    ? isClusterOperationalState(getClusterState(selectedClusterId))
    : false;
  const themeApplyRunRef = useRef(0);

  // Track the selected cluster in the permission store.
  useEffect(() => {
    setActivePermissionCluster(selectedClusterId, { operational: selectedClusterOperational });
  }, [selectedClusterId, selectedClusterOperational]);

  // Disable browser typing assistance for every current and future input-like
  // field in the app. This keeps search boxes, forms, and editable surfaces
  // consistent without requiring per-component opt-in.
  useEffect(() => {
    return installTypingAssistPolicyObserver();
  }, []);

  // Auto-apply a matching theme when the active cluster changes.
  useEffect(() => {
    const runId = ++themeApplyRunRef.current;
    if (!selectedClusterName) {
      return;
    }

    void autoApplyClusterTheme({
      selectedClusterName,
      isCurrent: () => themeApplyRunRef.current === runId,
      matchThemeForCluster,
      applyTheme,
      hydrateAppPreferences,
      applyAppearanceOverrides: () => applyAppearanceOverrides(resolveAppearanceMode()),
      onError: (error) => errorHandler.handle(error, { action: 'autoApplyClusterTheme' }),
    });
  }, [selectedClusterName]);

  // Handle backend errors from Wails runtime
  useBackendErrorHandler();

  // Callbacks for UI actions
  const handleToggleAppLogsPanel = useCallback(() => {
    // App logs is an app-global tool panel (like Settings, About). Its
    // open/close lives in ModalStateContext via viewState, not in the
    // per-cluster panel layout store. Toggling it directly keeps both
    // the keyboard shortcut and command-palette paths in sync.
    viewState.toggleAppLogsPanel();
  }, [viewState]);

  const handleToggleDiagnostics = useCallback(() => {
    eventBus.emit('view:toggle-diagnostics');
  }, []);

  const handleToggleObjectDiff = useCallback(() => {
    viewState.setIsObjectDiffOpen(!viewState.isObjectDiffOpen);
  }, [viewState]);

  const handleToggleSettings = useCallback(() => {
    viewState.setIsSettingsOpen(!viewState.isSettingsOpen);
  }, [viewState]);

  const executeApplicationMenuCommand = useCallback(
    (menuCommand: backend.ApplicationMenuCommand) => {
      const actions: WorkspaceApplicationMenuActions = {
        close: () => eventBus.emit('application-menu:close'),
        openCluster: () => eventBus.emit('command-palette:open-kubeconfigs'),
        toggleSettings: handleToggleSettings,
        openCommandPalette: () => eventBus.emit('command-palette:open'),
        zoomIn,
        zoomOut,
        zoomReset: resetZoom,
        toggleSidebar: viewState.toggleSidebar,
        toggleObjectDiff: handleToggleObjectDiff,
        toggleAppLogs: handleToggleAppLogsPanel,
        toggleDiagnostics: handleToggleDiagnostics,
        openInspector: () => {
          void openDevTools().catch((error) =>
            errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
              source: 'application-menu-inspector',
            })
          );
        },
        toggleFocusDebug: () => eventBus.emit('debug:toggle-focus-overlay'),
        togglePanelDebug: () => eventBus.emit('debug:toggle-panel-overlay'),
        toggleMapDebug: () => eventBus.emit('debug:toggle-map-overlay'),
        toggleIconDebug: () => eventBus.emit('debug:toggle-icon-overlay'),
        toggleErrorDebug: () => eventBus.emit('debug:toggle-error-overlay'),
        openAbout: () => viewState.setIsAboutOpen(true),
      };
      if (!dispatchWorkspaceApplicationMenuCommand(menuCommand, actions)) {
        executeBackendApplicationMenuCommand(menuCommand);
      }
    },
    [
      handleToggleAppLogsPanel,
      handleToggleDiagnostics,
      handleToggleObjectDiff,
      handleToggleSettings,
      resetZoom,
      viewState,
      zoomIn,
      zoomOut,
    ]
  );

  // Handle Wails runtime events (menu items, etc.)
  useWailsRuntimeEvents({
    onOpenSettings: handleToggleSettings,
    onOpenAbout: () => viewState.setIsAboutOpen(true),
    onOpenCluster: () => eventBus.emit('command-palette:open-kubeconfigs'),
    onToggleSidebar: () => viewState.toggleSidebar(),
    onToggleAppLogsPanel: handleToggleAppLogsPanel,
    onToggleDiagnostics: handleToggleDiagnostics,
    onToggleObjectDiff: handleToggleObjectDiff,
  });

  // Handle sidebar resize
  useSidebarResize({
    isResizing: viewState.isResizing,
    onWidthChange: (width: number) => viewState.setSidebarWidth(width),
    onResizeEnd: () => viewState.setIsResizing(false),
  });

  // The command palette (CommandPaletteCommands.tsx) emits this event when
  // the user picks "Toggle Application Logs". Forward it to the shared
  // handler also used by keyboard shortcuts and application-menu events, so every
  // path shares the single source of truth in ModalStateContext.
  useEffect(() => {
    return eventBus.on('view:toggle-app-logs-panel', handleToggleAppLogsPanel);
  }, [handleToggleAppLogsPanel]);

  // Handle manual refresh (Cmd+R)
  const handleManualRefresh = useCallback(() => {
    requestContextRefresh({ reason: 'user' }).catch((error) => {
      errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
        source: 'manual-refresh',
      });
    });
  }, []);

  return (
    <ApplicationMenuCommandProvider execute={executeApplicationMenuCommand}>
      <ApplicationMenuShortcuts />
      <GlobalShortcuts
        onToggleAppLogsPanel={handleToggleAppLogsPanel}
        onToggleSettings={handleToggleSettings}
        onRefresh={handleManualRefresh}
        isAppLogsPanelOpen={viewState.showAppLogsPanel}
        isObjectPanelOpen={viewState.showObjectPanel}
        isSettingsOpen={viewState.isSettingsOpen}
      />
      <TextContextMenu />
      <AppLayout />
    </ApplicationMenuCommandProvider>
  );
}

/**
 * App - The root component that sets up all providers
 */
function App() {
  return (
    <AppErrorBoundary>
      <ErrorProvider>
        <ZoomProvider>
          <KeyboardProvider>
            <AuthErrorProvider>
              <div className="app">
                <KubernetesProvider>
                  <FavoritesProvider>
                    <PanelLifecycleGuardProvider>
                      <WorkspacePanelCoordinator>
                        <AppContent />
                      </WorkspacePanelCoordinator>
                    </PanelLifecycleGuardProvider>
                  </FavoritesProvider>
                </KubernetesProvider>
              </div>
            </AuthErrorProvider>
          </KeyboardProvider>
        </ZoomProvider>
      </ErrorProvider>
    </AppErrorBoundary>
  );
}

export default App;
