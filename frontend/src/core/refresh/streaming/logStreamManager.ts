/**
 * frontend/src/core/refresh/streaming/logStreamManager.ts
 *
 * Module source for logStreamManager.
 * Implements logStreamManager logic for the core layer.
 */

import { ensureRefreshBaseURL } from '../client';
import type { SnapshotStats } from '../client';
import { resetScopedDomainState, setScopedDomainState } from '../store';
import type { ObjectLogEntry, ObjectLogsSnapshotPayload, PermissionDeniedStatus } from '../types';
import { isPermissionDeniedStatus, resolvePermissionDeniedMessage } from '../permissionErrors';
import { errorHandler } from '@utils/errorHandler';
import { eventBus } from '@/core/events';
import { getLogBufferMaxSize, LOG_BUFFER_DEFAULT_SIZE } from '@/core/settings/appPreferences';
import { getLogStreamScopeParams } from '@modules/object-panel/components/ObjectPanel/Logs/logStreamScopeParamsCache';

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
  warnings?: string[];
  error?: string;
  errorDetails?: PermissionDeniedStatus;
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

  if (
    obj.warnings !== undefined &&
    (!Array.isArray(obj.warnings) || obj.warnings.some((warning) => typeof warning !== 'string'))
  ) {
    return false;
  }

  if (obj.errorDetails !== undefined && !isPermissionDeniedStatus(obj.errorDetails)) {
    return false;
  }

  // entries must be an array if present
  if (obj.entries !== undefined && !Array.isArray(obj.entries)) {
    return false;
  }

  return true;
}

const DOMAIN_NAME = 'object-logs' as const;

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
      const streamParams = getLogStreamScopeParams(this.scope);
      if (streamParams?.container) {
        url.searchParams.set('container', streamParams.container);
      }
      if (streamParams?.pod) {
        url.searchParams.set('pod', streamParams.pod);
      }
      if (streamParams?.include) {
        url.searchParams.set('include', streamParams.include);
      }
      if (streamParams?.exclude) {
        url.searchParams.set('exclude', streamParams.exclude);
      }

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
  private backendWarnings = new Map<string, string[]>();
  /** Monotonically increasing counter for stable entry keys across buffer truncations. */
  private seqCounter = 0;
  private lastNotifiedErrors = new Map<string, string>();
  private suspendedForVisibility = false;
  private suspendedScopes = new Set<string>();
  /**
   * Maximum entries kept per scope before the front of the buffer is
   * trimmed. User-configurable via the Advanced → Pod Logs setting;
   * initialized from the preference cache and kept in sync via the
   * 'settings:log-buffer-size' event. Starts at the hardcoded default so
   * the manager has a sane value even before appPreferences hydrates (the
   * singleton is constructed at module-load time, before the backend
   * settings round-trip completes).
   */
  private maxBufferSize = LOG_BUFFER_DEFAULT_SIZE;

  constructor() {
    eventBus.on('kubeconfig:changing', () => {
      this.stopAll(true);
    });
    eventBus.on('app:visibility-hidden', () => this.suspendForVisibility());
    eventBus.on('app:visibility-visible', () => this.resumeFromVisibility());
    // Pull the initial value from the preference cache. If hydration
    // hasn't run yet this returns the default; the subsequent hydration
    // will emit 'settings:log-buffer-size' only if the stored value
    // differs, so we converge either way.
    this.maxBufferSize = getLogBufferMaxSize();
    eventBus.on('settings:log-buffer-size', (size) => this.setMaxBufferSize(size));
  }

  /**
   * Apply a new maximum buffer size. If the new size is smaller than an
   * existing buffer, trim the front immediately and push the truncated
   * snapshot to the scoped store so all open LogViewers re-render with
   * the smaller view. Larger values take effect passively — existing
   * buffers grow naturally as new entries arrive.
   */
  private setMaxBufferSize(size: number): void {
    if (size === this.maxBufferSize) {
      return;
    }
    this.maxBufferSize = size;
    for (const [scope, entries] of this.buffers) {
      if (entries.length <= size) {
        continue;
      }
      const trimmed = entries.slice(entries.length - size);
      this.buffers.set(scope, trimmed);
      const previousMeta = this.bufferMeta.get(scope);
      this.bufferMeta.set(scope, {
        total: previousMeta?.total ?? entries.length,
        truncated: true,
      });
      const stats = this.buildStats(scope, trimmed.length);
      setScopedDomainState(DOMAIN_NAME, scope, (previous) => {
        const previousPayload = previous.data ?? DEFAULT_PAYLOAD;
        return {
          ...previous,
          data: {
            ...previousPayload,
            entries: trimmed,
          },
          stats,
          scope,
        };
      });
    }
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
      this.backendWarnings.delete(scope);
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
      _seq: ++this.seqCounter,
    }));

    // Buffer replacement policy:
    // - reset=true with non-empty incoming → replace (server is giving us a
    //   fresh snapshot, use it).
    // - reset=true with empty incoming → PRESERVE. The server emits the
    //   reset flag as part of its "new connection" handshake on every
    //   stream open, before it has had a chance to tail any lines. Wiping
    //   the buffer here used to make auto-refresh toggle and
    //   cluster-switch remount flash the initial-load spinner even when
    //   the client already had plenty of log history cached.
    // - reset=false → append, unchanged.
    const shouldReplace = payload.reset && incoming.length > 0;
    const previousMeta = this.bufferMeta.get(scope);
    let totalItems = shouldReplace ? 0 : (previousMeta?.total ?? existing.length);
    totalItems += incoming.length;

    let nextEntries = shouldReplace
      ? incoming
      : payload.reset
        ? existing
        : existing.concat(incoming);
    let truncated = previousMeta?.truncated ?? false;
    if (nextEntries.length > this.maxBufferSize) {
      truncated = true;
      nextEntries = nextEntries.slice(nextEntries.length - this.maxBufferSize);
    }
    if (totalItems < nextEntries.length) {
      totalItems = nextEntries.length;
    }

    this.buffers.set(scope, nextEntries);
    this.bufferMeta.set(scope, { total: totalItems, truncated });

    const generatedAt = payload.generatedAt || Date.now();
    const payloadSequence = payload.sequence ?? (payload.reset ? 1 : 0);
    const errorMessage = resolvePermissionDeniedMessage(
      payload.error ?? null,
      payload.errorDetails
    );
    const isManual = mode === 'manual';
    if (payload.warnings !== undefined) {
      if (payload.warnings.length > 0) {
        this.backendWarnings.set(scope, payload.warnings);
      } else {
        this.backendWarnings.delete(scope);
      }
    } else if (payload.reset) {
      this.backendWarnings.delete(scope);
    }
    const stats = this.buildStats(scope, nextEntries.length);

    setScopedDomainState(DOMAIN_NAME, scope, (previous) => {
      const previousPayload = previous.data ?? DEFAULT_PAYLOAD;
      const resetCount = payload.reset
        ? previousPayload.resetCount + 1
        : previousPayload.resetCount;

      // Sequence is monotonic per-scope on the client. The server may
      // restart its own per-connection counter on every reconnect, but at
      // the view layer "have we ever received data for this scope" must
      // survive stream restarts — otherwise the initial-load spinner
      // reappears on every reconnect even though the cached entries are
      // still present.
      const nextSequence = Math.max(payloadSequence, previousPayload.sequence ?? 0);

      const nextPayload: ObjectLogsSnapshotPayload = {
        entries: nextEntries,
        sequence: nextSequence,
        generatedAt,
        resetCount,
        error: errorMessage,
      };

      const nextStatus = errorMessage ? 'error' : 'ready';

      return {
        ...previous,
        status: nextStatus,
        data: nextPayload,
        stats,
        error: errorMessage,
        lastUpdated: generatedAt,
        lastAutoRefresh: isManual ? previous.lastAutoRefresh : generatedAt,
        lastManualRefresh: isManual ? generatedAt : previous.lastManualRefresh,
        isManual,
        scope,
      };
    });
    if (errorMessage) {
      this.notifyStreamError(scope, errorMessage);
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
    const warnings = [...(this.backendWarnings.get(scope) ?? [])];
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
