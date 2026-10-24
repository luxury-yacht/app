/**
 * frontend/src/modules/browse/hooks/catalogFreshness.integration.test.tsx
 *
 * The catalog-backed namespace views (Argo CD, Custom Resources, and Browse)
 * reconcile external changes: when the backend rings the cluster's catalog
 * doorbell, the view re-reads its current query and its rendered rows, counts,
 * and persisted custom columns follow creations, updates, deletions, and an
 * emptied result. A doorbell from another cluster leaves the view alone. Runs
 * in the full app, navigated through the sidebar, over a faked backend
 * (test-utils/appState); nothing in the UI acts on the objects, so only the
 * doorbell can repair the rows.
 */

import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeCatalogSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import type { CatalogItem } from '@/core/refresh/types';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@/shared/components/tables/gridTableFilterState';
import {
  buildGridTableStorageKey,
  computeClusterHash,
} from '@/shared/components/tables/persistence/gridTablePersistence';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let stg: TestCluster;
let view: MountedApp;

const externalSecretType = {
  group: 'external-secrets.io',
  version: 'v1',
  kind: 'ExternalSecret',
  resource: 'externalsecrets',
};

/** What the backend's catalog holds for each cluster; doorbells announce changes to it. */
const backendRows = new Map<string, CatalogItem[]>();

const item = (
  cluster: TestCluster,
  resourceType: typeof externalSecretType,
  name: string,
  revision: string
): CatalogItem => ({
  ref: {
    clusterId: cluster.clusterId,
    ...resourceType,
    namespace: 'argocd',
    name,
    uid: `${cluster.clusterId}-${name}`,
  },
  resourceVersion: revision,
  metadata: { labels: { revision } },
  scope: 'Namespace',
  creationTimestamp: '2026-01-01T00:00:00Z',
});

const rows = () => Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row'));
const rowNames = () =>
  rows().map((row) => row.querySelector('[data-column="name"]')?.textContent?.trim());
const revisions = () =>
  rows().map((row) =>
    row.querySelector('[data-column="metadata:label:revision"]')?.textContent?.trim()
  );
const counts = () =>
  view.container
    .querySelector('[data-gridtable-filter-role="result-count"]')
    ?.textContent?.match(/\d+/g)
    ?.map(Number);
const devPageReads = () =>
  app.snapshots
    .reads('catalog')
    .filter((read) => read.scope.startsWith(`${dev.clusterId}|`) && read.scope.includes('limit='));

let doorbell = 0;
/** The backend announces a change to a cluster's catalog. */
const ringCatalog = async (cluster: TestCluster) => {
  doorbell += 1;
  await act(async () => {
    app.streams.ring(
      'catalog',
      buildClusterRefreshScope('catalog', cluster.clusterId),
      'catalog',
      `catalog:${doorbell}`
    );
    // Doorbells coalesce before the view re-reads (resourceStreamManager.ts UPDATE_COALESCE_MS).
    await vi.advanceTimersByTimeAsync(200);
  });
  await app.settle();
};

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  stg = app.cluster({ name: 'stg', context: 'beta' });
  app.namespaces(dev, ['argocd']);
  app.namespaces(stg, ['argocd']);
  app.startScreen(dev);
  // The namespace's Extensions group (Argo CD, Custom Resources) is expanded.
  app.preferences({ sidebarNamespaceExtensionsExpanded: true });
  // The cluster runs Argo CD, so its namespaces offer the Argo CD view.
  app.snapshots.serve(
    'catalog',
    `${dev.clusterId}|limit=1`,
    makeCatalogSnapshotPayload({
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      resourceFamilies: { namespaced: ['argocd'] },
    })
  );
  app.backend.answer('HydrateCatalogCustomRows', () => []);
  backendRows.clear();
  doorbell = 0;
  app.snapshots.answer(({ domain, scope }) => {
    const clusterId = scope.split('|')[0];
    if (domain !== 'catalog' || !scope.includes('limit=') || scope === `${clusterId}|limit=1`) {
      return undefined;
    }
    const items = backendRows.get(clusterId) ?? [];
    const kinds = Array.from(new Set(items.map((entry) => entry.ref.kind)));
    return makeCatalogSnapshotPayload({
      clusterId,
      items,
      total: items.length,
      unfilteredTotal: items.length,
      batchSize: items.length,
      kinds: kinds.map((kind) => ({ kind, namespaced: true })),
      namespaces: ['argocd'],
    });
  });
});

it.each([
  {
    name: 'Argo CD',
    tab: 'argocd',
    resourceType: {
      group: 'argoproj.io',
      version: 'v1alpha1',
      kind: 'Application',
      resource: 'applications',
    },
  },
  { name: 'Namespace Custom', tab: 'custom', resourceType: externalSecretType },
  { name: 'Browse', tab: 'browse', resourceType: externalSecretType },
])('$name reconciles external changes into its rendered rows', async ({ tab, resourceType }) => {
  // A Kind filter (so the result count shows) and a label column, as the user left them.
  const storageKey = requireValue(
    buildGridTableStorageKey({
      clusterHash: await computeClusterHash(dev.clusterId),
      viewId: `namespace-${tab}`,
      namespace: '__shared__',
    }),
    'table persistence key'
  );
  app.backend.answer(
    'GetGridTablePersistence',
    () =>
      ({
        [storageKey]: {
          version: 3,
          filters: {
            ...DEFAULT_GRID_TABLE_FILTER_STATE,
            kinds: { mode: 'some', values: [resourceType.kind] },
          },
          customColumns: [
            {
              key: 'metadata:label:revision',
              source: 'label',
              metadataKey: 'revision',
              header: 'Revision',
            },
          ],
        },
      }) as never
  );
  const original = item(dev, resourceType, 'argocd-saml', 'before');
  backendRows.set(dev.clusterId, [original]);
  backendRows.set(stg.clusterId, [item(stg, resourceType, 'argocd-saml', 'before')]);
  view = await app.mountApp();
  await view.goTo({ namespace: 'argocd', view: tab });
  expect(rowNames()).toEqual(['argocd-saml']);
  expect(counts()).toEqual([1, 1]);
  const query = new URLSearchParams(
    requireValue(devPageReads().slice(-1)[0], 'expected a page read').scope.split('|')[1]
  );
  expect(query.getAll('namespace')).toEqual(['argocd']);
  expect(query.get('resourceFamily')).toBe(tab === 'argocd' ? 'argocd' : null);
  expect(query.get('customOnly')).toBe(tab === 'browse' ? null : 'true');

  const created = item(dev, resourceType, 'new-secret', 'before');
  backendRows.set(dev.clusterId, [original, created]);
  await ringCatalog(dev);
  expect(rowNames()).toEqual(['argocd-saml', 'new-secret']);
  expect(counts()).toEqual([2, 2]);

  backendRows.set(dev.clusterId, [item(dev, resourceType, 'argocd-saml', 'after'), created]);
  await ringCatalog(dev);
  expect(revisions()).toEqual(['after', 'before']);

  backendRows.set(dev.clusterId, [created]);
  await ringCatalog(dev);
  expect(rowNames()).toEqual(['new-secret']);
  expect(counts()).toEqual([1, 1]);

  // Another cluster's catalog changing does not re-read this one.
  backendRows.set(stg.clusterId, []);
  const readsBefore = devPageReads().length;
  await ringCatalog(stg);
  expect(devPageReads()).toHaveLength(readsBefore);

  backendRows.set(dev.clusterId, []);
  await ringCatalog(dev);
  expect(rowNames()).toEqual([]);
});
