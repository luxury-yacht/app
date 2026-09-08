import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import { PanelLifecycleGuardRegistry } from '@/core/panel-windows/panelLifecycleGuards';
import App from './App';

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  backend: vi.fn(),
  execute: null as null | ((command: backend.ApplicationMenuCommand) => void),
  guards: null as null | PanelLifecycleGuardRegistry,
  wrapper: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@core/contexts/AuthErrorContext', () => ({ AuthErrorProvider: mocks.wrapper }));
vi.mock('@core/contexts/ClusterLifecycleContext', () => ({
  useClusterLifecycle: () => ({ getClusterState: () => null }),
}));
vi.mock('@core/contexts/ErrorContext', () => ({ ErrorProvider: mocks.wrapper }));
vi.mock('@core/contexts/FavoritesContext', () => ({ FavoritesProvider: mocks.wrapper }));
vi.mock('@core/contexts/KubernetesProvider', () => ({ KubernetesProvider: mocks.wrapper }));
vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => ({ isSettingsOpen: false, setIsSettingsOpen: mocks.settings }),
}));
vi.mock('@core/contexts/ZoomContext', () => ({ ZoomProvider: mocks.wrapper, useZoom: () => ({}) }));
vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: '', selectedClusterName: '' }),
}));
vi.mock('@ui/errors', () => ({ AppErrorBoundary: mocks.wrapper }));
vi.mock('@ui/layout/AppLayout', () => ({ AppLayout: () => null }));
vi.mock('@ui/shortcuts', () => ({
  KeyboardProvider: mocks.wrapper,
  ApplicationMenuShortcuts: () => null,
  GlobalShortcuts: () => null,
}));
vi.mock('@ui/shortcuts/components/TextContextMenu', () => ({ default: () => null }));
vi.mock('@/core/capabilities', () => ({ setActivePermissionCluster: vi.fn() }));
vi.mock('@/core/panel-windows/WorkspacePanelCoordinator', () => ({
  WorkspacePanelCoordinator: mocks.wrapper,
}));
vi.mock('@/core/panel-windows/panelLifecycleGuards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/panel-windows/panelLifecycleGuards')>()),
  PanelLifecycleGuardProvider: mocks.wrapper,
  usePanelLifecycleGuardRegistry: () => mocks.guards,
}));
vi.mock('@/hooks/useBackendErrorHandler', () => ({ useBackendErrorHandler: vi.fn() }));
vi.mock('@/hooks/useSidebarResize', () => ({ useSidebarResize: vi.fn() }));
vi.mock('@/hooks/useWailsRuntimeEvents', () => ({ useWailsRuntimeEvents: vi.fn() }));
vi.mock('@/ui/layout/ApplicationMenuCommandContext', () => ({
  ApplicationMenuCommandProvider: ({
    execute,
    children,
  }: {
    execute: typeof mocks.execute;
    children: ReactNode;
  }) => {
    mocks.execute = execute;
    return children;
  },
  executeBackendApplicationMenuCommand: mocks.backend,
}));

it('keeps local and backend menu commands usable during a cluster close, but blocks them during window close', async () => {
  mocks.guards = new PanelLifecycleGuardRegistry();
  mocks.guards.freezeCluster('cluster-close', 'production', []);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<App />));
    const command = backend.ApplicationMenuCommand;
    mocks.execute?.(command.ApplicationMenuCommandSettings);
    mocks.execute?.(command.ApplicationMenuCommandNewWindow);
    expect(mocks.settings).toHaveBeenCalledWith(true);
    expect(mocks.backend).toHaveBeenCalledOnce();
    mocks.guards.freeze('window-close', []);
    mocks.execute?.(command.ApplicationMenuCommandSettings);
    mocks.execute?.(command.ApplicationMenuCommandNewWindow);
    expect(mocks.settings).toHaveBeenCalledOnce();
    expect(mocks.backend).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
  }
});
