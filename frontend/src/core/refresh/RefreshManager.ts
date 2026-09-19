/**
 * frontend/src/core/refresh/RefreshManager.ts
 *
 * Manages multiple Refresher instances with context-aware refreshing,
 * cooldown periods, timeout handling, and manual refresh triggers.
 * - Provides subscription mechanism for components to react to refresh events.
 * - Integrates with event bus for app-wide refresh state notifications.
 * - Defines refresher configurations and maps them to application views.
 * - Handles aborting in-progress refreshes on context changes.
 * - Supports pausing and resuming refreshers individually or globally.
 * - Implements exponential backoff for error handling during refreshes.
 * - Exports a singleton instance for use throughout the application.
 */

export interface Refresher {
  name: RefresherName;
  interval: number; // milliseconds
  cooldown: number; // milliseconds
  timeout: number; // seconds
  resource?: string; // optional specific resource
  enabled?: boolean; // optional initial enabled state
}

export interface RefreshContext {
  currentView: ViewType;
  activeNamespaceView?: NamespaceViewType;
  activeClusterView?: ClusterViewType;
  selectedNamespace?: string;
  selectedNamespaceClusterId?: string;
  selectedClusterIds?: string[];
  selectedClusterId?: string;
  selectedClusterName?: string;
  // All open/connected cluster IDs; backgroundRefreshEnabled controls whether inactive tabs do work.
  allConnectedClusterIds?: string[];
  backgroundRefreshEnabled?: boolean;
  // Object panels register their own per-panel refreshers (named by the panel's
  // full identity — see getObjectDetailsRefresherName) and refresh themselves;
  // the context only tracks whether any panel is open.
  objectPanel: {
    isOpen: boolean;
  };
}

export interface RefresherState {
  status: 'idle' | 'refreshing' | 'cooldown' | 'error' | 'paused' | 'disabled';
  lastRefreshTime: Date | null;
  nextRefreshTime: Date | null;
  error: Error | null;
  consecutiveErrors: number;
}

export type RefreshCallback = (isManual: boolean, signal: AbortSignal) => void | Promise<void>;

type RefreshCallbackOutcome = { status: 'fulfilled' } | { status: 'rejected'; error: Error };

const rejectedRefreshCallback = (error: unknown): RefreshCallbackOutcome => ({
  status: 'rejected',
  error: error instanceof Error ? error : new Error(String(error)),
});

interface RefresherInstance {
  config: Refresher;
  runtime: RefresherRuntimeState;
  lastRefreshTime: Date | null;
  nextRefreshTime: Date | null;
  error: Error | null;
  consecutiveErrors: number;
}

import { eventBus } from '@/core/events';
// Import types from navigation
import type { ClusterViewType, NamespaceViewType, ViewType } from '@/types/navigation/views';
import {
  initialRefresherRuntimeState,
  isRefresherEnabled,
  type RefreshExecutionSummary,
  type RefresherRuntimeEvent,
  type RefresherRuntimeState,
  type RefreshInvocation,
  refresherCooldownTimer,
  refresherIntervalTimer,
  transitionRefresherRuntimeState,
} from './refresherRuntimeState';
import {
  clusterViewToRefresher,
  namespaceViewToRefresher,
  type RefresherName,
  SYSTEM_REFRESHERS,
} from './refresherTypes';

const normalizeClusterIds = (ids?: string[]): string[] =>
  (ids ?? []).map((id) => id.trim()).filter(Boolean);

const hasSameClusterSelection = (left?: string[], right?: string[]): boolean => {
  const leftSet = new Set(normalizeClusterIds(left));
  const rightSet = new Set(normalizeClusterIds(right));
  return leftSet.size === rightSet.size && Array.from(leftSet).every((id) => rightSet.has(id));
};

const selectedClusters = (context: RefreshContext): string[] | undefined =>
  context.allConnectedClusterIds ?? context.selectedClusterIds;

const namespaceScopeChanged = (previous: RefreshContext, current: RefreshContext): boolean =>
  previous.selectedNamespace !== current.selectedNamespace ||
  previous.selectedNamespaceClusterId !== current.selectedNamespaceClusterId;

const clusterSelectionChanged = (previous: RefreshContext, current: RefreshContext): boolean =>
  !hasSameClusterSelection(selectedClusters(previous), selectedClusters(current));

const selectedClusterChanged = (previous: RefreshContext, current: RefreshContext): boolean =>
  previous.selectedClusterId !== current.selectedClusterId;

const activeNamespaceRefresher = (context: RefreshContext): RefresherName | null =>
  context.activeNamespaceView ? namespaceViewToRefresher[context.activeNamespaceView] : null;

const activeClusterRefresher = (context: RefreshContext): RefresherName | null =>
  context.activeClusterView ? clusterViewToRefresher[context.activeClusterView] : null;

const namespaceForegroundChanged = (previous: RefreshContext, current: RefreshContext): boolean =>
  current.currentView === 'namespace' && namespaceScopeChanged(previous, current);

const clusterForegroundChanged = (previous: RefreshContext, current: RefreshContext): boolean =>
  current.currentView === 'cluster' &&
  (previous.activeClusterView !== current.activeClusterView ||
    clusterSelectionChanged(previous, current) ||
    selectedClusterChanged(previous, current));

const canStartRefresh = (
  instance: RefresherInstance,
  invocation: RefreshInvocation,
  globallyPaused: boolean
): boolean => {
  if (invocation !== 'automatic') {
    return true;
  }
  return (
    isRefresherEnabled(instance.runtime) &&
    !globallyPaused &&
    instance.runtime.intent.status !== 'paused' &&
    instance.runtime.execution.status !== 'running' &&
    instance.runtime.timing.status !== 'cooldown'
  );
};

class RefreshManager {
  private static instance: RefreshManager;
  private readonly refreshers: Map<RefresherName, RefresherInstance> = new Map();
  private context: RefreshContext;
  private readonly subscribers: Map<RefresherName, Set<RefreshCallback>> = new Map();
  private isGloballyPaused = false;
  private executionCounter = 0;

  private transition(instance: RefresherInstance, event: RefresherRuntimeEvent): void {
    instance.runtime = transitionRefresherRuntimeState(instance.runtime, event);
  }

  private statusFor(instance: RefresherInstance): RefresherState['status'] {
    if (instance.runtime.execution.status === 'running') {
      if (
        instance.runtime.intent.status === 'paused' &&
        instance.runtime.execution.invocation === 'automatic'
      ) {
        return 'paused';
      }
      if (
        instance.runtime.execution.invocation === 'automatic' &&
        instance.runtime.execution.controller.signal.aborted
      ) {
        return instance.runtime.intent.status === 'disabled' ? 'disabled' : 'idle';
      }
      return 'refreshing';
    }
    if (instance.runtime.timing.status === 'cooldown') {
      return 'cooldown';
    }
    if (instance.runtime.intent.status === 'disabled') {
      return 'disabled';
    }
    if (instance.runtime.intent.status === 'paused') {
      return 'paused';
    }
    return 'idle';
  }

  private publicState(
    instance: RefresherInstance,
    status: RefresherState['status'] = this.statusFor(instance)
  ): RefresherState {
    return {
      status,
      lastRefreshTime: instance.lastRefreshTime,
      nextRefreshTime: instance.nextRefreshTime,
      error: instance.error,
      consecutiveErrors: instance.consecutiveErrors,
    };
  }

  private emitStateChange(name: RefresherName, status?: RefresherState['status']): void {
    if (typeof window === 'undefined') {
      return;
    }
    const instance = this.refreshers.get(name);
    if (!instance) {
      return;
    }
    const state = this.publicState(instance, status);
    eventBus.emit('refresh:state-change', { name, state });
  }

  private constructor() {
    // Initialize with default context
    this.context = {
      currentView: 'namespace',
      objectPanel: {
        isOpen: false,
      },
    };

    // Listen for kubeconfig changes to cancel all refreshes
    eventBus.on('kubeconfig:changing', () => {
      this.cancelAllRefreshes();
    });
  }

  public static getInstance(): RefreshManager {
    if (!RefreshManager.instance) {
      RefreshManager.instance = new RefreshManager();
    }
    return RefreshManager.instance;
  }

  /**
   * Register a new refresher
   */
  public register(refresher: Refresher): void {
    let previousInstance: RefresherInstance | undefined;
    let preservedSubscribers: Set<RefreshCallback> | undefined;

    if (this.refreshers.has(refresher.name)) {
      console.warn(`Refresher ${refresher.name} is already registered. Updating configuration.`);
      previousInstance = this.refreshers.get(refresher.name);
      const existingSubscribers = this.subscribers.get(refresher.name);
      if (existingSubscribers && existingSubscribers.size > 0) {
        preservedSubscribers = new Set(existingSubscribers);
      }
      this.unregister(refresher.name);
    }

    if (preservedSubscribers && preservedSubscribers.size > 0) {
      this.subscribers.set(refresher.name, preservedSubscribers);
    }

    const isEnabled =
      refresher.enabled ??
      (previousInstance ? isRefresherEnabled(previousInstance.runtime) : undefined) ??
      true;

    const instance: RefresherInstance = {
      config: refresher,
      runtime: initialRefresherRuntimeState(isEnabled),
      lastRefreshTime: null,
      nextRefreshTime: null,
      error: null,
      consecutiveErrors: 0,
    };

    this.refreshers.set(refresher.name, instance);
    if (isEnabled) {
      this.startRefresher(refresher.name);
    } else {
      this.emitStateChange(refresher.name);
    }

    // Emit event for UI components to track
    eventBus.emit('refresh:registered', { name: refresher.name });
  }

  /**
   * Unregister and cleanup a refresher
   */
  public unregister(name: RefresherName): void {
    const instance = this.refreshers.get(name);
    if (!instance) {
      return;
    }

    // Clear all timers
    this.clearTimers(instance);

    // Remove from maps
    this.refreshers.delete(name);
    this.subscribers.delete(name);
  }

  /**
   * Enable a refresher without re-registering
   */
  public enable(name: RefresherName): void {
    const instance = this.refreshers.get(name);
    if (!instance) {
      return;
    }
    if (isRefresherEnabled(instance.runtime)) {
      if (this.isGloballyPaused) {
        this.transition(instance, { type: 'paused' });
        this.emitStateChange(name);
        return;
      }
      if (instance.runtime.intent.status === 'paused') {
        this.transition(instance, { type: 'enabled' });
      }
      if (refresherIntervalTimer(instance.runtime) === undefined) {
        this.startRefresher(name);
      }
      return;
    }

    this.transition(instance, { type: 'enabled' });
    if (this.isGloballyPaused) {
      this.transition(instance, { type: 'paused' });
      this.emitStateChange(name);
      return;
    }
    this.startRefresher(name);
  }

  /**
   * Disable a refresher without destroying subscribers
   */
  public disable(name: RefresherName): void {
    const instance = this.refreshers.get(name);
    if (!instance) {
      return;
    }

    if (
      instance.runtime.intent.status === 'disabled' &&
      instance.runtime.timing.status === 'idle' &&
      instance.runtime.execution.status === 'idle'
    ) {
      return;
    }

    if (instance.runtime.execution.status === 'running') {
      const execution = instance.runtime.execution;
      execution.controller.abort();
      this.transition(instance, { type: 'refresh-finished', executionId: execution.id });
    }
    this.clearTimers(instance);
    this.transition(instance, { type: 'disabled' });
    instance.nextRefreshTime = null;
    this.emitStateChange(name);
  }

  /**
   * Subscribe to refresh events for a specific refresher
   */
  public subscribe(name: RefresherName, callback: RefreshCallback): () => void {
    let callbacks = this.subscribers.get(name);
    if (!callbacks) {
      callbacks = new Set();
      this.subscribers.set(name, callbacks);
    }
    callbacks.add(callback);

    // Return unsubscribe function
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.subscribers.delete(name);
      }
    };
  }

  /**
   * Update the refresh context
   */
  public updateContext(context: Partial<RefreshContext>): void {
    const previousContext = { ...this.context };
    this.context = { ...this.context, ...context };

    const foregroundTargets = this.getForegroundRefreshTargets(previousContext, this.context);
    // Treat namespace cluster changes as namespace changes so refreshers re-scope correctly.
    const namespaceChanged = namespaceScopeChanged(previousContext, this.context);

    if (foregroundTargets.length > 0) {
      if (namespaceChanged) {
        foregroundTargets.forEach((name) => {
          this.abortRefresher(name);
        });
      } else if (previousContext.currentView !== this.context.currentView) {
        foregroundTargets
          .filter((name) => name.startsWith('namespace-'))
          .forEach((name) => {
            this.abortRefresher(name);
          });
      }

      void this.triggerForegroundRefreshMany(foregroundTargets);
    }
  }

  /**
   * Trigger a manual refresh
   */
  public async triggerManualRefresh(name: RefresherName): Promise<void> {
    await this.refreshSingle(name, 'manual');
  }

  public getRefresherInterval(name: RefresherName): number | null {
    const instance = this.refreshers.get(name);
    return instance ? instance.config.interval : null;
  }

  /**
   * Update a refresher's interval without re-registering or altering subscribers.
   */
  public updateInterval(name: RefresherName, interval: number): void {
    const instance = this.refreshers.get(name);
    if (!instance) {
      return;
    }
    if (!Number.isFinite(interval) || interval <= 0) {
      return;
    }
    const normalizedInterval = Math.floor(interval);
    if (instance.config.interval === normalizedInterval) {
      return;
    }

    instance.config = { ...instance.config, interval: normalizedInterval };

    if (
      !isRefresherEnabled(instance.runtime) ||
      this.isGloballyPaused ||
      instance.runtime.intent.status === 'paused'
    ) {
      return;
    }

    // Reset the cadence without forcing an immediate refresh.
    const intervalTimer = this.replaceInterval(name, instance);
    this.transition(instance, { type: 'interval-replaced', intervalTimer });

    if (this.statusFor(instance) === 'idle') {
      instance.nextRefreshTime = new Date(Date.now() + instance.config.interval);
      this.emitStateChange(name);
    }
  }

  public async triggerManualRefreshMany(names: RefresherName[]): Promise<void> {
    await this.refreshMany(names, 'manual');
  }

  public async triggerForegroundRefreshMany(names: RefresherName[]): Promise<void> {
    await this.refreshMany(names, 'foreground');
  }

  private async refreshMany(names: RefresherName[], invocation: RefreshInvocation): Promise<void> {
    await Promise.allSettled(
      Array.from(new Set(names)).map((name) => this.refreshSingle(name, invocation))
    );
  }

  public async triggerManualRefreshForContext(context?: RefreshContext): Promise<void> {
    const targets = this.getRefresherTargetsForContext(context ?? this.context);
    if (targets.length === 0) {
      return;
    }
    await this.triggerManualRefreshMany(targets);
  }

  /**
   * Cancel all refreshes immediately
   */
  public cancelAllRefreshes(): void {
    this.refreshers.forEach((instance, refresherName) => {
      // Abort any in-progress refresh
      if (instance.runtime.execution.status === 'running') {
        instance.runtime.execution.controller.abort();
      }
      // Clear all timers
      this.clearTimers(instance);
      // Reset state
      if (isRefresherEnabled(instance.runtime)) {
        this.transition(instance, { type: 'idle' });
        if (instance.runtime.execution.status === 'running') {
          this.transition(instance, {
            type: 'refresh-finished',
            executionId: instance.runtime.execution.id,
          });
        }
      } else {
        this.transition(instance, { type: 'disabled' });
      }
      instance.nextRefreshTime = null;
      this.emitStateChange(refresherName);
    });
  }

  /**
   * Pause a refresher or all refreshers
   */
  public pause(name?: RefresherName): void {
    if (name) {
      const instance = this.refreshers.get(name);
      if (instance) {
        this.pauseRefresher(name, instance);
      }
    } else {
      this.isGloballyPaused = true;
      this.refreshers.forEach((instance, refresherName) => {
        this.pauseRefresher(refresherName, instance);
      });
    }
  }

  /**
   * Resume a refresher or all refreshers
   */
  public resume(name?: RefresherName): void {
    if (name) {
      const instance = this.refreshers.get(name);
      if (
        instance &&
        isRefresherEnabled(instance.runtime) &&
        instance.runtime.intent.status === 'paused'
      ) {
        this.resumeRefresher(name, instance);
      }
    } else {
      this.isGloballyPaused = false;
      this.refreshers.forEach((instance, refresherName) => {
        // Resume paused refreshers OR start idle refreshers that don't have timers
        if (isRefresherEnabled(instance.runtime) && instance.runtime.intent.status === 'paused') {
          this.resumeRefresher(refresherName, instance);
        } else if (
          isRefresherEnabled(instance.runtime) &&
          this.statusFor(instance) === 'idle' &&
          refresherIntervalTimer(instance.runtime) === undefined
        ) {
          // Start refreshers that were registered while globally paused
          this.startRefresher(refresherName);
        }
      });
    }
  }

  /**
   * Get the current state of a refresher
   */
  public getState(name: RefresherName): RefresherState | null {
    const instance = this.refreshers.get(name);
    return instance ? this.publicState(instance) : null;
  }

  /**
   * Start a refresher's interval timer
   */
  private startRefresher(name: RefresherName): void {
    const instance = this.refreshers.get(name);
    if (!instance) {
      return;
    }

    if (!isRefresherEnabled(instance.runtime)) {
      instance.nextRefreshTime = null;
      this.emitStateChange(name);
      return;
    }

    if (this.isGloballyPaused) {
      this.transition(instance, { type: 'paused' });
      this.emitStateChange(name);
      return;
    }

    const hasCompletedInitialRun = instance.lastRefreshTime !== null;
    const intervalTimer = this.replaceInterval(name, instance);

    // Update next refresh time
    instance.nextRefreshTime = new Date(Date.now() + instance.config.interval);
    this.transition(instance, { type: 'idle', intervalTimer });
    this.emitStateChange(name);

    if (!hasCompletedInitialRun && instance.runtime.execution.status === 'idle') {
      void this.refreshSingle(name, 'automatic');
    }
  }

  private replaceInterval(
    name: RefresherName,
    instance: RefresherInstance
  ): ReturnType<typeof globalThis.setInterval> {
    const previousInterval = refresherIntervalTimer(instance.runtime);
    if (previousInterval !== undefined) {
      globalThis.clearInterval(previousInterval);
    }
    return globalThis.setInterval(() => {
      if (this.statusFor(instance) === 'idle') {
        this.refreshSingle(name, 'automatic');
      }
    }, instance.config.interval);
  }

  private abortRefresher(name: RefresherName): void {
    const instance = this.refreshers.get(name);
    if (!instance) {
      return;
    }

    if (instance.runtime.execution.status === 'running') {
      const { id, controller } = instance.runtime.execution;
      controller.abort();
      this.transition(instance, { type: 'refresh-finished', executionId: id });
    }
    this.emitStateChange(name);
  }

  private getForegroundRefreshTargets(
    previous: RefreshContext,
    current: RefreshContext
  ): RefresherName[] {
    const targets = new Set<RefresherName>();

    if (namespaceForegroundChanged(previous, current)) {
      const refresher = activeNamespaceRefresher(current);
      if (refresher) {
        targets.add(refresher);
      }
    }

    // A foreground tab switch repaints retained scoped state immediately, then
    // refreshes the visible view so that snapshot is replaced with current data.
    if (clusterForegroundChanged(previous, current)) {
      const refresher = activeClusterRefresher(current);
      if (refresher) {
        targets.add(refresher);
      }
    }

    if (selectedClusterChanged(previous, current) && current.currentView === 'overview') {
      targets.add(SYSTEM_REFRESHERS.clusterOverview);
    }

    return Array.from(targets);
  }

  private getRefresherTargetsForContext(context: RefreshContext): RefresherName[] {
    const targets = new Set<RefresherName>();

    if (context.currentView === 'namespace' && context.activeNamespaceView) {
      const namespaceRefresher = namespaceViewToRefresher[context.activeNamespaceView];
      if (namespaceRefresher) {
        targets.add(namespaceRefresher);
      }
    }

    if (context.currentView === 'cluster' && context.activeClusterView) {
      const clusterRefresher = clusterViewToRefresher[context.activeClusterView];
      if (clusterRefresher) {
        targets.add(clusterRefresher);
      }
    }

    if (context.currentView === 'overview') {
      targets.add(SYSTEM_REFRESHERS.clusterOverview);
    }

    return Array.from(targets);
  }

  /**
   * Perform a single refresh
   */
  private async refreshSingle(name: RefresherName, invocation: RefreshInvocation): Promise<void> {
    const instance = this.refreshers.get(name);
    if (!instance || !canStartRefresh(instance, invocation, this.isGloballyPaused)) {
      return;
    }

    const isManual = invocation === 'manual';
    if (instance.runtime.execution.status === 'running') {
      await this.supersedeRefresh(instance.runtime.execution);
    }

    if (isManual) {
      this.clearTimers(instance);
    }

    const abortController = new AbortController();
    const callbacks = this.subscribers.get(name) || new Set();
    const refreshPromise = this.executeRefresh(
      callbacks,
      isManual,
      abortController.signal,
      instance.config.timeout
    );
    const executionId = ++this.executionCounter;
    this.transition(instance, {
      type: 'refresh-started',
      execution: {
        id: executionId,
        controller: abortController,
        promise: refreshPromise,
        invocation,
      },
    });
    this.emitStateChange(name);
    eventBus.emit('refresh:start', { name, isManual });

    try {
      const summary = await refreshPromise;
      this.completeRefresh(name, instance, executionId, isManual, summary);
    } catch (error) {
      if (this.completeAbortedRefresh(name, instance, executionId, abortController, error)) {
        return;
      }
      this.completeFailedRefresh(name, instance, executionId, isManual, error);
    }
  }

  private async supersedeRefresh(
    execution: Extract<RefresherRuntimeState['execution'], { status: 'running' }>
  ): Promise<void> {
    execution.controller.abort();
    try {
      await execution.promise;
    } catch {
      // Superseded work owns its own error state; the new refresh proceeds.
    }
  }

  private ownsExecution(instance: RefresherInstance, executionId: number): boolean {
    return (
      instance.runtime.execution.status === 'running' &&
      instance.runtime.execution.id === executionId
    );
  }

  private completeRefresh(
    name: RefresherName,
    instance: RefresherInstance,
    executionId: number,
    isManual: boolean,
    summary: RefreshExecutionSummary
  ): void {
    if (!this.ownsExecution(instance, executionId)) {
      return;
    }
    if (summary.failures.length > 0 && summary.successCount === 0) {
      throw summary.failures[0];
    }
    this.transition(instance, { type: 'refresh-finished', executionId });
    instance.lastRefreshTime = new Date();
    instance.error = null;
    instance.consecutiveErrors = 0;
    eventBus.emit('refresh:complete', { name, isManual, success: true });
    this.enterCooldown(name, instance, isManual, false);
  }

  private completeAbortedRefresh(
    name: RefresherName,
    instance: RefresherInstance,
    executionId: number,
    abortController: AbortController,
    error: unknown
  ): boolean {
    const wasAborted =
      abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError');
    if (!wasAborted) {
      return false;
    }
    if (this.ownsExecution(instance, executionId)) {
      this.transition(instance, { type: 'refresh-finished', executionId });
      this.emitStateChange(name);
    }
    return true;
  }

  private completeFailedRefresh(
    name: RefresherName,
    instance: RefresherInstance,
    executionId: number,
    isManual: boolean,
    error: unknown
  ): void {
    const execution = instance.runtime.execution;
    if (execution.status !== 'running' || execution.id !== executionId) {
      return;
    }
    execution.controller.abort();
    this.transition(instance, { type: 'refresh-finished', executionId });
    instance.error = error as Error;
    instance.consecutiveErrors++;
    this.emitStateChange(name, 'error');
    eventBus.emit('refresh:complete', { name, isManual, success: false, error });
    this.enterCooldown(name, instance, isManual, true);
  }

  /**
   * Execute refresh callbacks
   */
  private async executeRefresh(
    callbacks: Set<RefreshCallback>,
    isManual: boolean,
    signal: AbortSignal,
    timeoutSeconds: number
  ): Promise<RefreshExecutionSummary> {
    if (callbacks.size === 0) {
      return { successCount: 0, failures: [] };
    }

    // Isolate callback failures so a single slow subscriber does not fail the entire refresh.
    const promises = Array.from(callbacks).map((callback) =>
      this.runCallbackWithTimeout(callback, isManual, signal, timeoutSeconds)
    );
    const results = await Promise.all(promises);

    if (signal.aborted) {
      throw this.createAbortError();
    }

    const failures: Error[] = [];
    let successCount = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        successCount += 1;
      } else {
        failures.push(result.error);
      }
    }

    return { successCount, failures };
  }

  private async runCallbackWithTimeout(
    callback: RefreshCallback,
    isManual: boolean,
    signal: AbortSignal,
    timeoutSeconds: number
  ): Promise<RefreshCallbackOutcome> {
    if (signal.aborted) {
      return rejectedRefreshCallback(this.createAbortError());
    }

    const controller = new AbortController();
    const handleAbort = () => controller.abort();
    signal.addEventListener('abort', handleAbort, { once: true });

    const timeoutMs = timeoutSeconds * 1000;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    const cleanup = () => {
      if (timeoutId !== undefined) {
        globalThis.clearTimeout(timeoutId);
      }
      signal.removeEventListener('abort', handleAbort);
    };
    const timeoutPromise = new Promise<RefreshCallbackOutcome>((resolve) => {
      timeoutId = globalThis.setTimeout(() => {
        controller.abort();
        signal.removeEventListener('abort', handleAbort);
        resolve(
          rejectedRefreshCallback(new Error(`Refresh timeout after ${timeoutSeconds} seconds`))
        );
      }, timeoutMs);
    });

    let callbackResult: void | Promise<void>;
    try {
      callbackResult = callback(isManual, controller.signal);
    } catch (error) {
      cleanup();
      return rejectedRefreshCallback(error);
    }

    const callbackPromise = Promise.resolve(callbackResult)
      .then(() => ({ status: 'fulfilled' as const }))
      .catch(rejectedRefreshCallback)
      .finally(cleanup);

    return Promise.race([callbackPromise, timeoutPromise]);
  }

  private createAbortError(): Error {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    return error;
  }

  /**
   * Enter cooldown period after refresh
   */
  private enterCooldown(
    name: RefresherName,
    instance: RefresherInstance,
    isManual: boolean,
    hadError: boolean
  ): void {
    // Calculate cooldown with exponential backoff for consecutive errors
    // First error uses base cooldown, subsequent errors double each time, capped at 60s
    const MAX_BACKOFF_MS = 60_000;
    const errorCount = instance.consecutiveErrors;
    const backoffMultiplier = errorCount > 1 ? 2 ** (errorCount - 1) : 1;
    const cooldownMs = Math.min(MAX_BACKOFF_MS, instance.config.cooldown * backoffMultiplier);

    // Set cooldown timer
    const cooldownTimer = globalThis.setTimeout(() => {
      const previous = instance.runtime;
      this.transition(instance, { type: 'cooldown-finished', cooldownTimer });
      if (instance.runtime === previous) {
        return;
      }

      // If manual refresh, restart the interval timer
      if (isManual) {
        this.emitStateChange(name);
        this.startRefresher(name);
      } else {
        // Update next refresh time
        instance.nextRefreshTime = new Date(Date.now() + instance.config.interval);
        this.emitStateChange(name);
        if (hadError) {
          // Retry immediately after cooldown so errors don't stall until the next interval tick.
          void this.refreshSingle(name, 'automatic');
        }
      }
    }, cooldownMs);
    this.transition(instance, { type: 'cooldown-started', cooldownTimer });
    this.emitStateChange(name);
  }

  /**
   * Pause a refresher
   */
  private pauseRefresher(name: RefresherName, instance: RefresherInstance): void {
    if (
      instance.runtime.execution.status === 'running' &&
      instance.runtime.execution.invocation === 'automatic'
    ) {
      instance.runtime.execution.controller.abort();
    }
    this.clearTimers(instance);
    this.transition(instance, { type: 'paused' });
    instance.nextRefreshTime = null;
    this.emitStateChange(name);
  }

  /**
   * Resume a paused refresher
   */
  private resumeRefresher(name: RefresherName, instance: RefresherInstance): void {
    if (!isRefresherEnabled(instance.runtime)) {
      this.emitStateChange(name);
      return;
    }

    this.transition(instance, { type: 'enabled' });
    this.startRefresher(name);
  }

  /**
   * Clear all timers for a refresher
   */
  private clearTimers(instance: RefresherInstance): void {
    const intervalTimer = refresherIntervalTimer(instance.runtime);
    if (intervalTimer !== undefined) {
      globalThis.clearInterval(intervalTimer);
    }
    const cooldownTimer = refresherCooldownTimer(instance.runtime);
    if (cooldownTimer !== undefined) {
      globalThis.clearTimeout(cooldownTimer);
    }
    this.transition(instance, { type: 'idle' });
  }
}

// Export singleton instance
export const refreshManager = RefreshManager.getInstance();
