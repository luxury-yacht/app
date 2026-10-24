/**
 * frontend/src/modules/cluster/components/ClusterViewRBAC.test.tsx
 *
 * The cluster RBAC view lists the visible cluster's ClusterRoles and
 * ClusterRoleBindings from the backend's cluster-rbac query, and a row's menu
 * opens that object's Map (offered only for kinds the map supports) with
 * complete identity. The aggregated table it shares with the other aggregated
 * views is covered once by NsViewConfig.test.tsx. Runs in the full app,
 * navigated through the sidebar, over a faked backend (test-utils/appState).
 */

import { objectPanelId } from '@modules/object-panel/objectPanelRef';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { ClusterRBACEntry } from '@/core/refresh/types';
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

const rbacObject = (kind: string, name: string): ObjectIdentity => ({
  group: 'rbac.authorization.k8s.io',
  version: 'v1',
  kind,
  namespace: '',
  name,
});

const clusterRole = rbacObject('ClusterRole', 'admin');
const clusterRoleBinding = rbacObject('ClusterRoleBinding', 'admin-binding');

const rowFor = (identity: ObjectIdentity, resource: string): ClusterRBACEntry => ({
  ref: { ...identity, clusterId: dev.clusterId, resource, uid: `${identity.name}-uid` },
  details: '',
  age: '1d',
});

const start = async () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
  app.startScreen(dev);
  app.serveTable(dev, 'cluster-rbac', {
    rows: [rowFor(clusterRole, 'clusterroles'), rowFor(clusterRoleBinding, 'clusterrolebindings')],
  });
  view = await app.mountApp();
  await view.goTo({ clusterView: 'rbac' });
};

const rowOf = (name: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).find(
      (row) => row.querySelector('[data-column="name"]')?.textContent?.trim() === name
    ),
    `expected the ${name} row`
  );

const openRowMenu = async (name: string) => {
  const cell = requireValue(
    rowOf(name).querySelector<HTMLElement>('.grid-cell'),
    `expected a cell in the ${name} row`
  );
  await act(async () => {
    cell.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    );
  });
  await app.settle();
};

const clickMenuItem = async (label: string) => {
  const item = requireValue(
    Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item')
    ).find(
      (candidate) => candidate.querySelector('.context-menu-label')?.textContent?.trim() === label
    ),
    `expected the ${label} menu item`
  );
  await act(async () => item.click());
  await app.settle();
};

describe('ClusterViewRBAC', () => {
  it.each([clusterRole, clusterRoleBinding])(
    'opens a $kind’s Map from its row menu with complete identity',
    async (identity) => {
      await start();
      const panel = app.servePanel(dev, identity);
      app.snapshots.serve(
        'object-map',
        requireValue(panel.scopes.mapScope, 'expected a map scope'),
        {
          clusterId: dev.clusterId,
          clusterName: dev.clusterName,
          seed: { clusterId: dev.clusterId, ...identity },
          nodes: [],
          edges: [],
          maxNodes: 250,
          truncated: false,
        }
      );

      await openRowMenu(identity.name);
      await clickMenuItem('Open Map');

      expect(view.openPanels()).toEqual([
        { clusterId: dev.clusterId, clusterName: dev.clusterName, ...identity },
      ]);
      expect(
        view.owners().objectPanels.getOwnedPanel(dev.clusterId, objectPanelId(panel.ref))
          ?.activeView
      ).toBe('map');
    }
  );
});
