/**
 * frontend/src/test-utils/refreshHarness.ts
 *
 * Drives the real refresh orchestrator, cluster runtimes, store, default
 * domain registrations, and stream managers. Only the transport is faked:
 * the calling test mocks `@/core/refresh/client` (snapshot reads), and this
 * harness installs fake Wails named-stream sockets. Tests then assert what the
 * refresh layer asks of the backend — which stream subscriptions are open and
 * which snapshots are read — instead of inspecting orchestrator internals.
 */

import { vi } from 'vitest';
import { eventBus } from '@/core/events';
import { clusterReadiness } from '@/core/refresh/clusterReadiness';
import { refreshOrchestrator } from '@/core/refresh/orchestrator';
import { encodeScopeSelector, parseRefreshScope } from '@/core/refresh/scopeSelector';
import type { RefreshDomain } from '@/core/refresh/types';
import { setAppPreferencesForTesting } from '@/core/settings/appPreferences';
import { compareUtf16Strings } from '@/shared/utils/sort';

type StreamFrame = Record<string, unknown>;

const RESOURCE_STREAM = 'refresh-resources';

class FakeStreamSocket {
  readonly OPEN = 1;
  readyState = 1;
  onopen: ((event?: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly sent: StreamFrame[] = [];
  readonly close = vi.fn();
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  send(frame: StreamFrame): void {
    this.sent.push(frame);
  }

  deliver(frame: StreamFrame): void {
    this.onmessage?.(new MessageEvent('message', { data: frame }));
  }
}

const sockets: FakeStreamSocket[] = [];

/** Routes @wailsio/runtime JSONStream (see vitest.setup.ts) to fake sockets. */
export const installFakeStreamSockets = (): void => {
  (
    globalThis as typeof globalThis & { __wailsJSONStreamFactory?: (name: string) => unknown }
  ).__wailsJSONStreamFactory = (name: string) => {
    const socket = new FakeStreamSocket(name);
    sockets.push(socket);
    // The real socket opens asynchronously; opening on the next microtask keeps
    // the connection's queued-until-open path in play.
    queueMicrotask(() => socket.onopen?.(new Event('open')));
    return socket;
  };
};

const resourceSockets = (): FakeStreamSocket[] =>
  sockets.filter((socket) => socket.name === RESOURCE_STREAM);

const subscriptionKey = (domain: unknown, scope: unknown): string => `${domain} ${scope}`;

/**
 * The resource-stream subscriptions currently open, as `"<domain> <scope>"`,
 * replayed from every REQUEST and CANCEL frame the client has sent.
 */
export const activeStreamSubscriptions = (): string[] => {
  const active = new Set<string>();
  resourceSockets().forEach((socket) => {
    socket.sent.forEach((frame) => {
      const key = subscriptionKey(frame.domain, frame.scope);
      if (frame.type === 'REQUEST') {
        active.add(key);
      } else if (frame.type === 'CANCEL') {
        active.delete(key);
      }
    });
  });
  return Array.from(active).sort(compareUtf16Strings);
};

export const streamKey = (domain: RefreshDomain, scope: string): string =>
  subscriptionKey(domain, scope);

const deliverToResourceStream = (frame: StreamFrame): void => {
  const open = resourceSockets();
  const socket = open[open.length - 1];
  if (!socket) {
    throw new Error('No resource stream socket is open');
  }
  socket.deliver(frame);
};

const wireIdentity = (domain: RefreshDomain, scope: string) => {
  const { clusterId, selector } = parseRefreshScope(domain, scope);
  return { clusterId, domain, scope: encodeScopeSelector(selector) };
};

/** The server acknowledges a subscription, making a quiet stream healthy. */
export const acknowledgeStream = (domain: RefreshDomain, scope: string): void => {
  deliverToResourceStream({ type: 'ACK', ...wireIdentity(domain, scope) });
};

/** The server rings a declared source clock for a subscribed scope. */
export const ringStream = (
  domain: RefreshDomain,
  scope: string,
  source: string,
  version: string
): void => {
  deliverToResourceStream({
    type: 'MODIFIED',
    ...wireIdentity(domain, scope),
    source,
    signal: 'changed',
    version,
  });
};

/** Lets the cluster's backend serve requests (lifecycle `ready`). */
export const markClusterReady = (clusterId: string): void => {
  eventBus.emit('cluster:lifecycle', { clusterId, state: 'ready' });
};

/** Mirrors the app's auto-refresh toggle: the preference and its change event. */
export const setAutoRefresh = (enabled: boolean): void => {
  setAppPreferencesForTesting({ autoRefreshEnabled: enabled });
  eventBus.emit('settings:auto-refresh', enabled);
};

/**
 * Settles queued promise continuations without advancing timers: ten chained
 * steps, each one microtask turn.
 */
export const flushRefreshWork = (): Promise<void> =>
  Array.from({ length: 10 }).reduce<Promise<void>>(
    (settled) => settled.then(() => undefined),
    Promise.resolve()
  );

/** Tears down every scope, stream, and runtime the previous test created. */
export const resetRefreshHarness = (): void => {
  eventBus.emit('kubeconfig:changing', '');
  refreshOrchestrator.setConnectedClusters([]);
  clusterReadiness.resetForTests();
  sockets.forEach((socket) => {
    socket.sent.length = 0;
  });
};
