/**
 * frontend/src/components/dockable/DockableTabBar.drag.test.tsx
 *
 * Test suite for DockableTabBar drag-and-drop behavior.
 * Covers drag initiation, cancel, reorder, cross-group move,
 * undock, drop indicator rendering, and dragging opacity class.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DockableTabBar, TabInfo } from './DockableTabBar';
import type { TabDragState } from './tabGroupTypes';

/** Helper to render a React element into a fresh DOM host. */
const renderTabBar = async (ui: React.ReactElement) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);

  await act(async () => {
    root.render(ui);
    await Promise.resolve();
  });

  return {
    host,
    root,
    /** Re-render with new props. */
    rerender: async (newUi: React.ReactElement) => {
      await act(async () => {
        root.render(newUi);
        await Promise.resolve();
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
};

/** Default tabs used across tests. */
const defaultTabs: TabInfo[] = [
  { panelId: 'p1', title: 'Logs' },
  { panelId: 'p2', title: 'Events' },
  { panelId: 'p3', title: 'Terminal' },
];

/** Simulate a mousedown on a DOM element at a given client position. */
function fireMouseDown(el: HTMLElement, clientX: number, clientY: number) {
  el.dispatchEvent(new MouseEvent('mousedown', { clientX, clientY, button: 0, bubbles: true }));
}

/** Simulate a mousemove on document at a given client position. */
function fireMouseMove(clientX: number, clientY: number) {
  document.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY, bubbles: true }));
}

/** Simulate a mouseup on document. */
function fireMouseUp() {
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

describe('DockableTabBar drag-and-drop', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  // -----------------------------------------------------------------------
  // 1. Drag initiation
  // -----------------------------------------------------------------------
  it('initiates drag after mousedown + mousemove beyond threshold', async () => {
    const onDragStateChange = vi.fn();

    const { host, unmount } = await renderTabBar(
      <DockableTabBar
        tabs={defaultTabs}
        activeTab="p1"
        onTabClick={vi.fn()}
                groupKey="bottom"
        dragState={null}
        onDragStateChange={onDragStateChange}
        onReorderTab={vi.fn()}
        onMoveToGroup={vi.fn()}
        onUndockTab={vi.fn()}
      />
    );

    const tabElements = host.querySelectorAll('.dockable-tab');
    const secondTab = tabElements[1] as HTMLElement;

    // Mousedown on second tab.
    await act(async () => {
      fireMouseDown(secondTab, 100, 50);
    });

    // Move less than threshold -- should NOT trigger drag.
    await act(async () => {
      fireMouseMove(102, 51);
    });
    expect(onDragStateChange).not.toHaveBeenCalled();

    // Move beyond threshold (>5px).
    await act(async () => {
      fireMouseMove(110, 50);
    });
    expect(onDragStateChange).toHaveBeenCalledTimes(1);

    const state = onDragStateChange.mock.calls[0][0] as TabDragState;
    expect(state.panelId).toBe('p2');
    expect(state.sourceGroupKey).toBe('bottom');
    expect(state.cursorPosition).toEqual({ x: 110, y: 50 });

    // Clean up.
    await act(async () => {
      fireMouseUp();
    });

    await unmount();
  });

  // -----------------------------------------------------------------------
  // 2. Drag cancel -- mouseup near the bar without a drop target
  // -----------------------------------------------------------------------
  it('cancels drag on mouseup when cursor is within bar bounds and no drop target', async () => {
    const onReorderTab = vi.fn();
    const onMoveToGroup = vi.fn();
    const onUndockTab = vi.fn();
    const onDragStateChange = vi.fn();

    // In jsdom, getBoundingClientRect returns {top: 0, bottom: 0, ...}, so
    // cursor Y must be within UNDOCK_THRESHOLD (40px) of 0 to avoid triggering undock.
    const activeDragState: TabDragState = {
      panelId: 'p2',
      sourceGroupKey: 'bottom',
      cursorPosition: { x: 110, y: 20 },
      dropTarget: null,
    };

    const { host, unmount } = await renderTabBar(
      <DockableTabBar
        tabs={defaultTabs}
        activeTab="p1"
        onTabClick={vi.fn()}
                groupKey="bottom"
        dragState={activeDragState}
        onDragStateChange={onDragStateChange}
        onReorderTab={onReorderTab}
        onMoveToGroup={onMoveToGroup}
        onUndockTab={onUndockTab}
      />
    );

    // Set up drag start ref by doing a mousedown + mousemove.
    const tabElements = host.querySelectorAll('.dockable-tab');
    const secondTab = tabElements[1] as HTMLElement;

    await act(async () => {
      fireMouseDown(secondTab, 100, 10);
      fireMouseMove(110, 20);
    });

    // Mouseup -- cursor is close to bar (20px < 40px threshold), no drop target => cancel.
    await act(async () => {
      fireMouseUp();
    });

    // No action callbacks should fire (reorder, move, undock).
    expect(onReorderTab).not.toHaveBeenCalled();
    expect(onMoveToGroup).not.toHaveBeenCalled();
    expect(onUndockTab).not.toHaveBeenCalled();

    // Drag state should be cleared.
    expect(onDragStateChange).toHaveBeenCalledWith(null);

    await unmount();
  });

  // -----------------------------------------------------------------------
  // 3. Reorder -- drop with same-group dropTarget calls onReorderTab
  // -----------------------------------------------------------------------
  it('calls onReorderTab when drop target matches the source group', async () => {
    const onReorderTab = vi.fn();
    const onDragStateChange = vi.fn();

    const activeDragState: TabDragState = {
      panelId: 'p1',
      sourceGroupKey: 'bottom',
      cursorPosition: { x: 200, y: 50 },
      dropTarget: { groupKey: 'bottom', insertIndex: 2 },
    };

    const { host, unmount } = await renderTabBar(
      <DockableTabBar
        tabs={defaultTabs}
        activeTab="p1"
        onTabClick={vi.fn()}
                groupKey="bottom"
        dragState={activeDragState}
        onDragStateChange={onDragStateChange}
        onReorderTab={onReorderTab}
        onMoveToGroup={vi.fn()}
        onUndockTab={vi.fn()}
      />
    );

    // Simulate the drag start ref by doing mousedown + mousemove.
    const tabElements = host.querySelectorAll('.dockable-tab');
    const firstTab = tabElements[0] as HTMLElement;

    await act(async () => {
      fireMouseDown(firstTab, 50, 50);
      fireMouseMove(200, 50);
    });

    // Release -- drop target is same group.
    await act(async () => {
      fireMouseUp();
    });

    expect(onReorderTab).toHaveBeenCalledWith('p1', 2);
    expect(onDragStateChange).toHaveBeenCalledWith(null);

    await unmount();
  });

  // -----------------------------------------------------------------------
  // 4. Move to different group -- dropTarget with different groupKey
  // -----------------------------------------------------------------------
  it('calls onMoveToGroup when drop target is a different group', async () => {
    const onMoveToGroup = vi.fn();
    const onDragStateChange = vi.fn();

    const activeDragState: TabDragState = {
      panelId: 'p2',
      sourceGroupKey: 'bottom',
      cursorPosition: { x: 300, y: 100 },
      dropTarget: { groupKey: 'right', insertIndex: 0 },
    };

    const { host, unmount } = await renderTabBar(
      <DockableTabBar
        tabs={defaultTabs}
        activeTab="p1"
        onTabClick={vi.fn()}
                groupKey="bottom"
        dragState={activeDragState}
        onDragStateChange={onDragStateChange}
        onReorderTab={vi.fn()}
        onMoveToGroup={onMoveToGroup}
        onUndockTab={vi.fn()}
      />
    );

    // Start drag.
    const tabElements = host.querySelectorAll('.dockable-tab');
    const secondTab = tabElements[1] as HTMLElement;

    await act(async () => {
      fireMouseDown(secondTab, 100, 50);
      fireMouseMove(300, 100);
    });

    // Release -- drop target is a different group.
    await act(async () => {
      fireMouseUp();
    });

    expect(onMoveToGroup).toHaveBeenCalledWith('p2', 'right', 0);
    expect(onDragStateChange).toHaveBeenCalledWith(null);

    await unmount();
  });

  // -----------------------------------------------------------------------
  // 5. Undock -- mouseup far from source bar with no drop target
  // -----------------------------------------------------------------------
  it('calls onUndockTab when cursor is far from the source bar', async () => {
    const onUndockTab = vi.fn();
    const onDragStateChange = vi.fn();

    // Cursor is 100px below the bar -- well past the 40px threshold.
    const activeDragState: TabDragState = {
      panelId: 'p2',
      sourceGroupKey: 'bottom',
      cursorPosition: { x: 200, y: 200 },
      dropTarget: null,
    };

    const { host, unmount } = await renderTabBar(
      <DockableTabBar
        tabs={defaultTabs}
        activeTab="p1"
        onTabClick={vi.fn()}
                groupKey="bottom"
        dragState={activeDragState}
        onDragStateChange={onDragStateChange}
        onReorderTab={vi.fn()}
        onMoveToGroup={vi.fn()}
        onUndockTab={onUndockTab}
      />
    );

    // Start drag.
    const tabElements = host.querySelectorAll('.dockable-tab');
    const secondTab = tabElements[1] as HTMLElement;

    await act(async () => {
      fireMouseDown(secondTab, 100, 50);
      fireMouseMove(200, 200);
    });

    // Release -- far from bar, no drop target => undock.
    await act(async () => {
      fireMouseUp();
    });

    expect(onUndockTab).toHaveBeenCalledWith('p2', 200, 200);
    expect(onDragStateChange).toHaveBeenCalledWith(null);

    await unmount();
  });

  // -----------------------------------------------------------------------
  // 6. Drop indicator renders when dropTarget matches this bar's groupKey
  // -----------------------------------------------------------------------
  it('renders a drop indicator when this bar is the drop target', async () => {
    const activeDragState: TabDragState = {
      panelId: 'p1',
      sourceGroupKey: 'right', // Different group, so this bar is a drop target.
      cursorPosition: { x: 100, y: 50 },
      dropTarget: { groupKey: 'bottom', insertIndex: 1 },
    };

    const { host, unmount } = await renderTabBar(
      <DockableTabBar
        tabs={defaultTabs}
        activeTab="p1"
        onTabClick={vi.fn()}
                groupKey="bottom"
        dragState={activeDragState}
        onDragStateChange={vi.fn()}
        onReorderTab={vi.fn()}
        onMoveToGroup={vi.fn()}
        onUndockTab={vi.fn()}
      />
    );

    // The bar should have the drop target class.
    const bar = host.querySelector('.dockable-tab-bar') as HTMLElement;
    expect(bar.classList.contains('dockable-tab-bar--drop-target')).toBe(true);

    // There should be a drop indicator element.
    const indicator = host.querySelector('.dockable-tab-bar__drop-indicator');
    expect(indicator).toBeTruthy();

    await unmount();
  });

  it('does NOT render a drop indicator when this bar is NOT the drop target', async () => {
    const activeDragState: TabDragState = {
      panelId: 'p1',
      sourceGroupKey: 'bottom',
      cursorPosition: { x: 100, y: 50 },
      dropTarget: { groupKey: 'right', insertIndex: 0 }, // Different bar is the target.
    };

    const { host, unmount } = await renderTabBar(
      <DockableTabBar
        tabs={defaultTabs}
        activeTab="p1"
        onTabClick={vi.fn()}
                groupKey="bottom"
        dragState={activeDragState}
        onDragStateChange={vi.fn()}
        onReorderTab={vi.fn()}
        onMoveToGroup={vi.fn()}
        onUndockTab={vi.fn()}
      />
    );

    const bar = host.querySelector('.dockable-tab-bar') as HTMLElement;
    expect(bar.classList.contains('dockable-tab-bar--drop-target')).toBe(false);

    const indicator = host.querySelector('.dockable-tab-bar__drop-indicator');
    expect(indicator).toBeNull();

    await unmount();
  });

  // -----------------------------------------------------------------------
  // 7. Dragged tab has reduced opacity class
  // -----------------------------------------------------------------------
  it('applies dockable-tab--dragging class to the tab being dragged', async () => {
    const activeDragState: TabDragState = {
      panelId: 'p2',
      sourceGroupKey: 'bottom',
      cursorPosition: { x: 200, y: 50 },
      dropTarget: null,
    };

    const { host, unmount } = await renderTabBar(
      <DockableTabBar
        tabs={defaultTabs}
        activeTab="p1"
        onTabClick={vi.fn()}
                groupKey="bottom"
        dragState={activeDragState}
        onDragStateChange={vi.fn()}
        onReorderTab={vi.fn()}
        onMoveToGroup={vi.fn()}
        onUndockTab={vi.fn()}
      />
    );

    const tabElements = host.querySelectorAll('.dockable-tab');

    // Only the second tab (p2) should have the dragging class.
    expect(tabElements[0].classList.contains('dockable-tab--dragging')).toBe(false);
    expect(tabElements[1].classList.contains('dockable-tab--dragging')).toBe(true);
    expect(tabElements[2].classList.contains('dockable-tab--dragging')).toBe(false);

    await unmount();
  });

  it('does NOT apply dragging class when no drag state', async () => {
    const { host, unmount } = await renderTabBar(
      <DockableTabBar
        tabs={defaultTabs}
        activeTab="p1"
        onTabClick={vi.fn()}
                groupKey="bottom"
        dragState={null}
        onDragStateChange={vi.fn()}
        onReorderTab={vi.fn()}
        onMoveToGroup={vi.fn()}
        onUndockTab={vi.fn()}
      />
    );

    const draggingTabs = host.querySelectorAll('.dockable-tab--dragging');
    expect(draggingTabs).toHaveLength(0);

    await unmount();
  });

  // -----------------------------------------------------------------------
  // 8. Drag is disabled when drag props are not provided
  // -----------------------------------------------------------------------
  it('does not start drag when drag props are absent', async () => {
    const { host, unmount } = await renderTabBar(
      <DockableTabBar
        tabs={defaultTabs}
        activeTab="p1"
        onTabClick={vi.fn()}
                groupKey="bottom"
        // No drag props provided.
      />
    );

    const tabElements = host.querySelectorAll('.dockable-tab');
    const firstTab = tabElements[0] as HTMLElement;

    // Mousedown + move should not cause any errors.
    await act(async () => {
      fireMouseDown(firstTab, 50, 50);
      fireMouseMove(100, 50);
      fireMouseUp();
    });

    // No dragging class should be applied.
    const draggingTabs = host.querySelectorAll('.dockable-tab--dragging');
    expect(draggingTabs).toHaveLength(0);

    await unmount();
  });

  // -----------------------------------------------------------------------
  // 9. Drop indicator at end of tab list
  // -----------------------------------------------------------------------
  it('renders drop indicator at the end when insertIndex equals tabs length', async () => {
    const activeDragState: TabDragState = {
      panelId: 'p1',
      sourceGroupKey: 'right',
      cursorPosition: { x: 500, y: 50 },
      dropTarget: { groupKey: 'bottom', insertIndex: 3 }, // After all 3 tabs.
    };

    const { host, unmount } = await renderTabBar(
      <DockableTabBar
        tabs={defaultTabs}
        activeTab="p1"
        onTabClick={vi.fn()}
                groupKey="bottom"
        dragState={activeDragState}
        onDragStateChange={vi.fn()}
        onReorderTab={vi.fn()}
        onMoveToGroup={vi.fn()}
        onUndockTab={vi.fn()}
      />
    );

    // The bar should have the drop target class.
    const bar = host.querySelector('.dockable-tab-bar') as HTMLElement;
    expect(bar.classList.contains('dockable-tab-bar--drop-target')).toBe(true);

    // The drop indicator should be the last child of the bar.
    const indicator = host.querySelector('.dockable-tab-bar__drop-indicator');
    expect(indicator).toBeTruthy();
    // It should come after the last tab, which means it's the last element in the bar.
    expect(bar.lastElementChild?.classList.contains('dockable-tab-bar__drop-indicator')).toBe(true);

    await unmount();
  });
});
