/**
 * frontend/src/ui/dockable/DockableTabBar.test.tsx
 *
 * Test suite for DockableTabBar.
 * Covers rendering, active tab state, click handling, and close-button
 * rendering. Overflow scrolling and keyboard navigation live in the
 * shared `<Tabs>` component's own test suite; we don't re-verify them
 * here — this suite only exercises the dockable-specific glue.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DockableTabBar, TabInfo } from './DockableTabBar';
import { DockablePanelProvider } from './DockablePanelProvider';
import { TabDragProvider } from '@shared/components/tabs/dragCoordinator';

/** Helper to render a React element into a fresh DOM host. */
const renderTabBar = async (ui: React.ReactElement) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);

  await act(async () => {
    root.render(
      <TabDragProvider>
        <DockablePanelProvider>{ui}</DockablePanelProvider>
      </TabDragProvider>
    );
    await Promise.resolve();
  });

  return {
    host,
    root,
    rerender: async (newUi: React.ReactElement) => {
      await act(async () => {
        root.render(
          <TabDragProvider>
            <DockablePanelProvider>{newUi}</DockablePanelProvider>
          </TabDragProvider>
        );
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
    const labels = host.querySelectorAll('.tab-item__label');
    expect(labels).toHaveLength(3);
    expect(labels[0].textContent).toBe('Logs');
    expect(labels[1].textContent).toBe('Events');
    expect(labels[2].textContent).toBe('Terminal');

    // All tabs should have the role="tab" attribute.
    const tabElements = host.querySelectorAll('[role="tab"]');
    expect(tabElements).toHaveLength(3);

    await unmount();
  });

  it('marks the active tab via aria-selected and .tab-item--active', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
    ];

    const { host, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p2" onTabClick={vi.fn()} groupKey="bottom" />
    );

    const tabElements = host.querySelectorAll('[role="tab"]');
    expect(tabElements).toHaveLength(2);

    // First tab should NOT be active.
    expect(tabElements[0].classList.contains('tab-item--active')).toBe(false);
    expect(tabElements[0].getAttribute('aria-selected')).toBe('false');

    // Second tab should be active.
    expect(tabElements[1].classList.contains('tab-item--active')).toBe(true);
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

    const tabElements = host.querySelectorAll('[role="tab"]');

    // Click the second tab.
    await act(async () => {
      (tabElements[1] as HTMLElement).click();
    });

    expect(onTabClick).toHaveBeenCalledTimes(1);
    expect(onTabClick).toHaveBeenCalledWith('p2');

    await unmount();
  });

  it('renders close buttons on each tab with per-tab aria-labels', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
    ];

    const { host, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
    );

    // Each tab should have a close button (visibility is CSS-controlled on hover).
    const closeButtons = host.querySelectorAll('.tab-item__close');
    expect(closeButtons).toHaveLength(2);
    expect(closeButtons[0].getAttribute('aria-label')).toBe('Close Logs');
    expect(closeButtons[1].getAttribute('aria-label')).toBe('Close Events');

    await unmount();
  });

  it('renders a small kind indicator square when tab kindClass is provided', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'api', kindClass: 'deployment' },
      { panelId: 'p2', title: 'worker' },
    ];

    const { host, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="right" />
    );

    const indicators = host.querySelectorAll('.dockable-tab__kind-indicator');
    expect(indicators).toHaveLength(1);
    expect(indicators[0].classList.contains('kind-badge')).toBe(true);
    expect(indicators[0].classList.contains('deployment')).toBe(true);
    expect(indicators[0].textContent).toBe('');

    await unmount();
  });

  it('sets data-panel-id on each tab for DOM lookup', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
    ];

    const { host, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
    );

    const tabEls = host.querySelectorAll('[role="tab"]');
    expect(tabEls).toHaveLength(2);
    expect((tabEls[0] as HTMLElement).getAttribute('data-panel-id')).toBe('p1');
    expect((tabEls[1] as HTMLElement).getAttribute('data-panel-id')).toBe('p2');

    await unmount();
  });
});
