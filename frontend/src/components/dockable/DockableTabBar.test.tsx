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
import { DockablePanelProvider } from './DockablePanelProvider';

/** Helper to render a React element into a fresh DOM host. */
const renderTabBar = async (ui: React.ReactElement) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);

  await act(async () => {
    root.render(<DockablePanelProvider>{ui}</DockablePanelProvider>);
    await Promise.resolve();
  });

  return {
    host,
    root,
    rerender: async (newUi: React.ReactElement) => {
      await act(async () => {
        root.render(<DockablePanelProvider>{newUi}</DockablePanelProvider>);
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

/**
 * Provide deterministic scroll metrics for jsdom and expose a setter
 * so tests can emulate horizontal scrolling.
 */
const mockTabBarMetrics = (tabBar: HTMLElement, scrollWidth: number, clientWidth: number) => {
  let currentScrollLeft = 0;

  Object.defineProperty(tabBar, 'scrollWidth', {
    configurable: true,
    get: () => scrollWidth,
  });
  Object.defineProperty(tabBar, 'clientWidth', {
    configurable: true,
    get: () => clientWidth,
  });
  Object.defineProperty(tabBar, 'scrollLeft', {
    configurable: true,
    get: () => currentScrollLeft,
    set: (next: number) => {
      currentScrollLeft = next;
    },
  });

  return {
    setScrollLeft: (next: number) => {
      currentScrollLeft = next;
    },
    getScrollLeft: () => currentScrollLeft,
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

  it('stops mousedown propagation when pressing a tab', async () => {
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

    const tab = host.querySelector('.dockable-tab') as HTMLDivElement;
    expect(tab).toBeTruthy();

    await act(async () => {
      tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });

    // The parent should NOT receive the mousedown event.
    expect(parentMouseDown).not.toHaveBeenCalled();

    await unmount();
  });

  it('allows mousedown propagation from empty tab-bar space', async () => {
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

    const tabBar = host.querySelector('.dockable-tab-bar') as HTMLDivElement;
    expect(tabBar).toBeTruthy();

    await act(async () => {
      tabBar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });

    expect(parentMouseDown).toHaveBeenCalledTimes(1);

    await unmount();
  });

  it('shows overflow hints when tabs exceed available width', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
      { panelId: 'p3', title: 'Terminal' },
    ];

    const { host, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
    );

    const tabBar = host.querySelector('.dockable-tab-bar') as HTMLElement;
    const metrics = mockTabBarMetrics(tabBar, 360, 180);
    Object.defineProperty(tabBar, 'scrollBy', {
      configurable: true,
      value: ({ left }: { left: number }) => {
        metrics.setScrollLeft(Math.max(0, Math.min(180, metrics.getScrollLeft() + left)));
        tabBar.dispatchEvent(new Event('scroll'));
      },
    });

    // Start at the left edge: should only show right hint.
    await act(async () => {
      metrics.setScrollLeft(0);
      window.dispatchEvent(new Event('resize'));
    });
    expect(host.querySelector('.dockable-tab-bar__overflow-indicator--left')).toBeNull();
    expect(host.querySelector('.dockable-tab-bar__overflow-indicator--right')).toBeTruthy();

    // Mid-scroll: both hints should show.
    await act(async () => {
      metrics.setScrollLeft(90);
      tabBar.dispatchEvent(new Event('scroll'));
    });
    expect(host.querySelector('.dockable-tab-bar__overflow-indicator--left')).toBeTruthy();
    expect(host.querySelector('.dockable-tab-bar__overflow-indicator--right')).toBeTruthy();

    // At far right: should only show left hint.
    await act(async () => {
      metrics.setScrollLeft(180);
      tabBar.dispatchEvent(new Event('scroll'));
    });
    expect(host.querySelector('.dockable-tab-bar__overflow-indicator--left')).toBeTruthy();
    expect(host.querySelector('.dockable-tab-bar__overflow-indicator--right')).toBeNull();

    await unmount();
  });

  it('scrolls tabs when overflow controls are clicked', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
      { panelId: 'p3', title: 'Terminal' },
    ];

    const { host, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
    );

    const tabBar = host.querySelector('.dockable-tab-bar') as HTMLElement;
    const metrics = mockTabBarMetrics(tabBar, 360, 180);
    Object.defineProperty(tabBar, 'scrollBy', {
      configurable: true,
      value: ({ left }: { left: number }) => {
        metrics.setScrollLeft(Math.max(0, Math.min(180, metrics.getScrollLeft() + left)));
        tabBar.dispatchEvent(new Event('scroll'));
      },
    });

    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    const rightControl = host.querySelector(
      '.dockable-tab-bar__overflow-indicator--right'
    ) as HTMLButtonElement;
    expect(rightControl).toBeTruthy();

    await act(async () => {
      rightControl.click();
    });
    expect(metrics.getScrollLeft()).toBe(120);
    expect(host.querySelector('.dockable-tab-bar__overflow-indicator--left')).toBeTruthy();

    const leftControl = host.querySelector(
      '.dockable-tab-bar__overflow-indicator--left'
    ) as HTMLButtonElement;
    expect(leftControl).toBeTruthy();

    await act(async () => {
      leftControl.click();
    });
    expect(metrics.getScrollLeft()).toBe(0);

    await unmount();
  });

  it('renders overflow controls inside the tab-bar container', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
      { panelId: 'p3', title: 'Terminal' },
    ];

    const { host, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
    );

    const tabBar = host.querySelector('.dockable-tab-bar') as HTMLElement;
    mockTabBarMetrics(tabBar, 360, 180);

    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    const rightControl = host.querySelector(
      '.dockable-tab-bar__overflow-indicator--right'
    ) as HTMLElement;
    expect(rightControl).toBeTruthy();
    expect(rightControl.closest('.dockable-tab-bar')).toBe(tabBar);

    await unmount();
  });

  it('hides overflow hints when tabs fit in available width', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
    ];

    const { host, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
    );

    const tabBar = host.querySelector('.dockable-tab-bar') as HTMLElement;
    mockTabBarMetrics(tabBar, 180, 180);

    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(host.querySelector('.dockable-tab-bar__overflow-indicator--left')).toBeNull();
    expect(host.querySelector('.dockable-tab-bar__overflow-indicator--right')).toBeNull();

    await unmount();
  });

  it('hides overflow hints when the tab strip has no usable width', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
      { panelId: 'p3', title: 'Terminal' },
    ];

    const { host, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
    );

    const tabBar = host.querySelector('.dockable-tab-bar') as HTMLElement;
    mockTabBarMetrics(tabBar, 360, 0);

    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(host.querySelector('.dockable-tab-bar__overflow-indicator--left')).toBeNull();
    expect(host.querySelector('.dockable-tab-bar__overflow-indicator--right')).toBeNull();

    await unmount();
  });

  it('keeps tab content and overflow controls rendered when panel width is narrow', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
      { panelId: 'p3', title: 'Terminal' },
    ];

    const { host, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
    );

    const tabBar = host.querySelector('.dockable-tab-bar') as HTMLElement;
    mockTabBarMetrics(tabBar, 360, 80);

    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(host.querySelectorAll('.dockable-tab')).toHaveLength(3);
    expect(host.querySelector('.dockable-tab-bar__overflow-indicator--left')).toBeNull();
    expect(host.querySelector('.dockable-tab-bar__overflow-indicator--right')).toBeTruthy();

    await unmount();
  });

  it('auto-scrolls to reveal a newly added tab', async () => {
    const initialTabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
    ];
    const tabsWithNew: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
      { panelId: 'p3', title: 'Terminal' },
    ];

    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    });

    try {
      const { rerender, unmount } = await renderTabBar(
        <DockableTabBar tabs={initialTabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
      );

      await act(async () => {
        await rerender(
          <DockableTabBar
            tabs={tabsWithNew}
            activeTab="p3"
            onTabClick={vi.fn()}
            groupKey="bottom"
          />
        );
      });

      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
      const revealedTab = scrollIntoViewMock.mock.instances[0] as HTMLElement;
      expect(revealedTab.dataset.panelId).toBe('p3');
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });

      await unmount();
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: originalScrollIntoView,
      });
    }
  });

  it('auto-scrolls to reveal an existing tab when it becomes active', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
      { panelId: 'p3', title: 'Terminal' },
    ];

    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    });

    try {
      const { rerender, unmount } = await renderTabBar(
        <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
      );

      await act(async () => {
        await rerender(
          <DockableTabBar tabs={tabs} activeTab="p3" onTabClick={vi.fn()} groupKey="bottom" />
        );
      });

      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
      const revealedTab = scrollIntoViewMock.mock.instances[0] as HTMLElement;
      expect(revealedTab.dataset.panelId).toBe('p3');
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });

      await unmount();
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: originalScrollIntoView,
      });
    }
  });
});
