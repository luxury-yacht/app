/**
 * frontend/src/core/refresh/streaming/containerLogsStreamManager.ts
 *
 * Owns container-logs streams and is the only writer of `container-logs`
 * scoped state. Each scope's connection feeds the protocol reducer; the manager
 * applies its effects: socket work, reconnect timers, and an ordered, bounded
 * entry buffer projected into the store.
 */

import type { types } from '@core/backend-api/models';
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
  ContainerLogsResumePoint,
  ContainerLogsSnapshotPayload,
  ContainerLogsStreamPhase,
  ContainerLogsStreamRequest,
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
import { getContainerLogsStreamScopeParams } from './containerLogsStreamScopeParams';
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
    const code = text.codePointAt(index) ?? 0;
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code < 0x10000) {
      bytes += 3;
    } else {
      // A code point above the BMP spans two UTF-16 units.
      bytes += 4;
      index += 1;
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

const compareKeys = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
};

// A resume point sends the lines at a container's newest timestamp so the
// backend can find its place; a suffix of them is enough, so the request stays
// small.
const RESUME_MAX_LINES = 64;
const RESUME_MAX_BYTES = 64 * 1024;

type ResumeRun = {
  newest: ContainerLogsEntry;
  key: string;
  // Newest first while collecting.
  lines: string[];
  bytes: number;
  closed: boolean;
};

const containerIdentity = (entry: ContainerLogsWireEntry): string =>
  `${entry.pod}/${entry.container}/${entry.isInit}/${Boolean(entry.isEphemeral)}`;

// Takes the container's next older line into its run while the line shares the
// run's timestamp and fits the budget; the first line that does not ends it.
const extendRun = (run: ResumeRun, entry: ContainerLogsEntry, key: string): void => {
  const bytes = utf8Length(entry.line);
  if (
    key !== run.key ||
    run.lines.length >= RESUME_MAX_LINES ||
    run.bytes + bytes > RESUME_MAX_BYTES
  ) {
    run.closed = true;
    return;
  }
  run.lines.push(entry.line);
  run.bytes += bytes;
};

const toResumePoint = ({ newest, lines }: ResumeRun): ContainerLogsResumePoint => {
  // Lines were collected newest first.
  const oldestFirst = [...lines];
  oldestFirst.reverse();
  return {
    pod: newest.pod,
    container: newest.container,
    isInit: newest.isInit,
    isEphemeral: Boolean(newest.isEphemeral),
    timestamp: newest.timestamp,
    lines: oldestFirst,
  };
};

/**
 * Where the buffer ends for each container: its newest timestamped line and
 * the lines held at that timestamp, oldest first.
 */
const resumePointsFor = (
  entries: ContainerLogsEntry[],
  keys: string[]
): ContainerLogsResumePoint[] => {
  const runs = new Map<string, ResumeRun>();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const key = keys[index];
    if (key === UNTIMED_KEY) {
      continue;
    }
    const run = runs.get(containerIdentity(entry));
    if (!run) {
      runs.set(containerIdentity(entry), {
        newest: entry,
        key,
        lines: [entry.line],
        bytes: utf8Length(entry.line),
        closed: false,
      });
    } else if (!run.closed) {
      extendRun(run, entry, key);
    }
  }
  return Array.from(runs.values(), toResumePoint);
};

const selectionKey = (request: ContainerLogsStreamRequest): string =>
  JSON.stringify([request.selectedFilters ?? [], request.matchNone ?? false]);

/** What a buffer's history was read for: resuming is valid only for the same. */
type BufferBasis = { selection: string; maxEntries: number };

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
 * The distinct values a buffer's entries carry (their pods, their containers),
 * counted as entries come and go. `values` is the same array until the set of
 * values changes.
 */
class HeldValues<V> {
  private counts = new Map<string, { value: V; count: number }>();
  private list: V[] = [];
  private changed = false;

  private readonly keyOf: (entry: ContainerLogsEntry) => string;
  private readonly heldValueOf: (entry: ContainerLogsEntry) => V;

  constructor(
    keyOf: (entry: ContainerLogsEntry) => string,
    heldValueOf: (entry: ContainerLogsEntry) => V
  ) {
    this.keyOf = keyOf;
    this.heldValueOf = heldValueOf;
  }

  get values(): V[] {
    if (this.changed) {
      this.list = Array.from(this.counts.values(), (held) => held.value);
      this.changed = false;
    }
    return this.list;
  }

  holds(key: string): boolean {
    return this.counts.has(key);
  }

  count(entry: ContainerLogsEntry, delta: number): void {
    const key = this.keyOf(entry);
    const held = this.counts.get(key);
    const count = (held?.count ?? 0) + delta;
    if (count > 0) {
      this.changed ||= !held;
      this.counts.set(key, { value: held?.value ?? this.heldValueOf(entry), count });
    } else if (this.counts.delete(key)) {
      this.changed = true;
    }
  }

  clear(): void {
    this.counts = new Map();
    this.changed = true;
  }
}

const podOf = (entry: ContainerLogsEntry): string => entry.pod;

const containerKeyOf = (entry: ContainerLogsEntry): string =>
  `${entry.container}|${entry.isInit}|${Boolean(entry.isEphemeral)}`;

const containerOf = (entry: ContainerLogsEntry): types.PodContainer => ({
  name: entry.container,
  isInit: entry.isInit,
  isEphemeral: Boolean(entry.isEphemeral),
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
  // The selection and size whose newest entries the buffer holds; null until a
  // snapshot arrives.
  private basis: BufferBasis | null = null;
  // The pods and containers with lines in the buffer, kept as entries come and go.
  private readonly heldPods = new HeldValues(podOf, podOf);
  private readonly heldContainers = new HeldValues(containerKeyOf, containerOf);

  /** The pods with lines in the buffer; the same array until that set changes. */
  get pods(): string[] {
    return this.heldPods.values;
  }

  /** The containers with lines in the buffer; the same array until that set changes. */
  get containers(): types.PodContainer[] {
    return this.heldContainers.values;
  }

  private countHeld(entry: ContainerLogsEntry, delta: number): void {
    this.heldPods.count(entry, delta);
    this.heldContainers.count(entry, delta);
  }

  private recountHeld(): void {
    this.heldPods.clear();
    this.heldContainers.clear();
    for (const entry of this.entries) {
      this.countHeld(entry, 1);
    }
  }

  /** Drops the lines of pods that no longer exist; they are not counted as received. */
  dropPods(pods: readonly string[]): void {
    const gone = new Set(pods.filter((pod) => this.heldPods.holds(pod)));
    if (gone.size === 0) {
      return;
    }
    const entries: ContainerLogsEntry[] = [];
    const keys: string[] = [];
    this.entries.forEach((entry, index) => {
      if (gone.has(entry.pod)) {
        this.bytes -= utf8Length(entry.line);
        this.received -= 1;
        this.countHeld(entry, -1);
      } else {
        entries.push(entry);
        keys.push(this.keys[index]);
      }
    });
    this.entries = entries;
    this.keys = keys;
  }

  /** Records the request whose snapshot the buffer now reflects. */
  setBasis(request: ContainerLogsStreamRequest | null): void {
    this.basis = request
      ? { selection: selectionKey(request), maxEntries: request.maxEntries ?? 0 }
      : null;
  }

  /** A smaller buffer still holds the newest entries for its new size. */
  limitBasis(maxEntries: number): void {
    if (this.basis) {
      this.basis.maxEntries = Math.min(this.basis.maxEntries, maxEntries);
    }
  }

  /**
   * Resume points for a request, when the buffer holds the newest entries for
   * that same selection and size; a new selection or a larger buffer needs the
   * history read again.
   */
  resumePoints(request: ContainerLogsStreamRequest): ContainerLogsResumePoint[] {
    const basis = this.basis;
    if (
      basis?.selection !== selectionKey(request) ||
      (request.maxEntries ?? 0) > basis.maxEntries
    ) {
      return [];
    }
    return resumePointsFor(this.entries, this.keys);
  }

  replace(incoming: ContainerLogsWireEntry[], trimmed: number, nextSeq: () => number): void {
    // An unchanged reconnect snapshot keeps its entries' identity, so the view
    // does not re-render every row.
    if (!sameEntryContent(this.entries, incoming)) {
      this.entries = incoming.map((entry) => ({ ...entry, _seq: nextSeq() }));
    }
    this.keys = this.entries.map((entry) => timestampKey(entry.timestamp));
    this.bytes = this.entries.reduce((sum, entry) => sum + utf8Length(entry.line), 0);
    this.received = this.entries.length + trimmed;
    this.recountHeld();
  }

  /**
   * Merges entries in timestamp order. Held entries come before new ones with
   * the same timestamp, and new ones keep their arrival order.
   */
  insert(incoming: ContainerLogsWireEntry[], nextSeq: () => number): void {
    if (incoming.length === 0) {
      return;
    }
    const added = incoming
      .map((wire) => ({ entry: { ...wire, _seq: nextSeq() }, key: timestampKey(wire.timestamp) }))
      .sort((left, right) => compareKeys(left.key, right.key));
    // Live lines are usually the newest, so most held entries are copied as is.
    let held = upperBound(this.keys, added[0].key);
    const entries = this.entries.slice(0, held);
    const keys = this.keys.slice(0, held);
    for (const next of added) {
      for (; held < this.keys.length && this.keys[held] <= next.key; held += 1) {
        entries.push(this.entries[held]);
        keys.push(this.keys[held]);
      }
      entries.push(next.entry);
      keys.push(next.key);
      this.bytes += utf8Length(next.entry.line);
      this.countHeld(next.entry, 1);
    }
    this.entries = entries.concat(this.entries.slice(held));
    this.keys = keys.concat(this.keys.slice(held));
    this.received += incoming.length;
  }

  /** Adds a resumed snapshot, counting the history the backend left out. */
  continueWith(incoming: ContainerLogsWireEntry[], trimmed: number, nextSeq: () => number): void {
    this.insert(incoming, nextSeq);
    this.received += trimmed;
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
    for (let index = 0; index < drop; index += 1) {
      this.countHeld(this.entries[index], -1);
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
  private sentRequest: ContainerLogsStreamRequest | null = null;

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

  /** The request sent on the current socket; its snapshot answers it. */
  get request(): ContainerLogsStreamRequest | null {
    return this.sentRequest;
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
        this.sentRequest = this.manager.buildRequest(this.scope);
        this.socket?.send(this.sentRequest);
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
      buffer.limitBasis(this.maxEntries);
      this.commit(scope, {});
    }
  }

  startStream(scope: string): void {
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

  /**
   * The first client frame: scope, source selection and buffer limits, plus
   * where the buffer ends for each container when the stream can resume there.
   */
  buildRequest(scope: string): ContainerLogsStreamRequest {
    const params = getContainerLogsStreamScopeParams(scope);
    const request: ContainerLogsStreamRequest = {
      scope,
      selectedFilters: params?.selectedFilters ?? [],
      matchNone: params?.matchNone ?? false,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
    };
    const resume = this.buffers.get(scope)?.resumePoints(request) ?? [];
    return resume.length > 0 ? { ...request, resume } : request;
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
      snapshotApplied = this.applyDataEffect(buffer, effect, connection.request) || snapshotApplied;
    }
    buffer.evict(this.maxEntries, this.maxBytes);
    if (phase.status !== 'stopping') {
      this.commit(scope, { phase, snapshotApplied });
    }
    this.notifyPhase(scope, phase);
  }

  private applyDataEffect(
    buffer: LogBuffer,
    effect: ContainerLogsProtocolEffect,
    request: ContainerLogsStreamRequest | null
  ): boolean {
    const nextSeq = () => ++this.seqCounter;
    switch (effect.type) {
      case 'apply-snapshot':
        if (effect.resumed) {
          buffer.continueWith(effect.entries, effect.trimmed, nextSeq);
          buffer.dropPods(effect.removedPods);
        } else {
          buffer.replace(effect.entries, effect.trimmed, nextSeq);
        }
        buffer.setBasis(request);
        // The buffer may have shrunk while the snapshot was on its way.
        buffer.limitBasis(this.maxEntries);
        buffer.warnings = effect.warnings;
        buffer.issues = effect.issues;
        return true;
      case 'append-entries':
        buffer.insert(effect.entries, nextSeq);
        return false;
      case 'remove-pods':
        buffer.dropPods(effect.pods);
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
        pods: buffer.pods,
        containers: buffer.containers,
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
