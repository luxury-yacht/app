import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testScope } from '@/test-utils/refreshScope';
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
    window.setTimeout = globalThis.setTimeout;
    window.clearTimeout = globalThis.clearTimeout;
  });

  it('resolves a resource stream scope to its one cluster', () => {
    const scope = testScope('cluster-a', 'namespace:default');

    expect(resolveResourceStreamSubscriptionScope('pods', scope)).toEqual({
      clusterId: 'cluster-a',
      normalizedScope: 'namespace:default',
      reportScope: scope,
      storeScope: scope,
    });
  });

  // A kubeconfig file or context name may contain a comma; the scope prefix is
  // one cluster id, never a list.
  it('subscribes a comma-containing cluster id as one cluster', () => {
    const scope = testScope('prod,eu.yaml:ctx', 'namespace:default');
    const store = new ResourceStreamSubscriptionStore(500, vi.fn());

    const subscription = store.ensure('pods', scope);

    expect(subscription.clusterId).toBe('prod,eu.yaml:ctx');
    expect(store.getForScope('pods', scope)).toBe(subscription);
  });

  it('resolves catalog query scopes to a cluster doorbell subscription while preserving the report scope', () => {
    const queryScope = testScope(
      'fusionauth-prod-ap-southeast-2',
      'limit=1000&customOnly=true&sort=name&sortDirection=asc&namespace=fa-atmail-au'
    );

    expect(resolveResourceStreamSubscriptionScope('catalog', queryScope)).toEqual({
      clusterId: 'fusionauth-prod-ap-southeast-2',
      normalizedScope: '',
      reportScope: queryScope,
      storeScope: testScope('fusionauth-prod-ap-southeast-2'),
    });

    const store = new ResourceStreamSubscriptionStore(500, vi.fn());
    const subscription = store.ensure('catalog', queryScope);

    expect(store.buildRequestMessage(subscription)).toEqual(
      expect.objectContaining({
        type: 'REQUEST',
        clusterId: 'fusionauth-prod-ap-southeast-2',
        domain: 'catalog',
        scope: testScope('fusionauth-prod-ap-southeast-2', ''),
      })
    );
  });

  it('shares one catalog doorbell subscription across active catalog query report scopes', () => {
    const store = new ResourceStreamSubscriptionStore(500, vi.fn());
    const pageScope = testScope(
      'cluster-a',
      'limit=1000&customOnly=true&sort=name&sortDirection=asc&namespace=team-a'
    );
    const metadataScope = testScope('cluster-a', 'limit=1&customOnly=true&namespace=team-a');

    const pageSubscription = store.ensure('catalog', pageScope);
    const metadataSubscription = store.ensure('catalog', metadataScope);

    expect(metadataSubscription).toBe(pageSubscription);
    expect(pageSubscription.reportScopes).toEqual(new Set([pageScope, metadataScope]));
    expect(store.release('catalog', pageScope)).toBeUndefined();
    expect(pageSubscription.reportScopes).toEqual(new Set([metadataScope]));
    expect(store.release('catalog', metadataScope)).toBe(pageSubscription);
  });

  it('rejects stream scopes outside the domain grammar or carrying a query', () => {
    expect(() => resolveResourceStreamSubscriptionScope('pods', 'cluster-a|namespace:*')).toThrow();
    expect(() => resolveResourceStreamSubscriptionScope('pods', 'namespace:default')).toThrow();
    expect(() =>
      resolveResourceStreamSubscriptionScope('pods', 'cluster-a|namespace:all?limit=50')
    ).toThrow();
    expect(() => resolveResourceStreamSubscriptionScope('nodes', 'cluster-a|cluster')).toThrow();
  });

  it('builds resume-capable request messages from subscription state', () => {
    const store = new ResourceStreamSubscriptionStore(500, vi.fn());
    const scope = testScope('cluster-a', 'namespace:default');
    const subscription = store.ensure('pods', scope);

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
    expect(subscription.protocol.phase).toEqual({ status: 'connecting' });

    subscription.protocol = {
      ...subscription.protocol,
      resume: { ...subscription.protocol.resume, lastSequence: 42n },
    };
    const resumeRequest = store.buildRequestMessage(subscription);
    expect(resumeRequest.resumeToken).toBe('42');
    expect(subscription.protocol.resume.lastSequence).toBe(42n);
  });

  it('debounces and cancels pending unsubscribe work', () => {
    vi.useFakeTimers();
    window.setTimeout = globalThis.setTimeout;
    window.clearTimeout = globalThis.clearTimeout;
    const store = new ResourceStreamSubscriptionStore(500, vi.fn());
    const scope = testScope('cluster-a', '');
    const subscription = store.ensure('nodes', scope);
    const unsubscribe = vi.fn();

    store.scheduleUnsubscribe(subscription, false, unsubscribe);
    expect(store.hasPendingUnsubscribe(subscription)).toBe(true);

    store.cancelPendingUnsubscribe(subscription);
    vi.runOnlyPendingTimers();

    expect(unsubscribe).not.toHaveBeenCalled();
    expect(store.hasPendingUnsubscribe(subscription)).toBe(false);
  });
});
