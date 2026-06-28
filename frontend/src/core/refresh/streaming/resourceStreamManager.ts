/**
 * frontend/src/core/refresh/streaming/resourceStreamManager.ts
 *
 * Coordinates resource WebSocket subscriptions and resyncs for refresh domains
 * that receive live change signals. Every streamed table is query-backed, so a
 * delta (or a resync) advances the domain source token to trigger a refetch
 * rather than delivering rows over the bridge.
 */

import { setScopedDomainState } from '../store';
import type { PermissionDeniedStatus } from '../types';
import { stripClusterScope } from '../clusterScope';
import { eventBus } from '@/core/events';
import {
  APP_LOG_SOURCES,
  logAppLogsInfo,
  type AppLogsClusterMeta,
} from '@/core/logging/appLogsClient';
import { resolvePermissionDeniedMessage } from '../permissionErrors';
import {
  domainSupportsSourceClock,
  isResourceStreamSourceClock,
  isCompleteResyncStreamDomain,
  isClusterScopedDomain,
  isSupportedDomain,
  type DoorbellDomain,
  type ResourceStreamSourceClock,
} from './resourceStreamDomains';
import { ResourceStreamConnection } from './resourceStreamConnection';
import {
  ResourceStreamSubscriptionStore,
  resourceStreamSubscriptionKey,
  type StreamSubscription,
} from './resourceStreamSubscriptions';
import { StreamErrorNotifier } from './streamErrorNotifier';
import { StreamVisibilityController } from './streamVisibilityController';
import {
  ResourceStreamHealthStore,
  STREAM_HEALTH_STATUS_ORDER,
  type ResourceStreamConnectionStatus,
  type ResourceStreamHealthPayload,
  type ResourceStreamHealthStatus,
} from './resourceStreamHealth';

export { normalizeResourceScope } from './resourceStreamDomains';

const UPDATE_COALESCE_MS = 150;
const RESYNC_COOLDOWN_MS = 1000;
const RESYNC_MESSAGE = 'Stream resyncing';
// Linger stream stops briefly to avoid rapid subscribe/unsubscribe churn.
const STREAM_UNSUBSCRIBE_DEBOUNCE_MS = 500;
// Cap queued updates to avoid unbounded memory growth under bursty streams.
const MAX_UPDATE_QUEUE = 1000;

const logInfo = (message: string, cluster?: AppLogsClusterMeta): void => {
  logAppLogsInfo(message, APP_LOG_SOURCES.ResourceStream, cluster);
};

const MESSAGE_TYPES = {
  request: 'REQUEST',
  cancel: 'CANCEL',
  heartbeat: 'HEARTBEAT',
  reset: 'RESET',
  complete: 'COMPLETE',
  error: 'ERROR',
  added: 'ADDED',
  modified: 'MODIFIED',
  deleted: 'DELETED',
} as const;

type StreamMessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

const SIGNAL_TYPES = {
  changed: 'changed',
  reset: 'reset',
  error: 'error',
} as const;

type StreamSignalType = (typeof SIGNAL_TYPES)[keyof typeof SIGNAL_TYPES];

type SignalEnvelope = {
  clusterId: string;
  source: ResourceStreamSourceClock;
  signal: StreamSignalType;
  version: string;
};

type ServerMessage = {
  type?: StreamMessageType;
  clusterId?: string;
  clusterName?: string;
  domain?: string;
  scope?: string;
  source?: string;
  signal?: string;
  version?: string;
  resourceVersion?: string;
  sequence?: string;
  ref?: {
    clusterId: string;
    group: string;
    version: string;
    kind: string;
    resource?: string;
    namespace?: string;
    name?: string;
    uid?: string;
  };
  error?: string;
  errorDetails?: PermissionDeniedStatus;
};

type UpdateMessage = ServerMessage & {
  domain: DoorbellDomain;
  scope: string;
  signalEnvelope?: SignalEnvelope;
};

const hasMessageType = (value: unknown): value is StreamMessageType =>
  typeof value === 'string' && Object.values(MESSAGE_TYPES).includes(value as StreamMessageType);

const hasSignalType = (value: unknown): value is StreamSignalType =>
  typeof value === 'string' && Object.values(SIGNAL_TYPES).includes(value as StreamSignalType);

const normalizeStreamScope = (domain: DoorbellDomain, scope: unknown): string | null => {
  if (typeof scope === 'string') {
    const trimmed = scope.trim();
    const normalized = stripClusterScope(trimmed);
    if (normalized || isClusterScopedDomain(domain)) {
      return normalized;
    }
    return null;
  }
  // Cluster-scoped updates omit scope in JSON, so treat missing scope as empty.
  if (scope == null && isClusterScopedDomain(domain)) {
    return '';
  }
  return null;
};

const resolveUpdateMessage = (message: ServerMessage): UpdateMessage | null => {
  if (!isSupportedDomain(message.domain)) {
    return null;
  }
  const normalizedScope = normalizeStreamScope(message.domain, message.scope);
  if (normalizedScope === null) {
    return null;
  }
  const source = message.source;
  const signal = message.signal;
  const version = message.version?.trim();
  const signalClusterId = message.clusterId?.trim();
  const signalEnvelope =
    signalClusterId &&
    version &&
    isResourceStreamSourceClock(source) &&
    domainSupportsSourceClock(message.domain, source) &&
    hasSignalType(signal)
      ? { clusterId: signalClusterId, source, signal, version }
      : undefined;
  if (!hasMessageType(message.type) && !signalEnvelope) {
    return null;
  }
  return { ...message, domain: message.domain, scope: normalizedScope, signalEnvelope };
};

const normalizeUpdateClusterId = (update: UpdateMessage, clusterId: string): UpdateMessage => {
  if (!clusterId) {
    return update;
  }
  const messageClusterId = update.clusterId?.trim();
  if (messageClusterId && messageClusterId === clusterId) {
    return update;
  }
  return { ...update, clusterId };
};

const parseResourceVersion = (value?: string | number): bigint | null => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    // Avoid precision loss from JSON numbers that exceed safe integer limits.
    if (!Number.isSafeInteger(value)) {
      return null;
    }
    return BigInt(Math.floor(value));
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return BigInt(trimmed);
  } catch (_err) {
    return null;
  }
};

// Stream sequence parsing mirrors resourceVersion semantics for resume tokens.
const parseStreamSequence = (value?: string | number): bigint | null => parseResourceVersion(value);

export type ResourceStreamTelemetrySummary = {
  resyncCount: number;
  fallbackCount: number;
  lastResyncAt?: number;
  lastResyncReason?: string;
  lastFallbackAt?: number;
  lastFallbackReason?: string;
};

type StreamTelemetry = {
  // Cluster + resource domain this subscription's resync/fallback counters belong
  // to, so the diagnostics Streams view can report them per cluster and per domain.
  clusterId: string;
  domain: string;
  resyncCount: number;
  fallbackCount: number;
  lastResyncAt?: number;
  lastResyncReason?: string;
  lastFallbackAt?: number;
  lastFallbackReason?: string;
};

// accumulateStreamTelemetry folds one subscription's stats into a running summary
// (shared by the global and per-cluster summaries).
const accumulateStreamTelemetry = (
  summary: ResourceStreamTelemetrySummary,
  stats: StreamTelemetry
): void => {
  summary.resyncCount += stats.resyncCount;
  summary.fallbackCount += stats.fallbackCount;
  if (stats.lastResyncAt && stats.lastResyncAt > (summary.lastResyncAt ?? 0)) {
    summary.lastResyncAt = stats.lastResyncAt;
    summary.lastResyncReason = stats.lastResyncReason;
  }
  if (stats.lastFallbackAt && stats.lastFallbackAt > (summary.lastFallbackAt ?? 0)) {
    summary.lastFallbackAt = stats.lastFallbackAt;
    summary.lastFallbackReason = stats.lastFallbackReason;
  }
};

export class ResourceStreamManager {
  private subscriptions = new ResourceStreamSubscriptionStore(
    STREAM_UNSUBSCRIBE_DEBOUNCE_MS,
    logInfo
  );
  // Single socket used to multiplex subscriptions across clusters.
  private connection: ResourceStreamConnection | null = null;
  private connectionStatus: ResourceStreamConnectionStatus = 'disconnected';
  private connectionEpoch = 0;
  private lastConnectionError = '';
  private streamHealth = new ResourceStreamHealthStore();
  private errorNotifier = new StreamErrorNotifier();
  private legacyResyncVersionCounter = 0;
  private visibility = new StreamVisibilityController<StreamSubscription>({
    captureActive: () => Array.from(this.subscriptions.values()),
    suspendActive: () => {
      this.markConnectionError('visibility hidden');
      this.connection?.pause();
    },
    resumeItems: () => Array.from(this.subscriptions.values()),
    resumeItem: (subscription) => {
      this.markResyncing(subscription);
      void this.resyncSubscription(subscription, 'visibility resume');
    },
  });
  private streamTelemetry = new Map<string, StreamTelemetry>();

  constructor() {
    eventBus.on('kubeconfig:changing', () => this.stopAll(true));
    eventBus.on('view:reset', () => this.stopAll(false));
    eventBus.on('app:visibility-hidden', () => this.suspendForVisibility());
    eventBus.on('app:visibility-visible', () => this.resumeFromVisibility());
  }

  // Aggregate stream telemetry so diagnostics can display resync/fallback activity.
  getTelemetrySummary(): ResourceStreamTelemetrySummary {
    const summary: ResourceStreamTelemetrySummary = {
      resyncCount: 0,
      fallbackCount: 0,
    };
    this.streamTelemetry.forEach((stats) => accumulateStreamTelemetry(summary, stats));
    return summary;
  }

  // Per-(cluster, domain) resync/fallback summaries for the per-domain Streams
  // rows. Keyed `${clusterId}::${domain}` (scopes of a domain are summed).
  getTelemetrySummaryByClusterDomain(): Record<string, ResourceStreamTelemetrySummary> {
    const byClusterDomain: Record<string, ResourceStreamTelemetrySummary> = {};
    this.streamTelemetry.forEach((stats) => {
      const key = `${stats.clusterId}::${stats.domain}`;
      const summary = (byClusterDomain[key] ??= { resyncCount: 0, fallbackCount: 0 });
      accumulateStreamTelemetry(summary, stats);
    });
    return byClusterDomain;
  }

  // Expose per-scope health so refresh gating can keep snapshots running until delivery resumes.
  getHealthStatus(domain: DoorbellDomain, scope: string): ResourceStreamHealthStatus {
    return this.streamHealth.status(domain, scope);
  }

  getHealthSnapshot(domain: string, scope: string): ResourceStreamHealthPayload | null {
    return this.streamHealth.snapshot(domain, scope);
  }

  isHealthy(domain: DoorbellDomain, scope: string): boolean {
    return this.getHealthStatus(domain, scope) === 'healthy';
  }

  async start(domain: DoorbellDomain, scope: string): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }
    const subscriptions = this.ensureSubscriptions(domain, scope);
    await Promise.all(
      subscriptions.map((subscription) => this.resyncSubscription(subscription, 'initial'))
    );
  }

  stop(domain: DoorbellDomain, scope: string, reset = false): void {
    const subscriptions = this.releaseSubscriptions(domain, scope);
    if (subscriptions.length === 0) {
      return;
    }
    subscriptions.forEach((subscription) => this.scheduleUnsubscribe(subscription, reset));
  }

  async refreshOnce(domain: DoorbellDomain, scope: string): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }
    const subscriptions = this.ensureSubscriptions(domain, scope);
    await Promise.all(
      subscriptions.map((subscription) =>
        this.resyncSubscription(subscription, 'manual refresh', true)
      )
    );
  }

  handleMessage(clusterId: string, raw: string): void {
    let parsed: ServerMessage | null = null;
    try {
      parsed = JSON.parse(raw) as ServerMessage;
    } catch (_err) {
      console.error('Invalid resource stream payload');
      return;
    }
    if (!parsed) {
      return;
    }
    const update = resolveUpdateMessage(parsed);
    if (!update) {
      return;
    }
    const messageClusterId =
      update.signalEnvelope?.clusterId ?? update.clusterId?.trim() ?? clusterId;
    if (!messageClusterId) {
      return;
    }
    const subscriptionKey = resourceStreamSubscriptionKey(
      messageClusterId,
      update.domain,
      update.scope
    );
    let subscription = this.subscriptions.get(subscriptionKey);
    let resolvedUpdate = update;
    if (!subscription) {
      if (update.signalEnvelope) {
        return;
      }
      // Fall back when cluster IDs drift but the scope/domain pair is unique.
      subscription = this.findSubscriptionByScope(update.domain, update.scope);
      if (!subscription) {
        return;
      }
      resolvedUpdate = normalizeUpdateClusterId(update, subscription.clusterId);
    }
    const errorMessage = resolvePermissionDeniedMessage(update.error, update.errorDetails);
    this.recordSubscriptionMessage(subscription);

    if (resolvedUpdate.signalEnvelope) {
      switch (resolvedUpdate.signalEnvelope.signal) {
        case SIGNAL_TYPES.changed:
          this.handleUpdate(subscription, resolvedUpdate);
          this.updateHealthForSubscription(subscription);
          return;
        case SIGNAL_TYPES.reset:
          if (subscription.pendingReset) {
            subscription.pendingReset = false;
            this.updateHealthForSubscription(subscription);
            return;
          }
          this.bumpSourceVersionOnly(
            subscription,
            Date.now(),
            { [resolvedUpdate.signalEnvelope.source]: resolvedUpdate.signalEnvelope.version },
            resolvedUpdate.signalEnvelope.version
          );
          void this.resyncSubscription(subscription, 'reset');
          this.updateHealthForSubscription(subscription);
          return;
        case SIGNAL_TYPES.error:
          this.recordSubscriptionError(subscription, errorMessage || 'stream error');
          void this.resyncSubscription(subscription, errorMessage || 'stream error', true);
          this.updateHealthForSubscription(subscription);
          return;
        default:
          return;
      }
    }

    switch (resolvedUpdate.type) {
      case MESSAGE_TYPES.heartbeat:
        return;
      case MESSAGE_TYPES.reset:
        if (subscription.pendingReset) {
          subscription.pendingReset = false;
          this.updateHealthForSubscription(subscription);
          return;
        }
        this.bumpLegacyResyncSourceVersion(subscription, resolvedUpdate);
        void this.resyncSubscription(subscription, 'reset');
        this.updateHealthForSubscription(subscription);
        return;
      case MESSAGE_TYPES.complete:
        this.bumpLegacyResyncSourceVersion(subscription, resolvedUpdate);
        void this.resyncSubscription(subscription, errorMessage || 'complete');
        this.updateHealthForSubscription(subscription);
        return;
      case MESSAGE_TYPES.error:
        this.recordSubscriptionError(subscription, errorMessage || 'stream error');
        void this.resyncSubscription(subscription, errorMessage || 'stream error', true);
        this.updateHealthForSubscription(subscription);
        return;
      case MESSAGE_TYPES.added:
      case MESSAGE_TYPES.modified:
      case MESSAGE_TYPES.deleted:
        this.handleUpdate(subscription, resolvedUpdate);
        this.updateHealthForSubscription(subscription);
        return;
      default:
        return;
    }
  }

  private findSubscriptionByScope(
    domain: DoorbellDomain,
    scope: string
  ): StreamSubscription | undefined {
    return this.subscriptions.findByScope(domain, scope);
  }

  handleConnectionOpen(clusterId: string): void {
    const targetClusterId = clusterId.trim();
    // Log when the websocket is connected so it is clear streaming is active.
    logInfo(
      `[resource-stream] connection open clusterId=${targetClusterId || 'all'}`,
      targetClusterId ? { clusterId: targetClusterId } : undefined
    );
    this.markConnectionOpen();
    if (targetClusterId) {
      this.clearStreamError(targetClusterId);
    } else {
      this.clearAllStreamErrors();
    }
    this.subscriptions.forEach((subscription) => {
      if (targetClusterId && subscription.clusterId !== targetClusterId) {
        return;
      }
      this.subscribe(subscription);
      if (subscription.lastSequence && !subscription.resyncInFlight) {
        // Clear resync state when a resume-capable stream reconnects.
        this.markResyncComplete(subscription);
      }
    });
  }

  handleConnectionError(clusterId: string, message: string): void {
    const targetClusterId = clusterId.trim();
    this.markConnectionError(message);
    this.subscriptions.forEach((subscription) => {
      if (targetClusterId && subscription.clusterId !== targetClusterId) {
        return;
      }
      this.markResyncing(subscription);
      if (!subscription.lastSequence) {
        void this.resyncSubscription(subscription, message);
      }
    });
  }

  private suspendForVisibility(): void {
    this.visibility.suspend();
  }

  private resumeFromVisibility(): void {
    this.connection?.resume();
    this.visibility.resume();
  }

  private ensureSubscriptions(domain: DoorbellDomain, scope: string): StreamSubscription[] {
    const subscriptions = this.subscriptions.ensure(domain, scope);
    subscriptions.forEach((subscription) => this.updateHealthForSubscription(subscription));
    return subscriptions;
  }

  private releaseSubscriptions(domain: DoorbellDomain, scope: string): StreamSubscription[] {
    return this.subscriptions.release(domain, scope);
  }

  private getConnection(): ResourceStreamConnection {
    if (this.connection) {
      return this.connection;
    }
    const connection = new ResourceStreamConnection(this);
    this.connection = connection;
    void connection.connect();
    return connection;
  }

  private subscribe(subscription: StreamSubscription): void {
    // Avoid re-subscribing while a debounced stop is pending.
    if (this.subscriptions.hasPendingUnsubscribe(subscription)) {
      return;
    }
    const connection = this.getConnection();
    connection.send(this.subscriptions.buildRequestMessage(subscription));
  }

  private unsubscribe(subscription: StreamSubscription, reset: boolean): void {
    this.subscriptions.cancelPendingUnsubscribe(subscription);
    const connection = this.connection;
    if (connection) {
      connection.send(this.subscriptions.buildCancelMessage(subscription));
    }

    if (subscription.updateTimer !== null) {
      window.clearTimeout(subscription.updateTimer);
    }
    this.subscriptions.delete(subscription);
    this.updateHealthForSubscription(subscription);

    if (reset) {
      this.clearStreamError(subscription.clusterId);
    }

    if (this.subscriptions.size === 0 && connection) {
      connection.close();
      this.connection = null;
      this.markConnectionError('stream stopped');
    }
  }

  private scheduleUnsubscribe(subscription: StreamSubscription, reset: boolean): void {
    this.subscriptions.scheduleUnsubscribe(subscription, reset, (target, shouldReset) =>
      this.unsubscribe(target, shouldReset)
    );
  }

  private recordSubscriptionMessage(subscription: StreamSubscription): void {
    subscription.lastMessageAt = Date.now();
  }

  private markSubscriptionDelivery(subscription: StreamSubscription): void {
    subscription.lastDeliveryAt = Date.now();
    subscription.lastDeliveryEpoch = this.connectionEpoch;
  }

  private recordSubscriptionError(subscription: StreamSubscription, message: string): void {
    subscription.lastErrorAt = Date.now();
    subscription.lastErrorReason = message;
  }

  private computeSubscriptionHealth(subscription: StreamSubscription): {
    status: ResourceStreamHealthStatus;
    reason: string;
  } {
    if (this.connectionStatus !== 'connected') {
      const reason = this.lastConnectionError || 'stream disconnected';
      return { status: 'unhealthy', reason };
    }
    // Keep the stream unhealthy until a delivery arrives after the last error.
    if (subscription.lastErrorAt && subscription.lastErrorAt > (subscription.lastDeliveryAt ?? 0)) {
      return { status: 'unhealthy', reason: subscription.lastErrorReason || 'stream error' };
    }
    if (subscription.resyncInFlight) {
      return { status: 'degraded', reason: 'resyncing' };
    }
    if (subscription.lastDeliveryEpoch === this.connectionEpoch) {
      return { status: 'healthy', reason: 'delivering' };
    }
    return { status: 'degraded', reason: 'awaiting updates' };
  }

  private aggregateHealth(
    domain: DoorbellDomain,
    reportScope: string
  ): ResourceStreamHealthPayload {
    const subscriptions = Array.from(this.subscriptions.values()).filter(
      (subscription) =>
        subscription.domain === domain && this.reportScopes(subscription).includes(reportScope)
    );
    if (subscriptions.length === 0) {
      return {
        domain,
        scope: reportScope,
        status: 'unhealthy',
        reason: 'inactive',
        connectionStatus: this.connectionStatus,
      };
    }

    let status: ResourceStreamHealthStatus = 'healthy';
    let reason = 'delivering';
    let lastMessageAt = 0;
    let lastDeliveryAt = 0;

    subscriptions.forEach((subscription) => {
      const health = this.computeSubscriptionHealth(subscription);
      if (STREAM_HEALTH_STATUS_ORDER[health.status] > STREAM_HEALTH_STATUS_ORDER[status]) {
        status = health.status;
        reason = health.reason;
      }
      lastMessageAt = Math.max(lastMessageAt, subscription.lastMessageAt ?? 0);
      lastDeliveryAt = Math.max(lastDeliveryAt, subscription.lastDeliveryAt ?? 0);
    });

    const payload: ResourceStreamHealthPayload = {
      domain,
      scope: reportScope,
      status,
      reason,
      connectionStatus: this.connectionStatus,
    };
    if (lastMessageAt) {
      payload.lastMessageAt = lastMessageAt;
    }
    if (lastDeliveryAt) {
      payload.lastDeliveryAt = lastDeliveryAt;
    }
    return payload;
  }

  private updateHealthForScope(domain: DoorbellDomain, reportScope: string): void {
    const next = this.aggregateHealth(domain, reportScope);
    this.streamHealth.set(next);
  }

  private reportScopes(subscription: StreamSubscription): string[] {
    const scopes = Array.from(subscription.reportScopes ?? []);
    return scopes.length > 0 ? scopes : [subscription.reportScope];
  }

  private forEachReportScope(
    subscription: StreamSubscription,
    callback: (reportScope: string) => void
  ): void {
    this.reportScopes(subscription).forEach(callback);
  }

  private updateHealthForSubscription(subscription: StreamSubscription): void {
    this.forEachReportScope(subscription, (reportScope) =>
      this.updateHealthForScope(subscription.domain, reportScope)
    );
  }

  private updateAllHealth(): void {
    const targets = new Map<string, { domain: DoorbellDomain; scope: string }>();
    this.subscriptions.forEach((subscription) => {
      this.forEachReportScope(subscription, (reportScope) => {
        const key = `${subscription.domain}::${reportScope}`;
        if (!targets.has(key)) {
          targets.set(key, { domain: subscription.domain, scope: reportScope });
        }
      });
    });
    targets.forEach(({ domain, scope }) => this.updateHealthForScope(domain, scope));
  }

  private markConnectionOpen(): void {
    this.connectionStatus = 'connected';
    this.connectionEpoch += 1;
    this.lastConnectionError = '';
    this.updateAllHealth();
  }

  private markConnectionError(message: string): void {
    this.connectionStatus = 'disconnected';
    this.lastConnectionError = message;
    this.updateAllHealth();
  }

  private shouldResetDeliveryOnResync(reason: string): boolean {
    return reason !== 'initial' && reason !== 'manual refresh';
  }

  private handleUpdate(subscription: StreamSubscription, message: UpdateMessage): void {
    if (subscription.resyncInFlight) {
      return;
    }
    if (isCompleteResyncStreamDomain(subscription.domain)) {
      this.markSubscriptionDelivery(subscription);
      void this.resyncSubscription(subscription, 'complete-only update');
      return;
    }

    const incomingSequence = parseStreamSequence(message.sequence);
    // Stream sequence is the reliable ordering signal; resourceVersion can regress on resyncs.
    if (
      incomingSequence &&
      subscription.lastSequence &&
      incomingSequence <= subscription.lastSequence
    ) {
      return;
    }
    if (incomingSequence) {
      subscription.lastSequence = incomingSequence;
    }
    const incomingVersion = parseResourceVersion(message.resourceVersion);
    if (incomingVersion) {
      if (!subscription.resourceVersion || incomingVersion > subscription.resourceVersion) {
        subscription.resourceVersion = incomingVersion;
      }
    }
    this.markSubscriptionDelivery(subscription);

    subscription.updateQueue.push(message);
    if (subscription.updateQueue.length > MAX_UPDATE_QUEUE) {
      // Drop the backlog and force a resync so we don't apply stale updates.
      subscription.updateQueue = [];
      void this.resyncSubscription(subscription, 'update backlog overflow', true);
      return;
    }
    if (subscription.updateTimer !== null) {
      return;
    }
    subscription.updateTimer = window.setTimeout(() => {
      subscription.updateTimer = null;
      this.flushUpdates(subscription);
    }, UPDATE_COALESCE_MS);
  }

  private flushUpdates(subscription: StreamSubscription): void {
    if (subscription.updateQueue.length === 0) {
      return;
    }
    const sourceUpdate = this.sourceVersionsFromUpdates(subscription.updateQueue);
    subscription.updateQueue = [];
    this.bumpSourceVersionOnly(
      subscription,
      Date.now(),
      sourceUpdate.sourceVersions,
      sourceUpdate.latest
    );
  }

  private sourceVersionsFromUpdates(
    updates: Array<{
      source?: string;
      signal?: string;
      version?: string;
      signalEnvelope?: SignalEnvelope;
    }>
  ): { sourceVersions: Partial<Record<ResourceStreamSourceClock, string>>; latest?: string } {
    const sourceVersions: Partial<Record<ResourceStreamSourceClock, string>> = {};
    let latest: string | undefined;
    for (const update of updates) {
      const source = update.signalEnvelope?.source ?? update.source;
      const version = update.signalEnvelope?.version ?? update.version?.trim();
      if (!isResourceStreamSourceClock(source) || !version) {
        continue;
      }
      sourceVersions[source] = version;
      latest = version;
    }
    return { sourceVersions, latest };
  }

  private bumpLegacyResyncSourceVersion(
    subscription: StreamSubscription,
    update: UpdateMessage
  ): void {
    const source = this.legacyResyncSource(subscription.domain, update);
    if (!source) {
      return;
    }
    const version = `${source}:resync:${++this.legacyResyncVersionCounter}`;
    this.bumpSourceVersionOnly(subscription, Date.now(), { [source]: version }, version);
  }

  private legacyResyncSource(
    domain: DoorbellDomain,
    update: UpdateMessage
  ): ResourceStreamSourceClock | null {
    const source = update.source;
    if (isResourceStreamSourceClock(source) && domainSupportsSourceClock(domain, source)) {
      return source;
    }
    if (domainSupportsSourceClock(domain, 'object')) {
      return 'object';
    }
    return null;
  }

  private bumpSourceVersionOnly(
    subscription: StreamSubscription,
    now: number,
    sourceVersions: Partial<Record<ResourceStreamSourceClock, string>>,
    latest?: string
  ): void {
    this.forEachReportScope(subscription, (reportScope) => {
      setScopedDomainState(subscription.domain, reportScope, (previous) => ({
        ...previous,
        status: 'ready',
        sourceVersion: latest ?? previous.sourceVersion,
        sourceVersions: {
          ...(previous.sourceVersions ?? {}),
          ...sourceVersions,
        },
        streamRevision: (previous.streamRevision ?? 0) + 1,
        lastUpdated: now,
        lastAutoRefresh: now,
        error: null,
        isManual: false,
        scope: reportScope,
      }));
    });
    this.clearStreamError(subscription.clusterId);
  }

  // Track resync activity so diagnostics can surface stream health.
  private recordResync(subscription: StreamSubscription, reason: string): void {
    if (!this.shouldTrackResync(reason)) {
      return;
    }
    const stats = this.ensureStreamTelemetry(subscription);
    stats.resyncCount += 1;
    stats.lastResyncAt = Date.now();
    stats.lastResyncReason = reason;
  }

  private shouldTrackResync(reason: string): boolean {
    return reason !== 'initial' && reason !== 'manual refresh';
  }

  private ensureStreamTelemetry(subscription: StreamSubscription): StreamTelemetry {
    const existing = this.streamTelemetry.get(subscription.key);
    if (existing) {
      return existing;
    }
    const stats: StreamTelemetry = {
      clusterId: subscription.clusterId,
      domain: subscription.domain,
      resyncCount: 0,
      fallbackCount: 0,
    };
    this.streamTelemetry.set(subscription.key, stats);
    return stats;
  }

  // Resync clears queued updates and refreshes the snapshot after stream gaps.
  private async resyncSubscription(
    subscription: StreamSubscription,
    reason: string,
    force = false
  ): Promise<void> {
    // Skip resync work for subscriptions that are already scheduled to stop.
    if (this.subscriptions.hasPendingUnsubscribe(subscription)) {
      return;
    }
    if (subscription.resyncInFlight) {
      return;
    }
    const now = Date.now();
    if (
      !force &&
      subscription.lastResyncAt &&
      now - subscription.lastResyncAt < RESYNC_COOLDOWN_MS
    ) {
      return;
    }
    subscription.resyncInFlight = true;
    subscription.lastResyncAt = now;
    if (this.shouldResetDeliveryOnResync(reason)) {
      subscription.lastDeliveryEpoch = undefined;
    }
    this.recordResync(subscription, reason);
    // Skip setting a user-visible "Stream resyncing" error for initial stream
    // starts — there is no stale data to warn about. The orchestrator already
    // set status to 'initialising' via setStreamingLoadingState.
    if (reason !== 'initial') {
      this.markResyncing(subscription);
    }
    this.updateHealthForSubscription(subscription);
    if (subscription.updateTimer !== null) {
      window.clearTimeout(subscription.updateTimer);
      subscription.updateTimer = null;
    }
    subscription.updateQueue = [];
    subscription.lastSequence = undefined;

    const sourceUpdate = this.sourceVersionsFromUpdates(subscription.updateQueue);
    this.bumpSourceVersionOnly(subscription, now, sourceUpdate.sourceVersions, sourceUpdate.latest);
    this.markResyncComplete(subscription);
    subscription.pendingReset = false;
    subscription.resyncInFlight = false;
    this.subscribe(subscription);
    this.updateHealthForSubscription(subscription);
  }

  private markResyncComplete(subscription: StreamSubscription): void {
    const now = Date.now();
    this.forEachReportScope(subscription, (reportScope) => {
      setScopedDomainState(subscription.domain, reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: reportScope,
      }));
    });
    this.clearStreamError(subscription.clusterId);
  }

  private markResyncing(subscription: StreamSubscription): void {
    const message = RESYNC_MESSAGE;
    this.forEachReportScope(subscription, (reportScope) => {
      setScopedDomainState(subscription.domain, reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: reportScope,
      }));
    });
  }

  private clearStreamError(clusterId: string): void {
    this.errorNotifier.clear('resource-stream', clusterId);
  }

  private clearAllStreamErrors(): void {
    this.errorNotifier.clearAll();
  }

  private stopAll(reset: boolean): void {
    const subscriptions = Array.from(this.subscriptions.values());
    subscriptions.forEach((subscription) => this.unsubscribe(subscription, reset));
    this.subscriptions.clear();
    this.connection?.close();
    this.connection = null;
    this.connectionStatus = 'disconnected';
    this.connectionEpoch = 0;
    this.lastConnectionError = '';
    this.streamHealth.clear();
    this.errorNotifier.clearAll();
    this.streamTelemetry.clear();
  }
}

export const resourceStreamManager = new ResourceStreamManager();
