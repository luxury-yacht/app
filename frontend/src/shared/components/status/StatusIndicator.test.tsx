import { AppRegionNavigation } from '@ui/layout/AppRegionNavigation';
import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import * as ReactDOMClient from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StatusIndicator from './StatusIndicator';

vi.mock('@core/contexts/ZoomContext', () => ({
  useZoom: () => ({ zoomLevel: 100 }),
}));

const renderStatusIndicator = async (
  props: Partial<React.ComponentProps<typeof StatusIndicator>> = {}
) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);

  await act(async () => {
    root.render(
      <KeyboardProvider>
        <AppRegionNavigation />
        <header data-app-region="header">
          <StatusIndicator
            status="healthy"
            title="Connectivity"
            message="Connected"
            ariaLabel="Connectivity status"
            {...props}
          />
          <button type="button">Next header control</button>
        </header>
        <aside data-app-region="sidebar">
          <button type="button">Sidebar control</button>
        </aside>
      </KeyboardProvider>
    );
    await Promise.resolve();
  });

  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

describe('StatusIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('layers status popovers above dockable object panels', async () => {
    const { container, cleanup } = await renderStatusIndicator();
    const trigger = container.querySelector('.tooltip-trigger') as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      vi.advanceTimersByTime(150);
    });

    const popover = document.querySelector('.status-popover') as HTMLElement;
    expect(popover.style.zIndex).toBe('var(--z-index-tooltip, 3200)');

    cleanup();
  });

  it('opens from the keyboard, visits actions, and restores its trigger on Escape', async () => {
    const action = vi.fn();
    const { container, cleanup } = await renderStatusIndicator({
      actions: [
        { label: 'Refresh', onClick: action },
        { label: 'Pause', onClick: action },
      ],
    });
    const trigger = container.querySelector<HTMLElement>(
      '[role="button"][aria-label="Connectivity status"]'
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.tabIndex).toBe(0);
    const press = async (target: Element | null, key: string, shiftKey = false) => {
      await act(async () =>
        target?.dispatchEvent(
          new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
        )
      );
    };
    await act(async () => trigger?.focus());
    await press(trigger, 'Enter');
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    await press(trigger, 'Tab');
    expect(document.activeElement?.textContent).toBe('Refresh');
    await act(async () => (document.activeElement as HTMLElement).click());
    expect(action).toHaveBeenCalledOnce();
    await press(document.activeElement, 'Tab');
    expect(document.activeElement?.textContent).toBe('Pause');
    await press(document.activeElement, 'Tab', true);
    expect(document.activeElement?.textContent).toBe('Refresh');
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await press(document.activeElement, 'Escape');
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await press(trigger, ' ');
    await press(trigger, 'Tab', true);
    expect(document.activeElement?.textContent).toBe('Pause');
    await press(document.activeElement, 'Tab');
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    cleanup();
  });

  it('lets Control+Tab leave a portaled action and restores its header trigger on return', async () => {
    const { container, cleanup } = await renderStatusIndicator({
      actions: [{ label: 'Refresh', onClick: vi.fn() }],
    });
    const trigger = container.querySelector<HTMLElement>('.tooltip-trigger');
    const press = async (key: string, modifiers = {}) =>
      act(async () =>
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
        )
      );
    await act(async () => trigger?.focus());
    await press('Enter');
    await press('Tab');
    expect(document.activeElement?.textContent).toBe('Refresh');
    await press('Tab', { ctrlKey: true });
    expect(document.activeElement?.textContent).toBe('Sidebar control');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await press('Tab', { ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(trigger);
    cleanup();
  });
});
