import { Browser, Clipboard, Events, System, Window as WailsWindow } from '@wailsio/runtime';

export type DesktopEventHandler<T = unknown> = (payload: T) => void;

export const onEvent = <T = unknown>(
  eventName: string,
  handler: DesktopEventHandler<T>
): (() => void) => Events.On(eventName, (event) => handler(event.data as T));

export const offEvent = (eventName: string): void => Events.Off(eventName);

export const openURL = (url: string | URL): Promise<void> => Browser.OpenURL(url);

export const readClipboardText = (): Promise<string> => Clipboard.Text();

export const openDevTools = (): Promise<void> => WailsWindow.OpenDevTools();

export const toggleMaximise = (): Promise<void> => WailsWindow.ToggleMaximise();

export const getEnvironment = (): Promise<System.EnvironmentInfo> => System.Environment();

export const desktopRuntimeAvailable = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean((window as Window & { _wails?: { environment?: unknown } })._wails?.environment);
