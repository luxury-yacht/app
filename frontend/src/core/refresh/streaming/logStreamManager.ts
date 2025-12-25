/**
 * frontend/src/core/refresh/streaming/logStreamManager.ts
 *
 * Module source for logStreamManager.
 * Implements logStreamManager logic for the core layer.
 */

import { ensureRefreshBaseURL } from '../client';
import type { SnapshotStats } from '../client';
import { resetScopedDomainState, setScopedDomainState } from '../store';
import type { ObjectLogEntry, ObjectLogsSnapshotPayload } from '../types';
import { errorHandler } from '@utils/errorHandler';
import { eventBus } from '@/core/events';

type StreamMode = 'stream' | 'manual';

interface StreamEventPayload {
  domain: string;
  scope: string;
  sequence: number;
  generatedAt: number;
  reset?: boolean;
  entries?: Array<{
    timestamp?: string;
    pod?: string;
    container?: string;
    line?: string;
    isInit?: boolean;
  }>;
  error?: string;
}

function isValidLogStreamPayload(data: unknown): data is StreamEventPayload {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  // Required fields
  if (typeof obj.domain !== 'string' || typeof obj.scope !== 'string') {
    return false;
  }

  // sequence and generatedAt should be numbers
  if (typeof obj.sequence !== 'number' || typeof obj.generatedAt !== 'number') {
    return false;
  }

  // Optional fields type checks
  if (obj.reset !== undefined && typeof obj.reset !== 'boolean') {
    return false;
  }

  if (obj.error !== undefined && typeof obj.error !== 'string') {
    return false;
  }

  // entries must be an array if present
  if (obj.entries !== undefined && !Array.isArray(obj.entries)) {
    return false;
  }

  return true;
}

const DOMAIN_NAME = 'object-logs' as const;
const MAX_BUFFER_SIZE = 1000;

const DEFAULT_PAYLOAD: ObjectLogsSnapshotPayload = {
  entries: [],
  sequence: 0,
  generatedAt: 0,
  resetCount: 0,
  error: null,
};

class LogStreamConnection {
  private eventSource: EventSource | null = null;
  private retryTimer: number | null = null;
  private closed = false;
  private attempt = 0;

  constructor(
    private readonly scope: string,
    private readonly mode: StreamMode,
    private readonly manager: LogStreamManager,
    private readonly resolve?: () => void,
    private readonly reject?: (error: Error) => void
  ) {}

  async start(): Promise<void> {
    this.closed = false;
    this.attempt = 0;
    await this.openStream();
  }

  stop(intentional = true): void {
    this.closed = true;
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.removeEventListener('log', this.handleLogEvent as EventListener);
      this.eventSource.removeEventListener('error', this.handleError as EventListener);
      this.eventSource.close();
      this.eventSource = null;
    }
    if (intentional) {
      this.manager.markIdle(this.scope);
    }
  }

  private async openStream(): Promise<void> {
    try {
      const baseURL = await ensureRefreshBaseURL();
      if (this.closed) {
        return;
      }
      const url = new URL('/api/v2/stream/logs', baseURL);
      url.searchParams.set('scope', this.scope);

      const eventSource = new EventSource(url.toString());
      this.eventSource = eventSource;
      eventSource.addEventListener('log', this.handleLogEvent as EventListener);
      eventSource.addEventListener('error', this.handleError as EventListener);
      this.manager.markConnected(this.scope);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open log stream';
      this.manager.handleStreamError(this.scope, message);
      if (this.mode === 'manual') {
        this.reject?.(new Error(message));
        this.stop(false);
        return;
      }
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.mode === 'manual') {
      return;
    }
    const delay = Math.min(30_000, 1000 * Math.pow(2, this.attempt));
    this.attempt += 1;
    this.manager.handleStreamError(
      this.scope,
      `Log stream disconnected. Reconnecting in ${Math.round(delay / 1000)}s`
    );
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void this.openStream();
    }, delay);
  }

  private handleLogEvent = (event: MessageEvent) => {
    if (this.closed) {
      return;
    }

    try {
      const parsed: unknown = JSON.parse(event.data);
      if (!isValidLogStreamPayload(parsed)) {
        console.error('Invalid log stream payload structure');
        return;
      }
      if (parsed.scope !== this.scope || parsed.domain !== DOMAIN_NAME) {
        return;
      }
      this.manager.applyPayload(this.scope, parsed, this.mode);

      if (this.mode === 'manual' && parsed.reset) {
        this.resolve?.();
        this.stop(false);
      }
    } catch (error) {
      console.error('Failed to parse log stream payload', error);
    }
  };

  private handleError = () => {
    if (this.closed) {
      return;
    }

    const message = 'Log stream connection lost';
    this.manager.handleStreamError(this.scope, message);

    if (this.mode === 'manual') {
      this.reject?.(new Error(message));
      this.stop(false);
      return;
    }

    this.scheduleReconnect();
  };
}

export class LogStreamManager {
  private connections = new Map<string, LogStreamConnection>();
  private buffers = new Map<string, ObjectLogEntry[]>();
  private bufferMeta = new Map<string, { total: number; truncated: boolean }>();
  private lastNotifiedErrors = new Map<string, string>();
  private suspendedForVisibility = false;
  private suspendedScopes = new Set<string>();

  constructor() {
    eventBus.on('kubeconfig:changing', () => {
      this.stopAll(true);
    });
    eventBus.on('app:visibility-hidden', () => this.suspendForVisibility());
    eventBus.on('app:visibility-visible', () => this.resumeFromVisibility());
  }

  private suspendForVisibility(): void {
    if (this.suspendedForVisibility) {
      return;
    }
    this.suspendedForVisibility = true;

    // Store active scopes and stop connections without resetting data
    for (const [scope, connection] of this.connections) {
      this.suspendedScopes.add(scope);
      connection.stop(true);
    }
    this.connections.clear();
  }

  private resumeFromVisibility(): void {
    if (!this.suspendedForVisibility) {
      return;
    }
    this.suspendedForVisibility = false;

    // Restore streams that were active
    for (const scope of this.suspendedScopes) {
      void this.startStream(scope);
    }
    this.suspendedScopes.clear();
  }

  async startStream(scope: string): Promise<void> {
    this.stop(scope, false);
    this.setLoading(scope, false);
    const connection = new LogStreamConnection(scope, 'stream', this);
    this.connections.set(scope, connection);
    await connection.start();
  }

  stop(scope: string, reset = false): void {
    const connection = this.connections.get(scope);
    if (connection) {
      connection.stop(true);
      this.connections.delete(scope);
    }
    if (reset) {
      this.buffers.delete(scope);
      this.bufferMeta.delete(scope);
      resetScopedDomainState(DOMAIN_NAME, scope);
    } else {
      this.markIdle(scope);
    }
  }

  async refreshOnce(scope: string): Promise<void> {
    this.stop(scope, false);
    this.setLoading(scope, true);
    return new Promise<void>((resolve, reject) => {
      const connection = new LogStreamConnection(
        scope,
        'manual',
        this,
        () => {
          this.markManualCompleted(scope);
          resolve();
        },
        (error) => {
          this.handleStreamError(scope, error.message);
          reject(error);
        }
      );
      this.connections.set(scope, connection);
      void connection.start();
    }).finally(() => {
      this.connections.delete(scope);
    });
  }

  stopAll(reset = false): void {
    const scopes = Array.from(this.connections.keys());
    scopes.forEach((scope) => this.stop(scope, reset));
    if (reset) {
      this.buffers.clear();
      this.bufferMeta.clear();
    }
  }

  applyPayload(scope: string, payload: StreamEventPayload, mode: StreamMode): void {
    const existing = this.buffers.get(scope) ?? [];
    const incoming: ObjectLogEntry[] = (payload.entries ?? []).map((entry) => ({
      timestamp: entry.timestamp ?? '',
      pod: entry.pod ?? '',
      container: entry.container ?? '',
      line: entry.line ?? '',
      isInit: Boolean(entry.isInit),
    }));

    const previousMeta = this.bufferMeta.get(scope);
    let totalItems = payload.reset ? 0 : (previousMeta?.total ?? existing.length);
    totalItems += incoming.length;

    let nextEntries = payload.reset ? incoming : existing.concat(incoming);
    let truncated = previousMeta?.truncated ?? false;
    if (nextEntries.length > MAX_BUFFER_SIZE) {
      truncated = true;
      nextEntries = nextEntries.slice(nextEntries.length - MAX_BUFFER_SIZE);
    }
    if (totalItems < nextEntries.length) {
      totalItems = nextEntries.length;
    }

    this.buffers.set(scope, nextEntries);
    this.bufferMeta.set(scope, { total: totalItems, truncated });

    const generatedAt = payload.generatedAt || Date.now();
    const sequence = payload.sequence ?? (payload.reset ? 1 : 0);
    const isManual = mode === 'manual';
    const stats = this.buildStats(scope, nextEntries.length);

    setScopedDomainState(DOMAIN_NAME, scope, (previous) => {
      const previousPayload = previous.data ?? DEFAULT_PAYLOAD;
      const resetCount = payload.reset
        ? previousPayload.resetCount + 1
        : previousPayload.resetCount;

      const nextPayload: ObjectLogsSnapshotPayload = {
        entries: nextEntries,
        sequence: sequence || previousPayload.sequence,
        generatedAt,
        resetCount,
        error: payload.error ?? null,
      };

      const nextStatus = payload.error ? 'error' : 'ready';

      return {
        ...previous,
        status: nextStatus,
        data: nextPayload,
        stats,
        error: payload.error ?? null,
        lastUpdated: generatedAt,
        lastAutoRefresh: isManual ? previous.lastAutoRefresh : generatedAt,
        lastManualRefresh: isManual ? generatedAt : previous.lastManualRefresh,
        isManual,
        scope,
      };
    });
    if (payload.error) {
      this.notifyStreamError(scope, payload.error);
    } else {
      this.clearStreamError(scope);
    }
  }

  handleStreamError(scope: string, message: string): void {
    setScopedDomainState(DOMAIN_NAME, scope, (previous) => ({
      ...previous,
      status: 'error',
      error: message,
    }));
    this.notifyStreamError(scope, message);
  }

  markIdle(scope: string): void {
    setScopedDomainState(DOMAIN_NAME, scope, (previous) => ({
      ...previous,
      status: previous.status === 'ready' ? 'ready' : 'idle',
      stats: this.buildStats(scope, (this.buffers.get(scope) ?? []).length),
      scope,
    }));
    this.clearStreamError(scope);
  }

  markConnected(scope: string): void {
    setScopedDomainState(DOMAIN_NAME, scope, (previous) => ({
      ...previous,
      status: previous.data ? 'updating' : 'loading',
      error: null,
      stats: this.buildStats(scope, (this.buffers.get(scope) ?? []).length),
      scope,
    }));
    this.clearStreamError(scope);
  }

  markManualCompleted(scope: string): void {
    setScopedDomainState(DOMAIN_NAME, scope, (previous) => ({
      ...previous,
      scope,
    }));
    this.clearStreamError(scope);
  }

  private setLoading(scope: string, isManual: boolean): void {
    setScopedDomainState(DOMAIN_NAME, scope, (previous) => ({
      ...previous,
      status: previous.data ? 'updating' : 'loading',
      error: null,
      isManual,
      stats: this.buildStats(scope, (this.buffers.get(scope) ?? []).length),
      scope,
    }));
    this.clearStreamError(scope);
  }

  private getNotificationKey(scope: string): string {
    return scope || '__global__';
  }

  private notifyStreamError(scope: string, message: string): void {
    const key = this.getNotificationKey(scope);
    if (this.lastNotifiedErrors.get(key) === message) {
      return;
    }
    this.lastNotifiedErrors.set(key, message);
    errorHandler.handle(new Error(message), {
      source: 'refresh-log-stream',
      domain: DOMAIN_NAME,
      scope: scope || 'global',
    });
  }

  private clearStreamError(scope: string): void {
    const key = this.getNotificationKey(scope);
    if (this.lastNotifiedErrors.has(key)) {
      this.lastNotifiedErrors.delete(key);
    }
  }

  private buildStats(scope: string, count: number): SnapshotStats | null {
    const meta = this.bufferMeta.get(scope);
    const total = meta?.total ?? count;
    const truncated = meta?.truncated ?? false;
    const warnings: string[] = [];
    if (truncated && total > count) {
      warnings.push(`Showing most recent ${count} of ${total} log entries`);
    }
    return {
      itemCount: count,
      buildDurationMs: 0,
      totalItems: truncated || total !== count ? total : undefined,
      truncated,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}

export const logStreamManager = new LogStreamManager();
