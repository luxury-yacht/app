/**
 * frontend/src/core/refresh/orchestrator.ts
 *
 * Module source for orchestrator.
 * Implements orchestrator logic for the core layer.
 */

import { type AppEvents, eventBus } from '@/core/events';
import {
  APP_LOG_SOURCES,
  type AppLogsClusterMeta,
  logAppLogsInfo,
  logAppLogsWarn,
} from '@/core/logging/appLogsClient';
import { getAutoRefreshEnabled } from '@/core/settings/appPreferences';
import { compareUtf16Strings } from '@/shared/utils/sort';
import { reportOperationalError } from '@/utils/errorHandler';
import {
  fetchSnapshot,
  isSnapshotPermissionDenied,
  type Snapshot,
  setMetricsActive,
} from './client';
import { clusterReadiness } from './clusterReadiness';
import { buildClusterScope, parseClusterScope, parseClusterScopeList } from './clusterScope';
import { registerDefaultRefreshDomains } from './domainRegistrations';
import { METRIC_DEMAND_DOMAINS } from './domainRegistry';
import {
  initialMetricsDemandState,
  type MetricsDemandState,
  transitionMetricsDemandState,
} from './metricsDemandState';
import { type RefreshContext, refreshManager } from './RefreshManager';
import { RefreshErrorNotifier } from './refreshErrorNotifier';
import { type RefresherTiming, refresherConfig } from './refresherConfig';
import type { RefresherName, StaticRefresherName } from './refresherTypes';
import type { DomainRegistration, StreamingRegistration } from './refreshRegistration';
import {
  ClusterRefreshRuntime,
  type InFlightRequest,
  makeInFlightKey,
  type RefreshDemand,
} from './refreshRuntime';
import { isResourceStreamDomain, isResourceStreamViewActive } from './resourceStreamViews';
import {
  normalizeNamespaceScope as normalizeNamespaceScopeValue,
  normalizeRefreshDomainScope,
} from './scopeNormalization';
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
} from './streaming/resourceStreamDomains';
import { resourceStreamManager } from './streaming/resourceStreamManager';
import type { DomainPayloadMap, RefreshDomain } from './types';

type DomainFetchOptions = {
  isManual: boolean;
  correlationId?: string;
  signal?: AbortSignal;
  allowDisabledRetainedScope?: boolean;
  // Scheduler-owned reconciliation. Query-only leases turn this into a
  // current-page invalidation instead of fetching an unused base snapshot.
  queryReconcile?: boolean;
  // The fetch was triggered by a stream doorbell; it bypasses the
  // skip-while-stream-healthy gate (the signal IS the stream's refresh).
  streamSignal?: boolean;
};

type ScopedFetchExecution<K extends RefreshDomain> = {
  runtime: ClusterRefreshRuntime;
  scope: string;
  previousState: DomainSnapshotState<DomainPayloadMap[K]>;
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
  wasActive: boolean;
  changed: boolean;
  staleScopes: string[];
};

// Refreshers are disabled at registration by default. Most domains rely on
// view hooks (e.g. ClusterResourcesContext, useBrowseCatalog) to enable
// scopes on demand rather than polling from app startup. Changing this to
// true would cause all streaming domains to start polling immediately at
// registration, regardless of whether the user is on the relevant view.
// Set autoStart: true on individual domain registrations when needed.
const DEFAULT_AUTO_START = false;
const noopStreamingCleanup = () => undefined;
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
  private readonly unsubscriptions = new Map<RefreshDomain, () => void>();
  private readonly registeredRefreshers = new Set<RefresherName>();
  private readonly coordinatorRuntime = new ClusterRefreshRuntime('__coordinator__');
  private readonly clusterRuntimes = new Map<string, ClusterRefreshRuntime>();
  private requestCounter = 0;
  private metricsDemandState: MetricsDemandState = initialMetricsDemandState(
    METRICS_DEMAND_RETRY_INITIAL_MS
  );

  private readonly suspendedDomains = new Map<RefreshDomain, boolean>();
  private contextVersion = 0;
  private context: RefreshContext = {
    currentView: 'namespace',
    objectPanel: { isOpen: false },
  };
  private readonly errorNotifier = new RefreshErrorNotifier();

  constructor() {
    eventBus.on('view:reset', this.handleResetViews);
    eventBus.on('kubeconfig:changing', this.handleKubeconfigChanging);
    eventBus.on('kubeconfig:changed', this.handleKubeconfigChanged);
    eventBus.on('kubeconfig:selection-changed', this.handleKubeconfigSelectionChanged);
    eventBus.on('settings:auto-refresh', this.handleAutoRefreshChanged);
    eventBus.on('refresh:resource-stream-drift', this.handleResourceStreamDrift);
    eventBus.on(
      'refresh:resource-stream-permission-denied',
      this.handleResourceStreamPermissionDenied
    );
    eventBus.on('refresh:resource-stream-health', this.handleResourceStreamHealth);
    eventBus.on('cluster:auth:failed', this.handleClusterAuthFailed);
    eventBus.on('cluster:auth:recovered', this.handleClusterAuthRecovered);
    eventBus.on('cluster:scope-changed', this.handleClusterScopeChanged);
    clusterReadiness.onBecameServiceable((clusterId) =>
      this.handleClusterBecameServiceable(clusterId)
    );
    clusterReadiness.onForegroundActivationStarted((clusterId) =>
      this.handleForegroundActivationStarted(clusterId)
    );
    // Emit a single log so operators can confirm streaming config at runtime.
    logInfo('[refresh] resource streaming enabled (mode=active, domains=all)');
  }

  /** Every requested cluster's backend subsystem can serve (or is unknown). */
  private isScopeClusterServiceable(scope: string): boolean {
    return parseClusterScopeList(scope).clusterIds.every((clusterId) =>
      Boolean(
        (this.clusterRuntimes.get(clusterId)?.isAuthAvailable() ?? true) &&
          clusterReadiness.isServiceable(clusterId)
      )
    );
  }

  /** Hold a fetch for re-dispatch when the scope's cluster(s) become serviceable. */
  private recordPendingClusterReadiness(
    domain: RefreshDomain,
    scope: string,
    options?: Pick<DomainFetchOptions, 'isManual' | 'streamSignal' | 'queryReconcile'>
  ): void {
    for (const clusterId of parseClusterScopeList(scope).clusterIds) {
      this.getClusterRuntime(clusterId).deferUntilClusterReady({
        domain,
        scope,
        isManual: Boolean(options?.isManual),
        streamSignal: Boolean(options?.streamSignal),
        queryReconcile: Boolean(options?.queryReconcile),
      });
    }
  }

  private handleForegroundActivationStarted(clusterId: string): void {
    const runtime = this.clusterRuntimes.get(clusterId);
    if (!runtime) {
      return;
    }
    this.stopRuntimeStreaming(runtime, false);
    runtime.forEachInFlight((details, key) => {
      if (details.scope && this.isScopedDomainEnabledInternal(details.domain, details.scope)) {
        this.recordPendingClusterReadiness(details.domain, details.scope, {
          isManual: details.isManual,
          streamSignal: Boolean(details.streamSignal || details.trailingStreamSignal),
        });
      }
      this.teardownInFlight(runtime, key, details);
    });
  }

  private handleClusterBecameServiceable(clusterId: string): void {
    const pending = this.clusterRuntimes.get(clusterId)?.takeDeferredReadinessRequests() ?? [];
    if (pending.length > 0) {
      for (const request of pending) {
        const { domain, scope } = request;
        if (!this.configs.has(domain)) {
          continue;
        }
        // The lease may have been released (view left, cluster pruned) while
        // the cluster was warming up — held work dies with its demand.
        if (!this.isScopedDomainEnabledInternal(domain, scope)) {
          continue;
        }
        if (!this.isScopeClusterServiceable(scope)) {
          // A multi-cluster scope with another cluster still warming.
          this.recordPendingClusterReadiness(domain, scope, request);
          continue;
        }
        void this.fetchScopedDomain(domain, scope, {
          isManual: request.isManual,
          streamSignal: request.streamSignal,
          queryReconcile: request.queryReconcile,
        }).catch((error) => {
          logWarning(
            `[refresh] deferred ${domain} fetch after cluster ${clusterId} became serviceable failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
      }
    }
    // Snapshotless streams have no queued fetch to wake them. Re-evaluate all
    // retained streaming leases whenever the activation hold is released.
    this.handleStreamingScopeChanges();
  }

  private notifyRefreshError(
    domain: RefreshDomain,
    scope: string | undefined,
    message: string,
    error?: unknown,
    operationId?: string
  ): void {
    if (message.includes('no active clusters available')) {
      // The cluster's backend subsystem is still initializing (its lifecycle
      // state was unknown when the fetch dispatched). Warm-up, not failure:
      // hold the scope for re-dispatch on readiness and skip the toast.
      if (scope) {
        this.recordPendingClusterReadiness(domain, scope);
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
    const allowRefresher = this.shouldAllowRefresher(config);
    const existing = this.configs.get(config.domain);
    if (existing) {
      const unsubscribe = this.unsubscriptions.get(config.domain);
      unsubscribe?.();
      this.unsubscriptions.delete(config.domain);
    }

    this.configs.set(config.domain, config);

    if (allowRefresher) {
      this.ensureRefresher(config);

      const unsubscribe = refreshManager.subscribe(
        config.refresherName,
        async (isManual, signal) => {
          await this.refreshEnabledScopes(config.domain, {
            isManual,
            signal,
            queryReconcile: true,
          });
        }
      );

      this.unsubscriptions.set(config.domain, unsubscribe);

      if (!DEFAULT_AUTO_START) {
        refreshManager.disable(config.refresherName);
      }
    }
  }

  updateContext(context: Partial<RefreshContext>): void {
    const previousContext = this.context;
    this.context = { ...this.context, ...context };
    refreshManager.updateContext(context);

    if (Object.getOwnPropertyDescriptor(context, 'allConnectedClusterIds') !== undefined) {
      this.pruneRemovedClusterRuntimes(context.allConnectedClusterIds ?? []);
    }

    const wasNamespaceActive = this.isNamespaceContextActive(previousContext);
    const isNamespaceActive = this.isNamespaceContextActive(this.context);

    if (wasNamespaceActive && !isNamespaceActive) {
      this.disableNamespaceDomains();
    }

    this.handleStreamingScopeChanges();
  }

  async triggerManualRefreshForContext(context?: Partial<RefreshContext>): Promise<void> {
    const targetContext: RefreshContext = context ? { ...this.context, ...context } : this.context;
    const tasks: Promise<void>[] = [refreshManager.triggerManualRefreshForContext(targetContext)];

    // Refresh namespaces across all enabled scopes.
    tasks.push(this.refreshEnabledScopes('namespaces', { isManual: true }));

    const podsRefresh = this.triggerActiveWorkloadsPodsRefresh(targetContext);
    if (podsRefresh) {
      tasks.push(podsRefresh);
    }

    await Promise.all(tasks);
  }

  setDomainEnabled(domain: RefreshDomain, enabled: boolean): void {
    // All domains are scoped — delegate to each known scope.
    const scopes = this.getKnownScopes(domain);
    scopes.forEach((scope) => {
      this.setScopedDomainEnabled(domain, scope, enabled);
    });
    if (scopes.length === 0) {
      this.coordinatorRuntime.markDomainKnown(domain);
    }
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

    const runtime = this.getRuntimeForScope(domain, normalizedScope);
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
        if (!this.isScopedDomainEnabledInternal(domain, normalizedScope)) {
          return;
        }
        this.startStreamingScope(domain, normalizedScope, streaming);
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : 'Failed to initialise refresh subsystem';
        setScopedDomainState(domain, normalizedScope, (previous) => ({
          ...previous,
          status: 'error',
          error: message,
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

  private hasEnabledScopedSources(domain: RefreshDomain): boolean {
    for (const runtime of this.getAllRuntimes()) {
      if (runtime.hasEnabledScopedSources(domain)) {
        return true;
      }
    }
    return false;
  }

  private getEnabledScopes(domain: RefreshDomain): string[] {
    return this.getAllRuntimes().flatMap((runtime) => runtime.getEnabledScopes(domain));
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

  private async refreshEnabledScopes(
    domain: RefreshDomain,
    options: DomainFetchOptions
  ): Promise<void> {
    const scopes = this.getEnabledScopes(domain);
    if (scopes.length === 0) {
      return;
    }

    await Promise.all(scopes.map((scope) => this.fetchScopedDomain(domain, scope, options)));
  }

  resetDomain(domain: RefreshDomain): void {
    resetAllScopedDomainStates(domain);
  }

  private clearStaleScopes(
    domain: RefreshDomain,
    staleScopes: string[],
    streaming?: StreamingRegistration
  ): void {
    staleScopes.forEach((staleScope) => {
      this.cancelInFlightForScopedDomain(domain, staleScope);
      if (streaming) {
        this.getRuntimeForScope(domain, staleScope).clearStreamingReady(domain, staleScope);
        this.stopStreamingScope(domain, staleScope, streaming, true);
        return;
      }
      resetScopedDomainState(domain, staleScope);
    });
  }

  private reconcileRefresherActivity(
    config: DomainRegistration<RefreshDomain>,
    wasActive: boolean,
    isActive: boolean
  ): void {
    if (!this.shouldAllowRefresher(config) || wasActive === isActive) {
      return;
    }
    if (isActive) {
      refreshManager.enable(config.refresherName);
      return;
    }
    refreshManager.disable(config.refresherName);
  }

  private reconcileStreamingScopeEnabled(
    domain: RefreshDomain,
    scope: string,
    enabled: boolean,
    preserveState: boolean,
    runtime: ClusterRefreshRuntime,
    streaming: StreamingRegistration
  ): void {
    const shouldStream = this.shouldStreamScope(domain, scope);
    if (enabled && shouldStream) {
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
    if (runtime.hasStreamingBookkeeping(domain, scope)) {
      runtime.clearStreamingReady(domain, scope);
      this.stopStreamingScope(domain, scope, streaming, false);
    }
  }

  private reconcileScopedDomainStateChange(change: ScopedDomainStateChange): void {
    const {
      config,
      domain,
      scope,
      enabled,
      preserveState,
      runtime,
      wasActive,
      changed,
      staleScopes,
    } = change;
    this.clearStaleScopes(domain, staleScopes, config.streaming);
    if (!changed) {
      this.updateMetricsDemand();
      return;
    }

    this.reconcileRefresherActivity(config, wasActive, this.hasEnabledScopedSources(domain));

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

  setScopedDomainEnabled(
    domain: RefreshDomain,
    scope: string,
    enabled: boolean,
    options?: { preserveState?: boolean }
  ): void {
    const config = this.getConfig(domain);
    const normalizedScope = this.normalizeDomainScope(domain, scope);
    if (!normalizedScope) {
      throw new Error(`Scoped domain "${domain}" requires a non-empty scope value`);
    }

    const runtime = this.getRuntimeForScope(domain, normalizedScope);

    // A mounted lifecycle consumer holds a lease on this scope. Ignore direct
    // disables so an unrelated consumer (or an old instance mid-remount) cannot
    // tear down a scope a newer/active lease owner still needs. The lease
    // release path decrements to zero before calling here, so the final
    // disable is not suppressed.
    if (!enabled && runtime.hasScopedLease(domain, normalizedScope)) {
      this.updateMetricsDemand();
      return;
    }

    const wasActive = this.hasEnabledScopedSources(domain);
    const { changed, staleScopes } = runtime.applyScopedDomainEnabled(
      domain,
      normalizedScope,
      enabled
    );
    // When preserveState is true, toggling the domain stops/restarts activity
    // without clearing the last scoped snapshot from the store. This is useful
    // for event streams where reconnects should not blank the visible table.
    const preserveState = Boolean(options?.preserveState);
    this.reconcileScopedDomainStateChange({
      config,
      domain,
      scope: normalizedScope,
      enabled,
      preserveState,
      runtime,
      wasActive,
      changed,
      staleScopes,
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
    const runtime = this.getRuntimeForScope(domain, normalizedScope);
    const demand = options?.demand ?? 'snapshot';
    const hadSnapshotDemand = runtime.hasScopedDemand(domain, normalizedScope, 'snapshot');
    const wasActive = this.hasEnabledScopedSources(domain);
    const { firstLease, activationChanged } = runtime.acquireScopedLease(
      domain,
      normalizedScope,
      demand
    );
    if (firstLease) {
      const config = this.getConfig(domain);
      const { staleScopes } = runtime.applyScopedDomainEnabled(domain, normalizedScope, true);
      this.reconcileScopedDomainStateChange({
        config,
        domain,
        scope: normalizedScope,
        enabled: true,
        preserveState: Boolean(options?.preserveState),
        runtime,
        wasActive,
        changed: activationChanged,
        staleScopes,
      });
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
    const runtime = this.getRuntimeForScope(domain, normalizedScope);
    const { lastLease } = runtime.releaseScopedLease(
      domain,
      normalizedScope,
      options?.demand ?? 'snapshot'
    );
    if (lastLease) {
      this.setScopedDomainEnabled(domain, normalizedScope, false, options);
    }
  }

  resetScopedDomain(domain: RefreshDomain, scope: string): void {
    const normalizedScope = this.normalizeDomainScope(domain, scope);
    if (!normalizedScope) {
      return;
    }
    resetScopedDomainState(domain, normalizedScope);
  }

  startStreamingDomain(domain: RefreshDomain, scope: string): void {
    const config = this.getConfig(domain);
    if (!config.streaming) {
      throw new Error(`Domain "${domain}" is not registered as streaming`);
    }
    const normalizedScope = this.normalizeDomainScope(domain, scope);
    if (!normalizedScope) {
      throw new Error(`Streaming domain "${domain}" requires a non-empty scope value`);
    }
    this.startStreamingScope(domain, normalizedScope, config.streaming);
  }

  stopStreamingDomain(
    domain: RefreshDomain,
    scope: string,
    options: { reset?: boolean } = {}
  ): void {
    const config = this.getConfig(domain);
    if (!config.streaming) {
      throw new Error(`Domain "${domain}" is not registered as streaming`);
    }
    const normalizedScope = this.normalizeDomainScope(domain, scope);
    if (!normalizedScope) {
      throw new Error(`Streaming domain "${domain}" requires a non-empty scope value`);
    }
    this.stopStreamingScope(domain, normalizedScope, config.streaming, options.reset ?? false);
  }

  async refreshStreamingDomainOnce(domain: RefreshDomain, scope: string): Promise<void> {
    const config = this.getConfig(domain);
    if (!config.streaming) {
      throw new Error(`Domain "${domain}" is not registered as streaming`);
    }
    if (!config.streaming.refreshOnce) {
      await this.restartStreamingDomain(domain, scope);
      return;
    }
    const normalizedScope = this.normalizeDomainScope(domain, scope);
    if (!normalizedScope) {
      throw new Error(`Streaming domain "${domain}" requires a non-empty scope value`);
    }
    await config.streaming.refreshOnce(normalizedScope);
  }

  async restartStreamingDomain(domain: RefreshDomain, scope: string): Promise<void> {
    const config = this.getConfig(domain);
    if (!config.streaming) {
      throw new Error(`Domain "${domain}" is not registered as streaming`);
    }
    const normalizedScope = this.normalizeDomainScope(domain, scope);
    if (!normalizedScope) {
      throw new Error(`Streaming domain "${domain}" requires a non-empty scope value`);
    }
    this.stopStreamingScope(domain, normalizedScope, config.streaming, false);
    await this.startStreamingScope(domain, normalizedScope, config.streaming);
  }

  getSelectedNamespace(): string | undefined {
    return this.normalizeNamespaceScope(this.context.selectedNamespace) ?? undefined;
  }

  getSelectedClusterId(): string | undefined {
    // Keep the active tab's cluster ID available for per-tab refresh scopes.
    const selected = (this.context.selectedClusterId ?? '').trim();
    return selected || undefined;
  }

  // Return all cluster IDs from the current refresh context (foreground selection).
  getClusterIds(): string[] {
    return this.getSelectedClusterIds();
  }

  // Return all connected cluster IDs (includes background clusters when background refresh is on).
  getAllConnectedClusterIds(): string[] {
    const all = (this.context.allConnectedClusterIds ?? [])
      .map((id) => (id ?? '').trim())
      .filter(Boolean);
    return all.length > 0 ? all : this.getSelectedClusterIds();
  }

  // Fetch a single domain's snapshot for a specific cluster (background refresh, no streaming).
  async fetchDomainForCluster(
    domain: RefreshDomain,
    clusterId: string,
    scope?: string
  ): Promise<void> {
    const config = this.configs.get(domain);
    if (!config) {
      return;
    }
    // Route background work through the target cluster runtime, then perform a direct snapshot fetch.
    this.getClusterRuntime(clusterId);
    const clusterScope = buildClusterScope(clusterId, scope ?? '');
    await this.performFetch(domain, clusterScope, {
      isManual: false,
      allowDisabledRetainedScope: true,
    });
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
    return this.getRuntimeForScope(domain, scope).isStreamingBlocked(domain, scope);
  }

  private isStreamingActive(domain: RefreshDomain, scope: string): boolean {
    return this.getRuntimeForScope(domain, scope).isStreamingActive(domain, scope);
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
    const trimmed = scope?.trim() ?? '';
    if (!trimmed) {
      return false;
    }
    if (!getAutoRefreshEnabled()) {
      return false;
    }
    // One-shot typed-query scopes (`?` params) are never streaming targets, for
    // ANY domain: event queries share the singleton named stream
    // with the parameterless base scope and would churn it on every query.
    if (trimmed.includes('?')) {
      return false;
    }
    // No stream can be established while the scope's cluster backend is still
    // initializing — the named-stream handler rejects the request and the
    // client would otherwise hot-loop on reconnect attempts.
    if (!this.isScopeClusterServiceable(trimmed)) {
      return false;
    }
    if (!isResourceStreamDomain(domain)) {
      return true;
    }
    if (!isResourceStreamViewActive(domain, this.context, trimmed)) {
      return false;
    }
    const parsed = parseClusterScopeList(trimmed);
    if (parsed.clusterIds.length === 0) {
      return false;
    }
    if (parsed.isMultiCluster) {
      return false;
    }
    if (this.isStreamingBlocked(domain, trimmed)) {
      return false;
    }
    return true;
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
    runtime.getStreamingLifecycleKeys().forEach((key) => {
      const [domainPart, scopePart] = key.split('::');
      const domain = domainPart as RefreshDomain;
      const scope = scopePart === '*' ? '' : scopePart;
      if (!scope) {
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
    const runtime = this.getRuntimeForScope(domain, scope);
    if (runtime.isStreamingStartingOrActive(domain, scope)) {
      return Promise.resolve();
    }

    const startResult = streaming.start(scope);
    const startPromise = Promise.resolve(startResult);
    runtime.beginStreamingStart(domain, scope, startPromise);

    startPromise
      .then((cleanup) =>
        this.completeStreamingStart(domain, scope, streaming, runtime, startPromise, cleanup)
      )
      .catch((error) => this.failStreamingStart(domain, scope, runtime, startPromise, error));

    return startPromise.then(() => undefined).catch(() => undefined);
  }

  private completeStreamingStart(
    domain: RefreshDomain,
    scope: string,
    streaming: StreamingRegistration,
    runtime: ClusterRefreshRuntime,
    startPromise: Promise<(() => void) | undefined>,
    cleanup: (() => void) | undefined
  ): void {
    const enabledNow = this.isScopedDomainEnabledInternal(domain, scope);
    if (!enabledNow || runtime.isStreamingCancelled(domain, scope)) {
      runtime.failStreamingStart(domain, scope, startPromise);
      runtime.clearStreamingCancelled(domain, scope);
      this.runStreamingCleanup(cleanup, domain, scope);
      if (enabledNow) {
        // A re-enable can race the cancelled start. Restart here because the
        // re-enable observed this pending promise and could not start its own.
        this.startStreamingScope(domain, scope, streaming);
      }
      return;
    }

    if (
      !runtime.finishStreamingStart(domain, scope, startPromise, cleanup ?? noopStreamingCleanup)
    ) {
      this.runStreamingCleanup(cleanup, domain, scope);
      return;
    }
    // A newly subscribed notify-only stream needs one bounded snapshot so a
    // quiet or permission-denied scope can settle without waiting for polling.
    this.reconcileInitialStreamingSnapshot(domain, scope, streaming);
  }

  private runStreamingCleanup(
    cleanup: (() => void) | undefined,
    domain: RefreshDomain,
    scope: string
  ): void {
    if (typeof cleanup !== 'function') {
      return;
    }
    try {
      cleanup();
    } catch (error) {
      reportOperationalError(error, {
        source: 'RefreshOrchestrator',
        action: 'cleanupStreamingDomain',
        domain,
        scope,
      });
    }
  }

  private failStreamingStart(
    domain: RefreshDomain,
    scope: string,
    runtime: ClusterRefreshRuntime,
    startPromise: Promise<(() => void) | undefined>,
    error: unknown
  ): void {
    runtime.failStreamingStart(domain, scope, startPromise);
    const message = error instanceof Error ? error.message : String(error);
    setScopedDomainState(domain, scope, (previous) => ({
      ...previous,
      status: 'error',
      error: message,
      scope,
    }));
    const notificationScope = scope.trim() || undefined;
    this.notifyRefreshError(domain, notificationScope, message, error);
  }

  private reconcileInitialStreamingSnapshot(
    domain: RefreshDomain,
    scope: string,
    streaming: StreamingRegistration
  ): void {
    const runtime = this.getRuntimeForScope(domain, scope);
    const leaseAllowsSnapshot =
      !runtime.hasScopedLease(domain, scope) || runtime.hasScopedDemand(domain, scope, 'snapshot');
    if (
      !leaseAllowsSnapshot ||
      streaming.snapshotless ||
      getScopedDomainState(domain, scope).data
    ) {
      return;
    }
    void this.performFetch(domain, scope, {
      isManual: false,
      streamSignal: true,
    }).catch(() => {
      // Failures land in the scoped state via performFetch's own path.
    });
  }

  private stopStreamingScope(
    domain: RefreshDomain,
    scope: string,
    streaming: StreamingRegistration,
    reset: boolean
  ): void {
    const runtime = this.getRuntimeForScope(domain, scope);
    const pending = runtime.cancelStreamingStart(domain, scope);

    if (pending) {
      pending
        .then((streamingCleanup) => {
          // LOAD-BEARING — docs/architecture/refresh-system.md, "Streaming
          // Start Lifecycle": teardown has exactly one owner. The start's
          // own continuation (attached first) already handled a cancelled
          // arrival — teardown, or an adopted restart when the scope was
          // re-enabled — and cleared the cancel flag. Acting here
          // too would release the manager subscription twice. The flag still
          // being set means this stop still owns the teardown.
          if (!runtime.isStreamingCancelled(domain, scope)) {
            return;
          }
          runtime.failStreamingStart(domain, scope, pending);
          runtime.clearStreamingCancelled(domain, scope);
          if (typeof streamingCleanup === 'function') {
            try {
              streamingCleanup();
            } catch (error) {
              reportOperationalError(error, {
                source: 'RefreshOrchestrator',
                action: 'stopPendingStreamingDomain',
                domain,
                scope,
              });
            }
          }
        })
        .catch(() => {
          runtime.failStreamingStart(domain, scope, pending);
          runtime.clearStreamingCancelled(domain, scope);
        });
    }

    const cleanup = runtime.getStreamingCleanup(domain, scope);
    if (cleanup) {
      try {
        cleanup();
      } catch (error) {
        reportOperationalError(error, {
          source: 'RefreshOrchestrator',
          action: 'stopStreamingDomain',
          domain,
          scope,
        });
      }
      runtime.deleteStreamingCleanup(domain, scope);
    }
    runtime.clearStreamHealth(domain, scope);
    streaming.stop?.(scope, { reset });
    if (reset) {
      resetScopedDomainState(domain, scope);
    }
  }

  private isNamespaceContextActive(context: RefreshContext = this.context): boolean {
    return context.currentView === 'namespace' && Boolean(context.selectedNamespace);
  }

  private disableNamespaceDomains(): void {
    this.configs.forEach((config, domain) => {
      if (config.category !== 'namespace') {
        return;
      }

      if (this.hasEnabledScopedSources(domain)) {
        this.setDomainEnabled(domain, false);
      } else {
        refreshManager.disable(config.refresherName);
      }

      // All domains are scoped — reset via the scoped store.
      this.resetDomain(domain);
    });
  }

  private triggerActiveWorkloadsPodsRefresh(context: RefreshContext): Promise<void> | null {
    if (context.currentView !== 'namespace' || context.activeNamespaceView !== 'workloads') {
      return null;
    }

    const scope = this.normalizeNamespaceScope(context.selectedNamespace);
    if (!scope) {
      return null;
    }

    if (!this.isScopedDomainEnabledInternal('pods', scope)) {
      return null;
    }

    return this.fetchScopedDomain('pods', scope, { isManual: true });
  }

  private normalizeDomainScope(
    domain: RefreshDomain,
    value?: string | null,
    allowEmpty = false
  ): string | undefined {
    return normalizeRefreshDomainScope({
      domain,
      value,
      selectedClusterId: this.getSelectedClusterId(),
      allowEmpty,
    });
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

  private getRuntimeForScope(domain: RefreshDomain, scope?: string): ClusterRefreshRuntime {
    if (!scope) {
      return this.coordinatorRuntime;
    }
    const parsed = parseClusterScopeList(scope);
    if (parsed.isMultiCluster) {
      throw new Error(`Refresh domain "${domain}" requires a single cluster scope`);
    }
    if (!parsed.isMultiCluster && parsed.clusterIds.length === 1) {
      return this.getClusterRuntime(parsed.clusterIds[0]);
    }
    return this.coordinatorRuntime;
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

  private resetAllRuntimePermissionEpochs(): void {
    this.forEachRuntime((runtime) => this.resetRuntimePermissionEpoch(runtime));
  }

  private pruneRemovedClusterRuntimes(connectedClusterIds: string[]): void {
    const connected = new Set(
      connectedClusterIds.map((clusterId) => clusterId.trim()).filter(Boolean)
    );

    // Reset the global scoped-domain state of every removed cluster up front. This sweeps the
    // store directly (the diagnostics source of truth) rather than each runtime's enabled-scope
    // set, so snapshot/stream scopes that carry retained data but no polling lease — e.g.
    // cluster-events, polling disabled — are cleaned up too. forEachScopedDomain only sees
    // enabled leases, so it would leave those orphaned for a closed cluster.
    this.resetScopedStatesForRemovedClusters(connected);
    Array.from(this.clusterRuntimes.entries()).forEach(([clusterId, runtime]) => {
      if (connected.has(clusterId)) {
        return;
      }

      this.stopRuntimeStreaming(runtime, true);
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
  // whose cluster ids are all absent from the connected set. A scope with no cluster id
  // belongs to the coordinator runtime (not a cluster) and is left untouched.
  private resetScopedStatesForRemovedClusters(connected: Set<string>): void {
    const { scopedDomainEntries } = getRefreshState();
    (Object.keys(scopedDomainEntries) as RefreshDomain[]).forEach((domain) => {
      (scopedDomainEntries[domain] ?? []).forEach(([scope]) => {
        const { clusterIds } = parseClusterScopeList(scope);
        if (clusterIds.length === 0) {
          return;
        }
        if (clusterIds.every((clusterId) => !connected.has(clusterId))) {
          resetScopedDomainState(domain, scope);
        }
      });
    });
  }

  private getSelectedClusterIds(context: RefreshContext = this.context): string[] {
    // Prefer the explicit multi-select list, fall back to the active selection.
    const explicit = (context.selectedClusterIds ?? [])
      .map((id) => (id ?? '').trim())
      .filter(Boolean);
    if (explicit.length > 0) {
      return explicit;
    }
    const active = (context.selectedClusterId ?? '').trim();
    return active ? [active] : [];
  }

  private normalizeNamespaceScope(value?: string | null): string | null {
    // Prefer the cluster tied to the namespace selection for scoped refreshes.
    const clusterId = this.context.selectedNamespaceClusterId ?? this.context.selectedClusterId;
    return normalizeNamespaceScopeValue(value, clusterId);
  }

  private ensureRefresher(config: DomainRegistration<RefreshDomain>): void {
    if (this.registeredRefreshers.has(config.refresherName)) {
      return;
    }

    const timing = this.resolveTiming(config);

    refreshManager.register({
      name: config.refresherName,
      interval: timing.interval,
      cooldown: timing.cooldown,
      timeout: timing.timeout,
      enabled: DEFAULT_AUTO_START,
    });

    this.registeredRefreshers.add(config.refresherName);
  }

  private resolveTiming(config: DomainRegistration<RefreshDomain>): RefresherTiming {
    return refresherConfig(config.refresherName as StaticRefresherName);
  }

  private shouldAllowRefresher(config: DomainRegistration<RefreshDomain>): boolean {
    return (
      config.scheduled !== false &&
      (!config.streaming || config.streaming.pauseRefresherWhenStreaming === true)
    );
  }

  private reconcileQueryOnlyDemand(
    domain: RefreshDomain,
    scope: string,
    options: { isManual?: boolean; queryReconcile?: boolean },
    config: DomainRegistration<RefreshDomain>,
    runtime: ClusterRefreshRuntime
  ): boolean {
    const hasQueryOnlyDemand =
      runtime.hasScopedDemand(domain, scope, 'query') &&
      !runtime.hasScopedDemand(domain, scope, 'snapshot');
    if (!options.queryReconcile || !hasQueryOnlyDemand) {
      return false;
    }

    let streamingExpected = false;
    let streamingHealthy = false;
    if (config.streaming && this.shouldStreamScope(domain, scope)) {
      streamingExpected = true;
      this.startStreamingScope(domain, scope, config.streaming);
      streamingHealthy = this.isStreamingHealthy(domain, scope);
    }
    if (!options.isManual && streamingHealthy) {
      return true;
    }
    if (!options.isManual && streamingExpected && isResourceStreamDomain(domain)) {
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
    options: { isManual?: boolean; streamSignal?: boolean },
    streaming: StreamingRegistration | undefined,
    runtime: ClusterRefreshRuntime
  ): Promise<boolean> {
    if (!streaming) {
      return false;
    }

    const shouldStream = this.shouldStreamScope(domain, scope);
    if (
      shouldStream &&
      options.isManual &&
      isResourceStreamDomain(domain) &&
      this.isStreamingActive(domain, scope)
    ) {
      await this.refreshStreamingDomainOnce(domain, scope);
      return true;
    }
    if (shouldStream && !options.isManual) {
      this.startStreamingScope(domain, scope, streaming);
    }

    const decision = runtime.resolveStreamingFetchMode({
      domain,
      scope,
      shouldStream,
      isManual: Boolean(options.isManual),
      streamSignal: Boolean(options.streamSignal),
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
    options: {
      signal?: AbortSignal;
      isManual?: boolean;
      streamSignal?: boolean;
      queryReconcile?: boolean;
      correlationId?: string;
    } = {}
  ): Promise<void> {
    const config = this.getConfig(domain);
    const normalizedScope = this.normalizeDomainScope(domain, scope);
    if (!normalizedScope) {
      throw new Error(`Scoped domain "${domain}" requires a non-empty scope`);
    }

    if (isResourceStreamDomain(domain) && parseClusterScopeList(normalizedScope).isMultiCluster) {
      throw new Error(`Resource stream domain "${domain}" requires a single cluster scope`);
    }

    // A cluster whose backend subsystem is still initializing cannot serve any
    // request yet ("no active clusters available"). Hold the work and
    // re-dispatch on the lifecycle's became-serviceable edge — warm-up is
    // loading, not failure.
    if (!this.isScopeClusterServiceable(normalizedScope)) {
      this.recordPendingClusterReadiness(domain, normalizedScope, {
        isManual: Boolean(options.isManual),
        streamSignal: Boolean(options.streamSignal),
        queryReconcile: Boolean(options.queryReconcile),
      });
      return;
    }

    const runtime = this.getRuntimeForScope(domain, normalizedScope);
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

    await this.performFetch(domain, normalizedScope, {
      isManual: options.isManual ?? true,
      signal: options.signal,
      streamSignal: Boolean(options.streamSignal),
      correlationId: options.correlationId,
    });
  }

  private canFetchScope(
    domain: RefreshDomain,
    scope: string,
    options: DomainFetchOptions
  ): boolean {
    if (options.signal?.aborted) {
      return false;
    }
    if (!this.isScopeClusterServiceable(scope)) {
      if (!options.allowDisabledRetainedScope) {
        this.recordPendingClusterReadiness(domain, scope, options);
      }
      return false;
    }
    if (!options.allowDisabledRetainedScope && !this.isScopedDomainEnabledInternal(domain, scope)) {
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
    if (options.isManual) {
      this.teardownInFlight(runtime, makeInFlightKey(domain, scope), currentInFlight);
      return true;
    }
    if (options.streamSignal) {
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
      isManual: options.isManual,
      scope,
    }));

    const controller = new AbortController();
    if (options.signal?.aborted) {
      return null;
    }
    const cleanup = this.forwardAbortSignal(options.signal, controller);
    const requestId = ++this.requestCounter;
    const request: InFlightRequest = {
      controller,
      isManual: options.isManual,
      streamSignal: options.streamSignal,
      requestId,
      cleanup,
      contextVersion,
      domain,
      scope,
    };
    runtime.setInFlight(request);
    markPendingRequest(1);
    return { runtime, scope, previousState, controller, requestId, contextVersion };
  }

  private forwardAbortSignal(
    signal: AbortSignal | undefined,
    controller: AbortController
  ): (() => void) | undefined {
    if (!signal) {
      return undefined;
    }
    const abortListener = () => controller.abort();
    signal.addEventListener('abort', abortListener);
    return () => signal.removeEventListener('abort', abortListener);
  }

  private fetchCanCommit<K extends RefreshDomain>(execution: ScopedFetchExecution<K>): boolean {
    return !execution.controller.signal.aborted && execution.contextVersion === this.contextVersion;
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
    if (result.notModified || !result.snapshot) {
      if (
        !options.allowDisabledRetainedScope &&
        !this.isScopedDomainEnabledInternal(domain, scope)
      ) {
        return;
      }
      execution.runtime.markPermissionAllowed(domain, scope);
      setScopedDomainState(domain, scope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        isManual: options.isManual,
        lastAutoRefresh: options.isManual ? previous.lastAutoRefresh : Date.now(),
      }));
      this.clearRefreshError(domain, scope);
      return;
    }

    this.applySnapshot(
      domain,
      result.snapshot,
      result.etag,
      options.isManual,
      scope,
      options.allowDisabledRetainedScope
    );
  }

  private handleFetchFailure<K extends RefreshDomain>(
    domain: K,
    execution: ScopedFetchExecution<K>,
    options: DomainFetchOptions,
    error: unknown
  ): void {
    if (!this.fetchCanCommit(execution)) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (isSnapshotPermissionDenied(error)) {
      // A typed 403 is a settled answer and bypasses startup network-error
      // suppression so automatic retries stop for this scope.
      execution.runtime.markPermissionDenied(domain, execution.scope);
      setScopedDomainState(domain, execution.scope, (previous) => ({
        ...previous,
        status: 'error',
        error: message,
        permissionDenied: true,
        isManual: options.isManual,
      }));
      this.notifyRefreshError(domain, execution.scope, message, error, options.correlationId);
      return;
    }
    if (this.errorNotifier.shouldSuppressNetworkError(message)) {
      setScopedDomainState(domain, execution.scope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : previous.status,
        error: null,
        isManual: options.isManual,
      }));
      return;
    }

    setScopedDomainState(domain, execution.scope, (previous) => ({
      ...previous,
      status: 'error',
      error: message,
      isManual: options.isManual,
    }));
    this.notifyRefreshError(domain, execution.scope, message, error, options.correlationId);
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
        void this.performFetch(domain, scope, {
          isManual: false,
          streamSignal: true,
        });
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
    if (!this.canFetchScope(domain, normalizedScope, options)) {
      return;
    }

    const runtime = this.getRuntimeForScope(domain, normalizedScope);
    if (!this.claimFetchSlot(domain, normalizedScope, options, runtime)) {
      return;
    }

    const previousState = getScopedDomainState(domain, normalizedScope);
    // A permission-denied scope is SETTLED: the backend refused it with a
    // typed 403 and permission changes are not expected mid-session (the
    // exceptions — a namespace-scope rebuild, and manual refresh below —
    // clear the latch explicitly; see handleClusterScopeChanged). Background
    // retries here caused a request every ~2s
    // (the no-data fetch clause) and flicked the state through 'loading' —
    // observed live as a spinner flashing over the permission message. Manual
    // refresh remains a deliberate re-ask.
    if (!options.isManual && runtime.isPermissionDenied(domain, normalizedScope)) {
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

    try {
      const result = await fetchSnapshot<DomainPayloadMap[K]>(domain, {
        scope: normalizedScope,
        signal: execution.controller.signal,
        ifNoneMatch: previousState.sourceVersion ?? previousState.etag,
        manual: Boolean(options.isManual && !isResourceStreamDomain(domain)),
        correlationId: options.correlationId,
      });
      if (this.fetchCanCommit(execution)) {
        this.applyFetchResult(domain, execution, options, result);
      }
    } catch (error) {
      this.handleFetchFailure(domain, execution, options, error);
    } finally {
      this.finishFetch(domain, execution);
    }
  }

  private applySnapshot<K extends RefreshDomain>(
    domain: K,
    snapshot: Snapshot<DomainPayloadMap[K]>,
    etag: string | undefined,
    isManual: boolean,
    scope?: string,
    allowDisabledRetainedScope = false
  ): void {
    const tracked = this.getRuntimeForScope(domain, scope).getInFlight(domain, scope);
    if (tracked && tracked.contextVersion !== this.contextVersion) {
      return;
    }
    const payload = mergePollingListPayload(domain, snapshot.payload, scope);
    const resolvedScope = scope ?? snapshot.scope ?? '';

    if (resolvedScope) {
      if (
        !allowDisabledRetainedScope &&
        !this.isScopedDomainEnabledInternal(domain, resolvedScope)
      ) {
        return;
      }
      this.getRuntimeForScope(domain, resolvedScope).markPermissionAllowed(domain, resolvedScope);
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
    return this.getRuntimeForScope(domain, scope).isScopedDomainEnabled(domain, scope);
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
    const runtime = this.getRuntimeForScope(domain, scope);
    const key = makeInFlightKey(domain, scope);
    const details = runtime.getInFlight(domain, scope);
    if (details) {
      this.teardownInFlight(runtime, key, details);
    }
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
    const runtime = this.getRuntimeForScope(domain, scope);
    if (!runtime.blockStreaming(domain, scope)) {
      return;
    }
    const config = this.configs.get(domain);
    if (config?.streaming) {
      this.stopStreamingScope(domain, scope, config.streaming, false);
    }
    logWarning(
      `[refresh] stream permission denied — streaming blocked domain=${domain} scope=${scope} reason=${payload.reason}`,
      { clusterId: parseClusterScope(scope).clusterId }
    );
    // Settle the scope's snapshot state NOW: the fetch gets the same typed
    // 403 instantly and stamps permissionDenied, so anything gated on this
    // scope's initial load (the typed-query tables) resolves immediately
    // instead of waiting out stream teardown timing.
    void this.performFetch(domain, scope, { isManual: true }).catch(() => {
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
    const runtime = this.getRuntimeForScope(domain, scope);
    if (!runtime.blockStreaming(domain, scope)) {
      return;
    }

    const config = this.configs.get(domain);
    if (config?.streaming) {
      this.stopStreamingScope(domain, scope, config.streaming, false);
    }

    logWarning(
      `[refresh] resource stream drift detected domain=${domain} scope=${scope} reason=${payload.reason}`,
      { clusterId: parseClusterScope(scope).clusterId }
    );
  };

  private readonly handleResourceStreamHealth = (
    payload: AppEvents['refresh:resource-stream-health']
  ): void => {
    const scope = payload.scope.trim();
    if (!scope) {
      return;
    }
    const domain = payload.domain;
    const previous = this.getRuntimeForScope(domain, scope).setStreamHealth(domain, scope, payload);
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
    // The cluster's namespace scope changed and the backend finished tearing
    // down + rebuilding its refresh subsystem (docs/architecture/namespace-scope.md):
    // every stream to that subsystem is dead and every cached snapshot is
    // pre-rebuild. Resume exactly as auth recovery does (minus the pause
    // bookkeeping — auth never went invalid).
    logInfo('[refresh] namespace scope changed — restarting streams', {
      clusterId: payload.clusterId,
    });
    // Permission-denied scopes are settled for the session — EXCEPT across a
    // scope rebuild, which is a real permission epoch change: domains denied
    // cluster-wide may now be served per-namespace. Clear the latches so the
    // affected scopes re-ask (they hold no data, so nothing blanks).
    resetPermissionDeniedScopedDomainStates();
    this.resetAllRuntimePermissionEpochs();
    this.incrementContextVersion();
    // Suppress transient errors while the rebuilt subsystem starts serving.
    this.errorNotifier.suppressNetworkErrors(6000);
    this.clearAllBlockedStreaming();
    this.clearAllStreamHealth();
    this.errorNotifier.clearAll();
    this.handleStreamingScopeChanges();
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
    // A kubeconfig change supersedes tracked auth-failure state.
    this.forEachRuntime((runtime) => runtime.markAuthRecovered());
    this.incrementContextVersion();
    this.stopAllStreaming(true);
    this.abortAllInFlight();
    this.clearAllBlockedStreaming();
    this.clearAllStreamHealth();
    this.configs.forEach((_config, domain) => {
      const wasEnabled = this.hasEnabledScopedSources(domain);
      this.suspendedDomains.set(domain, wasEnabled);

      this.setDomainEnabled(domain, false);
      this.resetDomain(domain);

      this.deleteDomainFromAllRuntimes(domain);
    });
  };

  // Re-evaluate streaming for all scoped domains when the orchestrator context changes.
  private handleStreamingScopeChanges(): void {
    this.configs.forEach((config, domain) => {
      const streaming = config.streaming;
      if (!streaming) {
        return;
      }

      this.getAllRuntimes().forEach((runtime) => {
        runtime.forEachEnabledScope(domain, (scope) => {
          const shouldStream = this.shouldStreamScope(domain, scope);
          const scopeRuntime = this.getRuntimeForScope(domain, scope);
          const alreadyStreaming = scopeRuntime.isStreamingStartingOrActive(domain, scope);

          if (shouldStream && !alreadyStreaming) {
            // Context now allows streaming for this scope — start it.
            this.scheduleStreamingStart(domain, scope, streaming);
          } else if (!shouldStream && alreadyStreaming) {
            // Context no longer allows streaming — stop it.
            scopeRuntime.clearStreamingReady(domain, scope);
            this.stopStreamingScope(domain, scope, streaming, false);
          }
        });
      });
    });
  }

  private readonly handleKubeconfigChanged = () => {
    this.incrementContextVersion();
    this.errorNotifier.suppressNetworkErrors(6000);
    this.suspendedDomains.clear();
    this.clearAllBlockedStreaming();
    this.clearAllStreamHealth();
  };

  private readonly handleKubeconfigSelectionChanged = () => {
    // The service route is stable while the backend atomically replaces its handler.
    this.incrementContextVersion();
    this.errorNotifier.suppressNetworkErrors(6000);
    this.clearAllBlockedStreaming();
    this.clearAllStreamHealth();
  };

  private readonly handleAutoRefreshChanged = () => {
    this.handleStreamingScopeChanges();
  };
}

export const refreshOrchestrator = new RefreshOrchestrator();
registerDefaultRefreshDomains(refreshOrchestrator);
