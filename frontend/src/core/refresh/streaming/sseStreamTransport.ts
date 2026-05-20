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

export const sseReconnectDelay = (
  attempt: number,
  options: {
    baseMs?: number;
    maxMs?: number;
    minMs?: number;
    jitterMs?: number;
  } = {}
): number => {
  const baseMs = options.baseMs ?? 1000;
  const maxMs = options.maxMs ?? 30_000;
  const minMs = options.minMs ?? 0;
  const backoff = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = options.jitterMs ? Math.random() * options.jitterMs : 0;
  return Math.max(minMs, backoff + jitter);
};
