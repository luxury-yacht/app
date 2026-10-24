/**
 * frontend/src/ui/dockable/DockablePanelProvider.test.tsx
 *
 * Test suite for DockablePanelProvider.
 * Covers tab-group state, panel lifecycle, focus routing, drag adapters, and
 * per-cluster dock layouts. The provider renders inside the production shell
 * with two real open clusters; cluster tabs switch through the real
 * kubeconfig owner (test-utils/appState).
 */

import type React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { DockablePanelTestHost } from '@/test-utils/DockablePanelTestHost';
import { requireValue } from '@/test-utils/requireValue';
import { resolveObjectPanelMountTarget } from '@/ui/layout/objectPanelMountTarget';
import {
  DockablePanelLayer,
  DockablePanelProvider,
  useDockablePanelContext,
} from './DockablePanelProvider';

type DockablePanelContextValue = ReturnType<typeof useDockablePanelContext>;

const requireDockableContext = (
  value: DockablePanelContextValue | null
): DockablePanelContextValue =>
  requireValue<DockablePanelContextValue | null>(
    value,
    'expected the dockable-panel context after rendering the probe'
  );

const app = installAppStateHarness();
let view: MountedApp;
let alpha: TestCluster;
let beta: TestCluster;

beforeEach(async () => {
  alpha = app.cluster({ name: 'dev', context: 'alpha' });
  beta = app.cluster({ name: 'dev', context: 'beta' });
  app.namespaces(alpha, ['default']);
  app.namespaces(beta, ['default']);
  view = await app.render(null);
});

const render = async (element: React.ReactElement) => {
  await view.show(element);
  return {
    container: view.container,
    rerender: (nextElement: React.ReactElement) => view.show(nextElement),
    unmount: async () => view.clear(),
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
    document.querySelectorAll('.content').forEach((node) => {
      node.remove();
    });
    document.documentElement.style.removeProperty('--dock-right-offset');
    document.documentElement.style.removeProperty('--dock-bottom-offset');
  });

  it('creates a shared host layer inside .content', async () => {
    const { unmount } = await render(
      <DockablePanelProvider>
        <DockablePanelTestHost />
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

  it('treats a void group-move callback as an intercepted request', async () => {
    const contextRef: { current: DockablePanelContextValue | null } = { current: null };
    const requestMove = vi.fn();
    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };
    const Provider = DockablePanelProvider as React.ComponentType<
      React.PropsWithChildren<{
        onGroupMoveRequest: (
          group: { groupKey: string; tabs: string[]; activeTab: string | null },
          targetPosition: 'right' | 'bottom' | 'floating'
        ) => void;
      }>
    >;
    const { unmount } = await render(
      <Provider onGroupMoveRequest={requestMove}>
        <Consumer />
      </Provider>
    );

    await act(async () => {
      const context = requireDockableContext(contextRef.current);
      context.registerPanel({ panelId: 'panel-a', title: 'A', position: 'right' });
      context.syncPanelGroup('panel-a', 'right');
      await Promise.resolve();
    });

    expect(requireDockableContext(contextRef.current).requestGroupMove?.('right', 'bottom')).toBe(
      true
    );
    expect(requestMove).toHaveBeenCalledWith(
      { groupKey: 'right', tabs: ['panel-a'], activeTab: 'panel-a' },
      'bottom'
    );
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

    const { unmount } = await render(
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );

    await act(async () => {
      requireDockableContext(contextRef.current).syncPanelGroup('panel-a', 'right');
      await Promise.resolve();
    });

    await view.selectCluster(beta);

    await act(async () => {
      requireDockableContext(contextRef.current).syncPanelGroup('panel-b', 'bottom');
      requireDockableContext(contextRef.current).discardPanelLayouts(alpha.clusterId, ['panel-a']);
      await Promise.resolve();
    });
    expect(requireDockableContext(contextRef.current).tabGroups.bottom.tabs).toEqual(['panel-b']);

    await view.selectCluster(alpha);
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
        context.dockPanelGroup(alpha.clusterId, ['panel-a', 'panel-b'], 'panel-a', targetPosition);
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
      context.detachPanelGroup(alpha.clusterId, ['native-panel']);
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
      requireDockableContext(contextRef.current).discardPanelLayouts(alpha.clusterId, [
        'floating-panel',
      ]);
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
  let capturedCtx: DockablePanelContextValue | null = null;
  function Probe() {
    capturedCtx = useDockablePanelContext();
    return null;
  }
  const ctx = () => requireDockableContext(capturedCtx);
  const showProvider = () =>
    view.show(
      <DockablePanelProvider>
        <Probe />
      </DockablePanelProvider>
    );
  const dockPanel = async (panelId: string, position: 'right' | 'bottom' | 'floating') => {
    await act(async () => {
      ctx().registerPanel({ panelId, title: panelId, position });
      ctx().syncPanelGroup(panelId, position, undefined);
    });
  };

  beforeEach(() => {
    capturedCtx = null;
  });

  it.each(['target cluster', 'stale cluster', 'newest request'])(
    'keeps deferred focus scoped to the %s',
    async (scenario) => {
      let captured: DockablePanelContextValue | null = null;
      const FocusProbe = () => {
        captured = useDockablePanelContext();
        return (
          <>
            <button type="button" data-testid="outside">
              Outside
            </button>
            <button type="button" role="tab" data-panel-id="deferred">
              Deferred
            </button>
            <button type="button" role="tab" data-panel-id="newer">
              Newer
            </button>
          </>
        );
      };
      await view.show(
        <DockablePanelProvider>
          <FocusProbe />
        </DockablePanelProvider>
      );
      const outside = requireValue(
        view.container.querySelector<HTMLButtonElement>('[data-testid="outside"]'),
        'outside'
      );
      outside.focus();
      await act(async () =>
        requireDockableContext(captured).focusPanel(
          'deferred',
          scenario === 'target cluster' ? beta.clusterId : alpha.clusterId
        )
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(document.activeElement).toBe(outside);

      if (scenario === 'newest request') {
        await act(async () => {
          const context = requireDockableContext(captured);
          context.focusPanel('newer');
          // A docked panel registers as its content mounts.
          context.registerPanel({ panelId: 'newer', title: 'Newer', position: 'right' });
          context.syncPanelGroup('newer', 'right');
        });
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
        expect(document.activeElement).toBe(
          view.container.querySelector('[data-panel-id="newer"]')
        );
      } else {
        await view.selectCluster(beta);
        if (scenario === 'stale cluster') {
          await view.selectCluster(alpha);
        }
      }
      await act(async () => {
        const context = requireDockableContext(captured);
        context.registerPanel({ panelId: 'deferred', title: 'Deferred', position: 'right' });
        context.syncPanelGroup('deferred', 'right');
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const expected =
        scenario === 'target cluster'
          ? view.container.querySelector('[data-panel-id="deferred"]')
          : scenario === 'newest request'
            ? view.container.querySelector('[data-panel-id="newer"]')
            : outside;
      expect(document.activeElement).toBe(expected);
    }
  );

  it('focuses a docked panel whose tab appears only when it registers', async () => {
    // The directory can dock a panel before its content mounts and registers,
    // and the dock shows a tab only for a registered panel.
    vi.useFakeTimers();
    try {
      await view.show(
        <DockablePanelProvider>
          <Probe />
          <DockablePanelLayer />
        </DockablePanelProvider>
      );
      await act(async () => {
        ctx().syncPanelGroup('late', 'right', undefined);
        ctx().focusPanel('late');
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });

      await act(async () => {
        ctx().registerPanel({ panelId: 'late', title: 'Late', position: 'right' });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });

      expect(
        document.activeElement?.closest('[data-panel-id]')?.getAttribute('data-panel-id')
      ).toBe('late');
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves tabGroups across cluster switch round-trip', async () => {
    await showProvider();
    await dockPanel('panel-a', 'right');
    expect(ctx().tabGroups.right.tabs).toEqual(['panel-a']);

    await view.selectCluster(beta);
    expect(ctx().tabGroups.right.tabs).toEqual([]);

    await view.selectCluster(alpha);
    expect(ctx().tabGroups.right.tabs).toEqual(['panel-a']);
  });

  it('clears a cluster store when the cluster tab is closed', async () => {
    await showProvider();
    await dockPanel('panel-a', 'right');
    expect(ctx().tabGroups.right.tabs).toEqual(['panel-a']);

    await view.selectCluster(beta);
    await act(async () => {
      await view.owners().kubeconfig.closeKubeconfig(alpha.selection);
    });
    await app.settle();
    expect(view.owners().kubeconfig.managedClusterIds).toEqual([beta.clusterId]);
    expect(ctx().tabGroups.right.tabs).toEqual([]);

    // Re-open the closed cluster: its dock starts fresh.
    await act(async () => {
      await view.owners().kubeconfig.openKubeconfig(alpha.selection);
    });
    await app.settle();
    expect(view.owners().kubeconfig.selectedClusterId).toBe(alpha.clusterId);
    expect(ctx().tabGroups.right.tabs).toEqual([]);
  });

  it('treats fixed-id panels (e.g. diagnostics) as per-cluster too', async () => {
    await showProvider();
    await dockPanel('diagnostics', 'right');
    expect(ctx().tabGroups.right.tabs).toEqual(['diagnostics']);

    // The other cluster's dock starts empty.
    await view.selectCluster(beta);
    expect(ctx().tabGroups.right.tabs).toEqual([]);
    expect(ctx().tabGroups.bottom.tabs).toEqual([]);

    // Diagnostics opens in that cluster's bottom dock.
    await dockPanel('diagnostics', 'bottom');
    expect(ctx().tabGroups.bottom.tabs).toEqual(['diagnostics']);

    await view.selectCluster(alpha);
    expect(ctx().tabGroups.right.tabs).toEqual(['diagnostics']);
    expect(ctx().tabGroups.bottom.tabs).toEqual([]);

    await view.selectCluster(beta);
    expect(ctx().tabGroups.bottom.tabs).toEqual(['diagnostics']);
    expect(ctx().tabGroups.right.tabs).toEqual([]);
  });

  it('does not strip tab-group membership when a panel unmounts mid-cluster', async () => {
    await showProvider();
    await dockPanel('panel-a', 'right');
    expect(ctx().tabGroups.right.tabs).toEqual(['panel-a']);

    // The panel unregisters without any close path.
    await act(async () => {
      ctx().unregisterPanel('panel-a');
    });

    expect(ctx().tabGroups.right.tabs).toEqual(['panel-a']);
  });

  it('preserves floating group identities across cluster switches', async () => {
    await showProvider();
    // Two panels share one floating group. The setLastFocusedGroupKey call
    // between the syncs matches production: a second panel dragged onto an
    // existing floating group targets the focused group; without the hint,
    // syncPanelGroup would create a new floating group for panel-b.
    await dockPanel('panel-a', 'floating');
    await act(async () => {
      ctx().setLastFocusedGroupKey('floating-1');
      ctx().registerPanel({ panelId: 'panel-b', title: 'Panel B', position: 'floating' });
      ctx().syncPanelGroup('panel-b', 'floating', undefined);
    });

    const groupContaining = ctx().tabGroups.floating.find(
      (g) => g.tabs.includes('panel-a') && g.tabs.includes('panel-b')
    );
    const originalGroupId = requireValue(groupContaining, 'shared floating group').groupId;

    await view.selectCluster(beta);
    await view.selectCluster(alpha);

    const restoredGroup = ctx().tabGroups.floating.find((g) => g.groupId === originalGroupId);
    expect(requireValue(restoredGroup, 'restored floating group').tabs).toEqual(
      expect.arrayContaining(['panel-a', 'panel-b'])
    );
  });
});
