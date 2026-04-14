/**
 * frontend/src/components/modals/SettingsModal.test.tsx
 *
 * Test suite for SettingsModal.
 * Covers key behaviors and edge cases for SettingsModal.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsModal from './SettingsModal';
import Settings from '@ui/settings/Settings';
import { KeyboardProvider } from '@ui/shortcuts';

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMocks.eventsOn,
  EventsOff: runtimeMocks.eventsOff,
}));

vi.mock('@ui/settings/Settings', () => ({
  __esModule: true,
  default: vi.fn(() => <div data-testid="settings-content" />),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetAppSettings: vi.fn().mockResolvedValue({ useShortResourceNames: false }),
  GetThemeInfo: vi.fn().mockResolvedValue({ theme: 'dark' }),
  SetUseShortResourceNames: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/themes', () => ({
  changeTheme: vi.fn().mockResolvedValue(undefined),
  initSystemThemeListener: vi.fn().mockReturnValue(() => {}),
}));

vi.mock('@/core/refresh/RefreshManager', () => ({
  refreshManager: {
    register: vi.fn(),
    unregister: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    enable: vi.fn(),
    disable: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  },
}));

describe('SettingsModal shortcuts', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(async () => {
    runtimeMocks.eventsOn.mockReset();
    runtimeMocks.eventsOff.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <SettingsModal isOpen onClose={vi.fn()} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('closes on Escape through the shared modal surface', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <KeyboardProvider>
          <SettingsModal isOpen onClose={onClose} />
        </KeyboardProvider>
      );
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close via overlay click', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <KeyboardProvider>
          <SettingsModal isOpen onClose={onClose} />
        </KeyboardProvider>
      );
    });

    const overlay = document.querySelector('.settings-modal-overlay') as HTMLDivElement | null;
    expect(overlay).toBeTruthy();

    act(() => {
      overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('maintains closing animation before unmounting and restores scroll lock', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    act(() => {
      root.render(
        <KeyboardProvider>
          <SettingsModal isOpen onClose={onClose} />
        </KeyboardProvider>
      );
    });
    expect(document.body.style.overflow).toBe('hidden');

    act(() => {
      root.render(
        <KeyboardProvider>
          <SettingsModal isOpen={false} onClose={onClose} />
        </KeyboardProvider>
      );
    });

    expect(document.querySelector('.settings-modal')?.classList.contains('closing')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(document.querySelector('.settings-modal')).toBeNull();
    expect(document.body.style.overflow).toBe('');

    vi.useRealTimers();
  });

  it('renders Settings content on open', async () => {
    const settingsSpy = vi.mocked(Settings);
    settingsSpy.mockClear();
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <SettingsModal isOpen onClose={vi.fn()} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
    expect(settingsSpy).toHaveBeenCalled();
  });
});
