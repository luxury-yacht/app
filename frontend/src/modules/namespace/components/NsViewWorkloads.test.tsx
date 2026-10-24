/**
 * frontend/src/modules/namespace/components/NsViewWorkloads.test.tsx
 *
 * The namespace Workloads view lists the namespace's workloads from the
 * backend's namespace-workloads query in the visible cluster, and the other
 * cluster's after a cluster tab switch. A pointer click only highlights a
 * workload (a click on empty table space clears it); Enter opens it in its
 * panel with full identity. A workload's Pods count (or Space) opens the pods
 * it owns in a table attached under its row: that table queries the pods by
 * the workload's complete identity, keeps its state in memory without the
 * shared Namespaces selection or a Favorite, never shows another workload's
 * pods while it loads, and closes from its own Close or when the workload
 * leaves the table. Each namespace keeps its open pods, which open again when
 * the user returns to the namespace or the view. Row menus offer Scale only for
 * workloads that scale and carry each workload's action facts (CronJob Trigger
 * and Resume). All Namespaces lists every namespace's workloads, and leaving
 * the view stops its streams. Column rendering, action availability, and
 * action references are covered by useWorkloadTableColumns.test.tsx,
 * shared/hooks/useObjectActions.test.tsx, and workloadActionReference.test.ts.
 * Runs in the full app, navigated through the sidebar, over a faked backend
 * (test-utils/appState).
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeNamespaceWorkloadSummary,
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { parseRefreshScope } from '@/core/refresh/scopeSelector';
import type {
  CanonicalRowTestOverrides,
  NamespaceWorkloadSummary,
  PodSnapshotEntry,
} from '@/core/refresh/types';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@/shared/components/tables/gridTableFilterState';
import {
  buildGridTableStorageKey,
  computeClusterHash,
} from '@/shared/components/tables/persistence/gridTablePersistence';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const workloadIdentity = (kind: string, name: string, namespace = 'team-a'): ObjectIdentity => ({
  group: kind === 'CronJob' || kind === 'Job' ? 'batch' : 'apps',
  version: 'v1',
  kind,
  namespace,
  name,
});

/** A workload row as backend/refresh/snapshot/namespace_workloads.go projects it. */
const workload = (
  kind: string,
  name: string,
  overrides: CanonicalRowTestOverrides<NamespaceWorkloadSummary> = {}
) => {
  const { ref, ...row } = overrides;
  const identity = workloadIdentity(kind, name, ref?.namespace);
  return makeNamespaceWorkloadSummary({
    ready: '2/3',
    hpaManaged: false,
    ...row,
    ref: {
      clusterId: dev.clusterId,
      resource: `${kind.toLowerCase()}s`,
      uid: `${name}-uid`,
      ...identity,
      ...ref,
    },
  });
};

/** A pod `owner` owns, as backend/refresh/snapshot/pods.go projects it. */
const podOf = (owner: NamespaceWorkloadSummary, name: string): PodSnapshotEntry =>
  makePodSnapshotEntry({
    ownerKind: owner.ref.kind,
    ownerName: owner.ref.name,
    ownerApiVersion: `${owner.ref.group}/${owner.ref.version}`,
    ref: { clusterId: dev.clusterId, namespace: owner.ref.namespace, name },
  });

const podsPage = (rows: PodSnapshotEntry[]) =>
  makePodSnapshotPayload({
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    rows,
    total: rows.length,
    unfilteredTotal: rows.length,
    totalCount: rows.length,
  });

/** The owner a pods read narrows to (its `facet.owners` value), or null. */
const ownerOfRead = (scope: string): string[] | null => {
  const { query } = parseRefreshScope('pods', scope);
  const owner = new URLSearchParams(query ?? '').get('facet.owners');
  return owner ? (JSON.parse(owner) as string[]) : null;
};

/** The attached pods queries, each as the owner identity it narrows to. */
const ownerQueries = () =>
  app.snapshots
    .reads('pods')
    .map((read) => ownerOfRead(read.scope))
    .filter((owner): owner is string[] => owner !== null);

/**
 * Serves `rows` for every workloads read, and for every pods read narrowed to
 * an owner the pods `pods` lists for it (backend/refresh/snapshot/pods.go
 * filters by the owner facet). Returns a function that stops serving `rows`.
 */
const serve = (rows: NamespaceWorkloadSummary[], pods: PodSnapshotEntry[] = []) => {
  const stopServingRows = app.serveTable(dev, 'namespace-workloads', { rows });
  app.snapshots.answer(({ domain, scope }) => {
    if (domain !== 'pods' || !scope.startsWith(`${dev.clusterId}|`)) {
      return undefined;
    }
    const owner = ownerOfRead(scope);
    return podsPage(
      owner ? pods.filter((pod) => pod.ownerKind === owner[1] && pod.ownerName === owner[2]) : pods
    );
  });
  return stopServingRows;
};

/** The backend rings the namespace's workloads clock; the view reads its rows again. */
const ringWorkloads = async (version: string) => {
  const subscription = requireValue(
    app.streams.active().find((key) => key.startsWith('namespace-workloads ')),
    'expected the workloads stream'
  );
  await act(async () => {
    app.streams.ring(
      'namespace-workloads',
      subscription.slice(subscription.indexOf(' ') + 1),
      'object',
      version
    );
    // Signals apply after the stream's coalescing window (resourceStreamManager.ts UPDATE_COALESCE_MS).
    await vi.advanceTimersByTimeAsync(500);
  });
  await app.settle();
};

const start = async (namespace = 'team-a') => {
  app.startScreen(dev);
  view = await app.mountApp();
  await view.goTo({ namespace, view: 'workloads' });
};

const activate = async (run: () => void) => {
  await act(async () => {
    run();
  });
  await app.settle();
};

/** The Workloads table's own rows (attached pods tables nest rows of their own). */
const workloadRows = () =>
  Array.from(
    view.container.querySelectorAll<HTMLElement>('.gridtable-workloads .gridtable-row')
  ).filter((row) => !row.closest('[data-gridtable-row-detail]'));

const rowOf = (name: string) =>
  requireValue(
    workloadRows().find((row) => row.querySelector('[data-column="name"]')?.textContent === name),
    `expected the ${name} workload row`
  );

const podsToggle = (name: string) =>
  requireValue(
    rowOf(name).querySelector<HTMLButtonElement>('button[aria-expanded]'),
    `expected the ${name} Pods count`
  );

/** The pods table open under a workload's row, or null when it is closed. */
const attachedPods = (name: string) => {
  const controls = podsToggle(name).getAttribute('aria-controls');
  return controls ? document.getElementById(controls) : null;
};

const attachedPodNames = (name: string) =>
  Array.from(
    requireValue(attachedPods(name), `expected ${name}'s pods`).querySelectorAll<HTMLElement>(
      '.gridtable-row [data-column="name"]'
    )
  ).map((cell) => cell.textContent);

const workloadsTable = () =>
  requireValue(
    view.container.querySelector<HTMLElement>('.gridtable-workloads[tabindex="0"]'),
    'expected the Workloads table'
  );

const pressKey = (key: string) =>
  activate(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    );
  });

const menuItems = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item'));
const menuLabel = (item: HTMLElement) =>
  item.querySelector('.context-menu-label')?.textContent?.trim();
const menuItem = (label: string) =>
  requireValue(
    menuItems().find((item) => menuLabel(item) === label),
    `expected the ${label} menu item`
  );

/** Right-clicks the workload's row, as the user opens its menu, and returns the menu's labels. */
const openRowMenu = async (name: string) => {
  const cell = requireValue(
    rowOf(name).querySelector<HTMLElement>('[data-column="status"]'),
    `expected a cell in the ${name} row`
  );
  await activate(() => {
    cell.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    );
  });
  return menuItems().map(menuLabel);
};

const confirmButton = (label: string) =>
  requireValue(
    Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.confirmation-modal-footer button')
    ).find((button) => button.textContent?.trim() === label),
    `expected the ${label} confirmation`
  );

const inCluster = (identity: ObjectIdentity) => ({
  clusterId: dev.clusterId,
  clusterName: dev.clusterName,
  ...identity,
});

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NsViewWorkloads', () => {
  it('lists the namespace’s workloads from the backend query in the visible cluster', async () => {
    serve([workload('Deployment', 'api')]);
    await start();

    expect(workloadRows().map((row) => row.textContent)).toEqual([expect.stringContaining('api')]);
    const read = requireValue(
      app.snapshots.reads('namespace-workloads').slice(-1)[0],
      'expected a namespace-workloads read'
    );
    expect(read.scope.startsWith(`${dev.clusterId}|namespace:team-a`)).toBe(true);
  });

  it('lists the other cluster’s workloads after the user switches cluster tabs', async () => {
    const prod = app.cluster({ name: 'prod', context: 'beta' });
    app.namespaces(prod, ['team-a']);
    app.startScreen(prod);
    serve([workload('Deployment', 'api')]);
    app.serveTable(prod, 'namespace-workloads', {
      rows: [
        makeNamespaceWorkloadSummary({
          ref: {
            clusterId: prod.clusterId,
            resource: 'deployments',
            uid: 'checkout-uid',
            ...workloadIdentity('Deployment', 'checkout'),
          },
        }),
      ],
    });
    await start();
    app.snapshots.clearReads();

    await view.selectCluster(prod);
    await view.goTo({ namespace: 'team-a', view: 'workloads' });

    expect(
      workloadRows().map((row) => row.querySelector('[data-column="name"]')?.textContent)
    ).toEqual(['checkout']);
    expect(
      app.snapshots
        .reads('namespace-workloads')
        .map((read) => read.scope)
        .filter((scope) => !scope.startsWith(`${prod.clusterId}|`))
    ).toEqual([]);
  });

  it('opens the pods a workload owns under its row from its Pods count', async () => {
    const api = workload('Deployment', 'api');
    serve([api], [podOf(api, 'api-0'), podOf(api, 'api-1')]);
    await start();
    expect(attachedPods('api')).toBeNull();

    await activate(() => podsToggle('api').click());

    expect(podsToggle('api').getAttribute('aria-expanded')).toBe('true');
    expect(attachedPodNames('api')).toEqual(['api-0', 'api-1']);
    expect(ownerQueries()).toContainEqual([
      'owner',
      'Deployment',
      'api',
      dev.clusterId,
      'apps',
      'v1',
      'team-a',
    ]);
    expect(view.openPanels()).toEqual([]);

    await activate(() => podsToggle('api').click());

    expect(attachedPods('api')).toBeNull();
  });

  it('highlights a workload on a pointer click, opens or closes its pods with Space, opens it on Enter, and clears the highlight on an empty-space click', async () => {
    const api = workload('Deployment', 'api');
    serve([api], [podOf(api, 'api-0')]);
    app.servePanel(dev, workloadIdentity('Deployment', 'api'));
    // backend/autoscaling_details.go IsWorkloadHPAManaged: the Deployment panel asks; no HPA.
    app.backend.answer('IsWorkloadHPAManaged', () => false);
    await start();

    const statusCell = requireValue(
      rowOf('api').querySelector<HTMLElement>('[data-column="status"]'),
      'expected the api status cell'
    );
    await activate(() => statusCell.click());
    expect(rowOf('api').getAttribute('data-row-selected')).toBe('true');
    expect(view.openPanels()).toEqual([]);
    expect(attachedPods('api')).toBeNull();

    await activate(() => workloadsTable().focus());
    await pressKey(' ');
    expect(attachedPodNames('api')).toEqual(['api-0']);
    await pressKey(' ');
    expect(attachedPods('api')).toBeNull();

    await pressKey('Enter');
    expect(view.openPanels()).toEqual([inCluster(workloadIdentity('Deployment', 'api'))]);
    expect(rowOf('api').getAttribute('data-row-selected')).toBe('true');

    // A click on the table's unused space clears the highlight.
    await activate(() =>
      requireValue(
        workloadsTable().closest<HTMLElement>('.gridtable-wrapper'),
        'expected the Workloads table body'
      ).click()
    );
    expect(rowOf('api').getAttribute('data-row-selected')).toBeNull();
  });

  it('keeps each workload’s pods open while another opens, and its own Close closes only it', async () => {
    const api = workload('Deployment', 'api');
    const db = workload('StatefulSet', 'db');
    serve([api, db], [podOf(api, 'api-0'), podOf(db, 'db-0')]);
    await start();

    await activate(() => podsToggle('api').click());
    await activate(() => podsToggle('db').click());
    expect(attachedPodNames('api')).toEqual(['api-0']);
    expect(attachedPodNames('db')).toEqual(['db-0']);

    const close = requireValue(
      requireValue(attachedPods('api'), 'expected api’s pods').querySelector<HTMLElement>(
        '[title="Close pods"], [aria-label="Close pods"]'
      ),
      'expected the attached table’s Close'
    );
    await activate(() => close.click());

    expect(attachedPods('api')).toBeNull();
    expect(attachedPodNames('db')).toEqual(['db-0']);
  });

  it('never shows another workload’s pods while a newly opened table loads', async () => {
    const api = workload('Deployment', 'api');
    const web = workload('Deployment', 'web');
    serve([api, web], [podOf(api, 'api-0'), podOf(web, 'web-0')]);
    await start();
    await activate(() => podsToggle('api').click());
    expect(attachedPodNames('api')).toEqual(['api-0']);
    await activate(() => podsToggle('api').click());

    // web's first pods read is still in flight.
    const parked: Array<() => void> = [];
    app.snapshots.respond(({ domain, scope }) =>
      domain === 'pods' && ownerOfRead(scope)?.[2] === 'web'
        ? new Promise<Response>((resolve) => {
            parked.push(() =>
              resolve(
                snapshotResponse({
                  domain,
                  scope,
                  version: 1,
                  payload: podsPage([podOf(web, 'web-0')]),
                })
              )
            );
          })
        : undefined
    );
    await activate(() => podsToggle('web').click());

    expect(attachedPodNames('web')).toEqual([]);

    app.snapshots.respond(null);
    await activate(() => {
      parked.splice(0).forEach((answer) => {
        answer();
      });
    });
    expect(attachedPodNames('web')).toEqual(['web-0']);
  });

  it('keeps each namespace’s open pods, and opens them again when the user returns to the namespace', async () => {
    const api = workload('Deployment', 'api');
    serve([api], [podOf(api, 'api-0')]);
    await start();
    await activate(() => podsToggle('api').click());
    expect(attachedPodNames('api')).toEqual(['api-0']);

    await view.goTo({ namespace: 'team-b', view: 'workloads' });
    expect(view.container.querySelector('[data-gridtable-row-detail]')).toBeNull();

    await view.goTo({ namespace: 'team-a', view: 'workloads' });
    expect(podsToggle('api').getAttribute('aria-expanded')).toBe('true');
    expect(attachedPodNames('api')).toEqual(['api-0']);
  });

  it('opens a workload’s pods again when the user returns to the view', async () => {
    const api = workload('Deployment', 'api');
    const web = workload('Deployment', 'web');
    serve([api, web], [podOf(api, 'api-0'), podOf(web, 'web-0')]);
    await start();
    await activate(() => podsToggle('web').click());
    expect(attachedPodNames('web')).toEqual(['web-0']);

    await view.goTo({ clusterView: 'overview' });
    await view.goTo({ namespace: 'team-a', view: 'workloads' });

    expect(attachedPods('api')).toBeNull();
    expect(podsToggle('web').getAttribute('aria-expanded')).toBe('true');
    expect(attachedPodNames('web')).toEqual(['web-0']);
  });

  it('closes a workload’s pods and highlight when it leaves the table', async () => {
    vi.useFakeTimers();
    const api = workload('Deployment', 'api');
    const web = workload('Deployment', 'web');
    const stopServing = serve([api, web], [podOf(api, 'api-0')]);
    await start();
    await activate(() => podsToggle('api').click());
    expect(attachedPodNames('api')).toEqual(['api-0']);
    expect(rowOf('api').getAttribute('data-row-selected')).toBe('true');

    // api is deleted.
    stopServing();
    const stopServingWeb = app.serveTable(dev, 'namespace-workloads', { rows: [web] });
    await ringWorkloads('2');
    expect(
      workloadRows().map((row) => row.querySelector('[data-column="name"]')?.textContent)
    ).toEqual(['web']);

    // A new api appears: it starts closed and unhighlighted.
    stopServingWeb();
    app.serveTable(dev, 'namespace-workloads', { rows: [api, web] });
    await ringWorkloads('3');
    expect(attachedPods('api')).toBeNull();
    expect(rowOf('api').getAttribute('data-row-selected')).toBeNull();
  });

  it('offers a suspended CronJob Resume without Trigger, and triggers an active one after confirmation', async () => {
    app.backend.answer('RunObjectAction', () => ({}) as never);
    serve([
      workload('CronJob', 'backup', { status: 'Idle', ready: '0' }),
      workload('CronJob', 'nightly', { status: 'Suspended', ready: '0' }),
    ]);
    await start();

    const suspendedMenu = await openRowMenu('nightly');
    expect(suspendedMenu).toContain('Resume');
    expect(suspendedMenu).not.toContain('Suspend');
    expect(menuItem('Trigger Now').getAttribute('aria-disabled')).toBe('true');
    await activate(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    const activeMenu = await openRowMenu('backup');
    expect(activeMenu).toContain('Suspend');
    expect(activeMenu).not.toContain('Scale');
    await activate(() => menuItem('Trigger Now').click());
    expect(app.backend.calls('RunObjectAction')).toEqual([]);
    await activate(() => confirmButton('Trigger').click());

    expect(app.backend.calls('RunObjectAction')).toEqual([
      [
        {
          action: 'trigger',
          target: { clusterId: dev.clusterId, ...workloadIdentity('CronJob', 'backup') },
        },
      ],
    ]);
  });

  it('offers Scale only for workloads that scale', async () => {
    serve([workload('Deployment', 'api'), workload('DaemonSet', 'agent')]);
    await start();

    expect(await openRowMenu('api')).toContain('Scale');
    await activate(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(await openRowMenu('agent')).not.toContain('Scale');
  });

  it('lists every namespace’s workloads under All Namespaces and opens a workload’s namespace in Workloads', async () => {
    serve([
      workload('Deployment', 'api'),
      workload('Deployment', 'db', { ref: { namespace: 'team-b' } }),
    ]);
    await start('namespace:all');

    expect(workloadRows().map((row) => row.textContent)).toEqual([
      expect.stringMatching(/api.*team-a/),
      expect.stringMatching(/db.*team-b/),
    ]);
    expect(
      app.snapshots
        .reads('namespace-workloads')
        .some((read) => read.scope.startsWith(`${dev.clusterId}|namespace:all`))
    ).toBe(true);

    const namespaceLink = requireValue(
      Array.from(rowOf('db').querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent === 'team-b'
      ),
      'expected the db workload’s namespace link'
    );
    await activate(() => namespaceLink.click());

    const owners = view.owners();
    expect(owners.namespace.selectedNamespace).toBe('team-b');
    expect(owners.viewState?.viewType).toBe('namespace');
    expect(owners.viewState?.activeNamespaceTab).toBe('workloads');
  });

  it('keeps an attached table’s state in memory, without the saved Namespaces selection or a Favorite', async () => {
    vi.useFakeTimers();
    // backend/ui_state_store_persistence.go GetGridTablePersistence: the
    // Namespaces selection All Namespaces views share, saved as team-a
    // (useGridTablePersistence.ts SHARED_NAMESPACE_FILTER_VIEW_ID).
    const sharedNamespaceKey = requireValue(
      buildGridTableStorageKey({
        clusterHash: await computeClusterHash(dev.clusterId),
        viewId: 'shared-namespace-filter',
      }),
      'expected the shared Namespaces key'
    );
    app.backend.answer(
      'GetGridTablePersistence',
      () =>
        ({
          [sharedNamespaceKey]: {
            version: 3,
            filters: {
              ...DEFAULT_GRID_TABLE_FILTER_STATE,
              namespaces: { mode: 'some', values: ['team-a'] },
            },
          },
        }) as never
    );
    const api = workload('Deployment', 'api');
    serve([api], [podOf(api, 'api-0')]);
    await start('namespace:all');
    const lastQuery = (domain: 'namespace-workloads' | 'pods') =>
      new URLSearchParams(
        parseRefreshScope(
          domain,
          requireValue(app.snapshots.reads(domain).slice(-1)[0], `expected a ${domain} read`).scope
        ).query ?? ''
      );
    expect(lastQuery('namespace-workloads').getAll('namespaces')).toEqual(['team-a']);

    await activate(() => podsToggle('api').click());

    const pods = requireValue(attachedPods('api'), 'expected api’s pods');
    expect(attachedPodNames('api')).toEqual(['api-0']);
    expect(lastQuery('pods').get('namespaces')).toBeNull();
    expect(pods.querySelector('[title="Save as favorite"]')).toBeNull();
    expect(view.container.querySelectorAll('[title="Save as favorite"]')).toHaveLength(1);

    const sortByName = requireValue(
      pods.querySelector<HTMLButtonElement>('[aria-label="Sort by Name"]'),
      'expected the attached table’s Name sort'
    );
    await activate(() => sortByName.click());

    expect(lastQuery('pods').get('sortDirection')).toBe('desc');
    // Tables save their state after a debounce (useGridTablePersistence.ts SAVE_DEBOUNCE_MS).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const savedKeys = app.backend.calls('SetGridTablePersistence').map(([key]) => key);
    expect(savedKeys.some((key) => key.includes('namespace-workloads'))).toBe(true);
    expect(savedKeys.filter((key) => key.includes('namespace-workload-pods'))).toEqual([]);
  });

  it('stops listening for workload and pod changes once the user leaves the view', async () => {
    vi.useFakeTimers();
    const api = workload('Deployment', 'api');
    serve([api], [podOf(api, 'api-0')]);
    await start();
    await activate(() => podsToggle('api').click());
    const viewStreams = () =>
      app.streams
        .active()
        .filter(
          (stream) => stream.startsWith('namespace-workloads ') || stream.startsWith('pods ')
        );
    expect(viewStreams()).toEqual([
      expect.stringMatching(/^namespace-workloads /),
      expect.stringMatching(/^pods /),
    ]);

    await view.goTo({ clusterView: 'overview' });
    // A released stream closes after the unsubscribe debounce (resourceStreamManager.ts).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(viewStreams()).toEqual([]);
  });
});
