/**
 * frontend/src/modules/object-panel/objectPanelRef.test.ts
 *
 * Covers canonical object-panel identity helpers: panel IDs, scoped refresh
 * strings, Helm synthetic references, container-log scopes, and object-map
 * support checks.
 */

import { describe, expect, it } from 'vitest';

import {
  getObjectPanelScopeEvictions,
  getObjectPanelScopes,
  hasCompleteObjectMapReference,
  isObjectMapSupportedKind,
} from './objectPanelRef';

// The PodsTab leases base `pods` and metric `pods-metrics` windows per panel object; closing the
// panel must evict both like the other panel scopes.
describe('getObjectPanelScopeEvictions pods window', () => {
  it('evicts the workload pods window for a workload panel', () => {
    const evictions = getObjectPanelScopeEvictions({
      clusterId: 'cluster-a',
      kind: 'Deployment',
      group: 'apps',
      version: 'v1',
      name: 'web',
      namespace: 'team-a',
    });

    expect(evictions).toContainEqual({
      domain: 'pods',
      scope: 'cluster-a|workload:team-a:apps:v1:Deployment:web',
    });
    expect(evictions).toContainEqual({
      domain: 'pods-metrics',
      scope: 'cluster-a|workload:team-a:apps:v1:Deployment:web',
    });
  });

  it('evicts the node pods window for a node panel', () => {
    const evictions = getObjectPanelScopeEvictions({
      clusterId: 'cluster-a',
      group: '',
      kind: 'Node',
      version: 'v1',
      name: 'worker-1',
    });

    expect(evictions).toContainEqual({
      domain: 'pods',
      scope: 'cluster-a|node:worker-1',
    });
    expect(evictions).toContainEqual({
      domain: 'pods-metrics',
      scope: 'cluster-a|node:worker-1',
    });
  });

  it('does not evict a pods window for kinds without a pods tab', () => {
    const evictions = getObjectPanelScopeEvictions({
      clusterId: 'cluster-a',
      kind: 'ConfigMap',
      version: 'v1',
      name: 'settings',
      namespace: 'team-a',
    });

    expect(evictions.some((eviction) => eviction.domain === 'pods')).toBe(false);
    expect(evictions.some((eviction) => eviction.domain === 'pods-metrics')).toBe(false);
  });
});

describe('getObjectPanelScopes', () => {
  it('normalises kind casing and builds scopes for standard resources', () => {
    const result = getObjectPanelScopes({
      clusterId: 'cluster-1',
      group: '',
      kind: 'Pod',
      name: 'api',
      namespace: 'team-a',
      version: 'v1',
    });

    expect(result.objectKind).toBe('pod');
    expect(result.detailScope).toBe('cluster-1|team-a:/v1:pod:api');
    expect(result.helmScope).toBeNull();
    expect(result.isHelmRelease).toBe(false);
    expect(result.isEvent).toBe(false);
  });

  it('returns null refresh scopes when cluster identity is missing', () => {
    const result = getObjectPanelScopes({
      group: '',
      kind: 'Pod',
      name: 'api',
      namespace: 'team-a',
      version: 'v1',
    });

    expect(result.objectKind).toBe('pod');
    expect(result.detailScope).toBeNull();
    expect(result.eventsScope).toBeNull();
    expect(result.containerLogsScope).toBeNull();
    expect(result.mapScope).toBeNull();
    expect(result.podsScope).toBeNull();
  });

  it('returns null refresh scopes when GVK identity is missing', () => {
    const result = getObjectPanelScopes({
      clusterId: 'cluster-1',
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
    });

    expect(result.objectKind).toBe('deployment');
    expect(result.detailScope).toBeNull();
    expect(result.eventsScope).toBeNull();
    expect(result.containerLogsScope).toBeNull();
    expect(result.mapScope).toBeNull();
    expect(result.podsScope).toBeNull();
  });

  it('returns null refresh scopes when a non-core builtin has an empty group segment', () => {
    const result = getObjectPanelScopes({
      clusterId: 'cluster-1',
      group: '',
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      version: 'v1',
    });

    expect(result.objectKind).toBe('deployment');
    expect(result.detailScope).toBeNull();
    expect(result.eventsScope).toBeNull();
    expect(result.containerLogsScope).toBeNull();
    expect(result.mapScope).toBeNull();
    expect(result.podsScope).toBeNull();
  });

  it('falls back to cluster scope when namespace is empty', () => {
    const result = getObjectPanelScopes(
      {
        clusterId: 'cluster-1',
        kind: 'HelmRelease',
        name: 'shopping-cart',
        namespace: '',
      },
      { clusterScope: '__cluster__' }
    );

    expect(result.objectKind).toBe('helmrelease');
    expect(result.detailScope).toBe('cluster-1|__cluster__:helm.sh/v3:helmrelease:shopping-cart');
    expect(result.helmScope).toBe('cluster-1|__cluster__:shopping-cart');
    expect(result.isHelmRelease).toBe(true);
  });

  it('keeps real HelmRelease custom resources on their supplied GVK', () => {
    const result = getObjectPanelScopes({
      kind: 'HelmRelease',
      name: 'flux-app',
      namespace: 'apps',
      group: 'helm.toolkit.fluxcd.io',
      version: 'v2',
      clusterId: 'cluster-1',
    });

    expect(result.objectKind).toBe('helmrelease');
    expect(result.detailScope).toBe(
      'cluster-1|apps:helm.toolkit.fluxcd.io/v2:helmrelease:flux-app'
    );
    expect(result.eventsScope).toBe(
      'cluster-1|apps:helm.toolkit.fluxcd.io/v2:HelmRelease:flux-app'
    );
    expect(result.helmScope).toBeNull();
    expect(result.isHelmRelease).toBe(false);
  });

  it('marks event resources with event-specific flag', () => {
    const result = getObjectPanelScopes({
      clusterId: 'cluster-1',
      group: '',
      kind: 'Event',
      name: 'warning-123',
      namespace: 'default',
      version: 'v1',
    });

    expect(result.isEvent).toBe(true);
    expect(result.detailScope).toBe('cluster-1|default:/v1:event:warning-123');
  });

  it('emits the GVK scope form when PanelObjectData carries group and version', () => {
    // Two different DBInstance CRDs share the lowercased kind "dbinstance"
    // but come from different API groups. With the GVK form threaded
    // through, the detailScope carries the full group/version so the
    // backend can disambiguate.
    const result = getObjectPanelScopes({
      kind: 'DBInstance',
      name: 'my-db',
      namespace: 'default',
      clusterId: 'cluster-1',
      group: 'rds.services.k8s.aws',
      version: 'v1alpha1',
    });

    expect(result.objectKind).toBe('dbinstance');
    expect(result.detailScope).toBe(
      'cluster-1|default:rds.services.k8s.aws/v1alpha1:dbinstance:my-db'
    );
  });

  it('emits the GVK scope form for core resources with an empty group', () => {
    // Core resources (no API group, e.g. Pod) encode the group as an
    // empty string with a leading slash in the GVK form. The backend
    // parser strips this correctly.
    const result = getObjectPanelScopes({
      kind: 'Pod',
      name: 'api',
      namespace: 'team-a',
      clusterId: 'cluster-1',
      group: '',
      version: 'v1',
    });

    expect(result.detailScope).toBe('cluster-1|team-a:/v1:pod:api');
  });

  it('builds eventsScope from the original-case kind so a single source of truth feeds both consumers', () => {
    // The events refresh-domain producer expects the kind in its
    // original case (matches how the backend events fetcher keys its
    // dispatch). detailScope uses the lowercased form. ObjectPanelContent
    // and EventsTab both consume eventsScope and MUST agree on the same
    // string — keep the computation in one place.
    const result = getObjectPanelScopes({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      clusterId: 'cluster-1',
      group: 'apps',
      version: 'v1',
    });

    // detailScope is lowercase; eventsScope keeps the original case.
    expect(result.detailScope).toBe('cluster-1|team-a:apps/v1:deployment:api');
    expect(result.eventsScope).toBe('cluster-1|team-a:apps/v1:Deployment:api');
  });

  it('threads group/version into eventsScope when PanelObjectData carries them', () => {
    const result = getObjectPanelScopes({
      kind: 'DBInstance',
      name: 'orders',
      namespace: 'team-a',
      group: 'documentdb.services.k8s.aws',
      version: 'v1alpha1',
      clusterId: 'cluster-1',
    });

    expect(result.eventsScope).toBe(
      'cluster-1|team-a:documentdb.services.k8s.aws/v1alpha1:DBInstance:orders'
    );
  });

  it('returns null eventsScope when objectData is incomplete', () => {
    expect(getObjectPanelScopes(null).eventsScope).toBeNull();
    expect(getObjectPanelScopes({ kind: 'Pod' }).eventsScope).toBeNull();
    expect(getObjectPanelScopes({ name: 'api' }).eventsScope).toBeNull();
  });

  it('builds containerLogsScope using the lowercased kind so ObjectPanelContent and LogViewer agree', () => {
    // containerLogsScope is consumed by ObjectPanelContent (full-cleanup lifecycle
    // when the panel closes) AND by LogViewer (the actual streaming
    // start/stop). The two consumers used to compute their own scope
    // strings independently — same drift bug as eventsScope. The log
    // domain producer expects the lowercased kind (matches LogViewer's
    // historical convention), distinct from eventsScope's original case.
    const result = getObjectPanelScopes({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      clusterId: 'cluster-1',
      group: 'apps',
      version: 'v1',
    });

    expect(result.containerLogsScope).toBe('cluster-1|team-a:apps/v1:deployment:api');
  });

  it('threads group/version into containerLogsScope when PanelObjectData carries them', () => {
    const result = getObjectPanelScopes({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      group: 'apps',
      version: 'v1',
      clusterId: 'cluster-1',
    });

    expect(result.containerLogsScope).toBe('cluster-1|team-a:apps/v1:deployment:api');
  });

  it('keeps colliding kinds distinct in containerLogsScope by threading group/version', () => {
    const first = getObjectPanelScopes({
      kind: 'DBInstance',
      name: 'orders',
      namespace: 'team-a',
      group: 'rds.services.k8s.aws',
      version: 'v1alpha1',
      clusterId: 'cluster-1',
    });
    const second = getObjectPanelScopes({
      kind: 'DBInstance',
      name: 'orders',
      namespace: 'team-a',
      group: 'documentdb.services.k8s.aws',
      version: 'v1alpha1',
      clusterId: 'cluster-1',
    });

    expect(first.containerLogsScope).toBe(
      'cluster-1|team-a:rds.services.k8s.aws/v1alpha1:dbinstance:orders'
    );
    expect(second.containerLogsScope).toBe(
      'cluster-1|team-a:documentdb.services.k8s.aws/v1alpha1:dbinstance:orders'
    );
    expect(first.containerLogsScope).not.toBe(second.containerLogsScope);
  });

  it('returns null containerLogsScope when objectData is incomplete', () => {
    expect(getObjectPanelScopes(null).containerLogsScope).toBeNull();
    expect(getObjectPanelScopes({ kind: 'Pod' }).containerLogsScope).toBeNull();
    expect(getObjectPanelScopes({ name: 'api' }).containerLogsScope).toBeNull();
    expect(
      getObjectPanelScopes({
        kind: 'DBInstance',
        name: 'orders',
        namespace: 'team-a',
        clusterId: 'cluster-1',
      }).containerLogsScope
    ).toBeNull();
  });

  it('builds mapScope using the original-case kind so it matches the backend object-map parser', () => {
    const result = getObjectPanelScopes({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      group: 'apps',
      version: 'v1',
      clusterId: 'cluster-1',
    });
    expect(result.mapScope).toBe('cluster-1|team-a:apps/v1:Deployment:api');
  });

  it('returns null mapScope when objectData is incomplete', () => {
    expect(getObjectPanelScopes(null).mapScope).toBeNull();
    expect(getObjectPanelScopes({ kind: 'Pod' }).mapScope).toBeNull();
    expect(getObjectPanelScopes({ name: 'api' }).mapScope).toBeNull();
    expect(
      getObjectPanelScopes({
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
        group: '',
        version: 'v1',
      }).mapScope
    ).toBeNull();
    expect(
      getObjectPanelScopes({
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
        clusterId: 'cluster-1',
        version: 'v1',
      }).mapScope
    ).toBeNull();
    expect(
      getObjectPanelScopes({
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
        clusterId: 'cluster-1',
        group: '',
      }).mapScope
    ).toBeNull();
  });

  it('supports policy resources as object-map seeds', () => {
    expect(isObjectMapSupportedKind('PodDisruptionBudget')).toBe(true);
    expect(
      hasCompleteObjectMapReference({
        clusterId: 'cluster-a',
        group: 'policy',
        version: 'v1',
        kind: 'PodDisruptionBudget',
        namespace: 'default',
        name: 'web',
      })
    ).toBe(true);
  });

  it('supports network policies as object-map seeds', () => {
    expect(isObjectMapSupportedKind('NetworkPolicy')).toBe(true);
    expect(
      hasCompleteObjectMapReference({
        clusterId: 'cluster-a',
        group: 'networking.k8s.io',
        version: 'v1',
        kind: 'NetworkPolicy',
        namespace: 'default',
        name: 'web',
      })
    ).toBe(true);
  });

  it('supports Gateway API resources as object-map seeds', () => {
    for (const kind of [
      'GatewayClass',
      'Gateway',
      'HTTPRoute',
      'GRPCRoute',
      'TLSRoute',
      'ListenerSet',
      'ReferenceGrant',
      'BackendTLSPolicy',
    ]) {
      expect(isObjectMapSupportedKind(kind)).toBe(true);
    }

    expect(
      hasCompleteObjectMapReference({
        clusterId: 'cluster-a',
        group: 'gateway.networking.k8s.io',
        version: 'v1',
        kind: 'HTTPRoute',
        namespace: 'default',
        name: 'web',
      })
    ).toBe(true);
  });
});
