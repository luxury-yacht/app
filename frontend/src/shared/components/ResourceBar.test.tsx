/**
 * frontend/src/shared/components/ResourceBar.test.tsx
 *
 * Test suite for ResourceBar.
 * Covers key behaviors and edge cases for ResourceBar.
 */

import React from 'react';
import ReactDOMClient from 'react-dom/client';
import * as ReactDOM from 'react-dom';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: vi.fn((element: any) => element),
  };
});

import ResourceBar from './ResourceBar';

const renderBar = async (props: React.ComponentProps<typeof ResourceBar>) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);

  await act(async () => {
    root.render(<ResourceBar {...props} />);
    await Promise.resolve();
  });

  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

beforeEach(() => {
  vi.mocked(ReactDOM.createPortal).mockImplementation((element: any) => element as any);
  vi.useRealTimers();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ResourceBar', () => {
  it('renders empty state with metrics error styling', async () => {
    const { container, cleanup } = await renderBar({
      type: 'cpu',
      metricsError: 'unable to load metrics',
      metricsStale: false,
      showTooltip: true,
      variant: 'default',
    });

    expect(container.querySelector('.resource-bar-empty')).toBeTruthy();
    const wrapper = container.querySelector('.resource-bar-container');
    expect(wrapper?.className).toContain('metrics-error');

    cleanup();
  });

  it('suppresses the empty state pill when showEmptyState is false', async () => {
    const { container, cleanup } = await renderBar({
      type: 'memory',
      showEmptyState: false,
    });

    const emptyState = container.querySelector('.resource-bar-empty');
    expect(emptyState).toBeTruthy();
    expect(emptyState?.className).toContain('resource-bar-empty--suppressed');

    cleanup();
  });

  it('computes CPU usage status classes and formats output', async () => {
    const { container, cleanup } = await renderBar({
      type: 'cpu',
      usage: '980m',
      request: '800m',
      limit: '1000m',
      showTooltip: false,
    });

    const usageBar = container.querySelector('.resource-bar-usage');
    expect(usageBar?.className).toContain('critical');
    const markers = container.querySelectorAll('.resource-bar-marker');
    expect(markers.length).toBe(2);

    cleanup();
  });

  it('renders node metrics with stale timestamp information', async () => {
    const lastUpdated = new Date(Date.now() - 90_000);
    const { container, cleanup } = await renderBar({
      type: 'memory',
      usage: '512Mi',
      limit: '1024Mi',
      allocatable: '2048Mi',
      metricsStale: true,
      metricsLastUpdated: lastUpdated,
    });

    const wrapper = container.querySelector('.resource-bar-container');
    expect(wrapper?.className).toContain('metrics-stale');

    cleanup();
  });

  it('toggles tooltip in compact mode and handles overcommit tracking', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    const { container, root, cleanup } = await renderBar({
      type: 'cpu',
      usage: '400m',
      request: '600m',
      allocatable: '1200m',
      variant: 'compact',
      overcommitPercent: 150,
      animationScopeKey: 'scope-a',
      showTooltip: true,
    });

    const compactContainer = container.querySelector('.resource-bar-container') as HTMLElement;
    Object.defineProperty(compactContainer, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 200, top: 10, bottom: 30 }),
    });

    await act(async () => {
      compactContainer.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {});

    expect(container.querySelector('.resource-bar-overcommit')).toBeTruthy();
    await act(async () => {
      root.render(
        <ResourceBar
          type="cpu"
          usage="400m"
          request="600m"
          allocatable="1200m"
          variant="compact"
          overcommitPercent={150}
          animationScopeKey="scope-b"
        />
      );
      await Promise.resolve();
    });

    cleanup();
    vi.unstubAllGlobals();
  });

  it('hides tooltip gracefully when positioning fails', async () => {
    const { container, cleanup } = await renderBar({
      type: 'cpu',
      usage: '200m',
      request: '400m',
      allocatable: '800m',
      variant: 'compact',
      showTooltip: true,
    });

    const compactContainer = container.querySelector('.resource-bar-container') as HTMLElement;
    Object.defineProperty(compactContainer, 'getBoundingClientRect', {
      value: () => {
        throw new Error('Failed rect');
      },
    });

    await act(async () => {
      compactContainer.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('.resource-bar-tooltip')).toBeFalsy();

    cleanup();
  });

  it('handles unbounded usage and resets animations when RAF is unavailable', async () => {
    const originalRAF = window.requestAnimationFrame;
    // Simulate environments without requestAnimationFrame (e.g., server-side render)
    delete (window as any).requestAnimationFrame;

    const metricsTimestamp = new Date();
    const { container, root, cleanup } = await renderBar({
      type: 'cpu',
      usage: '0.25',
      animationScopeKey: 'scope-1',
      metricsLastUpdated: metricsTimestamp,
    });

    const containerEl = container.querySelector('.resource-bar-container') as HTMLElement;
    expect(containerEl.className).toContain('unbounded');

    await act(async () => {
      root.render(
        <ResourceBar
          type="cpu"
          usage="0.25"
          animationScopeKey="scope-2"
          metricsLastUpdated={metricsTimestamp}
        />
      );
      await Promise.resolve();
    });

    expect(containerEl.className).not.toContain('resource-bar-no-animation');
    cleanup();

    if (originalRAF) {
      window.requestAnimationFrame = originalRAF;
    } else {
      delete (window as any).requestAnimationFrame;
    }
  });

  it('renders compact tooltip with converted memory units and configuration warnings', async () => {
    const actualReactDOM = await vi.importActual<typeof import('react-dom')>('react-dom');
    const portalSpy = vi.mocked(ReactDOM.createPortal);
    portalSpy.mockImplementation(actualReactDOM.createPortal);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    const { container, cleanup } = await renderBar({
      type: 'memory',
      usage: '1024Ki',
      request: '7Gi',
      limit: '6GB',
      allocatable: '4096MB',
      overcommitPercent: 130,
      variant: 'compact',
      showTooltip: true,
      metricsStale: true,
    });

    const compactContainer = container.querySelector('.resource-bar-container') as HTMLElement;
    Object.defineProperty(compactContainer, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, width: 220, top: 320, bottom: 360 }),
    });

    await act(async () => {
      compactContainer.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {});

    const leadingValue = container.querySelector('.resource-bar-leading')?.textContent ?? '';
    expect(leadingValue).toContain('1Mi');

    const reserved = container.querySelector('.resource-bar-reserved') as HTMLElement;
    expect(reserved).toBeTruthy();
    expect(reserved.style.width).toMatch(/%/);

    const overcommitBar = container.querySelector('.resource-bar-overcommit');
    expect(overcommitBar).toBeTruthy();

    cleanup();
    vi.unstubAllGlobals();
    expect(
      warnSpy.mock.calls.some(
        ([message]) =>
          typeof message === 'string' && message.includes('Error showing ResourceBar tooltip')
      )
    ).toBe(false);
    warnSpy.mockRestore();
    portalSpy.mockImplementation((element: any) => element as any);
  });

  it('scales usage against requests when limits are missing and warns when constraints are absent', async () => {
    const actualReactDOM = await vi.importActual<typeof import('react-dom')>('react-dom');
    const portalSpy = vi.mocked(ReactDOM.createPortal);
    portalSpy.mockImplementation(actualReactDOM.createPortal);

    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    const { container, root, cleanup } = await renderBar({
      type: 'cpu',
      usage: '1',
      request: '0.4',
      limit: 'bad',
      variant: 'compact',
      showTooltip: true,
    });

    const compactContainer = container.querySelector('.resource-bar-container') as HTMLElement;
    Object.defineProperty(compactContainer, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 60, width: 220, top: 40, bottom: 70 }),
    });

    await act(async () => {
      compactContainer.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {});

    let tooltip = document.body.querySelector('.resource-bar-tooltip') as HTMLElement;
    expect(tooltip).toBeTruthy();
    expect(tooltip.className).toContain('tooltip-bottom');

    const consumptionRow = Array.from(tooltip.querySelectorAll('.tooltip-row')).find((row) =>
      row.textContent?.includes('Consumption:')
    ) as HTMLElement;
    expect(consumptionRow.textContent).toContain('250%');
    expect(consumptionRow.querySelector('.warning')).toBeTruthy();

    const limitRow = Array.from(tooltip.querySelectorAll('.tooltip-row')).find((row) =>
      row.textContent?.includes('Limits:')
    ) as HTMLElement;
    expect(limitRow.textContent).toContain('-');

    await act(async () => {
      compactContainer.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      await Promise.resolve();
    });

    // Re-render with memory bytes and no constraints to exercise warning branch
    await act(async () => {
      root.render(
        <ResourceBar
          type="memory"
          usage="1048576"
          variant="compact"
          showTooltip
          animationScopeKey="bytes"
        />
      );
      await Promise.resolve();
    });

    const rerenderedContainer = container.querySelector('.resource-bar-container') as HTMLElement;
    Object.defineProperty(rerenderedContainer, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 60, width: 220, top: 40, bottom: 70 }),
    });

    await act(async () => {
      rerenderedContainer.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {});

    tooltip = document.body.querySelector('.resource-bar-tooltip') as HTMLElement;
    expect(tooltip).toBeTruthy();
    expect(
      Array.from(tooltip.querySelectorAll('.tooltip-row')).some((row) =>
        row.textContent?.includes('⚠️ No resource constraints set')
      )
    ).toBe(true);

    cleanup();
    vi.unstubAllGlobals();
    portalSpy.mockImplementation((element: any) => element as any);
  });
});
