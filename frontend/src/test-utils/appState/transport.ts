/**
 * frontend/src/test-utils/appState/transport.ts
 *
 * Fakes of the app's external boundary only: Wails RPC (`Call.ByName`), runtime
 * events, window identity, named JSON streams, and the refresh HTTP API. Every
 * app module above them runs for real. The global `@wailsio/runtime` mock in
 * vitest.setup.ts supplies the functions these fakes drive.
 */

import { Call, Events, Window as WailsWindow } from '@wailsio/runtime';
import { vi } from 'vitest';
import type * as BackendApi from '@/core/backend-api';
import { makeTelemetrySummary } from '@/core/refresh/refreshContractTestBuilders';
import { encodeScopeSelector, parseRefreshScope } from '@/core/refresh/scopeSelector';
import type {
  DomainPayloadMap,
  ErrorStatus,
  RefreshDomain,
  TelemetrySummary,
} from '@/core/refresh/types';
import { compareUtf16Strings } from '@/shared/utils/sort';

// ---------------------------------------------------------------------------
// RPC

const RPC_PREFIX = 'github.com/luxury-yacht/app/backend.DesktopService.';

type Api = typeof BackendApi;
type AnyMethod = (...args: never[]) => unknown;

export type BackendMethod = {
  [K in keyof Api]: Api[K] extends AnyMethod ? K : never;
}[keyof Api];
type Method<K extends BackendMethod> = Extract<Api[K], AnyMethod>;
export type BackendArgs<K extends BackendMethod> = Parameters<Method<K>>;
export type BackendResult<K extends BackendMethod> = Awaited<ReturnType<Method<K>>>;
export type BackendHandler<K extends BackendMethod> = (
  ...args: BackendArgs<K>
) => BackendResult<K> | Promise<BackendResult<K>>;

type UntypedHandler = (...args: unknown[]) => unknown;

export interface FakeBackend {
  /** Answers every later call of `method`; replaces an earlier answer. */
  answer<K extends BackendMethod>(method: K, handler: BackendHandler<K>): void;
  /** The argument lists of every call of `method`, in call order. */
  calls<K extends BackendMethod>(method: K): BackendArgs<K>[];
  /**
   * Parks every call of `method` until the returned release runs, then answers
   * each with the handler in place now, so a held call keeps the fake's
   * semantics. Lets a test observe the app while that call is in flight. An
   * answer given during the hold answers the calls made after it.
   */
  hold<K extends BackendMethod>(method: K): () => void;
  /** Methods the app called that no handler answered. */
  unfaked(): string[];
}

// Answers a held call with `handler` once its hold releases.
const answerHeldCall =
  (
    handler: UntypedHandler,
    args: unknown[],
    resolve: (value: unknown) => void,
    reject: (reason: unknown) => void
  ) =>
  () => {
    Promise.resolve()
      .then(() => handler(...args))
      .then(resolve, reject);
  };

const createFakeBackend = () => {
  const handlers = new Map<string, UntypedHandler>();
  const callsByMethod = new Map<string, unknown[][]>();
  const unfaked: string[] = [];

  const backend: FakeBackend = {
    answer(method, handler) {
      handlers.set(method, handler as UntypedHandler);
    },
    calls(method) {
      return (callsByMethod.get(method) ?? []) as BackendArgs<typeof method>[];
    },
    hold(method) {
      const handler = handlers.get(method);
      if (!handler) {
        throw new Error(`Answer ${method} before holding it`);
      }
      const parked: Array<() => void> = [];
      const park: UntypedHandler = (...args) =>
        new Promise((resolve, reject) => {
          parked.push(answerHeldCall(handler, args, resolve, reject));
        });
      handlers.set(method, park);
      return () => {
        // An answer given during the hold stays in place for later calls.
        if (handlers.get(method) === park) {
          handlers.set(method, handler);
        }
        parked.splice(0).forEach((answer) => {
          answer();
        });
      };
    },
    unfaked: () => [...unfaked],
  };

  // The call is recorded and its handler runs at once; a missing handler or a
  // throw rejects, as a failed RPC does.
  const dispatch = (name: string, args: unknown[]): Promise<unknown> => {
    const method = name.startsWith(RPC_PREFIX) ? name.slice(RPC_PREFIX.length) : name;
    callsByMethod.set(method, [...(callsByMethod.get(method) ?? []), args]);
    const handler = handlers.get(method);
    if (!handler) {
      unfaked.push(method);
      return Promise.reject(new Error(`Unfaked RPC: ${method}`));
    }
    try {
      return Promise.resolve(handler(...args));
    } catch (error) {
      return Promise.reject(error);
    }
  };

  return { backend, dispatch };
};

// ---------------------------------------------------------------------------
// Runtime events

type RuntimeListener = (event: { name: string; data: unknown; sender?: string }) => void;

export interface FakeRuntimeEvents {
  /**
   * Delivers a backend event. `sender` addresses one window; omit it for a
   * broadcast.
   */
  emit(name: string, data?: unknown, options?: { sender?: string }): void;
  /** Payloads the app emitted with `Events.Emit`, per event name. */
  emitted(name: string): unknown[];
  listenerCount(name: string): number;
}

const createFakeRuntimeEvents = () => {
  const listeners = new Map<string, RuntimeListener[]>();
  const emittedByName = new Map<string, unknown[]>();

  const on = (name: string, callback: RuntimeListener) => {
    listeners.set(name, [...(listeners.get(name) ?? []), callback]);
    return () => {
      listeners.set(
        name,
        (listeners.get(name) ?? []).filter((listener) => listener !== callback)
      );
    };
  };

  const appEmit = (name: string, data?: unknown) => {
    emittedByName.set(name, [...(emittedByName.get(name) ?? []), data]);
    return Promise.resolve(false);
  };

  const events: FakeRuntimeEvents = {
    emit(name, data, options) {
      (listeners.get(name) ?? []).forEach((listener) => {
        listener({ name, data, sender: options?.sender });
      });
    },
    emitted: (name) => [...(emittedByName.get(name) ?? [])],
    listenerCount: (name) => listeners.get(name)?.length ?? 0,
  };

  return { events, on, appEmit };
};

// ---------------------------------------------------------------------------
// Named JSON streams (refresh resource streams)

type StreamFrame = Record<string, unknown>;

const RESOURCE_STREAM = 'refresh-resources';

class FakeStreamSocket {
  readonly OPEN = 1;
  /** When set, the server acknowledges every subscription it receives. */
  autoAcknowledge = false;
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
    if (this.autoAcknowledge && frame.type === 'REQUEST') {
      const { clusterId, domain, scope } = frame;
      queueMicrotask(() => this.deliver({ type: 'ACK', clusterId, domain, scope }));
    }
  }

  deliver(frame: StreamFrame): void {
    this.onmessage?.(new MessageEvent('message', { data: frame }));
  }
}

/**
 * `auto`: the server acknowledges each subscription, as the backend does.
 * `manual`: tests acknowledge, to drive stream-health transitions themselves.
 */
export type StreamAcknowledgement = 'auto' | 'manual';

const subscriptionKey = (domain: unknown, scope: unknown): string => `${domain} ${scope}`;

export const streamKey = (domain: RefreshDomain, scope: string): string =>
  subscriptionKey(domain, scope);

const wireIdentity = (domain: RefreshDomain, scope: string) => {
  const { clusterId, selector } = parseRefreshScope(domain, scope);
  return { clusterId, domain, scope: encodeScopeSelector(selector) };
};

export interface FakeStreams {
  /**
   * The resource-stream subscriptions currently open, as `"<domain> <scope>"`,
   * replayed from every REQUEST and CANCEL frame the client has sent.
   */
  active(): string[];
  /** Every REQUEST frame the client has sent, in order. */
  requests(): StreamFrame[];
  /** The server acknowledges a subscription, making a quiet stream healthy. */
  acknowledge(domain: RefreshDomain, scope: string): void;
  /** The server rings a declared source clock for a subscribed scope. */
  ring(domain: RefreshDomain, scope: string, source: string, version: string): void;
}

const createFakeStreams = (acknowledge: StreamAcknowledgement) => {
  const sockets: FakeStreamSocket[] = [];
  const resourceSockets = () => sockets.filter((socket) => socket.name === RESOURCE_STREAM);
  const frames = () => resourceSockets().flatMap((socket) => socket.sent);

  const deliver = (frame: StreamFrame) => {
    const open = resourceSockets();
    const socket = open[open.length - 1];
    if (!socket) {
      throw new Error('No resource stream socket is open');
    }
    socket.deliver(frame);
  };

  const factory = (name: string) => {
    const socket = new FakeStreamSocket(name);
    socket.autoAcknowledge = acknowledge === 'auto';
    sockets.push(socket);
    // The real socket opens asynchronously; opening on the next microtask keeps
    // the connection's queued-until-open path in play.
    queueMicrotask(() => socket.onopen?.(new Event('open')));
    return socket;
  };

  const streams: FakeStreams = {
    active() {
      const active = new Set<string>();
      frames().forEach((frame) => {
        const key = subscriptionKey(frame.domain, frame.scope);
        if (frame.type === 'REQUEST') {
          active.add(key);
        } else if (frame.type === 'CANCEL') {
          active.delete(key);
        }
      });
      return Array.from(active).sort(compareUtf16Strings);
    },
    requests: () => frames().filter((frame) => frame.type === 'REQUEST'),
    acknowledge(domain, scope) {
      deliver({ type: 'ACK', ...wireIdentity(domain, scope) });
    },
    ring(domain, scope, source, version) {
      deliver({
        type: 'MODIFIED',
        ...wireIdentity(domain, scope),
        source,
        signal: 'changed',
        version,
      });
    },
  };

  return { streams, factory };
};

// ---------------------------------------------------------------------------
// Refresh HTTP API (/api/v2)

interface SnapshotRead {
  domain: string;
  scope: string;
  served: boolean;
}

/** One snapshot read as the backend receives it. */
export interface SnapshotRequest {
  domain: string;
  scope: string;
  headers: Headers;
  signal: AbortSignal | null;
}

/**
 * Answers a snapshot read the way the backend would, or returns undefined to
 * fall through to what `serve`/`fail` declared.
 */
export type SnapshotResponder = (
  request: SnapshotRequest
) => Response | undefined | Promise<Response | undefined>;

/** Returns the payload to answer a snapshot read with, or undefined to pass. */
export type SnapshotAnswer = (request: { domain: string; scope: string }) => unknown;

export interface FakeSnapshotServer {
  /** Serves `payload` for later reads of `(domain, scope)` as a new version. */
  serve<D extends keyof DomainPayloadMap>(
    domain: D,
    scope: string,
    payload: DomainPayloadMap[D],
    itemCount?: number
  ): void;
  /** Answers later reads of `(domain, scope)` with the backend's typed failure. */
  fail(domain: RefreshDomain, scope: string, status: ErrorStatus): void;
  /** Answers every later read first; `null` removes the responder. */
  respond(responder: SnapshotResponder | null): void;
  /**
   * Answers the reads `answer` returns a payload for, as a new version each
   * time. Answers are consulted in the order added, after `respond` and before
   * served payloads. Returns a function that removes the answer.
   */
  answer(answer: SnapshotAnswer): () => void;
  /** Every snapshot read, in order; `served` is false when nothing was served. */
  reads(domain?: RefreshDomain): SnapshotRead[];
  /** Forgets the reads recorded so far. */
  clearReads(): void;
  /** Every non-snapshot request the app sent, as `"<METHOD> <path>"`. */
  requests(): string[];
  /** Sets the refresh telemetry later polls read (default: an empty summary). */
  telemetry(summary: TelemetrySummary): void;
  /**
   * Later telemetry reads fail the way an unreachable refresh server does
   * (the backend's handler itself always answers), until `telemetry` is
   * called again.
   */
  failTelemetry(): void;
}

type ServedSnapshot =
  | { kind: 'payload'; version: number; payload: unknown; itemCount: number }
  | { kind: 'failure'; status: ErrorStatus };

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

/** The backend's snapshot envelope for `payload` at `version`. */
export const snapshotResponse = ({
  domain,
  scope,
  version,
  payload,
  itemCount = 1,
}: {
  domain: string;
  scope: string;
  version: number;
  payload: unknown;
  itemCount?: number;
}): Response =>
  json(
    {
      domain,
      scope,
      version,
      checksum: `checksum-${version}`,
      generatedAt: Date.now(),
      sequence: version,
      payload,
      stats: { itemCount, buildDurationMs: 0 },
    },
    { headers: { ETag: `"${domain}:${scope}:${version}"` } }
  );

/** The backend's typed failure response. */
export const statusResponse = (status: ErrorStatus): Response =>
  json(status, { status: status.code });

const createFakeSnapshotServer = () => {
  const served = new Map<string, ServedSnapshot>();
  let reads: SnapshotRead[] = [];
  const otherRequests: string[] = [];
  let responder: SnapshotResponder | null = null;
  const answers: SnapshotAnswer[] = [];
  let sequence = 0;
  let jobSequence = 0;
  // Null while the refresh server is unreachable.
  let telemetry: TelemetrySummary | null = makeTelemetrySummary();

  const declaredResponse = (request: SnapshotRequest): Response => {
    const { domain, scope, headers } = request;
    const entry = served.get(subscriptionKey(domain, scope));
    if (!entry) {
      return new Response(null, { status: 503, statusText: 'No snapshot served' });
    }
    if (entry.kind === 'failure') {
      return statusResponse(entry.status);
    }
    if (headers.get('If-None-Match') === `"${domain}:${scope}:${entry.version}"`) {
      return new Response(null, { status: 304 });
    }
    return snapshotResponse({ domain, scope, ...entry });
  };

  const readSnapshot = async (request: SnapshotRequest): Promise<Response> => {
    const read: SnapshotRead = { domain: request.domain, scope: request.scope, served: true };
    reads.push(read);
    const answered = await responder?.(request);
    if (answered) {
      return answered;
    }
    for (const answer of answers) {
      const payload = answer({ domain: request.domain, scope: request.scope });
      if (payload !== undefined) {
        sequence += 1;
        return snapshotResponse({
          domain: request.domain,
          scope: request.scope,
          version: sequence,
          payload,
        });
      }
    }
    read.served = served.has(subscriptionKey(request.domain, request.scope));
    return declaredResponse(request);
  };

  // Non-snapshot API calls: metrics activity and manual-refresh jobs. Jobs
  // settle at once; the client then reads the snapshot.
  const apiResponse = (pathname: string, method: string): Response | TypeError => {
    otherRequests.push(`${method} ${pathname}`);
    if (pathname === '/api/v2/metrics/active') {
      return new Response(null, { status: 204 });
    }
    if (pathname === '/api/v2/telemetry/summary') {
      // WKWebView's fetch failure (errorStatus.ts BROWSER_FETCH_FAILURES).
      return telemetry ? json(telemetry) : new TypeError('Load failed');
    }
    if (method === 'POST' && /^\/api\/v2\/refresh\/[^/]+$/.test(pathname)) {
      jobSequence += 1;
      return json({ jobId: `job-${jobSequence}`, state: 'succeeded' });
    }
    const job = /^\/api\/v2\/jobs\/([^/]+)$/.exec(pathname);
    if (job?.[1]) {
      return json({ jobId: job[1], state: 'succeeded' });
    }
    return new Response(null, { status: 404, statusText: 'Not faked' });
  };

  const respond = (url: URL, init: RequestInit | undefined): Promise<Response> => {
    const snapshot = /^\/api\/v2\/snapshots\/([^/]+)$/.exec(url.pathname);
    if (!snapshot?.[1]) {
      const answer = apiResponse(url.pathname, init?.method ?? 'GET');
      return answer instanceof Response ? Promise.resolve(answer) : Promise.reject(answer);
    }
    return readSnapshot({
      domain: snapshot[1],
      scope: url.searchParams.get('scope') ?? '',
      headers: new Headers(init?.headers),
      signal: init?.signal ?? null,
    });
  };

  // Like a real fetch, an aborted request rejects with the signal's reason,
  // even while the backend is still holding its answer.
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      String(input instanceof Request ? input.url : input),
      'http://wails.localhost'
    );
    const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    const response = respond(url, init);
    if (!signal) {
      return response;
    }
    return new Promise<Response>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      response.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  };

  const server: FakeSnapshotServer = {
    serve(domain, scope, payload, itemCount = 1) {
      sequence += 1;
      served.set(subscriptionKey(domain, scope), {
        kind: 'payload',
        version: sequence,
        payload,
        itemCount,
      });
    },
    fail(domain, scope, status) {
      served.set(subscriptionKey(domain, scope), { kind: 'failure', status });
    },
    respond(next) {
      responder = next;
    },
    answer(next) {
      answers.push(next);
      return () => {
        const index = answers.indexOf(next);
        if (index >= 0) {
          answers.splice(index, 1);
        }
      };
    },
    reads: (domain) => reads.filter((read) => !domain || read.domain === domain),
    clearReads() {
      reads = [];
    },
    requests: () => [...otherRequests],
    failTelemetry() {
      telemetry = null;
    },
    telemetry(summary) {
      telemetry = summary;
    },
  };

  return { server, fetch };
};

// ---------------------------------------------------------------------------
// Installation

export interface Transport {
  backend: FakeBackend;
  events: FakeRuntimeEvents;
  streams: FakeStreams;
  snapshots: FakeSnapshotServer;
  /** The name `Window.Name()` resolves from now on. */
  setWindowName(name: string): void;
  /** Names of the windows the app focused with `Window.Get(name).Focus()`. */
  focusedWindows(): string[];
  /** Restores every replaced runtime function, `fetch`, and the window marker. */
  uninstall(): void;
}

type WailsGlobals = typeof globalThis & {
  __wailsJSONStreamFactory?: (name: string) => unknown;
  _wails?: { environment?: unknown };
};

type MutableWindowApi = {
  Name?: () => Promise<string>;
  Get?: (name: string) => { Focus: () => Promise<void> };
};
type MutableEventsApi = { Emit?: (name: string, data?: unknown) => Promise<boolean> };

// Stands in for the runtime's handle to a named window (`Window.Get(name)`).
class FakeWindowHandle {
  readonly #name: string;
  readonly #focused: string[];

  constructor(name: string, focused: string[]) {
    this.#name = name;
    this.#focused = focused;
  }

  Focus(): Promise<void> {
    this.#focused.push(this.#name);
    return Promise.resolve();
  }
}

const matchMedia = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList;

/**
 * Installs the boundary fakes. `windowName` is what `Window.Name()` resolves,
 * which bootstrap applies as the window identity.
 */
export const installTransport = (
  windowName: string,
  acknowledge: StreamAcknowledgement = 'auto'
): Transport => {
  const globals = globalThis as WailsGlobals;
  const windowApi = WailsWindow as unknown as MutableWindowApi;
  const eventsApi = Events as unknown as MutableEventsApi;
  const previous = {
    fetch: globalThis.fetch,
    streamFactory: globals.__wailsJSONStreamFactory,
    wails: globals._wails,
    windowName: windowApi.Name,
    getWindow: windowApi.Get,
    emit: eventsApi.Emit,
    matchMedia: Object.getOwnPropertyDescriptor(window, 'matchMedia'),
    scrollIntoView: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView'),
    scrollTo: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo'),
    elementsFromPoint: Object.getOwnPropertyDescriptor(document, 'elementsFromPoint'),
    getClientRects: Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects'),
    getBoundingClientRect: Object.getOwnPropertyDescriptor(
      Range.prototype,
      'getBoundingClientRect'
    ),
  };

  const rpc = createFakeBackend();
  const runtimeEvents = createFakeRuntimeEvents();
  const streams = createFakeStreams(acknowledge);
  const snapshots = createFakeSnapshotServer();

  vi.mocked(Call.ByName).mockImplementation(((name: string, ...args: unknown[]) =>
    rpc.dispatch(name, args)) as unknown as typeof Call.ByName);
  vi.mocked(Events.On).mockImplementation(runtimeEvents.on as unknown as typeof Events.On);
  eventsApi.Emit = runtimeEvents.appEmit;
  let currentWindowName = windowName;
  windowApi.Name = () => Promise.resolve(currentWindowName);
  const focused: string[] = [];
  windowApi.Get = (name) => new FakeWindowHandle(name, focused);
  globals.__wailsJSONStreamFactory = streams.factory;
  // desktopRuntimeAvailable() reads this marker (core/desktop-runtime/index.ts).
  globals._wails = { environment: { OS: 'darwin', Arch: 'arm64', Debug: false } };
  globalThis.fetch = snapshots.fetch as typeof globalThis.fetch;
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia });
  // jsdom has no layout, so it has neither scrollIntoView nor scrollTo; the app
  // scrolls lists to their selection (the sidebar's namespace, Sidebar.tsx) and
  // tables to their top or focused row (useGridTableVirtualization.ts,
  // useGridTableKeyboardNavigation.ts). Scrolling does nothing here.
  for (const method of ['scrollIntoView', 'scrollTo'] as const) {
    Object.defineProperty(Element.prototype, method, {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
  }
  // Nor hit testing: the scrollbar tracker asks what is under the pointer on
  // every move (scrollbarActivity.ts). Nothing is under it here.
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    writable: true,
    value: () => [],
  });
  // Nor text geometry: the editor measures text ranges (CodeMirror). Text has
  // no boxes here.
  const rangeGeometry = {
    getClientRects: () => [],
    getBoundingClientRect: () => new DOMRect(),
  };
  for (const method of ['getClientRects', 'getBoundingClientRect'] as const) {
    Object.defineProperty(Range.prototype, method, {
      configurable: true,
      writable: true,
      value: rangeGeometry[method],
    });
  }

  return {
    backend: rpc.backend,
    events: runtimeEvents.events,
    streams: streams.streams,
    snapshots: snapshots.server,
    setWindowName(name) {
      currentWindowName = name;
    },
    focusedWindows: () => [...focused],
    uninstall() {
      vi.mocked(Call.ByName).mockReset();
      vi.mocked(Events.On).mockReset();
      vi.mocked(Events.On).mockImplementation(
        (() => () => undefined) as unknown as typeof Events.On
      );
      eventsApi.Emit = previous.emit;
      windowApi.Name = previous.windowName;
      windowApi.Get = previous.getWindow;
      globals.__wailsJSONStreamFactory = previous.streamFactory;
      globals._wails = previous.wails;
      globalThis.fetch = previous.fetch;
      if (previous.matchMedia) {
        Object.defineProperty(window, 'matchMedia', previous.matchMedia);
      } else {
        Reflect.deleteProperty(window, 'matchMedia');
      }
      for (const method of ['scrollIntoView', 'scrollTo'] as const) {
        const descriptor = previous[method];
        if (descriptor) {
          Object.defineProperty(Element.prototype, method, descriptor);
        } else {
          Reflect.deleteProperty(Element.prototype, method);
        }
      }
      if (previous.elementsFromPoint) {
        Object.defineProperty(document, 'elementsFromPoint', previous.elementsFromPoint);
      } else {
        Reflect.deleteProperty(document, 'elementsFromPoint');
      }
      for (const method of ['getClientRects', 'getBoundingClientRect'] as const) {
        const descriptor = previous[method];
        if (descriptor) {
          Object.defineProperty(Range.prototype, method, descriptor);
        } else {
          Reflect.deleteProperty(Range.prototype, method);
        }
      }
    },
  };
};
