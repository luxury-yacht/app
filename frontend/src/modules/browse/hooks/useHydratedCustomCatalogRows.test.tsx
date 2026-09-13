import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '@/core/refresh/types';
import type { CatalogBackedCustomResourceRow } from './customCatalogRowAdapter';
import {
  hydrateCustomCatalogRows,
  useHydratedCustomCatalogRows,
} from './useHydratedCustomCatalogRows';

const mocks = vi.hoisted(() => ({ read: vi.fn(), report: vi.fn(), blocked: false }));
vi.mock('@core/data-access', () => ({
  readHydratedCustomCatalogRows: mocks.read,
  requestData: async ({ read }: { read: () => Promise<unknown> }) =>
    mocks.blocked ? { status: 'blocked' } : { status: 'executed', data: await read() },
}));
vi.mock('@/utils/errorHandler', () => ({ reportOperationalError: mocks.report }));

const deferredRows = () => {
  let resolve: (value: unknown[]) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<unknown[]>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const item = (name: string, ref: Partial<CatalogItem['ref']> = {}): CatalogItem => ({
  ref: {
    clusterId: 'cluster-1',
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
const hydrated = (row: CatalogItem, project = 'default') => ({ ref: row.ref, argoCD: { project } });

let root: Root;
let container: HTMLDivElement;
let rows: CatalogBackedCustomResourceRow[];
let commits: CatalogBackedCustomResourceRow[][];
function Harness({ items, clusterId = 'cluster-1' }: { items: CatalogItem[]; clusterId?: string }) {
  rows = useHydratedCustomCatalogRows(clusterId, items);
  const committedRows = rows;
  useLayoutEffect(() => {
    commits.push(committedRows);
  });
  return (
    <output>{rows.map((row) => `${row.ref.name}:${row.argoCD?.project ?? '-'}`).join(',')}</output>
  );
}
const render = async (items: CatalogItem[], clusterId?: string) => {
  await act(async () => root.render(<Harness items={items} clusterId={clusterId} />));
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  rows = [];
  commits = [];
  mocks.blocked = false;
  mocks.read.mockReset();
  mocks.report.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('custom resource page hydration', () => {
  it('keeps current details through background reads and failures, then applies recovered values and deletions', async () => {
    const app = item('app');
    const removed = item('removed');
    mocks.read.mockResolvedValue([hydrated(app), hydrated(removed)]);
    await render([app, removed]);
    expect(container.textContent).toBe('app:default,removed:default');

    const refresh = deferredRows();
    mocks.read.mockReturnValue(refresh.promise);
    commits = [];
    await render([{ ...app, resourceVersion: '2' }]);
    expect(container.textContent).toBe('app:default');
    expect(
      commits.every((page) => page.length === 1 && page[0].argoCD?.project === 'default')
    ).toBe(true);
    await act(async () => refresh.reject(new Error('temporarily unavailable')));
    expect(container.textContent).toBe('app:default');
    expect(mocks.report).toHaveBeenCalledOnce();

    mocks.blocked = true;
    await render([{ ...app, resourceVersion: '3' }]);
    expect(container.textContent).toBe('app:default');

    mocks.blocked = false;
    mocks.read.mockResolvedValue([hydrated(app, 'recovered')]);
    await render([{ ...app, resourceVersion: '4' }]);
    expect(container.textContent).toBe('app:recovered');
    await render([]);
    expect(rows).toEqual([]);
  });

  it('never publishes a previous page or late read after navigation, including same-name recreation and another cluster', async () => {
    const app = item('same-name');
    mocks.read.mockResolvedValue([hydrated(app)]);
    await render([app]);

    const stale = deferredRows();
    mocks.read.mockReturnValue(stale.promise);
    await render([{ ...app, resourceVersion: '2' }]);

    const recreated = item('same-name', { uid: 'replacement' });
    const fresh = deferredRows();
    mocks.read.mockReturnValue(fresh.promise);
    commits = [];
    await render([recreated]);
    expect(commits.every((page) => page[0].ref.uid === 'replacement' && !page[0].argoCD)).toBe(
      true
    );
    await act(async () => stale.resolve([hydrated(app, 'obsolete')]));
    expect(container.textContent).toBe('same-name:-');
    await act(async () => fresh.resolve([hydrated(recreated, 'new')]));
    expect(container.textContent).toBe('same-name:new');

    const otherCluster = item('same-name', { clusterId: 'cluster-2' });
    mocks.read.mockReturnValue(deferredRows().promise);
    commits = [];
    await render([otherCluster], 'cluster-2');
    expect(commits.every((page) => page[0].ref.clusterId === 'cluster-2' && !page[0].argoCD)).toBe(
      true
    );
    expect(mocks.read).toHaveBeenLastCalledWith('cluster-2', [
      expect.objectContaining(otherCluster.ref),
    ]);
    await render([], 'cluster-2');
    expect(rows).toEqual([]);
  });
});

describe('custom resource export hydration', () => {
  it('joins exported rows by complete object identity and falls back when the batch read fails', async () => {
    const app = item('app');
    const otherCluster = item('app', { clusterId: 'cluster-2' });
    mocks.read.mockResolvedValue([hydrated(otherCluster, 'wrong-cluster'), hydrated(app)]);
    const exported = await hydrateCustomCatalogRows('cluster-1', [app]);
    expect(exported[0].argoCD?.project).toBe('default');
    mocks.read.mockRejectedValue(new Error('unavailable'));
    expect((await hydrateCustomCatalogRows('cluster-1', [app]))[0].ref).toEqual(app.ref);
    expect(mocks.report).toHaveBeenCalledOnce();
    mocks.blocked = true;
    expect((await hydrateCustomCatalogRows('cluster-1', [app]))[0].argoCD).toBeUndefined();
    expect(await hydrateCustomCatalogRows('cluster-1', [])).toEqual([]);
  });
});
