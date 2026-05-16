import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureRefreshBaseURLMock = vi.hoisted(() => vi.fn(async () => 'http://127.0.0.1:0'));
const invalidateRefreshBaseURLMock = vi.hoisted(() => vi.fn());

vi.mock('../client', () => ({
  ensureRefreshBaseURL: ensureRefreshBaseURLMock,
  invalidateRefreshBaseURL: invalidateRefreshBaseURLMock,
}));

import { ResourceStreamConnection } from './resourceStreamConnection';

const createdSockets: FakeWebSocket[] = [];

class FakeWebSocket {
  static OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  onopen: ((event?: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(readonly url: string) {
    createdSockets.push(this);
  }
}

describe('ResourceStreamConnection', () => {
  beforeEach(() => {
    ensureRefreshBaseURLMock.mockReset();
    ensureRefreshBaseURLMock.mockResolvedValue('http://127.0.0.1:0');
    invalidateRefreshBaseURLMock.mockReset();
    createdSockets.length = 0;
    if (!globalThis.window) {
      Object.defineProperty(globalThis, 'window', {
        value: {},
        writable: true,
      });
    }
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    (globalThis as any).WebSocket = FakeWebSocket;
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
    expect(socket.url).toBe('ws://127.0.0.1:0/api/v2/stream/resources');
    socket.onopen?.(new Event('open'));
    socket.onmessage?.({ data: '{"type":"HEARTBEAT"}' } as MessageEvent);

    expect(delegate.handleConnectionOpen).toHaveBeenCalledWith('');
    expect(delegate.handleMessage).toHaveBeenCalledWith('', '{"type":"HEARTBEAT"}');
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

    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'REQUEST',
        clusterId: 'cluster-a',
        domain: 'pods',
        scope: 'cluster-a|namespace:default',
      })
    );
  });

  it('invalidates the base URL and reconnects after socket close', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const delegate = {
      handleConnectionOpen: vi.fn(),
      handleMessage: vi.fn(),
      handleConnectionError: vi.fn(),
    };
    const connection = new ResourceStreamConnection(delegate);

    await connection.connect();
    createdSockets[0].onclose?.();
    await Promise.resolve();

    expect(invalidateRefreshBaseURLMock).toHaveBeenCalled();
    expect(delegate.handleConnectionError).toHaveBeenCalledWith(
      '',
      'Resource stream connection closed'
    );

    vi.advanceTimersByTime(1500);
    await Promise.resolve();

    expect(createdSockets[1]).toBeDefined();
  });
});
