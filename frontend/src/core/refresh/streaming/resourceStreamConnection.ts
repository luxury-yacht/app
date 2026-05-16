import { ensureRefreshBaseURL, invalidateRefreshBaseURL } from '../client';
import type { ResourceDomain } from './resourceStreamDomains';

const RESOURCE_STREAM_PATH = '/api/v2/stream/resources';
const RECONNECT_JITTER_FACTOR = 0.2;

export type ResourceStreamClientMessage = {
  type: string;
  clusterId?: string;
  domain: ResourceDomain;
  scope: string;
  resourceVersion?: string;
  resumeToken?: string;
};

export type ResourceStreamConnectionDelegate = {
  handleConnectionOpen(clusterId: string): void;
  handleMessage(clusterId: string, raw: string): void;
  handleConnectionError(clusterId: string, message: string): void;
};

export class ResourceStreamConnection {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private closed = false;
  private paused = false;
  private reconnectTimer: number | null = null;
  private pendingMessages: ResourceStreamClientMessage[] = [];

  constructor(private readonly delegate: ResourceStreamConnectionDelegate) {}

  async connect(): Promise<void> {
    if (this.closed || this.paused || typeof window === 'undefined') {
      return;
    }
    try {
      const baseURL = await ensureRefreshBaseURL();
      if (this.closed || this.paused) {
        return;
      }
      const url = new URL(RESOURCE_STREAM_PATH, baseURL);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

      const socket = new WebSocket(url.toString());
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
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    this.pendingMessages.push(message);
  }

  private handleOpen(): void {
    this.attempt = 0;
    this.delegate.handleConnectionOpen('');
    const pending = [...this.pendingMessages];
    this.pendingMessages = [];
    pending.forEach((message) => this.send(message));
  }

  private handleMessage(event: MessageEvent): void {
    this.delegate.handleMessage('', event.data);
  }

  private handleError(message: string): void {
    if (this.closed || this.paused) {
      return;
    }
    // Refresh base URLs can change when the backend rebuilds the refresh subsystem.
    invalidateRefreshBaseURL();
    this.delegate.handleConnectionError('', message);
    this.scheduleReconnect();
  }

  private handleClose(message: string): void {
    if (this.closed || this.paused) {
      return;
    }
    // Force a fresh base URL lookup on reconnect in case the port rotated.
    invalidateRefreshBaseURL();
    this.delegate.handleConnectionError('', message);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.paused) {
      return;
    }
    this.clearReconnect();
    const baseDelay = Math.min(30_000, 1000 * Math.pow(2, this.attempt));
    const jitter = 1 + (Math.random() * 2 - 1) * RECONNECT_JITTER_FACTOR;
    const delay = Math.max(0, Math.round(baseDelay * jitter));
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
