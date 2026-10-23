/**
 * frontend/src/modules/namespace/components/NsViewCustom.test.tsx
 *
 * The namespace Custom Resources view and the resource-family views built on
 * it (Argo CD, External Secrets). They list the namespace's custom resources
 * from the object catalog's custom-only query in the visible cluster, with
 * the status and family facts the backend hydrates for the page; open a row's
 * object with its own API group when Kinds collide, and its CRD; sort only by
 * the catalog's fields; delete after confirmation with full identity; discard
 * a pending delete when the user leaves the view; and under All Namespaces
 * list every namespace's objects. The status column and page hydration are
 * covered once in CustomResourceGridView.test.tsx and
 * useHydratedCustomCatalogRows.test.tsx. Runs in the full app, navigated
 * through the sidebar, over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeCatalogSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { buildRefreshScope, CLUSTER_SELECTOR } from '@/core/refresh/scopeSelector';
import type { CatalogItem, CustomResourceSummary } from '@/core/refresh/types';
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

type CustomObject = ObjectIdentity & {
  resource: string;
  /** What the backend hydrates for the object (HydrateCatalogCustomRows). */
  hydrated?: Partial<CustomResourceSummary>;
};

const rdsInstance: CustomObject = {
  group: 'rds.services.k8s.aws',
  version: 'v1alpha1',
  kind: 'DBInstance',
  resource: 'dbinstances',
  namespace: 'team-a',
  name: 'db-1',
  hydrated: { status: 'Available', statusPresentation: 'ready' },
};
// Same Kind, namespace, and name, from another operator's API group.
const documentDbInstance: CustomObject = {
  ...rdsInstance,
  group: 'documentdb.services.k8s.aws',
  hydrated: { status: 'Creating', statusPresentation: 'warning' },
};

const identityOf = ({ group, version, kind, namespace, name }: CustomObject): ObjectIdentity => ({
  group,
  version,
  kind,
  namespace,
  name,
});

/** A catalog row as backend/objectcatalog projects a namespaced custom resource. */
const catalogItem = ({ hydrated: _hydrated, ...object }: CustomObject): CatalogItem => ({
  ref: { clusterId: dev.clusterId, uid: `${object.group}/${object.name}-uid`, ...object },
  resourceVersion: '1',
  creationTimestamp: '2026-10-01T10:00:00Z',
  scope: 'Namespace',
});

/**
 * Answers the view's custom-only catalog queries in the visible cluster with
 * the objects in the queried namespace and resource family, and hydrates each
 * page the way backend/refresh_object_catalog.go HydrateCatalogCustomRows does.
 */
const serveCustomResources = (objects: CustomObject[], families: Record<string, string[]> = {}) => {
  app.snapshots.answer(({ domain, scope }) => {
    if (domain !== 'catalog' || !scope.startsWith(`${dev.clusterId}|`)) {
      return undefined;
    }
    const query = new URLSearchParams(scope.slice(scope.indexOf('|') + 1));
    if (query.get('customOnly') !== 'true') {
      return undefined;
    }
    const namespaces = query.getAll('namespace');
    const family = query.get('resourceFamily');
    const items = objects
      .filter((object) => namespaces.length === 0 || namespaces.includes(object.namespace))
      .filter((object) => !family || (families[family] ?? []).includes(object.group))
      .map(catalogItem);
    return makeCatalogSnapshotPayload({
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      items,
      total: items.length,
      unfilteredTotal: items.length,
      resourceCount: items.length,
    });
  });
  app.backend.answer(
    'HydrateCatalogCustomRows',
    (_clusterId, pageRows) =>
      (pageRows ?? []).map((row) => ({
        ref: row,
        crdName: `${row.resource}.${row.group}`,
        age: '3d',
        ...objects.find((object) => object.group === row.group && object.name === row.name)
          ?.hydrated,
      })) as never
  );
};

/** The cluster discovered these resource families (core/navigation/useAvailableResourceViews.ts). */
const discoverFamilies = (namespaced: string[]) => {
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
      resourceFamilies: { namespaced },
    })
  );
};

const start = async (target: { namespace: string; view: string }) => {
  view = await app.mountApp();
  await view.goTo(target);
};

const rows = () => Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row'));
const rowTexts = () => rows().map((row) => row.textContent);

const cellButton = (row: HTMLElement, column: string) =>
  requireValue(
    row.querySelector<HTMLButtonElement>(`[data-column="${column}"] button`),
    `expected the ${column} link`
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

const openRowMenu = async (row: HTMLElement) => {
  const cell = requireValue(
    row.querySelector<HTMLElement>('[data-column="age"]'),
    'expected a cell in the row'
  );
  await activate(() => {
    cell.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    );
  });
};

const deleteConfirmation = () =>
  Array.from(
    document.body.querySelectorAll<HTMLButtonElement>('.confirmation-modal-footer button')
  ).find((button) => button.textContent?.trim() === 'Delete');

const requestDelete = async (row: HTMLElement) => {
  await openRowMenu(row);
  await activate(() => menuItem('Delete').click());
};

const inCluster = (identity: ObjectIdentity) => ({
  clusterId: dev.clusterId,
  clusterName: dev.clusterName,
  ...identity,
});

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
  app.startScreen(dev);
  // The sidebar's Extensions group, where these views live, as the user left it open.
  app.preferences({ sidebarNamespaceExtensionsExpanded: true });
});

describe('NsViewCustom', () => {
  it('lists the namespace’s custom resources from the catalog with their hydrated status, in the visible cluster', async () => {
    serveCustomResources([rdsInstance, { ...rdsInstance, namespace: 'team-b', name: 'db-2' }]);
    await start({ namespace: 'team-a', view: 'custom' });

    expect(rowTexts()).toEqual([expect.stringMatching(/db-1.*Available.*dbinstances\.rds/)]);
    const pageRead = requireValue(
      app.snapshots
        .reads('catalog')
        .map((read) => read.scope)
        .find((scope) => scope.includes('customOnly=true') && scope.includes('limit=50')),
      'expected the custom resources query'
    );
    expect(pageRead.startsWith(`${dev.clusterId}|`)).toBe(true);
    expect(
      new URLSearchParams(pageRead.slice(pageRead.indexOf('|') + 1)).getAll('namespace')
    ).toEqual(['team-a']);
    expect(app.backend.calls('HydrateCatalogCustomRows')).toEqual([
      [
        dev.clusterId,
        [expect.objectContaining({ clusterId: dev.clusterId, ...identityOf(rdsInstance) })],
      ],
    ]);
  });

  it('opens a row’s object with its own API group when another operator’s Kind collides', async () => {
    app.servePanel(dev, identityOf(documentDbInstance));
    serveCustomResources([rdsInstance, documentDbInstance]);
    await start({ namespace: 'team-a', view: 'custom' });
    const documentDbRow = requireValue(
      rows().find((row) => row.textContent?.includes('documentdb')),
      'expected the DocumentDB row'
    );

    await activate(() => cellButton(documentDbRow, 'name').click());

    expect(view.openPanels()).toEqual([inCluster(identityOf(documentDbInstance))]);
  });

  it('opens a row’s CRD from its CRD cell', async () => {
    const crd: ObjectIdentity = {
      group: 'apiextensions.k8s.io',
      version: 'v1',
      kind: 'CustomResourceDefinition',
      namespace: '',
      name: 'dbinstances.rds.services.k8s.aws',
    };
    app.servePanel(dev, crd);
    serveCustomResources([rdsInstance]);
    await start({ namespace: 'team-a', view: 'custom' });

    await activate(() => cellButton(requireValue(rows()[0], 'expected the row'), 'crd').click());

    expect(view.openPanels()).toEqual([inCluster(crd)]);
  });

  it('sorts only by the catalog’s fields, through the catalog query', async () => {
    serveCustomResources([rdsInstance]);
    await start({ namespace: 'team-a', view: 'custom' });
    const sortControls = () =>
      Array.from(view.container.querySelectorAll<HTMLButtonElement>('.gridtable-sort-button')).map(
        (button) => button.getAttribute('aria-label')
      );

    // Status and CRD are hydrated after the catalog selects the page, so no global sort exists.
    expect(sortControls()).toEqual(['Sort by Kind', 'Sort by Name', 'Sort by Age']);

    const sortByName = requireValue(
      view.container.querySelector<HTMLButtonElement>('[aria-label="Sort by Name"]'),
      'expected the Name sort control'
    );
    await activate(() => sortByName.click());

    const lastPageQuery = new URLSearchParams(
      requireValue(
        app.snapshots
          .reads('catalog')
          .map((read) => read.scope)
          .filter((scope) => scope.includes('limit=50'))
          .slice(-1)[0],
        'expected a page query'
      ).split('|')[1]
    );
    expect(lastPageQuery.get('sort')).toBe('name');
    expect(lastPageQuery.get('sortDirection')).toBe('desc');
  });

  it('deletes the row’s own object after confirmation when Kinds collide', async () => {
    app.backend.answer('RunObjectAction', () => ({}) as never);
    serveCustomResources([rdsInstance, documentDbInstance]);
    await start({ namespace: 'team-a', view: 'custom' });
    const documentDbRow = requireValue(
      rows().find((row) => row.textContent?.includes('documentdb')),
      'expected the DocumentDB row'
    );

    await requestDelete(documentDbRow);
    expect(app.backend.calls('RunObjectAction')).toEqual([]);
    await activate(() => requireValue(deleteConfirmation(), 'expected the confirmation').click());

    expect(app.backend.calls('RunObjectAction')).toEqual([
      [
        {
          action: 'delete',
          target: { clusterId: dev.clusterId, ...identityOf(documentDbInstance) },
        },
      ],
    ]);
    expect(deleteConfirmation()).toBeUndefined();
  });

  it('reports a delete the backend refuses', async () => {
    app.backend.answer('RunObjectAction', () => {
      throw new Error('dbinstances "db-1" is forbidden');
    });
    serveCustomResources([rdsInstance]);
    await start({ namespace: 'team-a', view: 'custom' });

    await requestDelete(requireValue(rows()[0], 'expected the row'));
    await activate(() => requireValue(deleteConfirmation(), 'expected the confirmation').click());

    expect(app.errors.take((record) => record.context?.action === 'delete')).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({ kind: 'DBInstance', name: 'db-1' }),
      }),
    ]);
    expect(deleteConfirmation()).toBeUndefined();
  });

  it('lists the namespace’s Argo CD objects with the sync and health each one reports', async () => {
    const application: CustomObject = {
      group: 'argoproj.io',
      version: 'v1alpha1',
      kind: 'Application',
      resource: 'applications',
      namespace: 'team-a',
      name: 'storefront',
      hydrated: {
        argoCD: {
          sync: 'Synced',
          syncPresentation: 'ready',
          health: 'Degraded',
          healthPresentation: 'error',
          project: 'production',
        },
      },
    };
    const applicationSet: CustomObject = {
      ...application,
      kind: 'ApplicationSet',
      resource: 'applicationsets',
      name: 'storefront-set',
      hydrated: { argoCD: { project: 'production' } },
    };
    discoverFamilies(['argocd']);
    serveCustomResources([application, applicationSet, rdsInstance], {
      argocd: ['argoproj.io'],
    });
    await start({ namespace: 'team-a', view: 'argocd' });

    expect(
      app.snapshots
        .reads('catalog')
        .some(
          (read) =>
            read.scope.includes('resourceFamily=argocd') && read.scope.includes('namespace=team-a')
        )
    ).toBe(true);
    const cellText = (name: string, column: string) =>
      requireValue(
        rows().find((row) => row.querySelector('[data-column="name"]')?.textContent === name),
        `expected the ${name} row`
      ).querySelector(`[data-column="${column}"]`)?.textContent;
    // A synced Application can still be degraded: each signal is its own.
    expect([cellText('storefront', 'sync'), cellText('storefront', 'health')]).toEqual([
      'Synced',
      'Degraded',
    ]);
    // An object that reports neither shows neither.
    expect([cellText('storefront-set', 'sync'), cellText('storefront-set', 'health')]).toEqual([
      '-',
      '-',
    ]);
    expect(rows()).toHaveLength(2);
  });

  it.each([
    { scope: 'one namespace', namespace: 'team-a' },
    { scope: 'All Namespaces', namespace: 'namespace:all' },
  ])('discards a pending delete when the user leaves the view in $scope', async ({ namespace }) => {
    app.backend.answer('RunObjectAction', () => ({}) as never);
    const application: CustomObject = {
      group: 'argoproj.io',
      version: 'v1alpha1',
      kind: 'Application',
      resource: 'applications',
      namespace: 'team-a',
      name: 'storefront',
    };
    discoverFamilies(['argocd', 'external-secrets']);
    serveCustomResources([application], {
      argocd: ['argoproj.io'],
      'external-secrets': ['external-secrets.io'],
    });
    await start({ namespace, view: 'argocd' });
    await requestDelete(requireValue(rows()[0], 'expected the Application row'));
    expect(deleteConfirmation()).toBeDefined();

    await view.goTo({ namespace, view: 'external-secrets' });
    expect(deleteConfirmation()).toBeUndefined();
    await view.goTo({ namespace, view: 'argocd' });

    expect(deleteConfirmation()).toBeUndefined();
    expect(app.backend.calls('RunObjectAction')).toEqual([]);
  });

  it('lists every namespace’s custom resources under All Namespaces and opens a row’s namespace in Custom Resources', async () => {
    serveCustomResources([rdsInstance, { ...rdsInstance, namespace: 'team-b', name: 'db-2' }]);
    await start({ namespace: 'namespace:all', view: 'custom' });

    expect(rowTexts()).toEqual([
      expect.stringMatching(/db-1.*team-a/),
      expect.stringMatching(/db-2.*team-b/),
    ]);

    const teamBRow = requireValue(rows()[1], 'expected the team-b row');
    await activate(() => cellButton(teamBRow, 'namespace').click());

    const owners = view.owners();
    expect(owners.namespace.selectedNamespace).toBe('team-b');
    expect(owners.viewState?.viewType).toBe('namespace');
    expect(owners.viewState?.activeNamespaceTab).toBe('custom');
  });
});
