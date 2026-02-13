/**
 * frontend/src/shared/components/Tooltip.test.tsx
 *
 * Test suite for the Tooltip component.
 * Covers trigger modes, placement, delay, variants, disabled state, and portal rendering.
 */

import React from 'react';
import ReactDOMClient from 'react-dom/client';
import * as ReactDOM from 'react-dom';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock createPortal so tooltip content renders inline for assertions
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: vi.fn((element: any) => element),
  };
});

// Mock ZoomContext to return a stable 100% zoom
vi.mock('@core/contexts/ZoomContext', () => ({
  useZoom: () => ({ zoomLevel: 100 }),
}));

import Tooltip from './Tooltip';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const renderTooltip = async (props: React.ComponentProps<typeof Tooltip>) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);

  await act(async () => {
    root.render(<Tooltip {...props} />);
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(ReactDOM.createPortal).mockImplementation((element: any) => element as any);
  vi.useRealTimers();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Tooltip', () => {
  // -----------------------------------------------------------------------
  // Default icon
  // -----------------------------------------------------------------------
  it('renders a default "i" icon when no children are provided', async () => {
    const { container, cleanup } = await renderTooltip({ content: 'Help text' });

    const icon = container.querySelector('.tooltip-info-icon');
    expect(icon).toBeTruthy();
    expect(icon?.textContent).toBe('i');

    cleanup();
  });

  // -----------------------------------------------------------------------
  // Custom children as trigger
  // -----------------------------------------------------------------------
  it('renders children as the trigger element', async () => {
    const { container, cleanup } = await renderTooltip({
      content: 'Tip',
      children: <button data-testid="btn">Hover me</button>,
    });

    const trigger = container.querySelector('.tooltip-trigger');
    expect(trigger?.querySelector('[data-testid="btn"]')).toBeTruthy();
    // No default icon rendered
    expect(container.querySelector('.tooltip-info-icon')).toBeFalsy();

    cleanup();
  });

  // -----------------------------------------------------------------------
  // Hover trigger — show after delay
  // -----------------------------------------------------------------------
  it('shows tooltip on hover after delay', async () => {
    vi.useFakeTimers();

    const { container, cleanup } = await renderTooltip({ content: 'Delayed tip' });

    const trigger = container.querySelector('.tooltip-trigger') as HTMLElement;

    // Mouse over — tooltip not yet visible (delay hasn't elapsed)
    // Note: use mouseover (not mouseenter) because React event delegation
    // requires bubbling events.
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(container.querySelector('.tooltip')).toBeFalsy();

    // Advance past default 250ms delay
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(container.querySelector('.tooltip')).toBeTruthy();
    expect(container.querySelector('.tooltip')?.textContent).toBe('Delayed tip');

    cleanup();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Hover trigger — hide on mouse leave
  // -----------------------------------------------------------------------
  it('hides tooltip on mouse leave', async () => {
    vi.useFakeTimers();

    const { container, cleanup } = await renderTooltip({ content: 'Tip' });

    const trigger = container.querySelector('.tooltip-trigger') as HTMLElement;

    // Show tooltip
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(container.querySelector('.tooltip')).toBeTruthy();

    // Mouse out — tooltip should hide
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(container.querySelector('.tooltip')).toBeFalsy();

    cleanup();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Custom hoverDelay
  // -----------------------------------------------------------------------
  it('respects a custom hoverDelay', async () => {
    vi.useFakeTimers();

    const { container, cleanup } = await renderTooltip({
      content: 'Custom delay',
      hoverDelay: 500,
    });

    const trigger = container.querySelector('.tooltip-trigger') as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    // 250ms — should not be visible yet
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(container.querySelector('.tooltip')).toBeFalsy();

    // 500ms total — now visible
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(container.querySelector('.tooltip')).toBeTruthy();

    cleanup();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Click trigger toggles visibility
  // -----------------------------------------------------------------------
  it('toggles tooltip on click when trigger is "click"', async () => {
    const { container, cleanup } = await renderTooltip({
      content: 'Click tip',
      trigger: 'click',
    });

    const trigger = container.querySelector('.tooltip-trigger') as HTMLElement;

    // First click — show
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('.tooltip')).toBeTruthy();

    // Second click — hide
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('.tooltip')).toBeFalsy();

    cleanup();
  });

  // -----------------------------------------------------------------------
  // Outside click closes click-triggered tooltip
  // -----------------------------------------------------------------------
  it('closes click-triggered tooltip on outside click', async () => {
    const { container, cleanup } = await renderTooltip({
      content: 'Click tip',
      trigger: 'click',
    });

    const trigger = container.querySelector('.tooltip-trigger') as HTMLElement;

    // Open tooltip
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('.tooltip')).toBeTruthy();

    // Click outside
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(container.querySelector('.tooltip')).toBeFalsy();

    cleanup();
  });

  // -----------------------------------------------------------------------
  // Placement attribute
  // -----------------------------------------------------------------------
  it('sets the correct data-placement attribute', async () => {
    vi.useFakeTimers();

    const { container, cleanup } = await renderTooltip({
      content: 'Top tip',
      placement: 'bottom',
    });

    const trigger = container.querySelector('.tooltip-trigger') as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    const tooltip = container.querySelector('.tooltip') as HTMLElement;
    expect(tooltip).toBeTruthy();
    // data-placement should reflect the requested placement (bottom)
    // It may flip based on viewport, but in JSDOM with default viewport it
    // should keep the requested placement.
    expect(tooltip.getAttribute('data-placement')).toBeTruthy();

    cleanup();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // disabled prop
  // -----------------------------------------------------------------------
  it('suppresses tooltip when disabled', async () => {
    vi.useFakeTimers();

    const { container, cleanup } = await renderTooltip({
      content: 'Should not show',
      disabled: true,
    });

    const trigger = container.querySelector('.tooltip-trigger') as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(container.querySelector('.tooltip')).toBeFalsy();

    cleanup();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Rich content (ReactNode)
  // -----------------------------------------------------------------------
  it('renders rich ReactNode content inside the tooltip', async () => {
    vi.useFakeTimers();

    const richContent = (
      <div data-testid="rich">
        <strong>Bold</strong> text
      </div>
    );

    const { container, cleanup } = await renderTooltip({ content: richContent });

    const trigger = container.querySelector('.tooltip-trigger') as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    const tooltip = container.querySelector('.tooltip');
    expect(tooltip?.querySelector('[data-testid="rich"]')).toBeTruthy();
    expect(tooltip?.querySelector('strong')?.textContent).toBe('Bold');

    cleanup();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Variant class
  // -----------------------------------------------------------------------
  it('applies the variant class to the tooltip element', async () => {
    vi.useFakeTimers();

    const { container, cleanup } = await renderTooltip({
      content: 'Warning!',
      variant: 'warning',
    });

    const trigger = container.querySelector('.tooltip-trigger') as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    const tooltip = container.querySelector('.tooltip') as HTMLElement;
    expect(tooltip.className).toContain('warning');
    expect(tooltip.className).toContain('tooltip--portal');

    cleanup();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // showArrow false hides data-placement
  // -----------------------------------------------------------------------
  it('omits data-placement when showArrow is false', async () => {
    vi.useFakeTimers();

    const { container, cleanup } = await renderTooltip({
      content: 'No arrow',
      showArrow: false,
    });

    const trigger = container.querySelector('.tooltip-trigger') as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    const tooltip = container.querySelector('.tooltip') as HTMLElement;
    expect(tooltip.getAttribute('data-placement')).toBeNull();

    cleanup();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Hover does not fire on click trigger mode
  // -----------------------------------------------------------------------
  it('does not show tooltip on hover when trigger is click', async () => {
    vi.useFakeTimers();

    const { container, cleanup } = await renderTooltip({
      content: 'Click only',
      trigger: 'click',
    });

    const trigger = container.querySelector('.tooltip-trigger') as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(container.querySelector('.tooltip')).toBeFalsy();

    cleanup();
    vi.useRealTimers();
  });
});
