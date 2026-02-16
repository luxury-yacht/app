/**
 * frontend/src/components/dockable/DockableTabBar.drag.test.tsx
 *
 * Provider-integrated drag/drop tests for DockableTabBar.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DockableTabBar } from './DockableTabBar';
import { DockablePanelProvider, useDockablePanelContext } from './DockablePanelProvider';

const renderWithProvider = async (ui: React.ReactElement) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);

  await act(async () => {
    root.render(<DockablePanelProvider>{ui}</DockablePanelProvider>);
    await Promise.resolve();
  });

  return {
    host,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
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

const registerDockedTab = async (
  ctx: ReturnType<typeof useDockablePanelContext>,
  panelId: string,
  title: string,
  position: 'right' | 'bottom'
) => {
  await act(async () => {
    ctx.registerPanel({ panelId, title, position });
    ctx.syncPanelGroup(panelId, position);
    await Promise.resolve();
  });
};

describe('DockableTabBar drag-and-drop (provider mode)', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    const contentEl = document.createElement('div');
    contentEl.className = 'content';
    document.body.appendChild(contentEl);
  });

  afterEach(() => {
    Reflect.deleteProperty(document, 'elementFromPoint');
    document.body.replaceChildren();
  });

  it('shows drag preview and dragging class while a tab is being dragged', async () => {
    const ctxRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Harness: React.FC = () => {
      const ctx = useDockablePanelContext();
      ctxRef.current = ctx;
      const rightTabs = ctx.tabGroups.right.tabs.map((panelId) => ({
        panelId,
        title: ctx.panelRegistrations.get(panelId)?.title ?? panelId,
      }));
      return (
        <DockableTabBar
          tabs={rightTabs}
          activeTab={ctx.tabGroups.right.activeTab}
          onTabClick={() => {}}
          groupKey="right"
        />
      );
    };

    const { host, unmount } = await renderWithProvider(<Harness />);

    await registerDockedTab(ctxRef.current!, 'p1', 'Logs', 'right');

    const bar = host.querySelector('.dockable-tab-bar') as HTMLElement;
    const tab = host.querySelector('.dockable-tab') as HTMLElement;
    setRect(bar, 0, 320, 0, 24);
    setRect(tab, 0, 120, 0, 24);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => bar,
    });

    await act(async () => {
      tab.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 20, clientY: 10 })
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 40, clientY: 10 })
      );
    });

    expect(host.querySelector('.dockable-tab-drag-preview')?.textContent).toContain('Logs');
    expect(tab.classList.contains('dockable-tab--dragging')).toBe(true);

    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 40, clientY: 10 })
      );
    });

    expect(host.querySelector('.dockable-tab-drag-preview')).toBeNull();

    await unmount();
  });

  it('reorders tabs within the same group on drop', async () => {
    const ctxRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Harness: React.FC = () => {
      const ctx = useDockablePanelContext();
      ctxRef.current = ctx;
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

    const { host, unmount } = await renderWithProvider(<Harness />);

    await registerDockedTab(ctxRef.current!, 'p1', 'One', 'bottom');
    await registerDockedTab(ctxRef.current!, 'p2', 'Two', 'bottom');
    await registerDockedTab(ctxRef.current!, 'p3', 'Three', 'bottom');

    const bar = host.querySelector('.dockable-tab-bar') as HTMLElement;
    const tabs = host.querySelectorAll('.dockable-tab');
    const draggedTab = tabs[0] as HTMLElement;
    setRect(bar, 0, 360, 0, 24);
    setRect(tabs[0], 0, 120, 0, 24);
    setRect(tabs[1], 120, 240, 0, 24);
    setRect(tabs[2], 240, 360, 0, 24);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => bar,
    });

    await act(async () => {
      draggedTab.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 20, clientY: 10 })
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 330, clientY: 10 })
      );
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 330, clientY: 10 })
      );
      await Promise.resolve();
    });

    expect(ctxRef.current!.tabGroups.bottom.tabs).toEqual(['p2', 'p3', 'p1']);

    await unmount();
  });

  it('moves a dragged tab to a different group on cross-group drop', async () => {
    const ctxRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Harness: React.FC = () => {
      const ctx = useDockablePanelContext();
      ctxRef.current = ctx;
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

    const { host, unmount } = await renderWithProvider(<Harness />);

    await registerDockedTab(ctxRef.current!, 'p1', 'One', 'bottom');
    await registerDockedTab(ctxRef.current!, 'p2', 'Two', 'bottom');
    await registerDockedTab(ctxRef.current!, 'r1', 'Right One', 'right');

    const bars = host.querySelectorAll('.dockable-tab-bar');
    const bottomBar = bars[0] as HTMLElement;
    const rightBar = bars[1] as HTMLElement;
    const bottomTabs = bottomBar.querySelectorAll('.dockable-tab');
    const rightTabs = rightBar.querySelectorAll('.dockable-tab');

    setRect(bottomBar, 0, 360, 0, 24);
    setRect(rightBar, 400, 760, 0, 24);
    setRect(bottomTabs[0], 0, 120, 0, 24);
    setRect(bottomTabs[1], 120, 240, 0, 24);
    setRect(rightTabs[0], 400, 520, 0, 24);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: (x: number) => (x >= 400 ? rightBar : bottomBar),
    });

    await act(async () => {
      (bottomTabs[0] as HTMLElement).dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 20, clientY: 10 })
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: 10 })
      );
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 500, clientY: 10 })
      );
      await Promise.resolve();
    });

    expect(ctxRef.current!.tabGroups.bottom.tabs).toEqual(['p2']);
    expect(ctxRef.current!.tabGroups.right.tabs).toEqual(['r1', 'p1']);

    await unmount();
  });

  it('undocks a dragged tab when dropped away from tab bars', async () => {
    const ctxRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Harness: React.FC = () => {
      const ctx = useDockablePanelContext();
      ctxRef.current = ctx;
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

    const { host, unmount } = await renderWithProvider(<Harness />);

    await registerDockedTab(ctxRef.current!, 'p1', 'One', 'bottom');

    const bar = host.querySelector('.dockable-tab-bar') as HTMLElement;
    const tab = host.querySelector('.dockable-tab') as HTMLElement;
    setRect(bar, 0, 320, 0, 24);
    setRect(tab, 0, 120, 0, 24);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => null,
    });

    await act(async () => {
      tab.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 20, clientY: 10 })
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 220, clientY: 220 })
      );
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 220, clientY: 220 })
      );
      await Promise.resolve();
    });

    expect(ctxRef.current!.tabGroups.bottom.tabs).toEqual([]);
    expect(ctxRef.current!.tabGroups.floating).toHaveLength(1);
    expect(ctxRef.current!.tabGroups.floating[0].tabs).toEqual(['p1']);

    await unmount();
  });
});
