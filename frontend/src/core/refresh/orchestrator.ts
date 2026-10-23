/**
 * frontend/src/core/refresh/orchestrator.ts
 *
 * Module source for orchestrator.
 * Implements orchestrator logic for the core layer.
 */

import { errorStatusOf } from '@utils/errorStatus';
import { type AppEvents, eventBus } from '@/core/events';
import {
  APP_LOG_SOURCES,
  type AppLogsClusterMeta,
  logAppLogsInfo,
  logAppLogsWarn,
} from '@/core/logging/appLogsClient';
import { getPreference, subscribePreference } from '@/core/settings/appPreferences';
import { compareUtf16Strings } from '@/shared/utils/sort';
import { fetchSnapshot, type Snapshot, setMetricsActive } from './client';
import { clusterReadiness } from './clusterReadiness';
import { parseClusterScope } from './clusterScope';
import { registerDefaultRefreshDomains } from './domainRegistrations';
import { getRefreshDomainDescriptor, METRIC_DEMAND_DOMAINS } from './domainRegistry';
import {
  initialMetricsDemandState,
  type MetricsDemandState,
  transitionMetricsDemandState,
} from './metricsDemandState';
import { isSnapshotPermissionDenied } from './permissionErrors';
import { RefreshErrorNotifier } from './refreshErrorNotifier';
import { refreshFailureOf } from './refreshFailure';
import { type RefreshIntent, runsWhilePaused, strongestIntent } from './refreshIntent';
import type { DomainRegistration, StreamingRegistration } from './refreshRegistration';
import {
  ClusterRefreshRuntime,
  type InFlightRequest,
  makeInFlightKey,
  type PendingClusterReadinessRequest,
  type RefreshDemand,
} from './refreshRuntime';
import { normalizeRefreshDomainScope } from './scopeNormalization';
import { hasOneShotQuery, tryParseRefreshScope } from './scopeSelector';
import { mergePollingListPayload } from './snapshotMerge';
import {
  type DomainSnapshotState,
  getRefreshState,
  getScopedDomainState,
  markPendingRequest,
  resetAllScopedDomainStates,
  resetPermissionDeniedScopedDomainStates,
  resetScopedDomainState,
  setScopedDomainState,
} from './store';
import {
  doorbellPollingContinues,
  isSupportedDomain as isDoorbellStreamDomain,
  isResourceStreamDomain,
} from './streaming/resourceStreamDomains';
import { resourceStreamManager } from './streaming/resourceStreamManager';
import { streamReconnectDelay } from './streaming/streamTiming';
import type { DomainPayloadMap, RefreshDomain } from './types';

type DomainFetchOptions = {
  intent: RefreshIntent;
  // One-shot page readers share work, including when initiated by the user.
  coalesce?: boolean;
  correlationId?: string;
  signal?: AbortSignal;
  // Scheduler-owned reconciliation. Query-only leases turn this into a
  // current-page invalidation instead of fetching an unused base snapshot.
  queryReconcile?: boolean;
};

type ReplayOptions = Pick<DomainFetchOptions, 'intent' | 'queryReconcile' | 'coalesce'>;

const isUserIntent = (options: { intent: RefreshIntent }): boolean => options.intent === 'user';

// A doorbell-triggered read bypasses the skip-while-stream-healthy gate: the
// signal IS the stream's refresh.
const isSignalIntent = (options: { intent: RefreshIntent }): boolean =>
  options.intent === 'stream-signal';

// A poll that outlives its contract timeout is a failed read, not a
// cancellation: its abort carries this reason so failure handling can tell an
// expired deadline from an owner cancelling the read.
class RefreshDeadlineError extends Error {
  constructor(domain: RefreshDomain, seconds: number) {
    super(`${domain} refresh timed out after ${seconds} s`);
    this.name = 'TimeoutError';
  }
}

type ScopedFetchExecution<K extends RefreshDomain> = {
  runtime: ClusterRefreshRuntime;
  scope: string;
  previousState: DomainSnapshotState<DomainPayloadMap[K]>;
  complete: () => void;
  controller: AbortController;
  requestId: number;
  contextVersion: number;
};

type ScopedDomainStateChange = {
  config: DomainRegistration<RefreshDomain>;
  domain: RefreshDomain;
  scope: string;
  enabled: boolean;
  preserveState: boolean;
  runtime: ClusterRefreshRuntime;
  changed: boolean;
};

const METRICS_DEMAND_RETRY_INITIAL_MS = 1_000;
const METRICS_DEMAND_RETRY_MAX_MS = 30_000;

const logInfo = (message: string, cluster?: AppLogsClusterMeta): void => {
  logAppLogsInfo(message, APP_LOG_SOURCES.RefreshOrchestrator, cluster);
};

const logWarning = (message: string, cluster?: AppLogsClusterMeta): void => {
  logAppLogsWarn(message, APP_LOG_SOURCES.RefreshOrchestrator, cluster);
};

class RefreshOrchestrator {
  private readonly configs = new Map<RefreshDomain, DomainRegistration<RefreshDomain>>();
  private readonly coordinatorRuntime = new ClusterRefreshRuntime('__coordinator__');
  private readonly clusterRuntimes = new Map<string, ClusterRefreshRuntime>();
  private requestCounter = 0;
  private metricsDemandState: MetricsDemandState = initialMetricsDemandState(
    METRICS_DEMAND_RETRY_INITIAL_MS
  );

  private documentHidden = false;
  private contextVersion = 0;
  private readonly errorNotifier = new RefreshErrorNotifier();

  constructor() {
    eventBus.on('view:reset', this.handleResetViews);
    eventBus.on('kubeconfig:changing', this.handleKubeconfigChanging);
    eventBus.on('kubeconfig:changed', this.handleKubeconfigChanged);
    eventBus.on('kubeconfig:selection-changed', this.handleKubeconfigSelectionChanged);
    subscribePreference('autoRefreshEnabled', this.handleAutoRefreshChanged);
    eventBus.on('app:visibility-hidden', this.handleDocumentHidden);
    eventBus.on('app:visibility-visible', this.handleDocumentVisible);
    eventBus.on('refresh:resource-stream-drift', this.handleResourceStreamDrift);
    eventBus.on(
      'refresh:resource-stream-permission-denied',
      this.handleResourceStreamPermissionDenied
    );
    eventBus.on('refresh:resource-stream-health', this.handleResourceStreamHealth);
    eventBus.on('refresh:stream-signal', this.handleStreamSignal);
    eventBus.on('cluster:auth:failed', this.handleClusterAuthFailed);
    eventBus.on('cluster:auth:recovered', this.handleClusterAuthRecovered);
    eventBus.on('cluster:scope-changed', this.handleClusterScopeChanged);
    eventBus.on('cluster:permissions-changed', this.handleClusterScopeChanged);
    clusterReadiness.onBecameServiceable((clusterId) =>
      this.handleClusterBecameServiceable(clusterId)
    );
    clusterReadiness.onForegroundActivationStarted((clusterId) =>
      this.handleForegroundActivationStarted(clusterId)
    );
    // Emit a single log so operators can confirm streaming config at runtime.
    logInfo('[refresh] resource streaming enabled (mode=active, domains=all)');
  }

  /** The scope's cluster has advertised a serving backend subsystem. */
  private isScopeClusterServiceable(scope: string): boolean {
    const { clusterId } = parseClusterScope(scope);
    if (!clusterId) {
      return true;
    }
    return Boolean(
      (this.clusterRuntimes.get(clusterId)?.isAuthAvailable() ?? true) &&
        clusterReadiness.isServiceable(clusterId)
    );
  }

  /** Hold a fetch for re-dispatch when the scope's cluster becomes serviceable. */
  private recordPendingClusterReadiness(
    domain: RefreshDomain,
    scope: string,
    options: ReplayOptions
  ): void {
    const { clusterId } = parseClusterScope(scope);
    // A background poll is not replayed: the scheduler and the restarted
    // stream reconcile the scope once its cluster serves.
    if (!clusterId || options.intent === 'background') {
      return;
    }
    this.getClusterRuntime(clusterId).deferUntilClusterReady({
      domain,
      scope,
      intents: [options.intent],
      queryReconcile: Boolean(options.queryReconcile),
      ...(options.coalesce ? { coalesce: true } : {}),
    });
  }

  private handleForegroundActivationStarted(clusterId: string): void {
    const runtime = this.clusterRuntimes.get(clusterId);
    if (!runtime) {
      return;
    }
    this.stopRuntimeStreaming(runtime, false);
    runtime.forEachInFlight((details, key) => {
      if (details.scope && this.isScopedDomainEnabledInternal(details.domain, details.scope)) {
        // Visible work replays with its original intent; background polls drop.
        this.recordPendingClusterReadiness(details.domain, details.scope, {
          intent: details.intent,
          coalesce: details.coalesce,
        });
        if (details.trailingStreamSignal) {
          this.recordPendingClusterReadiness(details.domain, details.scope, {
            intent: 'stream-signal',
          });
        }
      }
      this.teardownInFlight(runtime, key, details);
    });
  }

  private handleClusterBecameServiceable(clusterId: string): void {
    const pending = this.clusterRuntimes.get(clusterId)?.takeDeferredReadinessRequests() ?? [];
    for (const request of pending) {
      this.replayDeferredRequest(clusterId, request);
    }
    // Snapshotless streams have no queued fetch to wake them. Re-evaluate all
    // retained streaming leases whenever the activation hold is released.
    this.handleStreamingScopeChanges();
  }

  private replayDeferredRequest(clusterId: string, request: PendingClusterReadinessRequest): void {
    const { domain, scope } = request;
    // The lease may have been released (view left, cluster pruned) while the
    // cluster was warming up — held work dies with its demand.
    if (!this.configs.has(domain) || !this.isScopedDomainEnabledInternal(domain, scope)) {
      return;
    }
    if (!this.isScopeClusterServiceable(scope)) {
      // A multi-cluster scope with another cluster still warming.
      request.intents.forEach((deferredIntent) => {
        this.recordPendingClusterReadiness(domain, scope, { ...request, intent: deferredIntent });
      });
      return;
    }
    // While auto-refresh is off only foreground and user reads replay; the
    // scope's streams and polls reconcile the rest once it resumes.
    const intent = strongestIntent(
      request.intents.filter((candidate) => this.intentRuns(candidate))
    );
    if (!intent) {
      return;
    }
    void this.fetchScopedDomain(domain, scope, {
      intent,
      ...(request.coalesce ? { coalesce: true } : {}),
      queryReconcile: request.queryReconcile,
    }).catch((error) => {
      logWarning(
        `[refresh] deferred ${domain} fetch after cluster ${clusterId} became serviceable failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }

  private notifyRefreshError(
    domain: RefreshDomain,
    scope: string | undefined,
    message: string,
    error?: unknown,
    operationId?: string,
    replay?: ReplayOptions
  ): void {
    if (errorStatusOf(error)?.reason === 'ClusterNotReady') {
      // The cluster's backend subsystem is still initializing (its lifecycle
      // state was unknown when the fetch dispatched). Warm-up, not failure:
      // hold a read for re-dispatch on readiness and skip the toast. A stream
      // start restarts on its own once the cluster serves.
      if (scope && replay) {
        this.recordPendingClusterReadiness(domain, scope, replay);
      }
      logInfo(`[refresh] ${domain} fetch deferred until its cluster is ready (${scope ?? ''})`);
      return;
    }
    this.errorNotifier.notify({
      domain,
      scope,
      message,
      category: this.configs.get(domain)?.category,
      ...(error !== undefined ? { error } : {}),
      ...(operationId ? { operationId } : {}),
    });
  }

  private clearRefreshError(domain: RefreshDomain, scope?: string): void {
    this.errorNotifier.clear(domain, scope);
  }

  registerDomain<K extends RefreshDomain>(config: DomainRegistration<K>): void {
    this.configs.set(config.domain, config);
  }

  // The open clusters. A cluster that leaves the set loses its runtime: its
  // leases, streams, polls, in-flight reads, and retained data.
  setConnectedClusters(clusterIds: readonly string[]): void {
    this.pruneRemovedClusterRuntimes(clusterIds);
  }

  // Manual refresh (⌘R, Refresh Now) reads every scope the named cluster
  // leases: what that cluster shows. Stream-only domains have no snapshot.
  async refreshCluster(clusterId: string): Promise<void> {
    const runtime = this.clusterRuntimes.get(clusterId.trim());
    const name = `cluster:${clusterId}`;
    eventBus.emit('refresh:start', { name, isManual: true });
    try {
      await Promise.all(
        (runtime?.getLeasedScopes() ?? [])
          .filter(({ domain }) => !this.configs.get(domain)?.streaming?.snapshotless)
          .map(({ domain, scope }) =>
            this.fetchScopedDomain(domain, scope, { intent: 'user', queryReconcile: true })
          )
      );
      eventBus.emit('refresh:complete', { name, isManual: true, success: true });
    } catch (error) {
      eventBus.emit('refresh:complete', { name, isManual: true, success: false, error });
      throw error;
    }
  }

  // Disables every scope of a domain that no lease holds.
  private disableDomain(domain: RefreshDomain): void {
    this.getKnownScopes(domain).forEach((scope) => {
      this.disableScopedDomain(domain, scope);
    });
    this.updateMetricsDemand();
  }

  private scheduleStreamingStart(
    domain: RefreshDomain,
    scope: string,
    streaming: StreamingRegistration
  ): void {
    const normalizedScope = scope.trim();
    if (!normalizedScope) {
      return;
    }

    const runtime = this.getRuntimeForScope(normalizedScope);
    if (runtime.hasStreamingReady(domain, normalizedScope)) {
      return;
    }

    // All domains are scoped — set loading state in the scoped store.
    setScopedDomainState(domain, normalizedScope, (previous) => ({
      ...previous,
      status: previous.data ? 'updating' : 'initialising',
      error: null,
      scope: normalizedScope,
    }));

    let readyTask: Promise<void>;
    readyTask = Promise.resolve()
      .then(() => {
        if (
          !this.isRuntimeCurrent(runtime) ||
          !this.isScopedDomainEnabledInternal(domain, normalizedScope)
        ) {
          return;
        }
        void this.startStreamingScope(domain, normalizedScope, streaming);
      })
      .catch((error) => {
        if (!this.isRuntimeCurrent(runtime)) {
          return;
        }
        const message =
          error instanceof Error ? error.message : 'Failed to initialise refresh subsystem';
        setScopedDomainState(domain, normalizedScope, (previous) => ({
          ...previous,
          status: 'error',
          error: refreshFailureOf(error instanceof Error ? error : new Error(message)),
          scope: normalizedScope,
        }));
        const notificationScope = normalizedScope?.trim() || undefined;
        this.notifyRefreshError(domain, notificationScope, message, error);
      })
      .finally(() => {
        runtime.clearStreamingReady(domain, normalizedScope, readyTask);
      });

    runtime.setStreamingReady(domain, normalizedScope, readyTask);
  }

  private getKnownScopes(domain: RefreshDomain): string[] {
    const scopes = new Set<string>();
    this.getAllRuntimes().forEach((runtime) => {
      runtime.getKnownScopes(domain).forEach((scope) => {
        scopes.add(scope);
      });
    });
    return Array.from(scopes);
  }

  private resetDomain(domain: RefreshDomain): void {
    resetAllScopedDomainStates(domain);
  }

  private reconcileStreamingScopeEnabled(
    domain: RefreshDomain,
    scope: string,
    enabled: boolean,
    preserveState: boolean,
    runtime: ClusterRefreshRuntime,
    streaming: StreamingRegistration
  ): void {
    const plan = this.scopeStreamPlan(domain, scope);
    if (enabled && plan === 'now') {
      runtime.clearStreamingReady(domain, scope);
      if (!preserveState) {
        resetScopedDomainState(domain, scope);
      }
      this.scheduleStreamingStart(domain, scope, streaming);
      return;
    }
    if (!enabled) {
      runtime.clearStreamingReady(domain, scope);
      this.stopStreamingScope(domain, scope, streaming, !preserveState);
      this.cancelInFlightForScopedDomain(domain, scope);
      return;
    }
    if (plan === 'once-serviceable') {
      // Warm-up is loading: the stream starts once the cluster serves
      // (handleClusterBecameServiceable), and query readers wait for it.
      setScopedDomainState(domain, scope, (previous) => ({
        ...previous,
        status: previous.data ? previous.status : 'initialising',
        scope,
      }));
    }
    if (runtime.hasStreamingBookkeeping(domain, scope)) {
      runtime.clearStreamingReady(domain, scope);
      this.stopStreamingScope(domain, scope, streaming, false);
    }
  }

  private reconcileScopedDomainStateChange(change: ScopedDomainStateChange): void {
    const { config, domain, scope, enabled, preserveState, runtime, changed } = change;
    if (!changed) {
      this.updateMetricsDemand();
      return;
    }

    if (config.streaming) {
      this.reconcileStreamingScopeEnabled(
        domain,
        scope,
        enabled,
        preserveState,
        runtime,
        config.streaming
      );
      this.updateMetricsDemand();
      return;
    }

    if (!enabled) {
      this.cancelInFlightForScopedDomain(domain, scope);
      if (!preserveState) {
        resetScopedDomainState(domain, scope);
      }
    }
    this.updateMetricsDemand();
  }

  // Disables a scope once no lease holds it: the final release, or teardown.
  // A held scope stays enabled, so one consumer can never stop work another
  // consumer still shows.
  private disableScopedDomain(
    domain: RefreshDomain,
    scope: string,
    options?: { preserveState?: boolean }
  ): void {
    const config = this.getConfig(domain);
    const runtime = this.getRuntimeForScope(scope);
    const { changed } = runtime.disableScopedDomain(domain, scope);
    // preserveState keeps the last scoped snapshot in the store, so a remount
    // repaints it instead of blanking the view.
    this.reconcileScopedDomainStateChange({
      config,
      domain,
      scope,
      enabled: false,
      preserveState: Boolean(options?.preserveState),
      runtime,
      changed,
    });
  }

  // Acquire a reference-counted lease that keeps (domain, scope) enabled while
  // any mounted consumer holds it. The scope is enabled only on the first lease
  // so concurrent and remounting consumers share one enable.
  acquireScopedDomainLease(
    domain: RefreshDomain,
    scope: string,
    options?: { preserveState?: boolean; demand?: RefreshDemand }
  ): void {
    const normalizedScope = this.normalizeDomainScope(domain, scope);
    if (!normalizedScope) {
      throw new Error(`Scoped domain "${domain}" requires a non-empty scope value`);
    }
    const runtime = this.getRuntimeForScope(normalizedScope);
    const demand = options?.demand ?? 'snapshot';
    const hadSnapshotDemand = runtime.hasScopedDemand(domain, normalizedScope, 'snapshot');
    const { firstLease, activationChanged } = runtime.acquireScopedLease(
      domain,
      normalizedScope,
      demand
    );
    if (firstLease) {
      const config = this.getConfig(domain);
      this.reconcileScopedDomainStateChange({
        config,
        domain,
        scope: normalizedScope,
        enabled: true,
        preserveState: Boolean(options?.preserveState),
        runtime,
        changed: activationChanged,
      });
      this.schedulePoll(domain, normalizedScope);
      return;
    }
    if (demand === 'snapshot' && !hadSnapshotDemand) {
      const streaming = this.getConfig(domain).streaming;
      if (streaming) {
        this.reconcileInitialStreamingSnapshot(domain, normalizedScope, streaming);
      }
    }
  }

  // Release a lease previously acquired via acquireScopedDomainLease. The scope
  // is disabled only when the final lease is released, so an old consumer's
  // unmount cannot disable a scope a newer consumer still leases.
  releaseScopedDomainLease(
    domain: RefreshDomain,
    scope: string,
    options?: { preserveState?: boolean; demand?: RefreshDemand }
  ): void {
    const normalizedScope = this.normalizeDomainScope(domain, scope);
    if (!normalizedScope) {
      return;
    }
    const runtime = this.getRuntimeForScope(normalizedScope);
    const { lastLease, resetOnRelease } = runtime.releaseScopedLease(
      domain,
      normalizedScope,
      options?.demand ?? 'snapshot'
    );
    if (!lastLease) {
      return;
    }
    this.cancelPoll(runtime, domain, normalizedScope);
    this.disableScopedDomain(domain, normalizedScope, {
      preserveState: Boolean(options?.preserveState) && !resetOnRelease,
    });
    if (resetOnRelease) {
      this.resetScopedDomain(domain, normalizedScope);
    }
  }

  // Clears a scope's retained state. While a lease still holds the scope, the
  // reset waits for the last release: another consumer may be showing it.
  resetScopedDomain(domain: RefreshDomain, scope: string): void {
    const normalizedScope = this.normalizeDomainScope(domain, scope);
    if (!normalizedScope) {
      return;
    }
    if (this.getRuntimeForScope(normalizedScope).deferResetUntilReleased(domain, normalizedScope)) {
      return;
    }
    // A stream owner can keep a stopped scope's data for a remount and would
    // publish it again; resetting a scope nobody streams resets the owner too.
    // A scope still in use keeps its stream.
    const streaming = this.configs.get(domain)?.streaming;
    if (streaming && !this.isScopedDomainEnabledInternal(domain, normalizedScope)) {
      this.stopStreamingScope(domain, normalizedScope, streaming, true);
      return;
    }
    resetScopedDomainState(domain, normalizedScope);
  }

  private getStreamingTarget(domain: RefreshDomain, scope: string) {
    const { streaming } = this.getConfig(domain);
    if (!streaming) {
      throw new Error(`Domain "${domain}" is not registered as streaming`);
    }
    const normalizedScope = this.normalizeDomainScope(domain, scope);
    if (!normalizedScope) {
      throw new Error(`Streaming domain "${domain}" requires a non-empty scope value`);
    }
    return { streaming, scope: normalizedScope };
  }

  async refreshStreamingDomainOnce(domain: RefreshDomain, scope: string): Promise<void> {
    const target = this.getStreamingTarget(domain, scope);
    if (target.streaming.refreshOnce) {
      await target.streaming.refreshOnce(target.scope);
      return;
    }
    await this.restartStreamingDomain(domain, target.scope);
  }

  async restartStreamingDomain(domain: RefreshDomain, scope: string): Promise<void> {
    const target = this.getStreamingTarget(domain, scope);
    this.stopStreamingScope(domain, target.scope, target.streaming, false);
    await this.startStreamingScope(domain, target.scope, target.streaming);
  }

  isStreamingDomain(domain: RefreshDomain): boolean {
    const config = this.configs.get(domain);
    return Boolean(config?.streaming);
  }

  // Public for diagnostics: a drift-blocked scope polls until an app-level
  // reset and must be labeled distinctly from a self-healing fallback.
  isStreamingBlocked(domain: RefreshDomain, scope?: string): boolean {
    if (!isResourceStreamDomain(domain) || !scope) {
      return false;
    }
    return this.getRuntimeForScope(scope).isStreamingBlocked(domain, scope);
  }

  private isStreamingActive(domain: RefreshDomain, scope: string): boolean {
    return this.getRuntimeForScope(scope).isStreamingActive(domain, scope);
  }

  // Resource stream health gates polling so snapshots stay active until delivery resumes.
  // Driven by the doorbell descriptor table (resource tables + catalog/events/namespaces
  // doorbells) so a new doorbell domain cannot silently keep polling here.
  private isStreamingHealthy(domain: RefreshDomain, scope?: string): boolean {
    if (!scope) {
      return false;
    }
    // Poll-augmented doorbell domains (cluster-overview): the doorbell's
    // signal source is not guaranteed to ever fire (metric doorbells ring
    // only on successful collections), so a healthy stream must NOT suppress
    // their polls — report not-healthy to the fetch gate; signals still
    // deliver and refetch through the stream subscription.
    if (doorbellPollingContinues(domain)) {
      return false;
    }
    if (isDoorbellStreamDomain(domain)) {
      return resourceStreamManager.isHealthy(domain, scope);
    }
    return false;
  }

  private shouldStreamScope(domain: RefreshDomain, scope?: string): boolean {
    return this.scopeStreamPlan(domain, scope) === 'now';
  }

  // Whether a scope streams now, once its cluster can serve, or not at all.
  private scopeStreamPlan(
    domain: RefreshDomain,
    scope?: string
  ): 'now' | 'once-serviceable' | 'never' {
    const trimmed = scope?.trim() ?? '';
    if (!trimmed || !getPreference('autoRefreshEnabled')) {
      return 'never';
    }
    // One-shot query scopes are never streaming targets, for ANY domain: event
    // queries share the singleton named stream with the parameterless base
    // scope and would churn it on every query.
    const parsed = tryParseRefreshScope(domain, trimmed);
    if (!parsed || hasOneShotQuery(parsed) || this.isStreamingBlocked(domain, trimmed)) {
      return 'never';
    }
    // No stream can be established while the scope's cluster backend is still
    // initializing — the named-stream handler rejects the request and the
    // client would otherwise hot-loop on reconnect attempts.
    return this.isScopeClusterServiceable(trimmed) ? 'now' : 'once-serviceable';
  }

  private getConfig(domain: RefreshDomain): DomainRegistration<RefreshDomain> {
    const config = this.configs.get(domain);
    if (!config) {
      throw new Error(`Refresh domain "${domain}" is not registered`);
    }
    return config;
  }

  private stopAllStreaming(reset: boolean): void {
    this.getAllRuntimes().forEach((runtime) => {
      this.stopRuntimeStreaming(runtime, reset);
    });
  }

  private stopRuntimeStreaming(runtime: ClusterRefreshRuntime, reset: boolean): void {
    runtime.resetAllStreamStartRetries().forEach((timer) => {
      globalThis.clearTimeout(timer);
    });
    runtime.getStreamingScopes().forEach(({ domain, scope }) => {
      if (!scope || scope === '*') {
        return;
      }
      const config = this.configs.get(domain);
      if (!config?.streaming) {
        return;
      }
      this.stopStreamingScope(domain, scope, config.streaming, reset);
    });

    if (reset) {
      runtime.clearAllStreaming(reset);
    }
  }

  private startStreamingScope(
    domain: RefreshDomain,
    scope: string,
    streaming: StreamingRegistration
  ): Promise<void> {
    if (!this.isScopeClusterServiceable(scope)) {
      return Promise.resolve();
    }
    if (!this.isScopedDomainEnabledInternal(domain, scope)) {
      return Promise.resolve();
    }
    const runtime = this.getRuntimeForScope(scope);
    if (runtime.isStreamingStartingOrActive(domain, scope)) {
      return Promise.resolve();
    }
    this.clearTimer(runtime.takeStreamStartRetry(domain, scope));

    const startPromise = streaming.start(scope);
    runtime.beginStreamingStart(domain, scope, startPromise);

    startPromise
      .then(() => this.completeStreamingStart(domain, scope, streaming, runtime, startPromise))
      .catch((error) => this.failStreamingStart(domain, scope, runtime, startPromise, error));

    return startPromise.then(() => undefined).catch(() => undefined);
  }

  private completeStreamingStart(
    domain: RefreshDomain,
    scope: string,
    streaming: StreamingRegistration,
    runtime: ClusterRefreshRuntime,
    startPromise: Promise<void>
  ): void {
    if (!this.isRuntimeCurrent(runtime)) {
      return;
    }
    const enabledNow = this.isScopedDomainEnabledInternal(domain, scope);
    if (!enabledNow || runtime.isStreamingCancelled(domain, scope)) {
      runtime.failStreamingStart(domain, scope, startPromise);
      runtime.clearStreamingCancelled(domain, scope);
      if (enabledNow) {
        // A re-enable can race the cancelled start. Restart here because the
        // re-enable observed this pending promise and could not start its own.
        void this.startStreamingScope(domain, scope, streaming);
      }
      return;
    }

    if (!runtime.finishStreamingStart(domain, scope, startPromise)) {
      return;
    }
    this.clearTimer(runtime.resetStreamStartRetry(domain, scope));
    // A newly subscribed notify-only stream needs one bounded snapshot so a
    // quiet or permission-denied scope can settle without waiting for polling.
    this.reconcileInitialStreamingSnapshot(domain, scope, streaming);
  }

  private failStreamingStart(
    domain: RefreshDomain,
    scope: string,
    runtime: ClusterRefreshRuntime,
    startPromise: Promise<void>,
    error: unknown
  ): void {
    runtime.failStreamingStart(domain, scope, startPromise);
    if (!this.isRuntimeCurrent(runtime)) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    setScopedDomainState(domain, scope, (previous) => ({
      ...previous,
      status: 'error',
      error: refreshFailureOf(error),
      scope,
    }));
    const notificationScope = scope.trim() || undefined;
    this.notifyRefreshError(domain, notificationScope, message, error);
    this.scheduleStreamStartRetry(domain, scope, runtime);
  }

  // A failed start retries with the stream managers' reconnect backoff while
  // the scope stays leased. Polls cover the scope until the stream is up.
  private scheduleStreamStartRetry(
    domain: RefreshDomain,
    scope: string,
    runtime: ClusterRefreshRuntime
  ): void {
    if (!runtime.hasScopedLease(domain, scope)) {
      return;
    }
    const delay = streamReconnectDelay(runtime.getStreamStartFailures(domain, scope));
    const timer = globalThis.setTimeout(() => {
      runtime.takeStreamStartRetry(domain, scope);
      const streaming = this.configs.get(domain)?.streaming;
      if (
        streaming &&
        this.isRuntimeCurrent(runtime) &&
        runtime.hasScopedLease(domain, scope) &&
        this.shouldStreamScope(domain, scope)
      ) {
        void this.startStreamingScope(domain, scope, streaming);
      }
    }, delay);
    runtime.setStreamStartRetry(domain, scope, timer);
  }

  private clearTimer(timer: ReturnType<typeof setTimeout> | undefined): void {
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
    }
  }

  private reconcileInitialStreamingSnapshot(
    domain: RefreshDomain,
    scope: string,
    streaming: StreamingRegistration
  ): void {
    const runtime = this.getRuntimeForScope(scope);
    const leaseAllowsSnapshot =
      !runtime.hasScopedLease(domain, scope) || runtime.hasScopedDemand(domain, scope, 'snapshot');
    if (
      !leaseAllowsSnapshot ||
      streaming.snapshotless ||
      getScopedDomainState(domain, scope).data
    ) {
      return;
    }
    void this.performFetch(domain, scope, { intent: 'stream-signal' }).catch(() => {
      // Failures land in the scoped state via performFetch's own path.
    });
  }

  private stopStreamingScope(
    domain: RefreshDomain,
    scope: string,
    streaming: StreamingRegistration,
    reset: boolean
  ): void {
    const runtime = this.getRuntimeForScope(scope);
    this.clearTimer(runtime.resetStreamStartRetry(domain, scope));
    const pending = runtime.cancelStreamingStart(domain, scope);

    if (pending) {
      pending
        .then(() => {
          // LOAD-BEARING — docs/architecture/refresh-system.md, "Streaming
          // Start Lifecycle": teardown has exactly one owner. The start's
          // own continuation (attached first) already handled a cancelled
          // arrival — teardown, or an adopted restart when the scope was
          // re-enabled — and cleared the cancel flag. Acting here too would
          // tear down twice, or clear a restarted start's cancellation. The
          // flag still being set means this stop still owns the teardown.
          if (!runtime.isStreamingCancelled(domain, scope)) {
            return;
          }
          runtime.failStreamingStart(domain, scope, pending);
          runtime.clearStreamingCancelled(domain, scope);
        })
        .catch(() => {
          runtime.failStreamingStart(domain, scope, pending);
          runtime.clearStreamingCancelled(domain, scope);
        });
    }

    runtime.markStreamingStopped(domain, scope);
    runtime.clearStreamHealth(domain, scope);
    streaming.stop?.(scope, { reset });
    if (reset) {
      resetScopedDomainState(domain, scope);
    }
  }

  private normalizeDomainScope(domain: RefreshDomain, value?: string | null): string | undefined {
    return normalizeRefreshDomainScope(domain, value);
  }

  private getClusterRuntime(clusterId: string): ClusterRefreshRuntime {
    const normalized = clusterId.trim();
    let runtime = this.clusterRuntimes.get(normalized);
    if (!runtime) {
      runtime = new ClusterRefreshRuntime(normalized);
      this.clusterRuntimes.set(normalized, runtime);
    }
    return runtime;
  }

  private getRuntimeForScope(scope?: string): ClusterRefreshRuntime {
    if (!scope) {
      return this.coordinatorRuntime;
    }
    const { clusterId } = parseClusterScope(scope);
    return clusterId ? this.getClusterRuntime(clusterId) : this.coordinatorRuntime;
  }

  // Async work belongs to the runtime that started it, including across a
  // close/reopen of the same cluster. Checking ownership must not create one.
  private isRuntimeCurrent(runtime: ClusterRefreshRuntime): boolean {
    return (
      runtime === this.coordinatorRuntime || this.clusterRuntimes.get(runtime.clusterId) === runtime
    );
  }

  private getAllRuntimes(): ClusterRefreshRuntime[] {
    return [this.coordinatorRuntime, ...this.clusterRuntimes.values()];
  }

  private forEachRuntime(callback: (runtime: ClusterRefreshRuntime) => void): void {
    this.getAllRuntimes().forEach(callback);
  }

  private deleteDomainFromAllRuntimes(domain: RefreshDomain): void {
    this.forEachRuntime((runtime) => runtime.deleteDomain(domain));
  }

  private abortAllInFlight(): void {
    this.forEachRuntime((runtime) => {
      runtime.forEachInFlight((details, key) => {
        this.teardownInFlight(runtime, key, details);
      });
    });
  }

  private clearAllBlockedStreaming(): void {
    this.forEachRuntime((runtime) => runtime.clearBlockedStreaming());
  }

  private clearAllStreamHealth(): void {
    this.forEachRuntime((runtime) => runtime.clearAllStreamHealth());
  }

  private resetRuntimePermissionEpoch(runtime: ClusterRefreshRuntime): void {
    runtime.resetPermissionEpoch().forEach(({ domain, scope }) => {
      setScopedDomainState(domain, scope, (previous) => ({
        ...previous,
        permissionDenied: false,
      }));
    });
  }

  private pruneRemovedClusterRuntimes(connectedClusterIds: readonly string[]): void {
    const connected = new Set(
      connectedClusterIds.map((clusterId) => clusterId.trim()).filter(Boolean)
    );

    // Reset the global scoped-domain state of every removed cluster up front. This sweeps the
    // store directly (the diagnostics source of truth) rather than each runtime's enabled-scope
    // set, so snapshot/stream scopes that carry retained data but no polling lease — e.g.
    // cluster-events, polling disabled — are cleaned up too. forEachScopedDomain only sees
    // enabled leases, so it would leave those orphaned for a closed cluster.
    this.resetScopedStatesForRemovedClusters(connected);
    this.errorNotifier.clearRemovedClusters(connected);
    Array.from(this.clusterRuntimes.entries()).forEach(([clusterId, runtime]) => {
      if (connected.has(clusterId)) {
        return;
      }

      this.stopRuntimeStreaming(runtime, true);
      this.cancelRuntimePolls(runtime);
      runtime.forEachInFlight((details, key) => {
        this.teardownInFlight(runtime, key, details);
      });
      runtime.resetAllState();
      this.clusterRuntimes.delete(clusterId);
      // Let cluster-keyed caches outside the refresh store die with the runtime.
      eventBus.emit('refresh:cluster-pruned', { clusterId });
    });
    this.updateMetricsDemand();
  }

  // resetScopedStatesForRemovedClusters clears the global scoped-domain state of every scope
  // whose cluster is absent from the connected set. A scope with no cluster id belongs to
  // the coordinator runtime (not a cluster) and is left untouched.
  private resetScopedStatesForRemovedClusters(connected: Set<string>): void {
    const { scopedDomainEntries } = getRefreshState();
    (Object.keys(scopedDomainEntries) as RefreshDomain[]).forEach((domain) => {
      (scopedDomainEntries[domain] ?? []).forEach(([scope]) => {
        const { clusterId } = parseClusterScope(scope);
        if (clusterId && !connected.has(clusterId)) {
          resetScopedDomainState(domain, scope);
        }
      });
    });
  }

  // Diagnostics: whether a scope's poll runs and how often. `off` covers
  // domains that never poll and scopes no consumer leases.
  getPollingStatus(
    domain: RefreshDomain,
    scope: string | undefined
  ): { state: 'scheduled' | 'paused' | 'off'; intervalMs: number | null } {
    const runtime = scope ? this.getExistingRuntimeForScope(scope) : undefined;
    if (!scope || !this.isPolledDomain(domain) || !runtime?.hasScopedLease(domain, scope)) {
      return { state: 'off', intervalMs: null };
    }
    const intervalMs = getRefreshDomainDescriptor(domain).timing.interval;
    return { state: this.isPassiveWorkPaused() ? 'paused' : 'scheduled', intervalMs };
  }

  private getExistingRuntimeForScope(scope: string): ClusterRefreshRuntime | undefined {
    const { clusterId } = parseClusterScope(scope);
    return clusterId ? this.clusterRuntimes.get(clusterId) : this.coordinatorRuntime;
  }

  private isPassiveWorkPaused(): boolean {
    return !getPreference('autoRefreshEnabled') || this.documentHidden;
  }

  // Auto-refresh off pauses passive reads; foreground and user reads still run.
  private intentRuns(intent: RefreshIntent): boolean {
    return getPreference('autoRefreshEnabled') || runsWhilePaused(intent);
  }

  // Every leased scope polls at its contract interval, except stream-only
  // domains, which have no snapshot to read. The poll's read decides whether a
  // healthy stream makes it unnecessary.
  private isPolledDomain(domain: RefreshDomain): boolean {
    const config = this.configs.get(domain);
    return Boolean(config && !config.streaming?.snapshotless);
  }

  private schedulePoll(domain: RefreshDomain, scope: string): void {
    const runtime = this.getRuntimeForScope(scope);
    this.cancelPoll(runtime, domain, scope);
    if (
      !this.isPolledDomain(domain) ||
      this.isPassiveWorkPaused() ||
      !runtime.hasScopedLease(domain, scope)
    ) {
      return;
    }
    const { interval } = getRefreshDomainDescriptor(domain).timing;
    const timer = globalThis.setTimeout(() => {
      void this.runPoll(runtime, domain, scope);
    }, interval);
    runtime.setPollTimer(domain, scope, timer);
  }

  private cancelPoll(runtime: ClusterRefreshRuntime, domain: RefreshDomain, scope: string): void {
    const timer = runtime.takePollTimer(domain, scope);
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
    }
  }

  private cancelRuntimePolls(runtime: ClusterRefreshRuntime): void {
    runtime.takeAllPollTimers().forEach((timer) => {
      globalThis.clearTimeout(timer);
    });
  }

  // Applies a pause change: cancels every poll, then re-arms leased scopes
  // unless passive work is paused.
  private reschedulePolls(): void {
    this.forEachRuntime((runtime) => {
      this.cancelRuntimePolls(runtime);
      runtime.getLeasedScopes().forEach(({ domain, scope }) => {
        this.schedulePoll(domain, scope);
      });
    });
  }

  private async runPoll(
    runtime: ClusterRefreshRuntime,
    domain: RefreshDomain,
    scope: string
  ): Promise<void> {
    runtime.takePollTimer(domain, scope);
    if (!this.isRuntimeCurrent(runtime) || !runtime.hasScopedLease(domain, scope)) {
      return;
    }
    const controller = new AbortController();
    const timeoutSeconds = getRefreshDomainDescriptor(domain).timing.timeout;
    const timeout = globalThis.setTimeout(
      () => controller.abort(new RefreshDeadlineError(domain, timeoutSeconds)),
      timeoutSeconds * 1000
    );
    try {
      await this.fetchScopedDomain(domain, scope, {
        intent: 'background',
        queryReconcile: true,
        signal: controller.signal,
      });
    } catch (error) {
      logWarning(
        `[refresh] ${domain} poll failed (${scope}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      globalThis.clearTimeout(timeout);
    }
    // The next poll is an interval after this one settles, so polls never
    // overlap; a pause or release in the meantime leaves it unscheduled.
    if (this.isRuntimeCurrent(runtime) && !runtime.isPollScheduled(domain, scope)) {
      this.schedulePoll(domain, scope);
    }
  }

  private reconcileQueryOnlyDemand(
    domain: RefreshDomain,
    scope: string,
    options: Pick<DomainFetchOptions, 'intent' | 'queryReconcile'>,
    config: DomainRegistration<RefreshDomain>,
    runtime: ClusterRefreshRuntime
  ): boolean {
    const hasQueryOnlyDemand =
      runtime.hasScopedDemand(domain, scope, 'query') &&
      !runtime.hasScopedDemand(domain, scope, 'snapshot');
    if (!options.queryReconcile || !hasQueryOnlyDemand) {
      return false;
    }

    const streamingExpected = Boolean(config.streaming) && this.shouldStreamScope(domain, scope);
    const streamingHealthy = streamingExpected && this.isStreamingHealthy(domain, scope);
    if (!isUserIntent(options) && streamingHealthy) {
      return true;
    }
    if (!isUserIntent(options) && streamingExpected && isResourceStreamDomain(domain)) {
      // Query-only consumers refetch their own page instead of loading a base
      // snapshot here, but the scheduled poll is still a stream fallback.
      resourceStreamManager.recordStreamFallback(domain, scope, 'stream not delivering');
    }
    setScopedDomainState(domain, scope, (previous) => ({
      ...previous,
      queryReconcileVersion: (previous.queryReconcileVersion ?? 0) + 1,
      scope,
    }));
    return true;
  }

  private async reconcileStreamingFetch(
    domain: RefreshDomain,
    scope: string,
    options: Pick<DomainFetchOptions, 'intent' | 'coalesce'>,
    streaming: StreamingRegistration | undefined,
    runtime: ClusterRefreshRuntime
  ): Promise<boolean> {
    if (!streaming) {
      return false;
    }

    const shouldStream = this.shouldStreamScope(domain, scope);
    if (
      shouldStream &&
      isUserIntent(options) &&
      !options.coalesce &&
      isResourceStreamDomain(domain) &&
      this.isStreamingActive(domain, scope)
    ) {
      await this.refreshStreamingDomainOnce(domain, scope);
      return true;
    }

    const decision = runtime.resolveStreamingFetchMode({
      domain,
      scope,
      shouldStream,
      isManual: isUserIntent(options),
      streamSignal: isSignalIntent(options) || runtime.needsReconciliation(domain, scope),
      streamingHealthy: this.isStreamingHealthy(domain, scope),
      hasData: Boolean(getScopedDomainState(domain, scope).data),
    });
    if (decision.fallback && isResourceStreamDomain(domain)) {
      // Count the poll the stream should have made unnecessary, so diagnostics
      // can tell "streaming is on" from "streaming is carrying the load".
      resourceStreamManager.recordStreamFallback(domain, scope, 'stream not delivering');
    }
    return decision.mode === 'skip';
  }

  async fetchScopedDomain<K extends RefreshDomain>(
    domain: K,
    scope: string,
    options: Pick<
      DomainFetchOptions,
      'intent' | 'signal' | 'queryReconcile' | 'coalesce' | 'correlationId'
    >
  ): Promise<void> {
    const config = this.getConfig(domain);
    const normalizedScope = this.normalizeDomainScope(domain, scope);
    if (!normalizedScope) {
      throw new Error(`Scoped domain "${domain}" requires a non-empty scope`);
    }

    // A cluster whose backend subsystem is still initializing cannot serve any
    // request yet (the backend answers ClusterNotReady). Hold the work and
    // re-dispatch on the lifecycle's became-serviceable edge — warm-up is
    // loading, not failure.
    if (!this.isScopeClusterServiceable(normalizedScope)) {
      this.recordPendingClusterReadiness(domain, normalizedScope, options);
      return;
    }

    const runtime = this.getRuntimeForScope(normalizedScope);
    if (this.reconcileQueryOnlyDemand(domain, normalizedScope, options, config, runtime)) {
      return;
    }

    if (
      await this.reconcileStreamingFetch(
        domain,
        normalizedScope,
        options,
        config.streaming,
        runtime
      )
    ) {
      return;
    }

    if (!this.isRuntimeCurrent(runtime)) {
      return;
    }
    await this.performFetch(domain, normalizedScope, {
      ...(options.coalesce ? { coalesce: true } : {}),
      intent: options.intent,
      signal: options.signal,
      correlationId: options.correlationId,
    });
  }

  private canFetchScope(
    domain: RefreshDomain,
    scope: string,
    options: DomainFetchOptions
  ): boolean {
    if (
      !isUserIntent(options) &&
      !this.getRuntimeForScope(scope).canRetryReconciliation(domain, scope)
    ) {
      return false;
    }
    if (options.signal?.aborted) {
      return false;
    }
    if (!this.isScopeClusterServiceable(scope)) {
      this.recordPendingClusterReadiness(domain, scope, options);
      return false;
    }
    if (!this.isScopedDomainEnabledInternal(domain, scope)) {
      resetScopedDomainState(domain, scope);
      return false;
    }
    return true;
  }

  private claimFetchSlot(
    domain: RefreshDomain,
    scope: string,
    options: DomainFetchOptions,
    runtime: ClusterRefreshRuntime
  ): boolean {
    const currentInFlight = runtime.getInFlight(domain, scope);
    if (!currentInFlight) {
      return true;
    }
    if (isUserIntent(options) && !options.coalesce) {
      this.teardownInFlight(runtime, makeInFlightKey(domain, scope), currentInFlight);
      return true;
    }
    if (isSignalIntent(options) || options.coalesce) {
      // Coalesce doorbells arriving during the request into one trailing
      // refetch. Aborting here can starve a busy scope indefinitely.
      runtime.latchTrailingStreamSignal(domain, scope);
    }
    return false;
  }

  private beginFetch<K extends RefreshDomain>(
    domain: K,
    scope: string,
    options: DomainFetchOptions,
    runtime: ClusterRefreshRuntime,
    previousState: DomainSnapshotState<DomainPayloadMap[K]>,
    contextVersion: number
  ): ScopedFetchExecution<K> | null {
    setScopedDomainState(domain, scope, (previous) => ({
      ...previous,
      status: previousState.data ? 'updating' : 'loading',
      error: null,
      isManual: isUserIntent(options),
      scope,
    }));

    const controller = new AbortController();
    if (options.signal?.aborted) {
      return null;
    }
    const cleanup = this.forwardAbortSignal(options.signal, controller);
    const requestId = ++this.requestCounter;
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const request: InFlightRequest = {
      completion,
      controller,
      intent: options.intent,
      coalesce: options.coalesce,
      requestId,
      cleanup,
      contextVersion,
      domain,
      scope,
    };
    runtime.setInFlight(request);
    markPendingRequest(1);
    return { runtime, scope, previousState, controller, requestId, contextVersion, complete };
  }

  private forwardAbortSignal(
    signal: AbortSignal | undefined,
    controller: AbortController
  ): (() => void) | undefined {
    if (!signal) {
      return undefined;
    }
    const abortListener = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abortListener);
    return () => signal.removeEventListener('abort', abortListener);
  }

  private fetchCanCommit<K extends RefreshDomain>(execution: ScopedFetchExecution<K>): boolean {
    return !execution.controller.signal.aborted && execution.contextVersion === this.contextVersion;
  }

  // The failure a settled read records, or null to drop it. A read its owner
  // cancelled (release, context change, activation) is dropped; a read whose
  // deadline expired failed, while its scope is still current.
  private recordableFailure<K extends RefreshDomain>(
    domain: K,
    execution: ScopedFetchExecution<K>,
    error: unknown
  ): { error: unknown } | null {
    if (this.fetchCanCommit(execution)) {
      return { error };
    }
    const { reason } = execution.controller.signal;
    const deadlineExpired =
      reason instanceof RefreshDeadlineError &&
      execution.contextVersion === this.contextVersion &&
      this.isScopedDomainEnabledInternal(domain, execution.scope);
    return deadlineExpired ? { error: reason } : null;
  }

  private applyFetchResult<K extends RefreshDomain>(
    domain: K,
    execution: ScopedFetchExecution<K>,
    options: DomainFetchOptions,
    result: {
      snapshot?: Snapshot<DomainPayloadMap[K]>;
      etag?: string;
      notModified?: boolean;
    }
  ): void {
    const { scope } = execution;
    execution.runtime.markReconciled(domain, scope);
    if (result.notModified || !result.snapshot) {
      if (!this.isScopedDomainEnabledInternal(domain, scope)) {
        return;
      }
      execution.runtime.markPermissionAllowed(domain, scope);
      setScopedDomainState(domain, scope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        isManual: isUserIntent(options),
        lastAutoRefresh: isUserIntent(options) ? previous.lastAutoRefresh : Date.now(),
      }));
      this.clearRefreshError(domain, scope);
      return;
    }

    this.applySnapshot(domain, result.snapshot, result.etag, isUserIntent(options), scope);
  }

  private handleFetchFailure<K extends RefreshDomain>(
    domain: K,
    execution: ScopedFetchExecution<K>,
    options: DomainFetchOptions,
    settledError: unknown
  ): void {
    const recordable = this.recordableFailure(domain, execution, settledError);
    if (!recordable) {
      return;
    }

    const { error } = recordable;
    const message = error instanceof Error ? error.message : String(error);
    if (isSnapshotPermissionDenied(error)) {
      // A typed 403 is a settled answer and bypasses startup network-error
      // suppression so automatic retries stop for this scope.
      execution.runtime.markPermissionDenied(domain, execution.scope);
      execution.runtime.markReconciled(domain, execution.scope);
      setScopedDomainState(domain, execution.scope, (previous) => ({
        ...previous,
        status: 'error',
        error: refreshFailureOf(error),
        permissionDenied: true,
        isManual: isUserIntent(options),
      }));
      this.notifyRefreshError(domain, execution.scope, message, error, options.correlationId);
      return;
    }
    execution.runtime.markReconciliationFailed(domain, execution.scope);
    if (this.errorNotifier.shouldSuppressStartupError(error)) {
      setScopedDomainState(domain, execution.scope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : previous.status,
        error: null,
        isManual: isUserIntent(options),
      }));
      return;
    }

    setScopedDomainState(domain, execution.scope, (previous) => ({
      ...previous,
      status: 'error',
      error: refreshFailureOf(error),
      isManual: isUserIntent(options),
    }));
    this.notifyRefreshError(domain, execution.scope, message, error, options.correlationId, {
      intent: options.intent,
      ...(options.coalesce ? { coalesce: true } : {}),
    });
  }

  private finishFetch<K extends RefreshDomain>(
    domain: K,
    execution: ScopedFetchExecution<K>
  ): void {
    const { runtime, scope, requestId, contextVersion } = execution;
    const tracked = runtime.settleInFlight(domain, scope, requestId);
    if (tracked) {
      tracked.cleanup?.();
      if (tracked.trailingStreamSignal && contextVersion === this.contextVersion) {
        void this.performFetch(domain, scope, { intent: 'stream-signal' });
      }
    }
    markPendingRequest(-1);
  }

  private async performFetch<K extends RefreshDomain>(
    domain: K,
    scope: string | undefined,
    options: DomainFetchOptions
  ): Promise<void> {
    const normalizedScope = this.normalizeDomainScope(domain, scope);
    if (!normalizedScope) {
      throw new Error(`Scoped domain "${domain}" requires a valid scope`);
    }
    // A stream-only domain has no snapshot endpoint, and a paused session
    // serves only foreground and user reads (the broker's rule, applied to the
    // orchestrator's own reads and replays too). A held-back signal leaves the
    // scope pending, so the first allowed read after resume reconciles it.
    if (this.getConfig(domain).streaming?.snapshotless) {
      return;
    }
    if (!this.intentRuns(options.intent)) {
      if (isSignalIntent(options)) {
        this.getRuntimeForScope(normalizedScope).markReconciliationPending(domain, normalizedScope);
      }
      return;
    }
    if (!this.canFetchScope(domain, normalizedScope, options)) {
      return;
    }

    const runtime = this.getRuntimeForScope(normalizedScope);
    if (!this.claimFetchSlot(domain, normalizedScope, options, runtime)) {
      if (!options.coalesce) {
        return;
      }
      const current = runtime.getInFlight(domain, normalizedScope);
      await current?.completion;
      // A signal arriving during a read requires its one trailing snapshot.
      // Wait for that read, without following an unbounded chain of later signals.
      await runtime.getInFlight(domain, normalizedScope)?.completion;
      return;
    }

    const previousState = getScopedDomainState(domain, normalizedScope);
    // A permission-denied scope is SETTLED: the backend refused it with a
    // typed 403. A permission or namespace-scope rebuild, or manual refresh
    // below, clears the latch explicitly; see handleClusterScopeChanged. Background
    // retries here caused a request every ~2s
    // (the no-data fetch clause) and flicked the state through 'loading' —
    // observed live as a spinner flashing over the permission message. Manual
    // refresh remains a deliberate re-ask.
    if (!isUserIntent(options) && runtime.isPermissionDenied(domain, normalizedScope)) {
      return;
    }
    const execution = this.beginFetch(
      domain,
      normalizedScope,
      options,
      runtime,
      previousState,
      this.contextVersion
    );
    if (!execution) {
      return;
    }

    await this.executeFetch(domain, execution, options);
  }

  private async executeFetch<K extends RefreshDomain>(
    domain: K,
    execution: ScopedFetchExecution<K>,
    options: DomainFetchOptions
  ): Promise<void> {
    const { scope, previousState } = execution;
    try {
      const result = await fetchSnapshot<DomainPayloadMap[K]>(domain, {
        scope,
        signal: execution.controller.signal,
        ifNoneMatch: previousState.sourceVersion ?? previousState.etag,
        manual: isUserIntent(options) && !isResourceStreamDomain(domain),
        correlationId: options.correlationId,
      });
      if (this.fetchCanCommit(execution)) {
        this.applyFetchResult(domain, execution, options, result);
      }
    } catch (error) {
      this.handleFetchFailure(domain, execution, options, error);
    } finally {
      this.finishFetch(domain, execution);
      execution.complete();
    }
  }

  private applySnapshot<K extends RefreshDomain>(
    domain: K,
    snapshot: Snapshot<DomainPayloadMap[K]>,
    etag: string | undefined,
    isManual: boolean,
    scope?: string
  ): void {
    const tracked = this.getRuntimeForScope(scope).getInFlight(domain, scope);
    if (tracked && tracked.contextVersion !== this.contextVersion) {
      return;
    }
    const payload = mergePollingListPayload(domain, snapshot.payload, scope);
    const resolvedScope = scope ?? snapshot.scope ?? '';

    if (resolvedScope) {
      if (!this.isScopedDomainEnabledInternal(domain, resolvedScope)) {
        return;
      }
      this.getRuntimeForScope(resolvedScope).markPermissionAllowed(domain, resolvedScope);
      setScopedDomainState(domain, resolvedScope, (prev) => ({
        ...prev,
        status: 'ready',
        data: payload,
        stats: snapshot.stats ?? null,
        version: snapshot.version,
        sourceVersion: snapshot.sourceVersion ?? etag ?? prev.sourceVersion,
        sourceVersions: snapshot.sourceVersions ?? prev.sourceVersions,
        checksum: snapshot.checksum,
        etag: etag ?? snapshot.sourceVersion ?? snapshot.checksum ?? prev.etag,
        lastUpdated: Date.now(),
        lastManualRefresh: isManual ? Date.now() : prev.lastManualRefresh,
        lastAutoRefresh: !isManual ? Date.now() : prev.lastAutoRefresh,
        error: null,
        permissionDenied: false,
        isManual,
        scope: resolvedScope,
      }));
      this.clearRefreshError(domain, resolvedScope);
    }
  }

  private metricsDemandClusterIds(): string[] {
    const demanded: string[] = [];
    this.clusterRuntimes.forEach((runtime, clusterId) => {
      if (METRIC_DEMAND_DOMAINS.some((domain) => runtime.hasEnabledScopedSources(domain))) {
        demanded.push(clusterId);
      }
    });
    return demanded.sort(compareUtf16Strings);
  }

  private updateMetricsDemand(): void {
    const clusterIds = this.metricsDemandClusterIds();
    const clusterKey = clusterIds.join('\0');
    if (clusterKey === this.metricsDemandState.appliedKey) {
      this.clearMetricsDemandRetry();
      return;
    }
    if (this.metricsDemandState.status === 'requesting') {
      return;
    }
    if (this.metricsDemandState.status === 'waiting-retry') {
      if (this.metricsDemandState.retryKey === clusterKey) {
        return;
      }
      this.clearMetricsDemandRetry();
    }

    this.metricsDemandState = transitionMetricsDemandState(this.metricsDemandState, {
      type: 'request-started',
      key: clusterKey,
    });
    void setMetricsActive(clusterIds).then(
      () => {
        this.metricsDemandState = transitionMetricsDemandState(this.metricsDemandState, {
          type: 'request-succeeded',
          key: clusterKey,
          initialDelayMs: METRICS_DEMAND_RETRY_INITIAL_MS,
        });
        this.updateMetricsDemand();
      },
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        logWarning(`[refresh] metrics demand update failed: ${message}`);

        const currentKey = this.metricsDemandClusterIds().join('\0');
        if (currentKey !== clusterKey) {
          this.metricsDemandState = transitionMetricsDemandState(this.metricsDemandState, {
            type: 'request-abandoned',
            key: clusterKey,
            initialDelayMs: METRICS_DEMAND_RETRY_INITIAL_MS,
          });
          this.updateMetricsDemand();
          return;
        }

        const delay = this.metricsDemandState.retryDelayMs;
        const retryTimer = setTimeout(() => {
          this.metricsDemandState = transitionMetricsDemandState(this.metricsDemandState, {
            type: 'retry-fired',
            key: clusterKey,
          });
          this.updateMetricsDemand();
        }, delay);
        this.metricsDemandState = transitionMetricsDemandState(this.metricsDemandState, {
          type: 'retry-scheduled',
          key: clusterKey,
          timer: retryTimer,
          maxDelayMs: METRICS_DEMAND_RETRY_MAX_MS,
        });
      }
    );
  }

  private clearMetricsDemandRetry(): void {
    if (this.metricsDemandState.status === 'waiting-retry') {
      clearTimeout(this.metricsDemandState.retryTimer);
      this.metricsDemandState = transitionMetricsDemandState(this.metricsDemandState, {
        type: 'retry-cancelled',
      });
    }
  }

  private isScopedDomainEnabledInternal(domain: RefreshDomain, scope: string): boolean {
    return this.getRuntimeForScope(scope).isScopedDomainEnabled(domain, scope);
  }

  private teardownInFlight(
    runtime: ClusterRefreshRuntime,
    key: string,
    details: { requestId: number }
  ): void {
    runtime.teardownInFlight(key, details);
  }

  private incrementContextVersion(): void {
    this.contextVersion += 1;
  }

  private cancelInFlightForScopedDomain(domain: RefreshDomain, scope: string): void {
    const runtime = this.getRuntimeForScope(scope);
    const key = makeInFlightKey(domain, scope);
    const details = runtime.getInFlight(domain, scope);
    if (details) {
      this.teardownInFlight(runtime, key, details);
    }
  }

  private blockStreamingScope(domain: RefreshDomain, scope: string): boolean {
    if (!this.getRuntimeForScope(scope).blockStreaming(domain, scope)) {
      return false;
    }
    const streaming = this.configs.get(domain)?.streaming;
    if (streaming) {
      this.stopStreamingScope(domain, scope, streaming, false);
    }
    return true;
  }

  private readonly handleResourceStreamPermissionDenied = (
    payload: AppEvents['refresh:resource-stream-permission-denied']
  ): void => {
    const scope = payload.scope.trim();
    if (!scope) {
      return;
    }
    // A settled denial: block the scope's streaming (cleared on scope change
    // or auth recovery) so it does not resync-loop against a 403 forever.
    const domain = payload.domain;
    if (!this.blockStreamingScope(domain, scope)) {
      return;
    }
    logWarning(
      `[refresh] stream permission denied — streaming blocked domain=${domain} scope=${scope} reason=${payload.reason}`,
      { clusterId: parseClusterScope(scope).clusterId }
    );
    // Settle the scope's snapshot state NOW: the fetch gets the same typed
    // 403 instantly and stamps permissionDenied, so anything gated on this
    // scope's initial load (the typed-query tables) resolves immediately
    // instead of waiting out stream teardown timing.
    void this.performFetch(domain, scope, { intent: 'user' }).catch(() => {
      // The stamp lands via the fetch's own error path; nothing to add here.
    });
  };

  private readonly handleResourceStreamDrift = (
    payload: AppEvents['refresh:resource-stream-drift']
  ): void => {
    const scope = payload.scope.trim();
    if (!scope) {
      return;
    }
    // Disable streaming for drifted scopes so snapshots remain the source of truth.
    const domain = payload.domain;
    if (!this.blockStreamingScope(domain, scope)) {
      return;
    }

    logWarning(
      `[refresh] resource stream drift detected domain=${domain} scope=${scope} reason=${payload.reason}`,
      { clusterId: parseClusterScope(scope).clusterId }
    );
  };

  // A doorbell rang for a scope: its snapshot leases refetch it once. Query
  // pages refetch through their own consumers (useQueryStreamSignal).
  private readonly handleStreamSignal = ({
    domain,
    scope,
  }: AppEvents['refresh:stream-signal']): void => {
    const runtime = this.getExistingRuntimeForScope(scope);
    if (
      !runtime ||
      !this.configs.has(domain) ||
      !runtime.hasScopedDemand(domain, scope, 'snapshot')
    ) {
      return;
    }
    void this.fetchScopedDomain(domain, scope, { intent: 'stream-signal' }).catch((error) => {
      logWarning(
        `[refresh] ${domain} signal refetch failed (${scope}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  };

  private readonly handleResourceStreamHealth = (
    payload: AppEvents['refresh:resource-stream-health']
  ): void => {
    const scope = payload.scope.trim();
    if (!scope) {
      return;
    }
    const domain = payload.domain;
    const previous = this.getRuntimeForScope(scope).setStreamHealth(domain, scope, payload);
    if (payload.status === 'healthy' && previous?.status !== 'healthy') {
      setScopedDomainState(domain, scope, (state) => ({
        ...state,
        streamAcknowledgedVersion: (state.streamAcknowledgedVersion ?? 0) + 1,
      }));
    }
  };

  private readonly handleClusterAuthFailed = (payload: { clusterId: string }) => {
    const clusterId = payload.clusterId.trim();
    if (!clusterId) {
      return;
    }
    const runtime = this.getClusterRuntime(clusterId);
    if (!runtime.markAuthFailed()) {
      return;
    }
    logInfo('[refresh] pausing cluster — auth failed', { clusterId });

    this.stopRuntimeStreaming(runtime, false);
    runtime.forEachInFlight((details, key) => {
      this.teardownInFlight(runtime, key, details);
    });
    // Clear async streaming bookkeeping so stale entries from in-progress
    // connections don't block restart when auth recovers.
    runtime.clearAsyncStreamingBookkeeping();
  };

  private readonly handleClusterAuthRecovered = (payload: { clusterId: string }) => {
    const clusterId = payload.clusterId.trim();
    if (!clusterId) {
      return;
    }
    const runtime = this.clusterRuntimes.get(clusterId);
    if (!runtime?.markAuthRecovered()) {
      return;
    }

    logInfo('[refresh] resuming cluster — auth recovered', { clusterId });
    runtime.clearBlockedStreaming();
    runtime.clearAllStreamHealth();
    this.resetRuntimePermissionEpoch(runtime);
    runtime.forEachScopedDomain((domain, scope) => {
      this.errorNotifier.clear(domain, scope);
    });
    // Re-evaluate enabled scopes. The affected cluster remains behind its
    // lifecycle serviceability gate until the backend rebuild is ready.
    this.handleStreamingScopeChanges();
  };

  private readonly handleClusterScopeChanged = (payload: { clusterId: string }) => {
    const clusterId = payload.clusterId.trim();
    if (!clusterId) {
      return;
    }
    const runtime = this.clusterRuntimes.get(clusterId);
    resetPermissionDeniedScopedDomainStates(clusterId);
    if (!runtime) {
      return;
    }
    logInfo('[refresh] access changed — restarting cluster streams', { clusterId });
    this.stopRuntimeStreaming(runtime, false);
    runtime.forEachInFlight((details, key) => this.teardownInFlight(runtime, key, details));
    runtime.clearAsyncStreamingBookkeeping();
    runtime.clearBlockedStreaming();
    runtime.clearAllStreamHealth();
    this.resetRuntimePermissionEpoch(runtime);
    runtime.forEachScopedDomain((domain, scope) => {
      this.errorNotifier.clear(domain, scope);
      runtime.markReconciliationFailed(domain, scope);
    });
    this.handleStreamingScopeChanges([runtime]);
  };

  private readonly handleResetViews = () => {
    this.incrementContextVersion();
    this.stopAllStreaming(true);
    this.abortAllInFlight();
    this.clearAllBlockedStreaming();
    this.clearAllStreamHealth();
    this.configs.forEach((_, domain) => {
      this.resetDomain(domain);
    });
  };

  private readonly handleKubeconfigChanging = () => {
    // A kubeconfig change supersedes tracked auth-failure state and the
    // errors already reported.
    this.forEachRuntime((runtime) => runtime.markAuthRecovered());
    this.errorNotifier.clearAll();
    this.incrementContextVersion();
    this.stopAllStreaming(true);
    this.forEachRuntime((runtime) => this.cancelRuntimePolls(runtime));
    this.abortAllInFlight();
    this.clearAllBlockedStreaming();
    this.clearAllStreamHealth();
    this.configs.forEach((_config, domain) => {
      this.disableDomain(domain);
      this.resetDomain(domain);

      this.deleteDomainFromAllRuntimes(domain);
    });
  };

  // Re-evaluates every leased stream scope after an edge that can change
  // whether it may stream: readiness, auth, permissions, pause, or a block.
  private handleStreamingScopeChanges(runtimes = this.getAllRuntimes()): void {
    this.configs.forEach((config, domain) => {
      const streaming = config.streaming;
      if (!streaming) {
        return;
      }

      runtimes.forEach((runtime) => {
        runtime.forEachEnabledScope(domain, (scope) => {
          this.reconcileScopeStream(domain, scope, streaming);
        });
      });
    });
  }

  private reconcileScopeStream(
    domain: RefreshDomain,
    scope: string,
    streaming: StreamingRegistration
  ): void {
    const runtime = this.getRuntimeForScope(scope);
    const alreadyStreaming = runtime.isStreamingStartingOrActive(domain, scope);
    if (this.shouldStreamScope(domain, scope)) {
      if (!alreadyStreaming) {
        this.scheduleStreamingStart(domain, scope, streaming);
      }
      return;
    }
    if (alreadyStreaming) {
      runtime.clearStreamingReady(domain, scope);
      this.stopStreamingScope(domain, scope, streaming, false);
      return;
    }
    this.clearTimer(runtime.resetStreamStartRetry(domain, scope));
  }

  private readonly handleKubeconfigChanged = () => {
    this.incrementContextVersion();
    this.errorNotifier.suppressNetworkErrors(6000);
    this.clearAllBlockedStreaming();
    this.clearAllStreamHealth();
    this.handleStreamingScopeChanges();
  };

  private readonly handleKubeconfigSelectionChanged = () => {
    // The service route is stable while the backend atomically replaces its handler.
    this.incrementContextVersion();
    this.errorNotifier.suppressNetworkErrors(6000);
    this.clearAllBlockedStreaming();
    this.clearAllStreamHealth();
    this.handleStreamingScopeChanges();
  };

  private readonly handleAutoRefreshChanged = () => {
    this.handleStreamingScopeChanges();
    this.reschedulePolls();
  };

  private readonly handleDocumentHidden = () => {
    this.setDocumentHidden(true);
  };

  private readonly handleDocumentVisible = () => {
    this.setDocumentHidden(false);
  };

  // A hidden document pauses polls; its stream managers suspend themselves.
  // Window roots republish the current state when they mount, so an unchanged
  // state must not re-arm, and so delay, every pending poll.
  private setDocumentHidden(hidden: boolean): void {
    if (this.documentHidden === hidden) {
      return;
    }
    this.documentHidden = hidden;
    this.reschedulePolls();
  }
}

export const refreshOrchestrator = new RefreshOrchestrator();
registerDefaultRefreshDomains(refreshOrchestrator);
