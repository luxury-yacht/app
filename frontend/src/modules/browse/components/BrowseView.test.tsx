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
import { requestContextRefresh } from '@/core/data-access';
import { makeCatalogSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import type { CatalogItem, CatalogSnapshotPayload } from '@/core/refresh/types';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@/shared/components/tables/gridTableFilterState';
import { requestGridTableFilters } from '@/shared/components/tables/hooks/gridTableFilterRequest';
import { buildGridTableFocusRequest } from '@/shared/components/tables/hooks/gridTableFocusRequest';
import { setPendingFocusRequest } from '@/shared/components/tables/hooks/useGridTableExternalFocus';
import {
  buildGridTableStorageKey,
  computeClusterHash,
  type GridTablePersistedState,
} from '@/shared/components/tables/persistence/gridTablePersistence';
import { useNavigateToView } from '@/shared/hooks/useNavigateToView';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
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
        (left.ref[sortKey].localeCompare(right.ref[sortKey]) ||
          left.ref.name.localeCompare(right.ref.name))
    );
  const limit = Number(query.get('limit') ?? 50);
  const anchorName = query.get('anchor.name');
  const anchorUid = query.get('anchor.uid');
  const anchor = anchorName
    ? inScope.find(
        ({ ref }) =>
          ref.name === anchorName &&
          ref.clusterId === query.get('anchor.clusterId') &&
          ref.group === (query.get('anchor.group') ?? '') &&
          ref.version === query.get('anchor.version') &&
          ref.kind === query.get('anchor.kind') &&
          (ref.namespace ?? '') === (query.get('anchor.namespace') ?? '') &&
          (!anchorUid || ref.uid === anchorUid)
      )
    : undefined;
  const rank = anchor ? matching.indexOf(anchor) : -1;
  const start = rank >= 0 ? Math.floor(rank / limit) * limit : Number(query.get('continue') ?? 0);
  const page = matching.slice(start, start + limit);
  return makeCatalogSnapshotPayload({
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    items: page,
    total: matching.length,
    unfilteredTotal: inScope.length,
    ...(anchorName
      ? {
          anchor:
            rank >= 0
              ? { found: true, rank }
              : { found: false, rank, reason: anchor ? 'filtered' : 'not-found' },
          pageStartRank: start,
          self: String(start),
        }
      : {}),
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
const mountWithNavigation = async () => {
  let navigateToView: ReturnType<typeof useNavigateToView>['navigateToView'] | undefined;
  const NavigateProbe = () => {
    navigateToView = useNavigateToView().navigateToView;
    return null;
  };
  view = await app.mountApp(<NavigateProbe />);
  return requireValue(navigateToView, 'mounted navigation hook');
};

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

  it.each([
    { scope: 'cluster', namespace: undefined, alreadyOpen: false },
    { scope: 'namespace', namespace: 'team-a', alreadyOpen: false },
    { scope: 'cluster', namespace: undefined, alreadyOpen: true },
    { scope: 'namespace', namespace: 'team-a', alreadyOpen: true },
  ])(
    'focuses an off-page $scope object when Browse is already open: $alreadyOpen',
    async ({ scope, namespace, alreadyOpen }) => {
      const viewId = namespace ? 'namespace-browse' : 'browse';
      await persistTables({ [viewId]: { sort: { key: 'name', direction: 'asc' }, pageSize: 25 } });
      const widget = (name: string) =>
        catalogItem({ kind: 'Widget', name, group: 'example.com', namespace });
      const target = widget('widget-target');
      serveCatalog([
        ...Array.from({ length: 51 }, (_, index) => widget(`widget-${index}`)),
        target,
      ]);
      const navigateToView = await mountWithNavigation();
      if (alreadyOpen) {
        await view.goTo(namespace ? { namespace, view: 'browse' } : { clusterView: 'browse' });
        expect(rowNames()).not.toContain(target.ref.name);
      }

      await act(async () => navigateToView({ ...target.ref }));
      await app.settle();

      const query = lastPageQuery();
      expect(Object.fromEntries(query.entries())).toMatchObject({
        'anchor.name': target.ref.name,
        'anchor.group': target.ref.group,
        'anchor.version': target.ref.version,
        'anchor.uid': target.ref.uid,
        resourceScope: scope,
      });
      expect(query.get('anchor.namespace')).toBe(namespace ?? null);
      expect(rowOf(target.ref.name).getAttribute('data-row-focused')).toBe('true');
    }
  );

  it('reports a Browse target hidden by the current filters and keeps those filters', async () => {
    const widget = catalogItem({ kind: 'Widget', name: 'hidden-widget', group: 'example.com' });
    await persistTables({
      browse: { filters: { ...DEFAULT_GRID_TABLE_FILTER_STATE, search: 'worker' } },
    });
    serveCatalog([widget, node()]);
    const navigateToView = await mountWithNavigation();

    await view.goTo({ clusterView: 'browse' });
    await act(async () => navigateToView({ ...widget.ref }));
    await app.settle();

    expect(lastPageQuery().get('search')).toBe('worker');
    expect(rowNames()).toEqual(['worker-a']);
    const reports = app.errors.take((record) => record.context?.source === 'resource-grid-anchor');
    expect(reports).toHaveLength(1);
    expect((reports[0].error as Error).message).toContain('current filters');
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

  // API Resources lists the kinds CustomResourceDefinitions define. A
  // definition whose kind the cluster does not serve (it never became
  // Established) has no row there, but the definition still exists and Browse
  // lists it. The cluster says which case it is, by the definition's exact
  // name: "show in list" on one that exists ends in Browse, with that
  // definition's row focused; one that does not exist is reported as not found.
  describe('a definition API Resources has no row for', () => {
    const definition = (name: string) =>
      catalogItem({
        kind: 'CustomResourceDefinition',
        name,
        group: 'apiextensions.k8s.io',
        resource: 'customresourcedefinitions',
      });

    /** `reason` is the cluster's answer to the read that asks for the definition's row. */
    const showInList = async (
      name: string,
      reason: 'unlisted' | 'not-found',
      from: 'overview' | 'api-resources' = 'overview'
    ) => {
      app.serveTable(dev, 'cluster-api-resources', ({ scope }) => ({
        rows: [],
        ...(scope.includes('anchor.name=') ? { anchor: { found: false, rank: -1, reason } } : {}),
      }));
      const navigateToView = await mountWithNavigation();
      await view.goTo({ clusterView: from });
      await act(async () => {
        navigateToView({
          clusterId: dev.clusterId,
          clusterName: dev.clusterName,
          group: 'apiextensions.k8s.io',
          version: 'v1',
          kind: 'CustomResourceDefinition',
          name,
          uid: definition(name).ref.uid,
        });
      });
      // API Resources answers that it has no such row, then Browse may load.
      await app.settle();
      await app.settle();
    };

    it('opens Browse from an already open API Resources table', async () => {
      serveCatalog([definition('widgets.example.com')]);

      await showInList('widgets.example.com', 'unlisted', 'api-resources');

      expect(view.owners().viewState?.activeClusterTab).toBe('browse');
      expect(rowOf('widgets.example.com').getAttribute('data-row-focused')).toBe('true');
    });

    it('drops the focus handoff when Browse is left before its anchor settles', async () => {
      const name = 'widgets.example.com';
      serveCatalog([definition(name)]);
      let release: (() => void) | undefined;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      app.snapshots.respond((request) => {
        if (request.domain === 'catalog' && request.scope.includes('anchor.name=')) {
          return pending.then(() =>
            snapshotResponse({
              ...request,
              version: 100,
              payload: catalogPage([], request.scope, {}),
            })
          );
        }
        return undefined;
      });

      await showInList(name, 'unlisted');
      expect(lastPageQuery().get('anchor.name')).toBe(name);
      await view.goTo({ clusterView: 'overview' });
      await act(async () => requireValue(release, 'parked Browse response')());
      await app.settle();

      expect(
        app.errors.take((record) => record.context?.source === 'resource-grid-anchor')
      ).toEqual([]);
      const previousReads = pageQueries().filter((query) => query.has('anchor.name')).length;
      await view.goTo({ clusterView: 'browse' });
      expect(pageQueries().filter((query) => query.has('anchor.name'))).toHaveLength(previousReads);
      expect(rowOf(name).getAttribute('data-row-focused')).toBeNull();
    });

    it('discards the focus and filters if Browse is left before table preferences load', async () => {
      const name = 'widgets.example.com';
      const target = definition(name);
      serveCatalog([node(), target]);
      const hydrate = app.backend.hold('GetGridTablePersistence');
      view = await app.mountApp();
      const focus = requireValue(
        buildGridTableFocusRequest({ ...target.ref }),
        'expected CRD focus'
      );
      setPendingFocusRequest({ ...focus, destinationViewId: 'browse', requiresAnchor: true });
      requestGridTableFilters({
        clusterId: dev.clusterId,
        destinationViewId: 'browse',
        filters: {
          ...DEFAULT_GRID_TABLE_FILTER_STATE,
          search: name,
          kinds: { mode: 'some', values: [focus.kind] },
        },
      });

      await view.goTo({ clusterView: 'browse' });
      expect(app.backend.calls('GetGridTablePersistence')).not.toEqual([]);
      expect(pageQueries()).toEqual([]);
      await view.goTo({ clusterView: 'overview' });
      await act(async () => hydrate());

      await view.goTo({ clusterView: 'browse' });
      expect(pageQueries().some((query) => query.has('anchor.name'))).toBe(false);
      expect(rowNames()).toEqual(expect.arrayContaining(['worker-a', name]));
      expect(rowOf(name).getAttribute('data-row-focused')).toBeNull();
    });

    it('lands on the exact definition past the first page of Browse search matches', async () => {
      await persistTables({ browse: { sort: { key: 'name', direction: 'desc' }, pageSize: 25 } });
      serveCatalog([
        node(),
        definition('widgets.example.com'),
        ...Array.from({ length: 26 }, (_, index) =>
          definition(`widgets.example.com.au${String(index).padStart(2, '0')}`)
        ),
      ]);

      await showInList('widgets.example.com', 'unlisted');

      expect(view.owners().viewState?.activeClusterTab).toBe('browse');
      expect(rowOf('widgets.example.com').getAttribute('data-row-focused')).toBe('true');
      expect(rowOf('widgets.example.com.au00').getAttribute('data-row-focused')).toBeNull();
      expect(lastPageQuery().getAll('kind')).toEqual(['CustomResourceDefinition']);
      expect(lastPageQuery().get('search')).toBe('widgets.example.com');
      expect(lastPageQuery().get('sortDirection')).toBe('desc');
      expect(lastPageQuery().get('limit')).toBe('25');
      expect(lastPageQuery().get('anchor.uid')).toBe('cluster-widgets.example.com');

      await act(async () => {
        await requestContextRefresh({ reason: 'user', clusterId: dev.clusterId });
      });
      await app.settle();
      expect(lastPageQuery().get('continue')).toBe('25');
      expect(lastPageQuery().has('anchor.name')).toBe(false);
      expect(rowNames()).toContain('widgets.example.com');

      await clickLabelled('Previous page');
      expect(lastPageQuery().get('continue')).toBe('0');
      expect(rowNames()).not.toContain('widgets.example.com');
    });

    // A definition that is gone must not be answered with a different
    // definition whose name starts the same: the user stays in API Resources
    // and is told it was not found.
    it('is reported as not found, without going to Browse, when it does not exist', async () => {
      serveCatalog([node(), definition('widgets.example.com.au')]);

      await showInList('widgets.example.com', 'not-found');

      expect(view.owners().viewState?.activeClusterTab).toBe('api-resources');
      const reports = app.errors
        .take((record) => record.context?.source === 'resource-grid-anchor')
        .map((record) => (record.error as Error).message);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain('CustomResourceDefinition widgets.example.com');
    });

    it('does not focus a replacement definition when the original is deleted during the handoff', async () => {
      const replacement = definition('widgets.example.com');
      replacement.ref.uid = 'replacement';
      serveCatalog([node(), replacement]);

      await showInList('widgets.example.com', 'unlisted');

      expect(view.owners().viewState?.activeClusterTab).toBe('browse');
      expect(rowOf('widgets.example.com').getAttribute('data-row-focused')).toBeNull();
      expect(
        app.errors.take((record) => record.context?.source === 'resource-grid-anchor')
      ).toHaveLength(1);

      await view.goTo({ clusterView: 'api-resources' });
      await app.settle();
      expect(view.owners().viewState?.activeClusterTab).toBe('api-resources');
    });
  });
});
