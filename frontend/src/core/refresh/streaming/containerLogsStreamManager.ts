/**
 * frontend/src/core/refresh/streaming/containerLogsStreamManager.ts
 *
 * Module source for containerLogsStreamManager.
 * Implements containerLogsStreamManager logic for the core layer.
 */

import { getContainerLogsStreamScopeParams } from '@modules/object-panel/components/ObjectPanel/Logs/containerLogsStreamScopeParamsCache';
import { type JSONSocket, JSONStream } from '@wailsio/runtime';
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

const hasValidRequiredPayloadFields = (value: Record<string, unknown>): boolean =>
  typeof value.domain === 'string' &&
  typeof value.scope === 'string' &&
  typeof value.sequence === 'number' &&
  typeof value.generatedAt === 'number';

const hasValidWarnings = (warnings: unknown): boolean =>
  warnings === null ||
  warnings === undefined ||
  (Array.isArray(warnings) && warnings.every((warning) => typeof warning === 'string'));

const hasValidEntries = (entries: unknown): boolean =>
  entries === undefined ||
  (Array.isArray(entries) && entries.every((entry) => isValidLogEntry(entry)));

const hasValidOptionalPayloadFields = (value: Record<string, unknown>): boolean =>
  (value.reset === undefined || typeof value.reset === 'boolean') &&
  (value.error === undefined || typeof value.error === 'string') &&
  hasValidWarnings(value.warnings) &&
  (value.errorDetails === undefined || isValidPermissionStatus(value.errorDetails)) &&
  hasValidEntries(value.entries);

function isValidContainerLogsStreamPayload(data: unknown): data is StreamEventPayload {
  if (!isRecord(data)) {
    return false;
  }
  return hasValidRequiredPayloadFields(data) && hasValidOptionalPayloadFields(data);
}

const DOMAIN_NAME = 'container-logs' as const;
const CONTAINER_LOGS_STREAM_NAME = 'refresh-container-logs';

const DEFAULT_PAYLOAD: ContainerLogsSnapshotPayload = {
  entries: [],
  sequence: 0,
  generatedAt: 0,
  resetCount: 0,
  error: null,
};

type ProjectedLogBuffer = {
  entries: ContainerLogsEntry[];
  total: number;
  truncated: boolean;
};

class ContainerLogsStreamConnection {
  private readonly scope: string;
  private readonly mode: StreamMode;
  private readonly manager: ContainerLogsStreamManager;
  private readonly resolve?: () => void;
  private readonly reject?: (error: Error) => void;
  private socket: JSONSocket | null = null;
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
    this.closeStream();
    if (intentional) {
      this.manager.markIdle(this.scope);
    }
  }

  private closeStream(): void {
    if (!this.socket) {
      return;
    }
    this.socket.onopen = null;
    this.socket.onmessage = null;
    this.socket.onerror = null;
    this.socket.onclose = null;
    this.socket.close();
    this.socket = null;
  }

  private async openStream(): Promise<void> {
    try {
      const socket = JSONStream(CONTAINER_LOGS_STREAM_NAME);
      if (this.closed) {
        socket.close();
        return;
      }
      this.socket = socket;
      socket.onopen = this.handleOpen;
      socket.onmessage = this.handleLogEvent;
      socket.onerror = this.handleError;
      socket.onclose = this.handleError;
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
    this.closeStream();
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

  private readonly handleOpen = () => {
    if (this.closed || !this.socket) {
      return;
    }
    const streamParams = getContainerLogsStreamScopeParams(this.scope);
    this.socket.send({
      scope: this.scope,
      container: streamParams?.container ?? '',
      selectedFilters: streamParams?.selectedFilters ?? [],
      matchNone: streamParams?.matchNone ?? false,
    });
    this.attempt = 0;
    this.manager.markConnected(this.scope);
  };

  private readonly handleLogEvent = (event: MessageEvent<unknown>) => {
    if (this.closed) {
      return;
    }

    try {
      const parsed = event.data;
      if (!isValidContainerLogsStreamPayload(parsed)) {
        const error = new Error('Invalid container logs stream payload structure');
        this.handleProtocolError('Invalid container logs stream payload', error);
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
      this.handleProtocolError('Failed to process container logs stream payload', error);
    }
  };

  private handleProtocolError(message: string, error?: unknown): void {
    this.manager.handleStreamError(this.scope, message, error);
    if (this.mode === 'manual') {
      this.reject?.(new Error(message));
      this.stop(false);
    }
  }

  private readonly handleError = () => {
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
  private readonly connections = new Map<string, ContainerLogsStreamConnection>();
  private readonly buffers = new Map<string, ContainerLogsEntry[]>();
  private readonly bufferMeta = new Map<string, { total: number; truncated: boolean }>();
  private readonly backendWarnings = new Map<string, string[]>();
  /** Monotonically increasing counter for stable entry keys across buffer truncations. */
  private seqCounter = 0;
  private readonly errorNotifier = new StreamErrorNotifier();
  private readonly visibility = new StreamVisibilityController<string>({
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

  private createIncomingEntries(payload: StreamEventPayload): ContainerLogsEntry[] {
    return (payload.entries ?? []).map((entry) => ({
      timestamp: entry.timestamp ?? '',
      pod: entry.pod ?? '',
      container: entry.container ?? '',
      line: entry.line ?? '',
      isInit: Boolean(entry.isInit),
      isEphemeral: Boolean(entry.isEphemeral),
      _seq: ++this.seqCounter,
    }));
  }

  private mergeBufferEntries(
    existing: ContainerLogsEntry[],
    incoming: ContainerLogsEntry[],
    reset?: boolean
  ): ContainerLogsEntry[] {
    if (!reset) {
      return existing.concat(incoming);
    }
    return incoming.length > 0 ? incoming : existing;
  }

  private resolveBufferTotal(
    previousTotal: number,
    incomingCount: number,
    shouldReplace: boolean,
    mode: StreamMode
  ): number {
    if (!shouldReplace) {
      return previousTotal + incomingCount;
    }
    return mode === 'stream' ? Math.max(previousTotal, incomingCount) : incomingCount;
  }

  private projectBuffer(
    scope: string,
    payload: StreamEventPayload,
    mode: StreamMode
  ): ProjectedLogBuffer {
    const existing = this.buffers.get(scope) ?? [];
    const incoming = this.createIncomingEntries(payload);
    const previousMeta = this.bufferMeta.get(scope);
    const shouldReplace = Boolean(payload.reset && incoming.length > 0);
    const previousTotal = previousMeta?.total ?? existing.length;
    let total = this.resolveBufferTotal(previousTotal, incoming.length, shouldReplace, mode);
    let entries = this.mergeBufferEntries(existing, incoming, payload.reset);
    let truncated = previousMeta?.truncated ?? false;
    if (entries.length > this.maxBufferSize) {
      truncated = true;
      entries = entries.slice(entries.length - this.maxBufferSize);
    }
    total = Math.max(total, entries.length);
    return { entries, total, truncated };
  }

  private updateBackendWarnings(scope: string, payload: StreamEventPayload): void {
    if (payload.warnings !== undefined) {
      if (payload.warnings && payload.warnings.length > 0) {
        this.backendWarnings.set(scope, payload.warnings);
        return;
      }
      this.backendWarnings.delete(scope);
      return;
    }
    if (payload.reset) {
      this.backendWarnings.delete(scope);
    }
  }

  private commitPayload(
    scope: string,
    payload: StreamEventPayload,
    mode: StreamMode,
    buffer: ProjectedLogBuffer,
    generatedAt: number,
    errorMessage: string | null
  ): void {
    const payloadSequence = payload.sequence ?? (payload.reset ? 1 : 0);
    const isManual = mode === 'manual';
    const stats = this.buildStats(scope, buffer.entries.length);
    setScopedDomainState(DOMAIN_NAME, scope, (previous) => {
      const previousPayload = previous.data ?? DEFAULT_PAYLOAD;
      const resetCount = payload.reset
        ? previousPayload.resetCount + 1
        : previousPayload.resetCount;
      // Client sequence remains monotonic when server connection counters reset.
      const nextSequence = Math.max(payloadSequence, previousPayload.sequence ?? 0);
      const nextPayload: ContainerLogsSnapshotPayload = {
        entries: buffer.entries,
        sequence: nextSequence,
        generatedAt,
        resetCount,
        error: errorMessage,
      };

      return {
        ...previous,
        status: errorMessage ? 'error' : 'ready',
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
  }

  applyPayload(scope: string, payload: StreamEventPayload, mode: StreamMode): void {
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
    const buffer = this.projectBuffer(scope, payload, mode);
    this.buffers.set(scope, buffer.entries);
    this.bufferMeta.set(scope, { total: buffer.total, truncated: buffer.truncated });
    const generatedAt = payload.generatedAt || Date.now();
    const errorMessage = resolvePermissionDeniedMessage(
      payload.error ?? null,
      payload.errorDetails
    );
    this.updateBackendWarnings(scope, payload);
    this.commitPayload(scope, payload, mode, buffer, generatedAt, errorMessage);
    if (errorMessage) {
      this.notifyStreamError(scope, errorMessage);
    } else {
      this.clearStreamError(scope);
    }
  }

  handleStreamError(scope: string, message: string, error?: unknown): void {
    setScopedDomainState(DOMAIN_NAME, scope, (previous) => ({
      ...previous,
      status: 'error',
      error: message,
    }));
    this.notifyStreamError(scope, message, error);
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

  private notifyStreamError(scope: string, message: string, error?: unknown): void {
    this.errorNotifier.notify({
      source: 'refresh-log-stream',
      domain: DOMAIN_NAME,
      scope: scope || 'global',
      message,
      ...(error !== undefined ? { error } : {}),
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
