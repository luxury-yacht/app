/**
 * frontend/src/modules/browse/components/BrowseView.test.tsx
 *
 * Browse lists the backend catalog query's page in each scope: cluster-scoped
 * objects for the cluster, one namespace's objects pinned to it, and every
 * namespace's objects with a Namespace column under All Namespaces. A row opens
 * its object with full identity, its menu offers the actions its catalog facts
 * allow, header sorts and page navigation go to the backend query, and
 * Download writes every matching row. Each scope keeps its own persisted
 * table state; only All Namespaces shares the namespace selection, and a
 * persisted Kind the selected API groups no longer offer is dropped. Query
 * paging, doorbells, and filter options are covered by useBrowseCatalog.test.tsx.
 * Runs in the full app, navigated through the sidebar, over a faked backend
 * (test-utils/appState).
 */

import { OBJECT_ACTION_IDS, objectActionLabel } from '@shared/actions/objectActionContract';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCatalogSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import type { CatalogItem, CatalogSnapshotPayload } from '@/core/refresh/types';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@/shared/components/tables/gridTableFilterState';
import {
  buildGridTableStorageKey,
  computeClusterHash,
  type GridTablePersistedState,
} from '@/shared/components/tables/persistence/gridTablePersistence';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

const catalogItem = ({
  kind,
  name,
  namespace,
  group = '',
  resource = `${kind.toLowerCase()}s`,
  actionFacts,
}: {
  kind: string;
  name: string;
  namespace?: string;
  group?: string;
  resource?: string;
  actionFacts?: CatalogItem['actionFacts'];
}): CatalogItem => ({
  ref: {
    clusterId: dev.clusterId,
    group,
    version: 'v1',
    kind,
    resource,
    namespace,
    name,
    uid: `${namespace ?? 'cluster'}-${name}`,
  },
  resourceVersion: '1',
  creationTimestamp: TWO_DAYS_AGO,
  scope: namespace ? 'Namespace' : 'Cluster',
  actionFacts,
});

const unique = <T,>(values: T[]) => Array.from(new Set(values));

/**
 * The backend's catalog query: the page of `items` the scope's resource scope,
 * pins, filters, sort, and cursor select. Facets describe the scope before
 * filtering, except that Kinds follow the selected API groups. Cursors are row
 * offsets.
 */
const catalogPage = (
  items: CatalogItem[],
  scope: string,
  extra: Partial<CatalogSnapshotPayload>
): CatalogSnapshotPayload => {
  const query = new URLSearchParams(scope.slice(scope.indexOf('|') + 1));
  const resourceScope = query.get('resourceScope');
  const pinned = query.getAll('scopeNamespace');
  const inScope = items.filter(
    (item) =>
      (resourceScope !== 'cluster' || item.scope === 'Cluster') &&
      (resourceScope !== 'namespace' || item.scope === 'Namespace') &&
      (pinned.length === 0 || pinned.includes(item.ref.namespace ?? ''))
  );
  const kinds = query.getAll('kind');
  const namespaces = query.getAll('namespace').filter((value) => value !== 'cluster');
  const groups = query.getAll('apiGroup');
  const search = query.get('search') ?? '';
  const inGroups = inScope.filter(
    (item) => groups.length === 0 || groups.includes(item.ref.group || '(core)')
  );
  const sortKey = query.get('sort') === 'name' ? 'name' : 'kind';
  const direction = query.get('sortDirection') === 'desc' ? -1 : 1;
  const matching = inGroups
    .filter(
      (item) =>
        (kinds.length === 0 || kinds.includes(item.ref.kind)) &&
        (namespaces.length === 0 || namespaces.includes(item.ref.namespace ?? '')) &&
        item.ref.name.includes(search)
    )
    .sort(
      (left, right) =>
        direction *
        `${left.ref[sortKey]}/${left.ref.name}`.localeCompare(
          `${right.ref[sortKey]}/${right.ref.name}`
        )
    );
  const limit = Number(query.get('limit') ?? 50);
  const start = Number(query.get('continue') ?? 0);
  const page = matching.slice(start, start + limit);
  return makeCatalogSnapshotPayload({
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    items: page,
    total: matching.length,
    unfilteredTotal: inScope.length,
    continue: start + limit < matching.length ? String(start + limit) : '',
    previous: start > 0 ? String(Math.max(0, start - limit)) : '',
    hasNext: start + limit < matching.length,
    hasPrevious: start > 0,
    resourceCount: inScope.length,
    batchSize: page.length,
    kinds: unique(inGroups.map((item) => item.ref.kind)).map((kind) => ({
      kind,
      namespaced: inGroups.some((item) => item.ref.kind === kind && item.scope === 'Namespace'),
    })),
    namespaces: unique(inScope.flatMap((item) => (item.ref.namespace ? [item.ref.namespace] : []))),
    groups: unique(inScope.map((item) => item.ref.group || '(core)')),
    ...extra,
  });
};

/** Answers every Browse catalog query in dev; the start screen serves its own read. */
const serveCatalog = (items: CatalogItem[], extra: Partial<CatalogSnapshotPayload> = {}) => {
  app.snapshots.answer(({ domain, scope }) =>
    domain === 'catalog' &&
    scope.startsWith(`${dev.clusterId}|`) &&
    scope !== `${dev.clusterId}|limit=1`
      ? catalogPage(items, scope, extra)
      : undefined
  );
};

/** The Browse page queries (not the facet reads), as their query strings. */
const pageQueries = () =>
  app.snapshots
    .reads('catalog')
    .map((read) => new URLSearchParams(read.scope.slice(read.scope.indexOf('|') + 1)))
    .filter((query) => query.get('limit') !== '1');
const lastPageQuery = () =>
  requireValue(pageQueries().slice(-1)[0], 'expected a Browse catalog query');

/** Seeds the table state the app hydrates from GetGridTablePersistence. */
const persistTables = async (entries: Record<string, Omit<GridTablePersistedState, 'version'>>) => {
  const clusterHash = await computeClusterHash(dev.clusterId);
  const persisted = Object.fromEntries(
    Object.entries(entries).map(([viewId, state]) => [
      requireValue(buildGridTableStorageKey({ clusterHash, viewId }), 'expected a storage key'),
      { version: 3, ...state },
    ])
  );
  app.backend.answer('GetGridTablePersistence', () => persisted as never);
};

const rows = () => Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row'));
const rowOf = (name: string) =>
  requireValue(
    rows().find((row) => row.querySelector('[data-column="name"]')?.textContent?.trim() === name),
    `expected the ${name} row`
  );
const rowNames = () =>
  rows().map((row) => row.querySelector('[data-column="name"]')?.textContent?.trim());
const columnKeys = () =>
  Array.from(view.container.querySelectorAll<HTMLElement>('th[data-column]')).map(
    (header) => header.dataset.column
  );

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};
const clickLabelled = (label: string) =>
  click(
    requireValue(
      view.container.querySelector<HTMLElement>(`[aria-label="${label}"]`),
      `expected the ${label} control`
    )
  );

const menuItems = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item'));
const menuLabel = (item: HTMLElement) =>
  item.querySelector('.context-menu-label')?.textContent?.trim();
const openRowMenu = async (name: string) => {
  const cell = requireValue(
    rowOf(name).querySelector<HTMLElement>('.grid-cell'),
    'expected a cell'
  );
  await act(async () => {
    cell.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    );
  });
  await app.settle();
  return menuItems();
};

const node = () => catalogItem({ kind: 'Node', name: 'worker-a' });
const pod = (name: string, namespace: string) => catalogItem({ kind: 'Pod', name, namespace });

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
  app.startScreen(dev);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BrowseView', () => {
  it('lists the cluster’s cluster-scoped objects from the catalog query, without a Namespace column', async () => {
    serveCatalog([node(), pod('api', 'team-a')]);
    view = await app.mountApp();

    await view.goTo({ clusterView: 'browse' });

    expect(rowNames()).toEqual(['worker-a']);
    expect(rowOf('worker-a').querySelector('[data-column="age"]')?.textContent?.trim()).toBe('2d');
    expect(lastPageQuery().get('resourceScope')).toBe('cluster');
    expect(columnKeys()).toEqual(['kind', 'name', 'api', 'age']);
  });

  it('pins Namespace Browse to its namespace', async () => {
    serveCatalog([node(), pod('api', 'team-a'), pod('db', 'team-b')]);
    view = await app.mountApp();

    await view.goTo({ namespace: 'team-a', view: 'browse' });

    expect(rowNames()).toEqual(['api']);
    expect(lastPageQuery().getAll('scopeNamespace')).toEqual(['team-a']);
    expect(columnKeys()).not.toContain('namespace');
  });

  it('lists every namespace’s objects under All Namespaces, with a Namespace column that opens the namespace', async () => {
    app.serveTable(dev, 'namespace-workloads');
    serveCatalog([node(), pod('api', 'team-a'), pod('db', 'team-b')]);
    view = await app.mountApp();

    await view.goTo({ namespace: 'namespace:all', view: 'browse' });

    expect(rowNames()).toEqual(['api', 'db']);
    expect(columnKeys()).toContain('namespace');
    await click(
      requireValue(
        rowOf('db').querySelector<HTMLElement>('[data-column="namespace"] button'),
        'expected the namespace link'
      )
    );
    const owners = view.owners();
    expect(owners.viewState?.viewType).toBe('namespace');
    expect(owners.viewState?.activeNamespaceTab).toBe('workloads');
    expect(owners.namespace.selectedNamespace).toBe('team-b');
  });

  it('opens the focused row’s object in its panel with full identity on Enter', async () => {
    const api = pod('api', 'team-a');
    app.servePanel(dev, {
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'team-a',
      name: 'api',
    });
    serveCatalog([api]);
    view = await app.mountApp();
    await view.goTo({ namespace: 'team-a', view: 'browse' });
    const table = requireValue(
      view.container.querySelector<HTMLElement>('table[tabindex="0"]'),
      'expected the Browse table'
    );

    await act(async () => table.focus());
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });
    await app.settle();

    expect(view.openPanels()).toEqual([
      {
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'team-a',
        name: 'api',
      },
    ]);
  });

  it('offers the actions each row’s catalog facts allow', async () => {
    serveCatalog([
      catalogItem({
        kind: 'Deployment',
        name: 'web',
        namespace: 'team-a',
        group: 'apps',
        actionFacts: { hpaManaged: true, desiredReplicas: 3 },
      }),
      catalogItem({
        kind: 'CronJob',
        name: 'nightly',
        namespace: 'team-a',
        group: 'batch',
        actionFacts: { status: 'Suspended' },
      }),
    ]);
    view = await app.mountApp();
    await view.goTo({ namespace: 'team-a', view: 'browse' });

    // An autoscaler owns the replica count, so only Scale to zero is offered.
    const deploymentMenu = (await openRowMenu('web')).map(menuLabel);
    expect(deploymentMenu).toContain(objectActionLabel(OBJECT_ACTION_IDS.scaleToZero));
    expect(deploymentMenu).not.toContain(objectActionLabel(OBJECT_ACTION_IDS.scale));

    const cronMenu = await openRowMenu('nightly');
    expect(cronMenu.map(menuLabel)).toContain(objectActionLabel(OBJECT_ACTION_IDS.resume));
    const trigger = requireValue(
      cronMenu.find((item) => menuLabel(item) === objectActionLabel(OBJECT_ACTION_IDS.triggerNow)),
      'expected Trigger Now'
    );
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
  });

  it('sorts and pages through the backend query', async () => {
    app.preferences({ defaultTablePageSize: 25 });
    serveCatalog(
      Array.from({ length: 30 }, (_, index) =>
        pod(`pod-${String(index).padStart(2, '0')}`, 'team-a')
      )
    );
    view = await app.mountApp();
    await view.goTo({ namespace: 'team-a', view: 'browse' });
    expect(rows()).toHaveLength(25);

    await clickLabelled('Sort by Name');
    expect(lastPageQuery().get('sort')).toBe('name');
    expect(rowNames()[0]).toBe('pod-00');

    await clickLabelled('Next page');
    expect(lastPageQuery().get('continue')).toBe('25');
    expect(rowNames()).toEqual(['pod-25', 'pod-26', 'pod-27', 'pod-28', 'pod-29']);
  });

  it('downloads every matching row, not just the shown page', async () => {
    app.preferences({ defaultTablePageSize: 25 });
    app.backend.answer('SaveCsvFile', (filename) => ({ path: `/tmp/${filename}`, bytes: 1 }));
    serveCatalog(Array.from({ length: 30 }, (_, index) => pod(`pod-${index}`, 'team-a')));
    view = await app.mountApp();
    await view.goTo({ namespace: 'team-a', view: 'browse' });

    await clickLabelled('Download all matching rows');
    await click(
      requireValue(
        Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
          (item) => item.textContent?.trim() === 'Save to File'
        ),
        'expected Save to File'
      )
    );

    const [[, csv]] = app.backend.calls('SaveCsvFile');
    expect(csv.trim().split('\n')).toHaveLength(31);
  });

  it('keeps each scope’s own table state, sharing only the All Namespaces namespace selection', async () => {
    await persistTables({
      browse: {
        filters: { ...DEFAULT_GRID_TABLE_FILTER_STATE, kinds: { mode: 'some', values: ['Node'] } },
      },
      // The namespace selection every All Namespaces view shares (useGridTablePersistence.ts).
      'shared-namespace-filter': {
        filters: {
          ...DEFAULT_GRID_TABLE_FILTER_STATE,
          namespaces: { mode: 'some', values: ['team-b'] },
        },
      },
    });
    serveCatalog([node(), pod('api', 'team-a'), pod('db', 'team-b')]);
    view = await app.mountApp();

    await view.goTo({ clusterView: 'browse' });
    expect(lastPageQuery().getAll('kind')).toEqual(['Node']);
    expect(lastPageQuery().getAll('namespace')).toEqual(['cluster']);

    await view.goTo({ namespace: 'namespace:all', view: 'browse' });
    expect(lastPageQuery().getAll('kind')).toEqual([]);
    expect(lastPageQuery().getAll('namespace')).toEqual(['team-b']);
    expect(rowNames()).toEqual(['db']);
  });

  it.each([
    { persistedKind: 'Pod', queriedKinds: [] },
    { persistedKind: 'Deployment', queriedKinds: ['Deployment'] },
  ])(
    'queries a persisted $persistedKind only while the selected API groups offer it',
    async ({ persistedKind, queriedKinds }) => {
      await persistTables({
        'all-namespaces-browse': {
          filters: {
            ...DEFAULT_GRID_TABLE_FILTER_STATE,
            kinds: { mode: 'some', values: [persistedKind] },
            queryFacets: { apiGroups: { mode: 'some', values: ['apps'] } },
          },
        },
      });
      serveCatalog([
        catalogItem({ kind: 'Deployment', name: 'web', namespace: 'team-a', group: 'apps' }),
        pod('api', 'team-a'),
      ]);
      view = await app.mountApp();

      await view.goTo({ namespace: 'namespace:all', view: 'browse' });

      expect(lastPageQuery().getAll('kind')).toEqual(queriedKinds);
      expect(lastPageQuery().getAll('apiGroup')).toEqual(['apps']);
    }
  );
});
