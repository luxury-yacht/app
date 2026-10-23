/**
 * frontend/src/modules/cluster/components/ClusterViewAttention.test.tsx
 *
 * The cluster Attention view: it lists the visible cluster's findings from
 * the backend query (most severe first), shows each finding's causes and
 * current status once, opens a finding's object with complete identity from
 * its Name link, opens the finding's namespace from its Namespace link,
 * ignores a finding for the object, the cluster, or every cluster, and
 * restores each kind of ignore rule from the ignored-findings dialog. A filter
 * the Overview requests before the view opens is applied to its query, and
 * the filtered-empty state offers the ignored-findings dialog. Runs in the
 * full app, navigated through the sidebar, over a faked backend
 * (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeClusterOverviewSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import type {
  AttentionIgnoreRules,
  ClusterAttentionFinding,
  ClusterAttentionSnapshot,
} from '@/core/refresh/types';
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

const checkout: ObjectIdentity = {
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  namespace: 'payments',
  name: 'checkout',
};

const checkoutRef = () => ({
  ...checkout,
  clusterId: dev.clusterId,
  resource: 'deployments',
  uid: 'uid-checkout',
});

/** A finding as backend/refresh/snapshot/cluster_attention.go projects it. */
const finding = (overrides: Partial<ClusterAttentionFinding> = {}): ClusterAttentionFinding => ({
  ref: checkoutRef(),
  namespace: 'payments',
  severity: 'warning',
  status: '1/2 ready',
  causes: [
    {
      type: 'replica-mismatch',
      label: 'Replica mismatch',
      message: '1/2 ready',
      severity: 'warning',
    },
  ],
  age: '2m',
  ...overrides,
});

const NO_RULES: AttentionIgnoreRules = {
  objectFindings: [],
  clusterFindingTypes: [],
  globalFindingTypes: [],
};

const serveFindings = (
  rows: ClusterAttentionFinding[],
  payload: Partial<ClusterAttentionSnapshot> = {}
) =>
  app.serveTable(dev, 'cluster-attention', {
    rows,
    ignoreRules: NO_RULES,
    findingTypes: [{ id: 'replica-mismatch', label: 'Replica mismatch' }],
    ...payload,
  });

const start = async () => {
  view = await app.mountApp();
  await view.goTo({ clusterView: 'attention' });
};

const lastAttentionQuery = () => {
  const scope = requireValue(
    app.snapshots
      .reads('cluster-attention')
      .filter((read) => read.scope.includes('?'))
      .slice(-1)[0],
    'expected an Attention query'
  ).scope;
  return { scope, params: new URLSearchParams(scope.slice(scope.indexOf('?') + 1)) };
};

const tableRows = () => Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row'));
const cellOf = (row: HTMLElement, column: string) =>
  requireValue(
    row.querySelector<HTMLElement>(`.grid-cell[data-column="${column}"]`),
    `expected the ${column} cell`
  );

const click = async (element: Element | null | undefined, what: string) => {
  const target = requireValue(element as HTMLElement | null | undefined, `expected ${what}`);
  await act(async () => target.click());
  await app.settle();
};

const menuItems = () =>
  Array.from(document.body.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item'));
const menuLabel = (item: HTMLElement) =>
  item.querySelector('.context-menu-label')?.textContent?.trim();

const openRowMenu = async () => {
  await act(async () => {
    cellOf(requireValue(tableRows()[0], 'expected a finding'), 'name').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    );
  });
  await app.settle();
  return menuItems().map(menuLabel);
};

const buttonNamed = (label: string, within: ParentNode = document.body) =>
  Array.from(within.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === label
  );

const ignoredDialog = () => document.body.querySelector<HTMLElement>('.attention-ignored-modal');

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['payments']);
  app.startScreen(dev);
});

describe('ClusterViewAttention', () => {
  it('lists the visible cluster’s findings from its query, most severe first', async () => {
    serveFindings([finding()]);
    await start();

    expect(tableRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('checkout'),
    ]);
    const { scope, params } = lastAttentionQuery();
    expect(scope.startsWith(`${dev.clusterId}|`)).toBe(true);
    expect(params.get('sort')).toBe('severity');
    expect(params.get('sortDirection')).toBe('asc');
  });

  it('shows each cause once and the current status only where it adds to the severity', async () => {
    serveFindings([
      finding({
        status: 'Updating',
        causes: [
          {
            type: 'workload-unhealthy',
            label: 'Unhealthy workloads',
            message: 'Updating',
            severity: 'warning',
          },
          {
            type: 'replica-mismatch',
            label: 'Replica mismatch',
            message: '1/2 ready',
            severity: 'warning',
          },
        ],
      }),
      finding({
        ref: { ...checkoutRef(), kind: 'Event', group: '', resource: 'events', name: 'api.17f' },
        status: 'Warning',
        causes: [
          {
            type: 'warning-event',
            label: 'Warning events',
            message: 'BackOff · Back-off restarting failed container',
            severity: 'warning',
          },
        ],
      }),
    ]);
    await start();

    const [workload, event] = tableRows().map((row) => cellOf(row, 'reason'));
    expect(workload?.querySelector('.attention-finding-labels')?.textContent).toBe(
      'Unhealthy workloads · Replica mismatch'
    );
    // The status repeats the first cause's message only once.
    expect(workload?.querySelector('.attention-finding-details')?.textContent).toBe(
      'Updating · 1/2 ready'
    );
    // A status equal to the severity adds nothing.
    expect(event?.querySelector('.attention-finding-details')?.textContent).toBe(
      'BackOff · Back-off restarting failed container'
    );
  });

  it('opens the finding’s object with complete identity from its Name link only', async () => {
    app.servePanel(dev, checkout);
    // backend/autoscaling_details.go IsWorkloadHPAManaged: no HPA targets the workload.
    app.backend.answer('IsWorkloadHPAManaged', () => false);
    serveFindings([finding()]);
    await start();
    const table = requireValue(
      view.container.querySelector<HTMLElement>('table[tabindex="0"]'),
      'expected the findings table'
    );

    // Enter on a focused finding opens nothing; the links open objects.
    await act(async () => table.focus());
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });
    await app.settle();
    expect(view.openPanels()).toEqual([]);

    await click(cellOf(tableRows()[0] as HTMLElement, 'name').querySelector('button'), 'Name link');

    expect(view.openPanels()).toEqual([
      { ...checkout, clusterId: dev.clusterId, clusterName: dev.clusterName },
    ]);
  });

  it('opens the finding’s namespace on its Workloads view from the Namespace link', async () => {
    serveFindings([finding()]);
    app.serveTable(dev, 'namespace-workloads');
    await start();

    await click(
      cellOf(tableRows()[0] as HTMLElement, 'namespace').querySelector('button'),
      'Namespace link'
    );

    const { namespace, viewState } = view.owners();
    expect(namespace.selectedNamespace).toBe('payments');
    expect(namespace.selectedNamespaceClusterId).toBe(dev.clusterId);
    expect(viewState?.viewType).toBe('namespace');
    expect(viewState?.activeNamespaceTab).toBe('workloads');
  });

  it('ignores a finding for the object, the cluster, or every cluster', async () => {
    const answer = () => NO_RULES;
    app.backend.answer('IgnoreClusterAttentionObjectFinding', answer);
    app.backend.answer('IgnoreClusterAttentionFindingType', answer);
    app.backend.answer('IgnoreGlobalAttentionFindingType', answer);
    serveFindings([finding()]);
    await start();

    const labels = [
      'Ignore "Replica mismatch" for this object only',
      'Ignore "Replica mismatch" in this cluster',
      'Ignore "Replica mismatch" in all clusters',
    ];
    expect(await openRowMenu()).toEqual(expect.arrayContaining(labels));
    for (const label of labels) {
      await openRowMenu();
      await click(
        menuItems().find((item) => menuLabel(item) === label),
        label
      );
    }

    expect(app.backend.calls('IgnoreClusterAttentionObjectFinding')).toEqual([
      [dev.clusterId, checkoutRef(), 'replica-mismatch'],
    ]);
    expect(app.backend.calls('IgnoreClusterAttentionFindingType')).toEqual([
      [dev.clusterId, 'replica-mismatch'],
    ]);
    expect(app.backend.calls('IgnoreGlobalAttentionFindingType')).toEqual([
      [dev.clusterId, 'replica-mismatch'],
    ]);
  });

  it('restores each kind of ignore rule from the ignored-findings dialog', async () => {
    const rules: AttentionIgnoreRules = {
      objectFindings: [{ ref: checkoutRef(), findingType: 'replica-mismatch' }],
      clusterFindingTypes: ['restarts'],
      globalFindingTypes: ['warning-event'],
    };
    const remaining = { ...rules };
    app.backend.answer('RestoreClusterAttentionObjectFinding', () => {
      remaining.objectFindings = [];
      return { ...remaining };
    });
    app.backend.answer('RestoreClusterAttentionFindingType', () => {
      remaining.clusterFindingTypes = [];
      return { ...remaining };
    });
    app.backend.answer('RestoreGlobalAttentionFindingType', () => {
      remaining.globalFindingTypes = [];
      return { ...remaining };
    });
    serveFindings([], {
      ignoreRules: rules,
      findingTypes: [
        { id: 'replica-mismatch', label: 'Replica mismatch' },
        { id: 'restarts', label: 'Restarts' },
        { id: 'warning-event', label: 'Warning events' },
      ],
    });
    await start();

    await click(
      view.container.querySelector('[aria-label="Manage ignored findings"]'),
      'the Manage ignored findings action'
    );
    const dialog = requireValue(ignoredDialog(), 'expected the ignored-findings dialog');
    for (const rule of ['Replica mismatch', 'Restarts', 'Warning events']) {
      const item = requireValue(
        Array.from(dialog.querySelectorAll('li')).find((li) => li.textContent?.includes(rule)),
        `expected the ${rule} rule`
      );
      await click(buttonNamed('Restore', item), `Restore ${rule}`);
    }

    expect(app.backend.calls('RestoreClusterAttentionObjectFinding')).toEqual([
      [dev.clusterId, checkoutRef(), 'replica-mismatch'],
    ]);
    expect(app.backend.calls('RestoreClusterAttentionFindingType')).toEqual([
      [dev.clusterId, 'restarts'],
    ]);
    expect(app.backend.calls('RestoreGlobalAttentionFindingType')).toEqual([
      [dev.clusterId, 'warning-event'],
    ]);
    expect(dialog.querySelectorAll('li')).toHaveLength(0);
  });

  it('applies the Overview’s requested filter and offers ignored findings when it hides everything', async () => {
    const overview = makeClusterOverviewSnapshotPayload({
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
    });
    app.snapshots.serve(
      'cluster-overview',
      buildClusterRefreshScope('cluster-overview', dev.clusterId),
      {
        ...overview,
        overview: { ...overview.overview, restartedPods: 4 },
      }
    );
    serveFindings([]);
    view = await app.mountApp();

    await click(
      view.container.querySelector('[data-testid="cluster-pod-status-restarted"]'),
      'the restarts card'
    );

    expect(view.owners().viewState?.activeClusterTab).toBe('attention');
    const { params } = lastAttentionQuery();
    expect(params.getAll('kinds')).toEqual(['Pod']);
    expect(params.getAll('facet.findings')).toEqual(['restarts']);
    await click(
      buttonNamed('Manage ignored findings', view.container),
      'the filtered-empty action'
    );
    expect(ignoredDialog()).not.toBeNull();
  });
});
