/**
 * frontend/src/modules/object-panel/identity/IdentityPanel.test.tsx
 *
 * An opened identity panel: it queries the exact subject's bindings, follows
 * the identities domain's change signals,
 * shows partial visibility and errors, and opens binding and role objects
 * with complete identity; a service account opens the resource panel
 * instead. Runs the full app (the panel is hosted and gated as the workspace
 * window hosts it); the backend answers the identities query and its stream
 * through the faked boundary (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { buildRefreshScope, CLUSTER_SELECTOR } from '@/core/refresh/scopeSelector';
import type { ClusterIdentitiesSnapshot, ClusterIdentityBinding } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse, statusResponse } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';
import { type IdentityPanelRef, panelTargetId } from '../panelTarget';

const app = installAppStateHarness({ streams: 'manual' });
let view: MountedApp;
let production: TestCluster;
let staging: TestCluster;

const alice = (): IdentityPanelRef => ({
  targetType: 'identity',
  clusterId: production.clusterId,
  kind: 'User',
  name: ' alice ',
});
const reader = () => ({
  clusterId: production.clusterId,
  group: 'rbac.authorization.k8s.io',
  version: 'v1',
  kind: 'ClusterRole',
  resource: 'clusterroles',
  namespace: '',
  name: 'reader',
});
const teamReaders = (): ClusterIdentityBinding => ({
  ...reader(),
  kind: 'RoleBinding',
  resource: 'rolebindings',
  namespace: 'payments',
  name: 'team-readers',
  role: reader(),
});

const identitiesScope = (cluster: TestCluster) =>
  buildRefreshScope('cluster-identities', {
    clusterId: cluster.clusterId,
    selector: CLUSTER_SELECTOR,
  });

const identityPayload = (
  ref: IdentityPanelRef,
  bindings: ClusterIdentityBinding[],
  overrides: Partial<ClusterIdentitiesSnapshot> = {}
): ClusterIdentitiesSnapshot => ({
  clusterId: ref.clusterId,
  clusterName:
    ref.clusterId === production.clusterId ? production.clusterName : staging.clusterName,
  provider: 'typed-resource',
  table: 'cluster-identities',
  total: 1,
  unfilteredTotal: 1,
  totalIsExact: true,
  facetsExact: true,
  capabilities: {},
  rows: [
    {
      clusterId: ref.clusterId,
      kind: ref.kind,
      name: ref.name,
      bindings,
      grantScopes: ['payments'],
    },
  ],
  completeness: 'complete',
  ...overrides,
});

/** The subject a cluster-identities query asks about, from its scope. */
const queriedSubject = (scope: string) =>
  JSON.parse(new URLSearchParams(scope.split('?')[1]).get('predicate.identity') ?? 'null');

/** The backend answers identities queries with `answer(scope)`, as a new version each time. */
let version = 0;
const answerIdentities = (answer: (scope: string) => Response) => {
  app.snapshots.respond((request) => {
    if (request.domain !== 'cluster-identities') {
      return undefined;
    }
    return answer(request.scope);
  });
};
const identities = (payload: ClusterIdentitiesSnapshot) => (scope: string) => {
  version += 1;
  return snapshotResponse({ domain: 'cluster-identities', scope, version, payload });
};
const identityQueries = () =>
  app.snapshots.reads('cluster-identities').filter((read) => read.scope.includes('?'));

const start = async () => {
  production = app.cluster({ name: 'dev', context: 'production' });
  staging = app.cluster({ name: 'dev', context: 'staging' });
  app.namespaces(production, ['default', 'payments', 'ci']);
  app.namespaces(staging, ['default']);
  app.startScreen(production);
  view = await app.mountApp();
};

/** The live identities domain has loaded: the backend acknowledged its stream. */
const identitiesLive = async (cluster = production) => {
  await act(async () => {
    app.streams.acknowledge('cluster-identities', identitiesScope(cluster));
  });
  await app.settle();
};

const openIdentity = async (ref: IdentityPanelRef) => {
  await act(async () => {
    view.owners().objectPanel.openWithIdentity(ref);
  });
  await app.settle();
};

// The panel's tab strip owns its tabs through aria-owns.
const panelTabs = () =>
  (
    view.container.querySelector('[aria-label="Object Panel Tabs"]')?.getAttribute('aria-owns') ??
    ''
  )
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent);

const buttonNamed = (name: string) =>
  [...view.container.querySelectorAll('button')].find((element) => element.textContent === name);

const click = async (element: HTMLElement | undefined) => {
  await act(async () => {
    requireValue(element, 'control').click();
  });
  await app.settle();
};

/** Serves the details of a binding or role panel a link opens. */
const serveDetails = (identity: ObjectIdentity) => {
  const object = app.object(production, identity);
  app.snapshots.serve('object-details', object.scopes.detailScope ?? '', {
    detailType: identity.kind.toLowerCase(),
    details: { name: identity.name, namespace: identity.namespace },
  } as never);
};

describe('IdentityPanel', () => {
  it('keeps service accounts on the resource panel path', async () => {
    await start();
    const serviceAccount = {
      group: '',
      version: 'v1',
      kind: 'ServiceAccount',
      namespace: 'ci',
      name: 'builder',
    };
    serveDetails(serviceAccount);

    await act(async () => {
      view
        .owners()
        .objectPanel.openWithObject({ clusterId: production.clusterId, ...serviceAccount });
    });
    await app.settle();

    expect(view.openPanels()).toContainEqual(
      expect.objectContaining({ kind: 'ServiceAccount', name: 'builder' })
    );
    expect(identityQueries()).toEqual([]);
  });

  it('queries the exact subject and opens binding and role objects with their complete identity', async () => {
    await start();
    answerIdentities(identities(identityPayload(alice(), [teamReaders()])));
    await openIdentity(alice());
    await identitiesLive();

    expect(identityQueries().map((read) => queriedSubject(read.scope))).toContainEqual([
      production.clusterId,
      'User',
      ' alice ',
    ]);
    expect(view.container.querySelector('.object-name')?.textContent).toBe(' alice ');
    expect(panelTabs()).toEqual(['Details']);

    const {
      role: _role,
      resource: _bindingResource,
      ...binding
    } = {
      ...teamReaders(),
      name: 'team-readers',
      namespace: 'payments',
    };
    const { resource: _roleResource, ...role } = reader();
    serveDetails(binding);
    serveDetails(role);
    await click(buttonNamed('team-readers'));
    expect(view.openPanels()).toContainEqual({ ...binding, clusterName: production.clusterName });
    // The binding's panel is now in front; the user returns to the identity.
    await openIdentity(alice());
    await click(buttonNamed('ClusterRole/reader'));
    expect(view.openPanels()).toContainEqual({ ...role, clusterName: production.clusterName });

    // Closing the identity's tab closes only the identity panel.
    await act(async () => {
      view.owners().objectPanels.closePanel(production.clusterId, panelTargetId(alice()));
    });
    await app.settle();
    expect(view.owners().objectPanels.openPanels.has(panelTargetId(alice()))).toBe(false);
    expect(view.openPanels()).toHaveLength(2);
  });

  it('encodes the complete opaque subject as a three-field query identity', async () => {
    await start();
    const group: IdentityPanelRef = { ...alice(), kind: 'Group', name: ' R&D <ops>   ' };
    answerIdentities(identities(identityPayload(group, [])));

    await openIdentity(group);
    await identitiesLive();

    expect(identityQueries().map((read) => queriedSubject(read.scope))).toContainEqual([
      group.clusterId,
      group.kind,
      group.name,
    ]);
  });

  it('follows the identities domain’s change signals', async () => {
    await start();
    let bindings = [teamReaders()];
    answerIdentities((scope) => identities(identityPayload(alice(), bindings))(scope));

    await openIdentity(alice());
    await identitiesLive();
    expect(buttonNamed('team-readers')).toBeDefined();

    // The binding is deleted; the domain rings its object clock.
    bindings = [];
    await act(async () => {
      app.streams.ring('cluster-identities', identitiesScope(production), 'object', 'v2');
      // Signals apply after the stream's 150 ms coalescing window
      // (resourceStreamManager.ts UPDATE_COALESCE_MS).
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    await app.settle();

    expect(buttonNamed('team-readers')).toBeUndefined();
    expect(view.container.querySelector('.overview-value')?.textContent).toBe(
      production.clusterName
    );
    expect(view.container.textContent).toContain('No direct bindings');
  });

  it('exposes partial visibility and replaces prior rows when switching subjects or encountering an error', async () => {
    await start();
    const partial = identityPayload(alice(), [{ ...teamReaders(), role: undefined }], {
      completeness: 'partial',
      // As backend/refresh/snapshot/table_query_issues.go reports an unavailable source.
      issues: [
        {
          kind: 'RoleBinding',
          message: 'RoleBinding resources are unavailable; table data is partial',
        },
      ],
    });
    answerIdentities(identities(partial));
    await openIdentity(alice());
    await identitiesLive();
    expect(view.container.querySelector('output')).not.toBeNull();
    expect(buttonNamed('ClusterRole/reader')).toBeUndefined();

    // Another subject in another cluster, whose query the backend refuses.
    answerIdentities(() => statusResponse(makeErrorStatus('Forbidden', 'identities is forbidden')));
    const groupInStaging: IdentityPanelRef = {
      ...alice(),
      clusterId: staging.clusterId,
      kind: 'Group',
    };
    await openIdentity(groupInStaging);
    await identitiesLive(staging);

    expect(buttonNamed('team-readers')).toBeUndefined();
    expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
    expect(queriedSubject(identityQueries()[identityQueries().length - 1]?.scope ?? '')).toEqual([
      staging.clusterId,
      'Group',
      ' alice ',
    ]);
    app.errors.take(() => true);
  });
});
