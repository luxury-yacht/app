import { afterEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  browserOpenURL: vi.fn(),
  clipboardText: vi.fn(),
  environment: vi.fn(),
  eventsOn: vi.fn<
    (eventName: string, handler: (event: { name: string; data: unknown }) => void) => () => void
  >(() => () => undefined),
  openDevTools: vi.fn(),
  toggleMaximise: vi.fn(),
}));

vi.mock('@wailsio/runtime', () => ({
  Browser: { OpenURL: runtimeMocks.browserOpenURL },
  Clipboard: { Text: runtimeMocks.clipboardText },
  Events: { On: runtimeMocks.eventsOn },
  System: { Environment: runtimeMocks.environment },
  Window: {
    OpenDevTools: runtimeMocks.openDevTools,
    ToggleMaximise: runtimeMocks.toggleMaximise,
  },
}));

import * as desktopRuntime from './index';
import {
  desktopRuntimeAvailable,
  getEnvironment,
  onEvent,
  openDevTools,
  openURL,
  readClipboardText,
  toggleMaximise,
} from './index';

describe('desktop runtime adapter', () => {
  afterEach(() => {
    vi.clearAllMocks();
    (window as Window & { _wails?: unknown })._wails = undefined;
  });

  it('does not expose event-wide listener removal', () => {
    expect(desktopRuntime).not.toHaveProperty('offEvent');
  });

  it('unwraps v3 event payloads and returns the v3 disposer', () => {
    const dispose = vi.fn();
    runtimeMocks.eventsOn.mockReturnValue(dispose);
    const handler = vi.fn();

    const unsubscribe = onEvent('cluster:changed', handler);
    const runtimeHandler = runtimeMocks.eventsOn.mock.calls[0]?.[1];
    runtimeHandler?.({ name: 'cluster:changed', data: { clusterId: 'cluster-a' } });
    unsubscribe();

    expect(handler).toHaveBeenCalledWith({ clusterId: 'cluster-a' });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('delegates desktop capabilities to the v3 runtime', async () => {
    runtimeMocks.clipboardText.mockResolvedValue('clipboard');
    runtimeMocks.environment.mockResolvedValue({ OS: 'darwin' });

    await openURL('https://luxury-yacht.app');
    await openDevTools();
    await toggleMaximise();

    await expect(readClipboardText()).resolves.toBe('clipboard');
    await expect(getEnvironment()).resolves.toEqual({ OS: 'darwin' });
    expect(runtimeMocks.browserOpenURL).toHaveBeenCalledWith('https://luxury-yacht.app');
    expect(runtimeMocks.openDevTools).toHaveBeenCalledOnce();
    expect(runtimeMocks.toggleMaximise).toHaveBeenCalledOnce();
  });

  it('detects the environment injected by the Wails host', () => {
    expect(desktopRuntimeAvailable()).toBe(false);

    (window as Window & { _wails?: unknown })._wails = {
      environment: { OS: 'darwin' },
    };

    expect(desktopRuntimeAvailable()).toBe(true);
  });
});
