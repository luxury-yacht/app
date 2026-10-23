/**
 * frontend/src/core/capabilities/hooks.test.tsx
 *
 * useCapabilities answers whether the UI may act. Kind-level capabilities
 * come from the permission store that the app fills when a cluster connects
 * and a namespace is selected; until a check answers, a capability is pending
 * and never allowed, and a failed check is an error rather than a denial.
 * Named-object capabilities are checked with the object's complete identity,
 * only once their cluster is operational, never reuse another object's answer
 * (even one that arrives late), keep denials, review errors, and transient
 * activation failures distinct, and re-check on demand or when the cluster
 * becomes ready. useCapabilityDiagnostics follows checks in flight. Runs inside
 * the production shell over a faked backend (test-utils/appState); permission
 * answers come from the faked QueryPermissions RPC.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import {
  installAppStateHarness,
  type MountedApp,
  type PermissionQuery,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import {
  type UseCapabilitiesOptions,
  type UseCapabilitiesResult,
  useCapabilities,
  useCapabilityDiagnostics,
} from './hooks';
import type { PermissionQueryDiagnostics } from './permissionTypes';
import type { CapabilityDescriptor } from './types';

const app = installAppStateHarness();

let capabilitiesResult: UseCapabilitiesResult | null = null;
let diagnosticsResult: PermissionQueryDiagnostics[] | null = null;

function CapabilitiesProbe({
  descriptors,
  options,
}: Readonly<{ descriptors: CapabilityDescriptor[]; options?: UseCapabilitiesOptions }>) {
  capabilitiesResult = useCapabilities(descriptors, options);
  return null;
}

function DiagnosticsProbe() {
  diagnosticsResult = useCapabilityDiagnostics();
  return null;
}

const capabilities = () => requireValue(capabilitiesResult, 'expected useCapabilities to render');

let view: MountedApp;

const openCluster = (
  name: string,
  context: string,
  lifecycle?: backend.ClusterLifecycleState
): TestCluster => {
  const cluster = app.cluster({ name, context, lifecycle });
  app.namespaces(cluster, ['alpha', 'beta']);
  return cluster;
};

const start = async () => {
  view = await app.render(null);
};

const show = (descriptors: CapabilityDescriptor[], options?: UseCapabilitiesOptions) =>
  view.show(<CapabilitiesProbe descriptors={descriptors} options={options} />);

const selectNamespace = async (cluster: TestCluster, namespace: string) => {
  await act(async () => {
    view.owners().namespace.setSelectedNamespace(namespace, cluster.clusterId);
  });
  await app.settle();
};

/** QueryPermissions calls that checked a named object (not the app's kind-level checks). */
const namedChecks = () =>
  app.backend
    .calls('QueryPermissions')
    .map(([queries]) => queries ?? [])
    .filter((queries) => queries.some((query) => query.name));

interface ResultFields {
  allowed: boolean;
  source: string;
  reason?: string;
  error?: string;
}

/** The backend's response with `fields` for each query (backend/resource_gateway_permissions.go). */
const respond = (
  queries: PermissionQuery[] | null,
  fields: (query: PermissionQuery) => ResultFields
) => ({
  results: (queries ?? []).map((query) => ({ ...query, ...fields(query) })),
  diagnostics: [],
});

const allowedBySsar = (): ResultFields => ({ allowed: true, source: 'ssar' });

const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const settle = async (run?: () => void) => {
  await act(async () => {
    run?.();
  });
  await app.settle();
};

const namedPod = (cluster: TestCluster, overrides: Partial<CapabilityDescriptor> = {}) =>
  ({
    id: 'edit-yaml',
    clusterId: cluster.clusterId,
    group: '',
    version: 'v1',
    resourceKind: 'Pod',
    verb: 'patch',
    namespace: 'alpha',
    name: 'api',
    ...overrides,
  }) satisfies CapabilityDescriptor;

const namedNode = (cluster: TestCluster): CapabilityDescriptor => ({
  id: 'cordon',
  clusterId: cluster.clusterId,
  group: '',
  version: 'v1',
  resourceKind: 'Node',
  verb: 'patch',
  name: 'node-a',
});

// The permission store notifies its subscribers on a zero-delay timer;
// fake timers let app.settle deliver it.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCapabilities with kind-level capabilities', () => {
  it('keeps a capability no check has covered pending and not allowed', async () => {
    const dev = openCluster('dev', 'alpha');
    await start();
    await show([
      {
        id: 'delete-pod',
        clusterId: dev.clusterId,
        resourceKind: 'Pod',
        verb: 'delete',
        namespace: 'beta',
      },
    ]);

    expect(capabilities().isAllowed('delete-pod')).toBe(false);
    expect(capabilities().getState('delete-pod')).toMatchObject({ pending: true, status: 'idle' });
    expect(capabilities().loading).toBe(true);
    expect(capabilities().ready).toBe(false);
  });

  it('answers cluster capabilities on connect and namespace capabilities once the namespace is selected', async () => {
    const dev = openCluster('dev', 'alpha');
    app.denyPermissions([{ verb: 'delete', resourceKind: 'Pod', namespace: 'alpha' }]);
    await start();
    await show([
      { id: 'list-nodes', clusterId: dev.clusterId, resourceKind: 'Node', verb: 'list' },
      {
        id: 'delete-pod',
        clusterId: dev.clusterId,
        resourceKind: 'Pod',
        verb: 'delete',
        namespace: 'alpha',
      },
    ]);
    expect(capabilities().isAllowed('list-nodes')).toBe(true);
    expect(capabilities().getState('delete-pod').pending).toBe(true);

    const release = app.backend.hold('QueryPermissions');
    await selectNamespace(dev, 'alpha');
    expect(capabilities().getState('delete-pod')).toMatchObject({
      allowed: false,
      pending: true,
      status: 'loading',
    });
    expect(capabilities().loading).toBe(true);

    await settle(release);

    expect(capabilities().getState('delete-pod')).toMatchObject({
      allowed: false,
      pending: false,
      status: 'ready',
      reason: 'no matching rule',
    });
    expect(capabilities().loading).toBe(false);
    expect(capabilities().ready).toBe(true);
  });

  it('reports a namespace check that failed as an error, not a denial', async () => {
    const dev = openCluster('dev', 'alpha');
    app.backend.answer('QueryPermissions', (queries) => {
      if (queries?.some((query) => query.namespace === 'alpha')) {
        throw new Error('permission transport failed');
      }
      return respond(queries, allowedBySsar);
    });
    await start();
    await show([
      {
        id: 'delete-pod',
        clusterId: dev.clusterId,
        resourceKind: 'Pod',
        verb: 'delete',
        namespace: 'alpha',
      },
    ]);
    await selectNamespace(dev, 'alpha');

    expect(capabilities().getState('delete-pod')).toMatchObject({
      allowed: false,
      pending: false,
      status: 'error',
      reason: 'Error: permission transport failed',
    });
    expect(capabilities().ready).toBe(true);
  });

  it('matches a padded descriptor to its trimmed identity and ignores one without an id', async () => {
    const dev = openCluster('dev', 'alpha');
    await start();
    await show([
      {
        id: ' list-nodes ',
        clusterId: ` ${dev.clusterId} `,
        resourceKind: ' Node ',
        verb: ' LIST ',
      },
      { id: '', clusterId: dev.clusterId, resourceKind: 'Pod', verb: 'delete' },
    ]);

    expect(capabilities().getState('list-nodes')).toMatchObject({
      allowed: true,
      status: 'ready',
    });
    expect(capabilities().ready).toBe(true);
  });

  it('evaluates and checks nothing while disabled', async () => {
    const dev = openCluster('dev', 'alpha');
    await start();
    await show(
      [
        { id: 'list-nodes', clusterId: dev.clusterId, resourceKind: 'Node', verb: 'list' },
        namedPod(dev),
      ],
      { enabled: false }
    );

    expect(namedChecks()).toEqual([]);
    expect(capabilities().getState('list-nodes')).toMatchObject({
      allowed: false,
      status: 'idle',
    });
    expect(capabilities().loading).toBe(false);
    expect(capabilities().ready).toBe(false);
  });
});

describe('useCapabilities with named-object capabilities', () => {
  it('checks a named object with its complete identity', async () => {
    const dev = openCluster('dev', 'alpha');
    await start();
    await show([namedPod(dev)]);

    const checks = namedChecks().flat();
    expect(checks.length).toBeGreaterThan(0);
    expect(checks).toEqual(
      checks.map(() =>
        expect.objectContaining({
          clusterId: dev.clusterId,
          group: '',
          version: 'v1',
          resourceKind: 'Pod',
          verb: 'patch',
          namespace: 'alpha',
          name: 'api',
        })
      )
    );
    expect(capabilities().getState('edit-yaml')).toMatchObject({
      allowed: true,
      pending: false,
      status: 'ready',
    });
  });

  it.each(['clusterId', 'group', 'version', 'name'] as const)(
    'does not reuse a named answer after the object’s %s changes',
    async (field) => {
      // Two contexts whose cluster ids differ only by case.
      const upper = openCluster('config', 'Production');
      const lower = openCluster('config', 'production');
      const descriptor = namedPod(upper);
      const changed = {
        ...descriptor,
        [field]: field === 'clusterId' ? lower.clusterId : 'other',
      };
      // Only the original object is allowed.
      app.permissions(
        (query) =>
          !query.name ||
          (query.clusterId === descriptor.clusterId &&
            query.group === descriptor.group &&
            query.version === descriptor.version &&
            query.name === descriptor.name)
      );
      await start();
      await show([descriptor]);
      expect(capabilities().isAllowed('edit-yaml')).toBe(true);

      const release = app.backend.hold('QueryPermissions');
      await show([changed]);
      expect(capabilities().getState('edit-yaml')).toMatchObject({
        allowed: false,
        pending: true,
      });

      await settle(release);
      expect(capabilities().getState('edit-yaml')).toMatchObject({
        allowed: false,
        pending: false,
      });
    }
  );

  it.each(['resolve', 'reject'] as const)(
    'ignores the previous object’s check when it %ss after a switch',
    async (settlement) => {
      const devA = openCluster('dev', 'a');
      const devB = openCluster('dev', 'b');
      // Every check of the first object answers only after the switch.
      const previous = deferred();
      app.backend.answer('QueryPermissions', async (queries) => {
        if (!queries?.some((query) => query.name)) {
          return respond(queries, allowedBySsar);
        }
        if (queries.some((query) => query.clusterId === devA.clusterId)) {
          await previous.promise;
          return respond(queries, allowedBySsar);
        }
        return respond(queries, () => ({ allowed: false, source: 'ssar', reason: 'denied' }));
      });
      await start();
      await show([namedPod(devA)]);
      await show([namedPod(devB)]);
      expect(capabilities().getState('edit-yaml')).toMatchObject({
        allowed: false,
        status: 'ready',
      });

      await settle(() => {
        if (settlement === 'resolve') {
          previous.resolve();
        } else {
          previous.reject(new Error('previous cluster disconnected'));
        }
      });

      expect(capabilities().getState('edit-yaml')).toMatchObject({
        allowed: false,
        status: 'ready',
      });
    }
  );

  it('keeps named denials, review errors, and transient activation failures distinct', async () => {
    const dev = openCluster('dev', 'alpha');
    const outcomes: Record<string, ResultFields> = {
      allowed: { allowed: true, source: 'ssar' },
      denied: { allowed: false, source: 'ssar', reason: 'RBAC denied' },
      failed: { allowed: false, source: 'error', error: 'review failed' },
      inactive: { allowed: false, source: 'error', error: `cluster ${dev.clusterId} not active` },
    };
    app.backend.answer('QueryPermissions', (queries) =>
      respond(queries, (query) => (query.name ? outcomes[query.name] : allowedBySsar()))
    );
    await start();
    await show(Object.keys(outcomes).map((id) => namedPod(dev, { id, name: id })));

    expect(capabilities().getState('allowed')).toMatchObject({
      allowed: true,
      pending: false,
      status: 'ready',
    });
    expect(capabilities().getState('denied')).toMatchObject({
      allowed: false,
      pending: false,
      status: 'ready',
      reason: 'RBAC denied',
    });
    expect(capabilities().getState('failed')).toMatchObject({
      allowed: false,
      pending: false,
      status: 'error',
      reason: 'review failed',
    });
    expect(capabilities().getState('inactive')).toMatchObject({
      allowed: false,
      pending: true,
      status: 'loading',
    });
    expect(capabilities().loading).toBe(true);
    expect(capabilities().ready).toBe(false);
  });

  it.each([
    ['cluster dev:alpha not active', 'loading', true],
    ['review transport failed', 'error', false],
  ] as const)('publishes a rejected named check “%s” as %s', async (message, status, pending) => {
    const dev = openCluster('dev', 'alpha');
    app.backend.answer('QueryPermissions', (queries) => {
      if (queries?.some((query) => query.name)) {
        throw new Error(message);
      }
      return respond(queries, allowedBySsar);
    });
    await start();
    await show([namedPod(dev)]);

    expect(capabilities().getState('edit-yaml')).toMatchObject({
      allowed: false,
      pending,
      status,
    });
    expect(capabilities().loading).toBe(pending);
    expect(capabilities().ready).toBe(!pending);
  });

  it('re-checks a named object when the refresh key changes', async () => {
    const dev = openCluster('dev', 'alpha');
    const descriptors = [namedPod(dev)];
    await start();
    await show(descriptors, { refreshKey: 0 });
    const checked = namedChecks().length;

    await show(descriptors, { refreshKey: 1 });

    expect(namedChecks()).toHaveLength(checked + 1);
  });

  it('waits for an operational cluster before checking a named object', async () => {
    const dev = openCluster('dev', 'alpha', backend.ClusterLifecycleState.ClusterStateLoadingSlow);
    await start();
    await show([namedNode(dev)]);

    expect(namedChecks()).toEqual([]);
    expect(capabilities().getState('cordon')).toMatchObject({
      allowed: false,
      pending: true,
      status: 'loading',
      reason: 'Cluster is not ready',
    });

    await settle(() => {
      app.events.emit('cluster:lifecycle', { clusterId: dev.clusterId, state: 'degraded' });
    });

    expect(namedChecks()).toHaveLength(1);
    expect(capabilities().getState('cordon')).toMatchObject({
      allowed: true,
      pending: false,
      status: 'ready',
    });
  });

  it('keeps a transient activation failure pending and re-checks when the cluster becomes ready', async () => {
    const dev = openCluster('dev', 'alpha', backend.ClusterLifecycleState.ClusterStateDegraded);
    // The backend reports the cluster not active until it becomes ready.
    let clusterActive = false;
    app.backend.answer('QueryPermissions', (queries) => {
      if (!queries?.some((query) => query.name)) {
        return respond(queries, allowedBySsar);
      }
      return respond(queries, () =>
        !clusterActive
          ? {
              allowed: false,
              source: 'error',
              reason: `failed to resolve resource kind "Node": cluster ${dev.clusterId} not active`,
            }
          : allowedBySsar()
      );
    });
    await start();
    await show([namedNode(dev)]);
    expect(capabilities().getState('cordon')).toMatchObject({
      allowed: false,
      pending: true,
      status: 'loading',
    });
    const checked = namedChecks().length;

    await settle(() => {
      clusterActive = true;
      app.events.emit('cluster:lifecycle', { clusterId: dev.clusterId, state: 'ready' });
    });

    expect(namedChecks()).toHaveLength(checked + 1);
    expect(capabilities().getState('cordon')).toMatchObject({
      allowed: true,
      pending: false,
      status: 'ready',
    });
  });
});

describe('useCapabilityDiagnostics', () => {
  it('follows a namespace’s permission check from in flight to completed', async () => {
    const dev = openCluster('dev', 'alpha');
    await start();
    await view.show(<DiagnosticsProbe />);
    const namespaceEntry = () =>
      requireValue(diagnosticsResult, 'expected useCapabilityDiagnostics to render').find(
        (entry) => entry.clusterId === dev.clusterId && entry.namespace === 'alpha'
      );
    expect(namespaceEntry()).toBeUndefined();

    const release = app.backend.hold('QueryPermissions');
    await selectNamespace(dev, 'alpha');
    expect(namespaceEntry()?.inFlightCount).toBeGreaterThan(0);

    await settle(release);

    expect(namespaceEntry()).toMatchObject({ inFlightCount: 0, lastResult: 'success' });
  });
});
