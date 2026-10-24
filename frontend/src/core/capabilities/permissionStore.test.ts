/**
 * frontend/src/core/capabilities/permissionStore.test.ts
 *
 * The permission store checks kind-level permissions per cluster and
 * namespace through QueryPermissions and publishes them under keys that the
 * spec lists and the lookups agree on: exact cluster ids, built-in or explicit
 * group/version, and subresource. It batches and de-duplicates namespace
 * checks, keeps freshness per namespace and spec list, publishes definitive
 * answers as ready and failed checks as errors, never caches a "cluster not
 * active" answer, and re-checks when the cluster becomes operational. Reset
 * transfers ownership: work begun before it never publishes after it.
 * Subscribers are notified asynchronously, once per burst. The store runs
 * unmounted over the harness's faked QueryPermissions RPC (test-utils/appState).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { getScopedFeaturesForView } from '@/core/refresh/components/diagnostics/diagnosticsPanelConfig';
import { buildPermissionRows } from '@/core/refresh/components/diagnostics/diagnosticsRowModel';
import { installAppStateHarness, type PermissionQuery } from '@/test-utils/appState/harness';
import { PERMISSION_FEATURES } from './permissionFeatures';
import type { QueryPermissionsResponse } from './permissionRead';
import { POD_PERMISSIONS, WORKLOAD_PERMISSIONS } from './permissionSpecs';
import {
  getPermissionKey,
  getPermissionQueryDiagnosticsSnapshot,
  getUserPermissionMap,
  initializePermissionStore,
  queryClusterPermissions,
  queryNamespacesPermissions,
  queryPermissionChecks,
  resetPermissionStore,
  setActivePermissionCluster,
  subscribeUserPermissions,
} from './permissionStore';

const app = installAppStateHarness();

interface ResultFields {
  allowed: boolean;
  source: string;
  reason?: string;
  error?: string;
}

/** The backend's response with `fields` for each query (backend/resource_gateway_permissions.go). */
const respond = (
  queries: PermissionQuery[] | null,
  fields: (query: PermissionQuery) => ResultFields,
  diagnostics: QueryPermissionsResponse['diagnostics'] = []
) => ({
  results: (queries ?? []).map((query) => ({ ...query, ...fields(query) })),
  diagnostics: diagnostics ?? [],
});

const answerEach = (fields: (query: PermissionQuery) => ResultFields) => {
  app.backend.answer('QueryPermissions', (queries) => respond(queries, fields));
};

/** The query batch of every QueryPermissions call, in order. */
const checks = () => app.backend.calls('QueryPermissions').map(([queries]) => queries ?? []);

/** The backend's answer while a cluster's connection is still starting. */
const notActive = (kind: string, clusterId: string) =>
  `failed to resolve resource kind "${kind}": cluster ${clusterId} not active`;

const permission = (
  kind: string,
  verb: string,
  namespace: string | null,
  clusterId: string,
  subresource: string | null = null
) => getUserPermissionMap().get(getPermissionKey(kind, verb, namespace, subresource, clusterId));

const settle = () => app.settle();

afterEach(() => {
  vi.useRealTimers();
});

describe('permission keys', () => {
  it('keeps case-distinct cluster grants separate through batching and lookup', async () => {
    app.permissions((query) => query.clusterId === 'config:Production');

    await queryNamespacesPermissions(
      [
        { clusterId: 'config:Production', namespace: 'default' },
        { clusterId: 'config:production', namespace: 'default' },
      ],
      { specLists: [POD_PERMISSIONS] }
    );

    expect(permission('Pod', 'delete', 'default', 'config:Production')?.allowed).toBe(true);
    expect(permission('Pod', 'delete', 'default', 'config:production')?.allowed).toBe(false);
    expect(checks()[0]?.every((query) => query.group === '' && query.version === 'v1')).toBe(true);
  });

  // Regression: kind-only lookups (ClusterResourcesManager, useUserPermission)
  // missed answers stored under the resolved built-in group/version, so Nodes
  // showed "missing permission" while the Nodes view worked.
  it('finds a built-in kind’s answer by a kind-only lookup, keeping subresources apart', async () => {
    app.denyPermissions([
      { verb: 'update', resourceKind: 'Deployment', namespace: 'default', subresource: 'scale' },
    ]);
    queryClusterPermissions('cluster-1');
    await queryNamespacesPermissions([{ clusterId: 'cluster-1', namespace: 'default' }], {
      specLists: [WORKLOAD_PERMISSIONS],
    });
    await settle();

    expect(
      checks()
        .flat()
        .find((query) => query.resourceKind === 'Deployment')
    ).toMatchObject({ group: 'apps', version: 'v1' });
    expect(permission('Node', 'list', null, 'cluster-1')).toMatchObject({
      allowed: true,
      pending: false,
    });
    expect(permission('Deployment', 'update', 'default', 'cluster-1')?.allowed).toBe(true);
    expect(permission('Deployment', 'update', 'default', 'cluster-1', 'scale')?.allowed).toBe(
      false
    );
  });

  it('keeps answers for custom kinds that share a name apart by group', async () => {
    app.permissions((query) => query.group === 'rds.services.k8s.aws');
    const deleteCheck = (group: string) => ({
      clusterId: 'cluster-1',
      resourceKind: 'DBInstance',
      verb: 'delete',
      namespace: 'default',
      group,
      version: 'v1alpha1',
    });
    queryPermissionChecks([deleteCheck('rds.services.k8s.aws')]);
    queryPermissionChecks([deleteCheck('documentdb.services.k8s.aws')]);
    await settle();

    const lookup = (group?: string) =>
      getUserPermissionMap().get(
        getPermissionKey(
          'DBInstance',
          'delete',
          'default',
          null,
          'cluster-1',
          group,
          group ? 'v1alpha1' : undefined
        )
      );
    expect(lookup('rds.services.k8s.aws')?.allowed).toBe(true);
    expect(lookup('documentdb.services.k8s.aws')?.allowed).toBe(false);
    // A lookup without the group/version cannot pick either one.
    expect(lookup()).toBeUndefined();
  });
});

describe('queryNamespacesPermissions', () => {
  it('ignores empty inputs, invalid identities, and duplicate namespace targets', async () => {
    await queryNamespacesPermissions([], { specLists: [POD_PERMISSIONS] });
    await queryNamespacesPermissions([{ namespace: 'default', clusterId: 'cluster-1' }], {
      specLists: [],
    });
    await queryNamespacesPermissions(
      [
        { namespace: '   ', clusterId: 'cluster-1' },
        { namespace: 'default', clusterId: '   ' },
        { namespace: ' default ', clusterId: 'cluster-1' },
        { namespace: 'default', clusterId: 'cluster-1' },
      ],
      { specLists: [POD_PERMISSIONS] }
    );

    expect(checks()).toHaveLength(1);
    expect(new Set(checks()[0]?.map((query) => `${query.clusterId}|${query.namespace}`))).toEqual(
      new Set(['cluster-1|default'])
    );
  });

  it('checks many namespaces in one QueryPermissions call for a scoped spec list', async () => {
    await queryNamespacesPermissions(
      [
        { namespace: 'default', clusterId: 'cluster-1' },
        { namespace: 'kube-system', clusterId: 'cluster-1' },
      ],
      { specLists: [POD_PERMISSIONS] }
    );

    expect(checks()).toHaveLength(1);
    const batch = checks()[0] ?? [];
    expect(batch).toHaveLength(POD_PERMISSIONS.specs.length * 2);
    expect(new Set(batch.map((query) => query.namespace))).toEqual(
      new Set(['default', 'kube-system'])
    );
    expect(new Set(batch.map((query) => query.resourceKind))).toEqual(new Set(['Pod']));
  });

  it('tracks freshness by namespace and spec list instead of suppressing later feature checks', async () => {
    const target = [{ namespace: 'default', clusterId: 'cluster-1' }];
    await queryNamespacesPermissions(target, { specLists: [POD_PERMISSIONS] });
    await queryNamespacesPermissions(target, { specLists: [POD_PERMISSIONS] });
    await queryNamespacesPermissions(target, { specLists: [WORKLOAD_PERMISSIONS] });

    expect(checks()).toHaveLength(2);
    const workloads = checks()[1] ?? [];
    expect(workloads).toHaveLength(WORKLOAD_PERMISSIONS.specs.length);
    expect(new Set(workloads.map((query) => query.resourceKind))).toContain('Deployment');
  });

  it('bypasses the freshness interval only when force is requested', async () => {
    const target = [{ namespace: 'default', clusterId: 'cluster-1' }];
    await queryNamespacesPermissions(target, { specLists: [POD_PERMISSIONS] });
    await queryNamespacesPermissions(target, { force: true, specLists: [POD_PERMISSIONS] });

    expect(checks()).toHaveLength(2);
  });

  it('publishes a definitive answer as ready and a failed review as an error', async () => {
    answerEach((query) =>
      query.verb === 'delete'
        ? { allowed: false, source: 'error', error: 'review failed' }
        : { allowed: true, source: 'ssrr' }
    );

    await queryNamespacesPermissions([{ namespace: 'team-a', clusterId: 'cluster-1' }], {
      specLists: [POD_PERMISSIONS],
    });

    expect(permission('Pod', 'list', 'team-a', 'cluster-1')).toMatchObject({
      allowed: true,
      pending: false,
      source: 'ssrr',
      error: null,
      entry: { status: 'ready' },
    });
    expect(permission('Pod', 'delete', 'team-a', 'cluster-1')).toMatchObject({
      allowed: false,
      pending: false,
      error: 'review failed',
      entry: { status: 'error' },
    });
  });

  it('materializes transport failures as cluster-scoped permission errors', async () => {
    app.backend.answer('QueryPermissions', () => {
      throw new Error('permission transport failed');
    });

    await queryNamespacesPermissions([{ namespace: 'team-a', clusterId: 'cluster-1' }], {
      specLists: [POD_PERMISSIONS],
    });

    expect(permission('Pod', 'delete', 'team-a', 'cluster-1')).toMatchObject({
      allowed: false,
      pending: false,
      error: 'Error: permission transport failed',
      descriptor: {
        clusterId: 'cluster-1',
        group: '',
        version: 'v1',
        resourceKind: 'Pod',
        namespace: 'team-a',
      },
    });
  });
});

describe('queryNamespacesPermissions transient errors', () => {
  /** The first namespace check finds the cluster not active; later ones succeed. */
  const answerNotActiveOnce = () => {
    let namespaceChecks = 0;
    answerEach((query) => {
      if (query.namespace !== 'team-a') {
        return { allowed: true, source: 'ssar' };
      }
      return namespaceChecks++ < POD_PERMISSIONS.specs.length
        ? { allowed: false, source: 'error', error: notActive('Pod', query.clusterId) }
        : { allowed: true, source: 'ssrr' };
    });
  };

  it('does not cache cluster-not-active responses as namespace permission denials', async () => {
    answerNotActiveOnce();

    await queryNamespacesPermissions([{ namespace: 'team-a', clusterId: 'cluster-1' }], {
      specLists: [POD_PERMISSIONS],
    });

    expect(permission('Pod', 'delete', 'team-a', 'cluster-1')).toBeUndefined();
  });

  it('does not freshness-block a retry after a transient failure', async () => {
    answerNotActiveOnce();
    const target = [{ namespace: 'team-a', clusterId: 'cluster-1' }];

    await queryNamespacesPermissions(target, { specLists: [POD_PERMISSIONS] });
    await queryNamespacesPermissions(target, { specLists: [POD_PERMISSIONS] });

    expect(checks()).toHaveLength(2);
    expect(permission('Pod', 'delete', 'team-a', 'cluster-1')).toMatchObject({
      allowed: true,
      pending: false,
    });
  });

  it('re-issues recorded namespace checks when their cluster becomes operational', async () => {
    answerNotActiveOnce();
    // The active cluster is a different cluster: the namespace's own cluster
    // becoming operational heals its checks.
    initializePermissionStore('cluster-active');
    await settle();
    await queryNamespacesPermissions([{ namespace: 'team-a', clusterId: 'cluster-1' }], {
      specLists: [POD_PERMISSIONS],
    });
    expect(permission('Pod', 'delete', 'team-a', 'cluster-1')).toBeUndefined();

    // The lifecycle input the cluster workspace forwards to the app's event bus.
    eventBus.emit('cluster:lifecycle', { clusterId: 'cluster-1', state: 'degraded' });
    await settle();

    expect(permission('Pod', 'delete', 'team-a', 'cluster-1')).toMatchObject({
      allowed: true,
      pending: false,
    });
  });
});

describe('queryClusterPermissions', () => {
  it('shows only cluster-wide binding list checks for Identities while retaining RBAC diagnostics', async () => {
    app.permissions((query) => !['ServiceAccount', 'RoleBinding'].includes(query.resourceKind));
    queryClusterPermissions('cluster-a');
    queryClusterPermissions('cluster-b');
    await queryNamespacesPermissions([{ clusterId: 'cluster-a', namespace: 'payments' }]);
    await settle();
    expect(permission('ClusterRoleBinding', 'list', null, 'cluster-a')?.pending).toBe(false);

    const rowsFor = (tab: 'identities' | 'rbac' | 'browse') =>
      buildPermissionRows({
        permissionMap: getUserPermissionMap(),
        capabilityDescriptorIndex: new Map(),
        scopedFeatures: getScopedFeaturesForView('cluster', tab, 'rbac'),
        viewType: 'cluster',
        selectedClusterId: 'cluster-a',
      });
    expect(
      rowsFor('identities').map(({ resource, verb, scope, isDenied, clusterId, feature }) => ({
        resource,
        verb,
        scope,
        isDenied,
        clusterId,
        feature,
      }))
    ).toEqual([
      {
        resource: 'ClusterRoleBinding',
        verb: 'list',
        scope: 'Cluster',
        isDenied: false,
        clusterId: 'cluster-a',
        feature: PERMISSION_FEATURES.clusterIdentities,
      },
      {
        resource: 'RoleBinding',
        verb: 'list',
        scope: 'Cluster',
        isDenied: true,
        clusterId: 'cluster-a',
        feature: PERMISSION_FEATURES.clusterIdentities,
      },
    ]);
    expect(rowsFor('rbac')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resource: 'ClusterRoleBinding',
          verb: 'list',
          feature: PERMISSION_FEATURES.clusterRBAC,
        }),
        expect.objectContaining({ resource: 'ClusterRole', verb: 'delete' }),
      ])
    );
    expect(rowsFor('rbac').some((row) => row.resource === 'RoleBinding')).toBe(false);
    const sharedKey = getPermissionKey('ClusterRoleBinding', 'list', null, null, 'cluster-a');
    expect(rowsFor('browse').find((row) => row.id === sharedKey)?.feature).toBe(
      PERMISSION_FEATURES.clusterRBAC
    );
    expect(getUserPermissionMap().get(sharedKey)?.feature).toBe(PERMISSION_FEATURES.clusterRBAC);
  });

  it('does not cache cluster-not-active responses as permission errors', async () => {
    answerEach((query) => ({
      allowed: false,
      source: 'error',
      error: notActive(query.resourceKind, query.clusterId),
    }));

    queryClusterPermissions('cluster-1');
    await settle();

    expect(checks()).toHaveLength(1);
    expect(getUserPermissionMap().size).toBe(0);
  });

  it('retries cluster permissions when the selected cluster becomes ready', async () => {
    let clusterActive = false;
    answerEach((query) =>
      clusterActive
        ? { allowed: true, source: 'ssar' }
        : { allowed: false, source: 'error', reason: notActive('Node', query.clusterId) }
    );

    initializePermissionStore('cluster-1');
    await settle();
    expect(checks()).toHaveLength(1);
    expect(getUserPermissionMap().size).toBe(0);

    clusterActive = true;
    eventBus.emit('cluster:lifecycle', { clusterId: 'cluster-1', state: 'ready' });
    await settle();

    expect(checks()).toHaveLength(2);
    expect(permission('Node', 'patch', null, 'cluster-1')).toMatchObject({
      allowed: true,
      pending: false,
    });
  });
});

describe('permission store reset ownership', () => {
  it('does not start staggered namespace refreshes after reset', async () => {
    vi.useFakeTimers();
    initializePermissionStore('cluster-a');
    await settle();
    await queryNamespacesPermissions(
      [
        { clusterId: 'cluster-a', namespace: 'alpha' },
        { clusterId: 'cluster-a', namespace: 'beta' },
      ],
      { specLists: [POD_PERMISSIONS] }
    );
    const beforeRefresh = checks().length;

    // The refresh interval re-checks expired namespaces 500 ms apart.
    await vi.advanceTimersByTimeAsync(120_000);
    await settle();
    const refreshed = checks().slice(beforeRefresh);
    expect(refreshed.some((batch) => batch.some((query) => query.namespace === 'alpha'))).toBe(
      true
    );
    expect(refreshed.some((batch) => batch.some((query) => query.namespace === 'beta'))).toBe(
      false
    );

    const beforeReset = checks().length;
    resetPermissionStore();
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();

    expect(checks()).toHaveLength(beforeReset);
    expect(getUserPermissionMap().size).toBe(0);
  });

  it.each(['namespace', 'cluster', 'kind'] as const)(
    'ignores a completed %s check from before reset while a replacement is pending',
    async (kind) => {
      const completions: Array<{
        queries: PermissionQuery[];
        resolve: (response: ReturnType<typeof respond>) => void;
      }> = [];
      app.backend.answer(
        'QueryPermissions',
        (queries) =>
          new Promise((resolve) => {
            completions.push({ queries: queries ?? [], resolve });
          })
      );
      const start = () => {
        if (kind === 'namespace') {
          return queryNamespacesPermissions([{ clusterId: 'cluster-a', namespace: 'default' }], {
            specLists: [POD_PERMISSIONS],
          });
        }
        if (kind === 'cluster') {
          return queryClusterPermissions('cluster-a');
        }
        return queryPermissionChecks([
          {
            clusterId: 'cluster-a',
            resourceKind: 'Pod',
            verb: 'delete',
            namespace: 'default',
            group: '',
            version: 'v1',
          },
        ]);
      };
      const complete = async (index: number, allowed: boolean) => {
        const completion = completions[index];
        completion?.resolve(
          respond(completion.queries, () => ({ allowed, source: 'ssar', reason: '' }))
        );
        await settle();
      };

      const first = start();
      await settle();
      expect(completions).toHaveLength(1);
      resetPermissionStore();
      expect(getUserPermissionMap().size).toBe(0);

      const replacement = start();
      await settle();
      expect(completions).toHaveLength(2);
      const key = completions[1]?.queries[0]?.id ?? '';
      expect(getUserPermissionMap().get(key)?.pending).toBe(true);

      await complete(0, true);
      await first;
      expect(getUserPermissionMap().get(key)).toMatchObject({ allowed: false, pending: true });

      await complete(1, false);
      await replacement;
      expect(getUserPermissionMap().get(key)).toMatchObject({ allowed: false, pending: false });
    }
  );
});

describe('permission store notifications', () => {
  it('notifies permission subscribers asynchronously', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const unsubscribe = subscribeUserPermissions(listener);

    resetPermissionStore();

    expect(listener).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('coalesces multiple synchronous permission-store writes into one notification tick', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const unsubscribe = subscribeUserPermissions(listener);

    resetPermissionStore();
    resetPermissionStore();

    expect(listener).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});

describe('setActivePermissionCluster', () => {
  it('initializes and checks cluster permissions when the cluster is operational', async () => {
    setActivePermissionCluster('cluster-a');
    await settle();

    expect(checks()).toHaveLength(1);
    expect(permission('Node', 'patch', null, 'cluster-a')).toMatchObject({
      allowed: true,
      pending: false,
    });
  });

  it('trims the cluster id before initializing', async () => {
    setActivePermissionCluster('  cluster-a  ');
    await settle();

    const batch = checks()[0] ?? [];
    expect(batch.length).toBeGreaterThan(0);
    expect(batch.every((query) => query.clusterId === 'cluster-a')).toBe(true);
  });

  it('keeps existing entries and checks nothing for a non-operational cluster', async () => {
    setActivePermissionCluster('cluster-a');
    await settle();
    const sizeBefore = getUserPermissionMap().size;
    expect(sizeBefore).toBeGreaterThan(0);
    const checksBefore = checks().length;

    setActivePermissionCluster('cluster-b', { operational: false });
    await settle();

    // A not-ready ACTIVE cluster must not wipe the store: other clusters'
    // and other namespaces' permissions stay valid, and one-shot consumers
    // (open object panels) have no re-query path after a wipe.
    expect(checks()).toHaveLength(checksBefore);
    expect(getUserPermissionMap().size).toBe(sizeBefore);
    // The id is still recorded as the fallback for key building.
    expect(getPermissionKey('Pod', 'get', 'ns')).toMatch(/^cluster-b\|/);
  });

  it('checks once a previously waiting cluster becomes operational', async () => {
    setActivePermissionCluster('cluster-a', { operational: false });
    await settle();
    expect(checks()).toEqual([]);

    setActivePermissionCluster('cluster-a', { operational: true });
    await settle();

    expect(checks()).toHaveLength(1);
  });

  it('resets the store when no cluster is selected', async () => {
    setActivePermissionCluster('cluster-a');
    await settle();
    expect(getUserPermissionMap().size).toBeGreaterThan(0);
    const checksBefore = checks().length;

    setActivePermissionCluster('   ');

    expect(getUserPermissionMap().size).toBe(0);
    expect(checks()).toHaveLength(checksBefore);
  });
});

describe('permission check completion contracts', () => {
  it('keeps overlapping namespace checks pending until each feature batch completes', async () => {
    const finish: Array<() => void> = [];
    app.backend.answer(
      'QueryPermissions',
      (queries) =>
        new Promise((resolve) => {
          finish.push(() =>
            resolve(
              respond(queries, () => ({ allowed: true, source: 'ssar' }), [
                {
                  key: 'cluster-1|team-a',
                  clusterId: 'cluster-1',
                  namespace: 'team-a',
                  method: 'ssar',
                  ssrrIncomplete: true,
                  ssrrRuleCount: 3,
                  ssarFallbackCount: queries?.length ?? 0,
                  checkCount: queries?.length ?? 0,
                },
              ])
            )
          );
        })
    );
    const targets = [{ clusterId: 'cluster-1', namespace: 'team-a' }];
    const pods = queryNamespacesPermissions(targets, { specLists: [POD_PERMISSIONS] });
    const workloads = queryNamespacesPermissions(targets, { specLists: [WORKLOAD_PERMISSIONS] });
    await settle();
    expect(finish).toHaveLength(2);
    const workloadChecks = checks()[1]?.length ?? 0;

    finish[0]?.();
    await pods;
    expect(getPermissionQueryDiagnosticsSnapshot()).toEqual([
      expect.objectContaining({
        pendingCount: workloadChecks,
        inFlightCount: workloadChecks,
        method: 'ssar',
        ssrrIncomplete: true,
        ssrrRuleCount: 3,
        lastResult: 'success',
      }),
    ]);

    finish[1]?.();
    await workloads;
    expect(getPermissionQueryDiagnosticsSnapshot()).toEqual([
      expect.objectContaining({
        pendingCount: 0,
        inFlightCount: 0,
        inFlightStartedAt: undefined,
        ssarFallbackCount: workloadChecks,
        consecutiveFailureCount: 0,
      }),
    ]);
  });

  it('preserves cluster identity and failure state when a cluster permission check rejects', async () => {
    app.backend.answer('QueryPermissions', () => {
      throw new Error('offline');
    });

    queryClusterPermissions('cluster-1');
    await settle();

    expect(permission('Node', 'list', null, 'cluster-1')).toMatchObject({
      allowed: false,
      pending: false,
      source: 'error',
      error: 'Error: offline',
      descriptor: { clusterId: 'cluster-1', group: '', version: 'v1', namespace: null },
    });
    expect(getPermissionQueryDiagnosticsSnapshot()).toEqual([
      expect.objectContaining({
        key: 'cluster-1|__cluster__',
        pendingCount: 0,
        inFlightCount: 0,
        method: 'ssar',
        lastResult: 'error',
        consecutiveFailureCount: 1,
      }),
    ]);
  });

  it('retains custom-kind identity and denial reasons without sharing freshness across API groups', async () => {
    answerEach(() => ({ allowed: false, source: 'denied', reason: 'RBAC denied' }));
    const queryKind = (group: string) =>
      queryPermissionChecks(
        ['delete', 'patch'].map((verb) => ({
          clusterId: 'cluster-1',
          resourceKind: 'Widget',
          verb,
          namespace: 'team-a',
          group,
          version: 'v1',
        }))
      );
    const key = getPermissionKey(
      'Widget',
      'delete',
      'team-a',
      null,
      'cluster-1',
      'first.example',
      'v1'
    );

    queryKind('first.example');
    await settle();

    expect(getUserPermissionMap().get(key)).toMatchObject({
      allowed: false,
      pending: false,
      reason: 'RBAC denied',
      error: null,
      feature: PERMISSION_FEATURES.objectActions,
      descriptor: {
        clusterId: 'cluster-1',
        group: 'first.example',
        version: 'v1',
        namespace: 'team-a',
      },
    });

    queryKind('first.example');
    queryKind('second.example');
    await settle();

    expect(checks()).toHaveLength(2);
    expect(checks()[1]?.every((query) => query.group === 'second.example')).toBe(true);
  });

  it('clears pending custom-kind checks after transport failure and retains their retry interval', async () => {
    app.backend.answer('QueryPermissions', () => {
      throw new Error('offline');
    });
    const key = getPermissionKey('Widget', 'patch', null, null, 'cluster-1', 'example.io', 'v1');
    const query = () =>
      queryPermissionChecks([
        {
          clusterId: 'cluster-1',
          resourceKind: 'Widget',
          verb: 'patch',
          group: 'example.io',
          version: 'v1',
        },
      ]);

    query();
    expect(getUserPermissionMap().get(key)?.pending).toBe(true);
    await settle();
    expect(getUserPermissionMap().has(key)).toBe(false);

    query();

    expect(checks()).toHaveLength(1);
  });
});
