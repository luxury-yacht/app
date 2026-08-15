import type { DesktopEventHandler, DesktopEventName } from '@/core/desktop-runtime';

type WailsEventHandler = (...args: unknown[]) => void;

export interface WailsRuntimeHarness {
  onEvent: <E extends DesktopEventName>(
    eventName: E,
    callback: DesktopEventHandler<E>
  ) => () => void;
  disposerCalls: string[];
  emit: (eventName: string, ...args: unknown[]) => void;
  listenerCount: (eventName: string) => number;
}

export const createWailsRuntimeHarness = (): WailsRuntimeHarness => {
  const listeners = new Map<string, WailsEventHandler[]>();
  const disposerCalls: string[] = [];

  const onEvent: WailsRuntimeHarness['onEvent'] = (eventName, callback) => {
    const eventListeners = listeners.get(eventName) ?? [];
    const untypedCallback = callback as WailsEventHandler;
    eventListeners.push(untypedCallback);
    listeners.set(eventName, eventListeners);
    return () => {
      disposerCalls.push(eventName);
      const currentListeners = listeners.get(eventName);
      if (!currentListeners) {
        return;
      }
      const index = currentListeners.indexOf(untypedCallback);
      if (index >= 0) {
        currentListeners.splice(index, 1);
      }
    };
  };

  return {
    onEvent,
    disposerCalls,
    emit: (eventName, ...args) => {
      listeners.get(eventName)?.forEach((listener) => {
        listener(...args);
      });
    },
    listenerCount: (eventName) => listeners.get(eventName)?.length ?? 0,
  };
};
