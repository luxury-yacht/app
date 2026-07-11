/**
 * frontend/src/core/refresh/streaming/containerLogsStreamManager.ts
 *
 * Module source for containerLogsStreamManager.
 * Implements containerLogsStreamManager logic for the core layer.
 */

import { getContainerLogsStreamScopeParams } from '@modules/object-panel/components/ObjectPanel/Logs/containerLogsStreamScopeParamsCache';
import { eventBus } from '@/core/events';
import {
  getObjPanelLogsBufferMaxSize,
  OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE,
} from '@/core/settings/appPreferences';
import type { SnapshotStats } from '../client';
import { resolvePermissionDeniedMessage } from '../permissionErrors';
import { resetScopedDomainState, setScopedDomainState } from '../store';
import type {
  ContainerLogsEntry,
  ContainerLogsSnapshotPayload,
  ContainerLogsStreamEventPayload,
} from '../types';
import { closeRefreshEventSource, openRefreshEventSource } from './sseStreamTransport';
import { StreamErrorNotifier } from './streamErrorNotifier';
import { streamReconnectDelay } from './streamTiming';
import { StreamVisibilityController } from './streamVisibilityController';

type StreamMode = 'stream' | 'manual';
type StreamEventPayload = ContainerLogsStreamEventPayload;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isValidPermissionStatus = (value: unknown): boolean => {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value.kind !== 'string' ||
    typeof value.apiVersion !== 'string' ||
    typeof value.message !== 'string' ||
    typeof value.reason !== 'string' ||
    typeof value.code !== 'number'
  ) {
    return false;
  }
  if (value.details === undefined) {
    return true;
  }
  return (
    isRecord(value.details) &&
    (value.details.domain === undefined || typeof value.details.domain === 'string') &&
    (value.details.resource === undefined || typeof value.details.resource === 'string')
  );
};

const isValidLogEntry = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.timestamp === 'string' &&
  typeof value.pod === 'string' &&
  typeof value.container === 'string' &&
  typeof value.line === 'string' &&
  typeof value.isInit === 'boolean' &&
  (value.isEphemeral === undefined || typeof value.isEphemeral === 'boolean');

function isValidContainerLogsStreamPayload(data: unknown): data is StreamEventPayload {
  if (!isRecord(data)) {
    return false;
  }

  const obj = data;

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
    obj.warnings !== null &&
    obj.warnings !== undefined &&
    (!Array.isArray(obj.warnings) || obj.warnings.some((warning) => typeof warning !== 'string'))
  ) {
    return false;
  }

  if (obj.errorDetails !== undefined && !isValidPermissionStatus(obj.errorDetails)) {
    return false;
  }

  // entries must be an array if present
  if (obj.entries !== undefined) {
    if (!Array.isArray(obj.entries) || obj.entries.some((entry) => !isValidLogEntry(entry))) {
      return false;
    }
  }

  return true;
}

const DOMAIN_NAME = 'container-logs' as const;

const DEFAULT_PAYLOAD: ContainerLogsSnapshotPayload = {
  entries: [],
  sequence: 0,
  generatedAt: 0,
  resetCount: 0,
  error: null,
};

class ContainerLogsStreamConnection {
  private readonly scope: string;
  private readonly mode: StreamMode;
  private readonly manager: ContainerLogsStreamManager;
  private readonly resolve?: () => void;
  private readonly reject?: (error: Error) => void;
  private eventSource: EventSource | null = null;
  private retryTimer: number | null = null;
  private closed = false;
  private attempt = 0;

  constructor(
    scope: string,
    mode: StreamMode,
    manager: ContainerLogsStreamManager,
    resolve?: () => void,
    reject?: (error: Error) => void
  ) {
    this.scope = scope;
    this.mode = mode;
    this.manager = manager;
    this.resolve = resolve;
    this.reject = reject;
  }

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
    this.closeEventSource();
    if (intentional) {
      this.manager.markIdle(this.scope);
    }
  }

  private closeEventSource(): void {
    closeRefreshEventSource(this.eventSource, {
      log: this.handleLogEvent as EventListener,
      error: this.handleError as EventListener,
    });
    this.eventSource = null;
  }

  private async openStream(): Promise<void> {
    try {
      const handle = await openRefreshEventSource({
        path: '/api/v2/stream/container-logs',
        configureURL: (url) => {
          url.searchParams.set('scope', this.scope);
          const streamParams = getContainerLogsStreamScopeParams(this.scope);
          if (streamParams?.container) {
            url.searchParams.set('container', streamParams.container);
          }
          for (const selectedFilter of streamParams?.selectedFilters ?? []) {
            url.searchParams.append('selectedFilter', selectedFilter);
          }
        },
        listeners: {
          log: this.handleLogEvent as EventListener,
          error: this.handleError as EventListener,
        },
      });
      if (this.closed) {
        handle.close();
        return;
      }
      this.eventSource = handle.source;
      this.manager.markConnected(this.scope);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to open container logs stream';
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
    if (this.closed || this.mode === 'manual' || this.retryTimer !== null) {
      return;
    }
    this.closeEventSource();
    const delay = streamReconnectDelay(this.attempt);
    this.attempt += 1;
    this.manager.handleStreamError(
      this.scope,
      `Container logs stream disconnected. Reconnecting in ${Math.round(delay / 1000)}s`
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
      if (!isValidContainerLogsStreamPayload(parsed)) {
        console.error('Invalid container logs stream payload structure');
        this.handleProtocolError('Invalid container logs stream payload');
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
      console.error('Failed to parse container logs stream payload', error);
      this.handleProtocolError('Failed to parse container logs stream payload');
    }
  };

  private handleProtocolError(message: string): void {
    this.manager.handleStreamError(this.scope, message);
    if (this.mode === 'manual') {
      this.reject?.(new Error(message));
      this.stop(false);
    }
  }

  private handleError = () => {
    if (this.closed) {
      return;
    }

    const message = 'Container logs stream connection lost';
    this.manager.handleStreamError(this.scope, message);

    if (this.mode === 'manual') {
      this.reject?.(new Error(message));
      this.stop(false);
      return;
    }

    this.scheduleReconnect();
  };
}

export class ContainerLogsStreamManager {
  private connections = new Map<string, ContainerLogsStreamConnection>();
  private buffers = new Map<string, ContainerLogsEntry[]>();
  private bufferMeta = new Map<string, { total: number; truncated: boolean }>();
  private backendWarnings = new Map<string, string[]>();
  /** Monotonically increasing counter for stable entry keys across buffer truncations. */
  private seqCounter = 0;
  private errorNotifier = new StreamErrorNotifier();
  private visibility = new StreamVisibilityController<string>({
    captureActive: () => Array.from(this.connections.keys()),
    suspendActive: () => {
      for (const connection of this.connections.values()) {
        connection.stop(true);
      }
      this.connections.clear();
    },
    resumeItem: (scope) => {
      void this.startStream(scope);
    },
  });
  /**
   * Maximum entries kept per scope before the front of the buffer is
   * trimmed. User-configurable via Object Panel Logs Tab Settings;
   * initialized from the preference cache and kept in sync via the
   * 'settings:obj-panel-logs-buffer-size' event. Starts at the hardcoded default so
   * the manager has a sane value even before appPreferences hydrates (the
   * singleton is constructed at module-load time, before the backend
   * settings round-trip completes).
   */
  private maxBufferSize = OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE;

  constructor() {
    eventBus.on('kubeconfig:changing', () => {
      this.stopAll(true);
    });
    eventBus.on('app:visibility-hidden', this.visibility.suspend);
    eventBus.on('app:visibility-visible', this.visibility.resume);
    // Pull the initial value from the preference cache. If hydration
    // hasn't run yet this returns the default; the subsequent hydration
    // will emit 'settings:obj-panel-logs-buffer-size' only if the stored value
    // differs, so we converge either way.
    this.maxBufferSize = getObjPanelLogsBufferMaxSize();
    eventBus.on('settings:obj-panel-logs-buffer-size', (size) => this.setMaxBufferSize(size));
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

  async startStream(scope: string): Promise<void> {
    this.stop(scope, false);
    this.setLoading(scope, false);
    const connection = new ContainerLogsStreamConnection(scope, 'stream', this);
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
      const connection = new ContainerLogsStreamConnection(
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
    scopes.forEach((scope) => {
      this.stop(scope, reset);
    });
    if (reset) {
      this.buffers.clear();
      this.bufferMeta.clear();
    }
  }

  applyPayload(scope: string, payload: StreamEventPayload, mode: StreamMode): void {
    const existing = this.buffers.get(scope) ?? [];
    const incoming: ContainerLogsEntry[] = (payload.entries ?? []).map((entry) => ({
      timestamp: entry.timestamp ?? '',
      pod: entry.pod ?? '',
      container: entry.container ?? '',
      line: entry.line ?? '',
      isInit: Boolean(entry.isInit),
      isEphemeral: Boolean(entry.isEphemeral),
      _seq: ++this.seqCounter,
    }));

    // Buffer replacement policy:
    // - reset=true with non-empty incoming → replace the buffered entries.
    //   For live streams, this frame is a fresh tail snapshot after a
    //   reconnect/remount, not an authoritative total, so preserve the
    //   larger running total instead of letting the count shrink back to
    //   the tail size.
    // - reset=true with empty incoming → PRESERVE. The server emits the
    //   reset flag as part of its "new connection" handshake on every
    //   stream open, before it has had a chance to tail any lines. Wiping
    //   the buffer here used to make auto-refresh toggle and
    //   cluster-switch remount flash the initial-load spinner even when
    //   the client already had plenty of log history cached.
    // - reset=false → append, unchanged.
    const shouldReplace = payload.reset && incoming.length > 0;
    const previousMeta = this.bufferMeta.get(scope);
    const previousTotal = previousMeta?.total ?? existing.length;
    let totalItems = shouldReplace
      ? mode === 'stream'
        ? Math.max(previousTotal, incoming.length)
        : incoming.length
      : previousTotal + incoming.length;

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
      if (payload.warnings && payload.warnings.length > 0) {
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

      const nextPayload: ContainerLogsSnapshotPayload = {
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

  private notifyStreamError(scope: string, message: string): void {
    this.errorNotifier.notify({
      source: 'refresh-log-stream',
      domain: DOMAIN_NAME,
      scope: scope || 'global',
      message,
    });
  }

  private clearStreamError(scope: string): void {
    this.errorNotifier.clear(DOMAIN_NAME, scope);
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

export const containerLogsStreamManager = new ContainerLogsStreamManager();
