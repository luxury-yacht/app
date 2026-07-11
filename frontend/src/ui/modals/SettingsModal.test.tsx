/**
 * frontend/src/ui/modals/SettingsModal.test.tsx
 *
 * Test suite for SettingsModal — tabbed shell behavior + section switching.
 */

import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import SettingsModal from './SettingsModal';

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMocks.eventsOn,
  EventsOff: runtimeMocks.eventsOff,
}));

vi.mock('@ui/settings/sections/AppearanceSection', () => ({
  __esModule: true,
  default: vi.fn(() => <div data-testid="section-appearance" />),
}));

vi.mock('@ui/settings/sections/KubeconfigsSection', () => ({
  __esModule: true,
  default: vi.fn(() => <div data-testid="section-kubeconfigs" />),
}));

vi.mock('@ui/settings/sections/DisplaySection', () => ({
  __esModule: true,
  default: vi.fn(() => <div data-testid="section-display" />),
}));

vi.mock('@ui/settings/sections/ObjectPanelSection', () => ({
  __esModule: true,
  default: vi.fn(() => <div data-testid="section-object-panel" />),
}));

vi.mock('@ui/settings/sections/AdvancedSection', () => ({
  __esModule: true,
  default: vi.fn(() => <div data-testid="section-advanced" />),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetAppSettings: vi.fn().mockResolvedValue({ useShortResourceNames: false }),
  GetAppearanceModeInfo: vi.fn().mockResolvedValue({ currentMode: 'dark', userMode: 'dark' }),
  SetUseShortResourceNames: vi.fn().mockResolvedValue(undefined),
  GetAppInfo: vi.fn().mockResolvedValue({ version: '4.2.1' }),
}));

vi.mock('@/core/app-state-access', () => ({
  readAppInfo: vi.fn().mockResolvedValue({ version: '4.2.1' }),
  requestAppState: vi.fn(({ read }: { read: () => Promise<unknown> }) => read()),
}));

vi.mock('@/utils/appearanceMode', () => ({
  changeAppearanceMode: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/core/refresh/RefreshManager', () => ({
  refreshManager: {
    register: vi.fn(),
    unregister: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    enable: vi.fn(),
    disable: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  },
}));

describe('SettingsModal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(async () => {
    runtimeMocks.eventsOn.mockReset();
    runtimeMocks.eventsOff.mockReset();
    // Reset persisted-tab so each test starts on the default tab.
    try {
      localStorage.removeItem('app-settings-last-tab');
    } catch {
      /* ignore */
    }
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

  it('ignores overlay and modal-content clicks', () => {
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
    const modal = document.querySelector('.settings-modal') as HTMLDivElement | null;
    expect(modal).toBeTruthy();

    act(() => {
      modal?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

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

  it('renders Appearance section by default and switches to Kubeconfigs on tab click', async () => {
    expect(document.querySelector('[data-testid="section-appearance"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="section-kubeconfigs"]')).toBeNull();

    const tabs = Array.from(
      document.querySelectorAll('.settings-modal-tab')
    ) as HTMLButtonElement[];
    const kubeconfigTab = tabs.find((t) => t.textContent?.includes('Kubeconfigs'));
    expect(kubeconfigTab).toBeTruthy();

    await act(async () => {
      requireValue(kubeconfigTab, 'expected test value in SettingsModal.test.tsx').click();
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="section-appearance"]')).toBeNull();
    expect(document.querySelector('[data-testid="section-kubeconfigs"]')).toBeTruthy();
  });

  it('honors initialTab prop on open', async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <SettingsModal isOpen onClose={onClose} initialTab="advanced" />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
    expect(document.querySelector('[data-testid="section-advanced"]')).toBeTruthy();
  });

  it('persists the active tab across opens via localStorage', async () => {
    const tabs = Array.from(
      document.querySelectorAll('.settings-modal-tab')
    ) as HTMLButtonElement[];
    const displayTab = tabs.find((t) => t.textContent?.includes('Display'));
    await act(async () => {
      requireValue(displayTab, 'expected test value in SettingsModal.test.tsx').click();
      await Promise.resolve();
    });
    expect(localStorage.getItem('app-settings-last-tab')).toBe('display');

    // Re-open the modal with no initialTab and verify it restores 'display'.
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <SettingsModal isOpen={false} onClose={vi.fn()} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <SettingsModal isOpen onClose={vi.fn()} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
    expect(document.querySelector('[data-testid="section-display"]')).toBeTruthy();
  });
});
