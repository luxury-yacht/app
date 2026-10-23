/**
 * frontend/src/modules/namespace/components/NsViewRBAC.test.tsx
 *
 * What the namespace RBAC view shows beyond the aggregated namespace table it
 * shares with Config (covered in NsViewConfig.test.tsx): the namespace's
 * Roles, RoleBindings, and ServiceAccounts from the backend's namespace-rbac
 * query, by kind, name, and age. Runs in the full app, navigated through the
 * sidebar, over a faked backend (test-utils/appState).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { NamespaceRBACSummary } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const rbacObject = (
  kind: 'Role' | 'RoleBinding' | 'ServiceAccount',
  name: string,
  age: string
): NamespaceRBACSummary => ({
  ref: {
    clusterId: dev.clusterId,
    group: kind === 'ServiceAccount' ? '' : 'rbac.authorization.k8s.io',
    version: 'v1',
    kind,
    resource: `${kind.toLowerCase()}s`,
    namespace: 'team-a',
    name,
    uid: `${name}-uid`,
  },
  details: '',
  age,
});

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
});

describe('NsViewRBAC', () => {
  it('lists the namespace’s RBAC objects by kind, name, and age', async () => {
    app.startScreen(dev);
    app.serveTable(dev, 'namespace-rbac', {
      rows: [
        rbacObject('Role', 'view', '5h'),
        rbacObject('RoleBinding', 'view-binding', '4h'),
        rbacObject('ServiceAccount', 'builder', '3h'),
      ],
    });
    view = await app.mountApp();

    await view.goTo({ namespace: 'team-a', view: 'rbac' });

    const columns = Array.from(
      view.container.querySelectorAll<HTMLElement>('.grid-cell-header[data-column]'),
      (header) => header.dataset.column
    );
    expect(columns).toEqual(['kind', 'name', 'age']);
    const rows = Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row'), (row) =>
      columns.map((column) =>
        row.querySelector(`.grid-cell[data-column="${column}"]`)?.textContent?.trim()
      )
    );
    // Rows keep the backend query's order.
    expect(rows).toEqual([
      ['Role', 'view', '5h'],
      ['RoleBinding', 'view-binding', '4h'],
      ['ServiceAccount', 'builder', '3h'],
    ]);
  });
});
