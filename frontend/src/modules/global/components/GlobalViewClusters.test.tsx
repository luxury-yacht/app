/**
 * frontend/src/modules/global/components/GlobalViewClusters.test.tsx
 *
 * The Global Clusters view lists every open cluster with its connection state
 * and, for clusters that can serve one, its overview; closing and reopening a
 * cluster changes only that cluster's row and overview read and keeps the
 * table's own state; a cluster's name opens that cluster's Overview. Runs in
 * the full app, entered through the Global tab, over a faked backend
 * (test-utils/appState).
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import { makeClusterOverviewSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let alpha: TestCluster;
let beta: TestCluster;
let view: MountedApp;

const overviewScope = (cluster: TestCluster) =>
  buildClusterRefreshScope('cluster-overview', cluster.clusterId);

const serveOverview = (cluster: TestCluster) => {
  const base = makeClusterOverviewSnapshotPayload();
  app.snapshots.serve(
    'cluster-overview',
    overviewScope(cluster),
    makeClusterOverviewSnapshotPayload({
      clusterId: cluster.clusterId,
      clusterName: cluster.clusterName,
      overview: {
        ...base.overview,
        clusterVersion: 'v1.32.1',
        clusterType: 'EKS',
        readyNodes: 3,
        totalNodes: 4,
        notReadyNodes: 1,
        readyPods: 25,
        totalPods: 30,
        failingPods: 2,
        totalNamespaces: 8,
        cpuUsageMilli: 1200,
        cpuRequestsMilli: 2400,
        cpuLimitsMilli: 6000,
        cpuAllocatableMilli: 8000,
        memoryUsageBytes: 8 * 1024 ** 3,
        memoryRequestsBytes: 12 * 1024 ** 3,
        memoryLimitsBytes: 24 * 1024 ** 3,
        memoryAllocatableBytes: 32 * 1024 ** 3,
      },
      metrics: { collectedAt: 1_700_001_000, stale: false, successCount: 2, failureCount: 0 },
    })
  );
};

const overviewReads = () =>
  app.snapshots.reads('cluster-overview').map((read) => read.scope.split('|')[0]);
const overviewStreams = () =>
  app.streams.active().filter((stream) => stream.startsWith('cluster-overview '));

const rows = () => Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row'));
const rowOf = (name: string) =>
  requireValue(
    rows().find((row) => row.querySelector('[data-column="name"]')?.textContent === name),
    `expected the ${name} row`
  );
const rowNames = () =>
  rows().map((row) => row.querySelector('[data-column="name"]')?.textContent?.trim());
const cellText = (name: string, column: string) =>
  rowOf(name).querySelector(`[data-column="${column}"]`)?.textContent?.trim();

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

const openGlobalClusters = async () => {
  const globalTab = requireValue(
    Array.from(view.container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (tab) => tab.textContent?.trim() === 'Global'
    ),
    'expected the Global tab'
  );
  await click(globalTab);
  await view.goTo({ globalView: 'fleet' });
};

beforeEach(() => {
  alpha = app.cluster({ name: 'alpha', context: 'alpha' });
  beta = app.cluster({
    name: 'beta',
    context: 'beta',
    lifecycle: backend.ClusterLifecycleState.ClusterStateLoading,
  });
  // gamma's credentials were rejected.
  app.cluster({
    name: 'gamma',
    context: 'gamma',
    lifecycle: backend.ClusterLifecycleState.ClusterStateAuthFailed,
  });
  app.startScreen(alpha);
  app.namespaces(alpha, ['default']);
  app.namespaces(beta, ['default']);
  serveOverview(alpha);
  serveOverview(beta);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GlobalViewClusters', () => {
  it('lists every open cluster with its state, reading overviews only where a cluster can serve one', async () => {
    view = await app.mountApp();
    await openGlobalClusters();

    expect(rowNames()).toEqual(['alpha', 'beta', 'gamma']);
    expect(cellText('alpha', 'connection')).toBe('Ready');
    expect(cellText('beta', 'connection')).toBe('Loading');
    expect(cellText('gamma', 'connection')).toBe('Authentication required');
    // The overview's counts and capacity, from the cluster's own snapshot.
    expect(cellText('alpha', 'clusterVersion')).toBe('v1.32.1');
    expect(cellText('alpha', 'nodes')).toBe('3 / 4');
    expect(cellText('alpha', 'pods')).toBe('25 / 30');
    expect(
      rowOf('alpha')
        .querySelector('[data-column="cpu"] [data-gridtable-export-text]')
        ?.getAttribute('data-gridtable-export-text')
    ).toBe('1200');
    // An auth-failed cluster has no overview to read.
    expect(rowOf('gamma').querySelector('[data-column="cpu"] [data-gridtable-export-text]')).toBe(
      null
    );
    expect(new Set(overviewReads())).toEqual(new Set([alpha.clusterId, beta.clusterId]));
  });

  it('changes only the closed or reopened cluster and keeps the table’s own sort', async () => {
    vi.useFakeTimers();
    // Reopening makes beta the selected cluster, whose sidebar reads its start screen.
    app.startScreen(beta);
    app.backend.answer('DeleteGridTablePersistenceEntries', () => undefined);
    view = await app.mountApp();
    await openGlobalClusters();
    await click(
      requireValue(
        view.container.querySelector<HTMLElement>('[aria-label="Sort by Cluster"]'),
        'expected the Cluster sort control'
      )
    );
    const nameSort = () =>
      view.container.querySelector('th[data-column="name"]')?.getAttribute('aria-sort');
    expect(nameSort()).toBe('descending');
    expect(rowNames()).toEqual(['gamma', 'beta', 'alpha']);
    app.snapshots.clearReads();

    await click(
      requireValue(
        view.container.querySelector<HTMLElement>('[aria-label="Close beta"]'),
        'expected the beta tab close button'
      )
    );
    // A released stream closes after the unsubscribe debounce (resourceStreamManager.ts).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(rowNames()).toEqual(['gamma', 'alpha']);
    expect(overviewStreams()).toEqual([`cluster-overview ${overviewScope(alpha)}`]);
    expect(overviewReads()).toEqual([]);

    await act(async () => view.owners().kubeconfig.openKubeconfig(beta.selection));
    await app.settle();

    expect(rowNames()).toEqual(['gamma', 'beta', 'alpha']);
    expect(new Set(overviewReads())).toEqual(new Set([beta.clusterId]));
    expect(nameSort()).toBe('descending');
  });

  it('opens the cluster’s Overview from its name, whatever view the cluster last showed', async () => {
    app.serveTable(alpha, 'cluster-config');
    view = await app.mountApp();
    await view.goTo({ clusterView: 'config' });
    await openGlobalClusters();

    await click(
      requireValue(
        rowOf('alpha').querySelector<HTMLElement>('[data-column="name"] button'),
        'expected the alpha link'
      )
    );

    const owners = view.owners();
    expect(owners.kubeconfig.selectedClusterId).toBe(alpha.clusterId);
    expect(owners.viewState?.viewType).toBe('overview');
  });
});
