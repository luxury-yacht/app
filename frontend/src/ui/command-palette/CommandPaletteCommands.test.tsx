/**
 * frontend/src/ui/command-palette/CommandPaletteCommands.test.tsx
 *
 * Test suite for CommandPaletteCommands.
 * Covers key behaviors and edge cases for CommandPaletteCommands.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommandPaletteCommands } from './CommandPaletteCommands';
import type { types } from '@wailsjs/go/models';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    kubeconfig: {
      kubeconfigs: [] as types.KubeconfigInfo[],
      selectedKubeconfigs: [] as string[],
      setSelectedKubeconfigs: vi.fn(),
      setActiveKubeconfig: vi.fn(),
    },
    viewState: {
      setIsAboutOpen: vi.fn(),
      setIsSettingsOpen: vi.fn(),
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
      toggle: vi.fn(),
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

vi.mock('@core/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: mocks.refreshOrchestrator,
  useAutoRefresh: () => mocks.autoRefresh,
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  SetUseShortResourceNames: vi.fn(),
}));

vi.mock('@/utils/themes', () => ({
  changeTheme: vi.fn(),
}));

vi.mock('@shared/components/tables/persistence/gridTablePersistenceReset', () => ({
  clearAllGridTableState: vi.fn(),
}));

const renderHook = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  let commands: ReturnType<typeof useCommandPaletteCommands> | null = null;

  const HookHost = () => {
    commands = useCommandPaletteCommands();
    return null;
  };

  act(() => {
    root.render(<HookHost />);
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
    mocks.kubeconfig.setActiveKubeconfig.mockReset();
    mocks.kubeconfig.setSelectedKubeconfigs.mockReset();
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

    const { getCommands, unmount } = renderHook();
    const commands = getCommands();
    const command = commands.find((entry) => entry.id === 'kubeconfig-/kube/alpha:dev');

    expect(command?.icon).toBe('✓');
    command?.action();

    expect(mocks.kubeconfig.setActiveKubeconfig).toHaveBeenCalledWith('/kube/alpha:dev');
    expect(mocks.kubeconfig.setSelectedKubeconfigs).not.toHaveBeenCalled();

    unmount();
  });
});
