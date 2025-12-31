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
import { refreshOrchestrator, initializeAutoRefresh } from '@/core/refresh';
import { eventBus } from '@/core/events';
import { ConnectionStatusProvider, useConnectionStatus } from '@/core/connection/connectionStatus';
import { initializeUserPermissionsBootstrap } from '@/core/capabilities';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { hydrateAppPreferences } from '@/core/settings/appPreferences';
import { migrateLegacyLocalStorage } from '@/core/settings/legacyMigration';

// Contexts
import { KubernetesProvider } from '@core/contexts/KubernetesProvider';
import { useViewState } from '@core/contexts/ViewStateContext';
import { ErrorProvider } from '@core/contexts/ErrorContext';

// App components
import { AppLayout } from '@ui/layout/AppLayout';
import { useAppLogsPanel } from '@/components/content/AppLogsPanel/AppLogsPanel';

// Error Boundary
import { AppErrorBoundary } from '@/components/errors';

// Custom hooks
import { useBackendErrorHandler } from '@/hooks/useBackendErrorHandler';
import { useWailsRuntimeEvents, useConnectionStatusListener } from '@/hooks/useWailsRuntimeEvents';
import { useSidebarResize } from '@/hooks/useSidebarResize';

/**
 * AppContent - The main app content that uses the contexts
 */
function AppContent() {
  const viewState = useViewState();
  const appLogsPanel = useAppLogsPanel();
  const connectionStatus = useConnectionStatus();
  const { selectedClusterId } = useKubeconfig();

  // Initialize permissions bootstrap
  useEffect(() => {
    initializeUserPermissionsBootstrap(selectedClusterId);
  }, [selectedClusterId]);

  // Hydrate persisted preferences before applying refresh settings.
  useEffect(() => {
    let active = true;
    const initializePreferences = async () => {
      try {
        await migrateLegacyLocalStorage();
        await hydrateAppPreferences();
      } finally {
        if (active) {
          initializeAutoRefresh();
        }
      }
    };
    void initializePreferences();
    return () => {
      active = false;
    };
  }, []);

  // Handle backend errors from Wails runtime
  useBackendErrorHandler();

  // Handle connection status events from Wails runtime
  useConnectionStatusListener();

  // Callbacks for UI actions
  const handleToggleAppLogsPanel = useCallback(() => {
    appLogsPanel.toggle();
  }, [appLogsPanel]);

  const handleToggleDiagnostics = useCallback(() => {
    eventBus.emit('view:toggle-diagnostics');
  }, []);

  // Handle Wails runtime events (menu items, etc.)
  useWailsRuntimeEvents({
    onOpenSettings: () => viewState.setIsSettingsOpen(true),
    onOpenAbout: () => viewState.setIsAboutOpen(true),
    onToggleSidebar: () => viewState.toggleSidebar(),
    onToggleAppLogs: handleToggleAppLogsPanel,
    onToggleDiagnostics: handleToggleDiagnostics,
  });

  // Handle sidebar resize
  useSidebarResize({
    isResizing: viewState.isResizing,
    onWidthChange: (width: number) => viewState.setSidebarWidth(width),
    onResizeEnd: () => viewState.setIsResizing(false),
  });

  // Listen for app logs toggle events from command palette
  useEffect(() => {
    return eventBus.on('view:toggle-app-logs', handleToggleAppLogsPanel);
  }, [handleToggleAppLogsPanel]);

  // Error subscription - errors are handled by ErrorContext and error boundaries
  useEffect(() => {
    const unsubscribe = errorHandler.subscribe(() => {
      // Errors are handled by ErrorContext and displayed via ErrorNotificationSystem
      // Additional handling can be added here if needed (e.g., analytics)
    });
    return unsubscribe;
  }, []);

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
        onRefresh={handleManualRefresh}
        onToggleDiagnostics={handleToggleDiagnostics}
        viewType={viewState.viewType}
        isLogsPanelOpen={appLogsPanel.isOpen}
        isObjectPanelOpen={viewState.showObjectPanel}
        isSettingsOpen={viewState.isSettingsOpen}
      />
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
        <KeyboardProvider>
          <ConnectionStatusProvider>
            <div className="app-window-frame">
              <div className="app">
                <KubernetesProvider>
                  <AppContent />
                </KubernetesProvider>
              </div>
            </div>
          </ConnectionStatusProvider>
        </KeyboardProvider>
      </ErrorProvider>
    </AppErrorBoundary>
  );
}

export default App;
