/**
 * frontend/src/modules/namespace/components/NsViewPods.test.tsx
 *
 * The namespace Pods view lists the namespace's pods from the backend's pods
 * query in the visible cluster, opens a pod, its owner, and its node with
 * full identity, offers Port Forward only for pods with forwardable ports,
 * deletes a pod after confirmation where the user may delete it, and under All
 * Namespaces checks pod permissions in the listed pods' namespaces and links
 * each pod's namespace back to its Pods view. The pods table a workload
 * attaches under its row is covered in NsViewWorkloads.test.tsx, and the
 * owner-link identity edge cases in PodsTab.test.tsx (the same
 * podOwnerReference). Runs in the full app, navigated through the sidebar,
 * over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  makeClusterNodeSnapshotPayload,
  makePodSnapshotEntry,
} from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import type { CanonicalRowTestOverrides, PodSnapshotEntry } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { objectDetailOf } from '@/test-utils/objectDetail';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const podIdentity = (name: string, namespace = 'team-a'): ObjectIdentity => ({
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace,
  name,
});

/** A pod row as backend/refresh/snapshot/pods.go projects it, in the visible cluster. */
const pod = (overrides: CanonicalRowTestOverrides<PodSnapshotEntry> = {}) => {
  const { ref, ...row } = overrides;
  return makePodSnapshotEntry({
    ownerKind: 'Deployment',
    ownerName: 'api',
    ownerApiVersion: 'apps/v1',
    node: 'node-a',
    portForwardAvailable: true,
    ...row,
    ref: { clusterId: dev.clusterId, namespace: 'team-a', name: 'api-0', ...ref },
  });
};

const start = async (rows: PodSnapshotEntry[], target = 'team-a') => {
  app.startScreen(dev);
  app.serveTable(dev, 'pods', {
    rows,
    metrics: { stale: false, successCount: 1, failureCount: 0 },
    totalCount: rows.length,
    healthCounts: {},
  });
  view = await app.mountApp();
  await view.goTo({ namespace: target, view: 'pods' });
};

const inCluster = (identity: ObjectIdentity) => ({
  clusterId: dev.clusterId,
  clusterName: dev.clusterName,
  ...identity,
});

const rowOf = (name: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).find((row) =>
      row.textContent?.includes(name)
    ),
    `expected the ${name} row`
  );

/** The link a row's cell renders for `text` (its owner, node, or namespace). */
const linkIn = (rowName: string, text: string) =>
  requireValue(
    Array.from(rowOf(rowName).querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === text
    ),
    `expected the ${text} link in the ${rowName} row`
  );

const activate = async (run: () => void) => {
  await act(async () => {
    run();
  });
  await app.settle();
};

const menuItems = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item'));
const menuItem = (label: string) =>
  requireValue(
    menuItems().find(
      (item) => item.querySelector('.context-menu-label')?.textContent?.trim() === label
    ),
    `expected the ${label} menu item`
  );

/** Right-clicks the row, as the user opens its menu, and returns the menu's labels. */
const openRowMenu = async (name: string) => {
  const cell = requireValue(
    rowOf(name).querySelector<HTMLElement>('.grid-cell'),
    `expected a cell in the ${name} row`
  );
  await activate(() => {
    cell.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    );
  });
  return menuItems().map((item) => item.querySelector('.context-menu-label')?.textContent?.trim());
};

const deletePod = async (name: string) => {
  await openRowMenu(name);
  await activate(() => menuItem('Delete').click());
  const confirm = requireValue(
    Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.confirmation-modal-footer button')
    ).find((button) => button.textContent?.trim() === 'Delete'),
    'expected the delete confirmation'
  );
  await activate(() => confirm.click());
};

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
});

describe('NsViewPods', () => {
  it('lists the namespace’s pods from the backend query in the visible cluster', async () => {
    await start([pod()]);

    const rows = Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row'));
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining('api-0')]);
    const read = requireValue(app.snapshots.reads('pods').slice(-1)[0], 'expected a pods read');
    expect(read.scope.startsWith(`${dev.clusterId}|namespace:team-a`)).toBe(true);
  });

  it('opens the focused pod in its panel with full identity on Enter', async () => {
    app.servePanel(dev, podIdentity('api-0'), objectDetailOf('pod', { name: 'api-0' }) as never);
    await start([pod()]);
    const table = requireValue(
      view.container.querySelector<HTMLElement>('table[tabindex="0"]'),
      'expected the Pods table'
    );

    await activate(() => table.focus());
    await activate(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });

    expect(view.openPanels()).toEqual([inCluster(podIdentity('api-0'))]);
  });

  it('opens a pod’s owner with the API group of its apiVersion', async () => {
    const owner: ObjectIdentity = {
      group: 'operators.example.io',
      version: 'v1beta2',
      kind: 'Widget',
      namespace: 'team-a',
      name: 'custom-owner',
    };
    app.servePanel(
      dev,
      owner,
      objectDetailOf('customresource', { kind: owner.kind, name: owner.name }) as never
    );
    await start([
      pod({
        ownerKind: 'Widget',
        ownerName: 'custom-owner',
        ownerApiVersion: 'operators.example.io/v1beta2',
      }),
    ]);

    await activate(() => linkIn('api-0', 'custom-owner').click());

    expect(view.openPanels()).toEqual([inCluster(owner)]);
  });

  it('opens a scheduled pod’s node in the visible cluster; an unscheduled pod links no node', async () => {
    const node: ObjectIdentity = {
      group: '',
      version: 'v1',
      kind: 'Node',
      namespace: '',
      name: 'node-b',
    };
    // A Node panel also reads the cluster's node table and its drain jobs
    // (backend/refresh/snapshot/nodes.go, node_maintenance.go).
    const clusterFields = { clusterId: dev.clusterId, clusterName: dev.clusterName };
    app.snapshots.serve(
      'nodes',
      buildClusterRefreshScope('nodes', dev.clusterId),
      makeClusterNodeSnapshotPayload(clusterFields)
    );
    app.snapshots.serve(
      'object-maintenance',
      buildClusterRefreshScope('object-maintenance', dev.clusterId),
      { ...clusterFields, drains: [] }
    );
    app.servePanel(dev, node, objectDetailOf('node', { name: 'node-b' }) as never);
    // backend/node_logs.go DiscoverNodeLogs: the Node panel's log sources; none here.
    app.backend.answer('DiscoverNodeLogs', () => ({
      supported: false,
      reason: 'node log proxy unavailable',
    }));
    await start([pod({ node: 'node-b' }), pod({ ref: { name: 'pending-0' }, node: '' })]);
    expect(rowOf('pending-0').querySelector('[data-column="node"] button')).toBeNull();

    await activate(() => linkIn('api-0', 'node-b').click());

    expect(view.openPanels()).toEqual([inCluster(node)]);
  });

  it('offers Port Forward only for pods with forwardable ports', async () => {
    await start([
      pod({ ref: { name: 'web-0' }, portForwardAvailable: true }),
      pod({ ref: { name: 'worker-0' }, portForwardAvailable: false }),
    ]);
    const portForward = async (name: string) => {
      await openRowMenu(name);
      const item = menuItem('Port Forward');
      await activate(() =>
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      );
      return item.getAttribute('aria-disabled');
    };

    expect(await portForward('web-0')).toBe('false');
    expect(await portForward('worker-0')).toBe('true');
  });

  it('deletes a pod with full identity after confirmation where the user may delete it', async () => {
    app.backend.answer('RunObjectAction', () => ({}) as never);
    await start([pod()]);

    await deletePod('api-0');

    expect(app.backend.calls('RunObjectAction')).toEqual([
      [{ action: 'delete', target: { clusterId: dev.clusterId, ...podIdentity('api-0') } }],
    ]);
  });

  it('offers no Delete where the user may not delete pods', async () => {
    app.denyPermissions([{ verb: 'delete', resourceKind: 'Pod', namespace: 'team-a' }]);
    await start([pod()]);

    expect(await openRowMenu('api-0')).not.toContain('Delete');
  });

  it('reports a delete the backend refuses', async () => {
    app.backend.answer('RunObjectAction', () => {
      throw new Error('pods "api-0" is forbidden');
    });
    await start([pod()]);

    await deletePod('api-0');

    expect(app.errors.take((record) => record.context?.action === 'delete')).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({ kind: 'Pod', name: 'api-0' }),
      }),
    ]);
    expect(document.body.querySelector('.confirmation-modal-footer')).toBeNull();
  });

  it('under All Namespaces, checks pod permissions in the listed pods’ namespaces and links each namespace to its Pods view', async () => {
    await start([pod(), pod({ ref: { name: 'db-0', namespace: 'team-b' } })], 'namespace:all');

    expect(
      app.snapshots
        .reads('pods')
        .some((read) => read.scope.startsWith(`${dev.clusterId}|namespace:all`))
    ).toBe(true);
    const podQueries = app.backend
      .calls('QueryPermissions')
      .flatMap(([queries]) => queries ?? [])
      .filter((query) => query.resourceKind === 'Pod' && query.verb === 'delete');
    expect(podQueries).toContainEqual(
      expect.objectContaining({ clusterId: dev.clusterId, namespace: 'team-b' })
    );

    await activate(() => linkIn('db-0', 'team-b').click());

    const owners = view.owners();
    expect(owners.namespace.selectedNamespace).toBe('team-b');
    expect(owners.viewState?.viewType).toBe('namespace');
    expect(owners.viewState?.activeNamespaceTab).toBe('pods');
  });
});
