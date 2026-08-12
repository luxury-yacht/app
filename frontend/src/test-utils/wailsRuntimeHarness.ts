type WailsEventHandler = (...args: unknown[]) => void;

export interface WailsRuntimeHarness {
  onEvent: (eventName: string, callback: WailsEventHandler) => () => void;
  disposerCalls: string[];
  emit: (eventName: string, ...args: unknown[]) => void;
  listenerCount: (eventName: string) => number;
}

export const createWailsRuntimeHarness = (): WailsRuntimeHarness => {
  const listeners = new Map<string, WailsEventHandler[]>();
  const disposerCalls: string[] = [];

  const onEvent = (eventName: string, callback: WailsEventHandler) => {
    const eventListeners = listeners.get(eventName) ?? [];
    eventListeners.push(callback);
    listeners.set(eventName, eventListeners);
    return () => {
      disposerCalls.push(eventName);
      const currentListeners = listeners.get(eventName);
      if (!currentListeners) {
        return;
      }
      const index = currentListeners.indexOf(callback);
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
