/**
 * frontend/src/modules/namespace/components/NsViewStorage.test.tsx
 *
 * What the namespace Storage view shows beyond the aggregated namespace table
 * it shares with Config (covered in NsViewConfig.test.tsx): each claim's
 * status, capacity, and storage class from the backend's namespace-storage
 * query, a storage class that opens its StorageClass in a panel with full
 * identity (and no link for a claim that names none), and no kind filter,
 * since the view lists only claims. Runs in the full app, navigated through
 * the sidebar, over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NamespaceStorageSummary } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const claim = (
  name: string,
  fields: Partial<Omit<NamespaceStorageSummary, 'ref'>> = {}
): NamespaceStorageSummary => ({
  ref: {
    clusterId: dev.clusterId,
    group: '',
    version: 'v1',
    kind: 'PersistentVolumeClaim',
    resource: 'persistentvolumeclaims',
    namespace: 'team-a',
    name,
    uid: `${name}-uid`,
  },
  status: 'Bound',
  statusPresentation: 'ready',
  capacity: '10Gi',
  storageClass: 'fast-ssd',
  age: '4h',
  ...fields,
});

const start = async (rows: NamespaceStorageSummary[]) => {
  app.startScreen(dev);
  app.serveTable(dev, 'namespace-storage', { rows });
  view = await app.mountApp();
  await view.goTo({ namespace: 'team-a', view: 'storage' });
};

const rowOf = (name: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row')).find((row) =>
      row.textContent?.includes(name)
    ),
    `expected the ${name} row`
  );

const cellOf = (name: string, column: string) =>
  requireValue(
    rowOf(name).querySelector<HTMLElement>(`.grid-cell[data-column="${column}"]`),
    `expected the ${column} cell of ${name}`
  );

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
});

describe('NsViewStorage', () => {
  it('shows each claim’s status, capacity, and storage class, marking what the claim lacks', async () => {
    await start([
      claim('pvc-data'),
      claim('pvc-pending', {
        status: 'Pending',
        statusPresentation: 'warning',
        capacity: '',
        storageClass: '',
      }),
    ]);

    const cells = (name: string) =>
      ['status', 'capacity', 'storageClass'].map((column) =>
        cellOf(name, column).textContent?.trim()
      );
    expect(cells('pvc-data')).toEqual(['Bound', '10Gi', 'fast-ssd']);
    // A claim not yet bound has no capacity and falls back to the default class.
    expect(cells('pvc-pending')).toEqual(['Pending', '-', 'default']);
  });

  it('opens a claim’s storage class in its panel with full identity, and offers no link for the default class', async () => {
    app.servePanel(dev, {
      group: 'storage.k8s.io',
      version: 'v1',
      kind: 'StorageClass',
      namespace: '',
      name: 'fast-ssd',
    });
    await start([claim('pvc-data'), claim('pvc-default', { storageClass: '' })]);

    expect(cellOf('pvc-default', 'storageClass').querySelector('button')).toBeNull();
    const link = requireValue(
      cellOf('pvc-data', 'storageClass').querySelector<HTMLButtonElement>('button'),
      'expected the storage class link'
    );
    await act(async () => link.click());
    await app.settle();

    expect(view.openPanels()).toEqual([
      {
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        group: 'storage.k8s.io',
        version: 'v1',
        kind: 'StorageClass',
        namespace: '',
        name: 'fast-ssd',
      },
    ]);
  });

  it('offers no kind filter, since every row is a claim', async () => {
    await start([claim('pvc-data')]);

    const filters = Array.from(
      view.container.querySelectorAll<HTMLElement>('[data-gridtable-filter-role]'),
      (filter) => filter.dataset.gridtableFilterRole
    );
    expect(filters).toContain('search');
    expect(filters).not.toContain('kind');
  });
});
