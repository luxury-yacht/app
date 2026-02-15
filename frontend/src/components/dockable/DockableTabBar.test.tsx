/**
 * frontend/src/components/dockable/DockableTabBar.test.tsx
 *
 * Test suite for DockableTabBar.
 * Covers rendering, active tab state, click handling, and event propagation.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DockableTabBar, TabInfo } from './DockableTabBar';

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
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
};

describe('DockableTabBar', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('renders tab labels for each panel', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
      { panelId: 'p3', title: 'Terminal' },
    ];

    const { host, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
    );

    // Each tab should have a label span with the correct text.
    const labels = host.querySelectorAll('.dockable-tab__label');
    expect(labels).toHaveLength(3);
    expect(labels[0].textContent).toBe('Logs');
    expect(labels[1].textContent).toBe('Events');
    expect(labels[2].textContent).toBe('Terminal');

    // All tabs should have the role="tab" attribute.
    const tabElements = host.querySelectorAll('[role="tab"]');
    expect(tabElements).toHaveLength(3);

    await unmount();
  });

  it('marks the active tab with .dockable-tab--active class', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
    ];

    const { host, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p2" onTabClick={vi.fn()} groupKey="bottom" />
    );

    const tabElements = host.querySelectorAll('.dockable-tab');
    expect(tabElements).toHaveLength(2);

    // First tab should NOT be active.
    expect(tabElements[0].classList.contains('dockable-tab--active')).toBe(false);
    expect(tabElements[0].getAttribute('aria-selected')).toBe('false');

    // Second tab should be active.
    expect(tabElements[1].classList.contains('dockable-tab--active')).toBe(true);
    expect(tabElements[1].getAttribute('aria-selected')).toBe('true');

    await unmount();
  });

  it('calls onTabClick when a tab is clicked', async () => {
    const onTabClick = vi.fn();
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
    ];

    const { host, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={onTabClick} groupKey="bottom" />
    );

    const tabElements = host.querySelectorAll('.dockable-tab');

    // Click the second tab.
    await act(async () => {
      (tabElements[1] as HTMLElement).click();
    });

    expect(onTabClick).toHaveBeenCalledTimes(1);
    expect(onTabClick).toHaveBeenCalledWith('p2');

    await unmount();
  });

  it('does not render close buttons on tabs', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
    ];

    const { host, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
    );

    // Tabs should never have close buttons (close is done via panel controls).
    const closeButtons = host.querySelectorAll('.dockable-tab__close');
    expect(closeButtons).toHaveLength(0);

    await unmount();
  });

  it('stops mousedown propagation on the tab bar container', async () => {
    const parentMouseDown = vi.fn();
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
    ];

    const { host, unmount } = await renderTabBar(
      <div onMouseDown={parentMouseDown}>
        <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
      </div>
    );

    // Dispatch a mousedown event on the tab bar container.
    const tabBar = host.querySelector('.dockable-tab-bar') as HTMLDivElement;
    expect(tabBar).toBeTruthy();

    await act(async () => {
      tabBar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    // The parent should NOT receive the mousedown event.
    expect(parentMouseDown).not.toHaveBeenCalled();

    await unmount();
  });
});
