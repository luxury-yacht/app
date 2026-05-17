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
  type SnapshotStats,
} from './client';
import { eventBus, type AppEvents } from '@/core/events';
import { refreshManager, type RefreshContext } from './RefreshManager';
import {
  CLUSTER_REFRESHERS,
  NAMESPACE_REFRESHERS,
  SYSTEM_REFRESHERS,
  type RefresherName,
  type SystemRefresherName,
  type ClusterRefresherName,
  type NamespaceRefresherName,
} from './refresherTypes';
import {
  clusterRefresherConfig,
  namespaceRefresherConfig,
  systemRefresherConfig,
  type RefresherTiming,
} from './refresherConfig';
import {
  getScopedDomainState,
  markPendingRequest,
  resetAllScopedDomainStates,
  resetScopedDomainState,
  setScopedDomainState,
} from './store';
import type {
  CatalogSnapshotPayload,
  ClusterNodeSnapshotPayload,
  DomainPayloadMap,
  NamespaceSnapshotPayload,
  NamespaceWorkloadSummary,
  NamespaceWorkloadSnapshotPayload,
  NodeMaintenanceSnapshotPayload,
  PodSnapshotPayload,
  RefreshDomain,
} from './types';
import { containerLogsStreamManager } from './streaming/containerLogsStreamManager';
import { eventStreamManager } from './streaming/eventStreamManager';
import { resourceStreamManager } from './streaming/resourceStreamManager';
import { catalogStreamManager } from './streaming/catalogStreamManager';
import { errorHandler } from '@utils/errorHandler';
import { APP_LOG_SOURCES, logAppLogsInfo, logAppLogsWarn } from '@/core/logging/appLogsClient';
import { getAutoRefreshEnabled, getMetricsRefreshIntervalMs } from '@/core/settings/appPreferences';
import { buildClusterScope, parseClusterScope, parseClusterScopeList } from './clusterScope';

type DomainCategory = 'system' | 'cluster' | 'namespace';

type StreamingRegistration = {
  start: (scope: string) => Promise<(() => void) | void> | (() => void);
  stop?: (scope: string, options?: { reset?: boolean }) => void;
  refreshOnce?: (scope: string) => Promise<void>;
  metricsOnly?: boolean;
  // Pause scheduled polling while streaming is active; resume polling as a fallback when it stops.
  pauseRefresherWhenStreaming?: boolean;
};

type DomainRegistration<K extends RefreshDomain> = {
  domain: K;
  refresherName: RefresherName;
  category: DomainCategory;
  streaming?: StreamingRegistration;
};

type DomainFetchOptions = {
  isManual: boolean;
  signal?: AbortSignal;
  metricsOnly?: boolean;
};

type InFlightRequest = {
  controller: AbortController;
  isManual: boolean;
  requestId: number;
  cleanup?: () => void;
  contextVersion: number;
  domain: RefreshDomain;
  scope?: string;
};

type StreamingFetchMode = 'snapshot' | 'metrics-only' | 'skip';

type StreamingFetchDecisionInput = {
  domain: RefreshDomain;
  scope: string;
  shouldStream: boolean;
  isManual: boolean;
  metricsOnly: boolean;
  streamingHealthy: boolean;
  metricsMinIntervalMs: number;
  now?: number;
};

const makeInFlightKey = (domain: RefreshDomain, scope?: string) => `${domain}::${scope ?? '*'}`;

class ClusterRefreshRuntime {
  readonly inFlight = new Map<string, InFlightRequest>();
  readonly streamingCleanup = new Map<string, () => void>();
  readonly pendingStreaming = new Map<string, Promise<(() => void) | void>>();
  readonly streamingReady = new Map<string, Promise<void>>();
  readonly cancelledStreaming = new Set<string>();
  readonly streamHealth = new Map<string, AppEvents['refresh:resource-stream-health']>();
  readonly blockedStreaming = new Set<string>();
  readonly lastMetricsRefreshAt = new Map<string, number>();
  readonly scopedEnabledState = new Map<RefreshDomain, Map<string, boolean>>();

  constructor(readonly clusterId: string) {}

  isStreamingBlocked(domain: RefreshDomain, scope: string): boolean {
    return this.blockedStreaming.has(makeInFlightKey(domain, scope));
  }

  isStreamingActive(domain: RefreshDomain, scope: string): boolean {
    return this.streamingCleanup.has(makeInFlightKey(domain, scope));
  }

  resolveStreamingFetchMode(input: StreamingFetchDecisionInput): StreamingFetchMode {
    if (input.isManual || !input.shouldStream) {
      return 'snapshot';
    }

    if (!input.metricsOnly) {
      return input.streamingHealthy ? 'skip' : 'snapshot';
    }

    if (!this.isStreamingActive(input.domain, input.scope) || !input.streamingHealthy) {
      return 'snapshot';
    }

    return this.isMetricsRefreshFresh(
      input.domain,
      input.scope,
      input.metricsMinIntervalMs,
      input.now
    )
      ? 'skip'
      : 'metrics-only';
  }

  recordMetricsRefresh(domain: RefreshDomain, scope: string, now = Date.now()): void {
    this.lastMetricsRefreshAt.set(makeInFlightKey(domain, scope), now);
  }

  private isMetricsRefreshFresh(
    domain: RefreshDomain,
    scope: string,
    minIntervalMs: number,
    now = Date.now()
  ): boolean {
    const last = this.lastMetricsRefreshAt.get(makeInFlightKey(domain, scope));
    return last !== undefined && now - last < minIntervalMs;
  }
}

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

const logInfo = (message: string): void => {
  logAppLogsInfo(message, APP_LOG_SOURCES.RefreshOrchestrator);
};

const logWarning = (message: string): void => {
  logAppLogsWarn(message, APP_LOG_SOURCES.RefreshOrchestrator);
};

// Most domains should only keep one enabled scope per cluster runtime. These
// domains have real concurrent consumers, such as browse data plus metadata,
// object-diff left/right panes, or namespace table plus object-panel pod lists.
const MULTI_ACTIVE_SCOPE_DOMAINS = new Set<RefreshDomain>([
  'catalog',
  'catalog-diff',
  'container-logs',
  'object-details',
  'object-events',
  'object-helm-manifest',
  'object-helm-values',
  'object-map',
  'object-yaml',
  'pods',
]);

const shallowEqualRecord = (left: Record<string, unknown>, right: Record<string, unknown>) => {
  if (left === right) {
    return true;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
};

// Reuse cached row objects when incoming rows are unchanged to cut re-render churn.
const mergeListByKey = <T extends object>(
  incoming: T[],
  previous: T[],
  keyFor: (item: T) => string
): T[] => {
  if (incoming.length === 0 || previous.length === 0) {
    return incoming;
  }
  const previousByKey = new Map<string, T>();
  previous.forEach((item) => {
    const key = keyFor(item);
    if (key) {
      previousByKey.set(key, item);
    }
  });
  let reused = false;
  const merged = incoming.map((item) => {
    const key = keyFor(item);
    if (!key) {
      return item;
    }
    const cached = previousByKey.get(key);
    if (
      cached &&
      shallowEqualRecord(cached as Record<string, unknown>, item as Record<string, unknown>)
    ) {
      reused = true;
      return cached;
    }
    return item;
  });
  return reused ? merged : incoming;
};

const mergeWorkloadMetricRows = (
  previous: NamespaceWorkloadSummary[],
  incoming: NamespaceWorkloadSummary[],
  fallbackClusterId: string
): NamespaceWorkloadSummary[] => {
  if (previous.length === 0 || incoming.length === 0) {
    return previous;
  }

  const incomingByKey = new Map(
    incoming.map((workload) => [
      `${workload.clusterId ?? fallbackClusterId}::${workload.namespace}::${workload.kind}::${workload.name}`,
      workload,
    ])
  );

  let changed = false;
  const next = previous.map((existing) => {
    const key = `${existing.clusterId ?? fallbackClusterId}::${existing.namespace}::${existing.kind}::${existing.name}`;
    const candidate = incomingByKey.get(key);
    if (!candidate) {
      return existing;
    }

    if (existing.cpuUsage === candidate.cpuUsage && existing.memUsage === candidate.memUsage) {
      return existing;
    }

    changed = true;
    return {
      ...existing,
      cpuUsage: candidate.cpuUsage,
      memUsage: candidate.memUsage,
    };
  });

  return changed ? next : previous;
};

class RefreshOrchestrator {
  private configs = new Map<RefreshDomain, DomainRegistration<RefreshDomain>>();
  private unsubscriptions = new Map<RefreshDomain, () => void>();
  private registeredRefreshers = new Set<RefresherName>();
  private coordinatorRuntime = new ClusterRefreshRuntime('__coordinator__');
  private clusterRuntimes = new Map<string, ClusterRefreshRuntime>();

  private requestCounter = 0;
  private metricsDemandActive = false;

  private suspendedDomains = new Map<RefreshDomain, boolean>();
  private contextVersion = 0;
  private context: RefreshContext = {
    currentView: 'namespace',
    objectPanel: { isOpen: false },
  };
  private lastNotifiedErrors = new Map<string, string>();
  private suppressNetworkErrorsUntil = 0;

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
    // Emit a single log so operators can confirm streaming config at runtime.
    logInfo('[refresh] resource streaming enabled (mode=active, domains=all)');
  }

  private getErrorNotificationKey(domain: RefreshDomain, scope?: string): string {
    return makeInFlightKey(domain, scope ?? '__global__');
  }

  private notifyRefreshError(
    domain: RefreshDomain,
    scope: string | undefined,
    message: string
  ): void {
    if (this.shouldSuppressNetworkError(message)) {
      return;
    }
    const key = this.getErrorNotificationKey(domain, scope);
    if (this.lastNotifiedErrors.get(key) === message) {
      return;
    }

    const normalizedMessage = message.toLowerCase();
    if (
      domain === 'object-details' &&
      (normalizedMessage.includes('not found') || normalizedMessage.includes('could not find'))
    ) {
      // Suppress toasts for transient not-found errors when panels hold stale objects.
      this.lastNotifiedErrors.set(key, message);
      return;
    }
    if (normalizedMessage.includes('catalog hydration incomplete')) {
      this.lastNotifiedErrors.set(key, message);
      if (process.env.NODE_ENV !== 'production') {
        // Surface in dev tools without triggering user-facing toasts
        console.warn(
          `[Refresh] hydration warning suppressed for ${domain} (${scope ?? 'global'}): ${message}`
        );
      }
      return;
    }

    this.lastNotifiedErrors.set(key, message);
    errorHandler.handle(new Error(message), {
      source: 'refresh-orchestrator',
      domain,
      scope: scope ?? 'global',
      category: this.configs.get(domain)?.category,
    });
  }

  private clearRefreshError(domain: RefreshDomain, scope?: string): void {
    const key = this.getErrorNotificationKey(domain, scope);
    if (this.lastNotifiedErrors.has(key)) {
      this.lastNotifiedErrors.delete(key);
    }
  }

  private suppressNetworkErrors(durationMs: number): void {
    this.suppressNetworkErrorsUntil = Math.max(
      this.suppressNetworkErrorsUntil,
      Date.now() + durationMs
    );
  }

  private shouldSuppressNetworkError(message: string): boolean {
    if (Date.now() > this.suppressNetworkErrorsUntil) {
      return false;
    }
    const normalized = message.toLowerCase();
    return (
      normalized.includes('load failed') ||
      normalized.includes('failed to fetch') ||
      normalized.includes('could not connect to the server') ||
      normalized.includes('snapshot request failed')
    );
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
      this.coordinatorRuntime.scopedEnabledState.set(domain, new Map<string, boolean>());
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
    const readyKey = makeInFlightKey(domain, normalizedScope);
    if (runtime.streamingReady.has(readyKey)) {
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
        runtime.streamingReady.delete(readyKey);
      });

    runtime.streamingReady.set(readyKey, readyTask);
  }

  private hasEnabledScopedSources(domain: RefreshDomain): boolean {
    for (const runtime of this.getAllRuntimes()) {
      const scopedMap = runtime.scopedEnabledState.get(domain);
      if (!scopedMap) {
        continue;
      }
      for (const enabled of scopedMap.values()) {
        if (enabled) {
          return true;
        }
      }
    }
    return false;
  }

  private getEnabledScopes(domain: RefreshDomain): string[] {
    const scopes: string[] = [];
    this.getAllRuntimes().forEach((runtime) => {
      const scopedMap = runtime.scopedEnabledState.get(domain);
      if (!scopedMap) {
        return;
      }
      scopedMap.forEach((enabled, scope) => {
        if (enabled) {
          scopes.push(scope);
        }
      });
    });
    return scopes;
  }

  private getKnownScopes(domain: RefreshDomain): string[] {
    const scopes = new Set<string>();
    this.getAllRuntimes().forEach((runtime) => {
      const scopedMap = runtime.scopedEnabledState.get(domain);
      scopedMap?.forEach((_enabled, scope) => scopes.add(scope));
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
    let scopedMap = runtime.scopedEnabledState.get(domain);
    if (!scopedMap) {
      scopedMap = new Map<string, boolean>();
      runtime.scopedEnabledState.set(domain, scopedMap);
    }

    if (enabled && !MULTI_ACTIVE_SCOPE_DOMAINS.has(domain)) {
      const staleScopes: string[] = [];
      scopedMap.forEach((scopeEnabled, existingScope) => {
        if (!scopeEnabled || existingScope === normalizedScope) {
          return;
        }
        staleScopes.push(existingScope);
      });
      staleScopes.forEach((staleScope) => {
        scopedMap!.set(staleScope, false);
        this.cancelInFlightForScopedDomain(domain, staleScope);
        if (config.streaming) {
          this.getRuntimeForScope(domain, staleScope).streamingReady.delete(
            makeInFlightKey(domain, staleScope)
          );
          this.stopStreamingScope(domain, staleScope, config.streaming, true);
        } else {
          resetScopedDomainState(domain, staleScope);
        }
      });
    }

    const wasActive = this.hasEnabledScopedSources(domain);
    const previous = scopedMap.get(normalizedScope);
    if (previous === enabled) {
      this.updateMetricsDemand();
      return;
    }

    scopedMap.set(normalizedScope, enabled);

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
      const readyKey = makeInFlightKey(domain, normalizedScope);
      const shouldStream = this.shouldStreamScope(domain, normalizedScope);
      if (enabled && shouldStream) {
        runtime.streamingReady.delete(readyKey);
        if (!preserveState) {
          resetScopedDomainState(domain, normalizedScope);
        }
        this.scheduleStreamingStart(domain, normalizedScope, config.streaming);
      } else if (!enabled) {
        runtime.streamingReady.delete(readyKey);
        this.stopStreamingScope(domain, normalizedScope, config.streaming, resetOnDisable);
        this.cancelInFlightForScopedDomain(domain, normalizedScope);
      } else if (!shouldStream) {
        if (
          runtime.streamingCleanup.has(readyKey) ||
          runtime.pendingStreaming.has(readyKey) ||
          runtime.streamingReady.has(readyKey)
        ) {
          runtime.streamingReady.delete(readyKey);
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
    await this.performFetch(domain, clusterScope, { isManual: false });
  }

  isStreamingDomain(domain: RefreshDomain): boolean {
    const config = this.configs.get(domain);
    return Boolean(config?.streaming);
  }

  private isResourceStreamDomain(
    domain: RefreshDomain
  ): domain is
    | 'pods'
    | 'namespace-workloads'
    | 'namespace-config'
    | 'namespace-network'
    | 'namespace-rbac'
    | 'namespace-custom'
    | 'namespace-helm'
    | 'namespace-autoscaling'
    | 'namespace-quotas'
    | 'namespace-storage'
    | 'cluster-rbac'
    | 'cluster-storage'
    | 'cluster-config'
    | 'cluster-crds'
    | 'cluster-custom'
    | 'nodes' {
    return (
      domain === 'pods' ||
      domain === 'namespace-workloads' ||
      domain === 'namespace-config' ||
      domain === 'namespace-network' ||
      domain === 'namespace-rbac' ||
      domain === 'namespace-custom' ||
      domain === 'namespace-helm' ||
      domain === 'namespace-autoscaling' ||
      domain === 'namespace-quotas' ||
      domain === 'namespace-storage' ||
      domain === 'cluster-rbac' ||
      domain === 'cluster-storage' ||
      domain === 'cluster-config' ||
      domain === 'cluster-crds' ||
      domain === 'cluster-custom' ||
      domain === 'nodes'
    );
  }

  private isResourceStreamViewActive(domain: RefreshDomain): boolean {
    if (!this.isResourceStreamDomain(domain)) {
      return true;
    }

    if (domain === 'pods') {
      return (
        this.context.currentView === 'namespace' && this.context.activeNamespaceView === 'pods'
      );
    }

    if (domain === 'namespace-workloads') {
      return (
        this.context.currentView === 'namespace' && this.context.activeNamespaceView === 'workloads'
      );
    }

    if (domain === 'namespace-config') {
      return (
        this.context.currentView === 'namespace' && this.context.activeNamespaceView === 'config'
      );
    }

    if (domain === 'namespace-network') {
      return (
        this.context.currentView === 'namespace' && this.context.activeNamespaceView === 'network'
      );
    }

    if (domain === 'namespace-rbac') {
      return (
        this.context.currentView === 'namespace' && this.context.activeNamespaceView === 'rbac'
      );
    }

    if (domain === 'namespace-custom') {
      return (
        this.context.currentView === 'namespace' && this.context.activeNamespaceView === 'custom'
      );
    }

    if (domain === 'namespace-helm') {
      return (
        this.context.currentView === 'namespace' && this.context.activeNamespaceView === 'helm'
      );
    }

    if (domain === 'namespace-autoscaling') {
      return (
        this.context.currentView === 'namespace' &&
        this.context.activeNamespaceView === 'autoscaling'
      );
    }

    if (domain === 'namespace-quotas') {
      return (
        this.context.currentView === 'namespace' && this.context.activeNamespaceView === 'quotas'
      );
    }

    if (domain === 'namespace-storage') {
      return (
        this.context.currentView === 'namespace' && this.context.activeNamespaceView === 'storage'
      );
    }

    if (domain === 'nodes') {
      return this.context.currentView === 'cluster' && this.context.activeClusterView === 'nodes';
    }

    if (domain === 'cluster-rbac') {
      return this.context.currentView === 'cluster' && this.context.activeClusterView === 'rbac';
    }

    if (domain === 'cluster-storage') {
      return this.context.currentView === 'cluster' && this.context.activeClusterView === 'storage';
    }

    if (domain === 'cluster-config') {
      return this.context.currentView === 'cluster' && this.context.activeClusterView === 'config';
    }

    if (domain === 'cluster-crds') {
      return this.context.currentView === 'cluster' && this.context.activeClusterView === 'crds';
    }

    if (domain === 'cluster-custom') {
      return this.context.currentView === 'cluster' && this.context.activeClusterView === 'custom';
    }

    return true;
  }

  private isStreamingBlocked(domain: RefreshDomain, scope?: string): boolean {
    if (!this.isResourceStreamDomain(domain) || !scope) {
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
    if (this.isResourceStreamDomain(domain)) {
      return resourceStreamManager.isHealthy(domain, scope);
    }
    // SSE-based streaming domains: check the stream manager directly.
    if (domain === 'catalog') {
      return catalogStreamManager.isHealthy();
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
    if (!this.isResourceStreamDomain(domain)) {
      return true;
    }
    if (!this.isResourceStreamViewActive(domain)) {
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
    const keys = new Set<string>();
    runtime.streamingCleanup.forEach((_cleanup, key) => keys.add(key));
    runtime.pendingStreaming.forEach((_promise, key) => keys.add(key));

    keys.forEach((key) => {
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
      runtime.streamingCleanup.clear();
      runtime.pendingStreaming.clear();
      runtime.cancelledStreaming.clear();
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
    const key = makeInFlightKey(domain, scope);
    if (runtime.streamingCleanup.has(key) || runtime.pendingStreaming.has(key)) {
      return Promise.resolve();
    }

    runtime.cancelledStreaming.delete(key);
    const startResult = streaming.start(scope);
    const startPromise = Promise.resolve(startResult);
    runtime.pendingStreaming.set(key, startPromise);

    startPromise
      .then((cleanup) => {
        runtime.pendingStreaming.delete(key);
        if (
          !this.isScopedDomainEnabledInternal(domain, scope) ||
          runtime.cancelledStreaming.has(key)
        ) {
          runtime.cancelledStreaming.delete(key);
          if (typeof cleanup === 'function') {
            try {
              cleanup();
            } catch (error) {
              console.error(`Failed to clean up streaming domain ${domain}::${scope}`, error);
            }
          }
          return;
        }

        if (typeof cleanup === 'function') {
          runtime.streamingCleanup.set(key, cleanup);
        } else {
          runtime.streamingCleanup.set(key, noopStreamingCleanup);
        }
      })
      .catch((error) => {
        runtime.pendingStreaming.delete(key);
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
    const key = makeInFlightKey(domain, scope);
    runtime.cancelledStreaming.add(key);
    runtime.streamingReady.delete(key);

    const pending = runtime.pendingStreaming.get(key);
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
          runtime.pendingStreaming.delete(key);
          runtime.cancelledStreaming.delete(key);
        });
    }

    const cleanup = runtime.streamingCleanup.get(key);
    if (cleanup) {
      try {
        cleanup();
      } catch (error) {
        console.error(`Failed to stop streaming domain ${domain}::${scope}`, error);
      }
      runtime.streamingCleanup.delete(key);
    }
    runtime.streamHealth.delete(key);
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
    if (this.isResourceStreamDomain(domain)) {
      return this.normalizeResourceStreamScope(domain, value, allowEmpty);
    }
    return this.normalizeDefaultScope(value, allowEmpty);
  }

  private normalizeDefaultScope(value?: string | null, allowEmpty = false): string | undefined {
    const clusterId = this.getSelectedClusterId();
    if (!value) {
      if (!allowEmpty) {
        return undefined;
      }
      const clusterScope = buildClusterScope(clusterId, '');
      return clusterScope || undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      if (!allowEmpty) {
        return undefined;
      }
      const clusterScope = buildClusterScope(clusterId, '');
      return clusterScope || undefined;
    }
    const parsed = parseClusterScopeList(trimmed);
    if (parsed.isMultiCluster) {
      throw new Error('Refresh domain scopes must target a single cluster');
    }
    // Preserve explicit cluster-scoped inputs to avoid rewriting historical keys
    // when the selected cluster changes between enable/disable calls.
    if (parsed.clusterIds.length > 0) {
      return buildClusterScope(parsed.clusterIds[0], parsed.scope);
    }
    return buildClusterScope(clusterId, parsed.scope || trimmed) || undefined;
  }

  private normalizeResourceStreamScope(
    domain: RefreshDomain,
    value?: string | null,
    allowEmpty = false
  ): string | undefined {
    if (!value || !value.trim()) {
      if (!allowEmpty) {
        return undefined;
      }
      return buildClusterScope(this.getSelectedClusterId(), '') || undefined;
    }

    const trimmed = value.trim();
    const parsed = parseClusterScopeList(trimmed);
    if (parsed.isMultiCluster) {
      throw new Error(`Resource stream domain "${domain}" requires a single cluster scope`);
    }
    if (parsed.clusterIds.length > 0) {
      return buildClusterScope(parsed.clusterIds[0], parsed.scope);
    }

    return buildClusterScope(this.getSelectedClusterId(), parsed.scope || trimmed) || undefined;
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
    this.forEachRuntime((runtime) => runtime.scopedEnabledState.delete(domain));
  }

  private abortAllInFlight(): void {
    this.forEachRuntime((runtime) => {
      runtime.inFlight.forEach((details, key) => {
        this.teardownInFlight(runtime, key, details);
      });
    });
  }

  private clearAllBlockedStreaming(): void {
    this.forEachRuntime((runtime) => runtime.blockedStreaming.clear());
  }

  private clearAllMetricsRefreshTracking(): void {
    this.forEachRuntime((runtime) => runtime.lastMetricsRefreshAt.clear());
  }

  private clearAllAsyncStreamingBookkeeping(): void {
    this.forEachRuntime((runtime) => {
      runtime.pendingStreaming.clear();
      runtime.cancelledStreaming.clear();
      runtime.streamingReady.clear();
    });
  }

  private clearAllStreamHealth(): void {
    this.forEachRuntime((runtime) => runtime.streamHealth.clear());
  }

  private pruneRemovedClusterRuntimes(connectedClusterIds: string[]): void {
    const connected = new Set(
      connectedClusterIds.map((clusterId) => clusterId.trim()).filter(Boolean)
    );

    Array.from(this.clusterRuntimes.entries()).forEach(([clusterId, runtime]) => {
      if (connected.has(clusterId)) {
        return;
      }

      this.stopRuntimeStreaming(runtime, true);
      runtime.inFlight.forEach((details, key) => {
        this.teardownInFlight(runtime, key, details);
      });
      runtime.scopedEnabledState.forEach((scopedMap, domain) => {
        scopedMap.forEach((_enabled, scope) => resetScopedDomainState(domain, scope));
      });
      runtime.scopedEnabledState.clear();
      runtime.blockedStreaming.clear();
      runtime.lastMetricsRefreshAt.clear();
      runtime.streamHealth.clear();
      runtime.pendingStreaming.clear();
      runtime.cancelledStreaming.clear();
      runtime.streamingReady.clear();
      this.clusterRuntimes.delete(clusterId);
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
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const namespaceScope = trimmed.startsWith('namespace:') ? trimmed : `namespace:${trimmed}`;
    // Prefer the cluster tied to the namespace selection for scoped refreshes.
    const clusterId = this.context.selectedNamespaceClusterId ?? this.context.selectedClusterId;
    return buildClusterScope(clusterId, namespaceScope) || null;
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
    if (config.category === 'system') {
      return systemRefresherConfig(config.refresherName as SystemRefresherName);
    }

    if (config.category === 'cluster') {
      return clusterRefresherConfig(config.refresherName as ClusterRefresherName);
    }

    if (config.category === 'namespace') {
      return namespaceRefresherConfig(config.refresherName as NamespaceRefresherName);
    }

    throw new Error(`Unsupported refresher category: ${config.category}`);
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

    if (
      this.isResourceStreamDomain(domain) &&
      parseClusterScopeList(normalizedScope).isMultiCluster
    ) {
      throw new Error(`Resource stream domain "${domain}" requires a single cluster scope`);
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
          if (
            this.isResourceStreamDomain(domain) &&
            this.isStreamingActive(domain, normalizedScope)
          ) {
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
      if (fetchMode === 'metrics-only') {
        await this.performFetch(domain, normalizedScope, {
          isManual: options.isManual ?? true,
          signal: options.signal,
          metricsOnly: true,
        });
        return;
      }
    }

    await this.performFetch(domain, normalizedScope, {
      isManual: options.isManual ?? true,
      signal: options.signal,
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

    if (!this.isScopedDomainEnabledInternal(domain, normalizedScope)) {
      resetScopedDomainState(domain, normalizedScope);
      return;
    }

    const runtime = this.getRuntimeForScope(domain, normalizedScope);
    const contextVersion = this.contextVersion;
    const inFlightKey = makeInFlightKey(domain, normalizedScope);
    const currentInFlight = runtime.inFlight.get(inFlightKey);

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

    runtime.inFlight.set(inFlightKey, {
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
        ifNoneMatch: previousState.etag,
      });

      if (controller.signal.aborted) {
        return;
      }

      if (contextVersion !== this.contextVersion) {
        return;
      }

      if (notModified || !snapshot) {
        if (!this.isScopedDomainEnabledInternal(domain, normalizedScope)) {
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

      if (metricsOnly) {
        const applied = this.applyMetricsSnapshot(
          domain,
          snapshot,
          etag,
          options.isManual,
          normalizedScope
        );
        if (!applied) {
          this.applySnapshot(domain, snapshot, etag, options.isManual, normalizedScope);
        }
      } else {
        this.applySnapshot(domain, snapshot, etag, options.isManual, normalizedScope);
      }
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
      if (this.shouldSuppressNetworkError(message)) {
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
      const tracked = runtime.inFlight.get(inFlightKey);
      if (tracked && tracked.requestId === requestId) {
        tracked.cleanup?.();
        runtime.inFlight.delete(inFlightKey);
      }

      markPendingRequest(-1);
    }
  }

  private applySnapshot<K extends RefreshDomain>(
    domain: K,
    snapshot: Snapshot<DomainPayloadMap[K]>,
    etag: string | undefined,
    isManual: boolean,
    scope?: string
  ): void {
    const inFlightKey = makeInFlightKey(domain, scope);
    const tracked = this.getRuntimeForScope(domain, scope).inFlight.get(inFlightKey);
    if (tracked && tracked.contextVersion !== this.contextVersion) {
      return;
    }
    const payload = this.mergePollingListPayload(domain, snapshot.payload, scope);
    const resolvedScope = scope ?? snapshot.scope ?? '';

    if (resolvedScope) {
      if (!this.isScopedDomainEnabledInternal(domain, resolvedScope)) {
        return;
      }
      setScopedDomainState(domain, resolvedScope, (prev) => ({
        ...prev,
        status: 'ready',
        data: payload,
        stats: snapshot.stats ?? null,
        version: snapshot.version,
        checksum: snapshot.checksum,
        etag: etag ?? snapshot.checksum ?? prev.etag,
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

  // Incrementally reuse row objects for polling-only list payloads.
  private mergePollingListPayload<K extends RefreshDomain>(
    domain: K,
    payload: DomainPayloadMap[K],
    scope?: string
  ): DomainPayloadMap[K] {
    if (domain === 'namespaces') {
      const previous = getScopedDomainState('namespaces', scope!)
        .data as NamespaceSnapshotPayload | null;
      if (!previous?.namespaces?.length) {
        return payload;
      }
      const incoming = payload as NamespaceSnapshotPayload;
      // incoming.clusterId is now a required field on ClusterMeta-derived
      // payloads, so the merge-key fallback doesn't need a `?? ''` guard.
      const fallbackClusterId = incoming.clusterId;
      const merged = mergeListByKey(
        incoming.namespaces ?? [],
        previous.namespaces ?? [],
        (entry) => `${entry.clusterId ?? fallbackClusterId}::${entry.name}`
      );
      if (merged === incoming.namespaces) {
        return payload;
      }
      return { ...incoming, namespaces: merged } as DomainPayloadMap[K];
    }

    if (domain === 'object-maintenance') {
      if (!scope) {
        return payload;
      }
      const previous = getScopedDomainState('object-maintenance', scope)
        .data as NodeMaintenanceSnapshotPayload | null;
      if (!previous?.drains?.length) {
        return payload;
      }
      const incoming = payload as NodeMaintenanceSnapshotPayload;
      const fallbackClusterId = incoming.clusterId;
      const merged = mergeListByKey(
        incoming.drains ?? [],
        previous.drains ?? [],
        (entry) => `${entry.clusterId ?? fallbackClusterId}::${entry.id}`
      );
      if (merged === incoming.drains) {
        return payload;
      }
      return { ...incoming, drains: merged } as DomainPayloadMap[K];
    }

    if (domain === 'catalog-diff') {
      if (!scope) {
        return payload;
      }
      const previous = getScopedDomainState('catalog-diff', scope)
        .data as CatalogSnapshotPayload | null;
      if (!previous?.items?.length) {
        return payload;
      }
      const incoming = payload as CatalogSnapshotPayload;
      const fallbackClusterId = incoming.clusterId;
      const merged = mergeListByKey(incoming.items ?? [], previous.items ?? [], (entry) => {
        const clusterId = entry.clusterId ?? fallbackClusterId;
        if (entry.uid) {
          return `${clusterId}::${entry.uid}`;
        }
        return `${clusterId}::${entry.group}::${entry.version}::${entry.resource}::${entry.namespace ?? ''}::${entry.name}`;
      });
      if (merged === incoming.items) {
        return payload;
      }
      return { ...incoming, items: merged } as DomainPayloadMap[K];
    }

    return payload;
  }

  private applyMetricsSnapshot<K extends RefreshDomain>(
    domain: K,
    snapshot: Snapshot<DomainPayloadMap[K]>,
    etag: string | undefined,
    isManual: boolean,
    scope?: string
  ): boolean {
    // Metrics-only refreshes update usage fields without replacing stream-driven rows.
    const now = Date.now();
    const resolvedScope = scope ?? snapshot.scope ?? '';
    const parsedScope = parseClusterScope(resolvedScope);
    // parseClusterScope always returns a string clusterId (empty when the
    // scope carries no cluster prefix); no fallback needed.
    const clusterId = parsedScope.clusterId;

    const updateStats = (stats: SnapshotStats | null, count: number): SnapshotStats | null => {
      if (!stats) {
        return null;
      }
      return { ...stats, itemCount: count };
    };

    if (domain === 'pods') {
      if (!scope) {
        return false;
      }
      const previous = getScopedDomainState('pods', scope);
      if (!previous.data) {
        return false;
      }
      const payload = snapshot.payload as PodSnapshotPayload;
      const incomingByKey = new Map(
        payload.pods.map((pod) => [
          `${pod.clusterId ?? clusterId}::${pod.namespace}::${pod.name}`,
          pod,
        ])
      );
      const existingPods = previous.data.pods ?? [];
      const mappedPods = existingPods.map((existing) => {
        const key = `${existing.clusterId ?? clusterId}::${existing.namespace}::${existing.name}`;
        const incoming = incomingByKey.get(key);
        if (!incoming) {
          return existing;
        }
        const nextCpuUsage = incoming.cpuUsage ?? existing.cpuUsage;
        const nextMemUsage = incoming.memUsage ?? existing.memUsage;
        if (nextCpuUsage === existing.cpuUsage && nextMemUsage === existing.memUsage) {
          return existing;
        }
        return {
          ...existing,
          cpuUsage: nextCpuUsage,
          memUsage: nextMemUsage,
        };
      });
      const nextPods = mappedPods.every((pod, index) => pod === existingPods[index])
        ? existingPods
        : mappedPods;
      const nextMetrics = (() => {
        const incomingMetrics = payload.metrics;
        const previousMetrics = previous.data.metrics;
        if (!incomingMetrics) {
          return previousMetrics;
        }
        if (!previousMetrics) {
          return incomingMetrics;
        }
        return incomingMetrics.stale === previousMetrics.stale &&
          incomingMetrics.lastError === previousMetrics.lastError &&
          incomingMetrics.collectedAt === previousMetrics.collectedAt &&
          incomingMetrics.consecutiveFailures === previousMetrics.consecutiveFailures &&
          incomingMetrics.successCount === previousMetrics.successCount &&
          incomingMetrics.failureCount === previousMetrics.failureCount
          ? previousMetrics
          : incomingMetrics;
      })();
      const nextPayload: PodSnapshotPayload =
        nextPods === existingPods && nextMetrics === previous.data.metrics
          ? previous.data
          : {
              ...previous.data,
              pods: nextPods,
              metrics: nextMetrics,
            };
      setScopedDomainState('pods', scope, (prev) => ({
        ...prev,
        status: 'ready',
        data: nextPayload,
        stats: updateStats(prev.stats ?? snapshot.stats ?? null, nextPods.length),
        version: snapshot.version,
        checksum: snapshot.checksum,
        etag: etag ?? snapshot.checksum ?? prev.etag,
        lastUpdated: now,
        lastManualRefresh: isManual ? now : prev.lastManualRefresh,
        lastAutoRefresh: !isManual ? now : prev.lastAutoRefresh,
        error: null,
        isManual,
        scope,
      }));
      this.clearRefreshError(domain, scope);
      return true;
    }

    if (domain === 'namespace-workloads') {
      if (!scope) {
        return false;
      }
      const previous = getScopedDomainState('namespace-workloads', scope);
      if (!previous.data) {
        return false;
      }
      const payload = snapshot.payload as NamespaceWorkloadSnapshotPayload;
      const existingWorkloads = previous.data.workloads ?? [];
      const nextWorkloads = mergeWorkloadMetricRows(
        existingWorkloads,
        payload.workloads ?? [],
        clusterId
      );
      const nextPayload: NamespaceWorkloadSnapshotPayload =
        nextWorkloads === existingWorkloads
          ? previous.data
          : {
              ...previous.data,
              workloads: nextWorkloads,
            };
      setScopedDomainState('namespace-workloads', scope, (prev) => ({
        ...prev,
        status: 'ready',
        data: nextPayload,
        stats: updateStats(prev.stats ?? snapshot.stats ?? null, nextWorkloads.length),
        version: snapshot.version,
        checksum: snapshot.checksum,
        etag: etag ?? snapshot.checksum ?? prev.etag,
        lastUpdated: now,
        lastManualRefresh: isManual ? now : prev.lastManualRefresh,
        lastAutoRefresh: !isManual ? now : prev.lastAutoRefresh,
        error: null,
        isManual,
        scope,
      }));
      this.clearRefreshError(domain, scope || undefined);
      return true;
    }

    if (domain === 'nodes') {
      if (!scope) {
        return false;
      }
      const previous = getScopedDomainState('nodes', scope);
      if (!previous.data) {
        return false;
      }
      const payload = snapshot.payload as ClusterNodeSnapshotPayload;
      const incomingByKey = new Map(
        payload.nodes.map((node) => [`${node.clusterId ?? clusterId}::${node.name}`, node])
      );
      const existingNodes = previous.data.nodes ?? [];
      const nextNodes = existingNodes.map((existing) => {
        const key = `${existing.clusterId ?? clusterId}::${existing.name}`;
        const incoming = incomingByKey.get(key);
        if (!incoming) {
          return existing;
        }
        return {
          ...existing,
          cpuUsage: incoming.cpuUsage ?? existing.cpuUsage,
          memoryUsage: incoming.memoryUsage ?? existing.memoryUsage,
          podMetrics: incoming.podMetrics ?? existing.podMetrics,
        };
      });
      const nextPayload: ClusterNodeSnapshotPayload = {
        ...previous.data,
        nodes: nextNodes,
        metrics: payload.metrics ?? previous.data.metrics,
        metricsByCluster: payload.metricsByCluster ?? previous.data.metricsByCluster,
      };
      setScopedDomainState('nodes', scope, (prev) => ({
        ...prev,
        status: 'ready',
        data: nextPayload,
        stats: updateStats(prev.stats ?? snapshot.stats ?? null, nextNodes.length),
        version: snapshot.version,
        checksum: snapshot.checksum,
        etag: etag ?? snapshot.checksum ?? prev.etag,
        lastUpdated: now,
        lastManualRefresh: isManual ? now : prev.lastManualRefresh,
        lastAutoRefresh: !isManual ? now : prev.lastAutoRefresh,
        error: null,
        isManual,
        scope,
      }));
      this.clearRefreshError(domain, scope || undefined);
      return true;
    }

    return false;
  }

  private isMetricsDemandActive(): boolean {
    if (this.hasEnabledScopedSources('cluster-overview')) {
      return true;
    }
    if (this.hasEnabledScopedSources('nodes')) {
      return true;
    }
    if (this.hasEnabledScopedSources('pods')) {
      return true;
    }
    if (this.hasEnabledScopedSources('namespace-workloads')) {
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
    const scopedMap = this.getRuntimeForScope(domain, scope).scopedEnabledState.get(domain);
    if (!scopedMap) {
      return true;
    }
    const value = scopedMap.get(scope);
    return value ?? true;
  }

  private teardownInFlight(
    runtime: ClusterRefreshRuntime,
    key: string,
    details: { controller: AbortController; cleanup?: () => void; contextVersion: number }
  ): void {
    details.controller.abort();
    details.cleanup?.();
    runtime.inFlight.delete(key);
  }

  private incrementContextVersion(): void {
    this.contextVersion += 1;
  }

  private cancelInFlightForScopedDomain(domain: RefreshDomain, scope: string): void {
    const runtime = this.getRuntimeForScope(domain, scope);
    const key = makeInFlightKey(domain, scope);
    const details = runtime.inFlight.get(key);
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
    const key = makeInFlightKey(domain, scope);
    if (runtime.blockedStreaming.has(key)) {
      return;
    }
    runtime.blockedStreaming.add(key);
    runtime.streamingReady.delete(key);
    runtime.pendingStreaming.delete(key);

    const config = this.configs.get(domain);
    if (config?.streaming) {
      this.stopStreamingScope(domain, scope, config.streaming, false);
    }

    logWarning(
      `[refresh] resource stream drift detected domain=${domain} scope=${scope} reason=${payload.reason}`
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
    this.getRuntimeForScope(domain, scope).streamHealth.set(
      makeInFlightKey(domain, scope),
      payload
    );
  };

  private handleClusterAuthFailed = (payload: { clusterId: string }) => {
    this.authFailedClusters.add(payload.clusterId);
    if (this.authPaused) {
      return;
    }
    // Pause all refresh activity — the refresh subsystem is unavailable while auth is invalid.
    this.authPaused = true;
    logInfo('[refresh] pausing — cluster auth failed');
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
    logInfo('[refresh] resuming — cluster auth recovered');
    this.incrementContextVersion();
    invalidateRefreshBaseURL();
    // Suppress transient errors while the backend refresh subsystem reinitialises.
    this.suppressNetworkErrors(6000);
    this.clearAllBlockedStreaming();
    this.clearAllMetricsRefreshTracking();
    this.clearAllStreamHealth();
    this.lastNotifiedErrors.clear();
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
        const scopedMap = runtime.scopedEnabledState.get(domain);
        if (!scopedMap) {
          return;
        }
        scopedMap.forEach((enabled, scope) => {
          if (!enabled) {
            return;
          }
          const readyKey = makeInFlightKey(domain, scope);
          const shouldStream = this.shouldStreamScope(domain, scope);
          const scopeRuntime = this.getRuntimeForScope(domain, scope);
          const alreadyStreaming =
            scopeRuntime.streamingCleanup.has(readyKey) ||
            scopeRuntime.pendingStreaming.has(readyKey);

          if (shouldStream && !alreadyStreaming) {
            // Context now allows streaming for this scope — start it.
            this.scheduleStreamingStart(domain, scope, config.streaming!);
          } else if (!shouldStream && alreadyStreaming) {
            // Context no longer allows streaming — stop it.
            scopeRuntime.streamingReady.delete(readyKey);
            this.stopStreamingScope(domain, scope, config.streaming!, false);
          }
        });
      });
    });
  }

  private handleKubeconfigChanged = () => {
    this.incrementContextVersion();
    invalidateRefreshBaseURL();
    this.suppressNetworkErrors(6000);
    this.suspendedDomains.clear();
    this.clearAllBlockedStreaming();
    this.clearAllMetricsRefreshTracking();
    this.clearAllStreamHealth();
  };

  private handleKubeconfigSelectionChanged = () => {
    // Backend may rebuild the refresh subsystem; invalidate base URL and suppress transient errors.
    this.incrementContextVersion();
    invalidateRefreshBaseURL();
    this.suppressNetworkErrors(6000);
    this.clearAllBlockedStreaming();
    this.clearAllMetricsRefreshTracking();
    this.clearAllStreamHealth();
  };

  private handleAutoRefreshChanged = () => {
    this.handleStreamingScopeChanges();
  };
}

export const refreshOrchestrator = new RefreshOrchestrator();

// ---------------------------------------------------------------------------
// Domain registrations
// ---------------------------------------------------------------------------

// Helper for the common resource-stream domain pattern. 13 of 26 domains
// follow this exact shape — only domain, refresher, and category differ.
type ResourceStreamDomainName = Parameters<typeof resourceStreamManager.start>[0];
function resourceStreamDomain(
  domain: RefreshDomain & ResourceStreamDomainName,
  refresherName: RefresherName,
  category: DomainCategory,
  options?: { metricsOnly?: boolean }
) {
  refreshOrchestrator.registerDomain({
    domain,
    refresherName,
    category,
    streaming: {
      start: (scope) => resourceStreamManager.start(domain, scope),
      stop: (scope, opts) => resourceStreamManager.stop(domain, scope, opts?.reset ?? false),
      refreshOnce: (scope) => resourceStreamManager.refreshOnce(domain, scope),
      metricsOnly: options?.metricsOnly,
      pauseRefresherWhenStreaming: !options?.metricsOnly,
    },
  });
}

// System domains
refreshOrchestrator.registerDomain({
  domain: 'namespaces',
  refresherName: SYSTEM_REFRESHERS.namespaces,
  category: 'system',
});
refreshOrchestrator.registerDomain({
  domain: 'cluster-overview',
  refresherName: SYSTEM_REFRESHERS.clusterOverview,
  category: 'system',
});
refreshOrchestrator.registerDomain({
  domain: 'object-maintenance',
  refresherName: SYSTEM_REFRESHERS.objectMaintenance,
  category: 'system',
});
refreshOrchestrator.registerDomain({
  domain: 'object-details',
  refresherName: SYSTEM_REFRESHERS.objectDetails,
  category: 'system',
});
refreshOrchestrator.registerDomain({
  domain: 'object-events',
  refresherName: SYSTEM_REFRESHERS.objectEvents,
  category: 'system',
});
refreshOrchestrator.registerDomain({
  domain: 'object-map',
  refresherName: SYSTEM_REFRESHERS.objectMap,
  category: 'system',
});
refreshOrchestrator.registerDomain({
  domain: 'object-yaml',
  refresherName: SYSTEM_REFRESHERS.objectYaml,
  category: 'system',
});
refreshOrchestrator.registerDomain({
  domain: 'object-helm-manifest',
  refresherName: SYSTEM_REFRESHERS.objectHelmManifest,
  category: 'system',
});
refreshOrchestrator.registerDomain({
  domain: 'object-helm-values',
  refresherName: SYSTEM_REFRESHERS.objectHelmValues,
  category: 'system',
});
refreshOrchestrator.registerDomain({
  domain: 'container-logs',
  refresherName: SYSTEM_REFRESHERS.containerLogs,
  category: 'system',
  streaming: {
    start: (scope) => containerLogsStreamManager.startStream(scope),
    stop: (scope, options) => containerLogsStreamManager.stop(scope, options?.reset ?? false),
    refreshOnce: (scope) => containerLogsStreamManager.refreshOnce(scope),
  },
});
resourceStreamDomain('pods', SYSTEM_REFRESHERS.unifiedPods, 'system', { metricsOnly: true });

// Cluster domains
refreshOrchestrator.registerDomain({
  domain: 'catalog',
  refresherName: CLUSTER_REFRESHERS.browse,
  category: 'cluster',
  streaming: {
    start: (scope) => catalogStreamManager.start(scope),
    stop: (_scope, options) => catalogStreamManager.stop(options?.reset ?? false),
    refreshOnce: (scope) => catalogStreamManager.refreshOnce(scope),
    pauseRefresherWhenStreaming: true,
  },
});
refreshOrchestrator.registerDomain({
  domain: 'catalog-diff',
  refresherName: CLUSTER_REFRESHERS.catalogDiff,
  category: 'cluster',
});
refreshOrchestrator.registerDomain({
  domain: 'cluster-events',
  refresherName: CLUSTER_REFRESHERS.events,
  category: 'cluster',
  streaming: {
    start: (scope) => eventStreamManager.startCluster(scope),
    stop: (scope, options) => eventStreamManager.stopCluster(scope, options?.reset ?? false),
    refreshOnce: (scope) => eventStreamManager.refreshCluster(scope),
    pauseRefresherWhenStreaming: true,
  },
});
resourceStreamDomain('nodes', CLUSTER_REFRESHERS.nodes, 'cluster', { metricsOnly: true });
resourceStreamDomain('cluster-rbac', CLUSTER_REFRESHERS.rbac, 'cluster');
resourceStreamDomain('cluster-storage', CLUSTER_REFRESHERS.storage, 'cluster');
resourceStreamDomain('cluster-config', CLUSTER_REFRESHERS.config, 'cluster');
resourceStreamDomain('cluster-crds', CLUSTER_REFRESHERS.crds, 'cluster');
resourceStreamDomain('cluster-custom', CLUSTER_REFRESHERS.custom, 'cluster');

// Namespace domains
refreshOrchestrator.registerDomain({
  domain: 'namespace-events',
  refresherName: NAMESPACE_REFRESHERS.events,
  category: 'namespace',
  streaming: {
    start: (scope) => eventStreamManager.startNamespace(scope),
    stop: (scope, options) => eventStreamManager.stopNamespace(scope, options?.reset ?? false),
    refreshOnce: (scope) => eventStreamManager.refreshNamespace(scope),
    pauseRefresherWhenStreaming: true,
  },
});
resourceStreamDomain('namespace-workloads', NAMESPACE_REFRESHERS.workloads, 'namespace', {
  metricsOnly: true,
});
resourceStreamDomain('namespace-config', NAMESPACE_REFRESHERS.config, 'namespace');
resourceStreamDomain('namespace-network', NAMESPACE_REFRESHERS.network, 'namespace');
resourceStreamDomain('namespace-rbac', NAMESPACE_REFRESHERS.rbac, 'namespace');
resourceStreamDomain('namespace-storage', NAMESPACE_REFRESHERS.storage, 'namespace');
resourceStreamDomain('namespace-autoscaling', NAMESPACE_REFRESHERS.autoscaling, 'namespace');
resourceStreamDomain('namespace-quotas', NAMESPACE_REFRESHERS.quotas, 'namespace');
resourceStreamDomain('namespace-custom', NAMESPACE_REFRESHERS.custom, 'namespace');
resourceStreamDomain('namespace-helm', NAMESPACE_REFRESHERS.helm, 'namespace');
