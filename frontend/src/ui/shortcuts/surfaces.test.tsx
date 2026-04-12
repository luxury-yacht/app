import { useRef, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardProvider, useKeyboardContext } from './context';
import { useKeyboardSurface } from './surfaces';
import { useShortcut } from './hooks';

describe('keyboard surfaces', () => {
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
  });

  it('routes Escape to the active surface before the global shortcut registry', async () => {
    const surfaceHandler = vi.fn();
    const shortcutHandler = vi.fn();

    const Harness = () => {
      const surfaceRef = useRef<HTMLDivElement>(null);

      useKeyboardSurface({
        kind: 'modal',
        rootRef: surfaceRef,
        active: true,
        blocking: true,
        onEscape: () => {
          surfaceHandler();
          return true;
        },
      });

      useShortcut({
        key: 'Escape',
        handler: () => {
          shortcutHandler();
          return true;
        },
        description: 'Global escape',
        view: 'global',
      });

      return (
        <>
          <div ref={surfaceRef}>
            <button id="inside-surface">Inside</button>
          </div>
          <button id="outside-surface">Outside</button>
        </>
      );
    };

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <Harness />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    const insideButton = document.querySelector('#inside-surface') as HTMLButtonElement | null;
    expect(insideButton).not.toBeNull();
    insideButton?.focus();

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      insideButton?.dispatchEvent(event);
    });

    expect(surfaceHandler).toHaveBeenCalledTimes(1);
    expect(shortcutHandler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('falls back to the topmost blocking surface when focus is outside surfaces', async () => {
    const surfaceHandler = vi.fn();

    const Harness = () => {
      const surfaceRef = useRef<HTMLDivElement>(null);

      useKeyboardSurface({
        kind: 'modal',
        rootRef: surfaceRef,
        active: true,
        blocking: true,
        onEscape: () => {
          surfaceHandler();
          return true;
        },
      });

      return (
        <>
          <div ref={surfaceRef}>
            <button>Inside</button>
          </div>
          <button id="outside-surface">Outside</button>
        </>
      );
    };

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <Harness />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    const outsideButton = document.querySelector('#outside-surface') as HTMLButtonElement | null;
    expect(outsideButton).not.toBeNull();
    outsideButton?.focus();

    act(() => {
      outsideButton?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });

    expect(surfaceHandler).toHaveBeenCalledTimes(1);
  });

  it('routes native actions through the active surface before falling back', async () => {
    const nativeActionHandler = vi.fn();
    const apiRef: {
      current: ReturnType<typeof useKeyboardContext> | null;
    } = { current: null };

    const Harness = () => {
      const surfaceRef = useRef<HTMLDivElement>(null);
      const keyboard = useKeyboardContext();

      useEffect(() => {
        apiRef.current = keyboard;
      }, [keyboard]);

      useKeyboardSurface({
        kind: 'modal',
        rootRef: surfaceRef,
        active: true,
        blocking: true,
        onNativeAction: ({ action }) => {
          if (action !== 'copy') {
            return false;
          }
          nativeActionHandler();
          return true;
        },
      });

      return (
        <div ref={surfaceRef}>
          <button id="inside-surface">Inside</button>
        </div>
      );
    };

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <Harness />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    const insideButton = document.querySelector('#inside-surface') as HTMLButtonElement | null;
    expect(insideButton).not.toBeNull();
    insideButton?.focus();

    expect(apiRef.current?.dispatchNativeAction('copy')).toBe(true);
    expect(nativeActionHandler).toHaveBeenCalledTimes(1);
  });
});
