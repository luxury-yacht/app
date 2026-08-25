/**
 * frontend/src/core/refresh/streaming/resourceStreamManager.ts
 *
 * Coordinates resource stream subscriptions and resyncs for refresh domains
 * that receive live change signals. Every streamed table is query-backed, so a
 * delta (or a resync) advances the domain source token to trigger a refetch
 * rather than delivering rows over the bridge.
 */

import { eventBus } from '@/core/events';
import {
  APP_LOG_SOURCES,
  type AppLogsClusterMeta,
  logAppLogsDebug,
  logAppLogsInfo,
} from '@/core/logging/appLogsClient';
import { reportOperationalError } from '@/utils/errorHandler';
import { getScopedDomainState, setScopedDomainState } from '../store';
import type { ResourceStreamServerMessage } from '../types';
import { ResourceStreamConnection } from './resourceStreamConnection';
import {
  type DoorbellDomain,
  domainSupportsSourceClock,
  doorbellSourceClocks,
  isCompleteResyncStreamDomain,
  type ResourceStreamSourceClock,
} from './resourceStreamDomains';
import {
  type ResourceStreamConnectionStatus,
  type ResourceStreamHealthPayload,
  type ResourceStreamHealthStatus,
  ResourceStreamHealthStore,
  STREAM_HEALTH_STATUS_ORDER,
} from './resourceStreamHealth';
import {
  computeResourceStreamProtocolHealth,
  type NormalizedResourceStreamProtocolMessage,
  normalizeResourceStreamProtocolMessage,
  type ResourceStreamProtocolEffect,
  type ResourceStreamProtocolEvent,
  type ResourceStreamProtocolTransition,
  transitionResourceStreamProtocol,
} from './resourceStreamProtocol';
import {
  ResourceStreamSubscriptionStore,
  resourceStreamSubscriptionKey,
  type StreamSubscription,
} from './resourceStreamSubscriptions';
import { StreamErrorNotifier } from './streamErrorNotifier';
import { StreamVisibilityController } from './streamVisibilityController';

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

const logDebug = (message: string, cluster?: AppLogsClusterMeta): void => {
  logAppLogsDebug(message, APP_LOG_SOURCES.ResourceStream, cluster);
};

type ServerMessage = Partial<ResourceStreamServerMessage>;

type ResolvedSubscriptionMessage = {
  normalized: NormalizedResourceStreamProtocolMessage;
  subscription: StreamSubscription;
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
  private readonly subscriptions = new ResourceStreamSubscriptionStore(
    STREAM_UNSUBSCRIBE_DEBOUNCE_MS,
    logInfo
  );
  // Single socket used to multiplex subscriptions across clusters.
  private connection: ResourceStreamConnection | null = null;
  private connectionStatus: ResourceStreamConnectionStatus = 'disconnected';
  private connectionEpoch = 0;
  private lastConnectionError = '';
  private readonly streamHealth = new ResourceStreamHealthStore();
  private readonly errorNotifier = new StreamErrorNotifier();
  private legacyResyncVersionCounter = 0;
  private readonly visibility = new StreamVisibilityController<StreamSubscription>({
    captureActive: () => Array.from(this.subscriptions.values()),
    suspendActive: () => {
      this.markConnectionError('visibility hidden');
      this.connection?.pause();
    },
    resumeItems: () => Array.from(this.subscriptions.values()),
    resumeItem: (subscription) => {
      void this.resyncSubscription(subscription, 'visibility resume');
    },
  });
  private readonly streamTelemetry = new Map<string, StreamTelemetry>();

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
      accumulateStreamTelemetry(summary, stats);
    });
    return summary;
  }

  // Per-(cluster, domain) resync/fallback summaries for the per-domain Streams
  // rows. Keyed `${clusterId}::${domain}` (scopes of a domain are summed).
  getTelemetrySummaryByClusterDomain(): Record<string, ResourceStreamTelemetrySummary> {
    const byClusterDomain: Record<string, ResourceStreamTelemetrySummary> = {};
    this.streamTelemetry.forEach((stats) => {
      const key = `${stats.clusterId}::${stats.domain}`;
      byClusterDomain[key] ??= { resyncCount: 0, fallbackCount: 0 };
      const summary = byClusterDomain[key];
      accumulateStreamTelemetry(summary, stats);
    });
    return byClusterDomain;
  }

  // Expose per-scope health so refresh gating can decide when polling fallback is required.
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
    subscriptions.forEach((subscription) => {
      this.scheduleUnsubscribe(subscription, reset);
    });
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

  private parseMessage(clusterId: string, raw: unknown): ServerMessage | null {
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      return raw as ServerMessage;
    }
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as ServerMessage;
      } catch (error) {
        reportOperationalError(error, {
          source: 'ResourceStreamManager',
          action: 'parseResourceStreamPayload',
          clusterId,
        });
        return null;
      }
    }
    reportOperationalError(new Error('Invalid resource stream payload structure'), {
      source: 'ResourceStreamManager',
      action: 'parseResourceStreamPayload',
      clusterId,
    });
    return null;
  }

  private resolveSubscriptionMessage(
    clusterId: string,
    parsed: ServerMessage
  ): ResolvedSubscriptionMessage | null {
    const normalized = normalizeResourceStreamProtocolMessage(parsed);
    if (!normalized) {
      return null;
    }
    const messageClusterId = normalized.clusterId ?? clusterId;
    if (!messageClusterId) {
      return null;
    }
    const subscriptionKey = resourceStreamSubscriptionKey(
      messageClusterId,
      normalized.domain,
      normalized.scope
    );
    let subscription = this.subscriptions.get(subscriptionKey);
    if (!subscription) {
      if (normalized.routing === 'strict') {
        return null;
      }
      // Fall back when cluster IDs drift but the scope/domain pair is unique.
      subscription = this.findSubscriptionByScope(normalized.domain, normalized.scope);
      if (!subscription) {
        return null;
      }
    }
    return { normalized, subscription };
  }

  private captureSubscriptionClusterName(
    subscription: StreamSubscription,
    normalized: NormalizedResourceStreamProtocolMessage
  ): void {
    // Server frames carry the cluster DISPLAY NAME (the subscribe ACK always
    // does); capture it so subscription-labeled logging shows the same name
    // as the backend's per-cluster log lines instead of falling back to the
    // raw composite cluster ID.
    const messageClusterName = normalized.clusterName;
    if (messageClusterName && subscription.clusterName !== messageClusterName) {
      subscription.clusterName = messageClusterName;
    }
  }

  handleMessage(clusterId: string, raw: unknown): void {
    const parsed = this.parseMessage(clusterId, raw);
    if (!parsed) {
      return;
    }
    const resolved = this.resolveSubscriptionMessage(clusterId, parsed);
    if (!resolved) {
      return;
    }

    const { subscription, normalized } = resolved;
    this.captureSubscriptionClusterName(subscription, normalized);
    this.applyProtocolEvent(subscription, {
      type: 'message-received',
      message: normalized.message,
      now: Date.now(),
      connectionEpoch: this.connectionEpoch,
      hasRetainedData: this.hasRetainedData(subscription),
      completeResync: isCompleteResyncStreamDomain(subscription.domain),
      maxPendingChanges: MAX_UPDATE_QUEUE,
    });
  }

  private findSubscriptionByScope(
    domain: DoorbellDomain,
    scope: string
  ): StreamSubscription | undefined {
    return this.subscriptions.findByScope(domain, scope);
  }

  private applyProtocolEvent(
    subscription: StreamSubscription,
    event: ResourceStreamProtocolEvent
  ): ResourceStreamProtocolTransition {
    const result = transitionResourceStreamProtocol(subscription.protocol, event);
    subscription.protocol = result.state;
    result.effects.forEach((effect) => {
      this.runProtocolEffect(subscription, effect);
    });
    this.updateHealthForSubscription(subscription);
    return result;
  }

  private runProtocolEffect(
    subscription: StreamSubscription,
    effect: ResourceStreamProtocolEffect
  ): void {
    switch (effect.type) {
      case 'schedule-flush': {
        const timer = window.setTimeout(() => {
          this.applyProtocolEvent(subscription, { type: 'flush-fired', timer });
        }, UPDATE_COALESCE_MS);
        this.applyProtocolEvent(subscription, { type: 'flush-timer-attached', timer });
        return;
      }
      case 'cancel-flush':
        window.clearTimeout(effect.timer);
        return;
      case 'advance-source':
        this.bumpSourceVersionOnly(subscription, Date.now(), effect.sourceVersions, effect.latest);
        return;
      case 'advance-legacy-reset':
        this.bumpLegacyResyncSourceVersion(subscription);
        return;
      case 'request-resync':
        void this.resyncSubscription(subscription, effect.reason, effect.force, effect.errorReason);
        return;
      case 'permission-denied':
        eventBus.emit('refresh:resource-stream-permission-denied', {
          domain: subscription.domain,
          scope: subscription.storeScope,
          reason: effect.reason,
        });
        return;
      case 'mark-resyncing':
        this.markResyncing(subscription);
        return;
      case 'mark-resync-complete':
        this.markResyncComplete(subscription);
        return;
      case 'send-subscribe':
        this.subscribe(subscription);
        return;
    }
  }

  handleConnectionOpen(clusterId: string): void {
    const targetClusterId = clusterId.trim();
    // Log when the named stream is connected so it is clear streaming is active.
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
      this.applyProtocolEvent(subscription, {
        type: 'connection-opened',
        epoch: this.connectionEpoch,
      });
    });
  }

  handleConnectionError(clusterId: string, message: string): void {
    const targetClusterId = clusterId.trim();
    this.markConnectionError(message);
    this.subscriptions.forEach((subscription) => {
      if (targetClusterId && subscription.clusterId !== targetClusterId) {
        return;
      }
      this.applyProtocolEvent(subscription, { type: 'connection-lost', reason: message });
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
    subscriptions.forEach((subscription) => {
      this.updateHealthForSubscription(subscription);
    });
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
    const request = this.subscriptions.buildRequestMessage(subscription);
    connection.send(request);
    this.applyProtocolEvent(subscription, {
      type: 'subscribe-sent',
      expectsReset: request.resumeToken === undefined,
    });
  }

  private unsubscribe(subscription: StreamSubscription, reset: boolean): void {
    this.subscriptions.cancelPendingUnsubscribe(subscription);
    this.applyProtocolEvent(subscription, { type: 'stopping' });
    const connection = this.connection;
    if (connection) {
      connection.send(this.subscriptions.buildCancelMessage(subscription));
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

  private computeSubscriptionHealth(subscription: StreamSubscription): {
    status: ResourceStreamHealthStatus;
    reason: string;
  } {
    return computeResourceStreamProtocolHealth(
      subscription.protocol,
      this.connectionStatus,
      this.lastConnectionError
    );
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
      lastMessageAt = Math.max(lastMessageAt, subscription.protocol.activity.lastMessageAt ?? 0);
      lastDeliveryAt = Math.max(lastDeliveryAt, subscription.protocol.activity.lastDeliveryAt ?? 0);
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
    targets.forEach(({ domain, scope }) => {
      this.updateHealthForScope(domain, scope);
    });
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

  private bumpLegacyResyncSourceVersion(subscription: StreamSubscription): void {
    const source = this.legacyResyncSource(subscription.domain);
    if (!source) {
      return;
    }
    const version = `${source}:resync:${++this.legacyResyncVersionCounter}`;
    this.bumpSourceVersionOnly(subscription, Date.now(), { [source]: version }, version);
  }

  private legacyResyncSource(domain: DoorbellDomain): ResourceStreamSourceClock | null {
    if (domainSupportsSourceClock(domain, 'object')) {
      return 'object';
    }
    return doorbellSourceClocks(domain)[0] ?? null;
  }

  private hasRetainedData(subscription: StreamSubscription): boolean {
    return this.reportScopes(subscription).some((reportScope) => {
      const data = getScopedDomainState(subscription.domain, reportScope).data;
      return data !== null && data !== undefined;
    });
  }

  private bumpSourceVersionOnly(
    subscription: StreamSubscription,
    now: number,
    sourceVersions: Partial<Record<ResourceStreamSourceClock, string>>,
    latest?: string
  ): void {
    if (subscription.domain === 'namespaces' && sourceVersions.object) {
      // Rare by design (namespace changes/presence flips); the matching backend
      // line is "namespaces doorbell <version>: <reason> — signaling ...".
      // Together they localize a dead doorbell to the backend, the wire, or the
      // consumer — so both halves carry the per-cluster label.
      logDebug(
        `namespaces doorbell ${sourceVersions.object} received for scope ${subscription.reportScope}: advancing the object clock so NamespaceContext refetches the namespace list`,
        { clusterId: subscription.clusterId, clusterName: subscription.clusterName }
      );
    }
    this.forEachReportScope(subscription, (reportScope) => {
      setScopedDomainState(subscription.domain, reportScope, (previous) => ({
        ...previous,
        status: 'ready',
        sourceVersion: latest ?? previous.sourceVersion,
        // Doorbell clocks live in signalVersions, which payload applies never
        // touch — the structural guarantee that signal-refetch keys move only
        // when a doorbell delivers them. sourceVersions stays payload-owned
        // (the backend back-fills an object clock into every snapshot, so it
        // churns on every fetch and cannot carry signals).
        signalVersions: {
          ...previous.signalVersions,
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

  // recordStreamFallback counts a poll that ran because this scope's stream was
  // not delivering. The refresh orchestrator owns that decision, so it reports
  // the fallback here rather than the manager inferring one.
  recordStreamFallback(domain: DoorbellDomain, scope: string, reason: string): void {
    const now = Date.now();
    // getForScope resolves without creating: a fallback is evidence about an
    // existing subscription, never a reason to open one.
    this.subscriptions.getForScope(domain, scope).forEach((subscription) => {
      const stats = this.ensureStreamTelemetry(subscription);
      stats.fallbackCount += 1;
      stats.lastFallbackAt = now;
      stats.lastFallbackReason = reason;
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
    force = false,
    errorReason?: string
  ): Promise<void> {
    // Skip resync work for subscriptions that are already scheduled to stop.
    if (this.subscriptions.hasPendingUnsubscribe(subscription)) {
      return;
    }
    const now = Date.now();
    const previous = subscription.protocol;
    const started = this.applyProtocolEvent(subscription, {
      type: 'resync-requested',
      reason,
      now,
      force,
      cooldownMs: RESYNC_COOLDOWN_MS,
      ...(errorReason ? { errorReason } : {}),
    });
    if (started.state === previous || started.state.phase.status !== 'resyncing') {
      return;
    }
    this.recordResync(subscription, reason);
    // Recovery resyncs must be confirmed by the server before health reports
    // synchronized. Initial/manual lifecycle resubscriptions retain health that
    // this connection already confirmed while they wait for the next ACK.
    this.applyProtocolEvent(subscription, { type: 'resync-completed' });
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
    subscriptions.forEach((subscription) => {
      this.unsubscribe(subscription, reset);
    });
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
