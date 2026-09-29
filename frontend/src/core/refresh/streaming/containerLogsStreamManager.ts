/**
 * frontend/src/core/refresh/streaming/containerLogsStreamManager.ts
 *
 * Owns container-logs streams and is the only writer of `container-logs`
 * scoped state. Each scope's connection feeds the protocol reducer; the manager
 * applies its effects: socket work, reconnect timers, and an ordered, bounded
 * entry buffer projected into the store.
 */

import { getContainerLogsStreamScopeParams } from '@modules/object-panel/components/ObjectPanel/Logs/containerLogsStreamScopeParamsCache';
import { type JSONSocket, JSONStream } from '@wailsio/runtime';
import { eventBus } from '@/core/events';
import {
  getObjPanelLogsBufferMaxSize,
  OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE,
} from '@/core/settings/appPreferences';
import type { SnapshotStats } from '../client';
import { resetScopedDomainState, setScopedDomainState } from '../store';
import type {
  ContainerLogsEntry,
  ContainerLogsSnapshotPayload,
  ContainerLogsStreamPhase,
  ContainerLogsTargetIssue,
  ContainerLogsWarning,
  ContainerLogsWireEntry,
} from '../types';
import {
  type ContainerLogsProtocolEffect,
  type ContainerLogsProtocolEvent,
  type ContainerLogsProtocolState,
  initialContainerLogsProtocolState,
  parseContainerLogsFrame,
  transitionContainerLogsProtocol,
} from './containerLogsStreamProtocol';
import { StreamErrorNotifier } from './streamErrorNotifier';
import { streamReconnectDelay } from './streamTiming';
import { StreamVisibilityController } from './streamVisibilityController';

const DOMAIN_NAME = 'container-logs' as const;
const CONTAINER_LOGS_STREAM_NAME = 'refresh-container-logs';

/** Line bytes one scope's buffer holds; the backend trims its snapshot to it. */
export const CONTAINER_LOGS_MAX_BYTES = 64 * 1024 * 1024;

// Timestamps are RFC 3339 in UTC with up to nine fraction digits. Padding the
// fraction makes string order match time order; entries without a timestamp
// sort after every timestamped entry, as the backend orders them.
const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/;
const UNTIMED_KEY = '￿';

const timestampKey = (timestamp: string): string => {
  const match = TIMESTAMP_PATTERN.exec(timestamp);
  return match ? `${match[1]}.${(match[2] ?? '').padEnd(9, '0')}` : UNTIMED_KEY;
};

// UTF-8 length, the unit the backend's byte limit counts.
const utf8Length = (text: string): number => {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
};

// First position whose key sorts after `key`, so equal timestamps keep their
// arrival order.
const upperBound = (keys: string[], key: string): number => {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle] <= key) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

const sameEntryContent = (left: ContainerLogsEntry[], right: ContainerLogsWireEntry[]): boolean =>
  left.length === right.length &&
  left.every((entry, index) => {
    const candidate = right[index];
    return (
      entry.timestamp === candidate.timestamp &&
      entry.pod === candidate.pod &&
      entry.container === candidate.container &&
      entry.line === candidate.line &&
      entry.isInit === candidate.isInit &&
      Boolean(entry.isEphemeral) === Boolean(candidate.isEphemeral)
    );
  });

/**
 * One scope's entries in timestamp order, bounded by count and line bytes.
 * The oldest entries are evicted first.
 */
class LogBuffer {
  entries: ContainerLogsEntry[] = [];
  private keys: string[] = [];
  private bytes = 0;
  // Entries received since the last snapshot, including any not held.
  private received = 0;
  warnings: ContainerLogsWarning[] = [];
  issues: ContainerLogsTargetIssue[] = [];

  replace(incoming: ContainerLogsWireEntry[], trimmed: number, nextSeq: () => number): void {
    // An unchanged reconnect snapshot keeps its entries' identity, so the view
    // does not re-render every row.
    if (!sameEntryContent(this.entries, incoming)) {
      this.entries = incoming.map((entry) => ({ ...entry, _seq: nextSeq() }));
    }
    this.keys = this.entries.map((entry) => timestampKey(entry.timestamp));
    this.bytes = this.entries.reduce((sum, entry) => sum + utf8Length(entry.line), 0);
    this.received = this.entries.length + trimmed;
  }

  insert(incoming: ContainerLogsWireEntry[], nextSeq: () => number): void {
    if (incoming.length === 0) {
      return;
    }
    const entries = this.entries.slice();
    const keys = this.keys.slice();
    for (const wire of incoming) {
      const key = timestampKey(wire.timestamp);
      const position =
        keys.length === 0 || keys[keys.length - 1] <= key ? keys.length : upperBound(keys, key);
      entries.splice(position, 0, { ...wire, _seq: nextSeq() });
      keys.splice(position, 0, key);
      this.bytes += utf8Length(wire.line);
    }
    this.entries = entries;
    this.keys = keys;
    this.received += incoming.length;
  }

  evict(maxEntries: number, maxBytes: number): void {
    let drop = Math.max(0, this.entries.length - maxEntries);
    let bytes = this.bytes;
    for (let index = 0; index < drop; index += 1) {
      bytes -= utf8Length(this.entries[index].line);
    }
    while (bytes > maxBytes && drop < this.entries.length) {
      bytes -= utf8Length(this.entries[drop].line);
      drop += 1;
    }
    if (drop === 0) {
      return;
    }
    this.entries = this.entries.slice(drop);
    this.keys = this.keys.slice(drop);
    this.bytes = bytes;
  }

  truncation(): ContainerLogsSnapshotPayload['truncation'] {
    return this.received > this.entries.length
      ? { shown: this.entries.length, received: this.received }
      : null;
  }
}

type ManagerLimits = { maxEntries?: number; maxBytes?: number };

class ContainerLogsStreamConnection {
  private readonly scope: string;
  private readonly manager: ContainerLogsStreamManager;
  private socket: JSONSocket | null = null;
  private retryTimer: number | null = null;
  private protocol: ContainerLogsProtocolState = initialContainerLogsProtocolState();

  constructor(scope: string, manager: ContainerLogsStreamManager) {
    this.scope = scope;
    this.manager = manager;
  }

  start(): void {
    this.manager.commitPhase(this.scope, this.protocol.phase);
    this.openStream();
  }

  stop(): void {
    this.dispatch({ type: 'stopping' });
  }

  private get finished(): boolean {
    const { status } = this.protocol.phase;
    return status === 'stopping' || status === 'failed';
  }

  private dispatch(event: ContainerLogsProtocolEvent): void {
    const transition = transitionContainerLogsProtocol(this.protocol, event);
    this.protocol = transition.state;
    for (const effect of transition.effects) {
      this.applyConnectionEffect(effect);
    }
    this.manager.applyTransition(this, this.scope, transition.state.phase, transition.effects);
  }

  private applyConnectionEffect(effect: ContainerLogsProtocolEffect): void {
    switch (effect.type) {
      case 'send-request':
        this.socket?.send(this.manager.buildRequest(this.scope));
        return;
      case 'close-connection':
        this.clearRetryTimer();
        this.closeStream();
        return;
      case 'schedule-reconnect':
        this.scheduleReconnect(effect.attempt);
        return;
      default:
        return;
    }
  }

  private openStream(): void {
    try {
      const socket = JSONStream(CONTAINER_LOGS_STREAM_NAME);
      if (this.finished) {
        socket.close();
        return;
      }
      this.socket = socket;
      socket.onopen = () => this.dispatch({ type: 'connection-opened' });
      socket.onmessage = this.handleMessage;
      socket.onerror = this.handleLoss;
      socket.onclose = this.handleLoss;
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Failed to open container logs stream';
      this.dispatch({ type: 'connection-lost', reason });
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

  private scheduleReconnect(attempt: number): void {
    this.clearRetryTimer();
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (!this.finished) {
        this.openStream();
      }
    }, streamReconnectDelay(attempt));
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private readonly handleMessage = (event: MessageEvent<unknown>) => {
    const frame = parseContainerLogsFrame(event.data);
    if (!frame) {
      this.dispatch({ type: 'connection-lost', reason: 'Invalid container logs stream payload' });
      return;
    }
    if (frame.scope !== this.scope || frame.domain !== DOMAIN_NAME) {
      return;
    }
    this.dispatch({ type: 'frame-received', frame });
  };

  private readonly handleLoss = () => {
    this.dispatch({ type: 'connection-lost', reason: 'Container logs stream connection lost' });
  };
}

export class ContainerLogsStreamManager {
  private readonly connections = new Map<string, ContainerLogsStreamConnection>();
  private readonly buffers = new Map<string, LogBuffer>();
  /** Monotonically increasing counter for stable entry keys across evictions. */
  private seqCounter = 0;
  private readonly errorNotifier = new StreamErrorNotifier();
  private readonly visibility = new StreamVisibilityController<string>({
    captureActive: () => Array.from(this.connections.keys()),
    suspendActive: () => {
      for (const scope of this.connections.keys()) {
        this.connections.get(scope)?.stop();
        this.markIdle(scope);
      }
    },
    // Closed connections retain demand while hidden; explicit stop removes it.
    resumeItems: () => Array.from(this.connections.keys()),
    resumeItem: (scope) => {
      void this.startStream(scope);
    },
  });
  /**
   * Maximum entries kept per scope, from the Object Panel Logs buffer setting.
   * Starts at the default so the module-level singleton has a sane value
   * before preferences hydrate.
   */
  private maxEntries = OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE;
  private readonly maxBytes: number;
  private readonly fixedMaxEntries: number | undefined;

  constructor(limits: ManagerLimits = {}) {
    this.maxBytes = limits.maxBytes ?? CONTAINER_LOGS_MAX_BYTES;
    this.fixedMaxEntries = limits.maxEntries;
    eventBus.on('kubeconfig:changing', () => {
      this.stopAll(true);
    });
    eventBus.on('app:visibility-hidden', this.visibility.suspend);
    eventBus.on('app:visibility-visible', this.visibility.resume);
    this.maxEntries = limits.maxEntries ?? getObjPanelLogsBufferMaxSize();
    eventBus.on('settings:obj-panel-logs-buffer-size', (size) => this.setMaxEntries(size));
  }

  /** Shrinking the buffer trims existing buffers at once; growing applies as entries arrive. */
  private setMaxEntries(size: number): void {
    if (this.fixedMaxEntries !== undefined || size === this.maxEntries) {
      return;
    }
    this.maxEntries = size;
    for (const [scope, buffer] of this.buffers) {
      buffer.evict(this.maxEntries, this.maxBytes);
      this.commit(scope, {});
    }
  }

  async startStream(scope: string): Promise<void> {
    this.stop(scope, false);
    const connection = new ContainerLogsStreamConnection(scope, this);
    this.connections.set(scope, connection);
    connection.start();
  }

  stop(scope: string, reset = false): void {
    const connection = this.connections.get(scope);
    if (connection) {
      this.connections.delete(scope);
      connection.stop();
    }
    if (reset) {
      this.buffers.delete(scope);
      resetScopedDomainState(DOMAIN_NAME, scope);
      this.errorNotifier.clear(DOMAIN_NAME, scope);
      return;
    }
    this.markIdle(scope);
  }

  stopAll(reset = false): void {
    const scopes = new Set(this.connections.keys());
    if (reset) {
      for (const scope of this.buffers.keys()) {
        scopes.add(scope);
      }
    }
    for (const scope of scopes) {
      this.stop(scope, reset);
    }
  }

  /** The first client frame: scope, source selection and buffer limits. */
  buildRequest(scope: string) {
    const params = getContainerLogsStreamScopeParams(scope);
    return {
      scope,
      selectedFilters: params?.selectedFilters ?? [],
      matchNone: params?.matchNone ?? false,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
    };
  }

  /** Applies a protocol transition's data effects and projects the result. */
  applyTransition(
    connection: ContainerLogsStreamConnection,
    scope: string,
    phase: ContainerLogsStreamPhase,
    effects: ContainerLogsProtocolEffect[]
  ): void {
    // A replaced or stopped connection no longer writes this scope's state.
    if (this.connections.get(scope) !== connection) {
      return;
    }
    const buffer = this.bufferFor(scope);
    let snapshotApplied = false;
    for (const effect of effects) {
      snapshotApplied = this.applyDataEffect(buffer, effect) || snapshotApplied;
    }
    buffer.evict(this.maxEntries, this.maxBytes);
    if (phase.status !== 'stopping') {
      this.commit(scope, { phase, snapshotApplied });
    }
    this.notifyPhase(scope, phase);
  }

  private applyDataEffect(buffer: LogBuffer, effect: ContainerLogsProtocolEffect): boolean {
    const nextSeq = () => ++this.seqCounter;
    switch (effect.type) {
      case 'apply-snapshot':
        buffer.replace(effect.entries, effect.trimmed, nextSeq);
        buffer.warnings = effect.warnings;
        buffer.issues = effect.issues;
        return true;
      case 'append-entries':
        buffer.insert(effect.entries, nextSeq);
        return false;
      case 'replace-warnings':
        buffer.warnings = effect.warnings;
        return false;
      case 'replace-issues':
        buffer.issues = effect.issues;
        return false;
      default:
        return false;
    }
  }

  /** Publishes a phase change before any frame arrives (a connection starting). */
  commitPhase(scope: string, phase: ContainerLogsStreamPhase): void {
    this.bufferFor(scope);
    this.commit(scope, { phase });
  }

  private bufferFor(scope: string): LogBuffer {
    let buffer = this.buffers.get(scope);
    if (!buffer) {
      buffer = new LogBuffer();
      this.buffers.set(scope, buffer);
    }
    return buffer;
  }

  private commit(
    scope: string,
    update: { phase?: ContainerLogsStreamPhase; snapshotApplied?: boolean }
  ): void {
    const buffer = this.buffers.get(scope);
    if (!buffer) {
      return;
    }
    const now = Date.now();
    setScopedDomainState(DOMAIN_NAME, scope, (previous) => {
      const previousPayload = previous.data;
      const phase = update.phase ?? previousPayload?.phase ?? { status: 'connecting' };
      const error = phase.status === 'failed' ? phase.reason : null;
      const data: ContainerLogsSnapshotPayload = {
        entries: buffer.entries,
        sequence: (previousPayload?.sequence ?? 0) + (update.snapshotApplied ? 1 : 0),
        generatedAt: now,
        resetCount: (previousPayload?.resetCount ?? 0) + (update.snapshotApplied ? 1 : 0),
        error,
        phase,
        warnings: buffer.warnings,
        issues: buffer.issues,
        truncation: buffer.truncation(),
      };
      return {
        ...previous,
        status: statusFor(phase, buffer.entries.length > 0),
        data,
        stats: buildStats(buffer),
        error,
        lastUpdated: now,
        lastAutoRefresh: now,
        isManual: false,
        scope,
      };
    });
  }

  private markIdle(scope: string): void {
    const buffer = this.buffers.get(scope);
    setScopedDomainState(DOMAIN_NAME, scope, (previous) => {
      const failed = previous.data?.phase.status === 'failed';
      return {
        ...previous,
        status: previous.status === 'ready' || failed ? previous.status : 'idle',
        data:
          previous.data && !failed
            ? { ...previous.data, phase: { status: 'stopping' } }
            : previous.data,
        stats: buffer ? buildStats(buffer) : previous.stats,
        scope,
      };
    });
  }

  private notifyPhase(scope: string, phase: ContainerLogsStreamPhase): void {
    if (phase.status === 'failed') {
      this.errorNotifier.notify({
        source: 'refresh-log-stream',
        domain: DOMAIN_NAME,
        scope: scope || 'global',
        message: phase.reason,
      });
      return;
    }
    if (phase.status === 'live') {
      this.errorNotifier.clear(DOMAIN_NAME, scope);
    }
  }
}

const statusFor = (
  phase: ContainerLogsStreamPhase,
  hasEntries: boolean
): 'loading' | 'updating' | 'ready' | 'error' => {
  switch (phase.status) {
    case 'live':
    case 'stopping':
      return 'ready';
    case 'failed':
      return 'error';
    default:
      return hasEntries ? 'updating' : 'loading';
  }
};

const buildStats = (buffer: LogBuffer): SnapshotStats => {
  const truncation = buffer.truncation();
  return {
    itemCount: buffer.entries.length,
    buildDurationMs: 0,
    totalItems: truncation?.received,
    truncated: truncation !== null,
  };
};

export const containerLogsStreamManager = new ContainerLogsStreamManager();
