import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardProvider } from './context';
import { useKeyboardSurface } from './surfaces';

vi.mock('@core/desktop-runtime', () => ({ onEvent: () => () => undefined }));

function LocalControls({ native = false } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  useKeyboardSurface({
    kind: 'region',
    rootRef: ref,
    onKeyDown: (event) => {
      if (event.key !== 'Tab' || native) {
        return false;
      }
      ref.current?.querySelector<HTMLElement>('[data-testid="second"]')?.focus();
      return true;
    },
  });
  return (
    <div ref={ref}>
      <input data-testid="field" aria-label="Field" />
      <button data-testid="first" type="button">
        First
      </button>
      <button data-testid="second" type="button">
        Second
      </button>
    </div>
  );
}

describe('keyboard focus indication through local owners', () => {
  let host: HTMLDivElement;
  let root: Root;
  const marker = 'keyboard-programmatic-focus';
  const element = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  const pressKey = (key = 'Tab', init: KeyboardEventInit = {}) =>
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, ...init })
      );
    });
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const render = async (native = false) =>
    act(async () => {
      root.render(
        <KeyboardProvider>
          <LocalControls native={native} />
        </KeyboardProvider>
      );
    });

  it('indicates local programmatic Tab focus after a pointer interaction and clears it on pointer use', async () => {
    await render();
    element('first').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    act(() => element('first').focus());
    pressKey();
    expect(document.activeElement).toBe(element('second'));
    expect(element('second').classList.contains(marker)).toBe(true);
    element('second').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(element('second').classList.contains(marker)).toBe(false);
    act(() => element('first').focus());
    expect(element('first').classList.contains(marker)).toBe(false);
  });

  it('focuses a clicked button before its action so the next Tab has a region owner', async () => {
    await render(true);
    act(() => element('first').focus());
    const actionFocus = vi.fn();
    const focus = vi.spyOn(element('second'), 'focus');
    element('second').addEventListener('click', () => actionFocus(document.activeElement));
    element('second').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    act(() => element('second').click());
    expect(actionFocus).toHaveBeenCalledWith(element('second'));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(element('second').classList.contains(marker)).toBe(false);
  });

  it('covers browser-default focus changes and removes the previous indicator', async () => {
    await render(true);
    act(() => element('first').focus());
    pressKey();
    // jsdom does not perform the browser's default Tab focus move.
    act(() => element('second').focus());
    expect(element('second').classList.contains(marker)).toBe(true);
    expect(element('first').classList.contains(marker)).toBe(false);
    pressKey('Tab', { shiftKey: true });
    act(() => element('first').focus());
    expect(element('first').classList.contains(marker)).toBe(true);
    expect(element('second').classList.contains(marker)).toBe(false);
  });

  it('cleans up the indicated node and its listeners when the provider unmounts', async () => {
    await render();
    act(() => element('first').focus());
    pressKey();
    const second = element('second');
    expect(second.classList.contains(marker)).toBe(true);
    act(() => root.render(null));
    expect(second.classList.contains(marker)).toBe(false);
    host.append(second);
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    second.focus();
    expect(second.classList.contains(marker)).toBe(false);
  });

  it.each(['ArrowDown', 'Home', 'PageDown'])(
    'indicates focus moved with %s outside a typing field after pointer use',
    async (key) => {
      await render(true);
      element('first').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      act(() => element('first').focus());
      pressKey(key);
      // Roving lists move focus from their own key handlers.
      act(() => element('second').focus());
      expect(element('second').classList.contains(marker)).toBe(true);
    }
  );

  it('leaves a clicked control unmarked when a navigation key does not move focus', async () => {
    await render(true);
    element('first').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    act(() => element('first').focus());
    // An arrow that only scrolls the view is not navigation between controls.
    pressKey('ArrowDown');
    expect(element('first').classList.contains(marker)).toBe(false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // A later focus move, such as a closing palette restoring focus, stays unmarked.
    act(() => element('second').focus());
    expect(element('second').classList.contains(marker)).toBe(false);
  });

  it.each([
    { name: 'an arrow typed in a field', from: 'field', key: 'ArrowDown', init: {} },
    { name: 'a modified arrow', from: 'first', key: 'ArrowLeft', init: { metaKey: true } },
    { name: 'a shortcut', from: 'first', key: 'P', init: { metaKey: true, shiftKey: true } },
  ])('does not indicate focus after $name', async ({ from, key, init }) => {
    await render(true);
    element(from).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    act(() => element(from).focus());
    pressKey(key, init);
    act(() => element('second').focus());
    expect(element('second').classList.contains(marker)).toBe(false);
  });

  it.each([{ altKey: true }, { metaKey: true }])(
    'does not enable Tab indication for OS shortcuts %o',
    async (init) => {
      await render(true);
      act(() => element('first').focus());
      pressKey('Tab', init);
      act(() => element('second').focus());
      expect(element('second').classList.contains(marker)).toBe(false);
    }
  );
});
