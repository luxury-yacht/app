/**
 * frontend/src/core/refresh/streaming/eventStreamManager.ts
 *
 * Module source for eventStreamManager.
 * Implements eventStreamManager logic for the core layer.
 */

import { ensureRefreshBaseURL } from '../client';
import type { SnapshotStats } from '../client';
import { setDomainState, resetDomainState } from '../store';
import type {
  ClusterEventEntry,
  ClusterEventsSnapshotPayload,
  NamespaceEventSummary,
  NamespaceEventsSnapshotPayload,
} from '../types';
import { formatAge } from '@/utils/ageFormatter';
import { errorHandler } from '@utils/errorHandler';
import { eventBus } from '@/core/events';

interface StreamEventPayload {
  domain: string;
  scope: string;
  sequence: number;
  generatedAt: number;
  reset?: boolean;
  events?: Array<{
    clusterId?: string;
    clusterName?: string;
    kind?: string;
    name?: string;
    namespace?: string;
    type?: string;
    objectNamespace?: string;
    source?: string;
    reason?: string;
    object?: string;
    message?: string;
    age?: string;
    createdAt?: number;
  }>;
  total?: number;
  truncated?: boolean;
  error?: string;
}

function isValidStreamEventPayload(data: unknown): data is StreamEventPayload {
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

  if (obj.total !== undefined && typeof obj.total !== 'number') {
    return false;
  }

  if (obj.truncated !== undefined && typeof obj.truncated !== 'boolean') {
    return false;
  }

  // events must be an array if present
  if (obj.events !== undefined && !Array.isArray(obj.events)) {
    return false;
  }

  return true;
}

const CLUSTER_DOMAIN = 'cluster-events' as const;
const NAMESPACE_DOMAIN = 'namespace-events' as const;
const CLUSTER_SCOPE = 'cluster';

const MAX_CLUSTER_EVENTS = 500;
const MAX_NAMESPACE_EVENTS = 500;
const STREAM_ERROR_NOTIFY_THRESHOLD = 3;
const STREAM_RESYNC_MESSAGE = 'Stream resyncing';
const RESYNC_STATE_ENABLED = true;

class EventStreamConnection {
  private eventSource: EventSource | null = null;
  private retryTimer: number | null = null;
  private closed = false;
  private attempt = 0;
  // Track the last SSE id so reconnects can request a resume window.
  private lastEventId: string | null = null;

  constructor(
    private readonly domain: typeof CLUSTER_DOMAIN | typeof NAMESPACE_DOMAIN,
    private readonly scope: string,
    private readonly manager: EventStreamManager
  ) {}

  async start(): Promise<void> {
    this.closed = false;
    this.attempt = 0;
    await this.openStream();
  }

  stop(reset = false): void {
    this.closed = true;
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.removeEventListener('event', this.handleEvent as EventListener);
      this.eventSource.removeEventListener('error', this.handleError as EventListener);
      this.eventSource.close();
      this.eventSource = null;
    }
    if (reset) {
      this.lastEventId = null;
    }
    this.manager.markIdle(this.domain, this.scope, reset);
  }

  private async openStream(): Promise<void> {
    try {
      const baseURL = await ensureRefreshBaseURL();
      if (this.closed) {
        return;
      }

      const url = new URL('/api/v2/stream/events', baseURL);
      url.searchParams.set('scope', this.scope);
      const resumeId = this.getResumeId();
      if (resumeId) {
        url.searchParams.set('since', resumeId);
      }

      const eventSource = new EventSource(url.toString());
      this.eventSource = eventSource;
      eventSource.addEventListener('event', this.handleEvent as EventListener);
      eventSource.addEventListener('error', this.handleError as EventListener);
      this.manager.markConnected(this.domain, this.scope);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open event stream';
      this.manager.handleStreamError(this.domain, this.scope, message);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) {
      return;
    }
    const delay = Math.min(30_000, 1_000 * Math.pow(2, this.attempt));
    this.attempt += 1;
    this.manager.handleStreamError(
      this.domain,
      this.scope,
      `Event stream disconnected. Reconnecting in ${Math.round(delay / 1000)}s`
    );
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void this.openStream();
    }, delay);
  }

  private handleEvent = (event: MessageEvent) => {
    if (this.closed) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(event.data);
      if (!isValidStreamEventPayload(parsed)) {
        console.error('Invalid event stream payload structure');
        return;
      }
      if (parsed.scope !== this.scope || parsed.domain !== this.domain) {
        return;
      }
      this.rememberEventId(event, parsed);
      this.manager.applyPayload(this.domain, this.scope, parsed);
    } catch (error) {
      console.error('Failed to parse event stream payload', error);
    }
  };

  private handleError = () => {
    if (this.closed) {
      return;
    }
    this.manager.handleStreamError(this.domain, this.scope, 'Event stream connection lost');
    this.scheduleReconnect();
  };

  private getResumeId(): string | null {
    if (!this.lastEventId) {
      return null;
    }
    const parsed = Number(this.lastEventId);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return String(parsed);
  }

  private rememberEventId(event: MessageEvent, payload: StreamEventPayload): void {
    const raw = event.lastEventId?.trim();
    if (raw) {
      this.lastEventId = raw;
      return;
    }
    if (typeof payload.sequence === 'number' && Number.isFinite(payload.sequence)) {
      this.lastEventId = String(payload.sequence);
    }
  }
}

// Include cluster identity in the dedupe key so multi-cluster streams don't collapse events.
const sortKey = (entry: ClusterEventEntry | NamespaceEventSummary) =>
  `${entry.clusterId || ''}|${entry.namespace || ''}|${entry.kind || ''}|${entry.name || ''}|${entry.reason || ''}|${entry.message || ''}`;

export class EventStreamManager {
  private clusterConnection: EventStreamConnection | null = null;
  private clusterScope: string | null = null;
  private clusterEvents: ClusterEventEntry[] = [];
  private clusterUpdateScheduled = false;
  private pendingClusterState: {
    generatedAt: number;
    error: string | null;
    total: number;
    truncated: boolean;
  } | null = null;
  private clusterEventMeta: { total: number; truncated: boolean } = { total: 0, truncated: false };

  private namespaceConnection: EventStreamConnection | null = null;
  private namespaceScope: string | null = null;
  private namespaceEvents = new Map<string, NamespaceEventSummary[]>();
  private namespaceUpdateScheduled = new Set<string>();
  private pendingNamespaceState = new Map<
    string,
    { generatedAt: number; error: string | null; total: number; truncated: boolean }
  >();
  private namespaceEventMeta = new Map<string, { total: number; truncated: boolean }>();
  private lastNotifiedErrors = new Map<string, string>();
  private consecutiveErrors = new Map<string, number>();
  private suspendedForVisibility = false;
  private suspendedClusterScope: string | null = null;
  private suspendedNamespaceScope: string | null = null;

  constructor() {
    eventBus.on('kubeconfig:changing', () => this.stopAll(true));
    eventBus.on('view:reset', () => this.stopAll(false));
    eventBus.on('app:visibility-hidden', () => this.suspendForVisibility());
    eventBus.on('app:visibility-visible', () => this.resumeFromVisibility());
  }

  private suspendForVisibility(): void {
    if (this.suspendedForVisibility) {
      return;
    }
    this.suspendedForVisibility = true;

    // Store active scopes before stopping
    this.suspendedClusterScope = this.clusterScope;
    this.suspendedNamespaceScope = this.namespaceScope;

    // Stop connections without resetting data
    if (this.clusterConnection) {
      this.clusterConnection.stop(false);
      this.clusterConnection = null;
    }
    if (this.namespaceConnection) {
      this.namespaceConnection.stop(false);
      this.namespaceConnection = null;
    }
  }

  private resumeFromVisibility(): void {
    if (!this.suspendedForVisibility) {
      return;
    }
    this.suspendedForVisibility = false;

    // Restore cluster stream if it was active
    if (this.suspendedClusterScope) {
      void this.startCluster(this.suspendedClusterScope);
    }
    this.suspendedClusterScope = null;

    // Restore namespace stream if it was active
    if (this.suspendedNamespaceScope) {
      void this.startNamespace(this.suspendedNamespaceScope);
    }
    this.suspendedNamespaceScope = null;
  }

  private getNotificationKey(domain: string, scope?: string): string {
    return `${domain}::${scope ?? '__global__'}`;
  }

  private notifyStreamError(domain: string, scope: string | undefined, message: string): void {
    const key = this.getNotificationKey(domain, scope);
    if (this.lastNotifiedErrors.get(key) === message) {
      return;
    }
    this.lastNotifiedErrors.set(key, message);
    errorHandler.handle(new Error(message), {
      source: 'refresh-event-stream',
      domain,
      scope: scope ?? 'global',
    });
  }

  private clearStreamError(domain: string, scope?: string): void {
    const key = this.getNotificationKey(domain, scope);
    if (this.lastNotifiedErrors.has(key)) {
      this.lastNotifiedErrors.delete(key);
    }
    this.consecutiveErrors.delete(key);
  }

  async startCluster(scope: string = CLUSTER_SCOPE): Promise<void> {
    const normalizedScope = scope.trim() || CLUSTER_SCOPE;
    if (this.clusterConnection) {
      this.clusterConnection.stop(false);
    }
    this.clusterScope = normalizedScope;
    this.clusterConnection = new EventStreamConnection(CLUSTER_DOMAIN, normalizedScope, this);
    this.markLoading(CLUSTER_DOMAIN, normalizedScope);
    await this.clusterConnection.start();
  }

  stopCluster(scope: string | null, reset = false): void {
    if (this.clusterConnection) {
      this.clusterConnection.stop(reset);
      this.clusterConnection = null;
    }
    if (scope && scope.trim()) {
      this.clusterScope = scope.trim();
    }
    if (reset) {
      this.clusterEvents = [];
      this.clusterEventMeta = { total: 0, truncated: false };
      resetDomainState(CLUSTER_DOMAIN);
      this.clusterScope = null;
    }
  }

  async refreshCluster(scope: string): Promise<void> {
    this.stopCluster(scope, false);
    await this.startCluster(scope);
  }

  async startNamespace(scope: string): Promise<void> {
    const normalizedScope = scope.trim();
    if (!normalizedScope) {
      return;
    }
    if (this.namespaceConnection) {
      this.namespaceConnection.stop(false);
      this.namespaceConnection = null;
    }
    this.namespaceScope = normalizedScope;
    this.markLoading(NAMESPACE_DOMAIN, normalizedScope);
    this.namespaceConnection = new EventStreamConnection(NAMESPACE_DOMAIN, normalizedScope, this);
    await this.namespaceConnection.start();
  }

  stopNamespace(scope: string | null, reset = false): void {
    if (this.namespaceConnection) {
      this.namespaceConnection.stop(reset);
      this.namespaceConnection = null;
    }
    const activeScope = scope?.trim() || this.namespaceScope;
    if (reset && activeScope) {
      this.namespaceEvents.delete(activeScope);
      this.namespaceEventMeta.delete(activeScope);
      resetDomainState(NAMESPACE_DOMAIN);
    }
    if (reset) {
      this.namespaceScope = null;
    }
  }

  async refreshNamespace(scope: string): Promise<void> {
    const normalizedScope = scope.trim();
    if (!normalizedScope) {
      return;
    }
    this.stopNamespace(normalizedScope, false);
    await this.startNamespace(normalizedScope);
  }

  applyPayload(domain: string, scope: string, payload: StreamEventPayload): void {
    const generatedAt = payload.generatedAt || Date.now();
    const events = payload.events ?? [];
    const payloadTotal = typeof payload.total === 'number' ? payload.total : undefined;
    const payloadTruncated = typeof payload.truncated === 'boolean' ? payload.truncated : undefined;
    if (!payload.reset && events.length === 0 && !payload.error) {
      return;
    }
    if (domain === CLUSTER_DOMAIN) {
      const incoming = events.map(transformClusterEvent);
      const { items, total, truncated } = payload.reset
        ? mergeEvents([], incoming, MAX_CLUSTER_EVENTS)
        : mergeEvents(this.clusterEvents, incoming, MAX_CLUSTER_EVENTS);
      const resolvedTotal =
        payloadTotal !== undefined ? Math.max(payloadTotal, items.length) : total;
      const resolvedTruncated = payloadTruncated !== undefined ? payloadTruncated : truncated;
      this.clusterEvents = items.map(normalizeClusterEntry);
      this.clusterEventMeta = { total: resolvedTotal, truncated: resolvedTruncated };
      this.scheduleClusterStateUpdate(generatedAt, payload.error ?? null);
      return;
    }

    if (domain === NAMESPACE_DOMAIN) {
      const incoming = events.map(transformNamespaceEvent);
      const existing = this.namespaceEvents.get(scope) ?? [];
      const { items, total, truncated } = payload.reset
        ? mergeEvents([], incoming, MAX_NAMESPACE_EVENTS)
        : mergeEvents(existing, incoming, MAX_NAMESPACE_EVENTS);
      const resolvedTotal =
        payloadTotal !== undefined ? Math.max(payloadTotal, items.length) : total;
      const resolvedTruncated = payloadTruncated !== undefined ? payloadTruncated : truncated;
      this.namespaceEvents.set(scope, items.map(normalizeNamespaceEntry));
      this.namespaceEventMeta.set(scope, { total: resolvedTotal, truncated: resolvedTruncated });
      this.scheduleNamespaceStateUpdate(scope, generatedAt, payload.error ?? null);
    }
  }

  handleStreamError(domain: string, scope: string, message: string): void {
    const key = this.getNotificationKey(domain, scope);
    const attempts = (this.consecutiveErrors.get(key) ?? 0) + 1;
    this.consecutiveErrors.set(key, attempts);
    const isTerminal = attempts >= STREAM_ERROR_NOTIFY_THRESHOLD;
    const resyncing = RESYNC_STATE_ENABLED && !isTerminal;

    if (domain === CLUSTER_DOMAIN) {
      setDomainState(CLUSTER_DOMAIN, (previous) => ({
        ...previous,
        status: isTerminal
          ? 'error'
          : resyncing
            ? 'updating'
            : previous.status === 'ready'
              ? 'ready'
              : 'updating',
        error: isTerminal ? message : resyncing ? STREAM_RESYNC_MESSAGE : null,
        scope,
      }));
      if (isTerminal) {
        this.notifyStreamError(CLUSTER_DOMAIN, scope, message);
      }
      return;
    }
    if (domain === NAMESPACE_DOMAIN) {
      setDomainState(NAMESPACE_DOMAIN, (previous) => ({
        ...previous,
        status: isTerminal
          ? 'error'
          : resyncing
            ? 'updating'
            : previous.status === 'ready'
              ? 'ready'
              : 'updating',
        error: isTerminal ? message : resyncing ? STREAM_RESYNC_MESSAGE : null,
        scope,
      }));
      if (isTerminal) {
        this.notifyStreamError(NAMESPACE_DOMAIN, scope, message);
      }
    }
  }

  markConnected(domain: string, scope: string): void {
    if (domain === CLUSTER_DOMAIN) {
      const generatedAt = Date.now();
      const payload: ClusterEventsSnapshotPayload = {
        events: this.clusterEvents,
      };
      const stats = this.buildStats(
        this.clusterEvents.length,
        this.clusterEventMeta.total,
        this.clusterEventMeta.truncated,
        'events'
      );
      setDomainState(CLUSTER_DOMAIN, (previous) => ({
        ...previous,
        status: 'ready',
        data: payload,
        stats,
        error: null,
        lastUpdated: generatedAt,
        lastAutoRefresh: generatedAt,
        isManual: false,
        scope,
      }));
      this.clearStreamError(CLUSTER_DOMAIN, scope);
      return;
    }
    if (domain === NAMESPACE_DOMAIN) {
      const generatedAt = Date.now();
      const events = this.namespaceEvents.get(scope) ?? [];
      const payload: NamespaceEventsSnapshotPayload = {
        events,
      };
      const meta = this.namespaceEventMeta.get(scope) ?? { total: events.length, truncated: false };
      const stats = this.buildStats(events.length, meta.total, meta.truncated, 'events');
      setDomainState(NAMESPACE_DOMAIN, (previous) => ({
        ...previous,
        status: 'ready',
        data: payload,
        stats,
        error: null,
        lastUpdated: generatedAt,
        lastAutoRefresh: generatedAt,
        isManual: false,
        scope,
      }));
      this.clearStreamError(NAMESPACE_DOMAIN, scope);
    }
  }

  markIdle(domain: string, scope: string, reset: boolean): void {
    if (domain === CLUSTER_DOMAIN) {
      const activeScope = scope?.trim() || this.clusterScope || CLUSTER_SCOPE;
      if (reset) {
        resetDomainState(CLUSTER_DOMAIN);
        this.clusterEvents = [];
        this.pendingClusterState = null;
        this.clusterUpdateScheduled = false;
        this.clearStreamError(CLUSTER_DOMAIN, activeScope);
        return;
      }
      setDomainState(CLUSTER_DOMAIN, (previous) => ({
        ...previous,
        status: previous.status === 'ready' ? 'ready' : 'idle',
        stats: this.buildStats(
          this.clusterEvents.length,
          this.clusterEventMeta.total,
          this.clusterEventMeta.truncated,
          'events'
        ),
        scope: activeScope,
      }));
      this.clearStreamError(CLUSTER_DOMAIN, activeScope);
      return;
    }

    if (domain === NAMESPACE_DOMAIN) {
      if (reset) {
        resetDomainState(NAMESPACE_DOMAIN);
        this.namespaceEvents.delete(scope);
        this.pendingNamespaceState.delete(scope);
        this.namespaceUpdateScheduled.delete(scope);
        this.clearStreamError(NAMESPACE_DOMAIN, scope);
        return;
      }
      setDomainState(NAMESPACE_DOMAIN, (previous) => ({
        ...previous,
        status: previous.status === 'ready' ? 'ready' : 'idle',
        stats: this.buildStats(
          (this.namespaceEvents.get(scope) ?? []).length,
          (this.namespaceEventMeta.get(scope) ?? { total: 0, truncated: false }).total,
          (this.namespaceEventMeta.get(scope) ?? { total: 0, truncated: false }).truncated,
          'events'
        ),
        scope,
      }));
      this.clearStreamError(NAMESPACE_DOMAIN, scope);
    }
  }

  stopAll(reset = false): void {
    this.stopCluster(this.clusterScope, reset);
    this.stopNamespace(this.namespaceScope, reset);
    if (reset) {
      this.namespaceEvents.clear();
      this.namespaceEventMeta.clear();
    }
  }

  private buildStats(
    count: number,
    total: number,
    truncated: boolean,
    label: string = 'items'
  ): SnapshotStats | null {
    const safeTotal = total > 0 ? total : count;
    const warnings: string[] = [];
    if (truncated && count < safeTotal) {
      warnings.push(`Showing most recent ${count} of ${safeTotal} ${label}`);
    }
    return {
      itemCount: count,
      buildDurationMs: 0,
      totalItems: truncated || safeTotal !== count ? safeTotal : undefined,
      truncated,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  private markLoading(domain: string, scope?: string): void {
    if (domain === CLUSTER_DOMAIN) {
      const activeScope = scope?.trim() || this.clusterScope || CLUSTER_SCOPE;
      setDomainState(CLUSTER_DOMAIN, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'loading',
        error: null,
        scope: activeScope,
      }));
      this.clearStreamError(CLUSTER_DOMAIN, activeScope);
      return;
    }
    if (domain === NAMESPACE_DOMAIN) {
      setDomainState(NAMESPACE_DOMAIN, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'loading',
        error: null,
        scope,
      }));
      if (scope) {
        this.clearStreamError(NAMESPACE_DOMAIN, scope);
      }
    }
  }

  private updateClusterState(
    generatedAt: number,
    error: string | null,
    totalItems: number,
    truncated: boolean
  ): void {
    const activeScope = this.clusterScope ?? CLUSTER_SCOPE;
    const payload: ClusterEventsSnapshotPayload = {
      events: this.clusterEvents,
    };
    const stats = this.buildStats(this.clusterEvents.length, totalItems, truncated, 'events');
    setDomainState(CLUSTER_DOMAIN, (previous) => ({
      ...previous,
      status: error ? 'error' : 'ready',
      data: payload,
      stats,
      error,
      lastUpdated: generatedAt,
      lastAutoRefresh: generatedAt,
      isManual: false,
      scope: activeScope,
    }));
    if (error) {
      this.notifyStreamError(CLUSTER_DOMAIN, activeScope, error);
    } else {
      this.clearStreamError(CLUSTER_DOMAIN, activeScope);
    }
  }

  private updateNamespaceState(
    scope: string,
    generatedAt: number,
    error: string | null,
    totalItems: number,
    truncated: boolean
  ): void {
    const events = this.namespaceEvents.get(scope) ?? [];
    const payload: NamespaceEventsSnapshotPayload = {
      events,
    };
    const stats = this.buildStats(events.length, totalItems, truncated, 'events');
    setDomainState(NAMESPACE_DOMAIN, (previous) => ({
      ...previous,
      status: error ? 'error' : 'ready',
      data: payload,
      stats,
      error,
      lastUpdated: generatedAt,
      lastAutoRefresh: generatedAt,
      isManual: false,
      scope,
    }));
    if (error) {
      this.notifyStreamError(NAMESPACE_DOMAIN, scope, error);
    } else {
      this.clearStreamError(NAMESPACE_DOMAIN, scope);
    }
  }

  private scheduleClusterStateUpdate(generatedAt: number, error: string | null): void {
    this.pendingClusterState = {
      generatedAt,
      error,
      total: this.clusterEventMeta.total,
      truncated: this.clusterEventMeta.truncated,
    };
    if (this.clusterUpdateScheduled) {
      return;
    }
    this.clusterUpdateScheduled = true;
    queueMicrotaskSafe(() => {
      this.clusterUpdateScheduled = false;
      if (!this.pendingClusterState) {
        return;
      }
      const pending = this.pendingClusterState;
      this.pendingClusterState = null;
      this.updateClusterState(pending.generatedAt, pending.error, pending.total, pending.truncated);
    });
  }

  private scheduleNamespaceStateUpdate(
    scope: string,
    generatedAt: number,
    error: string | null
  ): void {
    const meta = this.namespaceEventMeta.get(scope) ?? { total: 0, truncated: false };
    this.pendingNamespaceState.set(scope, {
      generatedAt,
      error,
      total: meta.total,
      truncated: meta.truncated,
    });
    if (this.namespaceUpdateScheduled.has(scope)) {
      return;
    }
    this.namespaceUpdateScheduled.add(scope);
    queueMicrotaskSafe(() => {
      this.namespaceUpdateScheduled.delete(scope);
      const pending = this.pendingNamespaceState.get(scope);
      if (!pending) {
        return;
      }
      this.pendingNamespaceState.delete(scope);
      this.updateNamespaceState(
        scope,
        pending.generatedAt,
        pending.error,
        pending.total,
        pending.truncated
      );
    });
  }
}

function queueMicrotaskSafe(callback: () => void): void {
  if (typeof window !== 'undefined') {
    window.setTimeout(callback, 0);
    return;
  }
  setTimeout(callback, 0);
}

type StreamEventItem = NonNullable<StreamEventPayload['events']>[number];

function transformClusterEvent(event: StreamEventItem): ClusterEventEntry {
  const timestamp = deriveEventTimestamp(event);
  const objectKind = event?.kind || 'Event';
  return {
    kind: 'Event',
    kindAlias: objectKind,
    // Preserve cluster metadata for multi-cluster filtering and object navigation.
    clusterId: event?.clusterId,
    clusterName: event?.clusterName,
    name: event?.name || '',
    namespace: event?.namespace || '',
    objectNamespace: event?.objectNamespace ?? '',
    type: event?.type || '-',
    source: event?.source || '-',
    reason: event?.reason || '-',
    object: event?.object || '-',
    message: event?.message || '',
    age: event?.age || formatAge(timestamp),
    ageTimestamp: timestamp,
  };
}

function transformNamespaceEvent(event: StreamEventItem): NamespaceEventSummary {
  const timestamp = deriveEventTimestamp(event);
  const objectKind = event?.kind || 'Event';
  return {
    kind: 'Event',
    kindAlias: objectKind,
    // Preserve cluster metadata for multi-cluster filtering and object navigation.
    clusterId: event?.clusterId,
    clusterName: event?.clusterName,
    name: event?.name || '',
    namespace: event?.namespace || '',
    objectNamespace: event?.objectNamespace ?? '',
    type: event?.type || '-',
    source: event?.source || '-',
    reason: event?.reason || '-',
    object: event?.object || '-',
    message: event?.message || '',
    age: event?.age || formatAge(timestamp),
    ageTimestamp: timestamp,
  };
}

function mergeEvents<T extends ClusterEventEntry | NamespaceEventSummary>(
  existing: T[],
  incoming: T[],
  maxSize: number
): { items: T[]; total: number; truncated: boolean } {
  const map = new Map<string, T>();
  let total = 0;
  let truncated = false;

  const merged = [...incoming, ...existing];
  for (const item of merged) {
    const key = sortKey(item);
    if (map.has(key)) {
      continue;
    }
    total++;
    if (map.size < maxSize) {
      map.set(key, item);
    } else {
      truncated = true;
    }
  }

  return {
    items: Array.from(map.values()),
    total,
    truncated,
  };
}

function deriveEventTimestamp(event?: StreamEventItem): number {
  if (!event) {
    return Date.now();
  }

  const rawCreated = event.createdAt;
  if (typeof rawCreated === 'number' && Number.isFinite(rawCreated) && rawCreated > 0) {
    return normalizeEpoch(rawCreated);
  }

  if (typeof rawCreated === 'string' && rawCreated) {
    const parsed = Number(rawCreated);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return normalizeEpoch(parsed);
    }
  }

  const ageMs = parseAgeToMs(event.age ?? null);
  if (ageMs !== null) {
    return Date.now() - ageMs;
  }

  return Date.now();
}

function normalizeEpoch(value: number): number {
  return value < 100_000_000_000 ? value * 1000 : value;
}

function parseAgeToMs(age: string | null): number | null {
  if (!age) {
    return null;
  }

  if (age === 'now') {
    return 0;
  }

  const match = age.match(/^([0-9]+)([a-zA-Z]+)$/);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }

  const unit = match[2].toLowerCase();
  const unitMsMap: Record<string, number> = {
    s: 1000,
    sec: 1000,
    m: 60_000,
    min: 60_000,
    h: 3_600_000,
    hr: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    mo: 2_592_000_000,
    y: 31_536_000_000,
  };

  const unitMs = unitMsMap[unit];
  if (!unitMs) {
    return null;
  }

  return value * unitMs;
}

function normalizeClusterEntry(entry: ClusterEventEntry): ClusterEventEntry {
  const timestamp = entry.ageTimestamp ?? deriveFromExistingAge(entry.age);
  const kindAlias = entry.kindAlias || entry.kind || 'Event';

  return {
    ...entry,
    kind: 'Event',
    kindAlias,
    ageTimestamp: timestamp,
    age: formatAge(timestamp),
  };
}

function normalizeNamespaceEntry(entry: NamespaceEventSummary): NamespaceEventSummary {
  const timestamp = entry.ageTimestamp ?? deriveFromExistingAge(entry.age);
  const kindAlias = entry.kindAlias || entry.kind || 'Event';

  return {
    ...entry,
    kind: 'Event',
    kindAlias,
    ageTimestamp: timestamp,
    age: formatAge(timestamp),
  };
}

function deriveFromExistingAge(age: string | undefined): number {
  const ageMs = parseAgeToMs(age ?? null);
  if (ageMs !== null) {
    return Date.now() - ageMs;
  }
  return Date.now();
}

export const eventStreamManager = new EventStreamManager();
