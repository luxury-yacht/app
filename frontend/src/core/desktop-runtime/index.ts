import { Browser, Clipboard, Events, System, Window as WailsWindow } from '@wailsio/runtime';
import { getWindowIdentity, setWindowIdentity } from '@/core/window-identity';

export { getWindowIdentity } from '@/core/window-identity';

export type DesktopEventName = keyof Events.CustomEvents;
export type DesktopEventPayload<E extends DesktopEventName> = Events.CustomEvents[E];
export type DesktopEventHandler<E extends DesktopEventName> = (
  payload: DesktopEventPayload<E>
) => void;

export const initializeWindowIdentity = async (): Promise<string> => {
  try {
    const name = await WailsWindow.Name();
    if (name.trim()) {
      setWindowIdentity(name);
    }
  } catch {
    // Storybook and browser-only tests intentionally run without a Wails host.
  }
  return getWindowIdentity();
};

export const onEvent = <E extends DesktopEventName>(
  eventName: E,
  handler: DesktopEventHandler<E>
): (() => void) =>
  Events.On(eventName, (event) => {
    if (event.sender && event.sender !== getWindowIdentity()) {
      return;
    }
    handler(event.data);
  });

export const onBroadcastEvent = <E extends DesktopEventName>(
  eventName: E,
  handler: DesktopEventHandler<E>
): (() => void) => Events.On(eventName, (event) => handler(event.data));

export const emitBroadcastEvent = <E extends DesktopEventName>(
  eventName: E,
  payload: Events.WailsEventData<E>
): Promise<boolean> => Events.Emit(eventName, payload);

export const openURL = (url: string | URL): Promise<void> => Browser.OpenURL(url);

export const readClipboardText = (): Promise<string> => Clipboard.Text();

export const writeClipboardText = (text: string): Promise<void> => Clipboard.SetText(text);

export const closeWindow = (): Promise<void> => WailsWindow.Close();

export const isWindowMaximised = (): Promise<boolean> => WailsWindow.IsMaximised();

export const minimiseWindow = (): Promise<void> => WailsWindow.Minimise();

export const maximiseWindow = (): Promise<void> => WailsWindow.Maximise();

export const restoreWindow = (): Promise<void> => WailsWindow.Restore();

export const focusWindow = (windowName: string): Promise<void> =>
  WailsWindow.Get(windowName).Focus();

export const openDevTools = (): Promise<void> => WailsWindow.OpenDevTools();

export const toggleMaximise = (): Promise<void> => WailsWindow.ToggleMaximise();

export const getEnvironment = (): Promise<System.EnvironmentInfo> => System.Environment();

export const desktopRuntimeAvailable = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean((window as Window & { _wails?: { environment?: unknown } })._wails?.environment);
