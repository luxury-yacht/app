/**
 * frontend/src/ui/shortcuts/context.test.tsx
 *
 * Test suite for context.
 * Covers key behaviors and edge cases for context.
 */

import { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  KeyboardProvider,
  useKeyboardContext,
  matchesShortcutContext,
  deriveCopyText,
  applySelectAll,
  shallowEqual,
} from './context';
import type { RegisteredShortcut } from '@/types/shortcuts';

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMocks.eventsOn,
  EventsOff: runtimeMocks.eventsOff,
}));

type ShortcutContextApi = ReturnType<typeof useKeyboardContext>;

describe('KeyboardProvider', () => {
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
    vi.restoreAllMocks();
    runtimeMocks.eventsOn.mockReset();
    runtimeMocks.eventsOff.mockReset();
  });

  it('stacks contexts and reflects availability changes', async () => {
    const apiRef: { current: ShortcutContextApi | null } = { current: null };
    const listHandler = vi.fn();

    const Harness = () => {
      const ctx = useKeyboardContext();

      useEffect(() => {
        apiRef.current = ctx;
      }, [ctx]);

      useEffect(() => {
        const listId = ctx.registerShortcut({
          key: 'l',
          contexts: [{ view: 'list', priority: 1 }],
          handler: listHandler,
          description: 'List scope action',
        });
        return () => {
          ctx.unregisterShortcut(listId);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

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
    expect(apiRef.current?.isShortcutAvailable('l')).toBe(false);

    act(() => {
      apiRef.current?.setContext({ view: 'list' });
    });
    expect(apiRef.current?.isShortcutAvailable('l')).toBe(true);

    act(() => {
      apiRef.current?.pushContext({ view: 'details', priority: 5 });
    });
    expect(apiRef.current?.isShortcutAvailable('l')).toBe(false);

    act(() => {
      apiRef.current?.popContext();
    });
    expect(apiRef.current?.isShortcutAvailable('l')).toBe(true);
  });

  it('executes the highest priority shortcut for matching key events', async () => {
    const apiRef: { current: ShortcutContextApi | null } = { current: null };
    const lowPriorityHandler = vi.fn();
    const highPriorityHandler = vi.fn();

    const Harness = () => {
      const ctx = useKeyboardContext();

      useEffect(() => {
        apiRef.current = ctx;
      }, [ctx]);

      useEffect(() => {
        const lowId = ctx.registerShortcut({
          key: 'k',
          contexts: [{ view: 'list', priority: 1 }],
          handler: lowPriorityHandler,
          description: 'Lower priority action',
        });
        const highId = ctx.registerShortcut({
          key: 'k',
          contexts: [{ view: 'list', priority: 5 }],
          handler: highPriorityHandler,
          description: 'Higher priority action',
        });
        return () => {
          ctx.unregisterShortcut(lowId);
          ctx.unregisterShortcut(highId);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

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

    act(() => {
      apiRef.current?.setContext({ view: 'list' });
    });

    const event = new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(highPriorityHandler).toHaveBeenCalledTimes(1);
    expect(lowPriorityHandler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  describe('helper functions', () => {
    it('evaluates matchesShortcutContext across all conditions', () => {
      const shortcut: RegisteredShortcut = {
        id: '1',
        key: 'a',
        handler: vi.fn(),
        description: '',
        contexts: [
          {
            view: 'details',
            priority: 2,
            resourceKind: 'deployments',
            objectKind: 'pod',
            panelOpen: 'object',
          },
          {
            view: 'details',
            priority: 1,
            resourceKind: 'deployments',
            objectKind: '*',
          },
        ],
        category: 'General',
        enabled: true,
      };

      expect(matchesShortcutContext(shortcut, { view: 'list', priority: 0 })).toBe(false);
      expect(
        matchesShortcutContext(shortcut, {
          view: 'details',
          priority: 0,
          resourceKind: 'deployments',
          objectKind: 'pod',
          panelOpen: 'object',
        })
      ).toBe(true);
      expect(
        matchesShortcutContext(shortcut, {
          view: 'details',
          priority: 0,
          resourceKind: 'configmaps',
          objectKind: 'pod',
          panelOpen: 'object',
        })
      ).toBe(false);
      expect(
        matchesShortcutContext(shortcut, {
          view: 'details',
          priority: 0,
          resourceKind: 'deployments',
          objectKind: 'service',
        })
      ).toBe(true);
    });

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
        delete (document as any).execCommand;
      }
    });

    it('performs shallow equal comparison for context objects', () => {
      expect(shallowEqual({ view: 'list' }, { view: 'list' })).toBe(true);
      expect(shallowEqual({ view: 'list' }, { view: 'details' })).toBe(false);
    });
  });
});

describe('keyboard handling edge cases', () => {
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
    vi.restoreAllMocks();
  });

  it('allows extended modifier shortcuts in inputs while protecting native copy/paste', async () => {
    const plainCopyHandler = vi.fn();
    const extendedHandler = vi.fn();
    const apiRef: { current: ShortcutContextApi | null } = { current: null };

    const Harness = () => {
      const ctx = useKeyboardContext();

      useEffect(() => {
        apiRef.current = ctx;
      }, [ctx]);

      useEffect(() => {
        const plainId = ctx.registerShortcut({
          key: 'c',
          modifiers: { meta: true },
          contexts: [{ view: 'global' }],
          handler: plainCopyHandler,
          description: 'Plain copy override',
        });
        const extendedId = ctx.registerShortcut({
          key: 'c',
          modifiers: { meta: true, shift: true },
          contexts: [{ view: 'global' }],
          handler: extendedHandler,
          description: 'Extended copy',
        });
        return () => {
          ctx.unregisterShortcut(plainId);
          ctx.unregisterShortcut(extendedId);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

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

    const optOut = document.createElement('input');
    optOut.setAttribute('data-allow-shortcuts', 'false');
    document.body.appendChild(optOut);
    optOut.focus();

    const blockedEvent = new KeyboardEvent('keydown', {
      key: 'c',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      optOut.dispatchEvent(blockedEvent);
    });

    expect(extendedHandler).toHaveBeenCalledTimes(1);
    expect(blockedEvent.defaultPrevented).toBe(false);

    optOut.remove();
    input.remove();
  });

  it('registers Wails menu bridge events for copy/selectAll', async () => {
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <div />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    const registeredEvents = runtimeMocks.eventsOn.mock.calls.map(([event]) => event);
    expect(registeredEvents).toEqual(expect.arrayContaining(['menu:copy', 'menu:selectAll']));

    act(() => {
      root.unmount();
    });

    const unregisteredEvents = runtimeMocks.eventsOff.mock.calls.map(([event]) => event);
    expect(unregisteredEvents).toEqual(expect.arrayContaining(['menu:copy', 'menu:selectAll']));
  });
});
