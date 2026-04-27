import { useRef, useEffect, useState } from 'react';
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

  it('continues through capture fallback surfaces until Escape is handled', async () => {
    const regionHandler = vi.fn();
    const panelHandler = vi.fn();

    const Harness = () => {
      const regionRef = useRef<HTMLDivElement>(null);
      const panelRef = useRef<HTMLDivElement>(null);

      useKeyboardSurface({
        kind: 'region',
        rootRef: regionRef,
        active: true,
        captureWhenActive: true,
        priority: 30,
        onKeyDown: () => {
          regionHandler();
          return false;
        },
      });

      useKeyboardSurface({
        kind: 'panel',
        rootRef: panelRef,
        active: true,
        captureWhenActive: true,
        priority: 0,
        onEscape: () => {
          panelHandler();
          return true;
        },
      });

      return (
        <>
          <div ref={regionRef}>
            <button>Region</button>
          </div>
          <div ref={panelRef}>
            <button>Panel</button>
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

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      outsideButton?.dispatchEvent(event);
    });

    expect(regionHandler).toHaveBeenCalledTimes(1);
    expect(panelHandler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
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

  it('routes keys to the deepest containing surface before its parent surface', async () => {
    const modalHandler = vi.fn();
    const dropdownHandler = vi.fn();

    const Harness = () => {
      const modalRef = useRef<HTMLDivElement>(null);
      const dropdownRef = useRef<HTMLDivElement>(null);

      useKeyboardSurface({
        kind: 'modal',
        rootRef: modalRef,
        active: true,
        blocking: true,
        onKeyDown: (event) => {
          if (event.key !== 'ArrowDown') {
            return false;
          }
          modalHandler();
          return true;
        },
      });

      useKeyboardSurface({
        kind: 'dropdown',
        rootRef: dropdownRef,
        active: true,
        suppressShortcuts: true,
        onKeyDown: (event) => {
          if (event.key !== 'ArrowDown') {
            return false;
          }
          dropdownHandler();
          return true;
        },
      });

      return (
        <div ref={modalRef}>
          <div ref={dropdownRef}>
            <button id="inside-dropdown">Inside dropdown</button>
          </div>
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

    const insideDropdown = document.querySelector('#inside-dropdown') as HTMLButtonElement | null;
    expect(insideDropdown).not.toBeNull();
    insideDropdown?.focus();

    act(() => {
      insideDropdown?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true,
        })
      );
    });

    expect(dropdownHandler).toHaveBeenCalledTimes(1);
    expect(modalHandler).not.toHaveBeenCalled();
  });

  it('falls back to the parent surface for Tab when the deepest surface does not handle it', async () => {
    const regionHandler = vi.fn();
    const dropdownHandler = vi.fn();

    const Harness = () => {
      const regionRef = useRef<HTMLDivElement>(null);
      const dropdownRef = useRef<HTMLDivElement>(null);

      useKeyboardSurface({
        kind: 'region',
        rootRef: regionRef,
        active: true,
        captureWhenActive: true,
        onKeyDown: (event) => {
          if (event.key !== 'Tab') {
            return false;
          }
          regionHandler();
          return true;
        },
      });

      useKeyboardSurface({
        kind: 'dropdown',
        rootRef: dropdownRef,
        active: true,
        onKeyDown: (event) => {
          if (event.key !== 'Tab') {
            return false;
          }
          dropdownHandler();
          return false;
        },
      });

      return (
        <div ref={regionRef}>
          <div ref={dropdownRef}>
            <button id="inside-dropdown">Inside dropdown</button>
          </div>
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

    const insideDropdown = document.querySelector('#inside-dropdown') as HTMLButtonElement | null;
    expect(insideDropdown).not.toBeNull();
    insideDropdown?.focus();

    act(() => {
      insideDropdown?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        })
      );
    });

    expect(dropdownHandler).toHaveBeenCalledTimes(1);
    expect(regionHandler).toHaveBeenCalledTimes(1);
  });

  it('falls back to the parent surface for Escape when the deepest surface does not handle it', async () => {
    const editorHandler = vi.fn();
    const panelHandler = vi.fn();

    const Harness = () => {
      const panelRef = useRef<HTMLDivElement>(null);
      const editorRef = useRef<HTMLDivElement>(null);

      useKeyboardSurface({
        kind: 'panel',
        rootRef: panelRef,
        active: true,
        onEscape: () => {
          panelHandler();
          return true;
        },
      });

      useKeyboardSurface({
        kind: 'editor',
        rootRef: editorRef,
        active: true,
        onEscape: () => {
          editorHandler();
          return false;
        },
      });

      return (
        <div ref={panelRef}>
          <div ref={editorRef}>
            <button id="inside-editor">Inside editor</button>
          </div>
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

    const insideEditor = document.querySelector('#inside-editor') as HTMLButtonElement | null;
    expect(insideEditor).not.toBeNull();
    insideEditor?.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      insideEditor?.dispatchEvent(event);
    });

    expect(editorHandler).toHaveBeenCalledTimes(1);
    expect(panelHandler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('preserves registration order when inline surface callbacks change on rerender', async () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    const Harness = () => {
      const [version, setVersion] = useState(0);
      const firstRef = useRef<HTMLDivElement>(null);
      const secondRef = useRef<HTMLDivElement>(null);

      useKeyboardSurface({
        kind: 'panel',
        rootRef: firstRef,
        active: true,
        captureWhenActive: true,
        onEscape: () => {
          firstHandler(version);
          return true;
        },
      });

      useKeyboardSurface({
        kind: 'panel',
        rootRef: secondRef,
        active: true,
        captureWhenActive: true,
        onEscape: () => {
          secondHandler();
          return true;
        },
      });

      return (
        <>
          <div ref={firstRef}>
            <button id="first-surface">First</button>
          </div>
          <div ref={secondRef}>
            <button id="second-surface">Second</button>
          </div>
          <button id="rerender" onClick={() => setVersion((current) => current + 1)}>
            Rerender
          </button>
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
    const rerenderButton = document.querySelector('#rerender') as HTMLButtonElement | null;
    expect(outsideButton).not.toBeNull();
    expect(rerenderButton).not.toBeNull();

    outsideButton?.focus();

    act(() => {
      outsideButton?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });

    expect(secondHandler).toHaveBeenCalledTimes(1);
    expect(firstHandler).not.toHaveBeenCalled();

    act(() => {
      rerenderButton?.click();
    });

    act(() => {
      outsideButton?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });

    expect(secondHandler).toHaveBeenCalledTimes(2);
    expect(firstHandler).not.toHaveBeenCalled();
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

  it('routes native actions to the deepest containing surface before its parent surface', async () => {
    const panelNativeActionHandler = vi.fn();
    const editorNativeActionHandler = vi.fn();
    const apiRef: {
      current: ReturnType<typeof useKeyboardContext> | null;
    } = { current: null };

    const Harness = () => {
      const panelRef = useRef<HTMLDivElement>(null);
      const editorRef = useRef<HTMLDivElement>(null);
      const keyboard = useKeyboardContext();

      useEffect(() => {
        apiRef.current = keyboard;
      }, [keyboard]);

      useKeyboardSurface({
        kind: 'panel',
        rootRef: panelRef,
        active: true,
        captureWhenActive: true,
        onNativeAction: ({ action }) => {
          if (action !== 'selectAll') {
            return false;
          }
          panelNativeActionHandler();
          return true;
        },
      });

      useKeyboardSurface({
        kind: 'editor',
        rootRef: editorRef,
        active: true,
        onNativeAction: ({ action }) => {
          if (action !== 'selectAll') {
            return false;
          }
          editorNativeActionHandler();
          return true;
        },
      });

      return (
        <div ref={panelRef}>
          <div ref={editorRef}>
            <button id="inside-editor">Inside editor</button>
          </div>
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

    const insideEditor = document.querySelector('#inside-editor') as HTMLButtonElement | null;
    expect(insideEditor).not.toBeNull();
    insideEditor?.focus();

    expect(apiRef.current?.dispatchNativeAction('selectAll')).toBe(true);
    expect(editorNativeActionHandler).toHaveBeenCalledTimes(1);
    expect(panelNativeActionHandler).not.toHaveBeenCalled();
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
