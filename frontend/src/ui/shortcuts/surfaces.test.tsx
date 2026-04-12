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

  it('falls back to an active capture surface when focus is outside surfaces', async () => {
    const surfaceHandler = vi.fn();

    const Harness = () => {
      const surfaceRef = useRef<HTMLDivElement>(null);

      useKeyboardSurface({
        kind: 'panel',
        rootRef: surfaceRef,
        active: true,
        captureWhenActive: true,
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

  it('keeps blocking surfaces ahead of active capture surfaces', async () => {
    const panelHandler = vi.fn();
    const modalHandler = vi.fn();

    const Harness = () => {
      const panelRef = useRef<HTMLDivElement>(null);
      const modalRef = useRef<HTMLDivElement>(null);

      useKeyboardSurface({
        kind: 'panel',
        rootRef: panelRef,
        active: true,
        captureWhenActive: true,
        onEscape: () => {
          panelHandler();
          return true;
        },
      });

      useKeyboardSurface({
        kind: 'modal',
        rootRef: modalRef,
        active: true,
        blocking: true,
        onEscape: () => {
          modalHandler();
          return true;
        },
      });

      return (
        <>
          <div ref={panelRef}>
            <button>Panel</button>
          </div>
          <div ref={modalRef}>
            <button>Modal</button>
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

    expect(modalHandler).toHaveBeenCalledTimes(1);
    expect(panelHandler).not.toHaveBeenCalled();
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

  it('suppresses the shortcut registry while a suppressing surface is active', async () => {
    const shortcutHandler = vi.fn();

    const Harness = () => {
      const surfaceRef = useRef<HTMLDivElement>(null);

      useKeyboardSurface({
        kind: 'modal',
        rootRef: surfaceRef,
        active: true,
        blocking: true,
        suppressShortcuts: true,
      });

      useShortcut({
        key: 'b',
        modifiers: { meta: true },
        handler: () => {
          shortcutHandler();
          return true;
        },
        description: 'Blocked global shortcut',
        view: 'global',
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

    act(() => {
      insideButton?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'b',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });

    expect(shortcutHandler).not.toHaveBeenCalled();
  });

  it('allows handled-no-prevent surface results to stop propagation without preventing default', async () => {
    const surfaceHandler = vi.fn();
    const shortcutHandler = vi.fn();

    const Harness = () => {
      const surfaceRef = useRef<HTMLDivElement>(null);

      useKeyboardSurface({
        kind: 'dropdown',
        rootRef: surfaceRef,
        active: true,
        suppressShortcuts: true,
        onKeyDown: (event) => {
          if (event.key !== 'Tab') {
            return false;
          }
          surfaceHandler();
          return 'handled-no-prevent';
        },
      });

      useShortcut({
        key: 'Tab',
        handler: () => {
          shortcutHandler();
          return true;
        },
        description: 'Blocked tab shortcut',
        view: 'global',
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

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => {
      insideButton?.dispatchEvent(event);
    });

    expect(surfaceHandler).toHaveBeenCalledTimes(1);
    expect(shortcutHandler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
