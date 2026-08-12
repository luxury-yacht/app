import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppDebugShortcuts } from './useAppDebugShortcuts';

const runtimeMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => void>(),
  onEvent: vi.fn<(event: string, handler: (...args: unknown[]) => void) => void>(),
  openDevTools: vi.fn(),
}));
const runtimeHandlers = runtimeMocks.handlers;
const runtimeonEvent = runtimeMocks.onEvent;

vi.mock('@core/desktop-runtime', () => ({
  onEvent: (event: string, handler: (...args: unknown[]) => void) => {
    runtimeMocks.onEvent(event, handler);
    runtimeMocks.handlers.set(event, handler);
    return () => runtimeMocks.handlers.delete(event);
  },
  openDevTools: () => runtimeMocks.openDevTools(),
}));

const renderHookHost = (handlers?: Partial<Parameters<typeof useAppDebugShortcuts>[0]>) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const resolvedHandlers = {
    onTogglePanelDebug: vi.fn(),
    onToggleFocusDebug: vi.fn(),
    onToggleErrorDebug: vi.fn(),
    onToggleMapDebug: vi.fn(),
    onToggleIconDebug: vi.fn(),
    ...handlers,
  };

  const HookHost = () => {
    useAppDebugShortcuts(resolvedHandlers);
    return null;
  };

  act(() => {
    root.render(<HookHost />);
  });

  return {
    ...resolvedHandlers,
    unmount: () => {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
};

describe('useAppDebugShortcuts', () => {
  beforeEach(() => {
    runtimeHandlers.clear();
    runtimeonEvent.mockClear();
    runtimeMocks.openDevTools.mockReset();
    runtimeMocks.openDevTools.mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('toggles each debug overlay on its Ctrl+Alt shortcut', () => {
    const hook = renderHookHost();

    const panelEvent = new KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: true,
      altKey: true,
      cancelable: true,
      bubbles: true,
    });
    const focusEvent = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      altKey: true,
      cancelable: true,
      bubbles: true,
    });
    const errorEvent = new KeyboardEvent('keydown', {
      key: 'e',
      ctrlKey: true,
      altKey: true,
      cancelable: true,
      bubbles: true,
    });
    const mapEvent = new KeyboardEvent('keydown', {
      key: 'm',
      ctrlKey: true,
      altKey: true,
      cancelable: true,
      bubbles: true,
    });
    const iconEvent = new KeyboardEvent('keydown', {
      key: 'i',
      ctrlKey: true,
      altKey: true,
      cancelable: true,
      bubbles: true,
    });

    act(() => {
      window.dispatchEvent(panelEvent);
      window.dispatchEvent(focusEvent);
      window.dispatchEvent(errorEvent);
      window.dispatchEvent(mapEvent);
      window.dispatchEvent(iconEvent);
    });

    expect(hook.onTogglePanelDebug).toHaveBeenCalledTimes(1);
    expect(hook.onToggleFocusDebug).toHaveBeenCalledTimes(1);
    expect(hook.onToggleErrorDebug).toHaveBeenCalledTimes(1);
    expect(hook.onToggleMapDebug).toHaveBeenCalledTimes(1);
    expect(hook.onToggleIconDebug).toHaveBeenCalledTimes(1);
    expect(panelEvent.defaultPrevented).toBe(true);
    expect(focusEvent.defaultPrevented).toBe(true);
    expect(errorEvent.defaultPrevented).toBe(true);
    expect(mapEvent.defaultPrevented).toBe(true);
    expect(iconEvent.defaultPrevented).toBe(true);

    hook.unmount();
  });

  it('ignores keys outside the debug shortcut set', () => {
    const hook = renderHookHost();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'p',
          ctrlKey: true,
          cancelable: true,
          bubbles: true,
        })
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'x',
          ctrlKey: true,
          altKey: true,
          cancelable: true,
          bubbles: true,
        })
      );
    });

    expect(hook.onTogglePanelDebug).not.toHaveBeenCalled();
    expect(hook.onToggleFocusDebug).not.toHaveBeenCalled();
    expect(hook.onToggleErrorDebug).not.toHaveBeenCalled();
    expect(hook.onToggleMapDebug).not.toHaveBeenCalled();
    expect(hook.onToggleIconDebug).not.toHaveBeenCalled();

    hook.unmount();
  });

  it('toggles each debug overlay from Wails debug menu events', () => {
    const hook = renderHookHost();

    act(() => {
      runtimeHandlers.get('debug:toggle-panel-overlay')?.();
      runtimeHandlers.get('debug:toggle-focus-overlay')?.();
      runtimeHandlers.get('debug:toggle-error-overlay')?.();
      runtimeHandlers.get('debug:toggle-map-overlay')?.();
      runtimeHandlers.get('debug:toggle-icon-overlay')?.();
    });

    expect(runtimeonEvent).toHaveBeenCalledWith('debug:open-inspector', expect.any(Function));
    expect(runtimeonEvent).toHaveBeenCalledWith('debug:toggle-panel-overlay', expect.any(Function));
    expect(runtimeonEvent).toHaveBeenCalledWith('debug:toggle-focus-overlay', expect.any(Function));
    expect(runtimeonEvent).toHaveBeenCalledWith('debug:toggle-error-overlay', expect.any(Function));
    expect(runtimeonEvent).toHaveBeenCalledWith('debug:toggle-map-overlay', expect.any(Function));
    expect(runtimeonEvent).toHaveBeenCalledWith('debug:toggle-icon-overlay', expect.any(Function));
    expect(hook.onTogglePanelDebug).toHaveBeenCalledTimes(1);
    expect(hook.onToggleFocusDebug).toHaveBeenCalledTimes(1);
    expect(hook.onToggleErrorDebug).toHaveBeenCalledTimes(1);
    expect(hook.onToggleMapDebug).toHaveBeenCalledTimes(1);
    expect(hook.onToggleIconDebug).toHaveBeenCalledTimes(1);

    hook.unmount();
    expect(runtimeHandlers.size).toBe(0);
  });

  it('opens the v3 window devtools from the debug menu event', () => {
    const hook = renderHookHost();

    act(() => {
      runtimeHandlers.get('debug:open-inspector')?.();
    });

    expect(runtimeMocks.openDevTools).toHaveBeenCalledOnce();

    hook.unmount();
  });
});
