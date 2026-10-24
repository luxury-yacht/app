/**
 * frontend/src/ui/dockable/DockableTabBar.test.tsx
 *
 * Test suite for DockableTabBar.
 * Covers rendering, active tab state, click handling, and close-button
 * rendering. Overflow scrolling and keyboard navigation live in the
 * shared `<Tabs>` component's own test suite; we don't re-verify them
 * here — this suite only exercises the dockable-specific glue.
 */

import { TabDragProvider } from '@shared/components/tabs/dragCoordinator';
import type React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { DockablePanelProvider } from './DockablePanelProvider';
import { DockableTabBar, type TabInfo } from './DockableTabBar';

// Real cluster selection and app shell around the tab bar (test-utils/appState).
const app = installAppStateHarness();
let view: MountedApp;

/** Renders the tab bar inside its own dockable provider, within the app shell. */
const renderTabBar = async (ui: React.ReactElement) => {
  await view.show(
    <TabDragProvider>
      <DockablePanelProvider>{ui}</DockablePanelProvider>
    </TabDragProvider>
  );
  return { host: view.container };
};

describe('DockableTabBar', () => {
  beforeEach(async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default']);
    view = await app.render(null);
  });

  it('marks the active tab via aria-selected and .tab-item--active', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
    ];

    const { host } = await renderTabBar(
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
  });

  it('calls onTabClick when a tab is clicked', async () => {
    const onTabClick = vi.fn();
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
    ];

    const { host } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={onTabClick} groupKey="bottom" />
    );

    const tabElements = host.querySelectorAll('[role="tab"]');

    // Click the second tab.
    await act(async () => {
      (tabElements[1] as HTMLElement).click();
    });

    expect(onTabClick).toHaveBeenCalledTimes(1);
    expect(onTabClick).toHaveBeenCalledWith('p2');
  });

  it('renders close buttons on each tab with per-tab aria-labels', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
    ];

    const { host } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
    );

    // Each tab should have a close button (visibility is CSS-controlled on hover).
    const closeButtons = host.querySelectorAll('.tab-item__close');
    expect(closeButtons).toHaveLength(2);
    expect(closeButtons[0].getAttribute('aria-label')).toBe('Close Logs');
    expect(closeButtons[1].getAttribute('aria-label')).toBe('Close Events');
  });

  it('sets data-panel-id on each tab for DOM lookup', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
    ];

    const { host } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
    );

    const tabEls = host.querySelectorAll('[role="tab"]');
    expect(tabEls).toHaveLength(2);
    expect((tabEls[0] as HTMLElement).getAttribute('data-panel-id')).toBe('p1');
    expect((tabEls[1] as HTMLElement).getAttribute('data-panel-id')).toBe('p2');
  });
});
