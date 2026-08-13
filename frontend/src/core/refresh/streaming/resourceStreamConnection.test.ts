import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResourceStreamConnection } from './resourceStreamConnection';

const createdSockets: FakeJSONSocket[] = [];

class FakeJSONSocket {
  readonly url: string;
  static OPEN = 1;
  readonly OPEN = 1;
  readyState = FakeJSONSocket.OPEN;
  onopen: ((event?: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(name: string) {
    this.url = name;
    createdSockets.push(this);
  }
}

describe('ResourceStreamConnection', () => {
  beforeEach(() => {
    createdSockets.length = 0;
    if (!globalThis.window) {
      Object.defineProperty(globalThis, 'window', {
        value: {},
        writable: true,
      });
    }
    window.setTimeout = globalThis.setTimeout;
    window.clearTimeout = globalThis.clearTimeout;
    (
      globalThis as typeof globalThis & {
        __wailsJSONStreamFactory?: (name: string) => unknown;
      }
    ).__wailsJSONStreamFactory = (name) => new FakeJSONSocket(name);
    vi.useRealTimers();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__wailsJSONStreamFactory');
    vi.useRealTimers();
  });

  it('connects to the resource stream endpoint and forwards messages', async () => {
    const delegate = {
      handleConnectionOpen: vi.fn(),
      handleMessage: vi.fn(),
      handleConnectionError: vi.fn(),
    };
    const connection = new ResourceStreamConnection(delegate);

    await connection.connect();

    const socket = createdSockets[0];
    expect(socket.url).toBe('refresh-resources');
    socket.onopen?.(new Event('open'));
    socket.onmessage?.({ data: { type: 'HEARTBEAT' } } as MessageEvent);

    expect(delegate.handleConnectionOpen).toHaveBeenCalledWith('');
    expect(delegate.handleMessage).toHaveBeenCalledWith('', { type: 'HEARTBEAT' });
  });

  it('queues outbound messages until the socket is available', async () => {
    const delegate = {
      handleConnectionOpen: vi.fn(),
      handleMessage: vi.fn(),
      handleConnectionError: vi.fn(),
    };
    const connection = new ResourceStreamConnection(delegate);

    connection.send({
      type: 'REQUEST',
      clusterId: 'cluster-a',
      domain: 'pods',
      scope: 'cluster-a|namespace:default',
    });
    await connection.connect();

    const socket = createdSockets[0];
    socket.onopen?.(new Event('open'));

    expect(socket.send).toHaveBeenCalledWith({
      type: 'REQUEST',
      clusterId: 'cluster-a',
      domain: 'pods',
      scope: 'cluster-a|namespace:default',
    });
  });

  it('reconnects the stable named stream after socket close', async () => {
    vi.useFakeTimers();
    window.setTimeout = globalThis.setTimeout;
    window.clearTimeout = globalThis.clearTimeout;
    const delegate = {
      handleConnectionOpen: vi.fn(),
      handleMessage: vi.fn(),
      handleConnectionError: vi.fn(),
    };
    const connection = new ResourceStreamConnection(delegate);

    await connection.connect();
    createdSockets[0].onclose?.();
    await Promise.resolve();

    expect(delegate.handleConnectionError).toHaveBeenCalledWith(
      '',
      'Resource stream connection closed'
    );

    vi.advanceTimersByTime(1500);
    await Promise.resolve();

    expect(createdSockets[1]).toBeDefined();
  });
});
