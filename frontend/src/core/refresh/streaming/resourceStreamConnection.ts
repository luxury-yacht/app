import { type JSONSocket, JSONStream } from '@wailsio/runtime';
import type { ResourceStreamClientMessage as ResourceStreamWireClientMessage } from '../types';
import type { DoorbellDomain } from './resourceStreamDomains';
import { streamReconnectDelay } from './streamTiming';

const RESOURCE_STREAM_NAME = 'refresh-resources';
const RECONNECT_JITTER_FACTOR = 0.2;

export type ResourceStreamClientMessage = Omit<
  ResourceStreamWireClientMessage,
  'type' | 'domain' | 'scope'
> & {
  type: Extract<ResourceStreamWireClientMessage['type'], 'REQUEST' | 'CANCEL'>;
  clusterId?: string;
  domain: DoorbellDomain;
  scope: string;
};

export type ResourceStreamConnectionDelegate = {
  handleConnectionOpen(clusterId: string): void;
  handleMessage(clusterId: string, message: unknown): void;
  handleConnectionError(clusterId: string, message: string): void;
};

export class ResourceStreamConnection {
  private readonly delegate: ResourceStreamConnectionDelegate;
  private socket: JSONSocket | null = null;
  private attempt = 0;
  private closed = false;
  private paused = false;
  private reconnectTimer: number | null = null;
  private pendingMessages: ResourceStreamClientMessage[] = [];

  constructor(delegate: ResourceStreamConnectionDelegate) {
    this.delegate = delegate;
  }

  async connect(): Promise<void> {
    if (this.closed || this.paused || typeof window === 'undefined') {
      return;
    }
    try {
      if (this.closed || this.paused) {
        return;
      }
      const socket = JSONStream(RESOURCE_STREAM_NAME);
      this.socket = socket;
      socket.onopen = () => this.handleOpen();
      socket.onmessage = (event) => this.handleMessage(event);
      socket.onerror = () => this.handleError('Resource stream connection error');
      socket.onclose = () => this.handleClose('Resource stream connection closed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open resource stream';
      this.handleError(message);
      this.scheduleReconnect();
    }
  }

  pause(): void {
    this.paused = true;
    this.clearReconnect();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.closed = false;
    void this.connect();
  }

  close(): void {
    this.closed = true;
    this.clearReconnect();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  send(message: ResourceStreamClientMessage): void {
    if (this.socket && this.socket.readyState === this.socket.OPEN) {
      this.socket.send(message);
      return;
    }
    this.pendingMessages.push(message);
  }

  private handleOpen(): void {
    this.attempt = 0;
    this.delegate.handleConnectionOpen('');
    const pending = [...this.pendingMessages];
    this.pendingMessages = [];
    pending.forEach((message) => {
      this.send(message);
    });
  }

  private handleMessage(event: MessageEvent): void {
    this.delegate.handleMessage('', event.data);
  }

  private handleError(message: string): void {
    if (this.closed || this.paused) {
      return;
    }
    this.delegate.handleConnectionError('', message);
    this.scheduleReconnect();
  }

  private handleClose(message: string): void {
    if (this.closed || this.paused) {
      return;
    }
    this.delegate.handleConnectionError('', message);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.paused) {
      return;
    }
    this.clearReconnect();
    const delay = streamReconnectDelay(this.attempt, {
      jitterFactor: RECONNECT_JITTER_FACTOR,
      round: true,
    });
    this.attempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
