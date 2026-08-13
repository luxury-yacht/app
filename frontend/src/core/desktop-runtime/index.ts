import { Browser, Clipboard, Events, System, Window as WailsWindow } from '@wailsio/runtime';
import { getWindowIdentity, setWindowIdentity } from '@/core/window-identity';

export { getWindowIdentity } from '@/core/window-identity';

export type DesktopEventHandler<T = unknown> = (payload: T) => void;

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

export const onEvent = <T = unknown>(
  eventName: string,
  handler: DesktopEventHandler<T>
): (() => void) =>
  Events.On(eventName, (event) => {
    if (event.sender && event.sender !== getWindowIdentity()) {
      return;
    }
    handler(event.data as T);
  });

export const openURL = (url: string | URL): Promise<void> => Browser.OpenURL(url);

export const readClipboardText = (): Promise<string> => Clipboard.Text();

export const openDevTools = (): Promise<void> => WailsWindow.OpenDevTools();

export const toggleMaximise = (): Promise<void> => WailsWindow.ToggleMaximise();

export const getEnvironment = (): Promise<System.EnvironmentInfo> => System.Environment();

export const desktopRuntimeAvailable = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean((window as Window & { _wails?: { environment?: unknown } })._wails?.environment);
