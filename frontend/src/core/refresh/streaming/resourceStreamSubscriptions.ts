import {
  buildRefreshScope,
  encodeScopeSelector,
  hasOneShotQuery,
  parseRefreshScope,
} from '../scopeSelector';
import type { ResourceStreamClientMessage } from './resourceStreamConnection';
import type { DoorbellDomain } from './resourceStreamDomains';
import {
  initialResourceStreamProtocolState,
  type ResourceStreamProtocolState,
} from './resourceStreamProtocol';

export type StreamSubscription = {
  key: string;
  domain: DoorbellDomain;
  storeScope: string;
  reportScope: string;
  reportScopes: Set<string>;
  normalizedScope: string;
  clusterId: string;
  clusterName?: string;
  protocol: ResourceStreamProtocolState;
};

type PendingUnsubscribe = {
  timerId: number;
};

export const resourceStreamSubscriptionKey = (
  clusterId: string,
  domain: DoorbellDomain,
  scope: string
): string => `${clusterId}::${domain}::${scope}`;

type ResolvedSubscriptionScope = {
  clusterId: string;
  normalizedScope: string;
  reportScope: string;
  storeScope: string;
};

export const resolveResourceStreamSubscriptionScope = (
  domain: DoorbellDomain,
  scope: string
): ResolvedSubscriptionScope => {
  const decoded = parseRefreshScope(domain, scope);
  const { clusterId, selector, query } = decoded;
  // Streams subscribe to their selector alone; every catalog query shares the
  // cluster-wide catalog doorbell and reports under its own scope.
  if (hasOneShotQuery(domain, decoded)) {
    throw new Error(`${domain} streams do not accept a query scope`);
  }
  return {
    clusterId,
    normalizedScope: encodeScopeSelector(selector),
    reportScope: buildRefreshScope(domain, { clusterId, selector, query }),
    storeScope: buildRefreshScope(domain, { clusterId, selector }),
  };
};

// Lookups and releases are evidence about existing subscriptions; a scope that
// cannot subscribe simply has none.
const tryResolveSubscriptionScope = (
  domain: DoorbellDomain,
  scope: string
): ResolvedSubscriptionScope | null => {
  try {
    return resolveResourceStreamSubscriptionScope(domain, scope);
  } catch (_err) {
    return null;
  }
};

export class ResourceStreamSubscriptionStore {
  private readonly unsubscribeDebounceMs: number;
  private readonly logInfo: (message: string) => void;
  private readonly subscriptions = new Map<string, StreamSubscription>();
  private readonly pendingUnsubscribes = new Map<string, PendingUnsubscribe>();

  constructor(unsubscribeDebounceMs: number, logInfo: (message: string) => void) {
    this.unsubscribeDebounceMs = unsubscribeDebounceMs;
    this.logInfo = logInfo;
  }

  get size(): number {
    return this.subscriptions.size;
  }

  values(): IterableIterator<StreamSubscription> {
    return this.subscriptions.values();
  }

  forEach(callback: (subscription: StreamSubscription) => void): void {
    this.subscriptions.forEach(callback);
  }

  get(key: string): StreamSubscription | undefined {
    return this.subscriptions.get(key);
  }

  ensure(domain: DoorbellDomain, scope: string): StreamSubscription {
    return this.ensureResolved(domain, resolveResourceStreamSubscriptionScope(domain, scope));
  }

  getForScope(domain: DoorbellDomain, scope: string): StreamSubscription | undefined {
    const resolved = tryResolveSubscriptionScope(domain, scope);
    if (!resolved) {
      return undefined;
    }
    const subscription = this.subscriptions.get(
      resourceStreamSubscriptionKey(resolved.clusterId, domain, resolved.normalizedScope)
    );
    return subscription?.reportScopes.has(resolved.reportScope) ? subscription : undefined;
  }

  /** Drops one report scope; returns the subscription once its last one is gone. */
  release(domain: DoorbellDomain, scope: string): StreamSubscription | undefined {
    const resolved = tryResolveSubscriptionScope(domain, scope);
    if (!resolved) {
      return undefined;
    }
    const subscription = this.subscriptions.get(
      resourceStreamSubscriptionKey(resolved.clusterId, domain, resolved.normalizedScope)
    );
    if (!subscription?.reportScopes.has(resolved.reportScope)) {
      return undefined;
    }
    subscription.reportScopes.delete(resolved.reportScope);
    if (subscription.reportScope === resolved.reportScope) {
      subscription.reportScope =
        subscription.reportScopes.values().next().value ?? resolved.reportScope;
    }
    return subscription.reportScopes.size === 0 ? subscription : undefined;
  }

  hasPendingUnsubscribe(subscription: StreamSubscription): boolean {
    return this.pendingUnsubscribes.has(subscription.key);
  }

  scheduleUnsubscribe(
    subscription: StreamSubscription,
    reset: boolean,
    unsubscribe: (subscription: StreamSubscription, reset: boolean) => void
  ): void {
    if (reset || typeof window === 'undefined' || this.unsubscribeDebounceMs <= 0) {
      unsubscribe(subscription, reset);
      return;
    }
    if (this.pendingUnsubscribes.has(subscription.key)) {
      return;
    }
    const timerId = window.setTimeout(() => {
      this.pendingUnsubscribes.delete(subscription.key);
      unsubscribe(subscription, reset);
    }, this.unsubscribeDebounceMs);
    this.pendingUnsubscribes.set(subscription.key, { timerId });
    this.logInfo(
      `[resource-stream] debounce unsubscribe domain=${subscription.domain} scope=${subscription.storeScope} delayMs=${this.unsubscribeDebounceMs}`
    );
  }

  cancelPendingUnsubscribe(subscription: StreamSubscription): void {
    const pending = this.pendingUnsubscribes.get(subscription.key);
    if (!pending) {
      return;
    }
    window.clearTimeout(pending.timerId);
    this.pendingUnsubscribes.delete(subscription.key);
    this.logInfo(
      `[resource-stream] debounce cancel domain=${subscription.domain} scope=${subscription.storeScope}`
    );
  }

  clearPendingUnsubscribes(): void {
    this.pendingUnsubscribes.forEach((pending) => {
      window.clearTimeout(pending.timerId);
    });
    this.pendingUnsubscribes.clear();
  }

  delete(subscription: StreamSubscription): void {
    this.subscriptions.delete(subscription.key);
  }

  clear(): void {
    this.subscriptions.clear();
    this.clearPendingUnsubscribes();
  }

  buildRequestMessage(subscription: StreamSubscription): ResourceStreamClientMessage {
    const resumeToken = subscription.protocol.resume.lastSequence
      ? subscription.protocol.resume.lastSequence.toString()
      : undefined;
    return {
      type: 'REQUEST',
      clusterId: subscription.clusterId,
      domain: subscription.domain,
      scope: subscription.storeScope,
      resourceVersion: subscription.protocol.resume.resourceVersion
        ? subscription.protocol.resume.resourceVersion.toString()
        : undefined,
      resumeToken,
    };
  }

  buildCancelMessage(subscription: StreamSubscription): ResourceStreamClientMessage {
    return {
      type: 'CANCEL',
      clusterId: subscription.clusterId,
      domain: subscription.domain,
      scope: subscription.storeScope,
    };
  }

  private ensureResolved(
    domain: DoorbellDomain,
    { clusterId, normalizedScope, reportScope, storeScope }: ResolvedSubscriptionScope
  ): StreamSubscription {
    const key = resourceStreamSubscriptionKey(clusterId, domain, normalizedScope);
    const existing = this.subscriptions.get(key);
    if (existing) {
      const replaceBlockedOwner =
        this.hasPendingUnsubscribe(existing) &&
        existing.protocol.phase.status === 'permission-blocked';
      existing.reportScopes.add(reportScope);
      this.cancelPendingUnsubscribe(existing);
      if (replaceBlockedOwner) {
        // Reclaim after a lifecycle stop is a new permission epoch. Install a
        // fresh owner so late callbacks keep the old terminal protocol object.
        const replacement = {
          ...existing,
          reportScopes: new Set(existing.reportScopes),
          protocol: initialResourceStreamProtocolState(),
        };
        this.subscriptions.set(key, replacement);
        return replacement;
      }
      return existing;
    }

    const subscription: StreamSubscription = {
      key,
      domain,
      storeScope,
      reportScope,
      reportScopes: new Set([reportScope]),
      normalizedScope,
      clusterId,
      protocol: initialResourceStreamProtocolState(),
    };
    this.subscriptions.set(key, subscription);
    this.logInfo(
      `[resource-stream] subscription created domain=${subscription.domain} scope=${subscription.storeScope}`
    );
    return subscription;
  }
}
