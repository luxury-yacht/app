/**
 * frontend/src/ui/shortcuts/hooks.test.tsx
 *
 * Test suite for hooks.
 * Covers key behaviors and edge cases for hooks.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { useShortcut, useShortcuts } from './hooks';
import * as shortcutContextModule from './context';

type RegisterArgs = {
  key: string;
  modifiers?: Record<string, boolean> | undefined;
  priority?: number;
  handler: (event?: KeyboardEvent) => void;
  description: string;
  category?: string;
  enabled: boolean;
};

type KeyboardContextShape = ReturnType<(typeof shortcutContextModule)['useKeyboardContext']>;

const buildKeyboardContext = (
  overrides: Partial<KeyboardContextShape> = {}
): KeyboardContextShape => ({
  registerShortcut: vi.fn(),
  unregisterShortcut: vi.fn(),
  getAvailableShortcuts: vi.fn().mockReturnValue([]),
  isShortcutAvailable: vi.fn().mockReturnValue(true),
  setEnabled: vi.fn(),
  isEnabled: true,
  registerSurface: vi.fn(),
  unregisterSurface: vi.fn(),
  updateSurface: vi.fn(),
  hasActiveBlockingSurface: vi.fn().mockReturnValue(false),
  dispatchNativeAction: vi.fn().mockReturnValue(false),
  ...overrides,
});

const createEvent = () => ({ preventDefault: vi.fn() }) as unknown as KeyboardEvent;

describe('useShortcut hooks', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const useKeyboardContextSpy = vi.spyOn(shortcutContextModule, 'useKeyboardContext');

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
    useKeyboardContextSpy.mockReset();
  });

  const renderWithContext = async (element: React.ReactElement, ctx: KeyboardContextShape) => {
    useKeyboardContextSpy.mockReturnValue(ctx);
    await act(async () => {
      root.render(element);
      await Promise.resolve();
    });
  };

  it('registers and unregisters a shortcut with direct priority metadata', async () => {
    const mockContext = buildKeyboardContext({
      registerShortcut: vi.fn().mockImplementation(({ handler }) => {
        handler(createEvent());
        return 'abc';
      }),
    });

    const shortcutOptions = {
      key: 'k',
      handler: vi.fn(),
      modifiers: { ctrl: true, meta: false },
      description: 'Trigger action',
      priority: 2,
      category: 'test',
    };

    const TestComponent: React.FC = () => {
      useShortcut(shortcutOptions);
      return null;
    };

    await renderWithContext(<TestComponent />, mockContext);
    const registerMock = mockContext.registerShortcut as unknown as Mock;
    expect(registerMock).toHaveBeenCalledTimes(1);
    const registeredArgs = registerMock.mock.calls[0][0] as RegisterArgs;
    expect(registeredArgs.key).toBe('k');
    expect(registeredArgs.modifiers).toEqual({ ctrl: true, shift: false, alt: false, meta: false });
    expect(registeredArgs.priority).toBe(2);
    expect(shortcutOptions.handler).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    const unregisterMock = mockContext.unregisterShortcut as unknown as Mock;
    expect(unregisterMock).toHaveBeenCalledWith('abc');
  });

  it('skips registration when disabled and re-registers when dependencies change', async () => {
    let counter = 0;
    const registerShortcut = vi.fn().mockImplementation(() => `id-${counter++}`);
    const unregisterShortcut = vi.fn();
    const mockContext = buildKeyboardContext({ registerShortcut, unregisterShortcut });

    const TestComponent: React.FC<{ enabled: boolean; handler: () => void }> = ({
      enabled,
      handler,
    }) => {
      useShortcut({
        key: 'Escape',
        handler,
        enabled,
        description: 'close',
      });
      return null;
    };

    const handlerA = vi.fn();
    await renderWithContext(<TestComponent enabled={false} handler={handlerA} />, mockContext);
    const registerMock = registerShortcut as unknown as Mock;
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(registerMock.mock.calls[0][0].enabled).toBe(false);

    const handlerB = vi.fn();
    await act(async () => {
      root.render(<TestComponent enabled={true} handler={handlerB} />);
      await Promise.resolve();
    });

    expect(registerMock).toHaveBeenCalledTimes(2);
    const wrappedHandler = registerMock.mock.calls[1][0].handler;
    wrappedHandler(createEvent());
    expect(handlerB).toHaveBeenCalled();

    await act(async () => {
      root.render(<TestComponent enabled={true} handler={handlerA} />);
      await Promise.resolve();
    });
    expect(registerMock).toHaveBeenCalledTimes(2);
    const latestHandler = registerMock.mock.calls[1][0].handler;
    latestHandler(createEvent());
    expect(handlerA).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    const unregisterMock = unregisterShortcut as unknown as Mock;
    expect(Array.from(unregisterMock.mock.calls, (call) => call[0])).toEqual(['id-0', 'id-1']);
  });

  it('registers multiple shortcuts with common options and keeps handlers fresh', async () => {
    let multiCounter = 0;
    const registerShortcut = vi.fn().mockImplementation(() => `id-${multiCounter++}`);
    const unregisterShortcut = vi.fn();
    const mockContext = buildKeyboardContext({ registerShortcut, unregisterShortcut });

    const shortcutA = { key: 'j', handler: vi.fn(), description: 'Next item' };
    const shortcutB = { key: 'k', handler: vi.fn(), description: 'Previous item', enabled: false };
    const common = { category: 'navigation' };

    const TestComponent: React.FC<{ shortcuts: (typeof shortcutA)[] }> = ({ shortcuts }) => {
      useShortcuts(shortcuts, common);
      return null;
    };

    await renderWithContext(<TestComponent shortcuts={[shortcutA, shortcutB]} />, mockContext);
    const registerMock = registerShortcut as unknown as Mock;
    expect(registerMock).toHaveBeenCalledTimes(2);

    const firstArgs = registerMock.mock.calls[0][0] as RegisterArgs;
    expect(firstArgs.priority).toBeUndefined();
    expect(firstArgs.enabled).toBe(true);

    const secondArgs = registerMock.mock.calls[1][0] as RegisterArgs;
    expect(secondArgs.enabled).toBe(false);

    // Trigger handler preservation
    registerMock.mock.calls[0][0].handler(createEvent());
    expect(shortcutA.handler).toHaveBeenCalled();

    const updatedShortcutA = { ...shortcutA, handler: vi.fn() };
    await act(async () => {
      root.render(<TestComponent shortcuts={[updatedShortcutA, shortcutB]} />);
      await Promise.resolve();
    });
    expect(registerMock).toHaveBeenCalledTimes(2);
    registerMock.mock.calls[0][0].handler(createEvent());
    expect(updatedShortcutA.handler).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    const unregisterMock = unregisterShortcut as unknown as Mock;
    expect(Array.from(unregisterMock.mock.calls, (call) => call[0])).toEqual(['id-0', 'id-1']);
  });
});
