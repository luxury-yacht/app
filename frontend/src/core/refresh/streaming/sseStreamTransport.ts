import { ensureRefreshBaseURL } from '../client';

export type SSEListenerMap = Record<string, EventListener>;

export interface OpenRefreshEventSourceOptions {
  path: string;
  configureURL?: (url: URL) => void;
  listeners?: SSEListenerMap;
  onMessage?: (event: MessageEvent) => void;
  onError?: (event: Event) => void;
}

export interface RefreshEventSourceHandle {
  source: EventSource;
  close: () => void;
}

export const openRefreshEventSource = async (
  options: OpenRefreshEventSourceOptions
): Promise<RefreshEventSourceHandle> => {
  const baseURL = await ensureRefreshBaseURL();
  const url = new URL(options.path, baseURL);
  options.configureURL?.(url);

  const source = new EventSource(url.toString());
  if (options.onMessage) {
    source.onmessage = options.onMessage;
  }
  if (options.onError) {
    source.onerror = options.onError;
  }
  for (const [eventName, listener] of Object.entries(options.listeners ?? {})) {
    source.addEventListener(eventName, listener);
  }

  return {
    source,
    close: () => closeRefreshEventSource(source, options.listeners),
  };
};

export const closeRefreshEventSource = (
  source: EventSource | null,
  listeners?: SSEListenerMap
): void => {
  if (!source) {
    return;
  }
  for (const [eventName, listener] of Object.entries(listeners ?? {})) {
    source.removeEventListener(eventName, listener);
  }
  source.onmessage = null;
  source.onerror = null;
  source.close();
};
