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
  getDomainState,
  getScopedDomainState,
  incrementDroppedAutoRefresh,
  markPendingRequest,
  resetAllScopedDomainStates,
  resetDomainState,
  resetScopedDomainState,
  setDomainState,
  setScopedDomainState,
} from './store';
import type {
  ClusterNodeSnapshotPayload,
  DomainPayloadMap,
  NamespaceWorkloadSnapshotPayload,
  PodSnapshotPayload,
  RefreshDomain,
} from './types';
import { logStreamManager } from './streaming/logStreamManager';
import { eventStreamManager } from './streaming/eventStreamManager';
import { resourceStreamManager } from './streaming/resourceStreamManager';
import { errorHandler } from '@utils/errorHandler';
import { logAppInfo, logAppWarn } from '@/core/logging/appLogClient';
import { buildClusterScope, buildClusterScopeList, parseClusterScope } from './clusterScope';

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
  scopeResolver?: () => string | undefined;
  autoStart?: boolean;
  scoped?: boolean;
  streaming?: StreamingRegistration;
};

type DomainFetchOptions = {
  isManual: boolean;
  signal?: AbortSignal;
  metricsOnly?: boolean;
};

const DEFAULT_AUTO_START = false;
const CLUSTER_SCOPE = 'cluster';
const noopStreamingCleanup = () => {};
// Keep streaming metrics refreshes aligned with the backend poll cadence.
const STREAMING_METRICS_MIN_INTERVAL_MS = 10_000;

const logInfo = (message: string): void => {
  logAppInfo(message, 'RefreshOrchestrator');
};

const logWarning = (message: string): void => {
  logAppWarn(message, 'RefreshOrchestrator');
};

const makeInFlightKey = (domain: RefreshDomain, scope?: string) => `${domain}::${scope ?? '*'}`;

class RefreshOrchestrator {
  private configs = new Map<RefreshDomain, DomainRegistration<RefreshDomain>>();
  private unsubscriptions = new Map<RefreshDomain, () => void>();
  private registeredRefreshers = new Set<RefresherName>();
  private scopedDomains = new Set<RefreshDomain>();
  private inFlight = new Map<
    string,
    {
      controller: AbortController;
      isManual: boolean;
      requestId: number;
      cleanup?: () => void;
      contextVersion: number;
      domain: RefreshDomain;
      scope?: string;
    }
  >();
  private requestCounter = 0;
  private streamingCleanup = new Map<string, () => void>();
  private pendingStreaming = new Map<string, Promise<(() => void) | void>>();
  private streamingReady = new Map<string, Promise<void>>();
  private cancelledStreaming = new Set<string>();
  private domainStreamingScopes = new Map<RefreshDomain, string>();
  private blockedStreaming = new Set<string>();
  private lastMetricsRefreshAt = new Map<string, number>();
  private domainEnabledState = new Map<RefreshDomain, boolean>();
  private scopedEnabledState = new Map<RefreshDomain, Map<string, boolean>>();
  private domainScopeOverrides = new Map<RefreshDomain, string>();
  private suspendedDomains = new Map<RefreshDomain, boolean>();
  private contextVersion = 0;
  private context: RefreshContext = {
    currentView: 'namespace',
    objectPanel: { isOpen: false },
  };
  private lastNotifiedErrors = new Map<string, string>();
  private suppressNetworkErrorsUntil = 0;

  constructor() {
    eventBus.on('view:reset', this.handleResetViews);
    eventBus.on('kubeconfig:changing', this.handleKubeconfigChanging);
    eventBus.on('kubeconfig:changed', this.handleKubeconfigChanged);
    eventBus.on('kubeconfig:selection-changed', this.handleKubeconfigSelectionChanged);
    eventBus.on('refresh:resource-stream-drift', this.handleResourceStreamDrift);
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
      if (!existing.scoped) {
        const unsubscribe = this.unsubscriptions.get(config.domain);
        unsubscribe?.();
        this.unsubscriptions.delete(config.domain);
      }
    }

    this.configs.set(config.domain, config);
    if (config.scoped) {
      this.scopedDomains.add(config.domain);
      this.domainEnabledState.set(config.domain, true);

      if (allowRefresher) {
        this.ensureRefresher(config);

        const unsubscribe = refreshManager.subscribe(
          config.refresherName,
          async (isManual, signal) => {
            await this.refreshEnabledScopes(config.domain, { isManual, signal });
          }
        );

        this.unsubscriptions.set(config.domain, unsubscribe);

        if ((config.autoStart ?? DEFAULT_AUTO_START) === false) {
          refreshManager.disable(config.refresherName);
        }
      }
      return;
    }

    this.scopedDomains.delete(config.domain);
    this.ensureRefresher(config);
    this.domainEnabledState.set(config.domain, config.autoStart ?? DEFAULT_AUTO_START);

    const unsubscribe = refreshManager.subscribe(config.refresherName, async (isManual, signal) => {
      await this.fetchDomain(config.domain, { isManual, signal });
    });

    this.unsubscriptions.set(config.domain, unsubscribe);

    if ((config.autoStart ?? DEFAULT_AUTO_START) === false) {
      refreshManager.disable(config.refresherName);
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

    if (this.isDomainEnabledInternal('namespaces')) {
      tasks.push(this.triggerManualRefresh('namespaces'));
    }

    const podsRefresh = this.triggerActiveNamespacePodsRefresh(targetContext);
    if (podsRefresh) {
      tasks.push(podsRefresh);
    }

    await Promise.all(tasks);
  }

  async triggerManualRefresh(
    domain: RefreshDomain,
    options?: { suppressSpinner?: boolean }
  ): Promise<void> {
    if (!this.isDomainEnabledInternal(domain)) {
      return;
    }
    const config = this.getConfig(domain);

    if (config.scoped) {
      throw new Error(`Scoped domain "${domain}" requires triggerScopedManualRefresh`);
    }

    if (!options?.suppressSpinner) {
      setDomainState(domain, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'loading',
        error: null,
        isManual: true,
      }));
    }

    await refreshManager.triggerManualRefresh(config.refresherName);
  }

  setDomainEnabled(domain: RefreshDomain, enabled: boolean): void {
    const config = this.getConfig(domain);
    const allowRefresher = this.shouldAllowRefresher(config);

    if (config.scoped) {
      const scopedState = this.scopedEnabledState.get(domain) ?? new Map<string, boolean>();
      scopedState.forEach((_value, scope) => {
        this.setScopedDomainEnabled(domain, scope, enabled);
      });
      this.scopedEnabledState.set(domain, scopedState);
      return;
    }

    const previousEnabled = this.domainEnabledState.get(domain);
    const initialEnabled = previousEnabled ?? config.autoStart ?? DEFAULT_AUTO_START;
    const normalizedScope =
      config.streaming && !config.scoped
        ? this.normalizeStreamingScope(domain, config.scopeResolver?.())
        : undefined;
    const previousScope =
      config.streaming && !config.scoped ? this.domainStreamingScopes.get(domain) : undefined;
    const shouldStream =
      config.streaming && !config.scoped ? this.shouldStreamScope(domain, normalizedScope) : false;

    if (config.streaming && !config.scoped) {
      if (enabled && !normalizedScope) {
        return;
      }
      if (initialEnabled === enabled && previousScope === normalizedScope && shouldStream) {
        return;
      }
    } else if (initialEnabled === enabled) {
      return;
    }

    if (config.category === 'namespace' && enabled && !this.isNamespaceContextActive()) {
      this.domainEnabledState.set(domain, false);
      refreshManager.disable(config.refresherName);
      this.cancelInFlightForDomain(domain);
      resetDomainState(domain);
      return;
    }

    this.domainEnabledState.set(domain, enabled);

    if (config.streaming && !config.scoped) {
      if (!shouldStream) {
        const activeScope = this.domainStreamingScopes.get(domain);
        if (activeScope) {
          this.streamingReady.delete(makeInFlightKey(domain, activeScope));
          this.stopStreamingDomain(domain, activeScope, { reset: false });
        }
        this.domainStreamingScopes.delete(domain);
        if (allowRefresher) {
          if (enabled) {
            refreshManager.enable(config.refresherName);
          } else {
            refreshManager.disable(config.refresherName);
            this.cancelInFlightForDomain(domain);
            resetDomainState(domain);
          }
        } else {
          refreshManager.disable(config.refresherName);
        }
        this.updateRefresherForStreaming(domain);
        return;
      }
      if (enabled) {
        const currentScope = this.domainStreamingScopes.get(domain);
        if (currentScope && currentScope !== normalizedScope) {
          this.streamingReady.delete(makeInFlightKey(domain, currentScope));
          this.stopStreamingDomain(domain, currentScope, { reset: true });
        }
        if (normalizedScope) {
          const readyKey = makeInFlightKey(domain, normalizedScope);
          const hasActiveStream =
            this.streamingCleanup.has(readyKey) || this.pendingStreaming.has(readyKey);
          this.domainStreamingScopes.set(domain, normalizedScope);
          if (!hasActiveStream) {
            this.streamingReady.delete(readyKey);
            resetDomainState(domain);
            this.scheduleStreamingStart(domain, normalizedScope, config.streaming, {
              scoped: false,
            });
          }
        }
      } else {
        const activeScope = this.domainStreamingScopes.get(domain) ?? normalizedScope;
        if (activeScope) {
          this.streamingReady.delete(makeInFlightKey(domain, activeScope));
          this.stopStreamingDomain(domain, activeScope, { reset: true });
        }
        this.domainStreamingScopes.delete(domain);
        resetDomainState(domain);
      }

      if (allowRefresher) {
        if (enabled) {
          refreshManager.enable(config.refresherName);
        } else {
          refreshManager.disable(config.refresherName);
        }
      } else {
        refreshManager.disable(config.refresherName);
      }
      this.updateRefresherForStreaming(domain);
      return;
    }

    if (initialEnabled === enabled) {
      return;
    }

    if (enabled) {
      refreshManager.enable(config.refresherName);
    } else {
      refreshManager.disable(config.refresherName);
      this.cancelInFlightForDomain(domain);
      resetDomainState(domain);
    }
  }

  private scheduleStreamingStart(
    domain: RefreshDomain,
    scope: string,
    streaming: StreamingRegistration,
    options: { scoped: boolean }
  ): void {
    const normalizedScope = scope.trim();
    if (!normalizedScope) {
      return;
    }

    const readyKey = makeInFlightKey(domain, normalizedScope);
    if (this.streamingReady.has(readyKey)) {
      return;
    }

    this.setStreamingLoadingState(domain, normalizedScope, options);

    const readyTask = ensureRefreshBaseURL()
      .then(() => {
        if (options.scoped) {
          if (!this.isScopedDomainEnabledInternal(domain, normalizedScope)) {
            return;
          }
        } else {
          if (!this.isDomainEnabledInternal(domain)) {
            return;
          }
          const activeScope = this.domainStreamingScopes.get(domain);
          if (activeScope !== normalizedScope) {
            return;
          }
        }

        this.startStreamingScope(domain, normalizedScope, streaming);
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : 'Failed to initialise refresh subsystem';
        console.error(`Failed to initialise streaming for ${domain}`, error);
        this.setStreamingErrorState(domain, normalizedScope, message, options);
      })
      .finally(() => {
        this.streamingReady.delete(readyKey);
      });

    this.streamingReady.set(readyKey, readyTask);
  }

  private setStreamingLoadingState(
    domain: RefreshDomain,
    scope: string,
    options: { scoped: boolean }
  ): void {
    if (options.scoped) {
      setScopedDomainState(domain, scope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: null,
        scope,
      }));
      return;
    }

    setDomainState(domain, (previous) => ({
      ...previous,
      status: previous.data ? 'updating' : 'initialising',
      error: null,
      scope,
    }));
  }

  private setStreamingErrorState(
    domain: RefreshDomain,
    scope: string,
    message: string,
    options: { scoped: boolean }
  ): void {
    if (options.scoped) {
      setScopedDomainState(domain, scope, (previous) => ({
        ...previous,
        status: 'error',
        error: message,
        scope,
      }));
    } else {
      setDomainState(domain, (previous) => ({
        ...previous,
        status: 'error',
        error: message,
        scope,
      }));
    }
    const notificationScope = scope?.trim() || undefined;
    this.notifyRefreshError(domain, notificationScope, message);
  }

  private hasEnabledScopedSources(domain: RefreshDomain): boolean {
    const scopedMap = this.scopedEnabledState.get(domain);
    if (!scopedMap) {
      return false;
    }
    for (const enabled of scopedMap.values()) {
      if (enabled) {
        return true;
      }
    }
    return false;
  }

  private getEnabledScopes(domain: RefreshDomain): string[] {
    const scopedMap = this.scopedEnabledState.get(domain);
    if (!scopedMap) {
      return [];
    }
    const scopes: string[] = [];
    scopedMap.forEach((enabled, scope) => {
      if (enabled) {
        scopes.push(scope);
      }
    });
    return scopes;
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
    const config = this.getConfig(domain);
    if (config.scoped) {
      resetAllScopedDomainStates(domain);
      return;
    }
    resetDomainState(domain);
  }

  setDomainScope(domain: RefreshDomain, scope: string | null | undefined): void {
    const normalized = scope?.trim();
    if (!normalized) {
      this.domainScopeOverrides.delete(domain);
      return;
    }
    this.domainScopeOverrides.set(domain, normalized);
  }

  clearDomainScope(domain: RefreshDomain): void {
    this.domainScopeOverrides.delete(domain);
  }

  getDomainScope(domain: RefreshDomain): string | undefined {
    return this.domainScopeOverrides.get(domain);
  }

  setScopedDomainEnabled(domain: RefreshDomain, scope: string, enabled: boolean): void {
    const config = this.getConfig(domain);
    const allowRefresher = this.shouldAllowRefresher(config);
    if (!config.scoped) {
      throw new Error(`Domain "${domain}" is not scoped`);
    }
    const normalizedScope = this.normalizeScope(scope);
    if (!normalizedScope) {
      throw new Error(`Scoped domain "${domain}" requires a non-empty scope value`);
    }

    let scopedMap = this.scopedEnabledState.get(domain);
    if (!scopedMap) {
      scopedMap = new Map<string, boolean>();
      this.scopedEnabledState.set(domain, scopedMap);
    }

    const wasActive = this.hasEnabledScopedSources(domain);
    const previous = scopedMap.get(normalizedScope);
    if (previous === enabled) {
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

    if (config.streaming) {
      const readyKey = makeInFlightKey(domain, normalizedScope);
      const shouldStream = this.shouldStreamScope(domain, normalizedScope);
      if (enabled && shouldStream) {
        this.streamingReady.delete(readyKey);
        resetScopedDomainState(domain, normalizedScope);
        this.scheduleStreamingStart(domain, normalizedScope, config.streaming, { scoped: true });
      } else if (!enabled) {
        this.streamingReady.delete(readyKey);
        this.stopStreamingScope(domain, normalizedScope, config.streaming, true);
        this.cancelInFlightForScopedDomain(domain, normalizedScope);
      } else if (!shouldStream) {
        if (
          this.streamingCleanup.has(readyKey) ||
          this.pendingStreaming.has(readyKey) ||
          this.streamingReady.has(readyKey)
        ) {
          this.streamingReady.delete(readyKey);
          this.stopStreamingScope(domain, normalizedScope, config.streaming, false);
        }
      }
      return;
    }

    if (!enabled) {
      this.cancelInFlightForScopedDomain(domain, normalizedScope);
      resetScopedDomainState(domain, normalizedScope);
    }
  }

  resetScopedDomain(domain: RefreshDomain, scope: string): void {
    const config = this.getConfig(domain);
    if (!config.scoped) {
      throw new Error(`Domain "${domain}" is not scoped`);
    }
    const normalizedScope = this.normalizeScope(scope);
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
    const normalizedScope = this.normalizeScope(scope);
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
    const normalizedScope = this.normalizeScope(scope);
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
    const normalizedScope = this.normalizeScope(scope);
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
    const normalizedScope = this.normalizeScope(scope);
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
    return this.blockedStreaming.has(makeInFlightKey(domain, scope));
  }

  private isStreamingActive(domain: RefreshDomain, scope: string): boolean {
    return this.streamingCleanup.has(makeInFlightKey(domain, scope));
  }

  private shouldStreamScope(domain: RefreshDomain, scope?: string): boolean {
    const trimmed = scope?.trim() ?? '';
    if (!trimmed) {
      return false;
    }
    if (!this.isResourceStreamDomain(domain)) {
      return true;
    }
    if (!this.isResourceStreamViewActive(domain)) {
      return false;
    }
    const parsed = parseClusterScope(trimmed);
    if (!parsed.clusterId || parsed.isMultiCluster) {
      return false;
    }
    if (this.isStreamingBlocked(domain, trimmed)) {
      return false;
    }
    return true;
  }

  private shouldSkipStreamingMetricsRefresh(domain: RefreshDomain, scope?: string): boolean {
    if (!scope) {
      return false;
    }
    const key = makeInFlightKey(domain, scope);
    const last = this.lastMetricsRefreshAt.get(key);
    if (!last) {
      return false;
    }
    return Date.now() - last < STREAMING_METRICS_MIN_INTERVAL_MS;
  }

  private recordStreamingMetricsRefresh(domain: RefreshDomain, scope?: string): void {
    if (!scope) {
      return;
    }
    this.lastMetricsRefreshAt.set(makeInFlightKey(domain, scope), Date.now());
  }

  private hasActiveStreaming(domain: RefreshDomain): boolean {
    const prefix = `${domain}::`;
    for (const key of this.streamingCleanup.keys()) {
      if (key.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  // Pause polling when streaming is active for domains that don't need metrics refreshes.
  private updateRefresherForStreaming(domain: RefreshDomain): void {
    const config = this.configs.get(domain);
    if (!config?.streaming?.pauseRefresherWhenStreaming || config.scoped) {
      return;
    }
    if (!this.isDomainEnabledInternal(domain)) {
      refreshManager.disable(config.refresherName);
      return;
    }
    if (this.hasActiveStreaming(domain)) {
      refreshManager.disable(config.refresherName);
      return;
    }
    refreshManager.enable(config.refresherName);
  }

  private getConfig(domain: RefreshDomain): DomainRegistration<RefreshDomain> {
    const config = this.configs.get(domain);
    if (!config) {
      throw new Error(`Refresh domain "${domain}" is not registered`);
    }
    return config;
  }

  private stopAllStreaming(reset: boolean): void {
    const keys = new Set<string>();
    this.streamingCleanup.forEach((_cleanup, key) => keys.add(key));
    this.pendingStreaming.forEach((_promise, key) => keys.add(key));

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
      if (reset && !config.scoped) {
        this.domainStreamingScopes.delete(domain);
      }
    });

    if (reset) {
      this.streamingCleanup.clear();
      this.pendingStreaming.clear();
      this.cancelledStreaming.clear();
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
    const key = makeInFlightKey(domain, scope);
    if (this.streamingCleanup.has(key) || this.pendingStreaming.has(key)) {
      return Promise.resolve();
    }

    this.cancelledStreaming.delete(key);
    const startResult = streaming.start(scope);
    const startPromise = Promise.resolve(startResult);
    this.pendingStreaming.set(key, startPromise);

    startPromise
      .then((cleanup) => {
        this.pendingStreaming.delete(key);
        if (
          !this.isScopedDomainEnabledInternal(domain, scope) ||
          this.cancelledStreaming.has(key)
        ) {
          this.cancelledStreaming.delete(key);
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
          this.streamingCleanup.set(key, cleanup);
        } else {
          this.streamingCleanup.set(key, noopStreamingCleanup);
        }
        if (!this.scopedDomains.has(domain)) {
          this.domainStreamingScopes.set(domain, scope);
        }
        this.updateRefresherForStreaming(domain);
      })
      .catch((error) => {
        this.pendingStreaming.delete(key);
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to start streaming domain ${domain}::${scope}`, error);
        this.setStreamingErrorState(domain, scope, message, {
          scoped: this.scopedDomains.has(domain),
        });
        this.updateRefresherForStreaming(domain);
      });

    return startPromise.then(() => undefined).catch(() => undefined);
  }

  private stopStreamingScope(
    domain: RefreshDomain,
    scope: string,
    streaming: StreamingRegistration,
    reset: boolean
  ): void {
    const key = makeInFlightKey(domain, scope);
    this.cancelledStreaming.add(key);
    this.streamingReady.delete(key);

    const pending = this.pendingStreaming.get(key);
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
          this.pendingStreaming.delete(key);
          this.cancelledStreaming.delete(key);
        });
    }

    const cleanup = this.streamingCleanup.get(key);
    if (cleanup) {
      try {
        cleanup();
      } catch (error) {
        console.error(`Failed to stop streaming domain ${domain}::${scope}`, error);
      }
      this.streamingCleanup.delete(key);
    }
    streaming.stop?.(scope, { reset });
    if (reset) {
      resetScopedDomainState(domain, scope);
    }
    this.updateRefresherForStreaming(domain);
  }

  private isNamespaceContextActive(context: RefreshContext = this.context): boolean {
    return context.currentView === 'namespace' && Boolean(context.selectedNamespace);
  }

  private disableNamespaceDomains(): void {
    this.configs.forEach((config, domain) => {
      if (config.category !== 'namespace') {
        return;
      }

      if (this.isDomainEnabledInternal(domain)) {
        this.setDomainEnabled(domain, false);
      } else {
        refreshManager.disable(config.refresherName);
      }

      const state = getDomainState(domain);
      if (state.status !== 'idle' || state.data !== null) {
        resetDomainState(domain);
      }
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

  private normalizeScope(value?: string | null, allowEmpty = false): string | undefined {
    const selectedClusterIds = this.getSelectedClusterIds();
    if (!value) {
      if (!allowEmpty) {
        return undefined;
      }
      const clusterScope = buildClusterScopeList(selectedClusterIds, '');
      return clusterScope || undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      if (!allowEmpty) {
        return undefined;
      }
      const clusterScope = buildClusterScopeList(selectedClusterIds, '');
      return clusterScope || undefined;
    }
    return buildClusterScopeList(selectedClusterIds, trimmed);
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
      enabled: config.autoStart ?? DEFAULT_AUTO_START,
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

  private async fetchDomain<K extends RefreshDomain>(
    domain: K,
    options: DomainFetchOptions
  ): Promise<void> {
    const config = this.getConfig(domain);
    if (config.scoped) {
      throw new Error(`Domain "${domain}" is scoped; use fetchScopedDomain`);
    }

    const scope = config.scopeResolver?.();
    if (config.scopeResolver && (!scope || scope.trim() === '')) {
      this.resetDomain(domain);
      return;
    }

    if (config.streaming && !config.scoped) {
      const normalizedScope = this.normalizeStreamingScope(domain, scope);
      const shouldStream = this.shouldStreamScope(domain, normalizedScope);
      const key = makeInFlightKey(domain, normalizedScope);
      const hasStream =
        shouldStream &&
        (this.streamingCleanup.has(key) ||
          this.pendingStreaming.has(key) ||
          (this.domainStreamingScopes.get(domain) === normalizedScope && normalizedScope !== ''));

      if (hasStream) {
        if (options.isManual && config.streaming.refreshOnce && normalizedScope) {
          await config.streaming.refreshOnce(normalizedScope);
        }
        if (!options.isManual && config.streaming.metricsOnly) {
          if (this.shouldSkipStreamingMetricsRefresh(domain, normalizedScope)) {
            incrementDroppedAutoRefresh(domain);
            return;
          }
          await this.performFetch(domain, scope, { ...options, metricsOnly: true }, config);
        }
        return;
      }
    }

    await this.performFetch(domain, scope, options, config);
  }

  async fetchScopedDomain<K extends RefreshDomain>(
    domain: K,
    scope: string,
    options: { signal?: AbortSignal; isManual?: boolean } = {}
  ): Promise<void> {
    const config = this.getConfig(domain);
    if (!config.scoped) {
      throw new Error(`Domain "${domain}" is not registered as scoped`);
    }
    const normalizedScope = this.normalizeScope(scope);
    if (!normalizedScope) {
      throw new Error(`Scoped domain "${domain}" requires a non-empty scope`);
    }

    if (config.streaming) {
      const shouldStream = this.shouldStreamScope(domain, normalizedScope);
      if (shouldStream) {
        if (options.isManual) {
          await this.refreshStreamingDomainOnce(domain, normalizedScope);
          return;
        }
        this.startStreamingScope(domain, normalizedScope, config.streaming);
      }
      if (config.streaming.metricsOnly && !options.isManual) {
        const metricsOnly = shouldStream && this.isStreamingActive(domain, normalizedScope);
        if (metricsOnly && this.shouldSkipStreamingMetricsRefresh(domain, normalizedScope)) {
          return;
        }
        await this.performFetch(
          domain,
          normalizedScope,
          { isManual: options.isManual ?? true, signal: options.signal, metricsOnly },
          config
        );
        return;
      }
      if (shouldStream) {
        return;
      }
    }

    await this.performFetch(
      domain,
      normalizedScope,
      { isManual: options.isManual ?? true, signal: options.signal },
      config
    );
  }

  private async performFetch<K extends RefreshDomain>(
    domain: K,
    scope: string | undefined,
    options: DomainFetchOptions,
    config: DomainRegistration<RefreshDomain>
  ): Promise<void> {
    const isScoped = Boolean(config.scoped);
    const metricsOnly = Boolean(options.metricsOnly);
    // Include the active cluster scope for unscoped domains so tab switches with the same view
    // still fetch the selected cluster data.
    const normalizedScope = this.normalizeScope(scope, !isScoped);

    if (options.signal?.aborted) {
      return;
    }

    if (isScoped && (!normalizedScope || normalizedScope.length === 0)) {
      throw new Error(`Scoped domain "${domain}" requires a valid scope`);
    }

    if (isScoped) {
      if (!this.isScopedDomainEnabledInternal(domain, normalizedScope!)) {
        resetScopedDomainState(domain, normalizedScope!);
        return;
      }
    } else if (!this.isDomainEnabledInternal(domain)) {
      return;
    }

    const contextVersion = this.contextVersion;
    const inFlightKey = makeInFlightKey(domain, normalizedScope);
    const currentInFlight = this.inFlight.get(inFlightKey);

    if (currentInFlight) {
      if (options.isManual && !currentInFlight.isManual) {
        currentInFlight.controller.abort();
        this.teardownInFlight(inFlightKey, currentInFlight);
      } else if (!options.isManual) {
        if (!isScoped) {
          incrementDroppedAutoRefresh(domain);
        }
        return;
      } else if (options.isManual && currentInFlight.isManual) {
        currentInFlight.controller.abort();
        this.teardownInFlight(inFlightKey, currentInFlight);
      }
    }

    const previousState = isScoped
      ? getScopedDomainState(domain, normalizedScope!)
      : getDomainState(domain);
    const nextStatus = previousState.data ? 'updating' : 'loading';

    if (isScoped) {
      setScopedDomainState(domain, normalizedScope!, (prev) => ({
        ...prev,
        status: nextStatus,
        error: null,
        isManual: options.isManual,
        scope: normalizedScope,
      }));
    } else {
      setDomainState(domain, (prev) => ({
        ...prev,
        status: nextStatus,
        error: null,
        isManual: options.isManual,
        scope: normalizedScope ?? prev.scope,
      }));
    }

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

    this.inFlight.set(inFlightKey, {
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
        if (isScoped) {
          if (!this.isScopedDomainEnabledInternal(domain, normalizedScope!)) {
            return;
          }
          setScopedDomainState(domain, normalizedScope!, (prev) => ({
            ...prev,
            status: prev.data ? 'ready' : 'idle',
            isManual: options.isManual,
            lastAutoRefresh: options.isManual ? prev.lastAutoRefresh : Date.now(),
          }));
        } else {
          if (!this.isDomainEnabledInternal(domain)) {
            return;
          }
          setDomainState(domain, (prev) => ({
            ...prev,
            status: prev.data ? 'ready' : 'idle',
            isManual: options.isManual,
            lastAutoRefresh: options.isManual ? prev.lastAutoRefresh : Date.now(),
          }));
        }
        if (metricsOnly && !options.isManual) {
          this.recordStreamingMetricsRefresh(domain, normalizedScope ?? '');
        }
        this.clearRefreshError(domain, isScoped ? normalizedScope : undefined);
        return;
      }

      if (metricsOnly) {
        const applied = this.applyMetricsSnapshot(
          domain,
          snapshot,
          etag,
          options.isManual,
          isScoped ? normalizedScope : undefined
        );
        if (!applied) {
          this.applySnapshot(
            domain,
            snapshot,
            etag,
            options.isManual,
            isScoped ? normalizedScope : undefined
          );
        }
      } else {
        this.applySnapshot(
          domain,
          snapshot,
          etag,
          options.isManual,
          isScoped ? normalizedScope : undefined
        );
      }
      if (metricsOnly && !options.isManual) {
        this.recordStreamingMetricsRefresh(domain, normalizedScope ?? '');
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
        if (isScoped) {
          setScopedDomainState(domain, normalizedScope!, (prev) => ({
            ...prev,
            status: prev.data ? 'ready' : prev.status,
            error: null,
            isManual: options.isManual,
          }));
        } else {
          setDomainState(domain, (prev) => ({
            ...prev,
            status: prev.data ? 'ready' : prev.status,
            error: null,
            isManual: options.isManual,
          }));
        }
        return;
      }

      if (isScoped) {
        setScopedDomainState(domain, normalizedScope!, (prev) => ({
          ...prev,
          status: 'error',
          error: message,
          isManual: options.isManual,
        }));
      } else {
        setDomainState(domain, (prev) => ({
          ...prev,
          status: 'error',
          error: message,
          isManual: options.isManual,
        }));
      }
      this.notifyRefreshError(domain, isScoped ? normalizedScope : undefined, message);
    } finally {
      const tracked = this.inFlight.get(inFlightKey);
      if (tracked && tracked.requestId === requestId) {
        tracked.cleanup?.();
        this.inFlight.delete(inFlightKey);
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
    const tracked = this.inFlight.get(inFlightKey);
    if (tracked && tracked.contextVersion !== this.contextVersion) {
      return;
    }

    if (scope) {
      if (!this.isScopedDomainEnabledInternal(domain, scope)) {
        return;
      }
      setScopedDomainState(domain, scope, (prev) => ({
        ...prev,
        status: 'ready',
        data: snapshot.payload,
        stats: snapshot.stats ?? null,
        version: snapshot.version,
        checksum: snapshot.checksum,
        etag: etag ?? snapshot.checksum ?? prev.etag,
        lastUpdated: Date.now(),
        lastManualRefresh: isManual ? Date.now() : prev.lastManualRefresh,
        lastAutoRefresh: !isManual ? Date.now() : prev.lastAutoRefresh,
        error: null,
        isManual,
        scope,
      }));
      this.clearRefreshError(domain, scope);
      return;
    }

    if (!this.isDomainEnabledInternal(domain)) {
      return;
    }
    setDomainState(domain, (prev) => ({
      ...prev,
      status: 'ready',
      data: snapshot.payload,
      stats: snapshot.stats ?? null,
      version: snapshot.version,
      checksum: snapshot.checksum,
      etag: etag ?? snapshot.checksum ?? prev.etag,
      lastUpdated: Date.now(),
      lastManualRefresh: isManual ? Date.now() : prev.lastManualRefresh,
      lastAutoRefresh: !isManual ? Date.now() : prev.lastAutoRefresh,
      error: null,
      isManual,
      scope: snapshot.scope ?? prev.scope,
    }));
    this.clearRefreshError(domain, snapshot.scope ?? undefined);
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
    const clusterId = parsedScope.clusterId ?? '';

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
      const nextPods = existingPods.map((existing) => {
        const key = `${existing.clusterId ?? clusterId}::${existing.namespace}::${existing.name}`;
        const incoming = incomingByKey.get(key);
        if (!incoming) {
          return existing;
        }
        return {
          ...existing,
          cpuUsage: incoming.cpuUsage ?? existing.cpuUsage,
          memUsage: incoming.memUsage ?? existing.memUsage,
        };
      });
      const nextPayload: PodSnapshotPayload = {
        ...previous.data,
        pods: nextPods,
        metrics: payload.metrics ?? previous.data.metrics,
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
      const previous = getDomainState('namespace-workloads');
      if (!previous.data) {
        return false;
      }
      const payload = snapshot.payload as NamespaceWorkloadSnapshotPayload;
      const incomingByKey = new Map(
        payload.workloads.map((workload) => [
          `${workload.clusterId ?? clusterId}::${workload.namespace}::${workload.kind}::${workload.name}`,
          workload,
        ])
      );
      const existingWorkloads = previous.data.workloads ?? [];
      const nextWorkloads = existingWorkloads.map((existing) => {
        const key = `${existing.clusterId ?? clusterId}::${existing.namespace}::${existing.kind}::${existing.name}`;
        const incoming = incomingByKey.get(key);
        if (!incoming) {
          return existing;
        }
        return {
          ...existing,
          cpuUsage: incoming.cpuUsage,
          memUsage: incoming.memUsage,
        };
      });
      const nextPayload: NamespaceWorkloadSnapshotPayload = {
        ...previous.data,
        workloads: nextWorkloads,
      };
      setDomainState('namespace-workloads', (prev) => ({
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
        scope: resolvedScope || prev.scope,
      }));
      this.clearRefreshError(domain, resolvedScope || undefined);
      return true;
    }

    if (domain === 'nodes') {
      const previous = getDomainState('nodes');
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
      setDomainState('nodes', (prev) => ({
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
        scope: resolvedScope || prev.scope,
      }));
      this.clearRefreshError(domain, resolvedScope || undefined);
      return true;
    }

    return false;
  }

  private isDomainEnabledInternal(domain: RefreshDomain): boolean {
    return this.domainEnabledState.get(domain) ?? DEFAULT_AUTO_START;
  }

  private isScopedDomainEnabledInternal(domain: RefreshDomain, scope: string): boolean {
    const scopedMap = this.scopedEnabledState.get(domain);
    if (!scopedMap) {
      return true;
    }
    const value = scopedMap.get(scope);
    return value ?? true;
  }

  private teardownInFlight(
    key: string,
    details: { controller: AbortController; cleanup?: () => void; contextVersion: number }
  ): void {
    details.controller.abort();
    details.cleanup?.();
    this.inFlight.delete(key);
  }

  private incrementContextVersion(): void {
    this.contextVersion += 1;
  }

  private cancelInFlightForDomain(domain: RefreshDomain): void {
    this.inFlight.forEach((details, key) => {
      if (details.domain === domain) {
        this.teardownInFlight(key, details);
      }
    });
  }

  private cancelInFlightForScopedDomain(domain: RefreshDomain, scope: string): void {
    const key = makeInFlightKey(domain, scope);
    const details = this.inFlight.get(key);
    if (details) {
      this.teardownInFlight(key, details);
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
    const key = makeInFlightKey(domain, scope);
    if (this.blockedStreaming.has(key)) {
      return;
    }
    this.blockedStreaming.add(key);
    this.streamingReady.delete(key);
    this.pendingStreaming.delete(key);

    const config = this.configs.get(domain);
    if (config?.streaming) {
      this.stopStreamingScope(domain, scope, config.streaming, false);
      if (!config.scoped && this.domainStreamingScopes.get(domain) === scope) {
        this.domainStreamingScopes.delete(domain);
      }
    }

    logWarning(
      `[refresh] resource stream drift detected domain=${domain} scope=${scope} reason=${payload.reason}`
    );
  };

  private handleResetViews = () => {
    this.incrementContextVersion();
    invalidateRefreshBaseURL();
    this.stopAllStreaming(true);
    this.inFlight.forEach((details, key) => {
      this.teardownInFlight(key, details);
    });
    this.domainScopeOverrides.clear();
    this.blockedStreaming.clear();
    this.lastMetricsRefreshAt.clear();
    this.configs.forEach((_, domain) => {
      this.resetDomain(domain);
    });
  };

  private handleKubeconfigChanging = () => {
    this.incrementContextVersion();
    invalidateRefreshBaseURL();
    this.stopAllStreaming(true);
    this.inFlight.forEach((details, key) => {
      this.teardownInFlight(key, details);
    });
    this.domainScopeOverrides.clear();
    this.blockedStreaming.clear();
    this.lastMetricsRefreshAt.clear();
    this.configs.forEach((config, domain) => {
      const wasEnabled = this.domainEnabledState.get(domain) ?? true;
      this.suspendedDomains.set(domain, wasEnabled);

      this.setDomainEnabled(domain, false);
      this.resetDomain(domain);

      if (config.scoped) {
        this.scopedEnabledState.delete(domain);
      }
    });
  };

  private handleStreamingScopeChanges(): void {
    this.configs.forEach((config, domain) => {
      if (!config.streaming || config.scoped) {
        return;
      }

      const enabled = this.domainEnabledState.get(domain) ?? config.autoStart ?? DEFAULT_AUTO_START;
      if (!enabled) {
        return;
      }

      const nextScope = this.normalizeStreamingScope(domain, config.scopeResolver?.());
      const currentScope = this.domainStreamingScopes.get(domain);
      const shouldStream = this.shouldStreamScope(domain, nextScope);

      if (nextScope === currentScope) {
        return;
      }

      if (currentScope) {
        this.stopStreamingDomain(domain, currentScope, { reset: true });
        this.domainStreamingScopes.delete(domain);
      }

      if (nextScope) {
        resetDomainState(domain);
        if (shouldStream) {
          this.startStreamingDomain(domain, nextScope);
          this.domainStreamingScopes.set(domain, nextScope);
        } else {
          this.domainStreamingScopes.delete(domain);
        }
      }
    });
  }

  private normalizeStreamingScope(domain: RefreshDomain, rawScope?: string): string {
    if (domain === 'nodes') {
      return buildClusterScopeList(this.getSelectedClusterIds(), '');
    }
    if (
      domain === 'cluster-rbac' ||
      domain === 'cluster-storage' ||
      domain === 'cluster-config' ||
      domain === 'cluster-crds' ||
      domain === 'cluster-custom'
    ) {
      return buildClusterScopeList(this.getSelectedClusterIds(), '');
    }
    if (domain === 'cluster-events') {
      return buildClusterScopeList(this.getSelectedClusterIds(), CLUSTER_SCOPE);
    }
    if (rawScope && rawScope.trim()) {
      if (domain === 'namespace-events') {
        const clusterId = this.context.selectedNamespaceClusterId ?? this.context.selectedClusterId;
        return buildClusterScope(clusterId, rawScope.trim());
      }
      return buildClusterScopeList(this.getSelectedClusterIds(), rawScope.trim());
    }
    return '';
  }

  private handleKubeconfigChanged = () => {
    this.incrementContextVersion();
    invalidateRefreshBaseURL();
    this.suppressNetworkErrors(6000);
    this.suspendedDomains.clear();
    this.blockedStreaming.clear();
    this.lastMetricsRefreshAt.clear();
  };

  private handleKubeconfigSelectionChanged = () => {
    // Backend may rebuild the refresh subsystem; invalidate base URL and suppress transient errors.
    this.incrementContextVersion();
    invalidateRefreshBaseURL();
    this.suppressNetworkErrors(6000);
    this.blockedStreaming.clear();
    this.lastMetricsRefreshAt.clear();
  };
}

export const refreshOrchestrator = new RefreshOrchestrator();

// Dedicated scoped catalog domain for the diff viewer to keep Browse scopes isolated.
refreshOrchestrator.registerDomain({
  domain: 'namespaces',
  refresherName: SYSTEM_REFRESHERS.namespaces,
  category: 'system',
  autoStart: false,
});

refreshOrchestrator.registerDomain({
  domain: 'cluster-overview',
  refresherName: SYSTEM_REFRESHERS.clusterOverview,
  category: 'system',
  scopeResolver: () => {
    // Refresh the overview only for the active tab's cluster to avoid closed-tab errors.
    const clusterId = refreshOrchestrator.getSelectedClusterId();
    return clusterId ? buildClusterScopeList([clusterId], '') : '';
  },
  autoStart: false,
});

refreshOrchestrator.registerDomain({
  domain: 'nodes',
  refresherName: CLUSTER_REFRESHERS.nodes,
  category: 'cluster',
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('nodes', scope),
    stop: (scope, options) => resourceStreamManager.stop('nodes', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('nodes', scope),
    metricsOnly: true,
  },
});

refreshOrchestrator.registerDomain({
  domain: 'node-maintenance',
  refresherName: CLUSTER_REFRESHERS.nodeMaintenance,
  category: 'cluster',
  scoped: true,
  autoStart: false,
});

refreshOrchestrator.registerDomain({
  domain: 'pods',
  refresherName: SYSTEM_REFRESHERS.unifiedPods,
  category: 'system',
  scoped: true,
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('pods', scope),
    stop: (scope, options) => resourceStreamManager.stop('pods', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('pods', scope),
    metricsOnly: true,
  },
});

refreshOrchestrator.registerDomain({
  domain: 'object-details',
  refresherName: SYSTEM_REFRESHERS.objectDetails,
  category: 'system',
  scoped: true,
  autoStart: false,
});

refreshOrchestrator.registerDomain({
  domain: 'object-events',
  refresherName: SYSTEM_REFRESHERS.objectEvents,
  category: 'system',
  scoped: true,
  autoStart: false,
});

refreshOrchestrator.registerDomain({
  domain: 'object-yaml',
  refresherName: SYSTEM_REFRESHERS.objectYaml,
  category: 'system',
  scoped: true,
  autoStart: false,
});

refreshOrchestrator.registerDomain({
  domain: 'object-helm-manifest',
  refresherName: SYSTEM_REFRESHERS.objectHelmManifest,
  category: 'system',
  scoped: true,
  autoStart: false,
});

refreshOrchestrator.registerDomain({
  domain: 'object-helm-values',
  refresherName: SYSTEM_REFRESHERS.objectHelmValues,
  category: 'system',
  scoped: true,
  autoStart: false,
});

refreshOrchestrator.registerDomain({
  domain: 'object-logs',
  refresherName: SYSTEM_REFRESHERS.objectLogs,
  category: 'system',
  scoped: true,
  autoStart: false,
  streaming: {
    start: (scope) => logStreamManager.startStream(scope),
    stop: (scope, options) => logStreamManager.stop(scope, options?.reset ?? false),
    refreshOnce: (scope) => logStreamManager.refreshOnce(scope),
  },
});

refreshOrchestrator.registerDomain({
  domain: 'catalog',
  refresherName: CLUSTER_REFRESHERS.browse,
  category: 'cluster',
  autoStart: false,
  // Browse v2 drives catalog snapshots via explicit scopes + manual refreshes.
  // Avoid using the catalog SSE stream because frequent store updates can trigger
  // nested `useSyncExternalStore` rerenders and trip React's update-depth guard.
  scopeResolver: () => refreshOrchestrator.getDomainScope('catalog') ?? 'limit=200',
});

refreshOrchestrator.registerDomain({
  domain: 'catalog-diff',
  refresherName: CLUSTER_REFRESHERS.catalogDiff,
  category: 'cluster',
  scoped: true,
  autoStart: false,
});

refreshOrchestrator.registerDomain({
  domain: 'cluster-rbac',
  refresherName: CLUSTER_REFRESHERS.rbac,
  category: 'cluster',
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('cluster-rbac', scope),
    stop: (scope, options) =>
      resourceStreamManager.stop('cluster-rbac', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('cluster-rbac', scope),
    // Pause polling while streaming is active to prevent redundant refreshes.
    pauseRefresherWhenStreaming: true,
  },
});

refreshOrchestrator.registerDomain({
  domain: 'cluster-storage',
  refresherName: CLUSTER_REFRESHERS.storage,
  category: 'cluster',
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('cluster-storage', scope),
    stop: (scope, options) =>
      resourceStreamManager.stop('cluster-storage', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('cluster-storage', scope),
    // Pause polling while streaming is active to prevent redundant refreshes.
    pauseRefresherWhenStreaming: true,
  },
});

refreshOrchestrator.registerDomain({
  domain: 'cluster-config',
  refresherName: CLUSTER_REFRESHERS.config,
  category: 'cluster',
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('cluster-config', scope),
    stop: (scope, options) =>
      resourceStreamManager.stop('cluster-config', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('cluster-config', scope),
    // Pause polling while streaming is active to prevent redundant refreshes.
    pauseRefresherWhenStreaming: true,
  },
});

refreshOrchestrator.registerDomain({
  domain: 'cluster-crds',
  refresherName: CLUSTER_REFRESHERS.crds,
  category: 'cluster',
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('cluster-crds', scope),
    stop: (scope, options) =>
      resourceStreamManager.stop('cluster-crds', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('cluster-crds', scope),
    // Pause polling while streaming is active to prevent redundant refreshes.
    pauseRefresherWhenStreaming: true,
  },
});

refreshOrchestrator.registerDomain({
  domain: 'cluster-custom',
  refresherName: CLUSTER_REFRESHERS.custom,
  category: 'cluster',
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('cluster-custom', scope),
    stop: (scope, options) =>
      resourceStreamManager.stop('cluster-custom', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('cluster-custom', scope),
    // Pause polling while streaming is active to prevent redundant refreshes.
    pauseRefresherWhenStreaming: true,
  },
});

refreshOrchestrator.registerDomain({
  domain: 'cluster-events',
  refresherName: CLUSTER_REFRESHERS.events,
  category: 'cluster',
  scopeResolver: () => CLUSTER_SCOPE,
  autoStart: false,
  streaming: {
    start: (scope) => eventStreamManager.startCluster(scope),
    stop: (scope, options) => eventStreamManager.stopCluster(scope, options?.reset ?? false),
    refreshOnce: (scope) => eventStreamManager.refreshCluster(scope),
  },
});

refreshOrchestrator.registerDomain({
  domain: 'namespace-workloads',
  refresherName: NAMESPACE_REFRESHERS.workloads,
  category: 'namespace',
  scopeResolver: () => refreshOrchestrator.getSelectedNamespace(),
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('namespace-workloads', scope),
    stop: (scope, options) =>
      resourceStreamManager.stop('namespace-workloads', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('namespace-workloads', scope),
    metricsOnly: true,
  },
});

refreshOrchestrator.registerDomain({
  domain: 'namespace-config',
  refresherName: NAMESPACE_REFRESHERS.config,
  category: 'namespace',
  scopeResolver: () => refreshOrchestrator.getSelectedNamespace(),
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('namespace-config', scope),
    stop: (scope, options) =>
      resourceStreamManager.stop('namespace-config', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('namespace-config', scope),
  },
});

refreshOrchestrator.registerDomain({
  domain: 'namespace-network',
  refresherName: NAMESPACE_REFRESHERS.network,
  category: 'namespace',
  scopeResolver: () => refreshOrchestrator.getSelectedNamespace(),
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('namespace-network', scope),
    stop: (scope, options) =>
      resourceStreamManager.stop('namespace-network', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('namespace-network', scope),
    pauseRefresherWhenStreaming: true,
  },
});

refreshOrchestrator.registerDomain({
  domain: 'namespace-rbac',
  refresherName: NAMESPACE_REFRESHERS.rbac,
  category: 'namespace',
  scopeResolver: () => refreshOrchestrator.getSelectedNamespace(),
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('namespace-rbac', scope),
    stop: (scope, options) =>
      resourceStreamManager.stop('namespace-rbac', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('namespace-rbac', scope),
  },
});

refreshOrchestrator.registerDomain({
  domain: 'namespace-storage',
  refresherName: NAMESPACE_REFRESHERS.storage,
  category: 'namespace',
  scopeResolver: () => refreshOrchestrator.getSelectedNamespace(),
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('namespace-storage', scope),
    stop: (scope, options) =>
      resourceStreamManager.stop('namespace-storage', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('namespace-storage', scope),
    pauseRefresherWhenStreaming: true,
  },
});

refreshOrchestrator.registerDomain({
  domain: 'namespace-autoscaling',
  refresherName: NAMESPACE_REFRESHERS.autoscaling,
  category: 'namespace',
  scopeResolver: () => refreshOrchestrator.getSelectedNamespace(),
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('namespace-autoscaling', scope),
    stop: (scope, options) =>
      resourceStreamManager.stop('namespace-autoscaling', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('namespace-autoscaling', scope),
    // Pause polling while streaming is healthy to avoid redundant refreshes.
    pauseRefresherWhenStreaming: true,
  },
});

refreshOrchestrator.registerDomain({
  domain: 'namespace-quotas',
  refresherName: NAMESPACE_REFRESHERS.quotas,
  category: 'namespace',
  scopeResolver: () => refreshOrchestrator.getSelectedNamespace(),
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('namespace-quotas', scope),
    stop: (scope, options) =>
      resourceStreamManager.stop('namespace-quotas', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('namespace-quotas', scope),
    pauseRefresherWhenStreaming: true,
  },
});

refreshOrchestrator.registerDomain({
  domain: 'namespace-events',
  refresherName: NAMESPACE_REFRESHERS.events,
  category: 'namespace',
  scopeResolver: () => refreshOrchestrator.getSelectedNamespace(),
  autoStart: false,
  streaming: {
    start: (scope) => eventStreamManager.startNamespace(scope),
    stop: (scope, options) => eventStreamManager.stopNamespace(scope, options?.reset ?? false),
    refreshOnce: (scope) => eventStreamManager.refreshNamespace(scope),
  },
});

refreshOrchestrator.registerDomain({
  domain: 'namespace-custom',
  refresherName: NAMESPACE_REFRESHERS.custom,
  category: 'namespace',
  scopeResolver: () => refreshOrchestrator.getSelectedNamespace(),
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('namespace-custom', scope),
    stop: (scope, options) =>
      resourceStreamManager.stop('namespace-custom', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('namespace-custom', scope),
    // Pause polling while streaming is active to prevent redundant refreshes.
    pauseRefresherWhenStreaming: true,
  },
});

refreshOrchestrator.registerDomain({
  domain: 'namespace-helm',
  refresherName: NAMESPACE_REFRESHERS.helm,
  category: 'namespace',
  scopeResolver: () => refreshOrchestrator.getSelectedNamespace(),
  autoStart: false,
  streaming: {
    start: (scope) => resourceStreamManager.start('namespace-helm', scope),
    stop: (scope, options) =>
      resourceStreamManager.stop('namespace-helm', scope, options?.reset ?? false),
    refreshOnce: (scope) => resourceStreamManager.refreshOnce('namespace-helm', scope),
    // Pause polling while streaming is active to prevent redundant refreshes.
    pauseRefresherWhenStreaming: true,
  },
});
