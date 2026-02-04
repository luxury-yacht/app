/**
 * frontend/src/shared/components/ContextMenu.test.tsx
 *
 * Test suite for ContextMenu.
 * Covers key behaviors and edge cases for ContextMenu.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import ContextMenu from './ContextMenu';
import { KeyboardProvider } from '@ui/shortcuts';
import { ZoomProvider } from '@core/contexts/ZoomContext';

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMocks.eventsOn,
  EventsOff: runtimeMocks.eventsOff,
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetZoomLevel: vi.fn().mockResolvedValue(100),
  SetZoomLevel: vi.fn().mockResolvedValue(undefined),
}));

describe('ContextMenu', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    runtimeMocks.eventsOn.mockReset();
    runtimeMocks.eventsOff.mockReset();
  });

  const renderMenu = async (overrides: Partial<React.ComponentProps<typeof ContextMenu>> = {}) => {
    const onClose = overrides.onClose ?? vi.fn();
    const items =
      overrides.items ??
      ([{ label: 'Delete', onClick: vi.fn() }] satisfies React.ComponentProps<
        typeof ContextMenu
      >['items']);

    await act(async () => {
      root.render(
        <ZoomProvider>
          <KeyboardProvider>
            <ContextMenu
              items={items}
              position={{ x: 100, y: 120 }}
              onClose={onClose}
              {...overrides}
            />
          </KeyboardProvider>
        </ZoomProvider>
      );
      await Promise.resolve();
    });

    const menu = document.body.querySelector('.context-menu') as HTMLDivElement | null;
    if (!menu) {
      throw new Error('Context menu failed to render');
    }
    return { menu, items, onClose };
  };

  it('invokes item handler and closes when a menu item is clicked', async () => {
    const onClose = vi.fn();
    const onClick = vi.fn();
    const item = { label: 'Edit', onClick };

    const { menu } = await renderMenu({ items: [item], onClose });

    const target = menu.querySelector('.context-menu-item') as HTMLDivElement;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores clicks on disabled items', async () => {
    const onClose = vi.fn();
    const onClick = vi.fn();

    const { menu } = await renderMenu({
      onClose,
      items: [{ label: 'Edit', onClick, disabled: true, disabledReason: 'Not allowed' }],
    });

    const target = menu.querySelector('.context-menu-item') as HTMLDivElement;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onClick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(target.getAttribute('title')).toBe('Not allowed');
  });

  it('closes when clicking outside the menu', async () => {
    const onClose = vi.fn();
    await renderMenu({ onClose });

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when Escape is pressed', async () => {
    const onClose = vi.fn();
    const { menu } = await renderMenu({ onClose });

    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('positions the menu within viewport bounds', async () => {
    const { menu } = await renderMenu();

    expect(menu.style.left).toBe('100px');
    expect(menu.style.top).toBe('120px');
    expect(menu.getAttribute('tabindex')).toBe('-1');
  });

  it('supports keyboard navigation and activation', async () => {
    const onClose = vi.fn();
    const openHandler = vi.fn();
    const deleteHandler = vi.fn();

    const { menu } = await renderMenu({
      onClose,
      items: [
        { label: 'Open', onClick: openHandler },
        { divider: true },
        { label: 'Delete', onClick: deleteHandler },
      ],
    });

    const dispatchKey = async (key: string, shiftKey = false) => {
      await act(async () => {
        menu.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
        await Promise.resolve();
      });
    };

    const itemNodes = () =>
      Array.from(menu.querySelectorAll<HTMLDivElement>('.context-menu-item')).filter(
        (node) => !node.classList.contains('context-menu-divider')
      );

    expect(itemNodes()[0]?.classList.contains('is-focused')).toBe(true);

    await dispatchKey('ArrowDown');
    expect(itemNodes()[1]?.classList.contains('is-focused')).toBe(true);

    await dispatchKey('ArrowUp');
    expect(itemNodes()[0]?.classList.contains('is-focused')).toBe(true);

    await dispatchKey('Enter');
    expect(openHandler).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops propagation on navigation keys to prevent parent handlers from firing', async () => {
    // This test verifies that ArrowDown, ArrowUp, Enter, and Space events
    // call stopPropagation() to prevent bubbling to parent elements
    // (which would affect table row selection when the context menu is open)
    const onClose = vi.fn();
    const itemHandler = vi.fn();

    const { menu } = await renderMenu({
      onClose,
      items: [
        { label: 'Action 1', onClick: itemHandler },
        { label: 'Action 2', onClick: itemHandler },
      ],
    });

    // Test each navigation key - all should have stopPropagation called
    const keysToTest = ['ArrowDown', 'ArrowUp', 'Enter', ' '];

    for (const key of keysToTest) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');

      await act(async () => {
        menu.dispatchEvent(event);
        await Promise.resolve();
      });

      expect(stopPropagationSpy).toHaveBeenCalled();
    }
  });

  it('adjusts position for CSS zoom level', async () => {
    // When CSS zoom is applied to <html>, clientX/clientY are in viewport coordinates,
    // but left/top CSS values get scaled by the zoom. The ContextMenu must divide
    // positions by the zoom factor to appear at the correct location.
    //
    // At zoom 100%, position (100, 120) should result in left: 100px, top: 120px
    // This test verifies the default behavior at 100% zoom (mocked in test setup).

    const { menu } = await renderMenu({
      position: { x: 100, y: 120 },
    });

    // At 100% zoom, positions should be unchanged
    expect(menu.style.left).toBe('100px');
    expect(menu.style.top).toBe('120px');
  });
});
