/**
 * frontend/src/ui/command-palette/CommandPaletteCommands.test.tsx
 *
 * Test suite for CommandPaletteCommands.
 * Covers key behaviors and edge cases for CommandPaletteCommands.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommandPaletteCommands, type Command } from './CommandPaletteCommands';
import type { types } from '@wailsjs/go/models';
import { DockablePanelProvider } from '@ui/dockable/DockablePanelProvider';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    kubeconfig: {
      kubeconfigs: [] as types.KubeconfigInfo[],
      selectedKubeconfigs: [] as string[],
      selectedKubeconfig: '',
      selectedClusterId: '',
      setSelectedKubeconfigs: vi.fn(),
      setActiveKubeconfig: vi.fn(),
      getClusterMeta: vi.fn(() => ({ id: '', name: '' })),
    },
    viewState: {
      setIsAboutOpen: vi.fn(),
      setIsSettingsOpen: vi.fn(),
      setIsObjectDiffOpen: vi.fn(),
      onClusterObjectsClick: vi.fn(),
      setActiveClusterView: vi.fn(),
      navigateToNamespace: vi.fn(),
      setActiveNamespaceTab: vi.fn(),
      onNamespaceSelect: vi.fn(),
    },
    namespace: {
      namespaces: [] as Array<{ name: string; scope: string }>,
      setSelectedNamespace: vi.fn(),
    },
    autoRefresh: {
      enabled: true,
      toggle: vi.fn(),
    },
    appSettings: {
      SetUseShortResourceNames: vi.fn(),
      SetDimInactiveNamespaces: vi.fn(),
      SetExclusiveNamespaces: vi.fn(),
    },
    refreshOrchestrator: {
      triggerManualRefreshForContext: vi.fn(),
    },
  },
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => mocks.kubeconfig,
}));

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => mocks.viewState,
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => mocks.namespace,
}));

vi.mock('@core/contexts/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: [],
    addFavorite: vi.fn(),
    deleteFavorite: vi.fn(),
    reorderFavorites: vi.fn(),
    updateFavorite: vi.fn(),
    setPendingFavorite: vi.fn(),
  }),
}));

vi.mock('@ui/favorites/navigateToFavorite', () => ({
  navigateToFavorite: vi.fn(),
}));

vi.mock('@core/contexts/AppearanceModeContext', () => ({
  useAppearanceMode: () => ({
    mode: 'light',
    resolvedMode: 'light',
  }),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: mocks.refreshOrchestrator,
  useAutoRefresh: () => mocks.autoRefresh,
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  SetUseShortResourceNames: (...args: unknown[]) =>
    mocks.appSettings.SetUseShortResourceNames(...args),
  SetDimInactiveNamespaces: (...args: unknown[]) =>
    mocks.appSettings.SetDimInactiveNamespaces(...args),
  SetExclusiveNamespaces: (...args: unknown[]) => mocks.appSettings.SetExclusiveNamespaces(...args),
}));

vi.mock('@/utils/appearanceMode', () => ({
  changeAppearanceMode: vi.fn(),
}));

vi.mock('@shared/components/tables/persistence/gridTablePersistenceReset', () => ({
  clearAllGridTableState: vi.fn(),
}));

vi.mock('@core/contexts/ZoomContext', () => ({
  useZoom: () => ({
    zoomLevel: 100,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetZoom: vi.fn(),
    canZoomIn: true,
    canZoomOut: true,
  }),
}));

const renderHook = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  let commands: Command[] | null = null;

  const HookHost = () => {
    commands = useCommandPaletteCommands();
    return null;
  };

  act(() => {
    root.render(
      <DockablePanelProvider>
        <HookHost />
      </DockablePanelProvider>
    );
  });

  return {
    getCommands() {
      if (!commands) {
        throw new Error('Command list not set');
      }
      return commands;
    },
    unmount() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
};

describe('CommandPaletteCommands', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    mocks.kubeconfig.kubeconfigs = [];
    mocks.kubeconfig.selectedKubeconfigs = [];
    mocks.kubeconfig.selectedKubeconfig = '';
    mocks.kubeconfig.setActiveKubeconfig.mockReset();
    mocks.kubeconfig.setSelectedKubeconfigs.mockReset();
    mocks.autoRefresh.enabled = true;
    mocks.autoRefresh.toggle.mockReset();
    mocks.appSettings.SetUseShortResourceNames.mockReset();
    mocks.appSettings.SetDimInactiveNamespaces.mockReset();
    mocks.appSettings.SetExclusiveNamespaces.mockReset();
    mocks.appSettings.SetUseShortResourceNames.mockResolvedValue(undefined);
    mocks.appSettings.SetDimInactiveNamespaces.mockResolvedValue(undefined);
    mocks.appSettings.SetExclusiveNamespaces.mockResolvedValue(undefined);
    resetAppPreferencesCacheForTesting();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('opens a cluster tab when the kubeconfig is inactive', () => {
    mocks.kubeconfig.kubeconfigs = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
      },
    ];

    const { getCommands, unmount } = renderHook();
    const commands = getCommands();
    const command = commands.find((entry) => entry.id === 'kubeconfig-/kube/alpha:dev');

    expect(command?.label).toBe('alpha:dev');
    expect(command?.renderLabel).toBeTruthy();
    expect(command?.icon).toBeUndefined();
    command?.action();

    expect(mocks.kubeconfig.setActiveKubeconfig).not.toHaveBeenCalled();
    expect(mocks.kubeconfig.setSelectedKubeconfigs).toHaveBeenCalledWith(['/kube/alpha:dev']);

    unmount();
  });

  it('switches to an active kubeconfig without removing it', () => {
    mocks.kubeconfig.kubeconfigs = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
      },
    ];
    mocks.kubeconfig.selectedKubeconfigs = ['/kube/alpha:dev'];
    mocks.kubeconfig.selectedKubeconfig = '/kube/alpha:dev';

    const { getCommands, unmount } = renderHook();
    const commands = getCommands();
    const command = commands.find((entry) => entry.id === 'kubeconfig-/kube/alpha:dev');

    expect(command?.icon).toBe('✓');
    command?.action();

    expect(mocks.kubeconfig.setActiveKubeconfig).toHaveBeenCalledWith('/kube/alpha:dev');
    expect(mocks.kubeconfig.setSelectedKubeconfigs).not.toHaveBeenCalled();

    unmount();
  });

  it('closes the current cluster tab when requested', () => {
    mocks.kubeconfig.kubeconfigs = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
      },
    ];
    mocks.kubeconfig.selectedKubeconfigs = ['/kube/alpha:dev', '/kube/beta:prod'];
    mocks.kubeconfig.selectedKubeconfig = '/kube/beta:prod';

    const { getCommands, unmount } = renderHook();
    const commands = getCommands();
    const command = commands.find((entry) => entry.id === 'close-cluster-tab');

    command?.action();

    expect(mocks.kubeconfig.setSelectedKubeconfigs).toHaveBeenCalledWith(['/kube/alpha:dev']);
    unmount();
  });

  it('labels light, dark, and system choices as appearance modes', () => {
    const { getCommands, unmount } = renderHook();
    const commands = getCommands();

    expect(commands.find((entry) => entry.id === 'mode-light')?.label).toBe('Light mode');
    expect(commands.find((entry) => entry.id === 'mode-dark')?.label).toBe('Dark mode');
    expect(commands.find((entry) => entry.id === 'mode-system')?.label).toBe(
      'Follow the system for light/dark mode'
    );

    unmount();
  });

  it('includes Sidebar setting toggles and persists their inverse states', async () => {
    setAppPreferencesForTesting({
      dimInactiveNamespaces: true,
      exclusiveNamespaces: true,
    });

    const { getCommands, unmount } = renderHook();
    const commands = getCommands();
    const dimCommand = commands.find((entry) => entry.id === 'toggle-dim-inactive-namespaces');
    const exclusiveCommand = commands.find((entry) => entry.id === 'toggle-exclusive-namespaces');

    expect(dimCommand?.label).toBe('Disable inactive namespace dimming');
    expect(dimCommand?.description).toBe('Dim namespaces in the Sidebar that have no Workloads.');
    expect(exclusiveCommand?.label).toBe('Disable exclusive namespaces');
    expect(exclusiveCommand?.description).toBe(
      'When enabled, only one namespace at a time can be expanded in the Sidebar.'
    );

    await act(async () => {
      dimCommand?.action();
      exclusiveCommand?.action();
      await Promise.resolve();
    });

    expect(mocks.appSettings.SetDimInactiveNamespaces).toHaveBeenCalledWith(false);
    expect(mocks.appSettings.SetExclusiveNamespaces).toHaveBeenCalledWith(false);

    unmount();
  });

  it('orders Settings commands with appearance modes first', () => {
    const { getCommands, unmount } = renderHook();
    const settingsCommandIds = getCommands()
      .filter((entry) => entry.category === 'Settings')
      .map((entry) => entry.id);

    expect(settingsCommandIds).toEqual([
      'mode-system',
      'mode-light',
      'mode-dark',
      'toggle-exclusive-namespaces',
      'toggle-dim-inactive-namespaces',
      'toggle-auto-refresh',
      'refresh-view',
      'reset-all-gridtable-state',
      'toggle-short-names',
    ]);

    unmount();
  });

  it('places refresh current view in Settings', () => {
    const { getCommands, unmount } = renderHook();
    const command = getCommands().find((entry) => entry.id === 'refresh-view');

    expect(command?.label).toBe('Refresh current view');
    expect(command?.category).toBe('Settings');

    unmount();
  });

  it('labels auto-refresh and short names using their disable actions when enabled', async () => {
    setAppPreferencesForTesting({ useShortResourceNames: true });

    const { getCommands, unmount } = renderHook();
    const commands = getCommands();
    const autoRefreshCommand = commands.find((entry) => entry.id === 'toggle-auto-refresh');
    const shortNamesCommand = commands.find((entry) => entry.id === 'toggle-short-names');

    expect(autoRefreshCommand?.label).toBe('Disable auto-refresh');
    expect(shortNamesCommand?.label).toBe('Disable short names');

    await act(async () => {
      autoRefreshCommand?.action();
      shortNamesCommand?.action();
      await Promise.resolve();
    });

    expect(mocks.autoRefresh.toggle).toHaveBeenCalledTimes(1);
    expect(mocks.appSettings.SetUseShortResourceNames).toHaveBeenCalledWith(false);

    unmount();
  });

  it('labels auto-refresh and short names using their enable actions when disabled', () => {
    mocks.autoRefresh.enabled = false;
    setAppPreferencesForTesting({ useShortResourceNames: false });

    const { getCommands, unmount } = renderHook();
    const commands = getCommands();

    expect(commands.find((entry) => entry.id === 'toggle-auto-refresh')?.label).toBe(
      'Enable auto-refresh'
    );
    expect(commands.find((entry) => entry.id === 'toggle-short-names')?.label).toBe(
      'Enable short names'
    );

    unmount();
  });

  it('labels disabled Sidebar settings as enable actions', () => {
    setAppPreferencesForTesting({
      dimInactiveNamespaces: false,
      exclusiveNamespaces: false,
    });

    const { getCommands, unmount } = renderHook();
    const commands = getCommands();

    expect(commands.find((entry) => entry.id === 'toggle-dim-inactive-namespaces')?.label).toBe(
      'Enable inactive namespace dimming'
    );
    expect(commands.find((entry) => entry.id === 'toggle-exclusive-namespaces')?.label).toBe(
      'Enable exclusive namespaces'
    );

    unmount();
  });
});
