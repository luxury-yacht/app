/**
 * frontend/src/App.tsx
 *
 * Root application component.
 * Composes top-level providers, routes, and layout.
 */

import { useEffect, useCallback } from 'react';
import '@styles/index.css';
import './App.css';
import { errorHandler } from '@utils/errorHandler';
import { KeyboardProvider, GlobalShortcuts } from '@ui/shortcuts';
import TextContextMenu from '@ui/shortcuts/components/TextContextMenu';
import {
  refreshOrchestrator,
  initializeAutoRefresh,
  initializeMetricsRefreshInterval,
} from '@/core/refresh';
import { eventBus } from '@/core/events';
import { ConnectionStatusProvider, useConnectionStatus } from '@/core/connection/connectionStatus';
import { initializeUserPermissionsBootstrap } from '@/core/capabilities';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import {
  hydrateAppPreferences,
  getPaletteTint,
  getAccentColor,
  matchThemeForCluster,
  applyTheme,
} from '@/core/settings/appPreferences';
import {
  applyTintedPalette,
  savePaletteTintToLocalStorage,
  isPaletteActive,
} from '@utils/paletteTint';
import { applyAccentColor, applyAccentBg, saveAccentColorToLocalStorage } from '@utils/accentColor';

// Contexts
import { KubernetesProvider } from '@core/contexts/KubernetesProvider';
import { ClusterLifecycleProvider } from '@core/contexts/ClusterLifecycleContext';
import { FavoritesProvider } from '@core/contexts/FavoritesContext';
import { useViewState } from '@core/contexts/ViewStateContext';
import { ErrorProvider } from '@core/contexts/ErrorContext';
import { AuthErrorProvider } from '@core/contexts/AuthErrorContext';
import { ZoomProvider } from '@core/contexts/ZoomContext';

// App components
import { AppLayout } from '@ui/layout/AppLayout';
import { DockablePanelProvider } from '@ui/dockable';
import { TabDragProvider } from '@shared/components/tabs/dragCoordinator';

// Error Boundary
import { AppErrorBoundary } from '@ui/errors';

// Custom hooks
import { useBackendErrorHandler } from '@/hooks/useBackendErrorHandler';
import { useWailsRuntimeEvents, useConnectionStatusListener } from '@/hooks/useWailsRuntimeEvents';
import { useSidebarResize } from '@/hooks/useSidebarResize';

// Resolve the current active theme from the document attribute.
const resolveTheme = (): 'light' | 'dark' => {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'dark' ? 'dark' : 'light';
};

// Apply palette tint and accent color overrides for the given theme.
const applyThemeOverrides = (theme: 'light' | 'dark') => {
  const tint = getPaletteTint(theme);
  if (isPaletteActive(tint.saturation, tint.brightness)) {
    applyTintedPalette(tint.hue, tint.saturation, tint.brightness);
  } else {
    applyTintedPalette(0, 0, 0);
  }
  savePaletteTintToLocalStorage(theme, tint.hue, tint.saturation, tint.brightness);

  const lightAccent = getAccentColor('light');
  const darkAccent = getAccentColor('dark');
  applyAccentColor(lightAccent, darkAccent);
  applyAccentBg(theme === 'light' ? lightAccent : darkAccent, theme);
  saveAccentColorToLocalStorage('light', lightAccent);
  saveAccentColorToLocalStorage('dark', darkAccent);
};

/**
 * AppContent - The main app content that uses the contexts
 */
function AppContent() {
  const viewState = useViewState();
  const connectionStatus = useConnectionStatus();
  const { selectedClusterId, selectedClusterName } = useKubeconfig();

  // Initialize permissions bootstrap
  useEffect(() => {
    initializeUserPermissionsBootstrap(selectedClusterId);
  }, [selectedClusterId]);

  // Hydrate persisted preferences before applying refresh settings and palette tint.
  useEffect(() => {
    let active = true;

    const initializePreferences = async () => {
      try {
        await hydrateAppPreferences();
        if (!active) return;

        // Apply palette tint for the current resolved theme.
        const currentTheme = resolveTheme();
        const tint = getPaletteTint(currentTheme);
        if (isPaletteActive(tint.saturation, tint.brightness)) {
          applyTintedPalette(tint.hue, tint.saturation, tint.brightness);
          savePaletteTintToLocalStorage(currentTheme, tint.hue, tint.saturation, tint.brightness);
        }

        // Apply accent color overrides for both palettes and accent-bg for the current theme.
        const lightAccent = getAccentColor('light');
        const darkAccent = getAccentColor('dark');
        if (lightAccent || darkAccent) {
          applyAccentColor(lightAccent, darkAccent);
          applyAccentBg(currentTheme === 'light' ? lightAccent : darkAccent, currentTheme);
        }
        saveAccentColorToLocalStorage('light', lightAccent);
        saveAccentColorToLocalStorage('dark', darkAccent);
      } finally {
        if (active) {
          initializeMetricsRefreshInterval();
          initializeAutoRefresh();
        }
      }
    };
    void initializePreferences();

    // When the resolved theme changes, apply the palette for the new theme.
    const unsubThemeResolved = eventBus.on('settings:theme-resolved', (newTheme) => {
      if (!active) return;
      applyThemeOverrides(newTheme);
    });

    return () => {
      active = false;
      unsubThemeResolved();
    };
  }, []);

  // Auto-apply a matching theme when the active cluster changes.
  useEffect(() => {
    if (!selectedClusterName) return;

    const applyMatchingTheme = async () => {
      const matched = await matchThemeForCluster(selectedClusterName);
      if (!matched) return;

      await applyTheme(matched.id);

      // Re-hydrate the preference cache so getPaletteTint/getAccentColor reflect new values.
      await hydrateAppPreferences({ force: true });

      // Re-apply CSS overrides for the current resolved theme.
      applyThemeOverrides(resolveTheme());
    };

    void applyMatchingTheme();
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
    viewState.toggleAppLogs();
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
    onToggleSidebar: () => viewState.toggleSidebar(),
    onToggleAppLogs: handleToggleAppLogsPanel,
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
    return eventBus.on('view:toggle-app-logs', handleToggleAppLogsPanel);
  }, [handleToggleAppLogsPanel]);

  // Handle manual refresh (Cmd+R)
  const manualRefreshBlocked = ['offline', 'auth_failed', 'rebuilding'].includes(
    connectionStatus.state
  );

  const handleManualRefresh = useCallback(() => {
    if (manualRefreshBlocked) {
      return;
    }
    refreshOrchestrator.triggerManualRefreshForContext().catch((error) => {
      errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
        source: 'manual-refresh',
      });
    });
  }, [manualRefreshBlocked]);

  return (
    <>
      <GlobalShortcuts
        onToggleSidebar={viewState.toggleSidebar}
        onToggleLogsPanel={handleToggleAppLogsPanel}
        onToggleSettings={() => viewState.setIsSettingsOpen(!viewState.isSettingsOpen)}
        onToggleObjectDiff={() => viewState.setIsObjectDiffOpen(!viewState.isObjectDiffOpen)}
        onCreateResource={() => viewState.setIsCreateResourceOpen(true)}
        onRefresh={handleManualRefresh}
        onToggleDiagnostics={handleToggleDiagnostics}
        viewType={viewState.viewType}
        isLogsPanelOpen={viewState.showAppLogs}
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
                    <ClusterLifecycleProvider>
                      <FavoritesProvider>
                        <TabDragProvider>
                          <DockablePanelProvider>
                            <AppContent />
                          </DockablePanelProvider>
                        </TabDragProvider>
                      </FavoritesProvider>
                    </ClusterLifecycleProvider>
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
