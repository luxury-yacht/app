/**
 * frontend/src/modules/cluster/components/ClusterViewStorage.test.tsx
 *
 * The cluster Storage view lists the visible cluster's PersistentVolumes from
 * the backend's cluster-storage query and opens what its own columns link to
 * with complete identity: a volume's claim (a namespaced
 * PersistentVolumeClaim), its StorageClass, and the volume's Map from its row
 * menu. The aggregated table it shares with the other aggregated views is
 * covered once by NsViewConfig.test.tsx. Runs in the full app, navigated
 * through the sidebar, over a faked backend (test-utils/appState).
 */

import { objectPanelId } from '@modules/object-panel/objectPanelRef';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { ClusterStorageEntry } from '@/core/refresh/types';
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

const volume: ObjectIdentity = {
  group: '',
  version: 'v1',
  kind: 'PersistentVolume',
  namespace: '',
  name: 'pv-data',
};

const volumeRow = (): ClusterStorageEntry => ({
  ref: { ...volume, clusterId: dev.clusterId, resource: 'persistentvolumes', uid: 'pv-uid' },
  capacity: '10Gi',
  accessModes: 'RWO',
  status: 'Bound',
  statusPresentation: 'ready',
  claim: 'team-a/data',
  storageClass: 'fast-ssd',
  age: '1d',
});

const start = async () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
  app.startScreen(dev);
  app.serveTable(dev, 'cluster-storage', { rows: [volumeRow()] });
  view = await app.mountApp();
  await view.goTo({ clusterView: 'storage' });
};

const rowOf = (name: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).find((row) =>
      row.textContent?.includes(name)
    ),
    `expected the ${name} row`
  );

const cellText = (row: HTMLElement, column: string) =>
  row.querySelector(`[data-column="${column}"]`)?.textContent?.trim();

const clickLink = async (row: HTMLElement, text: string) => {
  const link = requireValue(
    Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === text
    ),
    `expected the ${text} link`
  );
  await act(async () => link.click());
  await app.settle();
};

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

const inCluster = (identity: ObjectIdentity) => ({
  clusterId: dev.clusterId,
  clusterName: dev.clusterName,
  ...identity,
});

describe('ClusterViewStorage', () => {
  it('lists the cluster’s PersistentVolumes from the backend query in the visible cluster', async () => {
    await start();

    const row = rowOf('pv-data');
    expect(
      ['status', 'capacity', 'accessModes', 'storageClass', 'claim'].map((column) =>
        cellText(row, column)
      )
    ).toEqual(['Bound', '10Gi', 'RWO', 'fast-ssd', 'team-a/data']);
    const read = requireValue(
      app.snapshots.reads('cluster-storage').slice(-1)[0],
      'expected a cluster-storage read'
    );
    expect(read.scope.startsWith(`${dev.clusterId}|`)).toBe(true);
  });

  it('opens a volume’s claim and StorageClass with complete identity', async () => {
    const claim: ObjectIdentity = {
      group: '',
      version: 'v1',
      kind: 'PersistentVolumeClaim',
      namespace: 'team-a',
      name: 'data',
    };
    const storageClass: ObjectIdentity = {
      group: 'storage.k8s.io',
      version: 'v1',
      kind: 'StorageClass',
      namespace: '',
      name: 'fast-ssd',
    };
    await start();
    app.servePanel(dev, claim);
    app.servePanel(dev, storageClass);

    await clickLink(rowOf('pv-data'), 'team-a/data');
    await clickLink(rowOf('pv-data'), 'fast-ssd');

    expect(view.openPanels()).toEqual([inCluster(claim), inCluster(storageClass)]);
  });

  it('opens a volume’s Map from its row menu', async () => {
    await start();
    const panel = app.servePanel(dev, volume);
    app.snapshots.serve('object-map', requireValue(panel.scopes.mapScope, 'expected a map scope'), {
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      seed: { clusterId: dev.clusterId, ...volume },
      nodes: [],
      edges: [],
      maxNodes: 250,
      truncated: false,
    });

    await openRowMenu('pv-data');
    await clickMenuItem('Open Map');

    expect(view.openPanels()).toEqual([inCluster(volume)]);
    expect(
      view.owners().objectPanels.getOwnedPanel(dev.clusterId, objectPanelId(panel.ref))?.activeView
    ).toBe('map');
  });
});
