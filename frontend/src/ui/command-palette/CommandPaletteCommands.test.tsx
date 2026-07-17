/**
 * frontend/src/ui/command-palette/CommandPaletteCommands.test.tsx
 *
 * Test suite for CommandPaletteCommands.
 * Covers key behaviors and edge cases for CommandPaletteCommands.
 */

import { WarningIcon } from '@shared/components/icons/SharedIcons';
import { DockablePanelProvider } from '@ui/dockable/DockablePanelProvider';
import type { types } from '@wailsjs/go/models';
import { act, isValidElement } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';
import { installWindowProperty } from '@/test-utils/windowProperty';
import { type Command, useCommandPaletteCommands } from './CommandPaletteCommands';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    kubeconfig: {
      kubeconfigs: [] as types.KubeconfigInfo[],
      selectedKubeconfigs: [] as string[],
      selectedKubeconfig: '',
      selectedClusterId: '',
      setSelectedKubeconfigs: vi.fn(),
      openKubeconfig: vi.fn(),
      closeKubeconfig: vi.fn(),
      setActiveKubeconfig: vi.fn(),
      getClusterMeta: vi.fn(() => ({ id: '', name: '' })),
      loadKubeconfigs: vi.fn(),
    },
    viewState: {
      viewType: 'cluster' as 'cluster' | 'global',
      sidebarSelection: undefined as { type: 'namespace'; value: string } | undefined,
      setIsAboutOpen: vi.fn(),
      setIsSettingsOpen: vi.fn(),
      setIsObjectDiffOpen: vi.fn(),
      onClusterObjectsClick: vi.fn(),
      setActiveClusterView: vi.fn(),
      navigateToGlobal: vi.fn(),
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
      UpdateAppPreferences: vi.fn(),
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
  UpdateAppPreferences: (...args: unknown[]) => mocks.appSettings.UpdateAppPreferences(...args),
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
  let restoreGo: () => void;

  beforeEach(() => {
    mocks.kubeconfig.kubeconfigs = [];
    mocks.kubeconfig.selectedKubeconfigs = [];
    mocks.kubeconfig.selectedKubeconfig = '';
    mocks.kubeconfig.setActiveKubeconfig.mockReset();
    mocks.kubeconfig.setSelectedKubeconfigs.mockReset();
    mocks.kubeconfig.openKubeconfig.mockReset();
    mocks.kubeconfig.openKubeconfig.mockResolvedValue(undefined);
    mocks.kubeconfig.closeKubeconfig.mockReset();
    mocks.kubeconfig.closeKubeconfig.mockResolvedValue(undefined);
    mocks.viewState.viewType = 'cluster';
    mocks.viewState.sidebarSelection = undefined;
    mocks.kubeconfig.loadKubeconfigs.mockReset();
    mocks.kubeconfig.loadKubeconfigs.mockResolvedValue(undefined);
    mocks.autoRefresh.enabled = true;
    mocks.autoRefresh.toggle.mockReset();
    mocks.appSettings.UpdateAppPreferences.mockReset();
    mocks.appSettings.UpdateAppPreferences.mockResolvedValue({ settings: {}, changedKeys: [] });
    restoreGo = installWindowProperty('go', { backend: { App: {} } });
    resetAppPreferencesCacheForTesting();
  });

  afterEach(() => {
    restoreGo();
    document.body.innerHTML = '';
  });

  it('shows the direct-open shortcut on the select-namespace command', () => {
    const { getCommands, unmount } = renderHook();
    const command = getCommands().find((entry) => entry.id === 'select-namespace');

    expect(command).toBeTruthy();
    const isMac = /Mac/i.test((navigator.platform || '') + (navigator.userAgent || ''));
    expect(command?.shortcut).toEqual(isMac ? ['⇧', '⌘', 'N'] : ['Ctrl', 'Shift', 'N']);

    unmount();
  });

  it('shows the Open Cluster shortcut on the select-kubeconfig command', () => {
    const { getCommands, unmount } = renderHook();
    const command = getCommands().find((entry) => entry.id === 'select-kubeconfig');

    expect(command).toBeTruthy();
    const isMac = /Mac/i.test((navigator.platform || '') + (navigator.userAgent || ''));
    expect(command?.shortcut).toEqual(isMac ? ['⌘', 'O'] : ['Ctrl', 'O']);

    unmount();
  });

  it('offers navigation commands for every registered cluster and namespace view', () => {
    mocks.viewState.sidebarSelection = { type: 'namespace', value: 'default' };
    mocks.kubeconfig.selectedKubeconfigs = ['/kube/alpha:dev', '/kube/beta:prod'];

    const { getCommands, unmount } = renderHook();
    const navigationViewIds = getCommands()
      .filter(
        (command) =>
          command.id.startsWith('global-') ||
          command.id.startsWith('cluster-') ||
          command.id.startsWith('namespace-')
      )
      .map((command) => command.id);

    expect(navigationViewIds).toEqual([
      'global-fleet',
      'global-global-namespaces',
      'cluster-attention',
      'cluster-namespaces',
      'cluster-browse',
      'cluster-events',
      'cluster-nodes',
      'cluster-config',
      'cluster-storage',
      'cluster-crds',
      'cluster-custom',
      'cluster-rbac',
      'namespace-browse',
      'namespace-map',
      'namespace-events',
      'namespace-workloads',
      'namespace-autoscaling',
      'namespace-helm',
      'namespace-config',
      'namespace-network',
      'namespace-storage',
      'namespace-custom',
      'namespace-quotas',
      'namespace-rbac',
    ]);

    const globalClusters = getCommands().find((command) => command.id === 'global-fleet');
    expect(globalClusters?.label).toBe('Global - Clusters');
    const globalNamespaces = getCommands().find(
      (command) => command.id === 'global-global-namespaces'
    );
    expect(globalNamespaces?.label).toBe('Global - Namespaces');

    unmount();
  });

  it('uses the Attention warning icon for the Cluster Attention command', () => {
    const { getCommands, unmount } = renderHook();
    const command = getCommands().find((entry) => entry.id === 'cluster-attention');

    expect(isValidElement(command?.icon)).toBe(true);
    if (!isValidElement(command?.icon)) {
      throw new Error('expected Cluster Attention command icon');
    }
    expect(command.icon.type).toBe(WarningIcon);

    unmount();
  });

  it('hides Global navigation commands when fewer than two clusters are open', () => {
    mocks.kubeconfig.selectedKubeconfigs = ['/kube/alpha:dev'];

    const { getCommands, unmount } = renderHook();
    const commandIds = getCommands().map((command) => command.id);

    expect(commandIds).not.toContain('global-fleet');
    expect(commandIds).not.toContain('global-global-namespaces');
    expect(commandIds).toContain('cluster-namespaces');

    unmount();
  });

  it('opens Global commands through the Global workspace action', () => {
    mocks.kubeconfig.selectedKubeconfigs = ['/kube/alpha:dev', '/kube/beta:prod'];
    const { getCommands, unmount } = renderHook();

    act(() => {
      getCommands()
        .find((command) => command.id === 'global-global-namespaces')
        ?.action();
    });

    expect(mocks.viewState.navigateToGlobal).toHaveBeenCalledWith('global-namespaces');
    expect(mocks.viewState.onClusterObjectsClick).not.toHaveBeenCalled();
    unmount();
  });

  it('searches existing navigation commands by the target lens vocabulary', () => {
    mocks.viewState.sidebarSelection = { type: 'namespace', value: 'default' };

    const { getCommands, unmount } = renderHook();
    const commandsById = new Map(getCommands().map((command) => [command.id, command]));

    expect(commandsById.get('cluster-browse')?.keywords).toContain('inventory');
    expect(commandsById.get('namespace-browse')?.keywords).toContain('inventory');
    expect(commandsById.get('cluster-nodes')?.keywords).toContain('capacity');
    expect(commandsById.get('cluster-events')?.keywords).toContain('change');
    expect(commandsById.get('namespace-events')?.keywords).toContain('change');

    unmount();
  });

  it('opens a cluster tab when the kubeconfig is inactive', () => {
    mocks.kubeconfig.kubeconfigs = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
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
    expect(mocks.kubeconfig.openKubeconfig).toHaveBeenCalledWith('/kube/alpha:dev');
    expect(mocks.kubeconfig.setSelectedKubeconfigs).not.toHaveBeenCalled();

    unmount();
  });

  it('sorts kubeconfig commands by context, not filename', () => {
    mocks.kubeconfig.kubeconfigs = [
      {
        name: 'zfile',
        path: '/kube/zfile',
        context: 'charlie',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'afile',
        path: '/kube/afile',
        context: 'alpha',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'mfile',
        path: '/kube/mfile',
        context: 'bravo',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];

    const { getCommands, unmount } = renderHook();
    const labels = getCommands()
      .filter((command) => command.category === 'Kubeconfigs')
      .map((command) => command.label);

    expect(labels).toEqual(['afile:alpha', 'mfile:bravo', 'zfile:charlie']);

    unmount();
  });

  it('flags an invalid kubeconfig context and does not open it', () => {
    mocks.kubeconfig.kubeconfigs = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'broken',
        isDefault: false,
        isCurrentContext: false,
        invalid: true,
        invalidReason: 'no cluster',
      },
    ];

    const { getCommands, unmount } = renderHook();
    const command = getCommands().find((entry) => entry.id === 'kubeconfig-/kube/alpha:broken');

    expect(command?.description).toContain('Invalid');
    command?.action();

    expect(mocks.kubeconfig.openKubeconfig).not.toHaveBeenCalled();
    expect(mocks.kubeconfig.setActiveKubeconfig).not.toHaveBeenCalled();

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
        invalid: false,
        invalidReason: '',
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

  it('closes the current cluster tab when requested', async () => {
    mocks.kubeconfig.kubeconfigs = [
      {
        name: 'alpha',
        path: '/kube/alpha',
        context: 'dev',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
      {
        name: 'beta',
        path: '/kube/beta',
        context: 'prod',
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      },
    ];
    mocks.kubeconfig.selectedKubeconfigs = ['/kube/alpha:dev', '/kube/beta:prod'];
    mocks.kubeconfig.selectedKubeconfig = '/kube/beta:prod';

    const { getCommands, unmount } = renderHook();
    const commands = getCommands();
    const command = commands.find((entry) => entry.id === 'close-cluster-tab');

    await act(async () => {
      command?.action();
      await Promise.resolve();
    });

    expect(mocks.kubeconfig.closeKubeconfig).toHaveBeenCalledWith('/kube/beta:prod');
    expect(mocks.kubeconfig.loadKubeconfigs).not.toHaveBeenCalled();
    expect(mocks.kubeconfig.setSelectedKubeconfigs).not.toHaveBeenCalled();
    unmount();
  });

  it('does not close the foreground cluster while the Global workspace is active', async () => {
    mocks.kubeconfig.selectedKubeconfigs = ['/kube/alpha:dev', '/kube/beta:prod'];
    mocks.kubeconfig.selectedKubeconfig = '/kube/beta:prod';
    mocks.viewState.viewType = 'global';

    const { getCommands, unmount } = renderHook();
    const command = getCommands().find((entry) => entry.id === 'close-cluster-tab');

    await act(async () => {
      command?.action();
      await Promise.resolve();
    });

    expect(mocks.kubeconfig.closeKubeconfig).not.toHaveBeenCalled();
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
      'When enabled, only one namespace at a time can be expanded in the Sidebar. Expanding a different namespace will collapse the currently expanded one.'
    );

    await act(async () => {
      dimCommand?.action();
      exclusiveCommand?.action();
      await Promise.resolve();
    });

    expect(mocks.appSettings.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'dimInactiveNamespaces', value: false }],
    });
    expect(mocks.appSettings.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'exclusiveNamespaces', value: false }],
    });

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
    expect(mocks.appSettings.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'useShortResourceNames', value: false }],
    });

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
