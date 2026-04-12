import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import LogSettingsModal from './LogSettingsModal';
import LogSettings from '@modules/object-panel/components/ObjectPanel/Logs/LogSettings';

const shortcutMocks = vi.hoisted(() => ({
  useShortcut: vi.fn(),
  useKeyboardNavigationScope: vi.fn(),
}));

const contextMocks = vi.hoisted(() => ({
  pushContext: vi.fn(),
  popContext: vi.fn(),
}));

vi.mock('@ui/shortcuts', () => ({
  useShortcut: (...args: unknown[]) => shortcutMocks.useShortcut(...args),
  useKeyboardContext: () => contextMocks,
  useSearchShortcutTarget: () => undefined,
  useKeyboardNavigationScope: (...args: unknown[]) =>
    shortcutMocks.useKeyboardNavigationScope(...args),
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Logs/LogSettings', () => ({
  __esModule: true,
  default: vi.fn(() => <div data-testid="log-settings-content" />),
}));

describe('LogSettingsModal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(async () => {
    shortcutMocks.useShortcut.mockClear();
    shortcutMocks.useKeyboardNavigationScope.mockClear();
    contextMocks.pushContext.mockClear();
    contextMocks.popContext.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(<LogSettingsModal isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const getEscapeShortcut = () => {
    for (let i = shortcutMocks.useShortcut.mock.calls.length - 1; i >= 0; i -= 1) {
      const config = shortcutMocks.useShortcut.mock.calls[i][0] as {
        key: string;
        handler: () => boolean;
        enabled?: boolean;
      };
      if (config.key === 'Escape') {
        return config;
      }
    }
    throw new Error('Escape shortcut not registered');
  };

  it('pushes and pops shortcut context when opened and closed', async () => {
    expect(contextMocks.pushContext).toHaveBeenCalledWith({ priority: 1000 });
    expect(contextMocks.popContext).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<LogSettingsModal isOpen={false} onClose={vi.fn()} />);
      await Promise.resolve();
    });

    expect(contextMocks.popContext).toHaveBeenCalled();
  });

  it('invokes onClose when Escape fires', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(<LogSettingsModal isOpen onClose={onClose} />);
    });

    const escapeShortcut = getEscapeShortcut();
    expect(escapeShortcut.enabled).toBe(true);

    let result = false;
    act(() => {
      result = escapeShortcut.handler();
    });
    expect(result).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes via overlay click but ignores clicks inside the modal', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(<LogSettingsModal isOpen onClose={onClose} />);
    });

    const overlay = document.querySelector('.log-settings-modal-overlay') as HTMLDivElement | null;
    const modal = document.querySelector('.log-settings-modal') as HTMLDivElement | null;

    act(() => {
      modal?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('maintains closing animation before unmounting and restores scroll lock', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    act(() => {
      root.render(<LogSettingsModal isOpen onClose={onClose} />);
    });
    expect(document.body.style.overflow).toBe('hidden');

    act(() => {
      root.render(<LogSettingsModal isOpen={false} onClose={onClose} />);
    });

    expect(document.querySelector('.log-settings-modal')?.classList.contains('closing')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(document.querySelector('.log-settings-modal')).toBeNull();
    expect(document.body.style.overflow).toBe('');

    vi.useRealTimers();
  });

  it('renders Log Settings content on open', async () => {
    const logSettingsSpy = vi.mocked(LogSettings);
    logSettingsSpy.mockClear();

    await act(async () => {
      root.render(<LogSettingsModal isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });

    expect(logSettingsSpy).toHaveBeenCalled();
  });
});
