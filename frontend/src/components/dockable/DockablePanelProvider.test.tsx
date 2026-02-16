/**
 * frontend/src/components/dockable/DockablePanelProvider.test.tsx
 *
 * Test suite for DockablePanelProvider.
 * Covers key behaviors and edge cases for DockablePanelProvider.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DockablePanelProvider, useDockablePanelContext } from './DockablePanelProvider';
import { DockableTabBar } from './DockableTabBar';

const render = async (element: React.ReactElement) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    root.render(element);
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
    // Clean up all children from body
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    Reflect.deleteProperty(document, 'elementFromPoint');
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

  it('renders a cursor-following drag preview while a tab drag is active', async () => {
    const contextRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };

    const { container, unmount } = await render(
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );

    await act(async () => {
      contextRef.current!.registerPanel({
        panelId: 'drag-tab',
        title: 'Drag Tab',
        position: 'right',
        tabKindClass: 'pod',
      });
      contextRef.current!.startTabDrag('drag-tab', 'right', 100, 80);
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: () => null,
      });
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 110, clientY: 80 })
      );
      await Promise.resolve();
    });

    const preview = container.querySelector('.dockable-tab-drag-preview') as HTMLDivElement | null;
    expect(preview).toBeTruthy();
    expect(preview?.textContent).toContain('Drag Tab');
    expect(preview?.querySelector('.dockable-tab-drag-preview__kind.pod')).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue('--dockable-tab-drag-x')).toContain(
      '124'
    );
    expect(document.documentElement.style.getPropertyValue('--dockable-tab-drag-y')).toContain(
      '96'
    );

    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 110, clientY: 80 })
      );
      await Promise.resolve();
    });

    expect(container.querySelector('.dockable-tab-drag-preview')).toBeNull();

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

  it('moves a tab between groups through the provider drag controller', async () => {
    const contextRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Consumer: React.FC = () => {
      const ctx = useDockablePanelContext();
      contextRef.current = ctx;
      const bottomTabs = ctx.tabGroups.bottom.tabs.map((panelId) => ({
        panelId,
        title: ctx.panelRegistrations.get(panelId)?.title ?? panelId,
      }));
      const rightTabs = ctx.tabGroups.right.tabs.map((panelId) => ({
        panelId,
        title: ctx.panelRegistrations.get(panelId)?.title ?? panelId,
      }));
      return (
        <>
          <DockableTabBar
            tabs={bottomTabs}
            activeTab={ctx.tabGroups.bottom.activeTab}
            onTabClick={() => {}}
            groupKey="bottom"
          />
          <DockableTabBar
            tabs={rightTabs}
            activeTab={ctx.tabGroups.right.activeTab}
            onTabClick={() => {}}
            groupKey="right"
          />
        </>
      );
    };

    const { container, unmount } = await render(
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

    const bars = container.querySelectorAll('.dockable-tab-bar');
    const bottomBar = bars[0] as HTMLElement;
    const rightBar = bars[1] as HTMLElement;
    const bottomTabs = bottomBar.querySelectorAll('.dockable-tab');
    const rightTabs = rightBar.querySelectorAll('.dockable-tab');
    const draggedTab = bottomTabs[0] as HTMLElement;

    setRect(bottomBar, 0, 320, 0, 30);
    setRect(rightBar, 400, 720, 0, 30);
    setRect(bottomTabs[0], 0, 120, 0, 30);
    setRect(bottomTabs[1], 120, 240, 0, 30);
    setRect(rightTabs[0], 400, 520, 0, 30);

    const originalElementFromPoint = (
      document as Document & {
        elementFromPoint?: (x: number, y: number) => Element | null;
      }
    ).elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: (x: number) => (x >= 380 ? rightBar : bottomBar),
    });

    await act(async () => {
      draggedTab.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 20, clientY: 12 })
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 470, clientY: 12 })
      );
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 470, clientY: 12 })
      );
    });

    expect(contextRef.current!.tabGroups.bottom.tabs).toEqual(['bottom-b']);
    expect(contextRef.current!.tabGroups.right.tabs).toEqual(['right-a', 'bottom-a']);

    if (originalElementFromPoint) {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
    } else {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
    await unmount();
  });

  it('undocks a tab through the provider drag controller when dropped away from tab bars', async () => {
    const contextRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Consumer: React.FC = () => {
      const ctx = useDockablePanelContext();
      contextRef.current = ctx;
      const bottomTabs = ctx.tabGroups.bottom.tabs.map((panelId) => ({
        panelId,
        title: ctx.panelRegistrations.get(panelId)?.title ?? panelId,
      }));
      return (
        <DockableTabBar
          tabs={bottomTabs}
          activeTab={ctx.tabGroups.bottom.activeTab}
          onTabClick={() => {}}
          groupKey="bottom"
        />
      );
    };

    const { container, unmount } = await render(
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

    const bottomBar = container.querySelector('.dockable-tab-bar') as HTMLElement;
    const draggedTab = container.querySelector('.dockable-tab') as HTMLElement;
    setRect(bottomBar, 0, 320, 0, 24);
    setRect(draggedTab, 0, 120, 0, 24);

    const originalElementFromPoint = (
      document as Document & {
        elementFromPoint?: (x: number, y: number) => Element | null;
      }
    ).elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => null,
    });

    await act(async () => {
      draggedTab.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 20, clientY: 10 })
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 220, clientY: 220 })
      );
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 220, clientY: 220 })
      );
    });

    expect(contextRef.current!.tabGroups.bottom.tabs).toEqual([]);
    expect(contextRef.current!.tabGroups.floating).toHaveLength(1);
    expect(contextRef.current!.tabGroups.floating[0].tabs).toEqual(['bottom-a']);

    if (originalElementFromPoint) {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
    } else {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
    await unmount();
  });
});
