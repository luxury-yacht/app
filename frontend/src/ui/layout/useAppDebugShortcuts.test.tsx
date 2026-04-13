import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useAppDebugShortcuts } from './useAppDebugShortcuts';

const renderHookHost = (handlers?: Partial<Parameters<typeof useAppDebugShortcuts>[0]>) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const resolvedHandlers = {
    onTogglePanelDebug: vi.fn(),
    onToggleFocusDebug: vi.fn(),
    onToggleErrorDebug: vi.fn(),
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

    act(() => {
      window.dispatchEvent(panelEvent);
      window.dispatchEvent(focusEvent);
      window.dispatchEvent(errorEvent);
    });

    expect(hook.onTogglePanelDebug).toHaveBeenCalledTimes(1);
    expect(hook.onToggleFocusDebug).toHaveBeenCalledTimes(1);
    expect(hook.onToggleErrorDebug).toHaveBeenCalledTimes(1);
    expect(panelEvent.defaultPrevented).toBe(true);
    expect(focusEvent.defaultPrevented).toBe(true);
    expect(errorEvent.defaultPrevented).toBe(true);

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

    hook.unmount();
  });
});
