/**
 * frontend/src/modules/cluster/components/ClusterViewCustom.test.tsx
 *
 * The cluster Custom Resources view and the cluster extension views
 * (Karpenter, Cert Manager, External Secrets) it renders. It lists the visible
 * cluster's cluster-scoped custom resources from the object catalog, sorted
 * the way its header shows (the default, or the user's persisted sort), with
 * each page's status and CRD hydrated by the backend; its Kinds filter offers
 * every kind the catalog reports; it sorts only by catalog fields; it opens a resource and its owning CRD with complete identity and
 * deletes a resource after confirmation; it names a catalog permission denial;
 * it replays the last page on revisit instead of a cold spinner; an extension
 * view queries only its resource family and shows that family's facts; and a
 * pending object action does not survive leaving an extension view. Runs in
 * the full app, navigated through the sidebar, over a faked backend
 * (test-utils/appState).
 */

import {
  buildGridTableStorageKey,
  computeClusterHash,
} from '@shared/components/tables/persistence/gridTablePersistence';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeCatalogSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { buildRefreshScope, CLUSTER_SELECTOR } from '@/core/refresh/scopeSelector';
import type {
  CatalogItem,
  CatalogSnapshotPayload,
  CustomResourceSummary,
} from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse, statusResponse } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const widget: ObjectIdentity = {
  group: 'example.com',
  version: 'v1',
  kind: 'Widget',
  namespace: '',
  name: 'gizmo',
};
// A kind another operator's CRD group also defines: only group/version tell them apart.
const dbCluster: ObjectIdentity = {
  group: 'postgresql.cnpg.io',
  version: 'v1',
  kind: 'DBCluster',
  namespace: '',
  name: 'shared-pg',
};
const nodePool: ObjectIdentity = {
  group: 'karpenter.sh',
  version: 'v1',
  kind: 'NodePool',
  namespace: '',
  name: 'workers',
};

const RESOURCES: Record<string, string> = {
  Widget: 'widgets',
  DBCluster: 'dbclusters',
  NodePool: 'nodepools',
};

/** A cluster-scoped custom resource as backend/refresh/snapshot/catalog.go lists it. */
const catalogItem = (identity: ObjectIdentity): CatalogItem => ({
  ref: {
    clusterId: dev.clusterId,
    group: identity.group,
    version: identity.version,
    kind: identity.kind,
    resource: RESOURCES[identity.kind] ?? '',
    name: identity.name,
    uid: `${identity.name}-uid`,
  },
  resourceVersion: '1',
  creationTimestamp: new Date(Date.now() - 86_400_000).toISOString(),
  scope: 'Cluster',
});

const isCustomCatalogRead = ({ domain, scope }: { domain: string; scope: string }) =>
  domain === 'catalog' &&
  scope.startsWith(`${dev.clusterId}|`) &&
  scope.includes('customOnly=true');

/** The catalog's answer to a custom-resource query listing `items`. */
const catalogPage = (
  items: CatalogItem[],
  overrides: Partial<CatalogSnapshotPayload> = {}
): CatalogSnapshotPayload =>
  makeCatalogSnapshotPayload({
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    items,
    total: items.length,
    unfilteredTotal: items.length,
    ...overrides,
  });

/** Answers every custom-resource catalog read in the cluster with `items`. */
const serveCatalog = (
  items: () => CatalogItem[],
  overrides: Partial<CatalogSnapshotPayload> = {}
) =>
  app.snapshots.answer((request) =>
    isCustomCatalogRead(request) ? catalogPage(items(), overrides) : undefined
  );

/**
 * backend/resource_gateway_catalog.go HydrateCatalogCustomRows: the page's rows
 * with their CRD and projected status, plus any family facts.
 */
const hydrate = (facts: Partial<CustomResourceSummary> = {}) => {
  app.backend.answer(
    'HydrateCatalogCustomRows',
    (_clusterId, rows) =>
      (rows ?? []).map((row) => ({
        ref: row,
        crdName: `${row.resource}.${row.group}`,
        status: 'Ready',
        statusPresentation: 'ready',
        age: '1d',
        ...facts,
      })) as never
  );
};

/** The catalog's discovered families (core/navigation/useAvailableResourceViews.ts). */
const discoverFamilies = (cluster: string[]) =>
  app.snapshots.serve(
    'catalog',
    buildRefreshScope('catalog', {
      clusterId: dev.clusterId,
      selector: CLUSTER_SELECTOR,
      query: 'limit=1',
    }),
    makeCatalogSnapshotPayload({
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      resourceFamilies: { cluster },
    })
  );

const start = async (clusterView = 'custom') => {
  view = await app.mountApp();
  await view.goTo({ clusterView });
};

const tableRows = () => Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row'));
const rowOf = (name: string) =>
  requireValue(
    tableRows().find((row) => row.textContent?.includes(name)),
    `expected the ${name} row`
  );
const cellOf = (name: string, column: string) =>
  requireValue(
    rowOf(name).querySelector<HTMLElement>(`.grid-cell[data-column="${column}"]`),
    `expected the ${column} cell of ${name}`
  );

const lastCatalogScope = () =>
  requireValue(
    app.snapshots
      .reads('catalog')
      .filter((read) => read.scope.includes('limit=50'))
      .slice(-1)[0],
    'expected a custom-resource catalog page read'
  ).scope;

const menuItems = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item'));
const menuLabel = (item: HTMLElement) =>
  item.querySelector('.context-menu-label')?.textContent?.trim();

const chooseFromRowMenu = async (name: string, label: string) => {
  await act(async () => {
    cellOf(name, 'name').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    );
  });
  await app.settle();
  await act(async () =>
    requireValue(
      menuItems().find((item) => menuLabel(item) === label),
      `expected the ${label} menu item`
    ).click()
  );
  await app.settle();
};

const deleteConfirmation = () =>
  Array.from(
    document.body.querySelectorAll<HTMLButtonElement>('.confirmation-modal-footer button')
  ).find((button) => button.textContent?.trim() === 'Delete');

const opened = (identity: ObjectIdentity) => ({
  ...identity,
  clusterId: dev.clusterId,
  clusterName: dev.clusterName,
});

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
  app.startScreen(dev);
  // The custom-resource views sit in the sidebar's Extensions group, collapsed by default.
  app.preferences({ sidebarClusterExtensionsExpanded: true });
  hydrate();
});

describe('ClusterViewCustom', () => {
  it('lists cluster-scoped custom resources from the catalog, sorted as displayed, with hydrated status', async () => {
    serveCatalog(() => [catalogItem(widget)]);
    await start();

    const scope = lastCatalogScope();
    expect(scope.startsWith(`${dev.clusterId}|`)).toBe(true);
    expect(scope).toContain('customOnly=true');
    expect(scope).toContain('resourceScope=cluster');
    // The header shows Name ascending by default; the catalog must sort the same way.
    expect(scope).toContain('sort=name&sortDirection=asc');
    expect(app.backend.calls('HydrateCatalogCustomRows')).toEqual([
      [
        dev.clusterId,
        [
          {
            clusterId: dev.clusterId,
            group: 'example.com',
            version: 'v1',
            kind: 'Widget',
            resource: 'widgets',
            name: 'gizmo',
            uid: 'gizmo-uid',
          },
        ],
      ],
    ]);
    expect(cellOf('gizmo', 'status').textContent).toBe('Ready');
    expect(cellOf('gizmo', 'crd').textContent).toBe('widgets.example.com');
  });

  it('queries the catalog with the user’s persisted sort', async () => {
    const storageKey =
      buildGridTableStorageKey({
        clusterHash: await computeClusterHash(dev.clusterId),
        viewId: 'cluster-custom',
      }) ?? '';
    // backend/ui_state_store_persistence.go GetGridTablePersistence: saved table states.
    app.backend.answer(
      'GetGridTablePersistence',
      () => ({ [storageKey]: { version: 3, sort: { key: 'age', direction: 'desc' } } }) as never
    );
    serveCatalog(() => [catalogItem(widget)]);
    await start();

    expect(lastCatalogScope()).toContain('sort=age&sortDirection=desc');
  });

  it('offers every kind the catalog reports in the Kinds filter, not only the loaded page’s', async () => {
    serveCatalog(() => [catalogItem(widget)], {
      kinds: [
        { kind: 'DBCluster', namespaced: false },
        { kind: 'Widget', namespaced: false },
      ],
    });
    await start();

    const trigger = requireValue(
      view.container
        .querySelector('[name="gridtable-filter-kind"]')
        ?.parentElement?.querySelector<HTMLButtonElement>('button.dropdown-trigger'),
      'expected the Kinds filter'
    );
    await act(async () => trigger.click());
    await app.settle();
    const menu = requireValue(
      document.getElementById(trigger.getAttribute('aria-controls') ?? ''),
      'expected the Kinds menu'
    );

    expect(
      Array.from(menu.querySelectorAll('.dropdown-option')).map((option) =>
        option.textContent?.trim()
      )
    ).toEqual(['DBCluster', 'Widget']);
  });

  it('sorts only by fields the catalog can sort, not by hydrated CRD or status', async () => {
    serveCatalog(() => [catalogItem(widget)]);
    await start();

    const sortable = Array.from(
      view.container.querySelectorAll<HTMLElement>('.grid-cell-header[data-sortable="true"]')
    ).map((header) => header.dataset.column);
    expect(sortable).toEqual(['kind', 'name', 'age']);
  });

  it('opens a resource with its group and version so colliding kinds stay distinct', async () => {
    app.servePanel(dev, dbCluster);
    serveCatalog(() => [catalogItem(dbCluster)]);
    await start();

    await chooseFromRowMenu('shared-pg', 'Open Details');

    expect(view.openPanels()).toEqual([opened(dbCluster)]);
  });

  it('opens the owning CRD from the CRD link', async () => {
    const crd: ObjectIdentity = {
      group: 'apiextensions.k8s.io',
      version: 'v1',
      kind: 'CustomResourceDefinition',
      namespace: '',
      name: 'dbclusters.postgresql.cnpg.io',
    };
    app.servePanel(dev, crd);
    serveCatalog(() => [catalogItem(dbCluster)]);
    await start();

    await act(async () =>
      requireValue(
        cellOf('shared-pg', 'crd').querySelector('button'),
        'expected the CRD link'
      ).click()
    );
    await app.settle();

    expect(view.openPanels()).toEqual([opened(crd)]);
  });

  it('deletes a resource with its full identity after confirmation', async () => {
    app.backend.answer('RunObjectAction', () => ({}) as never);
    serveCatalog(() => [catalogItem(dbCluster)]);
    await start();

    await chooseFromRowMenu('shared-pg', 'Delete');
    expect(app.backend.calls('RunObjectAction')).toEqual([]);
    await act(async () => requireValue(deleteConfirmation(), 'expected the confirmation').click());
    await app.settle();

    expect(app.backend.calls('RunObjectAction')).toEqual([
      [{ action: 'delete', target: { ...dbCluster, clusterId: dev.clusterId } }],
    ]);
  });

  it('names a permission denial when the catalog refuses the read', async () => {
    app.snapshots.respond((request) =>
      isCustomCatalogRead(request)
        ? statusResponse(makeErrorStatus('Forbidden', 'catalog list forbidden'))
        : undefined
    );
    await start();

    expect(tableRows()).toEqual([]);
    expect(view.container.textContent).toContain('Insufficient permissions');
    // A denial is an expected outcome: the app reports it without a toast.
    const reports = app.errors.records();
    expect(reports).not.toEqual([]);
    expect(
      reports.every((record) => record.kinds.every((kind) => kind === 'expected-denial'))
    ).toBe(true);
  });

  it('replays the last page on revisit while the catalog reloads', async () => {
    serveCatalog(() => [catalogItem(widget)]);
    await start();
    await view.goTo({ clusterView: 'overview' });

    // The revisit's catalog reads stay in flight.
    const parked: Array<() => void> = [];
    app.snapshots.respond((request) =>
      isCustomCatalogRead(request)
        ? new Promise<Response>((resolve) => {
            parked.push(() =>
              resolve(
                snapshotResponse({
                  ...request,
                  version: 100,
                  payload: catalogPage([catalogItem(widget)]),
                })
              )
            );
          })
        : undefined
    );
    await view.goTo({ clusterView: 'custom' });

    expect(parked).not.toEqual([]);
    expect(tableRows().map((row) => row.textContent)).toEqual([expect.stringContaining('gizmo')]);
    app.snapshots.respond(null);
    await act(async () => {
      parked.splice(0).forEach((answer) => {
        answer();
      });
    });
    await app.settle();
  });

  it('queries only Karpenter resources in its view and shows their Karpenter facts', async () => {
    discoverFamilies(['karpenter']);
    hydrate({ karpenter: { instanceType: 'm5.large' } });
    serveCatalog(() => [catalogItem(nodePool)]);
    await start('karpenter');

    expect(lastCatalogScope()).toContain('resourceFamily=karpenter');
    expect(cellOf('workers', 'instanceType').textContent).toBe('m5.large');
  });

  it('discards a pending object action when the user leaves an extension view', async () => {
    discoverFamilies(['karpenter', 'external-secrets']);
    app.backend.answer('RunObjectAction', () => ({}) as never);
    serveCatalog(() => [catalogItem(nodePool)]);
    await start('karpenter');
    await chooseFromRowMenu('workers', 'Delete');
    expect(deleteConfirmation()).toBeDefined();

    await view.goTo({ clusterView: 'external-secrets' });
    await view.goTo({ clusterView: 'karpenter' });

    expect(deleteConfirmation()).toBeUndefined();
    expect(app.backend.calls('RunObjectAction')).toEqual([]);
  });
});
