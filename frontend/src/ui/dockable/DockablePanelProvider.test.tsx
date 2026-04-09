/**
 * frontend/src/ui/dockable/DockablePanelProvider.test.tsx
 *
 * Test suite for DockablePanelProvider.
 * Covers tab-group state, panel lifecycle, focus routing, drag adapters,
 * and the container-level empty-space drop target.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DockablePanelProvider, useDockablePanelContext } from './DockablePanelProvider';
import { DockableTabBar } from './DockableTabBar';
import { useDockablePanelEmptySpaceDropTarget } from './DockablePanelContentArea';
import {
  TabDragProvider,
  TAB_DRAG_DATA_TYPE,
  type TabDragPayload,
} from '@shared/components/tabs/dragCoordinator';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

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
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const setRect = (element: Element, left: number, right: number, top = 0, bottom = 28) => {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: left,
      y: top,
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top,
      toJSON: () => ({}),
    }),
  });
};

/**
 * Minimal DataTransfer polyfill for jsdom drag simulation.
 */
function createDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    dropEffect: 'move',
    effectAllowed: 'move',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [] as unknown as readonly string[],
    setData: (format: string, data: string) => {
      store.set(format, data);
    },
    getData: (format: string) => store.get(format) ?? '',
    clearData: () => {
      store.clear();
    },
    setDragImage: () => {},
  } as unknown as DataTransfer;
}

function dispatchDragEvent(
  target: EventTarget,
  type: string,
  clientX: number,
  clientY: number,
  dataTransfer: DataTransfer
) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    clientX: number;
    clientY: number;
    dataTransfer: DataTransfer;
  };
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  target.dispatchEvent(event);
}

function seedPayload(dataTransfer: DataTransfer, payload: TabDragPayload) {
  dataTransfer.setData(TAB_DRAG_DATA_TYPE, JSON.stringify(payload));
}

describe('DockablePanelProvider', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    // Create a .content element so the panel host can be appended inside it.
    const contentEl = document.createElement('div');
    contentEl.className = 'content';
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
    expect(contextRef.current!.tabGroups.right.tabs).toEqual([]);
    expect(contextRef.current!.tabGroups.bottom.tabs).toEqual([]);
    expect(contextRef.current!.tabGroups.floating).toEqual([]);

    // Register a right panel.
    await act(async () => {
      contextRef.current!.registerPanel({
        panelId: 'logs',
        title: 'Logs',
        position: 'right',
      });
      contextRef.current!.syncPanelGroup('logs', 'right');
      await Promise.resolve();
    });
    expect(contextRef.current!.tabGroups.right.tabs).toEqual(['logs']);
    expect(contextRef.current!.tabGroups.right.activeTab).toBe('logs');

    // Register a second right panel.
    await act(async () => {
      contextRef.current!.registerPanel({
        panelId: 'details',
        title: 'Details',
        position: 'right',
      });
      contextRef.current!.syncPanelGroup('details', 'right');
      await Promise.resolve();
    });
    expect(contextRef.current!.tabGroups.right.tabs).toEqual(['logs', 'details']);
    // Most recently added panel becomes active.
    expect(contextRef.current!.tabGroups.right.activeTab).toBe('details');

    // switchTab to logs.
    await act(async () => {
      contextRef.current!.switchTab('right', 'logs');
      await Promise.resolve();
    });
    expect(contextRef.current!.tabGroups.right.activeTab).toBe('logs');

    // Unregister details.
    await act(async () => {
      contextRef.current!.removePanelFromGroups('details');
      contextRef.current!.unregisterPanel('details');
      await Promise.resolve();
    });
    expect(contextRef.current!.tabGroups.right.tabs).toEqual(['logs']);

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
      contextRef.current!.registerPanel({
        panelId: 'panel-a',
        title: 'Panel A',
        position: 'right',
      });
      contextRef.current!.syncPanelGroup('panel-a', 'right');
      await Promise.resolve();
    });

    expect(contextRef.current!.tabGroups.right.tabs).toContain('panel-a');
    expect(contextRef.current!.tabGroups.bottom.tabs).not.toContain('panel-a');

    await act(async () => {
      // Preferred group should be ignored after the panel is already grouped.
      contextRef.current!.syncPanelGroup('panel-a', 'right', 'bottom');
      await Promise.resolve();
    });

    expect(contextRef.current!.tabGroups.right.tabs).toContain('panel-a');
    expect(contextRef.current!.tabGroups.bottom.tabs).not.toContain('panel-a');

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
      contextRef.current!.registerPanel({
        panelId: 'float-a',
        title: 'Float A',
        position: 'floating',
      });
      contextRef.current!.syncPanelGroup('float-a', 'floating');
      await Promise.resolve();
    });

    expect(contextRef.current!.tabGroups.floating).toHaveLength(1);
    expect(contextRef.current!.tabGroups.floating[0].tabs).toEqual(['float-a']);

    await act(async () => {
      contextRef.current!.setLastFocusedGroupKey('floating-1');
      contextRef.current!.registerPanel({
        panelId: 'float-b',
        title: 'Float B',
        position: 'floating',
      });
      contextRef.current!.syncPanelGroup('float-b', 'floating');
      await Promise.resolve();
    });

    expect(contextRef.current!.tabGroups.floating).toHaveLength(1);
    expect(contextRef.current!.tabGroups.floating[0].tabs).toEqual(['float-a', 'float-b']);
    expect(contextRef.current!.tabGroups.floating[0].activeTab).toBe('float-b');

    await unmount();
  });

  it('keeps an already-floating panel in its own group during subsequent syncs', async () => {
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
      contextRef.current!.registerPanel({
        panelId: 'float-a',
        title: 'Float A',
        position: 'floating',
      });
      contextRef.current!.syncPanelGroup('float-a', 'floating');
      await Promise.resolve();
    });

    await act(async () => {
      contextRef.current!.registerPanel({
        panelId: 'right-b',
        title: 'Right B',
        position: 'right',
      });
      contextRef.current!.syncPanelGroup('right-b', 'right');
      contextRef.current!.setLastFocusedGroupKey('floating-1');
      await Promise.resolve();
    });

    await act(async () => {
      contextRef.current!.movePanelBetweenGroups('right-b', 'floating');
      await Promise.resolve();
    });

    // Existing floating panel should remain in floating-1 even after another
    // tab is moved to a new floating group and this panel re-syncs.
    await act(async () => {
      contextRef.current!.syncPanelGroup('float-a', 'floating');
      await Promise.resolve();
    });

    const floatingGroups = contextRef.current!.tabGroups.floating;
    expect(floatingGroups).toHaveLength(2);
    expect(floatingGroups[0].groupId).toBe('floating-1');
    expect(floatingGroups[0].tabs).toEqual(['float-a']);
    expect(floatingGroups[1].groupId).toBe('floating-2');
    expect(floatingGroups[1].tabs).toEqual(['right-b']);

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
      contextRef.current!.registerPanel({
        panelId: 'float-a',
        title: 'Float A',
        position: 'floating',
      });
      contextRef.current!.syncPanelGroup('float-a', 'floating');
      await Promise.resolve();
    });

    expect(contextRef.current!.getLastFocusedPosition()).toBe('right');

    await act(async () => {
      contextRef.current!.setLastFocusedGroupKey('floating-1');
      await Promise.resolve();
    });

    expect(contextRef.current!.getLastFocusedPosition()).toBe('floating');

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

    expect(contextRef.current!.getPreferredOpenGroupKey('bottom')).toBe('bottom');

    await act(async () => {
      contextRef.current!.registerPanel({
        panelId: 'float-a',
        title: 'Float A',
        position: 'floating',
      });
      contextRef.current!.syncPanelGroup('float-a', 'floating');
      contextRef.current!.setLastFocusedGroupKey('floating-1');
      await Promise.resolve();
    });

    expect(contextRef.current!.getPreferredOpenGroupKey('right')).toBe('floating-1');

    await unmount();
  });

  it('keeps focus on moved floating panel so the next open joins that floating panel', async () => {
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
      contextRef.current!.registerPanel({
        panelId: 'obj-a',
        title: 'Object A',
        position: 'right',
      });
      contextRef.current!.syncPanelGroup('obj-a', 'right');
      await Promise.resolve();
    });

    await act(async () => {
      contextRef.current!.movePanelBetweenGroups('obj-a', 'floating');
      await Promise.resolve();
    });

    expect(contextRef.current!.getLastFocusedPosition()).toBe('floating');
    expect(contextRef.current!.tabGroups.floating).toHaveLength(1);
    expect(contextRef.current!.tabGroups.floating[0].tabs).toEqual(['obj-a']);

    await act(async () => {
      contextRef.current!.registerPanel({
        panelId: 'obj-b',
        title: 'Object B',
        position: contextRef.current!.getLastFocusedPosition(),
      });
      contextRef.current!.syncPanelGroup('obj-b', contextRef.current!.getLastFocusedPosition());
      await Promise.resolve();
    });

    expect(contextRef.current!.tabGroups.floating).toHaveLength(1);
    expect(contextRef.current!.tabGroups.floating[0].tabs).toEqual(['obj-a', 'obj-b']);

    await unmount();
  });

  it('moves and focuses via the centralized movePanelBetweenGroupsAndFocus command', async () => {
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
      contextRef.current!.registerPanel({
        panelId: 'obj-a',
        title: 'Object A',
        position: 'right',
      });
      contextRef.current!.syncPanelGroup('obj-a', 'right');
      await Promise.resolve();
    });

    await act(async () => {
      contextRef.current!.movePanelBetweenGroupsAndFocus('obj-a', 'floating');
      await Promise.resolve();
    });

    expect(contextRef.current!.tabGroups.floating).toHaveLength(1);
    expect(contextRef.current!.tabGroups.floating[0].tabs).toEqual(['obj-a']);
    expect(contextRef.current!.getLastFocusedPosition()).toBe('floating');

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
      contextRef.current!.registerPanel({
        panelId: 'bottom-a',
        title: 'Bottom A',
        position: 'bottom',
      });
      contextRef.current!.syncPanelGroup('bottom-a', 'bottom');
      contextRef.current!.registerPanel({
        panelId: 'bottom-b',
        title: 'Bottom B',
        position: 'bottom',
      });
      contextRef.current!.syncPanelGroup('bottom-b', 'bottom');
      contextRef.current!.registerPanel({
        panelId: 'right-a',
        title: 'Right A',
        position: 'right',
      });
      contextRef.current!.syncPanelGroup('right-a', 'right');
      await Promise.resolve();
    });

    // Simulate a cross-group drop via the movePanel adapter directly.
    await act(async () => {
      contextRef.current!.movePanel('bottom-a', 'bottom', 'right', 1);
      await Promise.resolve();
    });

    expect(contextRef.current!.tabGroups.bottom.tabs).toEqual(['bottom-b']);
    expect(contextRef.current!.tabGroups.right.tabs).toEqual(['right-a', 'bottom-a']);

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
        contextRef.current!.registerPanel({
          panelId: id,
          title: id.toUpperCase(),
          position: 'right',
        });
        contextRef.current!.syncPanelGroup(id, 'right');
      }
      await Promise.resolve();
    });

    // Source at index 0, drop at insertIndex 3: shift compensation →
    // adjustedInsert = 2, reorderTab removes 'a' then splices at 2.
    // Expected: ['b','c','a','d']
    await act(async () => {
      contextRef.current!.movePanel('a', 'right', 'right', 3);
      await Promise.resolve();
    });
    expect(contextRef.current!.tabGroups.right.tabs).toEqual(['b', 'c', 'a', 'd']);

    // Drop at end (insertIndex = 4): source 'c' at index 1, sourceIdx <
    // insertIndex → adjustedInsert = 3. Remove 'c' → ['b','a','d'],
    // splice at 3 → ['b','a','d','c'].
    await act(async () => {
      contextRef.current!.movePanel('c', 'right', 'right', 4);
      await Promise.resolve();
    });
    expect(contextRef.current!.tabGroups.right.tabs).toEqual(['b', 'a', 'd', 'c']);

    // No-op drop onto self.
    await act(async () => {
      contextRef.current!.movePanel('a', 'right', 'right', 1);
      await Promise.resolve();
    });
    expect(contextRef.current!.tabGroups.right.tabs).toEqual(['b', 'a', 'd', 'c']);

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
        contextRef.current!.registerPanel({
          panelId: id,
          title: id.toUpperCase(),
          position: 'floating',
        });
        contextRef.current!.syncPanelGroup(id, 'floating');
      }
      await Promise.resolve();
    });

    // Collapse them into one group (floating-1) by moving b, c, d into
    // floating-1 (the group created by the first call).
    const floatingId = contextRef.current!.tabGroups.floating[0].groupId;
    await act(async () => {
      contextRef.current!.setLastFocusedGroupKey(floatingId);
      await Promise.resolve();
    });

    // Move b, c, d into floating-1 via addPanelToFloatingGroup path. Use
    // movePanelBetweenGroups with the specific floating group id as the
    // target.
    await act(async () => {
      contextRef.current!.movePanelBetweenGroups('b', floatingId);
      contextRef.current!.movePanelBetweenGroups('c', floatingId);
      contextRef.current!.movePanelBetweenGroups('d', floatingId);
      await Promise.resolve();
    });

    // Now the floating group should contain all four tabs.
    const group = contextRef.current!.tabGroups.floating.find((g) => g.groupId === floatingId)!;
    expect(group.tabs).toEqual(['a', 'b', 'c', 'd']);

    // Forward reorder: move 'a' to insertIndex = 2. Shift compensation:
    // sourceIdx 0 < insertIndex 2 → adjustedInsert = 1. Expected:
    // ['b','a','c','d']. Without getGroupTabs handling floating ids, the
    // compensation is skipped and the result would be ['b','c','a','d'].
    await act(async () => {
      contextRef.current!.movePanel('a', floatingId, floatingId, 2);
      await Promise.resolve();
    });

    const afterReorder = contextRef.current!.tabGroups.floating.find(
      (g) => g.groupId === floatingId
    )!;
    expect(afterReorder.tabs).toEqual(['b', 'a', 'c', 'd']);

    await unmount();
  });

  it('createFloatingGroupWithPanel moves a panel into a new floating group at the cursor', async () => {
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
      contextRef.current!.registerPanel({
        panelId: 'bottom-a',
        title: 'Bottom A',
        position: 'bottom',
      });
      contextRef.current!.syncPanelGroup('bottom-a', 'bottom');
      await Promise.resolve();
    });

    await act(async () => {
      contextRef.current!.createFloatingGroupWithPanel('bottom-a', 'bottom', { x: 220, y: 220 });
      await Promise.resolve();
    });

    expect(contextRef.current!.tabGroups.bottom.tabs).toEqual([]);
    expect(contextRef.current!.tabGroups.floating).toHaveLength(1);
    expect(contextRef.current!.tabGroups.floating[0].tabs).toEqual(['bottom-a']);

    await unmount();
  });

  it('empty-space drop target creates a floating group from an existing panel', async () => {
    // Integration test for Task 9 Step 5: the hook from
    // DockablePanelContentArea.tsx wires a container-level drop target
    // that calls createFloatingGroupWithPanel on drop.
    const contextRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Harness: React.FC = () => {
      const ctx = useDockablePanelContext();
      contextRef.current = ctx;
      const { ref: dropRef } = useDockablePanelEmptySpaceDropTarget();
      const bottomTabs = ctx.tabGroups.bottom.tabs.map((panelId) => ({
        panelId,
        title: ctx.panelRegistrations.get(panelId)?.title ?? panelId,
      }));
      return (
        <div
          ref={dropRef as (el: HTMLDivElement | null) => void}
          className="dockable-container-test-harness"
        >
          <DockableTabBar
            tabs={bottomTabs}
            activeTab={ctx.tabGroups.bottom.activeTab}
            onTabClick={() => {}}
            groupKey="bottom"
          />
        </div>
      );
    };

    const { container, unmount } = await render(
      <DockablePanelProvider>
        <Harness />
      </DockablePanelProvider>
    );

    await act(async () => {
      contextRef.current!.registerPanel({
        panelId: 'bottom-a',
        title: 'Bottom A',
        position: 'bottom',
      });
      contextRef.current!.syncPanelGroup('bottom-a', 'bottom');
      await Promise.resolve();
    });

    const containerEl = container.querySelector('.dockable-container-test-harness') as HTMLElement;
    setRect(containerEl, 0, 800, 0, 600);

    const dataTransfer = createDataTransfer();
    seedPayload(dataTransfer, {
      kind: 'dockable-tab',
      panelId: 'bottom-a',
      sourceGroupId: 'bottom',
    });

    await act(async () => {
      // Dispatch the drop on the outer container (not on a tab bar) so
      // it lands on the empty-space drop target, not the bar's target.
      dispatchDragEvent(containerEl, 'dragover', 400, 300, dataTransfer);
      dispatchDragEvent(containerEl, 'drop', 400, 300, dataTransfer);
      await Promise.resolve();
    });

    expect(contextRef.current!.tabGroups.bottom.tabs).toEqual([]);
    expect(contextRef.current!.tabGroups.floating).toHaveLength(1);
    expect(contextRef.current!.tabGroups.floating[0].tabs).toEqual(['bottom-a']);

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
      capturedCtx!.registerPanel({
        panelId: 'panel-a',
        title: 'Panel A',
        position: 'right',
      });
      capturedCtx!.syncPanelGroup('panel-a', 'right', undefined);
    });
    expect(capturedCtx!.tabGroups.right.tabs).toEqual(['panel-a']);

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
    expect(capturedCtx!.tabGroups.right.tabs).toEqual([]);

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
    expect(capturedCtx!.tabGroups.right.tabs).toEqual(['panel-a']);
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
      capturedCtx!.registerPanel({
        panelId: 'panel-a',
        title: 'Panel A',
        position: 'right',
      });
      capturedCtx!.syncPanelGroup('panel-a', 'right', undefined);
    });
    expect(capturedCtx!.tabGroups.right.tabs).toEqual(['panel-a']);

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
    expect(capturedCtx!.tabGroups.right.tabs).toEqual([]);

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
    expect(capturedCtx!.tabGroups.right.tabs).toEqual([]);
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
      capturedCtx!.registerPanel({
        panelId: 'diagnostics',
        title: 'Diagnostics',
        position: 'right',
      });
      capturedCtx!.syncPanelGroup('diagnostics', 'right', undefined);
    });
    expect(capturedCtx!.tabGroups.right.tabs).toEqual(['diagnostics']);

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
    expect(capturedCtx!.tabGroups.right.tabs).toEqual([]);
    expect(capturedCtx!.tabGroups.bottom.tabs).toEqual([]);

    // Open diagnostics on cluster-b in the bottom dock.
    act(() => {
      capturedCtx!.registerPanel({
        panelId: 'diagnostics',
        title: 'Diagnostics',
        position: 'bottom',
      });
      capturedCtx!.syncPanelGroup('diagnostics', 'bottom', undefined);
    });
    expect(capturedCtx!.tabGroups.bottom.tabs).toEqual(['diagnostics']);

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
    expect(capturedCtx!.tabGroups.right.tabs).toEqual(['diagnostics']);
    expect(capturedCtx!.tabGroups.bottom.tabs).toEqual([]);

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
    expect(capturedCtx!.tabGroups.bottom.tabs).toEqual(['diagnostics']);
    expect(capturedCtx!.tabGroups.right.tabs).toEqual([]);
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
      capturedCtx!.registerPanel({
        panelId: 'panel-a',
        title: 'Panel A',
        position: 'right',
      });
      capturedCtx!.syncPanelGroup('panel-a', 'right', undefined);
    });
    expect(capturedCtx!.tabGroups.right.tabs).toEqual(['panel-a']);

    // Simulate the panel unregistering WITHOUT calling any close path.
    act(() => {
      capturedCtx!.unregisterPanel('panel-a');
    });

    // tabGroups should still contain panel-a.
    expect(capturedCtx!.tabGroups.right.tabs).toEqual(['panel-a']);
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
      capturedCtx!.registerPanel({
        panelId: 'panel-a',
        title: 'Panel A',
        position: 'floating',
      });
      capturedCtx!.syncPanelGroup('panel-a', 'floating', undefined);
    });
    act(() => {
      capturedCtx!.setLastFocusedGroupKey('floating-1');
      capturedCtx!.registerPanel({
        panelId: 'panel-b',
        title: 'Panel B',
        position: 'floating',
      });
      capturedCtx!.syncPanelGroup('panel-b', 'floating', undefined);
    });

    const floatingBefore = capturedCtx!.tabGroups.floating;
    expect(floatingBefore.length).toBeGreaterThanOrEqual(1);
    const groupContaining = floatingBefore.find(
      (g) => g.tabs.includes('panel-a') && g.tabs.includes('panel-b')
    );
    expect(groupContaining).toBeDefined();
    const originalGroupId = groupContaining!.groupId;

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

    const floatingAfter = capturedCtx!.tabGroups.floating;
    const restoredGroup = floatingAfter.find((g) => g.groupId === originalGroupId);
    expect(restoredGroup).toBeDefined();
    expect(restoredGroup!.tabs).toEqual(expect.arrayContaining(['panel-a', 'panel-b']));
  });
});
