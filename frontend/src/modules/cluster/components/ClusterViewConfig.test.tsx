/**
 * frontend/src/modules/cluster/components/ClusterViewConfig.test.tsx
 *
 * The cluster Config view, and through it the cluster-scoped aggregated table
 * it shares with the cluster CRDs, RBAC, and Storage views
 * (ClusterAggregatedResourceGridView in
 * modules/resource-grid/AggregatedResourceGridView.tsx). It lists the
 * cluster's config objects from the backend's cluster-scoped query in the
 * visible cluster, shows its loading state rather than an empty table until
 * that query first answers, and opens a row's object on its Map tab only for
 * kinds the object map supports. The row identity, menu, and delete path the
 * cluster and namespace tables share is covered once by NsViewConfig.test.tsx.
 * Runs in the full app, navigated through the sidebar, over a faked backend
 * (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ClusterConfigEntry, ClusterConfigSnapshotPayload } from '@/core/refresh/types';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const storageClass: ObjectIdentity = {
  group: 'storage.k8s.io',
  version: 'v1',
  kind: 'StorageClass',
  namespace: '',
  name: 'standard',
};
const webhook: ObjectIdentity = {
  group: 'admissionregistration.k8s.io',
  version: 'v1',
  kind: 'ValidatingWebhookConfiguration',
  namespace: '',
  name: 'policy-hook',
};

/** A cluster-config row as backend/refresh/snapshot/cluster_config.go projects it. */
const configRow = (identity: ObjectIdentity, resource: string): ClusterConfigEntry => ({
  ref: { ...identity, clusterId: dev.clusterId, resource, uid: `${identity.name}-uid` },
  details: '',
  age: '1d',
});

const rows = () => [
  configRow(storageClass, 'storageclasses'),
  configRow(webhook, 'validatingwebhookconfigurations'),
];

/** The backend's answer to a cluster-config query: the typed-resource envelope and its rows. */
const configPage = (): ClusterConfigSnapshotPayload => ({
  clusterId: dev.clusterId,
  clusterName: dev.clusterName,
  provider: 'typed-resource',
  table: 'cluster-config',
  total: rows().length,
  unfilteredTotal: rows().length,
  totalIsExact: true,
  facetsExact: true,
  capabilities: {
    sortableFields: [],
    filterableFields: [],
    searchableFields: [],
    kindVocabulary: [],
  },
  rows: rows(),
});

/** Parks every cluster-config read until the returned release answers it. */
const holdConfigReads = () => {
  const parked: Array<() => void> = [];
  app.snapshots.respond(({ domain, scope }) =>
    domain === 'cluster-config'
      ? new Promise<Response>((resolve) => {
          parked.push(() =>
            resolve(snapshotResponse({ domain, scope, version: 100, payload: configPage() }))
          );
        })
      : undefined
  );
  return async () => {
    app.snapshots.respond(null);
    await act(async () => {
      parked.splice(0).forEach((answer) => {
        answer();
      });
    });
    await app.settle();
  };
};

const start = async () => {
  app.serveTable(dev, 'cluster-config', configPage());
  view = await app.mountApp();
  await view.goTo({ clusterView: 'config' });
};

const tableRows = () => Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row'));

const rowOf = (name: string) =>
  requireValue(
    tableRows().find((row) => row.textContent?.includes(name)),
    `expected the ${name} row`
  );

const menuItems = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item'));
const menuLabel = (item: HTMLElement) =>
  item.querySelector('.context-menu-label')?.textContent?.trim();

/** Right-clicks the row, as the user opens its menu, and returns the menu's labels. */
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
  return menuItems().map(menuLabel);
};

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
  app.startScreen(dev);
});

describe('ClusterViewConfig', () => {
  it('lists the cluster’s config objects from the cluster-scoped query of the visible cluster', async () => {
    await start();

    expect(tableRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('standard'),
      expect.stringContaining('policy-hook'),
    ]);
    const read = requireValue(
      app.snapshots.reads('cluster-config').slice(-1)[0],
      'expected a cluster-config read'
    );
    // A cluster-scoped query carries the cluster and no namespace selector.
    expect(read.scope.startsWith(`${dev.clusterId}|?`)).toBe(true);
  });

  it('shows its loading state, not an empty table, until the first query answers', async () => {
    const release = holdConfigReads();
    await start();

    expect(tableRows()).toEqual([]);
    expect(view.container.textContent).toContain('Loading configuration resources');
    expect(view.container.textContent).not.toContain('No cluster-scoped config objects found');

    await release();

    expect(tableRows()).toHaveLength(2);
  });

  it('opens a row’s object on its Map tab with full identity from the row menu', async () => {
    const panel = app.servePanel(dev, storageClass);
    // The Map tab reads the object's map (backend/refresh/snapshot/object_map.go).
    app.snapshots.serve('object-map', panel.scopes.detailScope ?? '', {
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      seed: { ...storageClass, clusterId: dev.clusterId },
      nodes: [],
      edges: [],
      maxNodes: 250,
      truncated: false,
    });
    await start();

    expect(await openRowMenu('standard')).toContain('Open Map');
    await act(async () =>
      requireValue(
        menuItems().find((item) => menuLabel(item) === 'Open Map'),
        'expected the Open Map item'
      ).click()
    );
    await app.settle();

    expect(view.openPanels()).toEqual([
      { ...storageClass, clusterId: dev.clusterId, clusterName: dev.clusterName },
    ]);
    expect(
      view.owners().objectPanels.getOwnedPanel(dev.clusterId, objectPanelId(panel.ref))?.activeView
    ).toBe('map');
  });

  it('offers no Map for a kind the object map does not support', async () => {
    await start();

    const labels = await openRowMenu('policy-hook');
    expect(labels).toContain('Open Details');
    expect(labels).not.toContain('Open Map');
  });
});
