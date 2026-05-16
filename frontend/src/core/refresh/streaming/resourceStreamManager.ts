/**
 * frontend/src/core/refresh/streaming/resourceStreamManager.ts
 *
 * Resource stream manager for watch-style resource updates.
 */

import { fetchSnapshot, type Snapshot, type SnapshotStats } from '../client';
import { setScopedDomainState } from '../store';
import type { PermissionDeniedStatus } from '../types';
import { stripClusterScope } from '../clusterScope';
import { errorHandler } from '@utils/errorHandler';
import { eventBus, type AppEvents } from '@/core/events';
import { APP_LOG_SOURCES, logAppLogsInfo, logAppLogsWarn } from '@/core/logging/appLogsClient';
import { resolvePermissionDeniedMessage } from '../permissionErrors';
import {
  getResourceStreamDomainDescriptor,
  isClusterScopedDomain,
  isSupportedDomain,
  type ResourceDomain,
} from './resourceStreamDomains';
import { applyResourceRowUpdates, mergeSnapshotRows } from './resourceStreamRows';
import { ResourceStreamConnection } from './resourceStreamConnection';
import {
  ResourceStreamSubscriptionStore,
  resourceStreamSubscriptionKey,
  type StreamSubscription,
} from './resourceStreamSubscriptions';

export {
  normalizeResourceScope,
  sortNodeRows,
  sortPodRows,
  sortWorkloadRows,
} from './resourceStreamDomains';
export {
  mergeNodeMetricsRow,
  mergePodMetricsRow,
  mergeWorkloadMetricsRow,
} from './resourceStreamRows';

const UPDATE_COALESCE_MS = 150;
const RESYNC_COOLDOWN_MS = 1000;
const RESYNC_MESSAGE = 'Stream resyncing';
const STREAM_ERROR_NOTIFY_THRESHOLD = 3;
const DRIFT_SAMPLE_SIZE = 5;
// Linger stream stops briefly to avoid rapid subscribe/unsubscribe churn.
const STREAM_UNSUBSCRIBE_DEBOUNCE_MS = 500;
// Cap queued updates to avoid unbounded memory growth under bursty streams.
const MAX_UPDATE_QUEUE = 1000;

const logInfo = (message: string): void => {
  logAppLogsInfo(message, APP_LOG_SOURCES.ResourceStream);
};

const logWarning = (message: string): void => {
  logAppLogsWarn(message, APP_LOG_SOURCES.ResourceStream);
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

type ResourceStreamHealthStatus = AppEvents['refresh:resource-stream-health']['status'];
type ResourceStreamHealthPayload = AppEvents['refresh:resource-stream-health'];
type ResourceStreamConnectionStatus = ResourceStreamHealthPayload['connectionStatus'];

type StreamMessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

// Aggregate health across clusters using worst-status wins.
const STREAM_HEALTH_STATUS_ORDER: Record<ResourceStreamHealthStatus, number> = {
  healthy: 0,
  degraded: 1,
  unhealthy: 2,
};

type ServerMessage = {
  type: StreamMessageType;
  clusterId?: string;
  clusterName?: string;
  domain?: string;
  scope?: string;
  resourceVersion?: string;
  sequence?: string;
  uid?: string;
  name?: string;
  namespace?: string;
  kind?: string;
  row?: unknown;
  error?: string;
  errorDetails?: PermissionDeniedStatus;
};

type UpdateMessage = ServerMessage & { domain: ResourceDomain; scope: string };

const hasMessageType = (value: unknown): value is StreamMessageType =>
  typeof value === 'string' && Object.values(MESSAGE_TYPES).includes(value as StreamMessageType);

const normalizeStreamScope = (domain: ResourceDomain, scope: unknown): string | null => {
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
  if (!hasMessageType(message.type) || !isSupportedDomain(message.domain)) {
    return null;
  }
  const normalizedScope = normalizeStreamScope(message.domain, message.scope);
  if (normalizedScope === null) {
    return null;
  }
  return { ...message, domain: message.domain, scope: normalizedScope };
};

const normalizeUpdateClusterId = (update: UpdateMessage, clusterId: string): UpdateMessage => {
  if (!clusterId) {
    return update;
  }
  const messageClusterId = update.clusterId?.trim();
  if (messageClusterId && messageClusterId === clusterId) {
    return update;
  }
  const next: UpdateMessage = { ...update, clusterId };
  if (update.row && typeof update.row === 'object' && !Array.isArray(update.row)) {
    if ('clusterId' in update.row) {
      next.row = { ...(update.row as Record<string, unknown>), clusterId };
    }
  }
  return next;
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

type KeyDiff = {
  missingKeys: number;
  extraKeys: number;
  missingSample: string[];
  extraSample: string[];
};

const diffKeySets = (expected: Set<string>, actual: Set<string>, sampleLimit: number): KeyDiff => {
  const missingSample: string[] = [];
  const extraSample: string[] = [];
  let missingKeys = 0;
  let extraKeys = 0;

  expected.forEach((key) => {
    if (!actual.has(key)) {
      missingKeys += 1;
      if (missingSample.length < sampleLimit) {
        missingSample.push(key);
      }
    }
  });

  actual.forEach((key) => {
    if (!expected.has(key)) {
      extraKeys += 1;
      if (extraSample.length < sampleLimit) {
        extraSample.push(key);
      }
    }
  });

  return { missingKeys, extraKeys, missingSample, extraSample };
};

const updateStats = (stats: SnapshotStats | null, itemCount: number): SnapshotStats => {
  if (!stats) {
    return { itemCount, buildDurationMs: 0 };
  }
  return { ...stats, itemCount };
};

export type ResourceStreamTelemetrySummary = {
  resyncCount: number;
  fallbackCount: number;
  lastResyncAt?: number;
  lastResyncReason?: string;
  lastFallbackAt?: number;
  lastFallbackReason?: string;
};

type StreamTelemetry = {
  resyncCount: number;
  fallbackCount: number;
  lastResyncAt?: number;
  lastResyncReason?: string;
  lastFallbackAt?: number;
  lastFallbackReason?: string;
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
  private streamHealth = new Map<string, ResourceStreamHealthPayload>();
  private lastNotifiedErrors = new Map<string, string>();
  private consecutiveErrors = new Map<string, number>();
  private suspendedForVisibility = false;
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

    this.streamTelemetry.forEach((stats) => {
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
    });

    return summary;
  }

  // Expose per-scope health so refresh gating can keep snapshots running until delivery resumes.
  getHealthStatus(domain: ResourceDomain, scope: string): ResourceStreamHealthStatus {
    const key = this.healthKey(domain, scope);
    return this.streamHealth.get(key)?.status ?? 'unhealthy';
  }

  getHealthSnapshot(domain: string, scope: string): ResourceStreamHealthPayload | null {
    if (!isSupportedDomain(domain)) {
      return null;
    }
    const key = this.healthKey(domain, scope);
    return this.streamHealth.get(key) ?? null;
  }

  isHealthy(domain: ResourceDomain, scope: string): boolean {
    return this.getHealthStatus(domain, scope) === 'healthy';
  }

  async start(domain: ResourceDomain, scope: string): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }
    const subscriptions = this.ensureSubscriptions(domain, scope);
    await Promise.all(
      subscriptions.map((subscription) => this.resyncSubscription(subscription, 'initial'))
    );
  }

  stop(domain: ResourceDomain, scope: string, reset = false): void {
    const subscriptions = this.getSubscriptions(domain, scope);
    if (subscriptions.length === 0) {
      return;
    }
    subscriptions.forEach((subscription) => this.scheduleUnsubscribe(subscription, reset));
  }

  async refreshOnce(domain: ResourceDomain, scope: string): Promise<void> {
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
    if (!parsed || !hasMessageType(parsed.type)) {
      return;
    }
    const update = resolveUpdateMessage(parsed);
    if (!update) {
      return;
    }
    const messageClusterId = update.clusterId?.trim() || clusterId;
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
      // Fall back when cluster IDs drift but the scope/domain pair is unique.
      subscription = this.findSubscriptionByScope(update.domain, update.scope);
      if (!subscription) {
        return;
      }
      resolvedUpdate = normalizeUpdateClusterId(update, subscription.clusterId);
    }
    const errorMessage = resolvePermissionDeniedMessage(update.error, update.errorDetails);
    this.recordSubscriptionMessage(subscription);

    switch (resolvedUpdate.type) {
      case MESSAGE_TYPES.heartbeat:
        return;
      case MESSAGE_TYPES.reset:
        if (subscription.pendingReset) {
          subscription.pendingReset = false;
          this.updateHealthForScope(subscription.domain, subscription.reportScope);
          return;
        }
        void this.resyncSubscription(subscription, 'reset');
        this.updateHealthForScope(subscription.domain, subscription.reportScope);
        return;
      case MESSAGE_TYPES.complete:
        void this.resyncSubscription(subscription, errorMessage || 'complete');
        this.updateHealthForScope(subscription.domain, subscription.reportScope);
        return;
      case MESSAGE_TYPES.error:
        this.recordSubscriptionError(subscription, errorMessage || 'stream error');
        void this.resyncSubscription(subscription, errorMessage || 'stream error', true);
        this.updateHealthForScope(subscription.domain, subscription.reportScope);
        return;
      case MESSAGE_TYPES.added:
      case MESSAGE_TYPES.modified:
      case MESSAGE_TYPES.deleted:
        this.handleUpdate(subscription, resolvedUpdate);
        this.updateHealthForScope(subscription.domain, subscription.reportScope);
        return;
      default:
        return;
    }
  }

  private findSubscriptionByScope(
    domain: ResourceDomain,
    scope: string
  ): StreamSubscription | undefined {
    return this.subscriptions.findByScope(domain, scope);
  }

  handleConnectionOpen(clusterId: string): void {
    const targetClusterId = clusterId.trim();
    // Log when the websocket is connected so it is clear streaming is active.
    logInfo(`[resource-stream] connection open clusterId=${targetClusterId || 'all'}`);
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
      if (
        subscription.lastSequence &&
        !subscription.resyncInFlight &&
        !subscription.driftDetected
      ) {
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
    if (this.suspendedForVisibility) {
      return;
    }
    this.suspendedForVisibility = true;
    this.markConnectionError('visibility hidden');
    this.connection?.pause();
  }

  private resumeFromVisibility(): void {
    if (!this.suspendedForVisibility) {
      return;
    }
    this.suspendedForVisibility = false;
    this.connection?.resume();
    this.subscriptions.forEach((subscription) => {
      this.markResyncing(subscription);
      void this.resyncSubscription(subscription, 'visibility resume');
    });
  }

  private ensureSubscriptions(domain: ResourceDomain, scope: string): StreamSubscription[] {
    const subscriptions = this.subscriptions.ensure(domain, scope);
    subscriptions.forEach((subscription) =>
      this.updateHealthForScope(subscription.domain, subscription.reportScope)
    );
    return subscriptions;
  }

  private getSubscriptions(domain: ResourceDomain, scope: string): StreamSubscription[] {
    return this.subscriptions.getForScope(domain, scope);
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
    this.updateHealthForScope(subscription.domain, subscription.reportScope);

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

  private healthKey(domain: ResourceDomain, scope: string): string {
    return `${domain}::${scope}`;
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
    if (subscription.driftDetected) {
      return { status: 'unhealthy', reason: 'drift detected' };
    }
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
    domain: ResourceDomain,
    reportScope: string
  ): ResourceStreamHealthPayload {
    const subscriptions = Array.from(this.subscriptions.values()).filter(
      (subscription) => subscription.domain === domain && subscription.reportScope === reportScope
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

  private updateHealthForScope(domain: ResourceDomain, reportScope: string): void {
    const next = this.aggregateHealth(domain, reportScope);
    const key = this.healthKey(domain, reportScope);
    const previous = this.streamHealth.get(key);
    this.streamHealth.set(key, next);
    // Avoid emitting on every message; only push updates when status changes.
    if (
      !previous ||
      previous.status !== next.status ||
      previous.reason !== next.reason ||
      previous.connectionStatus !== next.connectionStatus
    ) {
      eventBus.emit('refresh:resource-stream-health', next);
    }
  }

  private updateAllHealth(): void {
    const targets = new Map<string, { domain: ResourceDomain; scope: string }>();
    this.subscriptions.forEach((subscription) => {
      const key = this.healthKey(subscription.domain, subscription.reportScope);
      if (!targets.has(key)) {
        targets.set(key, { domain: subscription.domain, scope: subscription.reportScope });
      }
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
    if (subscription.driftDetected) {
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
    const updates = subscription.updateQueue.splice(
      0,
      subscription.updateQueue.length
    ) as UpdateMessage[];
    const now = Date.now();

    // Always update shadow keys so drift checks can compare snapshots to streamed changes.
    this.applyShadowUpdates(subscription, updates);
    this.applyRowUpdates(subscription, updates, now);
  }

  private applyRowUpdates(
    subscription: StreamSubscription,
    updates: UpdateMessage[],
    now: number
  ): void {
    const descriptor = getResourceStreamDomainDescriptor(subscription.domain);
    const collection = descriptor.collection;

    setScopedDomainState(subscription.domain, subscription.reportScope, (previous) => {
      const currentPayload = previous.data ?? collection.emptyPayload(subscription.clusterId);
      const existingRows = collection.getRows(currentPayload);
      const nextRows = applyResourceRowUpdates(
        existingRows,
        updates,
        subscription.clusterId,
        collection,
        subscription.preserveMetrics
      );

      if (previous.data && nextRows === existingRows) {
        return previous;
      }

      return {
        ...previous,
        status: 'ready',
        data:
          nextRows === existingRows
            ? currentPayload
            : collection.withRows(currentPayload, nextRows),
        stats: updateStats(previous.stats, nextRows.length),
        lastUpdated: now,
        lastAutoRefresh: now,
        error: null,
        isManual: false,
        scope: subscription.reportScope,
      };
    });
    this.clearStreamError(subscription.clusterId);
  }

  private applyShadowUpdates(subscription: StreamSubscription, updates: UpdateMessage[]): void {
    if (!subscription.hasBaseline) {
      return;
    }

    const collection = getResourceStreamDomainDescriptor(subscription.domain).collection;
    updates.forEach((update) => {
      const key = collection.buildUpdateKey(update, subscription.clusterId);
      if (!key) {
        return;
      }
      if (update.type === MESSAGE_TYPES.deleted) {
        subscription.shadowKeys.delete(key);
      } else {
        subscription.shadowKeys.add(key);
      }
    });
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

  // Track snapshot fallbacks when drift forces streaming to stop.
  private recordFallback(subscription: StreamSubscription, reason: string): void {
    const stats = this.ensureStreamTelemetry(subscription);
    stats.fallbackCount += 1;
    stats.lastFallbackAt = Date.now();
    stats.lastFallbackReason = reason;
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
    if (subscription.driftDetected) {
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
    this.updateHealthForScope(subscription.domain, subscription.reportScope);
    if (subscription.updateTimer !== null) {
      window.clearTimeout(subscription.updateTimer);
      subscription.updateTimer = null;
    }
    subscription.updateQueue = [];
    subscription.lastSequence = undefined;

    try {
      const { snapshot, notModified } = await fetchSnapshotForSubscription(subscription);
      if (notModified) {
        this.markResyncComplete(subscription);
        subscription.pendingReset = false;
        if (subscription.driftDetected) {
          this.unsubscribe(subscription, false);
          return;
        }
        this.subscribe(subscription);
        return;
      }
      if (!snapshot) {
        throw new Error('resource stream snapshot missing');
      }
      this.applySnapshot(subscription, snapshot);
      const snapshotVersion = parseResourceVersion(snapshot.version);
      if (
        snapshotVersion &&
        (!subscription.resourceVersion || snapshotVersion > subscription.resourceVersion)
      ) {
        subscription.resourceVersion = snapshotVersion;
      }
      subscription.pendingReset = false;
      if (subscription.driftDetected) {
        this.unsubscribe(subscription, false);
        return;
      }
      this.subscribe(subscription);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStreamError(subscription, message);
    } finally {
      subscription.resyncInFlight = false;
      this.updateHealthForScope(subscription.domain, subscription.reportScope);
    }
  }

  private applySnapshot(subscription: StreamSubscription, snapshot: Snapshot<any>): void {
    // Drift detection compares streamed keys against the latest snapshot.
    this.updateShadowBaseline(subscription, snapshot);

    const generatedAt = snapshot.generatedAt || Date.now();
    const descriptor = getResourceStreamDomainDescriptor(subscription.domain);
    const collection = descriptor.collection;
    const payload = snapshot.payload;

    setScopedDomainState(subscription.domain, subscription.reportScope, (previous) => {
      const previousRows = previous.data ? collection.getRows(previous.data) : [];
      const incomingRows = collection.getRows(payload);
      const mergedRows = mergeSnapshotRows(
        previousRows,
        incomingRows,
        subscription.clusterId,
        collection
      );
      const nextPayload = collection.withRows(payload, mergedRows);

      return {
        ...previous,
        status: 'ready',
        data: nextPayload,
        stats: updateStats(snapshot.stats ?? previous.stats ?? null, mergedRows.length),
        version: snapshot.version,
        checksum: snapshot.checksum,
        etag: snapshot.checksum ?? previous.etag,
        lastUpdated: generatedAt,
        lastAutoRefresh: generatedAt,
        error: null,
        isManual: false,
        scope: subscription.reportScope,
      };
    });
    this.clearStreamError(subscription.clusterId);
  }

  private updateShadowBaseline(subscription: StreamSubscription, snapshot: Snapshot<any>): void {
    const snapshotKeys = getResourceStreamDomainDescriptor(subscription.domain).buildSnapshotKeys(
      snapshot.payload,
      subscription.clusterId
    );

    if (subscription.hasBaseline && !subscription.driftDetected) {
      const streamCount = subscription.shadowKeys.size;
      const snapshotCount = snapshotKeys.size;
      const diff = diffKeySets(snapshotKeys, subscription.shadowKeys, DRIFT_SAMPLE_SIZE);
      if (diff.missingKeys > 0 || diff.extraKeys > 0) {
        this.flagDrift(subscription, {
          reason: 'snapshot mismatch',
          streamCount,
          snapshotCount,
          missingKeys: diff.missingKeys,
          extraKeys: diff.extraKeys,
          missingSample: diff.missingSample,
          extraSample: diff.extraSample,
        });
      }
    }

    subscription.shadowKeys = snapshotKeys;
    subscription.hasBaseline = true;
  }

  private flagDrift(
    subscription: StreamSubscription,
    details: {
      reason: string;
      streamCount: number;
      snapshotCount: number;
      missingKeys: number;
      extraKeys: number;
      missingSample: string[];
      extraSample: string[];
    }
  ): void {
    if (subscription.driftDetected) {
      return;
    }
    this.recordFallback(subscription, details.reason);
    subscription.driftDetected = true;
    this.updateHealthForScope(subscription.domain, subscription.reportScope);

    eventBus.emit('refresh:resource-stream-drift', {
      domain: subscription.domain,
      scope: subscription.reportScope,
      reason: details.reason,
      streamCount: details.streamCount,
      snapshotCount: details.snapshotCount,
      missingKeys: details.missingKeys,
      extraKeys: details.extraKeys,
    });

    logWarning(
      `[resource-stream] drift detected domain=${subscription.domain} scope=${subscription.reportScope} reason=${details.reason} streamCount=${details.streamCount} snapshotCount=${details.snapshotCount} missingKeys=${details.missingKeys} extraKeys=${details.extraKeys}`
    );
  }

  private markResyncComplete(subscription: StreamSubscription): void {
    const now = Date.now();
    if (subscription.domain === 'pods') {
      setScopedDomainState('pods', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-workloads') {
      setScopedDomainState('namespace-workloads', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-config') {
      setScopedDomainState('namespace-config', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-network') {
      setScopedDomainState('namespace-network', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-rbac') {
      setScopedDomainState('namespace-rbac', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-custom') {
      setScopedDomainState('namespace-custom', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-helm') {
      setScopedDomainState('namespace-helm', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-autoscaling') {
      setScopedDomainState('namespace-autoscaling', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-quotas') {
      setScopedDomainState('namespace-quotas', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-storage') {
      setScopedDomainState('namespace-storage', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-rbac') {
      setScopedDomainState('cluster-rbac', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-storage') {
      setScopedDomainState('cluster-storage', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-config') {
      setScopedDomainState('cluster-config', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-crds') {
      setScopedDomainState('cluster-crds', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-custom') {
      setScopedDomainState('cluster-custom', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'nodes') {
      setScopedDomainState('nodes', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
    }
  }

  private markResyncing(subscription: StreamSubscription): void {
    const message = RESYNC_MESSAGE;
    if (subscription.domain === 'pods') {
      setScopedDomainState('pods', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-workloads') {
      setScopedDomainState('namespace-workloads', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-config') {
      setScopedDomainState('namespace-config', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-network') {
      setScopedDomainState('namespace-network', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-rbac') {
      setScopedDomainState('namespace-rbac', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-custom') {
      setScopedDomainState('namespace-custom', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-helm') {
      setScopedDomainState('namespace-helm', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-autoscaling') {
      setScopedDomainState('namespace-autoscaling', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-quotas') {
      setScopedDomainState('namespace-quotas', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-storage') {
      setScopedDomainState('namespace-storage', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'cluster-rbac') {
      setScopedDomainState('cluster-rbac', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'cluster-storage') {
      setScopedDomainState('cluster-storage', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'cluster-config') {
      setScopedDomainState('cluster-config', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'cluster-crds') {
      setScopedDomainState('cluster-crds', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'cluster-custom') {
      setScopedDomainState('cluster-custom', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'nodes') {
      setScopedDomainState('nodes', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
    }
  }

  private setStreamError(subscription: StreamSubscription, message: string): void {
    this.recordSubscriptionError(subscription, message);
    const key = `${subscription.clusterId}::${subscription.domain}::${subscription.storeScope}`;
    const attempts = (this.consecutiveErrors.get(key) ?? 0) + 1;
    this.consecutiveErrors.set(key, attempts);
    const isTerminal = attempts >= STREAM_ERROR_NOTIFY_THRESHOLD;

    if (subscription.domain === 'pods') {
      setScopedDomainState('pods', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-workloads') {
      setScopedDomainState('namespace-workloads', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-config') {
      setScopedDomainState('namespace-config', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-network') {
      setScopedDomainState('namespace-network', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-rbac') {
      setScopedDomainState('namespace-rbac', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-custom') {
      setScopedDomainState('namespace-custom', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-helm') {
      setScopedDomainState('namespace-helm', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'cluster-rbac') {
      setScopedDomainState('cluster-rbac', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'cluster-storage') {
      setScopedDomainState('cluster-storage', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'cluster-config') {
      setScopedDomainState('cluster-config', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'cluster-crds') {
      setScopedDomainState('cluster-crds', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'cluster-custom') {
      setScopedDomainState('cluster-custom', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-autoscaling') {
      setScopedDomainState('namespace-autoscaling', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-quotas') {
      setScopedDomainState('namespace-quotas', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-storage') {
      setScopedDomainState('namespace-storage', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'nodes') {
      setScopedDomainState('nodes', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    }

    if (isTerminal) {
      this.notifyStreamError(subscription.clusterId, message);
    }
    this.updateHealthForScope(subscription.domain, subscription.reportScope);
  }

  private clearStreamError(clusterId: string): void {
    const keys = Array.from(this.lastNotifiedErrors.keys()).filter((key) =>
      key.startsWith(clusterId)
    );
    keys.forEach((key) => this.lastNotifiedErrors.delete(key));
    const errorKeys = Array.from(this.consecutiveErrors.keys()).filter((key) =>
      key.startsWith(clusterId)
    );
    errorKeys.forEach((key) => this.consecutiveErrors.delete(key));
  }

  private clearAllStreamErrors(): void {
    this.lastNotifiedErrors.clear();
    this.consecutiveErrors.clear();
  }

  private notifyStreamError(clusterId: string, message: string): void {
    const key = `${clusterId}::resource-stream`;
    if (this.lastNotifiedErrors.get(key) === message) {
      return;
    }
    this.lastNotifiedErrors.set(key, message);
    errorHandler.handle(new Error(message), {
      source: 'resource-stream',
    });
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
    this.lastNotifiedErrors.clear();
    this.consecutiveErrors.clear();
    this.streamTelemetry.clear();
  }
}

const fetchSnapshotForSubscription = async (
  subscription: StreamSubscription
): Promise<{ snapshot?: Snapshot<any>; notModified: boolean }> => {
  const { snapshot, notModified } = await fetchSnapshot(subscription.domain, {
    scope: subscription.storeScope,
  });
  return { snapshot, notModified };
};

export const resourceStreamManager = new ResourceStreamManager();
