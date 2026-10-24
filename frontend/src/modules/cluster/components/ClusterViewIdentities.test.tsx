/**
 * frontend/src/modules/cluster/components/ClusterViewIdentities.test.tsx
 *
 * The cluster Identities view lists the users and groups the visible
 * cluster's bindings name, from the backend's cluster-identities query. A
 * subject's Kind badge or name opens its identity panel with the subject's
 * exact name (never an object panel), and its Bindings count lists the
 * bindings that grant it, each opening its binding with complete identity.
 * Runs in the full app, navigated through the sidebar, over a faked backend
 * (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { ClusterIdentity, ClusterIdentityBinding } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const readers: ObjectIdentity = {
  group: 'rbac.authorization.k8s.io',
  version: 'v1',
  kind: 'RoleBinding',
  namespace: 'payments',
  name: 'readers',
};

const readersBinding = (): ClusterIdentityBinding => ({
  ...readers,
  clusterId: dev.clusterId,
  resource: 'rolebindings',
});

// Subject names are opaque: the view passes them on exactly as the bindings name them.
const subjects = (): ClusterIdentity[] => [
  {
    clusterId: dev.clusterId,
    kind: 'User',
    name: ' alice ',
    bindings: [readersBinding()],
    grantScopes: ['payments'],
  },
  { clusterId: dev.clusterId, kind: 'Group', name: 'developers', bindings: [], grantScopes: [] },
];

const start = async () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['payments']);
  app.startScreen(dev);
  // The view's query and an opened identity panel's subject query.
  app.serveTable(dev, 'cluster-identities', { rows: subjects() });
  view = await app.mountApp();
  await view.goTo({ clusterView: 'identities' });
};

const rowOf = (name: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).find((row) =>
      row.textContent?.includes(name)
    ),
    `expected the ${name} row`
  );

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

const identityTarget = (kind: string, name: string) => ({
  targetType: 'identity',
  clusterId: dev.clusterId,
  kind,
  name,
});

describe('ClusterViewIdentities', () => {
  it('opens a subject’s identity panel from its Kind badge and its name', async () => {
    await start();

    await click(
      requireValue(
        rowOf('alice').querySelector<HTMLButtonElement>('button[data-kind-value="User"]'),
        'expected the User badge'
      )
    );
    await click(
      requireValue(
        Array.from(rowOf('developers').querySelectorAll<HTMLButtonElement>('button')).find(
          (button) => button.textContent === 'developers'
        ),
        'expected the developers name link'
      )
    );

    expect(view.openPanels()).toEqual([
      identityTarget('User', ' alice '),
      identityTarget('Group', 'developers'),
    ]);
  });

  it('opens a binding that grants a subject with complete identity', async () => {
    await start();
    app.servePanel(dev, readers);

    await click(
      requireValue(
        rowOf('alice').querySelector<HTMLElement>('[aria-label="Bindings for  alice "]'),
        'expected the Bindings count'
      )
    );
    await click(
      requireValue(
        Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
          button.textContent?.includes('payments/readers')
        ),
        'expected the readers binding link'
      )
    );

    expect(view.openPanels()).toEqual([
      { clusterId: dev.clusterId, clusterName: dev.clusterName, ...readers },
    ]);
  });
});
