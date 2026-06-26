import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildClusterScope } from '../clusterScope';
import { RESOURCE_STREAM_DOMAINS, type ResourceDomain } from './resourceStreamDomains';
import {
  ResourceStreamSubscriptionStore,
  resolveResourceStreamSubscriptionScope,
} from './resourceStreamSubscriptions';

describe('ResourceStreamSubscriptionStore', () => {
  beforeEach(() => {
    vi.useRealTimers();
    if (!globalThis.window) {
      Object.defineProperty(globalThis, 'window', {
        value: {},
        writable: true,
      });
    }
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
  });

  it('resolves single-cluster resource stream scopes and rejects multi-cluster scopes', () => {
    const scope = buildClusterScope('cluster-a', 'namespace:default');

    expect(resolveResourceStreamSubscriptionScope('pods', scope)).toEqual({
      clusterIds: ['cluster-a'],
      normalizedScope: 'namespace:default',
      reportScope: scope,
    });

    expect(() =>
      resolveResourceStreamSubscriptionScope(
        'pods',
        'clusters=cluster-a,cluster-b|namespace:default'
      )
    ).toThrow('single cluster');
  });

  it('resolves catalog query scopes to a cluster doorbell subscription while preserving the report scope', () => {
    const queryScope = buildClusterScope(
      'fusionauth-prod-ap-southeast-2',
      'limit=1000&customOnly=true&sort=name&sortDirection=asc&namespace=fa-atmail-au'
    );

    expect(resolveResourceStreamSubscriptionScope('catalog', queryScope)).toEqual({
      clusterIds: ['fusionauth-prod-ap-southeast-2'],
      normalizedScope: '',
      reportScope: queryScope,
    });

    const store = new ResourceStreamSubscriptionStore(500, vi.fn());
    const [subscription] = store.ensure('catalog', queryScope);

    expect(store.buildRequestMessage(subscription)).toEqual(
      expect.objectContaining({
        type: 'REQUEST',
        clusterId: 'fusionauth-prod-ap-southeast-2',
        domain: 'catalog',
        scope: buildClusterScope('fusionauth-prod-ap-southeast-2', ''),
      })
    );
  });

  it('shares one catalog doorbell subscription across active catalog query report scopes', () => {
    const store = new ResourceStreamSubscriptionStore(500, vi.fn());
    const pageScope = buildClusterScope(
      'cluster-a',
      'limit=1000&customOnly=true&sort=name&sortDirection=asc&namespace=team-a'
    );
    const metadataScope = buildClusterScope(
      'cluster-a',
      'limit=1&customOnly=true&namespace=team-a'
    );

    const [pageSubscription] = store.ensure('catalog', pageScope);
    const [metadataSubscription] = store.ensure('catalog', metadataScope);

    expect(metadataSubscription).toBe(pageSubscription);
    expect(pageSubscription.reportScopes).toEqual(new Set([pageScope, metadataScope]));
    expect(store.release('catalog', pageScope)).toEqual([]);
    expect(pageSubscription.reportScopes).toEqual(new Set([metadataScope]));
    expect(store.release('catalog', metadataScope)).toEqual([pageSubscription]);
  });

  it('rejects multi-cluster scopes for every resource stream domain', () => {
    const multiClusterScope = 'clusters=cluster-a,cluster-b|namespace:default';

    RESOURCE_STREAM_DOMAINS.forEach((domain: ResourceDomain) => {
      expect(() => resolveResourceStreamSubscriptionScope(domain, multiClusterScope)).toThrow(
        'single cluster'
      );
    });
  });

  it('builds resume-capable request messages from subscription state', () => {
    const store = new ResourceStreamSubscriptionStore(500, vi.fn());
    const scope = buildClusterScope('cluster-a', 'namespace:default');
    const [subscription] = store.ensure('pods', scope);

    const initialRequest = store.buildRequestMessage(subscription);
    expect(initialRequest).toEqual(
      expect.objectContaining({
        type: 'REQUEST',
        clusterId: 'cluster-a',
        domain: 'pods',
        scope,
      })
    );
    expect(initialRequest.resumeToken).toBeUndefined();
    expect(subscription.pendingReset).toBe(true);

    subscription.lastSequence = 42n;
    const resumeRequest = store.buildRequestMessage(subscription);
    expect(resumeRequest.resumeToken).toBe('42');
    expect(subscription.pendingReset).toBe(false);
  });

  it('debounces and cancels pending unsubscribe work', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = globalThis.setTimeout;
    (window as any).clearTimeout = globalThis.clearTimeout;
    const store = new ResourceStreamSubscriptionStore(500, vi.fn());
    const scope = buildClusterScope('cluster-a', '');
    const [subscription] = store.ensure('nodes', scope);
    const unsubscribe = vi.fn();

    store.scheduleUnsubscribe(subscription, false, unsubscribe);
    expect(store.hasPendingUnsubscribe(subscription)).toBe(true);

    store.cancelPendingUnsubscribe(subscription);
    vi.runOnlyPendingTimers();

    expect(unsubscribe).not.toHaveBeenCalled();
    expect(store.hasPendingUnsubscribe(subscription)).toBe(false);
  });
});
