/**
 * frontend/src/core/refresh/orchestrator.ts
 *
 * Module source for orchestrator.
 * Implements orchestrator logic for the core layer.
 */

import {
  ensureRefreshBaseURL,
  fetchSnapshot,
  invalidateRefreshBaseURL,
  setMetricsActive,
  type Snapshot,
} from './client';
import { eventBus, type AppEvents } from '@/core/events';
import { refreshManager, type RefreshContext } from './RefreshManager';
import type { RefresherName, StaticRefresherName } from './refresherTypes';
import { refresherConfig, type RefresherTiming } from './refresherConfig';
import {
  getRefreshState,
  getScopedDomainState,
  markPendingRequest,
  resetAllScopedDomainStates,
  resetScopedDomainState,
  setScopedDomainState,
} from './store';
import type { DomainPayloadMap, RefreshDomain } from './types';
import { resourceStreamManager } from './streaming/resourceStreamManager';
import {
  APP_LOG_SOURCES,
  logAppLogsInfo,
  logAppLogsWarn,
  type AppLogsClusterMeta,
} from '@/core/logging/appLogsClient';
import { getAutoRefreshEnabled, getMetricsRefreshIntervalMs } from '@/core/settings/appPreferences';
import { buildClusterScope, parseClusterScope, parseClusterScopeList } from './clusterScope';
import { clusterReadiness } from './clusterReadiness';
import { ClusterRefreshRuntime, makeInFlightKey } from './refreshRuntime';
import { mergePollingListPayload } from './snapshotMerge';
import { registerDefaultRefreshDomains } from './domainRegistrations';
import type { DomainRegistration, StreamingRegistration } from './refreshRegistration';
import { isResourceStreamDomain, isResourceStreamViewActive } from './resourceStreamViews';
import {
  normalizeNamespaceScope as normalizeNamespaceScopeValue,
  normalizeRefreshDomainScope,
} from './scopeNormalization';
import { RefreshErrorNotifier } from './refreshErrorNotifier';

type DomainFetchOptions = {
  isManual: boolean;
  signal?: AbortSignal;
  metricsOnly?: boolean;
  allowDisabledRetainedScope?: boolean;
};

// Refreshers are disabled at registration by default. Most domains rely on
// view hooks (e.g. ClusterResourcesContext, useBrowseCatalog) to enable
// scopes on demand rather than polling from app startup. Changing this to
// true would cause all streaming domains to start polling immediately at
// registration, regardless of whether the user is on the relevant view.
// Set autoStart: true on individual domain registrations when needed.
const DEFAULT_AUTO_START = false;
const noopStreamingCleanup = () => {};
// Keep streaming metrics refreshes aligned with the configurable metrics cadence.
const getStreamingMetricsMinIntervalMs = (): number => getMetricsRefreshIntervalMs();

const logInfo = (message: string, cluster?: AppLogsClusterMeta): void => {
  logAppLogsInfo(message, APP_LOG_SOURCES.RefreshOrchestrator, cluster);
};

const logWarning = (message: string, cluster?: AppLogsClusterMeta): void => {
  logAppLogsWarn(message, APP_LOG_SOURCES.RefreshOrchestrator, cluster);
};

class RefreshOrchestrator {
  private configs = new Map<RefreshDomain, DomainRegistration<RefreshDomain>>();
  private unsubscriptions = new Map<RefreshDomain, () => void>();
  private registeredRefreshers = new Set<RefresherName>();
  private coordinatorRuntime = new ClusterRefreshRuntime('__coordinator__');
  private clusterRuntimes = new Map<string, ClusterRefreshRuntime>();
  // Scoped fetches held because the scope's cluster backend is still
  // initializing; keyed by clusterId, values are "<domain> <scope>" pairs
  // re-dispatched on the lifecycle's became-serviceable edge.
  private pendingClusterReadiness = new Map<string, Set<string>>();

  private requestCounter = 0;
  private metricsDemandActive = false;

  private suspendedDomains = new Map<RefreshDomain, boolean>();
  private contextVersion = 0;
  private context: RefreshContext = {
    currentView: 'namespace',
    objectPanel: { isOpen: false },
  };
  private errorNotifier = new RefreshErrorNotifier();

  // Tracks clusters with auth failures so refresh is paused while auth is invalid.
  private authFailedClusters = new Set<string>();
  private authPaused = false;

  constructor() {
    eventBus.on('view:reset', this.handleResetViews);
    eventBus.on('kubeconfig:changing', this.handleKubeconfigChanging);
    eventBus.on('kubeconfig:changed', this.handleKubeconfigChanged);
    eventBus.on('kubeconfig:selection-changed', this.handleKubeconfigSelectionChanged);
    eventBus.on('settings:auto-refresh', this.handleAutoRefreshChanged);
    eventBus.on('refresh:resource-stream-drift', this.handleResourceStreamDrift);
    eventBus.on('refresh:resource-stream-health', this.handleResourceStreamHealth);
    eventBus.on('cluster:auth:failed', this.handleClusterAuthFailed);
    eventBus.on('cluster:auth:recovered', this.handleClusterAuthRecovered);
    clusterReadiness.onBecameServiceable((clusterId) =>
      this.handleClusterBecameServiceable(clusterId)
    );
    // Emit a single log so operators can confirm streaming config at runtime.
    logInfo('[refresh] resource streaming enabled (mode=active, domains=all)');
  }

  /** Every requested cluster's backend subsystem can serve (or is unknown). */
  private isScopeClusterServiceable(scope: string): boolean {
    return parseClusterScopeList(scope).clusterIds.every((clusterId) =>
      clusterReadiness.isServiceable(clusterId)
    );
  }

  /** Hold a fetch for re-dispatch when the scope's cluster(s) become serviceable. */
  private recordPendingClusterReadiness(domain: RefreshDomain, scope: string): void {
    for (const clusterId of parseClusterScopeList(scope).clusterIds) {
      let pending = this.pendingClusterReadiness.get(clusterId);
      if (!pending) {
        pending = new Set<string>();
        this.pendingClusterReadiness.set(clusterId, pending);
      }
      pending.add(`${domain}\u0000${scope}`);
    }
  }

  private handleClusterBecameServiceable(clusterId: string): void {
    const pending = this.pendingClusterReadiness.get(clusterId);
    this.pendingClusterReadiness.delete(clusterId);
    if (!pending) {
      return;
    }
    for (const key of pending) {
      const separator = key.indexOf('\u0000');
      const domain = key.slice(0, separator) as RefreshDomain;
      const scope = key.slice(separator + 1);
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
        this.recordPendingClusterReadiness(domain, scope);
        continue;
      }
      void this.fetchScopedDomain(domain, scope, { isManual: false }).catch((error) => {
        logWarning(
          `[refresh] deferred ${domain} fetch after cluster ${clusterId} became serviceable failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    }
  }

  private notifyRefreshError(
    domain: RefreshDomain,
    scope: string | undefined,
    message: string
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
          await this.refreshEnabledScopes(config.domain, { isManual, signal });
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
    // Normalize object-panel kinds so case-only changes don't thrash refresh targets.
    const normalizedContext: Partial<RefreshContext> = { ...context };
    if (context.objectPanel) {
      const normalizedPanel = { ...context.objectPanel };
      if (typeof normalizedPanel.objectKind === 'string') {
        normalizedPanel.objectKind = normalizedPanel.objectKind.toLowerCase();
      }
      normalizedContext.objectPanel = normalizedPanel;
    }
    this.context = { ...this.context, ...normalizedContext };
    refreshManager.updateContext(normalizedContext);

    if (Object.prototype.hasOwnProperty.call(normalizedContext, 'allConnectedClusterIds')) {
      this.pruneRemovedClusterRuntimes(normalizedContext.allConnectedClusterIds ?? []);
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

    const podsRefresh = this.triggerActiveNamespacePodsRefresh(targetContext);
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

    const readyTask = ensureRefreshBaseURL()
      .then(() => {
        if (!this.isScopedDomainEnabledInternal(domain, normalizedScope)) {
          return;
        }
        this.startStreamingScope(domain, normalizedScope, streaming);
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : 'Failed to initialise refresh subsystem';
        console.error(`Failed to initialise streaming for ${domain}`, error);
        setScopedDomainState(domain, normalizedScope, (previous) => ({
          ...previous,
          status: 'error',
          error: message,
          scope: normalizedScope,
        }));
        const notificationScope = normalizedScope?.trim() || undefined;
        this.notifyRefreshError(domain, notificationScope, message);
      })
      .finally(() => {
        runtime.clearStreamingReady(domain, normalizedScope);
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
      runtime.getKnownScopes(domain).forEach((scope) => scopes.add(scope));
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

  setScopedDomainEnabled(
    domain: RefreshDomain,
    scope: string,
    enabled: boolean,
    options?: { preserveState?: boolean }
  ): void {
    const config = this.getConfig(domain);
    const allowRefresher = this.shouldAllowRefresher(config);
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
    staleScopes.forEach((staleScope) => {
      this.cancelInFlightForScopedDomain(domain, staleScope);
      if (config.streaming) {
        this.getRuntimeForScope(domain, staleScope).clearStreamingReady(domain, staleScope);
        this.stopStreamingScope(domain, staleScope, config.streaming, true);
      } else {
        resetScopedDomainState(domain, staleScope);
      }
    });
    if (!changed) {
      this.updateMetricsDemand();
      return;
    }

    const isActive = this.hasEnabledScopedSources(domain);

    if (allowRefresher) {
      if (!wasActive && isActive) {
        refreshManager.enable(config.refresherName);
      } else if (wasActive && !isActive) {
        refreshManager.disable(config.refresherName);
      }
    }

    // When preserveState is true, toggling the domain stops/restarts activity
    // without clearing the last scoped snapshot from the store. This is useful
    // for event streams where reconnects should not blank the visible table.
    const preserveState = Boolean(options?.preserveState);
    const resetOnDisable = !preserveState;

    if (config.streaming) {
      const shouldStream = this.shouldStreamScope(domain, normalizedScope);
      if (enabled && shouldStream) {
        runtime.clearStreamingReady(domain, normalizedScope);
        if (!preserveState) {
          resetScopedDomainState(domain, normalizedScope);
        }
        this.scheduleStreamingStart(domain, normalizedScope, config.streaming);
      } else if (!enabled) {
        runtime.clearStreamingReady(domain, normalizedScope);
        this.stopStreamingScope(domain, normalizedScope, config.streaming, resetOnDisable);
        this.cancelInFlightForScopedDomain(domain, normalizedScope);
      } else if (!shouldStream) {
        if (runtime.hasStreamingBookkeeping(domain, normalizedScope)) {
          runtime.clearStreamingReady(domain, normalizedScope);
          this.stopStreamingScope(domain, normalizedScope, config.streaming, false);
        }
      }
      this.updateMetricsDemand();
      return;
    }

    if (!enabled) {
      this.cancelInFlightForScopedDomain(domain, normalizedScope);
      if (resetOnDisable) {
        resetScopedDomainState(domain, normalizedScope);
      }
    }
    this.updateMetricsDemand();
  }

  // Acquire a reference-counted lease that keeps (domain, scope) enabled while
  // any mounted consumer holds it. The scope is enabled only on the first lease
  // so concurrent and remounting consumers share one enable.
  acquireScopedDomainLease(
    domain: RefreshDomain,
    scope: string,
    options?: { preserveState?: boolean }
  ): void {
    const normalizedScope = this.normalizeDomainScope(domain, scope);
    if (!normalizedScope) {
      throw new Error(`Scoped domain "${domain}" requires a non-empty scope value`);
    }
    const runtime = this.getRuntimeForScope(domain, normalizedScope);
    const { firstLease } = runtime.acquireScopedLease(domain, normalizedScope);
    if (firstLease) {
      this.setScopedDomainEnabled(domain, normalizedScope, true, options);
    }
  }

  // Release a lease previously acquired via acquireScopedDomainLease. The scope
  // is disabled only when the final lease is released, so an old consumer's
  // unmount cannot disable a scope a newer consumer still leases.
  releaseScopedDomainLease(
    domain: RefreshDomain,
    scope: string,
    options?: { preserveState?: boolean }
  ): void {
    const normalizedScope = this.normalizeDomainScope(domain, scope);
    if (!normalizedScope) {
      return;
    }
    const runtime = this.getRuntimeForScope(domain, normalizedScope);
    const { lastLease } = runtime.releaseScopedLease(domain, normalizedScope);
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

  private isStreamingBlocked(domain: RefreshDomain, scope?: string): boolean {
    if (!isResourceStreamDomain(domain) || !scope) {
      return false;
    }
    return this.getRuntimeForScope(domain, scope).isStreamingBlocked(domain, scope);
  }

  private isStreamingActive(domain: RefreshDomain, scope: string): boolean {
    return this.getRuntimeForScope(domain, scope).isStreamingActive(domain, scope);
  }

  // Resource stream health gates polling so snapshots stay active until delivery resumes.
  private isStreamingHealthy(domain: RefreshDomain, scope?: string): boolean {
    if (!scope) {
      return false;
    }
    if (isResourceStreamDomain(domain)) {
      return resourceStreamManager.isHealthy(domain, scope);
    }
    if (domain === 'catalog' || domain === 'cluster-events' || domain === 'namespace-events') {
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
    // ANY domain: on the events domains they share the singleton SSE connection
    // with the parameterless base scope and would churn it on every query.
    if (trimmed.includes('?')) {
      return false;
    }
    // No stream can be established while the scope's cluster backend is still
    // initializing — the SSE endpoint rejects the request and the EventSource
    // would hot-loop on reconnect attempts.
    if (!this.isScopeClusterServiceable(trimmed)) {
      return false;
    }
    if (!isResourceStreamDomain(domain)) {
      return true;
    }
    if (!isResourceStreamViewActive(domain, this.context)) {
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
      .then((cleanup) => {
        if (
          !this.isScopedDomainEnabledInternal(domain, scope) ||
          runtime.isStreamingCancelled(domain, scope)
        ) {
          runtime.failStreamingStart(domain, scope);
          runtime.clearStreamingCancelled(domain, scope);
          if (typeof cleanup === 'function') {
            try {
              cleanup();
            } catch (error) {
              console.error(`Failed to clean up streaming domain ${domain}::${scope}`, error);
            }
          }
          return;
        }

        runtime.finishStreamingStart(domain, scope, cleanup ?? noopStreamingCleanup);
      })
      .catch((error) => {
        runtime.failStreamingStart(domain, scope);
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to start streaming domain ${domain}::${scope}`, error);
        // All domains are scoped — write error to scoped store.
        setScopedDomainState(domain, scope, (previous) => ({
          ...previous,
          status: 'error',
          error: message,
          scope,
        }));
        const notificationScope = scope?.trim() || undefined;
        this.notifyRefreshError(domain, notificationScope, message);
      });

    return startPromise.then(() => undefined).catch(() => undefined);
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
        .then((cleanup) => {
          if (typeof cleanup === 'function') {
            try {
              cleanup();
            } catch (error) {
              console.error(`Failed to stop pending streaming domain ${domain}::${scope}`, error);
            }
          }
        })
        .finally(() => {
          runtime.failStreamingStart(domain, scope);
          runtime.clearStreamingCancelled(domain, scope);
        });
    }

    const cleanup = runtime.getStreamingCleanup(domain, scope);
    if (cleanup) {
      try {
        cleanup();
      } catch (error) {
        console.error(`Failed to stop streaming domain ${domain}::${scope}`, error);
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

  private triggerActiveNamespacePodsRefresh(context: RefreshContext): Promise<void> | null {
    if (context.currentView !== 'namespace' || context.activeNamespaceView !== 'pods') {
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

  private clearAllMetricsRefreshTracking(): void {
    this.forEachRuntime((runtime) => runtime.clearMetricsRefreshTracking());
  }

  private clearAllAsyncStreamingBookkeeping(): void {
    this.forEachRuntime((runtime) => runtime.clearAsyncStreamingBookkeeping());
  }

  private clearAllStreamHealth(): void {
    this.forEachRuntime((runtime) => runtime.clearAllStreamHealth());
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
      !config.streaming ||
      config.streaming.metricsOnly === true ||
      config.streaming.pauseRefresherWhenStreaming === true
    );
  }

  async fetchScopedDomain<K extends RefreshDomain>(
    domain: K,
    scope: string,
    options: { signal?: AbortSignal; isManual?: boolean } = {}
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
      this.recordPendingClusterReadiness(domain, normalizedScope);
      return;
    }

    if (config.streaming) {
      const shouldStream = this.shouldStreamScope(domain, normalizedScope);
      const runtime = this.getRuntimeForScope(domain, normalizedScope);
      if (shouldStream) {
        if (options.isManual) {
          // For resource-stream (WebSocket) domains, use refreshOnce when
          // the stream is already connected for immediate delta delivery.
          // For SSE domains (catalog, events), always fall through to a
          // snapshot fetch — the SSE stream delivers full snapshots on its
          // own schedule and refreshStreamingDomainOnce just restarts the
          // connection, which is wasteful for a manual refresh.
          if (isResourceStreamDomain(domain) && this.isStreamingActive(domain, normalizedScope)) {
            await this.refreshStreamingDomainOnce(domain, normalizedScope);
            return;
          }
          // SSE domains and inactive streams fall through to performFetch.
        } else {
          this.startStreamingScope(domain, normalizedScope, config.streaming);
        }
      }
      const fetchMode = runtime.resolveStreamingFetchMode({
        domain,
        scope: normalizedScope,
        shouldStream,
        isManual: Boolean(options.isManual),
        metricsOnly: Boolean(config.streaming.metricsOnly),
        streamingHealthy: this.isStreamingHealthy(domain, normalizedScope),
        metricsMinIntervalMs: getStreamingMetricsMinIntervalMs(),
      });
      if (fetchMode === 'skip') {
        return;
      }
    }

    await this.performFetch(domain, normalizedScope, {
      isManual: options.isManual ?? true,
      signal: options.signal,
      metricsOnly: Boolean(config.streaming?.metricsOnly),
    });
  }

  private async performFetch<K extends RefreshDomain>(
    domain: K,
    scope: string | undefined,
    options: DomainFetchOptions
  ): Promise<void> {
    const metricsOnly = Boolean(options.metricsOnly);
    // All domains are scoped — normalizeScope without allowEmpty.
    const normalizedScope = this.normalizeDomainScope(domain, scope);

    if (options.signal?.aborted) {
      return;
    }

    if (!normalizedScope || normalizedScope.length === 0) {
      throw new Error(`Scoped domain "${domain}" requires a valid scope`);
    }

    if (
      !options.allowDisabledRetainedScope &&
      !this.isScopedDomainEnabledInternal(domain, normalizedScope)
    ) {
      resetScopedDomainState(domain, normalizedScope);
      return;
    }

    const runtime = this.getRuntimeForScope(domain, normalizedScope);
    const contextVersion = this.contextVersion;
    const inFlightKey = makeInFlightKey(domain, normalizedScope);
    const currentInFlight = runtime.getInFlight(domain, normalizedScope);

    if (currentInFlight) {
      if (options.isManual && !currentInFlight.isManual) {
        currentInFlight.controller.abort();
        this.teardownInFlight(runtime, inFlightKey, currentInFlight);
      } else if (!options.isManual) {
        return;
      } else if (options.isManual && currentInFlight.isManual) {
        currentInFlight.controller.abort();
        this.teardownInFlight(runtime, inFlightKey, currentInFlight);
      }
    }

    const previousState = getScopedDomainState(domain, normalizedScope);
    const nextStatus = previousState.data ? 'updating' : 'loading';

    setScopedDomainState(domain, normalizedScope, (prev) => ({
      ...prev,
      status: nextStatus,
      error: null,
      isManual: options.isManual,
      scope: normalizedScope,
    }));

    const controller = new AbortController();
    const requestId = ++this.requestCounter;

    let cleanup: (() => void) | undefined;
    if (options.signal) {
      if (options.signal.aborted) {
        return;
      }
      const abortListener = () => controller.abort();
      options.signal.addEventListener('abort', abortListener);
      cleanup = () => options.signal?.removeEventListener('abort', abortListener);
    }

    runtime.setInFlight({
      controller,
      isManual: options.isManual,
      requestId,
      cleanup,
      contextVersion,
      domain,
      scope: normalizedScope,
    });

    markPendingRequest(1);

    try {
      const { snapshot, etag, notModified } = await fetchSnapshot<DomainPayloadMap[K]>(domain, {
        scope: normalizedScope,
        signal: controller.signal,
        ifNoneMatch: previousState.sourceVersion ?? previousState.etag,
      });

      if (controller.signal.aborted) {
        return;
      }

      if (contextVersion !== this.contextVersion) {
        return;
      }

      if (notModified || !snapshot) {
        if (
          !options.allowDisabledRetainedScope &&
          !this.isScopedDomainEnabledInternal(domain, normalizedScope)
        ) {
          return;
        }
        setScopedDomainState(domain, normalizedScope, (prev) => ({
          ...prev,
          status: prev.data ? 'ready' : 'idle',
          isManual: options.isManual,
          lastAutoRefresh: options.isManual ? prev.lastAutoRefresh : Date.now(),
        }));
        if (metricsOnly && !options.isManual) {
          runtime.recordMetricsRefresh(domain, normalizedScope);
        }
        this.clearRefreshError(domain, normalizedScope);
        return;
      }

      this.applySnapshot(
        domain,
        snapshot,
        etag,
        options.isManual,
        normalizedScope,
        options.allowDisabledRetainedScope
      );
      if (metricsOnly && !options.isManual) {
        runtime.recordMetricsRefresh(domain, normalizedScope);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (contextVersion !== this.contextVersion) {
        // Ignore errors from refreshes started before a context switch.
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      if (this.errorNotifier.shouldSuppressNetworkError(message)) {
        setScopedDomainState(domain, normalizedScope, (prev) => ({
          ...prev,
          status: prev.data ? 'ready' : prev.status,
          error: null,
          isManual: options.isManual,
        }));
        return;
      }

      setScopedDomainState(domain, normalizedScope, (prev) => ({
        ...prev,
        status: 'error',
        error: message,
        isManual: options.isManual,
      }));
      this.notifyRefreshError(domain, normalizedScope, message);
    } finally {
      const tracked = runtime.getInFlight(domain, normalizedScope);
      if (tracked && tracked.requestId === requestId) {
        tracked.cleanup?.();
        runtime.deleteInFlight(domain, normalizedScope);
      }

      markPendingRequest(-1);
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
        isManual,
        scope: resolvedScope,
      }));
      this.clearRefreshError(domain, resolvedScope);
    }
  }

  private isMetricsDemandActive(): boolean {
    if (this.hasEnabledScopedSources('cluster-overview')) {
      return true;
    }
    if (this.hasEnabledScopedSources('nodes-metrics')) {
      return true;
    }
    if (this.hasEnabledScopedSources('pods-metrics')) {
      return true;
    }
    if (this.hasEnabledScopedSources('namespace-workloads-metrics')) {
      return true;
    }
    return false;
  }

  private updateMetricsDemand(): void {
    const active = this.isMetricsDemandActive();
    if (active === this.metricsDemandActive) {
      return;
    }
    this.metricsDemandActive = active;
    void setMetricsActive(active).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logWarning(`[refresh] metrics demand update failed: ${message}`);
    });
  }

  private isScopedDomainEnabledInternal(domain: RefreshDomain, scope: string): boolean {
    return this.getRuntimeForScope(domain, scope).isScopedDomainEnabled(domain, scope);
  }

  private teardownInFlight(
    runtime: ClusterRefreshRuntime,
    key: string,
    details: { controller: AbortController; cleanup?: () => void; contextVersion: number }
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

  private handleResourceStreamDrift = (
    payload: AppEvents['refresh:resource-stream-drift']
  ): void => {
    const scope = payload.scope.trim();
    if (!scope) {
      return;
    }
    // Disable streaming for drifted scopes so snapshots remain the source of truth.
    const domain = payload.domain as RefreshDomain;
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

  private handleResourceStreamHealth = (
    payload: AppEvents['refresh:resource-stream-health']
  ): void => {
    const scope = payload.scope.trim();
    if (!scope) {
      return;
    }
    const domain = payload.domain as RefreshDomain;
    this.getRuntimeForScope(domain, scope).setStreamHealth(domain, scope, payload);
  };

  private handleClusterAuthFailed = (payload: { clusterId: string }) => {
    this.authFailedClusters.add(payload.clusterId);
    if (this.authPaused) {
      return;
    }
    // Pause all refresh activity — the refresh subsystem is unavailable while auth is invalid.
    this.authPaused = true;
    logInfo('[refresh] pausing — cluster auth failed', { clusterId: payload.clusterId });
    this.incrementContextVersion();
    invalidateRefreshBaseURL();
    this.stopAllStreaming(false);
    this.abortAllInFlight();
    // Clear async streaming bookkeeping so stale entries from in-progress
    // connections don't block restart when auth recovers.
    this.clearAllAsyncStreamingBookkeeping();
  };

  private handleClusterAuthRecovered = (payload: { clusterId: string }) => {
    this.authFailedClusters.delete(payload.clusterId);
    if (!this.authPaused) {
      return;
    }
    // Only unpause when all tracked auth failures have been resolved.
    if (this.authFailedClusters.size > 0) {
      return;
    }
    this.authPaused = false;
    logInfo('[refresh] resuming — cluster auth recovered', { clusterId: payload.clusterId });
    this.incrementContextVersion();
    invalidateRefreshBaseURL();
    // Suppress transient errors while the backend refresh subsystem reinitialises.
    this.errorNotifier.suppressNetworkErrors(6000);
    this.clearAllBlockedStreaming();
    this.clearAllMetricsRefreshTracking();
    this.clearAllStreamHealth();
    this.errorNotifier.clearAll();
    // Restart streaming for all enabled scopes. The ensureRefreshBaseURL retry
    // loop (30 attempts with backoff) naturally waits for the backend refresh
    // subsystem to reinitialise after auth recovery.
    this.handleStreamingScopeChanges();
  };

  private handleResetViews = () => {
    this.incrementContextVersion();
    invalidateRefreshBaseURL();
    this.stopAllStreaming(true);
    this.abortAllInFlight();
    this.clearAllBlockedStreaming();
    this.clearAllMetricsRefreshTracking();
    this.clearAllStreamHealth();
    this.configs.forEach((_, domain) => {
      this.resetDomain(domain);
    });
  };

  private handleKubeconfigChanging = () => {
    // A kubeconfig change supersedes any auth-paused state.
    this.authPaused = false;
    this.authFailedClusters.clear();
    this.incrementContextVersion();
    invalidateRefreshBaseURL();
    this.stopAllStreaming(true);
    this.abortAllInFlight();
    this.clearAllBlockedStreaming();
    this.clearAllMetricsRefreshTracking();
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
      if (!config.streaming) {
        return;
      }

      this.getAllRuntimes().forEach((runtime) => {
        runtime.forEachEnabledScope(domain, (scope) => {
          const shouldStream = this.shouldStreamScope(domain, scope);
          const scopeRuntime = this.getRuntimeForScope(domain, scope);
          const alreadyStreaming = scopeRuntime.isStreamingStartingOrActive(domain, scope);

          if (shouldStream && !alreadyStreaming) {
            // Context now allows streaming for this scope — start it.
            this.scheduleStreamingStart(domain, scope, config.streaming!);
          } else if (!shouldStream && alreadyStreaming) {
            // Context no longer allows streaming — stop it.
            scopeRuntime.clearStreamingReady(domain, scope);
            this.stopStreamingScope(domain, scope, config.streaming!, false);
          }
        });
      });
    });
  }

  private handleKubeconfigChanged = () => {
    this.incrementContextVersion();
    invalidateRefreshBaseURL();
    this.errorNotifier.suppressNetworkErrors(6000);
    this.suspendedDomains.clear();
    this.clearAllBlockedStreaming();
    this.clearAllMetricsRefreshTracking();
    this.clearAllStreamHealth();
  };

  private handleKubeconfigSelectionChanged = () => {
    // Backend may rebuild the refresh subsystem; invalidate base URL and suppress transient errors.
    this.incrementContextVersion();
    invalidateRefreshBaseURL();
    this.errorNotifier.suppressNetworkErrors(6000);
    this.clearAllBlockedStreaming();
    this.clearAllMetricsRefreshTracking();
    this.clearAllStreamHealth();
  };

  private handleAutoRefreshChanged = () => {
    this.handleStreamingScopeChanges();
  };
}

export const refreshOrchestrator = new RefreshOrchestrator();
registerDefaultRefreshDomains(refreshOrchestrator);
