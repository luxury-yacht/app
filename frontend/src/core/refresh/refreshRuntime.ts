import type { AppEvents } from '@/core/events';
import type { RefreshDomain } from './types';

export type InFlightRequest = {
  controller: AbortController;
  isManual: boolean;
  requestId: number;
  cleanup?: () => void;
  contextVersion: number;
  domain: RefreshDomain;
  scope?: string;
  // Set when a stream-signal fetch arrived while this request was in flight:
  // the signal proves this response predates the change, so its finally block
  // runs exactly ONE trailing stream-signal fetch. Latching (instead of
  // aborting) keeps busy scopes progressing — signals can arrive faster than
  // a round trip, and abort-and-replace would starve the scope.
  rerunStreamSignal?: boolean;
};

type StreamingFetchMode = 'snapshot' | 'skip';

type StreamingFetchDecisionInput = {
  domain: RefreshDomain;
  scope: string;
  shouldStream: boolean;
  isManual: boolean;
  // A fetch triggered BY a stream signal (doorbell). It must never be skipped
  // for stream health — the signal is the stream announcing changed data.
  streamSignal?: boolean;
  streamingHealthy: boolean;
  /**
   * Whether the scope already holds an applied snapshot. A scope with no data yet
   * (a brand-new filter/page/scope) must fetch its first page regardless of stream
   * health: the notify-only stream carries change signals, not the new query's
   * initial snapshot. Skipping is only safe once the scope has data the stream keeps
   * fresh.
   */
  hasData: boolean;
};

export const makeInFlightKey = (domain: RefreshDomain, scope?: string) =>
  `${domain}::${scope ?? '*'}`;

export type RuntimeScopeStateChange = {
  previous: boolean | undefined;
  changed: boolean;
};

export type RuntimeScopeEnableResult = RuntimeScopeStateChange & {
  staleScopes: string[];
};

// Most domains should only keep one enabled scope per cluster runtime. Domains
// listed here have real concurrent consumers, such as browse data plus
// metadata, object-diff panes, or namespace table plus object-panel pod lists.
const MULTI_ACTIVE_SCOPE_DOMAINS = new Set<RefreshDomain>([
  'catalog',
  'catalog-diff',
  'cluster-config',
  'cluster-crds',
  'cluster-events',
  'cluster-rbac',
  'cluster-storage',
  'container-logs',
  'namespace-autoscaling',
  'namespace-config',
  'namespace-events',
  'namespace-helm',
  'namespace-network',
  'namespace-quotas',
  'namespace-rbac',
  'namespace-storage',
  'namespace-workloads',
  'nodes',
  'object-details',
  'object-events',
  'object-helm-manifest',
  'object-helm-values',
  'object-maintenance',
  'object-map',
  'object-yaml',
  'pods',
]);

export class ClusterRefreshRuntime {
  readonly clusterId: string;
  private readonly inFlight = new Map<string, InFlightRequest>();
  private readonly streamingCleanup = new Map<string, () => void>();
  private readonly pendingStreaming = new Map<string, Promise<(() => void) | undefined>>();
  private readonly streamingReady = new Map<string, Promise<void>>();
  private readonly cancelledStreaming = new Set<string>();
  private readonly streamHealth = new Map<string, AppEvents['refresh:resource-stream-health']>();
  private readonly blockedStreaming = new Set<string>();
  private readonly scopedEnabledState = new Map<RefreshDomain, Map<string, boolean>>();
  // Reference counts of mounted lifecycle consumers that need a (domain, scope)
  // enabled. Leases let a newer consumer keep a scope alive across an old
  // consumer's unmount so a late cleanup cannot disable a scope a newer owner
  // still needs (the remount race behind transient false-empty tables).
  private readonly scopedLeases = new Map<RefreshDomain, Map<string, number>>();

  constructor(clusterId: string) {
    this.clusterId = clusterId;
  }

  markDomainKnown(domain: RefreshDomain): void {
    if (!this.scopedEnabledState.has(domain)) {
      this.scopedEnabledState.set(domain, new Map<string, boolean>());
    }
  }

  deleteDomain(domain: RefreshDomain): void {
    this.scopedEnabledState.delete(domain);
    this.scopedLeases.delete(domain);
  }

  getKnownScopes(domain: RefreshDomain): string[] {
    const scopedMap = this.scopedEnabledState.get(domain);
    if (!scopedMap) {
      return [];
    }
    return Array.from(scopedMap.keys());
  }

  getEnabledScopes(domain: RefreshDomain): string[] {
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

  hasEnabledScopedSources(domain: RefreshDomain): boolean {
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

  isScopedDomainEnabled(domain: RefreshDomain, scope: string): boolean {
    const scopedMap = this.scopedEnabledState.get(domain);
    if (!scopedMap) {
      return true;
    }
    return scopedMap.get(scope) ?? true;
  }

  setScopedDomainEnabled(
    domain: RefreshDomain,
    scope: string,
    enabled: boolean
  ): RuntimeScopeStateChange {
    const scopedMap = this.scopedEnabledState.get(domain) ?? new Map<string, boolean>();
    this.scopedEnabledState.set(domain, scopedMap);
    const previous = scopedMap.get(scope);
    if (previous === enabled) {
      return { previous, changed: false };
    }
    scopedMap.set(scope, enabled);
    return { previous, changed: true };
  }

  applyScopedDomainEnabled(
    domain: RefreshDomain,
    scope: string,
    enabled: boolean
  ): RuntimeScopeEnableResult {
    const staleScopes =
      enabled && !MULTI_ACTIVE_SCOPE_DOMAINS.has(domain)
        ? this.disableOtherEnabledScopes(domain, scope)
        : [];
    const change = this.setScopedDomainEnabled(domain, scope, enabled);
    return { ...change, staleScopes };
  }

  private disableOtherEnabledScopes(domain: RefreshDomain, activeScope: string): string[] {
    const scopedMap = this.scopedEnabledState.get(domain);
    if (!scopedMap) {
      return [];
    }
    const staleScopes: string[] = [];
    scopedMap.forEach((enabled, scope) => {
      if (enabled && scope !== activeScope) {
        staleScopes.push(scope);
      }
    });
    staleScopes.forEach((scope) => {
      scopedMap.set(scope, false);
    });
    return staleScopes;
  }

  getScopedLeaseCount(domain: RefreshDomain, scope: string): number {
    return this.scopedLeases.get(domain)?.get(scope) ?? 0;
  }

  hasScopedLease(domain: RefreshDomain, scope: string): boolean {
    return this.getScopedLeaseCount(domain, scope) > 0;
  }

  // Add one lease holder for (domain, scope). `firstLease` is true when this is
  // the only holder, signalling the caller to actually enable the scope.
  acquireScopedLease(domain: RefreshDomain, scope: string): { count: number; firstLease: boolean } {
    const leaseMap = this.scopedLeases.get(domain) ?? new Map<string, number>();
    this.scopedLeases.set(domain, leaseMap);
    const next = (leaseMap.get(scope) ?? 0) + 1;
    leaseMap.set(scope, next);
    return { count: next, firstLease: next === 1 };
  }

  // Remove one lease holder for (domain, scope). `lastLease` is true when the
  // final holder released, signalling the caller to actually disable the scope.
  releaseScopedLease(
    domain: RefreshDomain,
    scope: string
  ): { count: number; lastLease: boolean; hadLease: boolean } {
    const leaseMap = this.scopedLeases.get(domain);
    const current = leaseMap?.get(scope) ?? 0;
    if (!leaseMap || current <= 0) {
      return { count: 0, lastLease: false, hadLease: false };
    }
    const next = current - 1;
    if (next <= 0) {
      leaseMap.delete(scope);
      if (leaseMap.size === 0) {
        this.scopedLeases.delete(domain);
      }
      return { count: 0, lastLease: true, hadLease: true };
    }
    leaseMap.set(scope, next);
    return { count: next, lastLease: false, hadLease: true };
  }

  forEachEnabledScope(domain: RefreshDomain, callback: (scope: string) => void): void {
    this.getEnabledScopes(domain).forEach(callback);
  }

  forEachScopedDomain(callback: (domain: RefreshDomain, scope: string) => void): void {
    this.scopedEnabledState.forEach((scopedMap, domain) => {
      scopedMap.forEach((_enabled, scope) => {
        callback(domain, scope);
      });
    });
  }

  getInFlight(domain: RefreshDomain, scope?: string): InFlightRequest | undefined {
    return this.inFlight.get(makeInFlightKey(domain, scope));
  }

  setInFlight(request: InFlightRequest): string {
    const key = makeInFlightKey(request.domain, request.scope);
    this.inFlight.set(key, request);
    return key;
  }

  teardownInFlight(key: string, request: Pick<InFlightRequest, 'controller' | 'cleanup'>): void {
    request.controller.abort();
    request.cleanup?.();
    this.inFlight.delete(key);
  }

  deleteInFlight(domain: RefreshDomain, scope?: string): void {
    this.inFlight.delete(makeInFlightKey(domain, scope));
  }

  forEachInFlight(callback: (request: InFlightRequest, key: string) => void): void {
    Array.from(this.inFlight.entries()).forEach(([key, request]) => {
      callback(request, key);
    });
  }

  isStreamingBlocked(domain: RefreshDomain, scope: string): boolean {
    return this.blockedStreaming.has(makeInFlightKey(domain, scope));
  }

  blockStreaming(domain: RefreshDomain, scope: string): boolean {
    const key = makeInFlightKey(domain, scope);
    if (this.blockedStreaming.has(key)) {
      return false;
    }
    this.blockedStreaming.add(key);
    this.clearStreamingReady(domain, scope);
    this.pendingStreaming.delete(key);
    return true;
  }

  clearBlockedStreaming(): void {
    this.blockedStreaming.clear();
  }

  isStreamingActive(domain: RefreshDomain, scope: string): boolean {
    return this.streamingCleanup.has(makeInFlightKey(domain, scope));
  }

  hasPendingStreaming(domain: RefreshDomain, scope: string): boolean {
    return this.pendingStreaming.has(makeInFlightKey(domain, scope));
  }

  isStreamingStartingOrActive(domain: RefreshDomain, scope: string): boolean {
    const key = makeInFlightKey(domain, scope);
    return this.streamingCleanup.has(key) || this.pendingStreaming.has(key);
  }

  getStreamingLifecycleKeys(): string[] {
    const keys = new Set<string>();
    this.streamingCleanup.forEach((_cleanup, key) => {
      keys.add(key);
    });
    this.pendingStreaming.forEach((_promise, key) => {
      keys.add(key);
    });
    return Array.from(keys);
  }

  hasStreamingBookkeeping(domain: RefreshDomain, scope: string): boolean {
    const key = makeInFlightKey(domain, scope);
    return (
      this.streamingCleanup.has(key) ||
      this.pendingStreaming.has(key) ||
      this.streamingReady.has(key)
    );
  }

  hasStreamingReady(domain: RefreshDomain, scope: string): boolean {
    return this.streamingReady.has(makeInFlightKey(domain, scope));
  }

  setStreamingReady(domain: RefreshDomain, scope: string, task: Promise<void>): void {
    this.streamingReady.set(makeInFlightKey(domain, scope), task);
  }

  clearStreamingReady(domain: RefreshDomain, scope: string): void {
    this.streamingReady.delete(makeInFlightKey(domain, scope));
  }

  beginStreamingStart(
    domain: RefreshDomain,
    scope: string,
    startPromise: Promise<(() => void) | undefined>
  ): void {
    const key = makeInFlightKey(domain, scope);
    this.cancelledStreaming.delete(key);
    this.pendingStreaming.set(key, startPromise);
  }

  finishStreamingStart(
    domain: RefreshDomain,
    scope: string,
    cleanup: (() => void) | undefined
  ): void {
    const key = makeInFlightKey(domain, scope);
    this.pendingStreaming.delete(key);
    if (typeof cleanup === 'function') {
      this.streamingCleanup.set(key, cleanup);
      return;
    }
    this.streamingCleanup.set(key, () => undefined);
  }

  failStreamingStart(domain: RefreshDomain, scope: string): void {
    this.pendingStreaming.delete(makeInFlightKey(domain, scope));
  }

  cancelStreamingStart(
    domain: RefreshDomain,
    scope: string
  ): Promise<(() => void) | undefined> | null {
    const key = makeInFlightKey(domain, scope);
    this.cancelledStreaming.add(key);
    this.clearStreamingReady(domain, scope);
    return this.pendingStreaming.get(key) ?? null;
  }

  isStreamingCancelled(domain: RefreshDomain, scope: string): boolean {
    return this.cancelledStreaming.has(makeInFlightKey(domain, scope));
  }

  clearStreamingCancelled(domain: RefreshDomain, scope: string): void {
    this.cancelledStreaming.delete(makeInFlightKey(domain, scope));
  }

  getStreamingCleanup(domain: RefreshDomain, scope: string): (() => void) | undefined {
    return this.streamingCleanup.get(makeInFlightKey(domain, scope));
  }

  deleteStreamingCleanup(domain: RefreshDomain, scope: string): void {
    this.streamingCleanup.delete(makeInFlightKey(domain, scope));
  }

  clearStreamHealth(domain: RefreshDomain, scope: string): void {
    this.streamHealth.delete(makeInFlightKey(domain, scope));
  }

  setStreamHealth(
    domain: RefreshDomain,
    scope: string,
    payload: AppEvents['refresh:resource-stream-health']
  ): void {
    this.streamHealth.set(makeInFlightKey(domain, scope), payload);
  }

  clearAllStreamHealth(): void {
    this.streamHealth.clear();
  }

  clearAsyncStreamingBookkeeping(): void {
    this.pendingStreaming.clear();
    this.cancelledStreaming.clear();
    this.streamingReady.clear();
  }

  clearAllStreaming(reset: boolean): void {
    this.streamingCleanup.clear();
    this.pendingStreaming.clear();
    this.cancelledStreaming.clear();
    if (reset) {
      this.streamingReady.clear();
    }
  }

  resolveStreamingFetchMode(input: StreamingFetchDecisionInput): StreamingFetchMode {
    if (input.isManual || !input.shouldStream) {
      return 'snapshot';
    }

    // A scope with no applied data yet must load its first page even when the stream
    // is healthy — the notify-only stream signals changes, it does not deliver a new
    // query's initial snapshot. Without this, a filter/scope change never fetches.
    if (!input.hasData) {
      return 'snapshot';
    }

    // A doorbell-triggered fetch IS the stream refresh: skipping it for a
    // "healthy stream" swallows the very signal the stream sent.
    if (input.streamSignal) {
      return 'snapshot';
    }

    // While the stream is healthy, streaming IS the refresh: change signals
    // (object clock) and doorbells (metric/event/catalog clocks) drive refetch;
    // the poll runs only as the stream-down fallback.
    return input.streamingHealthy ? 'skip' : 'snapshot';
  }

  resetTransientState(): void {
    this.blockedStreaming.clear();
    this.streamHealth.clear();
    this.pendingStreaming.clear();
    this.cancelledStreaming.clear();
    this.streamingReady.clear();
  }

  resetAllState(): void {
    this.inFlight.clear();
    this.streamingCleanup.clear();
    this.scopedEnabledState.clear();
    this.scopedLeases.clear();
    this.resetTransientState();
  }
}
