/**
 * frontend/src/modules/cluster/components/ClusterViewNamespaces.test.tsx
 *
 * The cluster Namespaces view lists the visible cluster's namespaces from the
 * namespaces domain (joined with the namespace-metrics usage) with their
 * workload, warning, utilization, and quota signals, telling zero from
 * missing, and sorts them by usage as numbers. A row click opens nothing;
 * Enter and the Kind/Name links (which stay out of the row's Tab order) open
 * the namespace's panel; the row menu opens, goes to, diffs, and deletes the
 * namespace with complete identity. A configured namespace that is missing or
 * inaccessible offers nothing to open or act on. The view shows its loading
 * state before the first list, keeps its rows while the list refreshes, and
 * keeps the permission message when the list is denied. Runs in the full app,
 * navigated through the sidebar, over a faked backend (test-utils/appState).
 */

import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import type { DomainPayloadMap, NamespaceMetric, NamespaceSummary } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const MiB = 1024 * 1024;

const namespaceIdentity = (name: string): ObjectIdentity => ({
  group: '',
  version: 'v1',
  kind: 'Namespace',
  namespace: '',
  name,
});

const namespaceRef = (name: string) => ({
  ...namespaceIdentity(name),
  clusterId: dev.clusterId,
  resource: 'namespaces',
  uid: `${name}-uid`,
});

/** A namespace row as backend/refresh/snapshot/namespaces.go projects it. */
const namespaceRow = (
  name: string,
  overrides: Partial<NamespaceSummary> = {}
): NamespaceSummary => ({
  ref: namespaceRef(name),
  phase: 'Active',
  status: 'Active',
  statusPresentation: 'ready',
  resourceVersion: '1',
  creationTimestamp: 1_700_000_000,
  hasWorkloads: true,
  warningEventsState: 'available',
  quotaPressureState: 'available',
  ...overrides,
});

const usage = (name: string, cpuUsageMilli: number, memoryUsageBytes: number): NamespaceMetric => ({
  ref: namespaceRef(name),
  cpuUsageMilli,
  memoryUsageBytes,
});

const namespacesScope = () => buildClusterRefreshScope('namespaces', dev.clusterId);

const clusterIdentity = () => ({ clusterId: dev.clusterId, clusterName: dev.clusterName });

const namespaceList = (rows: NamespaceSummary[]): DomainPayloadMap['namespaces'] => ({
  ...clusterIdentity(),
  namespaces: rows,
});

/** Serves the namespace list and its usage (the namespaces and namespace-metrics domains). */
const serveNamespaces = (rows: NamespaceSummary[], metrics: NamespaceMetric[] = []) => {
  app.snapshots.serve('namespaces', namespacesScope(), namespaceList(rows), rows.length);
  const usagePayload: DomainPayloadMap['namespace-metrics'] = {
    ...clusterIdentity(),
    namespaces: metrics,
    metrics: { stale: false, successCount: 1, failureCount: 0 },
    metricsState: 'available',
  };
  app.snapshots.serve('namespace-metrics', namespacesScope(), usagePayload, metrics.length);
};

const startCluster = () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.startScreen(dev);
};

const openView = async () => {
  view = await app.mountApp();
  await view.goTo({ clusterView: 'namespaces' });
};

/** Opens the view over the namespaces `listed` builds once the cluster exists. */
const start = async (listed: () => NamespaceSummary[] = () => [namespaceRow('payments')]) => {
  startCluster();
  serveNamespaces(listed());
  await openView();
};

const tableRows = () => Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row'));

const rowNames = () =>
  tableRows().map((row) => row.querySelector('[data-column="name"]')?.textContent?.trim());

/** Parks every later namespace-list read until `releaseReads` answers it with `list()`. */
const holdNamespaceReads = (list: () => NamespaceSummary[]) => {
  const parked: Array<() => void> = [];
  app.snapshots.respond(({ domain, scope }) =>
    domain === 'namespaces'
      ? new Promise((resolve) => {
          parked.push(() =>
            resolve(
              snapshotResponse({ domain, scope, version: 100, payload: namespaceList(list()) })
            )
          );
        })
      : undefined
  );
  return parked;
};

const releaseReads = async (parked: Array<() => void>) => {
  app.snapshots.respond(null);
  await act(async () => {
    parked.splice(0).forEach((answer) => {
      answer();
    });
  });
  await app.settle();
};

const rowOf = (name: string) =>
  requireValue(
    tableRows().find(
      (row) => row.querySelector('[data-column="name"]')?.textContent?.trim() === name
    ),
    `expected the ${name} row`
  );

const cell = (row: HTMLElement, column: string) =>
  requireValue(
    row.querySelector<HTMLElement>(`[data-column="${column}"]`),
    `expected the ${column} cell`
  );

const cellText = (name: string, column: string) => cell(rowOf(name), column).textContent?.trim();

/** The exported value of a utilization cell (GridTable export), absent when the cell has no bar. */
const exportedUsage = (name: string, column: string) =>
  cell(rowOf(name), column)
    .querySelector('[data-gridtable-export-text]')
    ?.getAttribute('data-gridtable-export-text');

const menuItems = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item'));
const menuLabel = (item: HTMLElement) =>
  item.querySelector('.context-menu-label')?.textContent?.trim();

/** Right-clicks the row, as the user opens its menu, and returns the object actions it offers. */
const openRowMenu = async (name: string) => {
  await act(async () => {
    cell(rowOf(name), 'name').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    );
  });
  await app.settle();
  // The column's sort items carry no object action.
  return menuItems().flatMap((item) => item.dataset.contextActionId ?? []);
};

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

const clickMenuItem = (label: string) =>
  click(
    requireValue(
      menuItems().find((candidate) => menuLabel(candidate) === label),
      `expected the ${label} menu item`
    )
  );

const table = () =>
  requireValue(
    view.container.querySelector<HTMLElement>('table[tabindex="0"]'),
    'expected the namespaces table'
  );

const pressEnter = async () => {
  await act(async () => table().focus());
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
  });
  await app.settle();
};

/** Opens the header's connectivity status and chooses one of its actions. */
const chooseConnectivityAction = async (label: string) => {
  if (!document.body.querySelector('.status-popover-actions')) {
    const status = requireValue(
      document.body.querySelector<HTMLElement>('[role="button"][aria-label^="Connectivity:"]'),
      'expected the connectivity status'
    );
    await act(async () => {
      status.focus();
      status.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });
    await app.settle();
  }
  await click(
    requireValue(
      Array.from(
        document.body.querySelectorAll<HTMLButtonElement>('.status-popover-actions button')
      ).find((button) => button.textContent?.trim() === label),
      `expected the ${label} action`
    )
  );
};

const inCluster = (identity: ObjectIdentity) => ({
  clusterId: dev.clusterId,
  clusterName: dev.clusterName,
  ...identity,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ClusterViewNamespaces', () => {
  it('shows each namespace’s workload, warning, utilization, and quota signals, telling zero from missing', async () => {
    startCluster();
    serveNamespaces(
      [
        namespaceRow('payments', {
          unhealthyWorkloads: 3,
          warningEvents: 5,
          cpuRequestsMilli: 300,
          cpuLimitsMilli: 600,
          memoryRequestsBytes: 512 * MiB,
          memoryLimitsBytes: 1024 * MiB,
          quotaCount: 2,
          quotaHighestUsedPercentage: 92,
          quotaPressure: 'warning',
        }),
        namespaceRow('idle', { hasWorkloads: false, unhealthyWorkloads: 0, warningEvents: 0 }),
        // Reserves capacity without using any: the bar still shows the reservation.
        namespaceRow('reserved', {
          hasWorkloads: false,
          workloadsUnknown: true,
          cpuRequestsMilli: 100,
          memoryRequestsBytes: 64 * MiB,
        }),
      ],
      [usage('payments', 450, 256 * MiB), usage('idle', 0, 0), usage('reserved', 0, 0)]
    );
    await openView();

    const signals = (name: string) =>
      ['workloads', 'unhealthyWorkloads', 'warningEvents', 'quotaPressure'].map((column) =>
        cellText(name, column)
      );
    expect(signals('payments')).toEqual(['✓', '3', '5', '92%']);
    expect(signals('idle')).toEqual(['-', '-', '-', 'No quotas']);
    expect(signals('reserved')[0]).toBe('Unknown');
    // Usage exports in millicores and KiB.
    expect([exportedUsage('payments', 'cpu'), exportedUsage('payments', 'memory')]).toEqual([
      '450',
      '262144',
    ]);
    expect([cellText('idle', 'cpu'), cellText('idle', 'memory')]).toEqual(['-', '-']);
    expect([exportedUsage('reserved', 'cpu'), exportedUsage('reserved', 'memory')]).toEqual([
      '0',
      '0',
    ]);
  });

  it('sorts namespaces by their CPU usage as numbers', async () => {
    startCluster();
    serveNamespaces(
      [namespaceRow('alpha'), namespaceRow('beta'), namespaceRow('gamma')],
      [usage('alpha', 1200, MiB), usage('beta', 450, MiB), usage('gamma', 90, MiB)]
    );
    await openView();
    const header = requireValue(
      view.container.querySelector<HTMLElement>('th[data-column="cpu"]'),
      'expected the CPU header'
    );

    await click(requireValue(header.querySelector<HTMLButtonElement>('button'), 'expected sort'));

    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(rowNames()).toEqual(['gamma', 'beta', 'alpha']);
  });

  it('opens the namespace’s panel from its Kind badge and name, which stay out of the focused row’s Tab order', async () => {
    await start();
    app.servePanel(dev, namespaceIdentity('payments'));
    const badge = requireValue(
      cell(rowOf('payments'), 'kind').querySelector<HTMLButtonElement>('button'),
      'expected the Kind badge'
    );
    const name = requireValue(
      cell(rowOf('payments'), 'name').querySelector<HTMLButtonElement>('button'),
      'expected the name link'
    );

    // Both links repeat the row's Enter action.
    await act(async () => table().focus());
    expect([badge.tabIndex, name.tabIndex]).toEqual([-1, -1]);

    await click(badge);
    expect(view.openPanels()).toEqual([inCluster(namespaceIdentity('payments'))]);
    await click(name);
    expect(view.openPanels()).toEqual([inCluster(namespaceIdentity('payments'))]);
    expect(view.owners().namespace.selectedNamespace).not.toBe('payments');
  });

  it('opens nothing on a row click and opens the focused namespace’s panel on Enter', async () => {
    await start();
    app.servePanel(dev, namespaceIdentity('payments'));

    await click(cell(rowOf('payments'), 'status'));
    expect(view.openPanels()).toEqual([]);

    await pressEnter();
    expect(view.openPanels()).toEqual([inCluster(namespaceIdentity('payments'))]);
    expect(view.owners().namespace.selectedNamespace).not.toBe('payments');
  });

  it('offers the namespace’s actions on right-click, opening and deleting it with complete identity', async () => {
    app.backend.answer('RunObjectAction', () => ({}) as never);
    await start();
    app.servePanel(dev, namespaceIdentity('payments'));

    expect(await openRowMenu('payments')).toEqual([
      OBJECT_ACTION_IDS.viewDetails,
      OBJECT_ACTION_IDS.goToNamespace,
      OBJECT_ACTION_IDS.diff,
      OBJECT_ACTION_IDS.delete,
    ]);
    await clickMenuItem('Open Details');
    expect(view.openPanels()).toEqual([inCluster(namespaceIdentity('payments'))]);

    await openRowMenu('payments');
    await clickMenuItem('Delete');
    await click(
      requireValue(
        Array.from(
          document.body.querySelectorAll<HTMLButtonElement>('.confirmation-modal-footer button')
        ).find((button) => button.textContent?.trim() === 'Delete'),
        'expected the delete confirmation'
      )
    );

    expect(app.backend.calls('RunObjectAction')).toEqual([
      [
        {
          action: 'delete',
          target: { clusterId: dev.clusterId, ...namespaceIdentity('payments') },
        },
      ],
    ]);
  });

  it('goes to the namespace from its row menu, showing the namespace’s view', async () => {
    startCluster();
    serveNamespaces([namespaceRow('payments')]);
    // The namespace view's default tab lists its workloads.
    app.serveTable(dev, 'namespace-workloads');
    await openView();

    await openRowMenu('payments');
    await clickMenuItem('Go to Namespace');

    expect(view.owners().namespace.selectedNamespace).toBe('payments');
    expect(view.owners().viewState?.viewType).toBe('namespace');
    expect(view.openPanels()).toEqual([]);
  });

  it('offers nothing to open or act on for a configured namespace that is missing or inaccessible', async () => {
    await start(() => [
      namespaceRow('locked', { scopeStatus: 'no-access' }),
      namespaceRow('gone', { scopeStatus: 'not-found' }),
    ]);

    expect(
      ['kind', 'name'].map((column) => cell(rowOf('locked'), column).querySelector('button'))
    ).toEqual([null, null]);
    expect(await openRowMenu('locked')).toEqual([]);
    expect(await openRowMenu('gone')).toEqual([]);
    await pressEnter();
    expect(view.openPanels()).toEqual([]);
  });

  it('shows the loading state, not an empty list, until the first namespace list arrives', async () => {
    startCluster();
    serveNamespaces([]);
    const parked = holdNamespaceReads(() => [namespaceRow('payments')]);
    await openView();

    expect(tableRows()).toEqual([]);
    expect(view.container.textContent).toContain('Loading namespaces');
    expect(view.container.textContent).not.toContain('No namespaces found');

    await releaseReads(parked);
    expect(rowNames()).toEqual(['payments']);
  });

  it('keeps the listed namespaces, without a loading state, while the list refreshes', async () => {
    vi.useFakeTimers();
    await start();
    const parked = holdNamespaceReads(() => [namespaceRow('billing'), namespaceRow('payments')]);

    // A namespace is added; the domain rings its object clock.
    await act(async () => {
      app.streams.ring('namespaces', namespacesScope(), 'object', 'v2');
      // Signals apply after the stream's coalescing window (resourceStreamManager.ts).
      await vi.advanceTimersByTimeAsync(200);
    });
    await app.settle();
    expect(parked).toHaveLength(1);
    expect(rowNames()).toEqual(['payments']);
    expect(view.container.textContent).not.toMatch(/Loading namespaces|Updating namespaces/);

    await releaseReads(parked);
    expect(rowNames()).toEqual(['billing', 'payments']);
  });

  // Re-enabling auto-refresh restarts the scope's stream, which clears the
  // stored failure (no error, initialising) but not the denial: the view must
  // settle on the permission message instead of loading forever.
  it('keeps the permission message, not a loading state, after a denied list’s stream restarts', async () => {
    startCluster();
    serveNamespaces([]);
    app.snapshots.fail('namespaces', namespacesScope(), makeErrorStatus('Forbidden'));
    // Mirrors backend/preferences_settings.go UpdateAppPreferences.
    app.backend.answer('UpdateAppPreferences', (request) => ({
      settings: null,
      changedKeys: (request.changes ?? []).map((change) => change.key),
    }));
    await openView();
    expect(view.container.textContent).toContain('Insufficient permissions');

    await chooseConnectivityAction('Disable Auto-Refresh');
    await chooseConnectivityAction('Enable Auto-Refresh');

    expect(tableRows()).toEqual([]);
    expect(view.container.textContent).toContain('Insufficient permissions');
    expect(view.container.textContent).not.toContain('Loading namespaces');
  });
});
