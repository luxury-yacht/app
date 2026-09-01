import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAppearanceModePreference,
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';
import { AppearanceModeProvider, useAppearanceMode } from './AppearanceModeContext';

const runtimeMocks = vi.hoisted(() => ({
  broadcastHandler: undefined as ((payload: { mode: string }) => void) | undefined,
  emitBroadcastEvent: vi.fn(),
  onBroadcastEvent: vi.fn(),
}));

vi.mock('@/core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => true,
  emitBroadcastEvent: (...args: unknown[]) => runtimeMocks.emitBroadcastEvent(...args),
  onBroadcastEvent: (...args: unknown[]) => runtimeMocks.onBroadcastEvent(...args),
}));

const mockMatchMedia = () => ({
  matches: false,
  media: '(prefers-color-scheme: dark)',
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

describe('AppearanceModeProvider', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const modeRef: { current: ReturnType<typeof useAppearanceMode> | null } = { current: null };

  const Probe = () => {
    modeRef.current = useAppearanceMode();
    return null;
  };

  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
    setAppPreferencesForTesting({
      accentColorDark: '#336699',
      appearanceMode: 'light',
      linkColorDark: '#abcdef',
    });
    runtimeMocks.broadcastHandler = undefined;
    runtimeMocks.onBroadcastEvent.mockReset();
    runtimeMocks.onBroadcastEvent.mockImplementation(
      (_eventName: string, handler: (payload: { mode: string }) => void) => {
        runtimeMocks.broadcastHandler = handler;
        return vi.fn();
      }
    );
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: mockMatchMedia,
    });
    document.documentElement.dataset.appearanceMode = 'light';
    document.documentElement.className = 'light';
    document.documentElement.removeAttribute('style');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    modeRef.current = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetAppPreferencesCacheForTesting();
    localStorage.clear();
  });

  it('applies an appearance mode broadcast from a peer window', async () => {
    await act(async () => {
      root.render(
        <AppearanceModeProvider>
          <Probe />
        </AppearanceModeProvider>
      );
      await Promise.resolve();
    });

    act(() => runtimeMocks.broadcastHandler?.({ mode: 'dark' }));

    expect(runtimeMocks.onBroadcastEvent).toHaveBeenCalledWith(
      'settings:appearance-mode-changed',
      expect.any(Function)
    );
    expect(getAppearanceModePreference()).toBe('dark');
    expect(modeRef.current).toEqual({ mode: 'dark', resolvedMode: 'dark' });
    expect(document.documentElement.dataset.appearanceMode).toBe('dark');
    expect(document.documentElement.className).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--color-accent-bg')).toBe(
      'rgba(51, 102, 153, 0.15)'
    );
    expect(document.documentElement.style.getPropertyValue('--color-object-panel-link')).toBe(
      '#abcdef'
    );
  });
});
