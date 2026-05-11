import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppDebugShortcuts } from './useAppDebugShortcuts';

const platformMocks = vi.hoisted(() => ({
  isMacPlatform: vi.fn(() => true),
  isWindowsPlatform: vi.fn(() => false),
}));

vi.mock('@/utils/platform', () => ({
  isMacPlatform: platformMocks.isMacPlatform,
  isWindowsPlatform: platformMocks.isWindowsPlatform,
}));

const runtimeHandlers = new Map<string, (...args: unknown[]) => void>();
const runtimeEventsOn = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
  runtimeHandlers.set(event, handler);
  return () => runtimeHandlers.delete(event);
});
const runtimeEventsOff = vi.fn((event: string) => {
  runtimeHandlers.delete(event);
});

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
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    runtimeHandlers.clear();
    runtimeEventsOn.mockClear();
    runtimeEventsOff.mockClear();
    platformMocks.isMacPlatform.mockReturnValue(true);
    platformMocks.isWindowsPlatform.mockReturnValue(false);
    window.runtime = {
      EventsOn: runtimeEventsOn,
      EventsOff: runtimeEventsOff,
    } as unknown as WailsRuntime;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete window.runtime;
    delete (window as Window & { WailsInvoke?: (message: string) => void }).WailsInvoke;
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

    expect(runtimeEventsOn).toHaveBeenCalledWith('debug:open-inspector', expect.any(Function));
    expect(runtimeEventsOn).toHaveBeenCalledWith(
      'debug:toggle-panel-overlay',
      expect.any(Function)
    );
    expect(runtimeEventsOn).toHaveBeenCalledWith(
      'debug:toggle-focus-overlay',
      expect.any(Function)
    );
    expect(runtimeEventsOn).toHaveBeenCalledWith(
      'debug:toggle-error-overlay',
      expect.any(Function)
    );
    expect(runtimeEventsOn).toHaveBeenCalledWith('debug:toggle-map-overlay', expect.any(Function));
    expect(runtimeEventsOn).toHaveBeenCalledWith('debug:toggle-icon-overlay', expect.any(Function));
    expect(hook.onTogglePanelDebug).toHaveBeenCalledTimes(1);
    expect(hook.onToggleFocusDebug).toHaveBeenCalledTimes(1);
    expect(hook.onToggleErrorDebug).toHaveBeenCalledTimes(1);
    expect(hook.onToggleMapDebug).toHaveBeenCalledTimes(1);
    expect(hook.onToggleIconDebug).toHaveBeenCalledTimes(1);

    hook.unmount();
    expect(runtimeHandlers.size).toBe(0);
  });

  it('opens the Wails inspector from the debug menu event on WebKit platforms', () => {
    const wailsInvoke = vi.fn();
    (window as Window & { WailsInvoke?: (message: string) => void }).WailsInvoke = wailsInvoke;

    const hook = renderHookHost();

    act(() => {
      runtimeHandlers.get('debug:open-inspector')?.();
    });

    expect(wailsInvoke).toHaveBeenCalledWith('wails:openInspector');

    platformMocks.isMacPlatform.mockReturnValue(false);
    act(() => {
      runtimeHandlers.get('debug:open-inspector')?.();
    });

    expect(wailsInvoke).toHaveBeenLastCalledWith('wails:showInspector');

    platformMocks.isWindowsPlatform.mockReturnValue(true);
    act(() => {
      runtimeHandlers.get('debug:open-inspector')?.();
    });

    expect(wailsInvoke).toHaveBeenCalledTimes(2);

    hook.unmount();
  });
});
