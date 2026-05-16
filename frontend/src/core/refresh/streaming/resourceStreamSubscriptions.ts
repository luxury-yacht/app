import { buildClusterScope, parseClusterScopeList } from '../clusterScope';
import {
  getResourceStreamDomainDescriptor,
  normalizeResourceScope,
  type ResourceDomain,
} from './resourceStreamDomains';
import type { ResourceStreamClientMessage } from './resourceStreamConnection';

type StreamMessageType = ResourceStreamClientMessage['type'];

export type ResourceStreamUpdateMessage = {
  type: StreamMessageType;
  clusterId?: string;
  clusterName?: string;
  domain: ResourceDomain;
  scope: string;
  resourceVersion?: string;
  sequence?: string;
  uid?: string;
  name?: string;
  namespace?: string;
  kind?: string;
  row?: unknown;
  error?: string;
  errorDetails?: unknown;
};

export type StreamSubscription = {
  key: string;
  domain: ResourceDomain;
  storeScope: string;
  reportScope: string;
  normalizedScope: string;
  clusterId: string;
  clusterName?: string;
  resourceVersion?: bigint;
  // Track the last stream sequence applied so we can resume after reconnects.
  lastSequence?: bigint;
  // Track message activity so polling is paused only after delivery resumes.
  lastMessageAt?: number;
  lastDeliveryAt?: number;
  lastDeliveryEpoch?: number;
  lastErrorAt?: number;
  lastErrorReason?: string;
  updateQueue: ResourceStreamUpdateMessage[];
  updateTimer: number | null;
  pendingReset: boolean;
  resyncInFlight: boolean;
  lastResyncAt: number;
  preserveMetrics: boolean;
  shadowKeys: Set<string>;
  hasBaseline: boolean;
  driftDetected: boolean;
};

type PendingUnsubscribe = {
  timerId: number;
};

export const resourceStreamSubscriptionKey = (
  clusterId: string,
  domain: ResourceDomain,
  scope: string
): string => `${clusterId}::${domain}::${scope}`;

export const resolveResourceStreamSubscriptionScope = (
  domain: ResourceDomain,
  scope: string
): { clusterIds: string[]; normalizedScope: string; reportScope: string } => {
  const parsed = parseClusterScopeList(scope);
  if (parsed.clusterIds.length === 0) {
    throw new Error('Resource streaming requires a cluster scope');
  }
  if (parsed.isMultiCluster) {
    throw new Error('Resource streaming requires a single cluster scope');
  }
  const normalizedScope = normalizeResourceScope(domain, parsed.scope);
  const reportScope = buildClusterScope(parsed.clusterIds[0], normalizedScope);
  return { clusterIds: parsed.clusterIds, normalizedScope, reportScope };
};

export class ResourceStreamSubscriptionStore {
  private subscriptions = new Map<string, StreamSubscription>();
  private pendingUnsubscribes = new Map<string, PendingUnsubscribe>();

  constructor(
    private readonly unsubscribeDebounceMs: number,
    private readonly logInfo: (message: string) => void
  ) {}

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

  ensure(domain: ResourceDomain, scope: string): StreamSubscription[] {
    const { clusterIds, normalizedScope, reportScope } = resolveResourceStreamSubscriptionScope(
      domain,
      scope
    );
    return clusterIds.map((clusterId) =>
      this.ensureForCluster(domain, clusterId, normalizedScope, reportScope)
    );
  }

  getForScope(domain: ResourceDomain, scope: string): StreamSubscription[] {
    const parsed = parseClusterScopeList(scope);
    if (parsed.clusterIds.length === 0 || parsed.isMultiCluster) {
      return [];
    }
    let normalizedScope = '';
    try {
      normalizedScope = normalizeResourceScope(domain, parsed.scope);
    } catch (_err) {
      return [];
    }

    return parsed.clusterIds
      .map((clusterId) =>
        this.subscriptions.get(resourceStreamSubscriptionKey(clusterId, domain, normalizedScope))
      )
      .filter((subscription): subscription is StreamSubscription => Boolean(subscription));
  }

  findByScope(domain: ResourceDomain, scope: string): StreamSubscription | undefined {
    let match: StreamSubscription | undefined;
    for (const subscription of this.subscriptions.values()) {
      if (subscription.domain !== domain || subscription.normalizedScope !== scope) {
        continue;
      }
      if (match) {
        return undefined;
      }
      match = subscription;
    }
    return match;
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
    this.pendingUnsubscribes.forEach((pending) => window.clearTimeout(pending.timerId));
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
    const resumeToken = subscription.lastSequence
      ? subscription.lastSequence.toString()
      : undefined;
    subscription.pendingReset = !resumeToken;
    return {
      type: 'REQUEST',
      clusterId: subscription.clusterId,
      domain: subscription.domain,
      scope: subscription.storeScope,
      resourceVersion: subscription.resourceVersion
        ? subscription.resourceVersion.toString()
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

  private ensureForCluster(
    domain: ResourceDomain,
    clusterId: string,
    normalizedScope: string,
    reportScope: string
  ): StreamSubscription {
    const key = resourceStreamSubscriptionKey(clusterId, domain, normalizedScope);
    const existing = this.subscriptions.get(key);
    if (existing) {
      this.cancelPendingUnsubscribe(existing);
      return existing;
    }

    const storeScope = buildClusterScope(clusterId, normalizedScope);
    const subscription: StreamSubscription = {
      key,
      domain,
      storeScope,
      reportScope,
      normalizedScope,
      clusterId,
      updateQueue: [],
      updateTimer: null,
      pendingReset: false,
      resyncInFlight: false,
      lastResyncAt: 0,
      preserveMetrics: getResourceStreamDomainDescriptor(domain).preserveMetrics,
      shadowKeys: new Set(),
      hasBaseline: false,
      driftDetected: false,
    };
    this.subscriptions.set(key, subscription);
    this.logInfo(
      `[resource-stream] subscription created domain=${subscription.domain} scope=${subscription.storeScope}`
    );
    return subscription;
  }
}
