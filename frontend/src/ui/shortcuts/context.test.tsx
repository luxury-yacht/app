/**
 * frontend/src/ui/shortcuts/context.test.tsx
 *
 * Test suite for context.
 * Covers key behaviors and edge cases for context.
 */

import { act, useEffect, useEffectEvent } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applySelectAll,
  cutContentEditableSelection,
  deriveCopyText,
  KeyboardProvider,
  pasteIntoContentEditable,
  useKeyboardContext,
} from './context';

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn<(event: string, handler: (...args: unknown[]) => void) => () => void>(
    () => () => undefined
  ),
  eventsOff: vi.fn(),
}));

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => false,
  onEvent: runtimeMocks.eventsOn,
  offEvent: runtimeMocks.eventsOff,
}));

type KeyboardContextApi = ReturnType<typeof useKeyboardContext>;

describe('KeyboardProvider', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

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
    vi.restoreAllMocks();
    runtimeMocks.eventsOn.mockReset().mockReturnValue(() => undefined);
    runtimeMocks.eventsOff.mockReset();
  });

  it('reports availability for registered shortcuts', async () => {
    const apiRef: { current: KeyboardContextApi | null } = { current: null };
    const listHandler = vi.fn();

    const Harness = () => {
      const ctx = useKeyboardContext();

      useEffect(() => {
        apiRef.current = ctx;
      }, [ctx]);

      const registerListShortcut = useEffectEvent(() => {
        const listId = ctx.registerShortcut({
          key: 'l',
          priority: 1,
          handler: listHandler,
          description: 'List scope action',
          category: 'Navigation',
        });
        const disabledId = ctx.registerShortcut({
          key: 'x',
          enabled: false,
          handler: vi.fn(),
          description: 'Disabled action',
          category: 'Navigation',
        });
        return () => {
          ctx.unregisterShortcut(listId);
          ctx.unregisterShortcut(disabledId);
        };
      });
      useEffect(() => registerListShortcut(), []);

      return null;
    };

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <Harness />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    expect(apiRef.current).not.toBeNull();
    expect(apiRef.current?.isShortcutAvailable('l')).toBe(true);
    expect(apiRef.current?.isShortcutAvailable('x')).toBe(false);
    expect(apiRef.current?.getAvailableShortcuts()).toEqual(
      expect.arrayContaining([
        {
          category: 'Global',
          shortcuts: [expect.objectContaining({ description: 'Focus active search' })],
        },
        {
          category: 'Navigation',
          shortcuts: [expect.objectContaining({ description: 'List scope action' })],
        },
      ])
    );
  });

  it('executes the highest priority shortcut for matching key events', async () => {
    const apiRef: { current: KeyboardContextApi | null } = { current: null };
    const lowPriorityHandler = vi.fn();
    const highPriorityHandler = vi.fn();

    const Harness = () => {
      const ctx = useKeyboardContext();

      useEffect(() => {
        apiRef.current = ctx;
      }, [ctx]);

      const registerPriorityShortcuts = useEffectEvent(() => {
        const lowId = ctx.registerShortcut({
          key: 'k',
          priority: 1,
          handler: lowPriorityHandler,
          description: 'Lower priority action',
        });
        const highId = ctx.registerShortcut({
          key: 'k',
          priority: 5,
          handler: highPriorityHandler,
          description: 'Higher priority action',
        });
        return () => {
          ctx.unregisterShortcut(lowId);
          ctx.unregisterShortcut(highId);
        };
      });
      useEffect(() => registerPriorityShortcuts(), []);

      return null;
    };

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <Harness />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    expect(apiRef.current).not.toBeNull();
    const event = new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(highPriorityHandler).toHaveBeenCalledTimes(1);
    expect(lowPriorityHandler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);

    const repeatedEvent = new KeyboardEvent('keydown', {
      key: 'k',
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(repeatedEvent);
    });

    expect(highPriorityHandler).toHaveBeenCalledTimes(2);
    expect(repeatedEvent.defaultPrevented).toBe(true);
  });

  describe('helper functions', () => {
    it('removes YAML line numbers when deriving copy text', () => {
      const yamlNode = document.createElement('pre');
      yamlNode.className = 'yaml-content';
      document.body.appendChild(yamlNode);
      const selection = {
        isCollapsed: false,
        toString: () => '  1 apiVersion: v1\n  2 kind: Pod',
        anchorNode: yamlNode,
      } as unknown as Selection;

      expect(deriveCopyText(selection)).toBe('apiVersion: v1\nkind: Pod');
      expect(deriveCopyText(null)).toBeNull();
      document.body.removeChild(yamlNode);
    });

    it('selects all contents of active element when provided', () => {
      const removeAllRanges = vi.fn();
      const addRange = vi.fn();
      const selection = {
        removeAllRanges,
        addRange,
      } as unknown as Selection;
      const element = document.createElement('div');

      applySelectAll(selection, element);
      expect(removeAllRanges).toHaveBeenCalled();
      expect(addRange).toHaveBeenCalled();

      const execSpy = vi.fn();
      const originalExecDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        writable: true,
        value: execSpy,
      });
      applySelectAll(selection, null);
      expect(execSpy).toHaveBeenCalledWith('selectAll');
      if (originalExecDescriptor) {
        Object.defineProperty(document, 'execCommand', originalExecDescriptor);
      } else {
        Reflect.deleteProperty(document, 'execCommand');
      }
    });

    it('cuts a contenteditable selection through the Selection API', () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText } });
      const deleteFromDocument = vi.fn();
      const selectedNode = document.createTextNode('selected text');
      const selection = {
        isCollapsed: false,
        toString: () => 'selected text',
        anchorNode: selectedNode,
        deleteFromDocument,
      } as unknown as Selection;

      expect(cutContentEditableSelection(selection)).toBe(true);
      expect(writeText).toHaveBeenCalledWith('selected text');
      expect(deleteFromDocument).toHaveBeenCalledTimes(1);
    });

    it('pastes text at a contenteditable range and leaves the caret after it', () => {
      const insertNode = vi.fn();
      const setStartAfter = vi.fn();
      const collapse = vi.fn();
      const range = {
        deleteContents: vi.fn(),
        insertNode,
        setStartAfter,
        collapse,
      } as unknown as Range;
      const removeAllRanges = vi.fn();
      const addRange = vi.fn();
      const selection = {
        rangeCount: 1,
        getRangeAt: vi.fn(() => range),
        removeAllRanges,
        addRange,
      } as unknown as Selection;

      expect(pasteIntoContentEditable('pasted text', selection)).toBe(true);
      const insertedNode = insertNode.mock.calls[0]?.[0] as Text;
      expect(insertedNode.data).toBe('pasted text');
      expect(range.deleteContents).toHaveBeenCalledTimes(1);
      expect(setStartAfter).toHaveBeenCalledWith(insertedNode);
      expect(collapse).toHaveBeenCalledWith(true);
      expect(removeAllRanges).toHaveBeenCalledTimes(1);
      expect(addRange).toHaveBeenCalledWith(range);
    });
  });
});

describe('keyboard handling edge cases', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

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
    vi.restoreAllMocks();
  });

  it('allows extended modifier shortcuts in inputs while protecting native copy/paste', async () => {
    const plainCopyHandler = vi.fn();
    const extendedHandler = vi.fn();
    const apiRef: { current: KeyboardContextApi | null } = { current: null };

    const Harness = () => {
      const ctx = useKeyboardContext();

      useEffect(() => {
        apiRef.current = ctx;
      }, [ctx]);

      const registerCopyShortcuts = useEffectEvent(() => {
        const plainId = ctx.registerShortcut({
          key: 'c',
          modifiers: { meta: true },
          handler: plainCopyHandler,
          description: 'Plain copy override',
        });
        const extendedId = ctx.registerShortcut({
          key: 'c',
          modifiers: { meta: true, shift: true },
          handler: extendedHandler,
          description: 'Extended copy',
        });
        return () => {
          ctx.unregisterShortcut(plainId);
          ctx.unregisterShortcut(extendedId);
        };
      });
      useEffect(() => registerCopyShortcuts(), []);

      return null;
    };

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <Harness />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const plainEvent = new KeyboardEvent('keydown', {
      key: 'c',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      input.dispatchEvent(plainEvent);
    });

    expect(plainCopyHandler).not.toHaveBeenCalled();
    expect(plainEvent.defaultPrevented).toBe(false);

    const extendedEvent = new KeyboardEvent('keydown', {
      key: 'c',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      input.dispatchEvent(extendedEvent);
    });

    expect(extendedHandler).toHaveBeenCalledTimes(1);
    expect(extendedEvent.defaultPrevented).toBe(true);

    input.remove();
  });

  it('registers Wails menu bridge events for cut/copy/paste/selectAll', async () => {
    const disposedEvents: string[] = [];
    runtimeMocks.eventsOn.mockImplementation((event) => () => {
      disposedEvents.push(event);
    });

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <div />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    const registeredEvents = runtimeMocks.eventsOn.mock.calls.map(([event]) => event);
    expect(registeredEvents).toEqual(
      expect.arrayContaining(['menu:cut', 'menu:copy', 'menu:paste', 'menu:selectAll'])
    );

    act(() => {
      root.unmount();
    });

    expect(disposedEvents).toEqual(
      expect.arrayContaining(['menu:cut', 'menu:copy', 'menu:paste', 'menu:selectAll'])
    );
    expect(runtimeMocks.eventsOff).not.toHaveBeenCalled();
  });

  it('routes menu cut to the surface containing the focused element', async () => {
    const onNativeAction = vi.fn(() => true);
    const surfaceRoot = document.createElement('div');
    const focusable = document.createElement('button');
    surfaceRoot.appendChild(focusable);
    document.body.appendChild(surfaceRoot);
    const rootRef = { current: surfaceRoot };

    const Harness = () => {
      const ctx = useKeyboardContext();
      const registerEditorSurface = useEffectEvent(() => {
        const id = ctx.registerSurface({ kind: 'editor', rootRef, onNativeAction });
        return () => ctx.unregisterSurface(id);
      });
      useEffect(() => registerEditorSurface(), []);
      return null;
    };

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <Harness />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    focusable.focus();

    // Mock calls accumulate across this describe block; take the handler from
    // the provider rendered by this test.
    const cutRegistrations = runtimeMocks.eventsOn.mock.calls.filter(
      ([event]) => event === 'menu:cut'
    );
    const cutHandler = cutRegistrations[cutRegistrations.length - 1]?.[1] as
      | (() => void)
      | undefined;
    expect(typeof cutHandler).toBe('function');

    act(() => {
      cutHandler?.();
    });

    expect(onNativeAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cut', activeElement: focusable })
    );

    surfaceRoot.remove();
  });

  it('cuts the focused input selection through the menu bridge fallback', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <div />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    const input = document.createElement('input');
    input.value = 'kind: ConfigMap';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 4);

    const inputEvents = vi.fn();
    input.addEventListener('input', inputEvents);

    const cutRegistrations = runtimeMocks.eventsOn.mock.calls.filter(
      ([event]) => event === 'menu:cut'
    );
    const cutHandler = cutRegistrations[cutRegistrations.length - 1]?.[1] as
      | (() => void)
      | undefined;
    expect(typeof cutHandler).toBe('function');

    act(() => {
      cutHandler?.();
    });

    expect(writeText).toHaveBeenCalledWith('kind');
    expect(input.value).toBe(': ConfigMap');
    expect(inputEvents).toHaveBeenCalled();

    input.remove();
  });

  it('pastes into the focused input through the menu bridge fallback', async () => {
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <div />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    const input = document.createElement('input');
    input.value = 'kind: Pod';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(6, 9);
    const inputEvents = vi.fn();
    input.addEventListener('input', inputEvents);

    const pasteRegistrations = runtimeMocks.eventsOn.mock.calls.filter(
      ([event]) => event === 'menu:paste'
    );
    const pasteHandler = pasteRegistrations[pasteRegistrations.length - 1]?.[1] as
      | ((text: string) => void)
      | undefined;

    act(() => {
      pasteHandler?.('Service');
    });

    expect(input.value).toBe('kind: Service');
    expect(inputEvents).toHaveBeenCalledTimes(1);
    input.remove();
  });
});
