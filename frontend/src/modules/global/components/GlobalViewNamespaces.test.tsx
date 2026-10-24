/**
 * frontend/src/modules/global/components/GlobalViewNamespaces.test.tsx
 *
 * The Global Namespaces view joins every open cluster's namespace list with
 * that cluster's namespace metrics into one table with a Cluster column, still
 * lists the other clusters when one cluster's list is denied, keeps metrics
 * live only while shown, and keeps its table state when clusters close. Its links act in the row's
 * own cluster: the namespace opens in its Object Panel without leaving the
 * Global view; the cluster link, Go to Namespace, and the attention links
 * switch to that cluster's Overview, workloads, or filtered attention; and a
 * row's menu reflects its own cluster's permissions. The namespace table's
 * shared columns are covered by ClusterViewNamespaces.test.tsx. Runs in the
 * full app, entered through the Global tab, over a faked backend
 * (test-utils/appState).
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeClusterAttentionSnapshot,
  makeClusterOverviewSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import type { NamespaceSummary } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let alpha: TestCluster;
let beta: TestCluster;
let gamma: TestCluster;
let view: MountedApp;

const namespace = (
  cluster: TestCluster,
  name: string,
  overrides: Partial<NamespaceSummary> = {}
): NamespaceSummary => ({
  ref: {
    clusterId: cluster.clusterId,
    group: '',
    version: 'v1',
    kind: 'Namespace',
    resource: 'namespaces',
    namespace: '',
    name,
    uid: `${cluster.clusterId}-${name}`,
  },
  phase: 'Active',
  status: 'Active',
  resourceVersion: '12',
  creationTimestamp: 1_700_000_000,
  hasWorkloads: true,
  unhealthyWorkloads: 2,
  warningEvents: 3,
  warningEventsState: 'available',
  cpuRequestsMilli: 250,
  cpuLimitsMilli: 500,
  quotaPressureState: 'available',
  ...overrides,
});

const serveNamespaces = (
  cluster: TestCluster,
  namespaces: NamespaceSummary[],
  metricsState: 'available' | 'unavailable'
) => {
  const identity = { clusterId: cluster.clusterId, clusterName: cluster.clusterName };
  app.snapshots.serve(
    'namespaces',
    buildClusterRefreshScope('namespaces', cluster.clusterId),
    { ...identity, namespaces },
    namespaces.length
  );
  app.snapshots.serve(
    'namespace-metrics',
    buildClusterRefreshScope('namespace-metrics', cluster.clusterId),
    {
      ...identity,
      namespaces:
        metricsState === 'available'
          ? namespaces.map(({ ref }) => ({ ref, cpuUsageMilli: 100, memoryUsageBytes: 128 }))
          : [],
      metrics: {
        stale: false,
        successCount: metricsState === 'available' ? 1 : 0,
        failureCount: 0,
      },
      metricsState,
    },
    namespaces.length
  );
};

const rows = () => Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row'));
const rowKey = (row: HTMLElement) =>
  `${row.querySelector('[data-column="cluster"]')?.textContent?.trim()}/${row
    .querySelector('[data-column="name"]')
    ?.textContent?.trim()}`;
const rowOf = (cluster: TestCluster, name: string) =>
  requireValue(
    rows().find((row) => rowKey(row) === `${cluster.clusterName}/${name}`),
    `expected the ${cluster.clusterName}/${name} row`
  );
const control = (row: HTMLElement, column: string) =>
  requireValue(
    row.querySelector<HTMLElement>(`[data-column="${column}"] button`),
    `expected an interactive ${column} cell`
  );

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

const openGlobalNamespaces = async () => {
  view = await app.mountApp();
  const globalTab = requireValue(
    Array.from(view.container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (tab) => tab.textContent?.trim() === 'Global'
    ),
    'expected the Global tab'
  );
  await click(globalTab);
  await view.goTo({ globalView: 'global-namespaces' });
};

const menuItems = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item'));
const menuLabel = (item: HTMLElement) =>
  item.querySelector('.context-menu-label')?.textContent?.trim();
const openRowMenu = async (row: HTMLElement) => {
  const cell = requireValue(row.querySelector<HTMLElement>('.grid-cell'), 'expected a cell');
  await act(async () => {
    cell.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    );
  });
  await app.settle();
  return menuItems().map(menuLabel);
};
const clickMenuItem = async (label: string) => {
  await click(
    requireValue(
      menuItems().find((item) => menuLabel(item) === label),
      `expected the ${label} menu item`
    )
  );
};

const namespaceTarget = (cluster: TestCluster, name: string) => ({
  clusterId: cluster.clusterId,
  clusterName: cluster.clusterName,
  group: '',
  version: 'v1',
  kind: 'Namespace',
  namespace: '',
  name,
});

beforeEach(() => {
  alpha = app.cluster({ name: 'alpha', context: 'alpha' });
  beta = app.cluster({ name: 'beta', context: 'beta' });
  gamma = app.cluster({ name: 'gamma', context: 'gamma' });
  app.startScreen(alpha);
  // The Global tab opens on the Clusters view, which reads each cluster's overview.
  for (const cluster of [beta, gamma]) {
    app.snapshots.serve(
      'cluster-overview',
      buildClusterRefreshScope('cluster-overview', cluster.clusterId),
      makeClusterOverviewSnapshotPayload({
        clusterId: cluster.clusterId,
        clusterName: cluster.clusterName,
      })
    );
  }
  serveNamespaces(alpha, [namespace(alpha, 'orders'), namespace(alpha, 'payments')], 'available');
  serveNamespaces(
    beta,
    [
      namespace(beta, 'default', { unhealthyWorkloads: 0, warningEvents: 0 }),
      namespace(beta, 'payments'),
    ],
    'unavailable'
  );
  // gamma's user may not list namespaces.
  app.snapshots.fail(
    'namespaces',
    buildClusterRefreshScope('namespaces', gamma.clusterId),
    makeErrorStatus('Forbidden')
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GlobalViewNamespaces', () => {
  it('joins each cluster’s namespaces with its own metrics, listing the rest when one cluster is denied', async () => {
    await openGlobalNamespaces();

    expect(rows().map(rowKey)).toEqual([
      'beta/default',
      'alpha/orders',
      'alpha/payments',
      'beta/payments',
    ]);
    expect(
      rowOf(alpha, 'payments')
        .querySelector('[data-column="cpu"] [data-gridtable-export-text]')
        ?.getAttribute('data-gridtable-export-text')
    ).toBe('100');
    expect(rowOf(beta, 'payments').querySelector('[data-column="cpu"]')?.textContent?.trim()).toBe(
      'Unavailable'
    );
    // Metrics are read only for clusters whose namespace list loaded.
    expect(new Set(app.snapshots.reads('namespace-metrics').map((read) => read.scope))).toEqual(
      new Set([
        buildClusterRefreshScope('namespace-metrics', alpha.clusterId),
        buildClusterRefreshScope('namespace-metrics', beta.clusterId),
      ])
    );
  });

  it('says it shows only some clusters’ namespaces while one cluster’s list is missing', async () => {
    await openGlobalNamespaces();

    const filterArea = requireValue(
      view.container.querySelector<HTMLElement>('.gridtable-filter-container'),
      'expected the table filter bar'
    );
    expect(filterArea.textContent).toContain('Showing namespace data from 2 of 3 clusters');
  });

  it('keeps namespace metrics live only while the view is shown', async () => {
    vi.useFakeTimers();
    await openGlobalNamespaces();
    const metricsStreams = () =>
      app.streams.active().filter((stream) => stream.startsWith('namespace-metrics '));
    expect(metricsStreams()).toEqual([
      `namespace-metrics ${buildClusterRefreshScope('namespace-metrics', alpha.clusterId)}`,
      `namespace-metrics ${buildClusterRefreshScope('namespace-metrics', beta.clusterId)}`,
    ]);

    await view.goTo({ globalView: 'fleet' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    // The sidebar still lists the visible cluster's namespaces with their metrics.
    expect(metricsStreams()).toEqual([
      `namespace-metrics ${buildClusterRefreshScope('namespace-metrics', alpha.clusterId)}`,
    ]);
  });

  it('keeps its own sort when a cluster closes', async () => {
    app.backend.answer('DeleteGridTablePersistenceEntries', () => undefined);
    await openGlobalNamespaces();
    await click(
      requireValue(
        view.container.querySelector<HTMLElement>('[aria-label="Sort by Namespace"]'),
        'expected the Namespace sort control'
      )
    );
    expect(rows().map(rowKey)).toEqual([
      'alpha/payments',
      'beta/payments',
      'alpha/orders',
      'beta/default',
    ]);

    await click(
      requireValue(
        view.container.querySelector<HTMLElement>('[aria-label="Close beta"]'),
        'expected the beta tab close button'
      )
    );

    expect(rows().map(rowKey)).toEqual(['alpha/payments', 'alpha/orders']);
  });

  // Opening another cluster's object shows that cluster's panels; the user
  // stays in the Global view and no namespace is selected.
  it('opens the focused row’s namespace in its own cluster’s Object Panel on Enter, staying in the Global view', async () => {
    app.startScreen(beta);
    app.servePanel(beta, namespaceTarget(beta, 'default'));
    await openGlobalNamespaces();
    const table = requireValue(
      view.container.querySelector<HTMLElement>('table[tabindex="0"]'),
      'expected the namespaces table'
    );

    await act(async () => table.focus());
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });
    await app.settle();

    const owners = view.owners();
    expect(owners.kubeconfig.selectedClusterId).toBe(beta.clusterId);
    expect(view.openPanels()).toEqual([namespaceTarget(beta, 'default')]);
    expect(owners.viewState?.viewType).toBe('global');
    expect(owners.namespace.selectedNamespace).not.toBe('default');
  });

  it('opens a namespace in its Object Panel from its name or Kind badge, without navigating', async () => {
    app.servePanel(alpha, namespaceTarget(alpha, 'orders'));
    app.servePanel(alpha, namespaceTarget(alpha, 'payments'));
    await openGlobalNamespaces();

    await click(control(rowOf(alpha, 'orders'), 'name'));
    await click(control(rowOf(alpha, 'payments'), 'kind'));

    expect(view.openPanels()).toEqual([
      namespaceTarget(alpha, 'orders'),
      namespaceTarget(alpha, 'payments'),
    ]);
    const owners = view.owners();
    expect(owners.viewState?.viewType).toBe('global');
    expect(owners.namespace.selectedNamespace).not.toBe('payments');
  });

  it('opens the row’s cluster Overview from its cluster link without selecting the namespace', async () => {
    app.startScreen(beta);
    await openGlobalNamespaces();

    await click(control(rowOf(beta, 'payments'), 'cluster'));

    const owners = view.owners();
    expect(owners.kubeconfig.selectedClusterId).toBe(beta.clusterId);
    expect(owners.viewState?.viewType).toBe('overview');
    expect(owners.namespace.selectedNamespace).not.toBe('payments');
  });

  it('goes to the namespace’s workloads in the row’s cluster', async () => {
    app.startScreen(beta);
    app.serveTable(beta, 'namespace-workloads');
    await openGlobalNamespaces();

    await openRowMenu(rowOf(beta, 'payments'));
    await clickMenuItem('Go to Namespace');

    const owners = view.owners();
    expect(owners.kubeconfig.selectedClusterId).toBe(beta.clusterId);
    expect(owners.viewState?.viewType).toBe('namespace');
    expect(owners.viewState?.activeNamespaceTab).toBe('workloads');
    expect(owners.namespace.selectedNamespace).toBe('payments');
  });

  it.each([
    [
      'unhealthy',
      'unhealthyWorkloads',
      ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'],
    ],
    ['warnings', 'warningEvents', ['Event']],
  ])('opens %s findings for the namespace in the row’s cluster', async (_signal, column, kinds) => {
    app.startScreen(beta);
    app.snapshots.answer(({ domain, scope }) =>
      domain === 'cluster-attention' && scope.startsWith(`${beta.clusterId}|`)
        ? makeClusterAttentionSnapshot({
            clusterId: beta.clusterId,
            clusterName: beta.clusterName,
            kinds: ['Deployment', 'Event', 'Pod'],
            namespaces: ['default', 'payments'],
          })
        : undefined
    );
    await openGlobalNamespaces();

    await click(control(rowOf(beta, 'payments'), column));

    const owners = view.owners();
    expect(owners.kubeconfig.selectedClusterId).toBe(beta.clusterId);
    expect(owners.viewState?.activeClusterTab).toBe('attention');
    const read = requireValue(
      app.snapshots
        .reads('cluster-attention')
        .filter((r) => r.scope.startsWith(beta.clusterId))
        .slice(-1)[0],
      'expected an attention read in beta'
    );
    const query = new URLSearchParams(read.scope.split('|')[1]);
    expect(query.get('namespaces')).toBe('payments');
    expect(query.get('kinds')?.split(',').sort()).toEqual([...kinds].sort());
  });

  // Cluster-scoped permissions are batch-queried only for the visible
  // cluster, so another cluster's row resolves its own on right-click.
  it('offers each row the actions its own cluster permits', async () => {
    app.permissions((query) => !(query.verb === 'delete' && query.clusterId === beta.clusterId));
    await openGlobalNamespaces();

    expect(await openRowMenu(rowOf(beta, 'payments'))).not.toContain('Delete');
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(await openRowMenu(rowOf(alpha, 'payments'))).toContain('Delete');
  });
});
