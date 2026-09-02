/**
 * frontend/src/ui/dockable/DockablePanelProvider.test.tsx
 *
 * Test suite for DockablePanelProvider.
 * Covers tab-group state, panel lifecycle, focus routing, drag adapters,
 * and drag adapters.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { TabDragProvider } from '@shared/components/tabs/dragCoordinator';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import { resolveObjectPanelMountTarget } from '@/ui/layout/objectPanelMountTarget';
import { DockablePanelProvider, useDockablePanelContext } from './DockablePanelProvider';
import { clearPanelState } from './useDockablePanelState';

type DockablePanelContextValue = ReturnType<typeof useDockablePanelContext>;

const requireDockableContext = (
  value: DockablePanelContextValue | null
): DockablePanelContextValue =>
  requireValue<DockablePanelContextValue | null>(
    value,
    'expected the dockable-panel context after rendering the probe'
  );

// Per-cluster panel state work added cluster awareness to the provider.
// Tests that don't care about clusters can leave selectedClusterId at
// its default; tests that need to switch clusters use vi.mocked() to
// change the mock return value between renders.
vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: vi.fn(() => ({
    selectedClusterId: 'cluster-a',
    selectedClusterIds: ['cluster-a'],
    // Other useKubeconfig fields aren't read by DockablePanelProvider,
    // so we leave them undefined. Add stubs only if a future test
    // needs them.
  })),
}));

// Helper to satisfy TypeScript: vi.mocked(useKubeconfig).mockReturnValue
// expects the full KubeconfigContextType, but DockablePanelProvider only
// reads selectedClusterId and selectedClusterIds. Cast through unknown
// at one place rather than 12 inline `as unknown as ...` casts.
function setMockedKubeconfig(partial: {
  selectedClusterId: string;
  selectedClusterIds: string[];
}): void {
  vi.mocked(useKubeconfig).mockReturnValue(partial as unknown as ReturnType<typeof useKubeconfig>);
}

const render = async (element: React.ReactElement) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    root.render(<TabDragProvider>{element}</TabDragProvider>);
    await Promise.resolve();
  });

  return {
    container,
    rerender: async (nextElement: React.ReactElement) => {
      await act(async () => {
        root.render(<TabDragProvider>{nextElement}</TabDragProvider>);
        await Promise.resolve();
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('DockablePanelProvider', () => {
  beforeEach(() => {
    // Create the content shell used by the real app layout.
    const contentEl = document.createElement('div');
    contentEl.className = 'content';
    const contentBodyEl = document.createElement('div');
    contentBodyEl.className = 'content-body';
    contentEl.appendChild(contentBodyEl);
    document.body.appendChild(contentEl);
  });

  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    document.documentElement.style.removeProperty('--dock-right-offset');
    document.documentElement.style.removeProperty('--dock-bottom-offset');
  });

  it('creates a shared host layer inside .content', async () => {
    const { unmount } = await render(
      <DockablePanelProvider>
        <div data-testid="child">content</div>
      </DockablePanelProvider>
    );

    const layer = document.querySelector('.dockable-panel-layer') as HTMLDivElement | null;
    expect(layer).toBeTruthy();
    // The layer should be a child of .content, not document.body
    const contentEl = document.querySelector('.content');
    expect(contentEl?.contains(layer)).toBe(true);

    await unmount();
    expect(document.querySelector('.dockable-panel-layer')).toBeNull();
  });

  it('mounts the drag preview element permanently', async () => {
    const { container, unmount } = await render(
      <DockablePanelProvider>
        <div />
      </DockablePanelProvider>
    );

    // Preview is always in the DOM, even without an active drag.
    const preview = container.querySelector('.dockable-tab-drag-preview');
    expect(preview).toBeTruthy();
    expect(preview?.querySelector('.dockable-tab-drag-preview__label')).toBeTruthy();
    expect(preview?.querySelector('.dockable-tab-drag-preview__kind')).toBeTruthy();

    await unmount();
  });

  it('routes native tab close intent without removing the local tab before authorization', async () => {
    const contextRef: { current: DockablePanelContextValue | null } = { current: null };
    const requestClose = vi.fn();
    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };
    const Provider = DockablePanelProvider as React.ComponentType<
      React.PropsWithChildren<{
        nativeWindowMode: boolean;
        onTabCloseRequest: (panelId: string) => void;
      }>
    >;
    const { unmount } = await render(
      <Provider nativeWindowMode onTabCloseRequest={requestClose}>
        <Consumer />
      </Provider>
    );

    await act(async () => {
      requireDockableContext(contextRef.current).registerPanel({
        panelId: 'panel-a',
        title: 'A',
        position: 'right',
      });
      requireDockableContext(contextRef.current).syncPanelGroup('panel-a', 'right');
      await Promise.resolve();
    });
    await act(async () => {
      requireDockableContext(contextRef.current).closeTab('panel-a');
      await Promise.resolve();
    });

    expect(requestClose).toHaveBeenCalledWith('panel-a');
    expect(requireDockableContext(contextRef.current).tabGroups.right.tabs).toEqual(['panel-a']);
    await unmount();
  });

  it('exposes tabGroups state that reflects explicit group sync actions', async () => {
    const contextRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };

    const { unmount } = await render(
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );

    // Initially empty.
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.right.tabs
    ).toEqual([]);
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.bottom.tabs
    ).toEqual([]);
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.floating
    ).toEqual([]);

    // Register a right panel.
    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).registerPanel({
        panelId: 'logs',
        title: 'Logs',
        position: 'right',
      });
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).syncPanelGroup('logs', 'right');
      await Promise.resolve();
    });
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.right.tabs
    ).toEqual(['logs']);
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.right.activeTab
    ).toBe('logs');

    // Register a second right panel.
    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).registerPanel({
        panelId: 'details',
        title: 'Details',
        position: 'right',
      });
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).syncPanelGroup('details', 'right');
      await Promise.resolve();
    });
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.right.tabs
    ).toEqual(['logs', 'details']);
    // Most recently added panel becomes active.
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.right.activeTab
    ).toBe('details');

    // switchTab to logs.
    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).switchTab('right', 'logs');
      await Promise.resolve();
    });
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.right.activeTab
    ).toBe('logs');

    // Unregister details.
    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).removePanelFromGroups('details');
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).unregisterPanel('details');
      await Promise.resolve();
    });
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.right.tabs
    ).toEqual(['logs']);

    await unmount();
  });

  it('discards closed native-panel layouts from their owning cluster while another cluster is active', async () => {
    const contextRef: { current: DockablePanelContextValue | null } = { current: null };

    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };

    setMockedKubeconfig({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    const renderProvider = () => (
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );
    const { rerender, unmount } = await render(renderProvider());

    await act(async () => {
      requireDockableContext(contextRef.current).syncPanelGroup('panel-a', 'right');
      await Promise.resolve();
    });

    setMockedKubeconfig({
      selectedClusterId: 'cluster-b',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    await rerender(renderProvider());

    await act(async () => {
      requireDockableContext(contextRef.current).syncPanelGroup('panel-b', 'bottom');
      requireDockableContext(contextRef.current).discardPanelLayouts('cluster-a', ['panel-a']);
      await Promise.resolve();
    });
    expect(requireDockableContext(contextRef.current).tabGroups.bottom.tabs).toEqual(['panel-b']);

    setMockedKubeconfig({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    await rerender(renderProvider());
    expect(requireDockableContext(contextRef.current).tabGroups.right.tabs).toEqual([]);

    await unmount();
  });

  it.each([
    { previousPosition: 'right', targetPosition: 'bottom' },
    { previousPosition: 'bottom', targetPosition: 'right' },
  ] as const)(
    'moves a returning native group from $previousPosition to requested $targetPosition dock',
    async ({ previousPosition, targetPosition }) => {
      const contextRef: { current: DockablePanelContextValue | null } = { current: null };

      const Consumer: React.FC = () => {
        contextRef.current = useDockablePanelContext();
        return null;
      };

      const { unmount } = await render(
        <DockablePanelProvider>
          <Consumer />
        </DockablePanelProvider>
      );

      await act(async () => {
        const context = requireDockableContext(contextRef.current);
        context.syncPanelGroup('panel-a', previousPosition);
        context.syncPanelGroup('panel-b', previousPosition);
        context.dockPanelGroup('cluster-a', ['panel-a', 'panel-b'], 'panel-a', targetPosition);
        await Promise.resolve();
      });

      const groups = requireDockableContext(contextRef.current).tabGroups;
      expect(groups[previousPosition].tabs).toEqual([]);
      expect(groups[targetPosition].tabs).toEqual(['panel-a', 'panel-b']);
      expect(groups[targetPosition].activeTab).toBe('panel-a');

      await unmount();
    }
  );

  it('removes a transferred native group so a new workspace panel can lead the dock', async () => {
    const contextRef: { current: DockablePanelContextValue | null } = { current: null };

    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };

    const { unmount } = await render(
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );

    await act(async () => {
      const context = requireDockableContext(contextRef.current);
      context.syncPanelGroup('native-panel', 'right');
      context.detachPanelGroup('cluster-a', ['native-panel']);
      context.syncPanelGroup('new-workspace-panel', 'right');
      await Promise.resolve();
    });

    expect(requireDockableContext(contextRef.current).tabGroups.right).toEqual({
      tabs: ['new-workspace-panel'],
      activeTab: 'new-workspace-panel',
    });

    await unmount();
  });

  it('does not create an in-page floating group when no native move owner is installed', async () => {
    const contextRef: { current: DockablePanelContextValue | null } = { current: null };

    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };

    const { unmount } = await render(
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );

    await act(async () => {
      const context = requireDockableContext(contextRef.current);
      context.syncPanelGroup('object-a', 'right');
      context.movePanelBetweenGroups('object-a', 'floating');
      await Promise.resolve();
    });

    const groups = requireDockableContext(contextRef.current).tabGroups;
    expect(groups.right.tabs).toEqual(['object-a']);
    expect(groups.floating).toEqual([]);

    await unmount();
  });

  it('applies preferred group only for initial sync', async () => {
    const contextRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };

    const { unmount } = await render(
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );

    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).registerPanel({
        panelId: 'panel-a',
        title: 'Panel A',
        position: 'right',
      });
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).syncPanelGroup('panel-a', 'right');
      await Promise.resolve();
    });

    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.right.tabs
    ).toContain('panel-a');
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.bottom.tabs
    ).not.toContain('panel-a');

    await act(async () => {
      // Preferred group should be ignored after the panel is already grouped.
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).syncPanelGroup('panel-a', 'right', 'bottom');
      await Promise.resolve();
    });

    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.right.tabs
    ).toContain('panel-a');
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.bottom.tabs
    ).not.toContain('panel-a');

    await unmount();
  });

  it('adds new floating panels to the focused floating group', async () => {
    const contextRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };

    const { unmount } = await render(
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );

    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).registerPanel({
        panelId: 'float-a',
        title: 'Float A',
        position: 'floating',
      });
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).syncPanelGroup('float-a', 'floating');
      await Promise.resolve();
    });

    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.floating
    ).toHaveLength(1);
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.floating[0].tabs
    ).toEqual(['float-a']);

    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).setLastFocusedGroupKey('floating-1');
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).registerPanel({
        panelId: 'float-b',
        title: 'Float B',
        position: 'floating',
      });
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).syncPanelGroup('float-b', 'floating');
      await Promise.resolve();
    });

    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.floating
    ).toHaveLength(1);
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.floating[0].tabs
    ).toEqual(['float-a', 'float-b']);
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.floating[0].activeTab
    ).toBe('float-b');

    await unmount();
  });

  it('isolates a new floating panel when it has a unique preferred source group', async () => {
    const contextRef: { current: DockablePanelContextValue | null } = { current: null };
    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };

    const { unmount } = await render(
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );

    await act(async () => {
      const context = requireDockableContext(contextRef.current);
      context.registerPanel({ panelId: 'float-a', title: 'Float A', position: 'floating' });
      context.syncPanelGroup('float-a', 'floating');
      context.setLastFocusedGroupKey('floating-1');
      await Promise.resolve();
    });

    await act(async () => {
      const context = requireDockableContext(contextRef.current);
      const mountTarget = resolveObjectPanelMountTarget(undefined, 'floating', 'float-b');
      context.registerPanel({ panelId: 'float-b', title: 'Float B', position: 'floating' });
      context.syncPanelGroup('float-b', mountTarget.position, mountTarget.groupKey);
      await Promise.resolve();
    });

    expect(requireDockableContext(contextRef.current).tabGroups.floating).toEqual([
      { groupId: 'floating-1', tabs: ['float-a'], activeTab: 'float-a' },
      { groupId: 'floating-2', tabs: ['float-b'], activeTab: 'float-b' },
    ]);

    await unmount();
  });

  it('returns right as default open position when no focused group exists', async () => {
    const contextRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };

    const { unmount } = await render(
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );

    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).registerPanel({
        panelId: 'float-a',
        title: 'Float A',
        position: 'floating',
      });
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).syncPanelGroup('float-a', 'floating');
      await Promise.resolve();
    });

    expect(
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).getLastFocusedPosition()
    ).toBe('right');

    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).setLastFocusedGroupKey('floating-1');
      await Promise.resolve();
    });

    expect(
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).getLastFocusedPosition()
    ).toBe('floating');

    await unmount();
  });

  it('resolves preferred open target group key from focus with fallback', async () => {
    const contextRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };

    const { unmount } = await render(
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );

    expect(
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).getPreferredOpenGroupKey('bottom')
    ).toBe('bottom');

    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).registerPanel({
        panelId: 'float-a',
        title: 'Float A',
        position: 'floating',
      });
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).syncPanelGroup('float-a', 'floating');
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).setLastFocusedGroupKey('floating-1');
      await Promise.resolve();
    });

    expect(
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).getPreferredOpenGroupKey('right')
    ).toBe('floating-1');

    await unmount();
  });

  it('moves focus to another group when the focused group is removed directly from the store', async () => {
    const contextRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };

    const { unmount } = await render(
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );

    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).registerPanel({
        panelId: 'right-panel',
        title: 'Right Panel',
        position: 'right',
      });
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).syncPanelGroup('right-panel', 'right');
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).registerPanel({
        panelId: 'floating-panel',
        title: 'Floating Panel',
        position: 'floating',
      });
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).syncPanelGroup('floating-panel', 'floating');
      await Promise.resolve();
    });

    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.floating[0].groupId
    ).toBe('floating-1');

    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).setLastFocusedGroupKey('floating-1');
      clearPanelState('floating-panel');
      await Promise.resolve();
    });

    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.floating
    ).toHaveLength(0);
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .lastFocusedGroupKey
    ).toBe('right');

    await unmount();
  });

  it('moves a tab between groups via movePanel (cross-group drop)', async () => {
    const contextRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };

    const { unmount } = await render(
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );

    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).registerPanel({
        panelId: 'bottom-a',
        title: 'Bottom A',
        position: 'bottom',
      });
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).syncPanelGroup('bottom-a', 'bottom');
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).registerPanel({
        panelId: 'bottom-b',
        title: 'Bottom B',
        position: 'bottom',
      });
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).syncPanelGroup('bottom-b', 'bottom');
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).registerPanel({
        panelId: 'right-a',
        title: 'Right A',
        position: 'right',
      });
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).syncPanelGroup('right-a', 'right');
      await Promise.resolve();
    });

    // Simulate a cross-group drop via the movePanel adapter directly.
    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).movePanel('bottom-a', 'bottom', 'right', 1);
      await Promise.resolve();
    });

    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.bottom.tabs
    ).toEqual(['bottom-b']);
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.right.tabs
    ).toEqual(['right-a', 'bottom-a']);

    await unmount();
  });

  it('reorders tabs within a right-docked group via movePanel (shift compensation)', async () => {
    const contextRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };

    const { unmount } = await render(
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );

    await act(async () => {
      for (const id of ['a', 'b', 'c', 'd']) {
        requireValue(
          contextRef.current,
          'expected test value in DockablePanelProvider.test.tsx'
        ).registerPanel({
          panelId: id,
          title: id.toUpperCase(),
          position: 'right',
        });
        requireValue(
          contextRef.current,
          'expected test value in DockablePanelProvider.test.tsx'
        ).syncPanelGroup(id, 'right');
      }
      await Promise.resolve();
    });

    // Source at index 0, drop at insertIndex 3: shift compensation →
    // adjustedInsert = 2, reorderTab removes 'a' then splices at 2.
    // Expected: ['b','c','a','d']
    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).movePanel('a', 'right', 'right', 3);
      await Promise.resolve();
    });
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.right.tabs
    ).toEqual(['b', 'c', 'a', 'd']);

    // Drop at end (insertIndex = 4): source 'c' at index 1, sourceIdx <
    // insertIndex → adjustedInsert = 3. Remove 'c' → ['b','a','d'],
    // splice at 3 → ['b','a','d','c'].
    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).movePanel('c', 'right', 'right', 4);
      await Promise.resolve();
    });
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.right.tabs
    ).toEqual(['b', 'a', 'd', 'c']);

    // No-op drop onto self.
    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).movePanel('a', 'right', 'right', 1);
      await Promise.resolve();
    });
    expect(
      requireValue(contextRef.current, 'expected test value in DockablePanelProvider.test.tsx')
        .tabGroups.right.tabs
    ).toEqual(['b', 'a', 'd', 'c']);

    await unmount();
  });

  it('reorders tabs within a floating group via movePanel (getGroupTabs handles floating ids)', async () => {
    // Regression gate for the asymmetric TabGroupState shape: floating
    // groups live in state.floating[] and are looked up by groupId, not
    // as keyed children like state.right / state.bottom. If getGroupTabs
    // returns [] for a floating group, shift compensation silently
    // breaks and forward drops land one slot too far right.
    const contextRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };

    const { unmount } = await render(
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );

    // Build a single floating group containing four tabs.
    await act(async () => {
      for (const id of ['a', 'b', 'c', 'd']) {
        requireValue(
          contextRef.current,
          'expected test value in DockablePanelProvider.test.tsx'
        ).registerPanel({
          panelId: id,
          title: id.toUpperCase(),
          position: 'floating',
        });
        requireValue(
          contextRef.current,
          'expected test value in DockablePanelProvider.test.tsx'
        ).syncPanelGroup(id, 'floating');
      }
      await Promise.resolve();
    });

    // Collapse them into one group (floating-1) by moving b, c, d into
    // floating-1 (the group created by the first call).
    const floatingId = requireValue(
      contextRef.current,
      'expected test value in DockablePanelProvider.test.tsx'
    ).tabGroups.floating[0].groupId;
    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).setLastFocusedGroupKey(floatingId);
      await Promise.resolve();
    });

    // Move b, c, d into floating-1 via addPanelToFloatingGroup path. Use
    // movePanelBetweenGroups with the specific floating group id as the
    // target.
    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).movePanelBetweenGroups('b', floatingId);
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).movePanelBetweenGroups('c', floatingId);
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).movePanelBetweenGroups('d', floatingId);
      await Promise.resolve();
    });

    // Now the floating group should contain all four tabs.
    const group = requireValue(
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).tabGroups.floating.find((g) => g.groupId === floatingId),
      'expected test value in DockablePanelProvider.test.tsx'
    );
    expect(group.tabs).toEqual(['a', 'b', 'c', 'd']);

    // Forward reorder: move 'a' to insertIndex = 2. Shift compensation:
    // sourceIdx 0 < insertIndex 2 → adjustedInsert = 1. Expected:
    // ['b','a','c','d']. Without getGroupTabs handling floating ids, the
    // compensation is skipped and the result would be ['b','c','a','d'].
    await act(async () => {
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).movePanel('a', floatingId, floatingId, 2);
      await Promise.resolve();
    });

    const afterReorder = requireValue(
      requireValue(
        contextRef.current,
        'expected test value in DockablePanelProvider.test.tsx'
      ).tabGroups.floating.find((g) => g.groupId === floatingId),
      'expected test value in DockablePanelProvider.test.tsx'
    );
    expect(afterReorder.tabs).toEqual(['b', 'a', 'c', 'd']);

    await unmount();
  });
});

describe('DockablePanelProvider — per-cluster panel state', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    // Reset useKubeconfig mock to cluster-a between tests.
    setMockedKubeconfig({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  // === Task 7 ===
  it('preserves tabGroups across cluster switch round-trip', () => {
    let capturedCtx: ReturnType<typeof useDockablePanelContext> | null = null;
    function Probe() {
      capturedCtx = useDockablePanelContext();
      return null;
    }

    // Render with cluster-a active. Place panel-a in the right dock.
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    act(() => {
      requireDockableContext(capturedCtx).registerPanel({
        panelId: 'panel-a',
        title: 'Panel A',
        position: 'right',
      });
      requireDockableContext(capturedCtx).syncPanelGroup('panel-a', 'right', undefined);
    });
    expect(requireDockableContext(capturedCtx).tabGroups.right.tabs).toEqual(['panel-a']);

    // Switch to cluster-b.
    setMockedKubeconfig({
      selectedClusterId: 'cluster-b',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    expect(requireDockableContext(capturedCtx).tabGroups.right.tabs).toEqual([]);

    // Switch back to cluster-a.
    setMockedKubeconfig({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    expect(requireDockableContext(capturedCtx).tabGroups.right.tabs).toEqual(['panel-a']);
  });

  // === Task 8 ===
  it('clears a cluster store when the cluster tab is closed', () => {
    let capturedCtx: ReturnType<typeof useDockablePanelContext> | null = null;
    function Probe() {
      capturedCtx = useDockablePanelContext();
      return null;
    }

    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    act(() => {
      requireDockableContext(capturedCtx).registerPanel({
        panelId: 'panel-a',
        title: 'Panel A',
        position: 'right',
      });
      requireDockableContext(capturedCtx).syncPanelGroup('panel-a', 'right', undefined);
    });
    expect(requireDockableContext(capturedCtx).tabGroups.right.tabs).toEqual(['panel-a']);

    setMockedKubeconfig({
      selectedClusterId: 'cluster-b',
      selectedClusterIds: ['cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    expect(requireDockableContext(capturedCtx).tabGroups.right.tabs).toEqual([]);

    // Re-open cluster-a — fresh state expected.
    setMockedKubeconfig({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    expect(requireDockableContext(capturedCtx).tabGroups.right.tabs).toEqual([]);
  });

  // === Task 9 ===
  it('treats fixed-id panels (e.g. diagnostics) as per-cluster too', () => {
    let capturedCtx: ReturnType<typeof useDockablePanelContext> | null = null;
    function Probe() {
      capturedCtx = useDockablePanelContext();
      return null;
    }

    // Cluster-a: dock 'diagnostics' to the right.
    setMockedKubeconfig({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    act(() => {
      requireDockableContext(capturedCtx).registerPanel({
        panelId: 'diagnostics',
        title: 'Diagnostics',
        position: 'right',
      });
      requireDockableContext(capturedCtx).syncPanelGroup('diagnostics', 'right', undefined);
    });
    expect(requireDockableContext(capturedCtx).tabGroups.right.tabs).toEqual(['diagnostics']);

    // Cluster-b: empty.
    setMockedKubeconfig({
      selectedClusterId: 'cluster-b',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    expect(requireDockableContext(capturedCtx).tabGroups.right.tabs).toEqual([]);
    expect(requireDockableContext(capturedCtx).tabGroups.bottom.tabs).toEqual([]);

    // Open diagnostics on cluster-b in the bottom dock.
    act(() => {
      requireDockableContext(capturedCtx).registerPanel({
        panelId: 'diagnostics',
        title: 'Diagnostics',
        position: 'bottom',
      });
      requireDockableContext(capturedCtx).syncPanelGroup('diagnostics', 'bottom', undefined);
    });
    expect(requireDockableContext(capturedCtx).tabGroups.bottom.tabs).toEqual(['diagnostics']);

    // Switch back to cluster-a.
    setMockedKubeconfig({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    expect(requireDockableContext(capturedCtx).tabGroups.right.tabs).toEqual(['diagnostics']);
    expect(requireDockableContext(capturedCtx).tabGroups.bottom.tabs).toEqual([]);

    // And cluster-b still has it in the bottom dock.
    setMockedKubeconfig({
      selectedClusterId: 'cluster-b',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    expect(requireDockableContext(capturedCtx).tabGroups.bottom.tabs).toEqual(['diagnostics']);
    expect(requireDockableContext(capturedCtx).tabGroups.right.tabs).toEqual([]);
  });

  // === Task 10 ===
  it('does not strip tab-group membership when a panel unmounts mid-cluster', () => {
    let capturedCtx: ReturnType<typeof useDockablePanelContext> | null = null;
    function Probe() {
      capturedCtx = useDockablePanelContext();
      return null;
    }

    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    act(() => {
      requireDockableContext(capturedCtx).registerPanel({
        panelId: 'panel-a',
        title: 'Panel A',
        position: 'right',
      });
      requireDockableContext(capturedCtx).syncPanelGroup('panel-a', 'right', undefined);
    });
    expect(requireDockableContext(capturedCtx).tabGroups.right.tabs).toEqual(['panel-a']);

    // Simulate the panel unregistering WITHOUT calling any close path.
    act(() => {
      requireDockableContext(capturedCtx).unregisterPanel('panel-a');
    });

    // tabGroups should still contain panel-a.
    expect(requireDockableContext(capturedCtx).tabGroups.right.tabs).toEqual(['panel-a']);
  });

  // === Task 11 ===
  it('preserves floating group identities across cluster switches', () => {
    let capturedCtx: ReturnType<typeof useDockablePanelContext> | null = null;
    function Probe() {
      capturedCtx = useDockablePanelContext();
      return null;
    }

    setMockedKubeconfig({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });

    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });

    // Place two panels in the same floating group on cluster-a. The
    // setLastFocusedGroupKey('floating-1') call between the two syncs
    // matches the production flow: when the user drags a second panel
    // onto an existing floating group, the provider treats the focused
    // floating group as the target. Without this hint, syncPanelGroup
    // would create a fresh floating group for panel-b.
    act(() => {
      requireDockableContext(capturedCtx).registerPanel({
        panelId: 'panel-a',
        title: 'Panel A',
        position: 'floating',
      });
      requireDockableContext(capturedCtx).syncPanelGroup('panel-a', 'floating', undefined);
    });
    act(() => {
      requireDockableContext(capturedCtx).setLastFocusedGroupKey('floating-1');
      requireDockableContext(capturedCtx).registerPanel({
        panelId: 'panel-b',
        title: 'Panel B',
        position: 'floating',
      });
      requireDockableContext(capturedCtx).syncPanelGroup('panel-b', 'floating', undefined);
    });

    const floatingBefore = requireDockableContext(capturedCtx).tabGroups.floating;
    expect(floatingBefore.length).toBeGreaterThanOrEqual(1);
    const groupContaining = floatingBefore.find(
      (g) => g.tabs.includes('panel-a') && g.tabs.includes('panel-b')
    );
    expect(groupContaining).toBeDefined();
    const originalGroupId = requireValue(
      groupContaining,
      'expected test value in DockablePanelProvider.test.tsx'
    ).groupId;

    // Switch to cluster-b and back.
    setMockedKubeconfig({
      selectedClusterId: 'cluster-b',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });
    setMockedKubeconfig({
      selectedClusterId: 'cluster-a',
      selectedClusterIds: ['cluster-a', 'cluster-b'],
    });
    act(() => {
      root.render(
        <DockablePanelProvider>
          <Probe />
        </DockablePanelProvider>
      );
    });

    const floatingAfter = requireDockableContext(capturedCtx).tabGroups.floating;
    const restoredGroup = floatingAfter.find((g) => g.groupId === originalGroupId);
    expect(restoredGroup).toBeDefined();
    expect(
      requireValue(restoredGroup, 'expected test value in DockablePanelProvider.test.tsx').tabs
    ).toEqual(expect.arrayContaining(['panel-a', 'panel-b']));
  });
});
