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

  it('renders close buttons on each tab (hidden by default via CSS)', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
    ];

    const { host, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
    );

    // Each tab should have a close button (visibility is CSS-controlled on hover).
    const closeButtons = host.querySelectorAll('.dockable-tab__close');
    expect(closeButtons).toHaveLength(2);

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

    // 3 tabs × 120px each = 360px total, 180px visible.
    // Indicator size defaults to 32px when CSS variable isn't available.
    const tabBar = host.querySelector('.dockable-tab-bar') as HTMLElement;
    const metrics = mockTabBarMetrics(tabBar, 360, 180);

    // Mock layout for each tab element so scrollToNextTab can find offscreen tabs.
    const tabEls = tabBar.querySelectorAll<HTMLElement>('[role="tab"]');
    tabEls.forEach((el, i) => {
      Object.defineProperty(el, 'offsetLeft', { configurable: true, get: () => i * 120 });
      Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => 120 });
    });

    Object.defineProperty(tabBar, 'scrollTo', {
      configurable: true,
      value: ({ left }: { left: number }) => {
        metrics.setScrollLeft(Math.max(0, Math.min(180, left)));
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

    // Click right: first tab partially hidden behind the 32px right indicator.
    // Tab 1 right edge (240) > barRight (180) - 32 + 1 = 149 → target.
    // scrollTo = 120 + 120 - 180 + 32 = 92.
    await act(async () => {
      rightControl.click();
    });
    expect(metrics.getScrollLeft()).toBe(92);

    const leftControl = host.querySelector(
      '.dockable-tab-bar__overflow-indicator--left'
    ) as HTMLButtonElement;
    expect(leftControl).toBeTruthy();

    // Click left: both tab 0 and tab 1 are behind the left indicator.
    // Last (rightmost) hidden tab is tab 1 (offsetLeft 120 < 92 + 32 - 1 = 123).
    // scrollTo = max(0, 120 - 32) = 88.
    await act(async () => {
      leftControl.click();
    });
    expect(metrics.getScrollLeft()).toBe(88);

    // Click left again: tab 0 (offsetLeft 0 < 88 + 32 - 1 = 119) → target.
    // scrollTo = max(0, 0 - 32) = 0.
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

    const { host, rerender, unmount } = await renderTabBar(
      <DockableTabBar tabs={initialTabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
    );

    // 3 tabs × 120px = 360px total, 180px visible, indicator 32px.
    const tabBar = host.querySelector('.dockable-tab-bar') as HTMLElement;
    const metrics = mockTabBarMetrics(tabBar, 360, 180);

    // Mock layout on the tab bar so that when the layout effect queries tabs
    // during rerender, each tab reports the correct position.
    const origQuerySelectorAll = tabBar.querySelectorAll.bind(tabBar);
    tabBar.querySelectorAll = ((selector: string) => {
      const result = origQuerySelectorAll(selector);
      if (selector === '.tab-item') {
        result.forEach((el: Element, i: number) => {
          Object.defineProperty(el, 'offsetLeft', { configurable: true, get: () => i * 120 });
          Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => 120 });
        });
      }
      return result;
    }) as typeof tabBar.querySelectorAll;

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

    // Tab p3 (offsetLeft 240, width 120) right edge 360 > barRight (180) - 32.
    // scrollLeft = 360 - 180 + 32 = 212.
    expect(metrics.getScrollLeft()).toBe(212);

    await unmount();
  });

  it('auto-scrolls to reveal an existing tab when it becomes active', async () => {
    const tabs: TabInfo[] = [
      { panelId: 'p1', title: 'Logs' },
      { panelId: 'p2', title: 'Events' },
      { panelId: 'p3', title: 'Terminal' },
    ];

    const { host, rerender, unmount } = await renderTabBar(
      <DockableTabBar tabs={tabs} activeTab="p1" onTabClick={vi.fn()} groupKey="bottom" />
    );

    const tabBar = host.querySelector('.dockable-tab-bar') as HTMLElement;
    const metrics = mockTabBarMetrics(tabBar, 360, 180);

    // Mock tab layout.
    const tabEls = tabBar.querySelectorAll<HTMLElement>('[role="tab"]');
    tabEls.forEach((el, i) => {
      Object.defineProperty(el, 'offsetLeft', { configurable: true, get: () => i * 120 });
      Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => 120 });
    });

    await act(async () => {
      await rerender(
        <DockableTabBar tabs={tabs} activeTab="p3" onTabClick={vi.fn()} groupKey="bottom" />
      );
    });

    // Tab p3 right edge (360) > barRight (180) - 32 → scrolls to 360 - 180 + 32 = 212.
    expect(metrics.getScrollLeft()).toBe(212);

    await unmount();
  });
});
