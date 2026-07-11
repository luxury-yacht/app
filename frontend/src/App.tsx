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
import { ZoomProvider } from '@core/contexts/ZoomContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { TabDragProvider } from '@shared/components/tabs/dragCoordinator';
import { DockablePanelProvider } from '@ui/dockable';
// Error Boundary
import { AppErrorBoundary } from '@ui/errors';
// App components
import { AppLayout } from '@ui/layout/AppLayout';
import { GlobalShortcuts, KeyboardProvider } from '@ui/shortcuts';
import TextContextMenu from '@ui/shortcuts/components/TextContextMenu';
import { applyAccentBg, applyAccentColor } from '@utils/accentColor';
import { errorHandler } from '@utils/errorHandler';
import { installTypingAssistPolicyObserver } from '@utils/inputAssistPolicy';
import { applyLinkColor } from '@utils/linkColor';
import { applyTintedPalette, isPaletteActive } from '@utils/paletteTint';
import { setActivePermissionCluster } from '@/core/capabilities';
import { ConnectionStatusProvider, useConnectionStatus } from '@/core/connection/connectionStatus';
import { requestContextRefresh } from '@/core/data-access';
import { eventBus } from '@/core/events';
import {
  applyTheme,
  getAccentColor,
  getLinkColor,
  getPaletteTint,
  hydrateAppPreferences,
  matchThemeForCluster,
} from '@/core/settings/appPreferences';
import { autoApplyClusterTheme } from '@/core/settings/clusterThemeAutoApply';
// Custom hooks
import { useBackendErrorHandler } from '@/hooks/useBackendErrorHandler';
import { useSidebarResize } from '@/hooks/useSidebarResize';
import { useConnectionStatusListener, useWailsRuntimeEvents } from '@/hooks/useWailsRuntimeEvents';

// Resolve the current active appearance mode from the document attribute.
const resolveAppearanceMode = (): 'light' | 'dark' => {
  const attr = document.documentElement.getAttribute('data-appearance-mode');
  return attr === 'dark' ? 'dark' : 'light';
};

// Apply palette tint and accent color overrides for the given mode.
const applyAppearanceOverrides = (mode: 'light' | 'dark') => {
  const tint = getPaletteTint(mode);
  if (isPaletteActive(tint.saturation, tint.brightness)) {
    applyTintedPalette(tint.hue, tint.saturation, tint.brightness);
  } else {
    applyTintedPalette(0, 0, 0);
  }

  const lightAccent = getAccentColor('light');
  const darkAccent = getAccentColor('dark');
  applyAccentColor(lightAccent, darkAccent);
  applyAccentBg(mode === 'light' ? lightAccent : darkAccent, mode);

  const lightLink = getLinkColor('light');
  const darkLink = getLinkColor('dark');
  applyLinkColor(mode === 'light' ? lightLink : darkLink, mode);
};

/**
 * AppContent - The main app content that uses the contexts
 */
function AppContent() {
  const viewState = useViewState();
  const connectionStatus = useConnectionStatus();
  const { selectedClusterId, selectedClusterName } = useKubeconfig();
  const { isClusterReady } = useClusterLifecycle();
  const selectedClusterReady = selectedClusterId ? isClusterReady(selectedClusterId) : false;
  const themeApplyRunRef = useRef(0);

  // Track the selected cluster in the permission store.
  useEffect(() => {
    setActivePermissionCluster(selectedClusterId, { ready: selectedClusterReady });
  }, [selectedClusterId, selectedClusterReady]);

  // main.ts hydrates preferences before first render. This effect only replays
  // the hydrated appearance values into CSS and keeps them synced on mode changes.
  useEffect(() => {
    let active = true;

    applyAppearanceOverrides(resolveAppearanceMode());

    // When the resolved mode changes, apply the palette for the new mode.
    const unsubscribeModeResolved = eventBus.on('settings:appearance-mode-resolved', (newMode) => {
      if (!active) {
        return;
      }
      applyAppearanceOverrides(newMode);
    });

    return () => {
      active = false;
      unsubscribeModeResolved();
    };
  }, []);

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

  // Handle connection status events from Wails runtime
  useConnectionStatusListener();

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

  // Handle Wails runtime events (menu items, etc.)
  useWailsRuntimeEvents({
    onOpenSettings: () => viewState.setIsSettingsOpen(true),
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
  // the user picks "Toggle Application Logs". Forward it to the same
  // handler the keyboard shortcut + tray menu use, so all paths share
  // the single source of truth in ModalStateContext.
  useEffect(() => {
    return eventBus.on('view:toggle-app-logs-panel', handleToggleAppLogsPanel);
  }, [handleToggleAppLogsPanel]);

  // Handle manual refresh (Cmd+R)
  const manualRefreshBlocked = ['offline', 'auth_failed', 'rebuilding'].includes(
    connectionStatus.state
  );

  const handleManualRefresh = useCallback(() => {
    if (manualRefreshBlocked) {
      return;
    }
    requestContextRefresh({ reason: 'user' }).catch((error) => {
      errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
        source: 'manual-refresh',
      });
    });
  }, [manualRefreshBlocked]);

  return (
    <>
      <GlobalShortcuts
        onToggleSidebar={viewState.toggleSidebar}
        onToggleAppLogsPanel={handleToggleAppLogsPanel}
        onToggleSettings={() => viewState.setIsSettingsOpen(!viewState.isSettingsOpen)}
        onToggleObjectDiff={() => viewState.setIsObjectDiffOpen(!viewState.isObjectDiffOpen)}
        onRefresh={handleManualRefresh}
        onToggleDiagnostics={handleToggleDiagnostics}
        isAppLogsPanelOpen={viewState.showAppLogsPanel}
        isObjectPanelOpen={viewState.showObjectPanel}
        isSettingsOpen={viewState.isSettingsOpen}
      />
      <TextContextMenu />
      <AppLayout />
    </>
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
            <ConnectionStatusProvider>
              <AuthErrorProvider>
                <div className="app">
                  <KubernetesProvider>
                    <FavoritesProvider>
                      <TabDragProvider>
                        <DockablePanelProvider>
                          <AppContent />
                        </DockablePanelProvider>
                      </TabDragProvider>
                    </FavoritesProvider>
                  </KubernetesProvider>
                </div>
              </AuthErrorProvider>
            </ConnectionStatusProvider>
          </KeyboardProvider>
        </ZoomProvider>
      </ErrorProvider>
    </AppErrorBoundary>
  );
}

export default App;
