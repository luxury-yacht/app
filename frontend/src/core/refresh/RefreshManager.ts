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
  objectPanel: {
    isOpen: boolean;
    objectKind?: string;
    objectName?: string;
    objectNamespace?: string;
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

type RefreshCallbackOutcome =
  | { status: 'fulfilled' }
  | { status: 'rejected'; error: Error; timedOut: boolean };

type RefreshExecutionSummary = {
  successCount: number;
  failures: Array<{ error: Error; timedOut: boolean }>;
};

interface RefresherInstance {
  config: Refresher;
  state: RefresherState;
  intervalTimer?: number; // Browser returns number from setInterval
  cooldownTimer?: number; // Browser returns number from setTimeout
  timeoutTimer?: number; // Browser returns number from setTimeout
  refreshPromise?: Promise<RefreshExecutionSummary>;
  abortController?: AbortController;
  isEnabled: boolean;
}

// Import types from navigation
import type {
  ViewType,
  NamespaceViewType as NamespaceViewType,
  ClusterViewType as ClusterViewType,
} from '@/types/navigation/views';
import { eventBus } from '@/core/events';
import {
  SYSTEM_REFRESHERS,
  namespaceViewToRefresher,
  clusterViewToRefresher,
  type RefresherName,
} from './refresherTypes';

class RefreshManager {
  private static instance: RefreshManager;
  private refreshers: Map<RefresherName, RefresherInstance> = new Map();
  private context: RefreshContext;
  private subscribers: Map<RefresherName, Set<RefreshCallback>> = new Map();
  private isGloballyPaused = false;

  private emitStateChange(name: RefresherName): void {
    if (typeof window === 'undefined') {
      return;
    }
    const instance = this.refreshers.get(name);
    if (!instance) {
      return;
    }
    const state: RefresherState = { ...instance.state };
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

    const isEnabled = refresher.enabled ?? previousInstance?.isEnabled ?? true;

    const instance: RefresherInstance = {
      config: refresher,
      state: {
        status: isEnabled ? 'idle' : 'disabled',
        lastRefreshTime: null,
        nextRefreshTime: null,
        error: null,
        consecutiveErrors: 0,
      },
      isEnabled,
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
    if (!instance) return;

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
    if (!instance) return;
    if (instance.isEnabled) {
      if (this.isGloballyPaused) {
        instance.state.status = 'paused';
        this.emitStateChange(name);
        return;
      }
      if (!instance.intervalTimer) {
        this.startRefresher(name);
      }
      return;
    }

    instance.isEnabled = true;
    instance.state.status = 'idle';
    if (this.isGloballyPaused) {
      instance.state.status = 'paused';
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
    if (!instance) return;

    if (!instance.isEnabled && instance.state.status === 'disabled') {
      return;
    }

    instance.isEnabled = false;
    this.clearTimers(instance);
    instance.state.status = 'disabled';
    instance.state.nextRefreshTime = null;
    this.emitStateChange(name);
  }

  /**
   * Subscribe to refresh events for a specific refresher
   */
  public subscribe(name: RefresherName, callback: RefreshCallback): () => void {
    if (!this.subscribers.has(name)) {
      this.subscribers.set(name, new Set());
    }

    const callbacks = this.subscribers.get(name)!;
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

    const manualTargets = this.getManualRefreshTargets(previousContext, this.context);
    // Treat namespace cluster changes as namespace changes so refreshers re-scope correctly.
    const namespaceChanged =
      previousContext.selectedNamespace !== this.context.selectedNamespace ||
      previousContext.selectedNamespaceClusterId !== this.context.selectedNamespaceClusterId;

    if (manualTargets.length > 0) {
      if (namespaceChanged) {
        manualTargets.forEach((name) => this.abortRefresher(name));
      } else if (previousContext.currentView !== this.context.currentView) {
        manualTargets
          .filter((name) => name.startsWith('namespace-'))
          .forEach((name) => this.abortRefresher(name));
      }

      void this.triggerManualRefreshMany(manualTargets);
    }
  }

  /**
   * Trigger a manual refresh
   */
  public async triggerManualRefresh(name: RefresherName): Promise<void> {
    await this.refreshSingle(name, true);
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

    if (!instance.isEnabled || this.isGloballyPaused || instance.state.status === 'paused') {
      return;
    }

    if (instance.intervalTimer) {
      window.clearInterval(instance.intervalTimer);
      instance.intervalTimer = undefined;
    }

    // Reset the cadence without forcing an immediate refresh.
    instance.intervalTimer = window.setInterval(() => {
      if (instance.state.status === 'idle') {
        this.refreshSingle(name, false);
      }
    }, instance.config.interval);

    if (instance.state.status === 'idle') {
      instance.state.nextRefreshTime = new Date(Date.now() + instance.config.interval);
      this.emitStateChange(name);
    }
  }

  public async triggerManualRefreshMany(names: RefresherName[]): Promise<void> {
    const uniqueNames = Array.from(new Set(names));
    await Promise.allSettled(
      uniqueNames.map((refresherName) => this.refreshSingle(refresherName, true))
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
      if (instance.abortController) {
        instance.abortController.abort();
        instance.abortController = undefined;
      }
      // Clear all timers
      this.clearTimers(instance);
      // Reset state
      instance.refreshPromise = undefined;
      instance.state.status = instance.isEnabled ? 'idle' : 'disabled';
      instance.state.nextRefreshTime = null;
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
      this.refreshers.forEach((instance, refresherName) =>
        this.pauseRefresher(refresherName, instance)
      );
    }
  }

  /**
   * Resume a refresher or all refreshers
   */
  public resume(name?: RefresherName): void {
    if (name) {
      const instance = this.refreshers.get(name);
      if (instance && instance.isEnabled && instance.state.status === 'paused') {
        this.resumeRefresher(name, instance);
      }
    } else {
      this.isGloballyPaused = false;
      this.refreshers.forEach((instance, refresherName) => {
        // Resume paused refreshers OR start idle refreshers that don't have timers
        if (instance.isEnabled && instance.state.status === 'paused') {
          this.resumeRefresher(refresherName, instance);
        } else if (
          instance.isEnabled &&
          instance.state.status === 'idle' &&
          !instance.intervalTimer
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
    return instance ? { ...instance.state } : null;
  }

  /**
   * Start a refresher's interval timer
   */
  private startRefresher(name: RefresherName): void {
    const instance = this.refreshers.get(name);
    if (!instance) return;

    if (!instance.isEnabled) {
      instance.state.status = 'disabled';
      instance.state.nextRefreshTime = null;
      this.emitStateChange(name);
      return;
    }

    if (this.isGloballyPaused) {
      instance.state.status = 'paused';
      this.emitStateChange(name);
      return;
    }

    // Clear existing timer if any
    if (instance.intervalTimer) {
      window.clearInterval(instance.intervalTimer);
    }

    const hasCompletedInitialRun = instance.state.lastRefreshTime !== null;

    // Set up the interval
    instance.intervalTimer = window.setInterval(() => {
      if (instance.state.status === 'idle') {
        this.refreshSingle(name, false);
      }
    }, instance.config.interval);

    // Update next refresh time
    instance.state.nextRefreshTime = new Date(Date.now() + instance.config.interval);
    instance.state.status = 'idle';
    this.emitStateChange(name);

    if (!hasCompletedInitialRun && !instance.refreshPromise) {
      void this.refreshSingle(name, false);
    }
  }

  private abortRefresher(name: RefresherName): void {
    const instance = this.refreshers.get(name);
    if (!instance) {
      return;
    }

    if (instance.abortController) {
      instance.abortController.abort();
      instance.abortController = undefined;
    }

    instance.refreshPromise = undefined;
    instance.state.status = 'idle';
    this.emitStateChange(name);
  }

  private getManualRefreshTargets(
    previous: RefreshContext,
    current: RefreshContext
  ): RefresherName[] {
    const targets = new Set<RefresherName>();
    const normalizeClusterIds = (ids?: string[]) =>
      (ids ?? []).map((id) => id.trim()).filter(Boolean);
    const hasSameClusterSelection = (left?: string[], right?: string[]) => {
      const leftSet = new Set(normalizeClusterIds(left));
      const rightSet = new Set(normalizeClusterIds(right));
      if (leftSet.size !== rightSet.size) {
        return false;
      }
      for (const id of leftSet) {
        if (!rightSet.has(id)) {
          return false;
        }
      }
      return true;
    };
    // Switching active clusters should refresh the active view even if the view type is unchanged.
    const clusterChanged = previous.selectedClusterId !== current.selectedClusterId;
    const clusterSelectionChanged = !hasSameClusterSelection(
      previous.selectedClusterIds,
      current.selectedClusterIds
    );

    // Namespace scope changes include the cluster identity tied to the selection.
    const namespaceChanged =
      previous.selectedNamespace !== current.selectedNamespace ||
      previous.selectedNamespaceClusterId !== current.selectedNamespaceClusterId;
    if (namespaceChanged && current.currentView === 'namespace') {
      const namespaceRefresher = current.activeNamespaceView
        ? namespaceViewToRefresher[current.activeNamespaceView]
        : null;
      if (namespaceRefresher) {
        targets.add(namespaceRefresher);
      }
    }

    if (
      previous.activeClusterView !== current.activeClusterView &&
      current.currentView === 'cluster'
    ) {
      const clusterRefresher = current.activeClusterView
        ? clusterViewToRefresher[current.activeClusterView]
        : null;
      if (clusterRefresher) {
        targets.add(clusterRefresher);
      }
    }

    // Avoid forced refreshes on cluster switches when background refresh already covers all tabs.
    const hasMultiClusterScope = (current.selectedClusterIds ?? []).length > 1;

    if (clusterChanged && current.currentView === 'cluster' && !hasMultiClusterScope) {
      const clusterRefresher = current.activeClusterView
        ? clusterViewToRefresher[current.activeClusterView]
        : null;
      if (clusterRefresher) {
        targets.add(clusterRefresher);
      }
    }

    if (clusterSelectionChanged && current.currentView === 'cluster') {
      const clusterRefresher = current.activeClusterView
        ? clusterViewToRefresher[current.activeClusterView]
        : null;
      if (clusterRefresher) {
        targets.add(clusterRefresher);
      }
    }

    if (clusterChanged && current.currentView === 'overview') {
      targets.add(SYSTEM_REFRESHERS.clusterOverview);
    }

    if (this.didObjectPanelTargetChange(previous, current)) {
      this.getObjectPanelRefresherTargets(current).forEach((name) => targets.add(name));
    }

    return Array.from(targets);
  }

  private didObjectPanelTargetChange(previous: RefreshContext, current: RefreshContext): boolean {
    const prevPanel = previous.objectPanel;
    const nextPanel = current.objectPanel;

    if (!prevPanel.isOpen && !nextPanel.isOpen) {
      return false;
    }

    if (prevPanel.isOpen !== nextPanel.isOpen) {
      return true;
    }

    if (!nextPanel.isOpen) {
      return false;
    }

    return (
      prevPanel.objectKind !== nextPanel.objectKind ||
      prevPanel.objectName !== nextPanel.objectName ||
      prevPanel.objectNamespace !== nextPanel.objectNamespace
    );
  }

  private getObjectPanelRefresherTargets(context: RefreshContext): RefresherName[] {
    if (!context.objectPanel.isOpen || !context.objectPanel.objectKind) {
      return [];
    }

    const kind = context.objectPanel.objectKind.toLowerCase();
    return [`object-${kind}` as RefresherName, `object-${kind}-events` as RefresherName];
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

    this.getObjectPanelRefresherTargets(context).forEach((name) => targets.add(name));

    return Array.from(targets);
  }

  /**
   * Perform a single refresh
   */
  private async refreshSingle(name: RefresherName, isManual: boolean): Promise<void> {
    const instance = this.refreshers.get(name);
    if (!instance) return;

    if (!instance.isEnabled && !isManual) {
      return;
    }

    // Don't refresh if globally paused (unless manual refresh)
    if (this.isGloballyPaused && !isManual) return;

    // Don't refresh if individually paused (unless manual refresh)
    if (instance.state.status === 'paused' && !isManual) return;

    // Handle concurrent refresh based on type
    if (instance.state.status === 'refreshing') {
      if (isManual) {
        // Manual can interrupt any refresh
        if (instance.abortController) {
          instance.abortController.abort();
          instance.abortController = undefined;
        }
        // Wait for it to finish aborting
        if (instance.refreshPromise) {
          try {
            await instance.refreshPromise;
          } catch {
            // Ignore abort errors
          }
        }
      } else {
        // Auto-refresh cannot interrupt anything
        return;
      }
    }

    // Don't start auto-refresh if in cooldown
    if (!isManual && instance.state.status === 'cooldown') {
      return;
    }

    // Clear timers if manual refresh
    if (isManual) {
      this.clearTimers(instance);
    }

    // Create new abort controller
    const abortController = new AbortController();
    instance.abortController = abortController;

    // Update state
    instance.state.status = 'refreshing';
    this.emitStateChange(name);

    // Emit refresh start event
    eventBus.emit('refresh:start', { name, isManual });

    // Notify subscribers
    const callbacks = this.subscribers.get(name) || new Set();

    // Perform refresh with abort signal
    const refreshPromise = this.executeRefresh(
      callbacks,
      isManual,
      abortController.signal,
      instance.config.timeout
    );

    // Store the promise for potential cancellation
    instance.refreshPromise = refreshPromise;

    try {
      const { successCount, failures } = await instance.refreshPromise;
      if (failures.length > 0 && successCount === 0) {
        throw failures[0].error;
      }

      // Update state
      instance.state.lastRefreshTime = new Date();
      instance.state.error = null;
      instance.state.consecutiveErrors = 0;

      // Emit refresh complete event
      eventBus.emit('refresh:complete', { name, isManual, success: true });

      // Enter cooldown
      this.enterCooldown(name, instance, isManual, false);
    } catch (error) {
      // Check if this was an intentional abort, not a real error
      const wasAborted =
        abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError');

      if (wasAborted) {
        // Clean up abort controller
        if (instance.abortController) {
          instance.abortController = undefined;
        }
        // Don't treat abort as error - just reset to idle
        instance.state.status = 'idle';
        this.emitStateChange(name);
        return;
      }

      // Abort the underlying refresh to cancel in-flight requests
      if (instance.abortController) {
        instance.abortController.abort();
        instance.abortController = undefined;
      }

      // Handle error
      instance.state.error = error as Error;
      instance.state.consecutiveErrors++;
      instance.state.status = 'error';
      this.emitStateChange(name);

      // Emit refresh complete event with error
      eventBus.emit('refresh:complete', { name, isManual, success: false, error });

      // Refresh failed - error stored in state

      // Still enter cooldown to prevent rapid retries
      this.enterCooldown(name, instance, isManual, true);
    } finally {
      instance.refreshPromise = undefined;
    }
  }

  /**
   * Execute refresh callbacks
   */
  private async executeRefresh(
    callbacks: Set<RefreshCallback>,
    isManual: boolean,
    signal: AbortSignal,
    timeoutSeconds: number
  ): Promise<{ successCount: number; failures: Array<{ error: Error; timedOut: boolean }> }> {
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

    const failures: Array<{ error: Error; timedOut: boolean }> = [];
    let successCount = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        successCount += 1;
      } else {
        failures.push({ error: result.error, timedOut: result.timedOut });
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
      return { status: 'rejected', error: this.createAbortError(), timedOut: false };
    }

    const controller = new AbortController();
    const handleAbort = () => controller.abort();
    signal.addEventListener('abort', handleAbort, { once: true });

    const timeoutMs = timeoutSeconds * 1000;
    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<RefreshCallbackOutcome>((resolve) => {
      timeoutId = window.setTimeout(() => {
        controller.abort();
        signal.removeEventListener('abort', handleAbort);
        resolve({
          status: 'rejected',
          error: new Error(`Refresh timeout after ${timeoutSeconds} seconds`),
          timedOut: true,
        });
      }, timeoutMs);
    });

    let callbackResult: void | Promise<void>;
    try {
      callbackResult = callback(isManual, controller.signal);
    } catch (error) {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      signal.removeEventListener('abort', handleAbort);
      return {
        status: 'rejected',
        error: error instanceof Error ? error : new Error(String(error)),
        timedOut: false,
      };
    }

    const callbackPromise = Promise.resolve(callbackResult)
      .then(() => ({ status: 'fulfilled' as const }))
      .catch((error) => ({
        status: 'rejected' as const,
        error: error instanceof Error ? error : new Error(String(error)),
        timedOut: false,
      }))
      .finally(() => {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
        signal.removeEventListener('abort', handleAbort);
      });

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
    instance.state.status = 'cooldown';
    this.emitStateChange(name);

    // Calculate cooldown with exponential backoff for consecutive errors
    // First error uses base cooldown, subsequent errors double each time, capped at 60s
    const MAX_BACKOFF_MS = 60_000;
    const errorCount = instance.state.consecutiveErrors;
    const backoffMultiplier = errorCount > 1 ? Math.pow(2, errorCount - 1) : 1;
    const cooldownMs = Math.min(MAX_BACKOFF_MS, instance.config.cooldown * backoffMultiplier);

    // Set cooldown timer
    instance.cooldownTimer = window.setTimeout(() => {
      instance.state.status = 'idle';

      // If manual refresh, restart the interval timer
      if (isManual) {
        this.emitStateChange(name);
        this.startRefresher(name);
      } else {
        // Update next refresh time
        instance.state.nextRefreshTime = new Date(Date.now() + instance.config.interval);
        this.emitStateChange(name);
        if (hadError) {
          // Retry immediately after cooldown so errors don't stall until the next interval tick.
          void this.refreshSingle(name, false);
        }
      }
    }, cooldownMs);
  }

  /**
   * Pause a refresher
   */
  private pauseRefresher(name: RefresherName, instance: RefresherInstance): void {
    this.clearTimers(instance);
    instance.state.status = 'paused';
    instance.state.nextRefreshTime = null;
    this.emitStateChange(name);
  }

  /**
   * Resume a paused refresher
   */
  private resumeRefresher(name: RefresherName, instance: RefresherInstance): void {
    if (!instance.isEnabled) {
      instance.state.status = 'disabled';
      this.emitStateChange(name);
      return;
    }

    instance.state.status = 'idle';
    this.startRefresher(name);
  }

  /**
   * Clear all timers for a refresher
   */
  private clearTimers(instance: RefresherInstance): void {
    if (instance.intervalTimer) {
      window.clearInterval(instance.intervalTimer);
      instance.intervalTimer = undefined;
    }
    if (instance.cooldownTimer) {
      window.clearTimeout(instance.cooldownTimer);
      instance.cooldownTimer = undefined;
    }
    if (instance.timeoutTimer) {
      window.clearTimeout(instance.timeoutTimer);
      instance.timeoutTimer = undefined;
    }
  }
}

// Export singleton instance
export const refreshManager = RefreshManager.getInstance();
