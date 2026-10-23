/**
 * frontend/src/modules/browse/hooks/useHydratedCustomCatalogRows.test.tsx
 *
 * Verifies custom-resource row hydration: catalog membership always wins, a
 * row keeps its details only while the same object (cluster, identity, UID)
 * re-hydrates, late or failed reads never publish stale details, a paused
 * auto-refresh skips the page read, and the export path joins hydrated rows by
 * complete identity. The hook runs inside the production shell over a faked
 * backend (test-utils/appState): the batch read is the HydrateCatalogCustomRows
 * RPC.
 */

import { act, useLayoutEffect } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogItem } from '@/core/refresh/types';
import { setAutoRefreshEnabled } from '@/core/settings/appPreferences';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import type { CatalogBackedCustomResourceRow } from './customCatalogRowAdapter';
import {
  hydrateCustomCatalogRows,
  useHydratedCustomCatalogRows,
} from './useHydratedCustomCatalogRows';

const app = installAppStateHarness();
let dev: TestCluster;
let stg: TestCluster;
let view: MountedApp;
let rows: CatalogBackedCustomResourceRow[];
let commits: CatalogBackedCustomResourceRow[][];

type HydratedRow = { ref: CatalogItem['ref']; argoCD: { project: string } };

const deferredRows = () => {
  let resolve: (value: HydratedRow[]) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<HydratedRow[]>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

/** The backend's next answers to the batch read. */
const answerHydration = (answer: () => HydratedRow[] | Promise<HydratedRow[]>) => {
  app.backend.answer('HydrateCatalogCustomRows', answer as never);
};
const hydrationReads = () => app.backend.calls('HydrateCatalogCustomRows');

const item = (name: string, ref: Partial<CatalogItem['ref']> = {}): CatalogItem => ({
  ref: {
    clusterId: dev.clusterId,
    group: 'argoproj.io',
    version: 'v1alpha1',
    kind: 'Application',
    resource: 'applications',
    namespace: 'argocd',
    name,
    uid: name,
    ...ref,
  },
  resourceVersion: '1',
  scope: 'Namespace',
  creationTimestamp: '2026-01-01T00:00:00Z',
});
const hydrated = (row: CatalogItem, project = 'default'): HydratedRow => ({
  ref: row.ref,
  argoCD: { project },
});

function Rows({ items, clusterId }: Readonly<{ items: CatalogItem[]; clusterId: string }>) {
  rows = useHydratedCustomCatalogRows(clusterId, items);
  const committedRows = rows;
  useLayoutEffect(() => {
    commits.push(committedRows);
  });
  return (
    <output>{rows.map((row) => `${row.ref.name}:${row.argoCD?.project ?? '-'}`).join(',')}</output>
  );
}
const showRows = (items: CatalogItem[], clusterId = dev.clusterId) =>
  view.show(<Rows items={items} clusterId={clusterId} />);
const text = () => view.container.querySelector('output')?.textContent;

const operationalReports = (action: string) =>
  app.errors.take(
    (record) => record.kinds.includes('operational') && record.context?.action === action
  );

beforeEach(async () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  stg = app.cluster({ name: 'stg', context: 'beta' });
  app.namespaces(dev, ['argocd']);
  app.namespaces(stg, ['argocd']);
  // Mirrors backend/preferences_settings.go UpdateAppPreferences.
  app.backend.answer('UpdateAppPreferences', (request) => ({
    settings: null,
    changedKeys: (request.changes ?? []).map((change) => change.key),
  }));
  rows = [];
  commits = [];
  view = await app.render(null);
});

describe('custom resource page hydration', () => {
  it('keeps current details through background reads and failures, then applies recovered values and deletions', async () => {
    const argoApp = item('app');
    const removed = item('removed');
    answerHydration(() => [hydrated(argoApp), hydrated(removed)]);
    await showRows([argoApp, removed]);
    expect(text()).toBe('app:default,removed:default');

    const refresh = deferredRows();
    answerHydration(() => refresh.promise);
    commits = [];
    await showRows([{ ...argoApp, resourceVersion: '2' }]);
    expect(text()).toBe('app:default');
    expect(
      commits.every((page) => page.length === 1 && page[0]?.argoCD?.project === 'default')
    ).toBe(true);
    await act(async () => refresh.reject(new Error('temporarily unavailable')));
    await app.settle();
    expect(text()).toBe('app:default');
    expect(operationalReports('hydrateCatalogRows')).toHaveLength(1);

    // Auto-refresh off pauses the passive page read; the details stay up.
    await act(async () => setAutoRefreshEnabled(false));
    const readsWhilePaused = hydrationReads().length;
    await showRows([{ ...argoApp, resourceVersion: '3' }]);
    expect(hydrationReads()).toHaveLength(readsWhilePaused);
    expect(text()).toBe('app:default');

    await act(async () => setAutoRefreshEnabled(true));
    answerHydration(() => [hydrated(argoApp, 'recovered')]);
    await showRows([{ ...argoApp, resourceVersion: '4' }]);
    expect(text()).toBe('app:recovered');

    await showRows([]);
    expect(rows).toEqual([]);
  });

  it('never publishes a previous page or late read after navigation, including same-name recreation and another cluster', async () => {
    const argoApp = item('same-name');
    answerHydration(() => [hydrated(argoApp)]);
    await showRows([argoApp]);

    const stale = deferredRows();
    answerHydration(() => stale.promise);
    await showRows([{ ...argoApp, resourceVersion: '2' }]);

    const recreated = item('same-name', { uid: 'replacement' });
    const fresh = deferredRows();
    answerHydration(() => fresh.promise);
    commits = [];
    await showRows([recreated]);
    expect(commits.every((page) => page[0]?.ref.uid === 'replacement' && !page[0].argoCD)).toBe(
      true
    );
    await act(async () => stale.resolve([hydrated(argoApp, 'obsolete')]));
    expect(text()).toBe('same-name:-');
    await act(async () => fresh.resolve([hydrated(recreated, 'new')]));
    expect(text()).toBe('same-name:new');

    const otherCluster = item('same-name', { clusterId: stg.clusterId });
    answerHydration(() => deferredRows().promise);
    commits = [];
    await showRows([otherCluster], stg.clusterId);
    expect(
      commits.every((page) => page[0]?.ref.clusterId === stg.clusterId && !page[0].argoCD)
    ).toBe(true);
    expect(hydrationReads().slice(-1)[0]).toEqual([
      stg.clusterId,
      [expect.objectContaining(otherCluster.ref)],
    ]);
    await showRows([], stg.clusterId);
    expect(rows).toEqual([]);
  });
});

describe('custom resource export hydration', () => {
  it('joins exported rows by complete object identity and falls back when the batch read fails', async () => {
    const argoApp = item('app');
    const otherCluster = item('app', { clusterId: stg.clusterId });
    answerHydration(() => [hydrated(otherCluster, 'wrong-cluster'), hydrated(argoApp)]);

    const exported = await hydrateCustomCatalogRows(dev.clusterId, [argoApp]);
    expect(exported[0]?.argoCD?.project).toBe('default');

    answerHydration(() => {
      throw new Error('unavailable');
    });
    const fallback = await hydrateCustomCatalogRows(dev.clusterId, [argoApp]);
    expect(fallback[0]?.ref).toEqual(argoApp.ref);
    expect(fallback[0]?.argoCD).toBeUndefined();
    expect(operationalReports('hydrateCatalogExportRows')).toHaveLength(1);
  });
});
