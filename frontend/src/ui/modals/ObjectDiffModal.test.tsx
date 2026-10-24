/**
 * frontend/src/ui/modals/ObjectDiffModal.test.tsx
 *
 * The object diff modal as the app opens it: from its menu accelerator, or
 * from an object's Diff action with that object on the left. Each side picks a
 * cluster, namespace, kind, and object from the backend's catalog (searching
 * it for objects beyond the listed page); the modal compares the two objects'
 * YAML, declines a diff over its budget, and Match finds the left object in the
 * right side's cluster. Runs in the full app with the real dropdowns over the
 * faked backend (test-utils/appState): catalog-diff and object-yaml reads are
 * answered by the snapshot server, and catalog lookups by
 * FindCatalogObjectMatch. useObjectDiffYaml.test.tsx covers how each side
 * keeps and replaces its YAML.
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { objectcatalog } from '@/core/backend-api/models';
import { makeCatalogSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { parseRefreshScope } from '@/core/refresh/scopeSelector';
import type { CatalogItem, NamespaceConfigSummary } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let view: MountedApp;
let dev: TestCluster;
let stg: TestCluster;

const deploymentIdentity = (name: string): ObjectIdentity => ({
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  namespace: 'apps',
  name,
});

const configMapIdentity: ObjectIdentity = {
  group: '',
  version: 'v1',
  kind: 'ConfigMap',
  namespace: 'config',
  name: 'app-config',
};

const catalogItem = (
  cluster: TestCluster,
  identity: ObjectIdentity,
  uid = `${identity.name}-uid`
): CatalogItem => ({
  ref: {
    ...identity,
    clusterId: cluster.clusterId,
    resource: `${identity.kind.toLowerCase()}s`,
    uid,
  },
  resourceVersion: '1',
  creationTimestamp: '2026-01-01T00:00:00Z',
  scope: 'Namespace',
});

const deployment = (cluster: TestCluster, name: string, uid?: string) =>
  catalogItem(cluster, deploymentIdentity(name), uid);

/** The catalog entry FindCatalogObjectMatch returns for a Deployment. */
const deploymentMatch = (cluster: TestCluster, name: string, uid?: string) => ({
  ...deployment(cluster, name, uid),
  scope: objectcatalog.Scope.ScopeNamespace,
});

const manifest = (name: string, data: string[] = []) =>
  ['apiVersion: apps/v1', 'kind: Deployment', 'metadata:', `  name: ${name}`, ...data].join('\n');

/**
 * What each cluster's catalog holds for the diff. `searchOnly` objects sit
 * beyond the listed page: the backend returns them only to a search that
 * matches them.
 */
interface ClusterCatalog {
  listed: CatalogItem[];
  searchOnly: CatalogItem[];
}
let catalogs: Map<string, ClusterCatalog>;

const answerCatalog = () =>
  app.snapshots.answer(({ domain, scope }) => {
    if (domain !== 'catalog-diff') {
      return undefined;
    }
    const { clusterId, query } = parseRefreshScope('catalog-diff', scope);
    const cluster = requireValue(
      [dev, stg].find((candidate) => candidate.clusterId === clusterId),
      `a catalog read for unknown cluster ${clusterId}`
    );
    const params = new URLSearchParams(query);
    const namespace = params.get('namespace');
    const search = params.get('search') ?? '';
    const { listed, searchOnly } = catalogs.get(clusterId) ?? { listed: [], searchOnly: [] };
    const all = [...listed, ...searchOnly];
    const inNamespace = all.filter((item) => item.ref.namespace === namespace);
    const items = (search ? all : listed).filter(
      (item) =>
        item.ref.namespace === namespace &&
        item.ref.kind === params.get('kind') &&
        item.ref.name.includes(search)
    );
    return makeCatalogSnapshotPayload({
      clusterId,
      clusterName: cluster.clusterName,
      namespaces: [...new Set(all.map((item) => item.ref.namespace ?? ''))],
      kinds: [...new Set(inNamespace.map((item) => item.ref.kind))].map((kind) => ({
        kind,
        namespaced: true,
      })),
      items,
      total: items.length,
      unfilteredTotal: items.length,
    });
  });

const serveYaml = (cluster: TestCluster, identity: ObjectIdentity, yaml: string) => {
  app.snapshots.serve('object-yaml', app.object(cluster, identity).scopes.detailScope ?? '', {
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
    yaml,
  });
};

beforeEach(async () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  stg = app.cluster({ name: 'stg', context: 'beta' });
  app.namespaces(dev, ['apps', 'config']);
  app.namespaces(stg, ['apps']);
  app.startScreen(dev);
  app.startScreen(stg);
  catalogs = new Map([
    [
      dev.clusterId,
      {
        listed: [deployment(dev, 'alpha'), deployment(dev, 'delta')],
        searchOnly: [deployment(dev, 'beta')],
      },
    ],
    [stg.clusterId, { listed: [deployment(stg, 'gamma')], searchOnly: [] }],
  ]);
  answerCatalog();
  for (const name of ['alpha', 'beta', 'delta']) {
    serveYaml(dev, deploymentIdentity(name), manifest(name));
  }
  app.backend.answer('FindCatalogObjectMatch', () => null);
  view = await app.mountApp();
});

const control = (label: string) =>
  requireValue(
    document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`),
    `expected the ${label} control`
  );

const press = async (key: string, shiftKey = false) => {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
    );
  });
};

/** Picks the highlighted option; the next selector reads its options from the catalog. */
const pressEnterToChoose = async () => {
  await press('Enter');
  await app.settle();
};

/** View > Diff Objects (Ctrl+D outside macOS). */
const openDiff = async () => {
  await act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true })
    );
  });
  await app.settle();
};

const diffOpen = () => view.owners().viewState?.isObjectDiffOpen;

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

/** Picks the option showing `option` in the open dropdown named `label`. */
const pick = async (label: string, option: string) => {
  const trigger = control(label);
  const menu = requireValue(
    document.getElementById(trigger.getAttribute('aria-controls') ?? ''),
    `expected the ${label} options`
  );
  await click(
    requireValue(
      Array.from(menu.querySelectorAll<HTMLElement>('[role="option"]')).find(
        (candidate) => candidate.textContent?.trim() === option
      ),
      `expected ${option} among the ${label} options`
    )
  );
};

/** Opens the dropdown named `label` and picks the option showing `option`. */
const choose = async (label: string, option: string) => {
  await click(control(label));
  await pick(label, option);
};

const chooseDeployment = async (side: 'Left' | 'Right', cluster: TestCluster, name: string) => {
  await choose(`${side} cluster`, cluster.clusterName);
  await choose(`${side} namespace`, 'apps');
  await choose(`${side} kind`, 'Deployment');
  await choose(`${side} object`, name);
};

const chosen = (label: string) => control(label).textContent?.trim();

/** The left or right selector's own button (Match or Clear). */
const selectorButton = (side: 'Left' | 'Right', label: 'Match' | 'Clear') => {
  const selector = Array.from(document.querySelectorAll<HTMLElement>('.object-diff-selector')).find(
    (candidate) => candidate.querySelector('.object-diff-selector-title')?.textContent === side
  );
  return requireValue(
    Array.from(selector?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
      (button) => button.textContent === label
    ),
    `expected the ${side} ${label} button`
  );
};

/** Whether the side has an object chosen; Clear is offered only then. */
const hasObject = (side: 'Left' | 'Right') => !selectorButton(side, 'Clear').disabled;

const diffLines = (side: 'left' | 'right') =>
  Array.from(document.querySelectorAll(`.object-diff-line-text[data-side="${side}"]`), (line) =>
    line.textContent?.trim()
  );

/** Types into the open dropdown's search box. */
const search = async (text: string) => {
  const input = requireValue(
    document.querySelector<HTMLInputElement>('input[aria-label="Search objects"]'),
    'expected the object search'
  );
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await app.settle();
};

/** Opens a Deployment's panel and picks Diff from its Actions menu. */
const diffFromPanel = async (name: string) => {
  app.servePanel(dev, deploymentIdentity(name));
  // A Deployment's Overview asks whether an autoscaler manages it.
  app.backend.answer('IsWorkloadHPAManaged', () => false);
  await act(async () => {
    view.owners().objectPanel.openWithObject(app.object(dev, deploymentIdentity(name)).ref);
  });
  await app.settle();
  await click(control('Actions menu'));
  await clickMenuItem('Diff');
};

const clickMenuItem = async (label: string) => {
  await click(
    requireValue(
      Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item')).find(
        (item) => item.querySelector('.context-menu-label')?.textContent?.trim() === label
      ),
      `expected the ${label} menu item`
    )
  );
};

describe('ObjectDiffModal', () => {
  it('operates its selectors from the keyboard and closes on the second Escape', async () => {
    await openDiff();
    const close = control('Close object diff');
    await act(async () => close.focus());
    expect(selectorButton('Left', 'Match').disabled).toBe(true);

    // The disabled Match and Clear buttons are skipped.
    await press('Tab');
    expect(document.activeElement).toBe(control('Left cluster'));
    await press('Tab', true);
    expect(document.activeElement).toBe(close);
    await press('Tab');
    await press('ArrowDown');
    expect(control('Left cluster').getAttribute('aria-expanded')).toBe('true');
    await pressEnterToChoose();
    expect(chosen('Left cluster')).toContain(dev.clusterName);
    await press('Tab');
    expect(document.activeElement).toBe(control('Left namespace'));
    await press('ArrowDown');
    await press('End');
    await pressEnterToChoose();
    expect(chosen('Left namespace')).toContain('apps');
    await press('Tab');
    expect(document.activeElement).toBe(control('Left kind'));
    await press('ArrowDown');
    await pressEnterToChoose();
    expect(chosen('Left kind')).toContain('Deployment');
    await press('Tab');
    expect(document.activeElement).toBe(control('Left object'));
    await press('Enter');
    expect(document.activeElement?.getAttribute('placeholder')).toBe('Search objects');
    await press('ArrowDown');
    await pressEnterToChoose();
    expect(chosen('Left object')).toContain('alpha');
    await press('Tab');
    expect(document.activeElement).toBe(control('Right cluster'));
    await press('Tab', true);
    expect(document.activeElement).toBe(control('Left object'));

    // The first Escape closes the open dropdown, the second the modal.
    await press('Enter');
    await press('Escape');
    expect(document.activeElement).toBe(control('Left object'));
    expect(diffOpen()).toBe(true);
    await press('Escape');
    expect(diffOpen()).toBe(false);
  });

  // Each side's catalog and YAML reads are user-requested: the backend rebuilds
  // them (a manual refresh job) instead of answering from its cache.
  it('compares the chosen objects’ YAML, read as user-requested refreshes, and can show only the differences', async () => {
    await openDiff();

    await chooseDeployment('Left', dev, 'alpha');
    await chooseDeployment('Right', dev, 'delta');

    expect(diffLines('left')).toEqual(
      expect.arrayContaining(['apiVersion: apps/v1', 'name: alpha'])
    );
    expect(diffLines('right')).toEqual(
      expect.arrayContaining(['apiVersion: apps/v1', 'name: delta'])
    );
    expect(app.snapshots.requests()).toEqual(
      expect.arrayContaining([
        'POST /api/v2/refresh/catalog-diff',
        'POST /api/v2/refresh/object-yaml',
      ])
    );

    await click(
      requireValue(
        Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
          (button) => button.textContent === 'Show Diffs'
        ),
        'expected the Show Diffs toggle'
      )
    );
    expect(diffLines('left')).toEqual(['name: alpha']);
    expect(diffLines('right')).toEqual(['name: delta']);
  });

  it('shows no diff for objects whose difference is over the comparison budget', async () => {
    const lines = (value: string) => [
      'data:',
      ...Array.from({ length: 1_300 }, (_line, index) => `  key-${index}: ${value}`),
    ];
    serveYaml(dev, deploymentIdentity('alpha'), manifest('alpha', lines('left')));
    serveYaml(dev, deploymentIdentity('delta'), manifest('delta', lines('right')));
    await openDiff();

    await chooseDeployment('Left', dev, 'alpha');
    await chooseDeployment('Right', dev, 'delta');

    expect(document.querySelector('section[aria-label="Object difference"]')).toBeNull();
    expect(document.querySelector('.object-diff-viewer')?.textContent).toContain('too large');
  });

  it('finds an object beyond the listed page by searching, and keeps it chosen once the search clears', async () => {
    await openDiff();
    await choose('Left cluster', dev.clusterName);
    await choose('Left namespace', 'apps');
    await choose('Left kind', 'Deployment');

    await click(control('Left object'));
    await search('beta');
    await pick('Left object', 'beta');
    await click(control('Left object'));
    await search('');
    await click(control('Left object'));

    expect(chosen('Left object')).toContain('beta');
  });

  it('matches the left object in the right cluster even beyond its listed page', async () => {
    const stgAlpha = deploymentMatch(stg, 'alpha', 'alpha-stg-uid');
    serveYaml(stg, deploymentIdentity('alpha'), manifest('alpha'));
    app.backend.answer('FindCatalogObjectMatch', () => stgAlpha);
    await openDiff();
    await chooseDeployment('Left', dev, 'alpha');
    await choose('Right cluster', stg.clusterName);

    await click(selectorButton('Left', 'Match'));

    expect(app.backend.calls('FindCatalogObjectMatch')).toEqual([
      [{ clusterId: stg.clusterId, ...deploymentIdentity('alpha') }],
    ]);
    expect(chosen('Right namespace')).toContain('apps');
    expect(chosen('Right kind')).toContain('Deployment');
    expect(chosen('Right object')).toContain('alpha');
  });

  it('opens from an object’s Diff action with that object looked up in the catalog on the left', async () => {
    app.backend.answer('FindCatalogObjectMatch', () => deploymentMatch(dev, 'alpha'));

    await diffFromPanel('alpha');

    expect(diffOpen()).toBe(true);
    expect(app.backend.calls('FindCatalogObjectMatch')).toEqual([
      [{ clusterId: dev.clusterId, ...deploymentIdentity('alpha') }],
    ]);
    expect(chosen('Left cluster')).toContain(dev.clusterName);
    expect(chosen('Left namespace')).toContain('apps');
    expect(chosen('Left kind')).toContain('Deployment');
    expect(chosen('Left object')).toContain('alpha');
  });

  it('opens from a table row’s Diff action with the row’s catalog identity and no lookup', async () => {
    const row: NamespaceConfigSummary = {
      ref: {
        ...configMapIdentity,
        clusterId: dev.clusterId,
        resource: 'configmaps',
        uid: 'app-config-uid',
      },
      data: 1,
      age: '1d',
    };
    app.serveTable(dev, 'namespace-config', { rows: [row] });
    catalogs.set(dev.clusterId, {
      listed: [catalogItem(dev, configMapIdentity, 'app-config-uid')],
      searchOnly: [],
    });
    serveYaml(
      dev,
      configMapIdentity,
      'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: app-config'
    );
    await view.goTo({ namespace: 'config', view: 'config' });
    const cell = requireValue(
      view.container.querySelector<HTMLElement>('.gridtable-row .grid-cell'),
      'expected the app-config row'
    );
    await act(async () => {
      cell.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
      );
    });
    await app.settle();

    await clickMenuItem('Diff');

    expect(diffOpen()).toBe(true);
    expect(app.backend.calls('FindCatalogObjectMatch')).toEqual([]);
    expect(chosen('Left namespace')).toContain('config');
    expect(chosen('Left kind')).toContain('ConfigMap');
    expect(chosen('Left object')).toContain('app-config');
  });

  it.each([
    [
      'the left cluster changes',
      async () => choose('Left cluster', stg.clusterName),
      { namespaceKept: false },
    ],
    [
      'the diff closes',
      async () => {
        await press('Escape');
        await openDiff();
      },
      { namespaceKept: true },
    ],
  ])(
    'discards a Diff action’s catalog lookup that finishes after %s',
    async (_change, change, { namespaceKept }) => {
      app.backend.answer('FindCatalogObjectMatch', () => deploymentMatch(dev, 'alpha'));
      const finishLookup = app.backend.hold('FindCatalogObjectMatch');
      await diffFromPanel('alpha');

      await change();
      await act(async () => finishLookup());
      await app.settle();

      expect(diffOpen()).toBe(true);
      expect(hasObject('Left')).toBe(false);
      expect(chosen('Left namespace')?.includes('apps')).toBe(namespaceKept);
    }
  );
});
