import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  browserOpenURL: vi.fn(),
  clipboardSetText: vi.fn(),
  clipboardText: vi.fn(),
  environment: vi.fn(),
  eventsEmit: vi.fn(),
  eventsOn: vi.fn<
    (
      eventName: string,
      handler: (event: { name: string; data: unknown; sender?: string }) => void
    ) => () => void
  >(() => () => undefined),
  closeWindow: vi.fn(),
  openDevTools: vi.fn(),
  toggleMaximise: vi.fn(),
  windowName: vi.fn(),
}));

vi.mock('@wailsio/runtime', () => ({
  Browser: { OpenURL: runtimeMocks.browserOpenURL },
  Clipboard: { SetText: runtimeMocks.clipboardSetText, Text: runtimeMocks.clipboardText },
  Events: { Emit: runtimeMocks.eventsEmit, On: runtimeMocks.eventsOn },
  System: { Environment: runtimeMocks.environment },
  Window: {
    Close: runtimeMocks.closeWindow,
    Name: runtimeMocks.windowName,
    OpenDevTools: runtimeMocks.openDevTools,
    ToggleMaximise: runtimeMocks.toggleMaximise,
  },
}));

import * as desktopRuntime from './index';
import {
  closeWindow,
  type DesktopEventName,
  type DesktopEventPayload,
  desktopRuntimeAvailable,
  emitBroadcastEvent,
  getEnvironment,
  getWindowIdentity,
  initializeWindowIdentity,
  onBroadcastEvent,
  onEvent,
  openDevTools,
  openURL,
  readClipboardText,
  toggleMaximise,
  writeClipboardText,
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

    const unsubscribe = onEvent('cluster:scope:changed', (payload) => {
      expectTypeOf(payload).toEqualTypeOf<DesktopEventPayload<'cluster:scope:changed'>>();
      handler(payload);
    });
    const runtimeHandler = runtimeMocks.eventsOn.mock.calls[0]?.[1];
    runtimeHandler?.({ name: 'cluster:scope:changed', data: { clusterId: 'cluster-a' } });
    unsubscribe();

    expect(handler).toHaveBeenCalledWith({ clusterId: 'cluster-a' });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('filters events emitted by a different peer window', async () => {
    runtimeMocks.windowName.mockResolvedValue('workspace-2');
    await initializeWindowIdentity();
    const handler = vi.fn();

    onEvent('menu:copy', handler);
    const runtimeHandler = runtimeMocks.eventsOn.mock.calls[0]?.[1];
    runtimeHandler?.({ name: 'menu:copy', data: undefined, sender: 'workspace-1' });
    runtimeHandler?.({ name: 'menu:copy', data: undefined, sender: getWindowIdentity() });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('sends and receives process-wide events across peer windows', async () => {
    runtimeMocks.windowName.mockResolvedValue('panel-2');
    runtimeMocks.eventsEmit.mockResolvedValue(false);
    await initializeWindowIdentity();
    const handler = vi.fn();

    onBroadcastEvent('settings:appearance-mode-changed', handler);
    const runtimeHandler = runtimeMocks.eventsOn.mock.calls[0]?.[1];
    runtimeHandler?.({
      name: 'settings:appearance-mode-changed',
      data: { mode: 'dark' },
      sender: 'workspace-1',
    });
    await emitBroadcastEvent('settings:appearance-mode-changed', { mode: 'light' });

    expect(handler).toHaveBeenCalledWith({ mode: 'dark' });
    expect(runtimeMocks.eventsEmit).toHaveBeenCalledWith('settings:appearance-mode-changed', {
      mode: 'light',
    });
  });

  it('delegates desktop capabilities to the v3 runtime', async () => {
    runtimeMocks.clipboardText.mockResolvedValue('clipboard');
    runtimeMocks.environment.mockResolvedValue({ OS: 'darwin' });

    await openURL('https://luxury-yacht.app');
    await closeWindow();
    await openDevTools();
    await toggleMaximise();
    await writeClipboardText('copied');

    await expect(readClipboardText()).resolves.toBe('clipboard');
    await expect(getEnvironment()).resolves.toEqual({ OS: 'darwin' });
    expect(runtimeMocks.browserOpenURL).toHaveBeenCalledWith('https://luxury-yacht.app');
    expect(runtimeMocks.closeWindow).toHaveBeenCalledOnce();
    expect(runtimeMocks.openDevTools).toHaveBeenCalledOnce();
    expect(runtimeMocks.toggleMaximise).toHaveBeenCalledOnce();
    expect(runtimeMocks.clipboardSetText).toHaveBeenCalledWith('copied');
  });

  it('detects the environment injected by the Wails host', () => {
    expect(desktopRuntimeAvailable()).toBe(false);

    (window as Window & { _wails?: unknown })._wails = {
      environment: { OS: 'darwin' },
    };

    expect(desktopRuntimeAvailable()).toBe(true);
  });

  it('accepts only generated application event names', () => {
    expectTypeOf<'cluster:scope:changed'>().toMatchTypeOf<DesktopEventName>();
    expectTypeOf<'connection-status'>().not.toMatchTypeOf<DesktopEventName>();
    expectTypeOf<DesktopEventPayload<'cluster:scope:changed'>>().toEqualTypeOf<{
      clusterId: string;
    }>();
  });
});
