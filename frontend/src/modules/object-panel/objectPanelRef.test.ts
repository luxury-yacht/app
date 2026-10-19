/**
 * frontend/src/modules/object-panel/objectPanelRef.test.ts
 *
 * Covers canonical object-panel identity helpers: panel IDs, scoped refresh
 * strings, Helm synthetic references, container-log scopes, and object-map
 * support checks.
 */

import { describe, expect, it } from 'vitest';

import { parseRefreshScope } from '@/core/refresh/scopeSelector';

import {
  getObjectPanelScopeEvictions,
  getObjectPanelScopes,
  hasCompleteObjectMapReference,
  isObjectMapSupportedRef,
} from './objectPanelRef';

// The PodsTab leases a `pods` window per panel object (metrics arrive joined on
// the same domain's rows at serve); closing the panel must evict it like the
// other panel scopes.
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
  });
});

describe('getObjectPanelScopes', () => {
  it('builds canonical object scopes that keep the object kind', () => {
    const result = getObjectPanelScopes({
      clusterId: 'cluster-1',
      group: '',
      kind: 'Pod',
      name: 'api',
      namespace: 'team-a',
      version: 'v1',
    });

    expect(result.objectKind).toBe('pod');
    expect(result.detailScope).toBe('cluster-1|team-a:/v1:Pod:api');
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
    const result = getObjectPanelScopes({
      clusterId: 'cluster-1',
      kind: 'HelmRelease',
      name: 'shopping-cart',
      namespace: '',
    });

    expect(result.objectKind).toBe('helmrelease');
    expect(result.detailScope).toBe('cluster-1|__cluster__:helm.sh/v3:HelmRelease:shopping-cart');
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
      'cluster-1|apps:helm.toolkit.fluxcd.io/v2:HelmRelease:flux-app'
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
    expect(result.detailScope).toBe('cluster-1|default:/v1:Event:warning-123');
  });

  it('emits the GVK scope form when PanelObjectData carries group and version', () => {
    // Two different DBInstance CRDs share the kind but come from different
    // API groups; the scope carries the full group/version so the backend can
    // disambiguate.
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
      'cluster-1|default:rds.services.k8s.aws/v1alpha1:DBInstance:my-db'
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

    expect(result.detailScope).toBe('cluster-1|team-a:/v1:Pod:api');
  });

  it('encodes one object scope for details, events, logs, and the map', () => {
    // Every object-scoped domain decodes the same object selector, so the
    // panel's consumers (ObjectPanelContent, EventsTab, LogViewer, map) share
    // one canonical string and its cache entries.
    const result = getObjectPanelScopes({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      clusterId: 'cluster-1',
      group: 'apps',
      version: 'v1',
    });

    expect(result.detailScope).toBe('cluster-1|team-a:apps/v1:Deployment:api');
    expect(result.eventsScope).toBe(result.detailScope);
    expect(result.containerLogsScope).toBe(result.detailScope);
    expect(result.mapScope).toBe(result.detailScope);
  });

  // RBAC names may contain "?"; the panel must still build its scopes, and the
  // map must address the real object rather than a truncated name and a query.
  it('builds panel scopes for an object whose name contains "?"', () => {
    const result = getObjectPanelScopes({
      kind: 'Role',
      name: 'reader?team',
      namespace: 'team-a',
      clusterId: 'cluster-1',
      group: 'rbac.authorization.k8s.io',
      version: 'v1',
    });

    expect(result.detailScope).toBe(
      'cluster-1|team-a:rbac.authorization.k8s.io/v1:Role:reader%3Fteam'
    );
    expect(result.mapScope).toBe(result.detailScope);
    expect(parseRefreshScope('object-map', result.mapScope ?? '')).toEqual({
      clusterId: 'cluster-1',
      selector: {
        kind: 'object',
        object: {
          namespace: 'team-a',
          group: 'rbac.authorization.k8s.io',
          version: 'v1',
          kind: 'Role',
          name: 'reader?team',
        },
      },
      query: '',
    });
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

  it('threads group/version into containerLogsScope when PanelObjectData carries them', () => {
    const result = getObjectPanelScopes({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      group: 'apps',
      version: 'v1',
      clusterId: 'cluster-1',
    });

    expect(result.containerLogsScope).toBe('cluster-1|team-a:apps/v1:Deployment:api');
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
      'cluster-1|team-a:rds.services.k8s.aws/v1alpha1:DBInstance:orders'
    );
    expect(second.containerLogsScope).toBe(
      'cluster-1|team-a:documentdb.services.k8s.aws/v1alpha1:DBInstance:orders'
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

  it('builds a Helm release mapScope from the release identity and evicts it with the panel', () => {
    const release = {
      kind: 'HelmRelease',
      name: 'shopping-cart',
      namespace: 'apps',
      clusterId: 'cluster-1',
    };
    const mapScope = 'cluster-1|apps:helm.sh/v3:HelmRelease:shopping-cart';

    expect(getObjectPanelScopes(release).mapScope).toBe(mapScope);
    expect(getObjectPanelScopeEvictions(release)).toContainEqual({
      domain: 'object-map',
      scope: mapScope,
    });
  });

  it('offers maps for Helm releases but not for Flux HelmRelease custom resources', () => {
    expect(isObjectMapSupportedRef({ group: 'helm.sh', version: 'v3', kind: 'HelmRelease' })).toBe(
      true
    );
    expect(
      isObjectMapSupportedRef({
        group: 'helm.toolkit.fluxcd.io',
        version: 'v2',
        kind: 'HelmRelease',
      })
    ).toBe(false);
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

  it.each(['Role', 'RoleBinding'])('builds a cluster-scoped map reference for %s', (kind) => {
    const ref = {
      clusterId: 'cluster-a',
      group: 'rbac.authorization.k8s.io',
      version: 'v1',
      kind,
      namespace: 'team-a',
      name: 'reader',
    };
    expect(hasCompleteObjectMapReference(ref)).toBe(true);
    expect(getObjectPanelScopes(ref).mapScope).toBe(
      `cluster-a|team-a:rbac.authorization.k8s.io/v1:${kind}:reader`
    );
    expect(hasCompleteObjectMapReference({ ...ref, clusterId: undefined })).toBe(false);
    expect(hasCompleteObjectMapReference({ ...ref, version: undefined })).toBe(false);
  });

  it('does not treat custom resources that share a built-in kind name as map seeds', () => {
    for (const ref of [
      { group: 'networking.istio.io', version: 'v1beta1', kind: 'Gateway' },
      { group: 'crd.projectcalico.org', version: 'v3', kind: 'NetworkPolicy' },
      { group: 'serving.knative.dev', version: 'v1', kind: 'Service' },
    ]) {
      const object = { clusterId: 'cluster-a', namespace: 'default', name: 'web', ...ref };
      expect(hasCompleteObjectMapReference(object), ref.group).toBe(false);
      expect(getObjectPanelScopes(object).mapScope, ref.group).toBeNull();
    }
  });

  it('supports both served HorizontalPodAutoscaler versions as map seeds', () => {
    for (const version of ['v1', 'v2']) {
      expect(
        hasCompleteObjectMapReference({
          clusterId: 'cluster-a',
          group: 'autoscaling',
          version,
          kind: 'HorizontalPodAutoscaler',
          namespace: 'default',
          name: 'web',
        }),
        version
      ).toBe(true);
    }
  });

  it('supports policy resources as object-map seeds', () => {
    expect(
      isObjectMapSupportedRef({ group: 'policy', version: 'v1', kind: 'PodDisruptionBudget' })
    ).toBe(true);
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
    expect(
      isObjectMapSupportedRef({ group: 'networking.k8s.io', version: 'v1', kind: 'NetworkPolicy' })
    ).toBe(true);
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
      expect(
        isObjectMapSupportedRef({ group: 'gateway.networking.k8s.io', version: 'v1', kind })
      ).toBe(true);
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
