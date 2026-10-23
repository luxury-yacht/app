/**
 * frontend/src/modules/namespace/contexts/NamespaceContext.test.tsx
 *
 * The namespace owner: the active cluster tab's namespace list (with the
 * backend's rollups and usage), each tab's own namespace selection, and which
 * clusters' namespace lists and utilization the window keeps subscribed as
 * tabs, lifecycles, and the active tab change. Runs inside the production
 * shell: the real namespace, kubeconfig, cluster-lifecycle, and refresh
 * owners over a faked backend (test-utils/appState). Namespace lists and usage
 * come from the backend's snapshots, lifecycle and scope changes from backend
 * events. Denial of the namespace list is covered by
 * test-utils/appState/harness.isolation.test.tsx.
 */

import { backend } from '@core/backend-api/models';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import type { DomainPayloadMap, NamespaceSummary, RefreshDomain } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { useNamespace, useNamespaceStatesByScope } from './NamespaceContext';

const app = installAppStateHarness();
let view: MountedApp;
let alpha: TestCluster;
let beta: TestCluster;

const ALL = 'All Namespaces';
const ns = () => view.owners().namespace;
const listed = () => ns().namespaces.map((item) => item.name);

const scopeOf = (cluster: TestCluster, domain: RefreshDomain = 'namespaces') =>
  buildClusterRefreshScope(domain, cluster.clusterId);
const readsOf = (cluster: TestCluster, domain: RefreshDomain = 'namespaces') =>
  app.snapshots.reads(domain).filter((read) => read.scope === scopeOf(cluster, domain));
const streamOf = (cluster: TestCluster, domain: RefreshDomain = 'namespaces') =>
  `${domain} ${scopeOf(cluster, domain)}`;
const refreshJobs = () =>
  app.snapshots.requests().filter((request) => request.startsWith('POST /api/v2/refresh/'));

/** Declares alpha (team-a, team-b) and beta (team-c, team-d) as open tabs. */
const declareClusters = (betaLifecycle?: ClusterLifecycle) => {
  alpha = app.cluster({ name: 'dev', context: 'alpha' });
  beta = app.cluster({ name: 'dev', context: 'beta', lifecycle: betaLifecycle });
  app.namespaces(alpha, ['team-a', 'team-b']);
  app.namespaces(beta, ['team-c', 'team-d']);
};
type ClusterLifecycle = Parameters<typeof app.cluster>[0]['lifecycle'];

const start = async (betaLifecycle?: ClusterLifecycle) => {
  declareClusters(betaLifecycle);
  view = await app.render(null);
};

/**
 * Keeps the cluster's namespace-list reads in flight until the returned
 * release, then answers them with the cluster's `names`.
 */
const holdNamespaceReads = (cluster: TestCluster, names: string[]) => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  app.snapshots.respond((request) => {
    if (request.domain !== 'namespaces' || request.scope !== scopeOf(cluster)) {
      return undefined;
    }
    return released.then(() =>
      snapshotResponse({
        domain: request.domain,
        scope: request.scope,
        version: 1_000,
        payload: {
          clusterId: cluster.clusterId,
          clusterName: cluster.clusterName,
          namespaces: names.map((name) => namespaceRow(cluster, name)),
        },
        itemCount: names.length,
      })
    );
  });
  return async () => {
    await act(async () => release());
    await app.settle();
  };
};

/** The backend moves a cluster's lifecycle; later workspace answers keep it. */
const setLifecycle = (cluster: TestCluster, state: `${backend.ClusterLifecycleState}`) =>
  app.setClusterState(cluster, { lifecycle: state as backend.ClusterLifecycleState });

const select = async (namespace: string, clusterId?: string) => {
  act(() => {
    ns().setSelectedNamespace(namespace, clusterId);
  });
  await app.settle();
};

const selection = () => ({
  namespace: ns().selectedNamespace,
  clusterId: ns().selectedNamespaceClusterId,
});

/**
 * The backend says the namespace list changed (the namespaces doorbell); the
 * stream coalesces signals briefly before the list is read again.
 */
const ringNamespaces = async (cluster: TestCluster, version: string) => {
  await act(async () => {
    app.streams.ring('namespaces', scopeOf(cluster), 'object', version);
    await vi.advanceTimersByTimeAsync(500);
  });
  await app.settle();
};

/** Lets released streams close after their unsubscribe debounce. */
const closeReleasedStreams = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
};

const namespaceRow = (
  cluster: TestCluster,
  name: string,
  rollups: Partial<NamespaceSummary> = {}
): NamespaceSummary => ({
  ref: {
    clusterId: cluster.clusterId,
    group: '',
    version: 'v1',
    kind: 'Namespace',
    resource: 'namespaces',
    namespace: '',
    name,
    uid: `${cluster.clusterId}/${name}`,
  },
  phase: 'Active',
  resourceVersion: '1',
  creationTimestamp: 0,
  hasWorkloads: true,
  warningEventsState: 'available',
  quotaPressureState: 'available',
  ...rollups,
});

const serveUsage = (
  cluster: TestCluster,
  usage: Array<{ name: string; cpuUsageMilli: number; memoryUsageBytes: number }>,
  metrics: Partial<DomainPayloadMap['namespace-metrics']['metrics']> = {}
) => {
  app.snapshots.serve('namespace-metrics', scopeOf(cluster, 'namespace-metrics'), {
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
    namespaces: usage.map(({ name, ...values }) => ({
      ref: namespaceRow(cluster, name).ref,
      ...values,
    })),
    metrics: { stale: false, successCount: 1, failureCount: 0, ...metrics },
    metricsState: 'available',
  });
};

afterEach(() => {
  vi.useRealTimers();
});

describe('the namespace list', () => {
  it('lists the active cluster’s namespaces and shows another open tab’s at once on switch', async () => {
    await start();
    expect(listed()).toEqual([ALL, 'team-a', 'team-b']);
    expect(ns().namespaceReady).toBe(true);

    // beta's list is already loaded; any read of it for the switch stays in flight.
    const releaseBeta = holdNamespaceReads(beta, ['team-c', 'team-d']);
    await view.selectCluster(beta);

    expect(listed()).toEqual([ALL, 'team-c', 'team-d']);
    expect(ns().namespaceLoading).toBe(false);
    // Switching tabs keeps every open cluster's list subscribed.
    expect(app.streams.active()).toEqual(expect.arrayContaining([streamOf(alpha), streamOf(beta)]));
    await releaseBeta();
  });

  it('never shows the previous cluster’s namespaces while the next cluster’s list loads', async () => {
    declareClusters();
    const releaseBeta = holdNamespaceReads(beta, ['team-c', 'team-d']);
    view = await app.render(null);
    const renders: Array<{ clusterId: string; names: string[] }> = [];
    function RenderLog() {
      const { selectedClusterId } = useKubeconfig();
      const { namespaces } = useNamespace();
      renders.push({ clusterId: selectedClusterId, names: namespaces.map((item) => item.name) });
      return null;
    }
    await view.show(<RenderLog />);

    await view.selectCluster(beta);

    const betaRenders = renders.filter((render) => render.clusterId === beta.clusterId);
    expect(betaRenders).not.toEqual([]);
    expect(betaRenders.every((render) => render.names.length === 0)).toBe(true);
    expect(ns().namespaceLoading).toBe(true);
    expect(ns().namespaceReady).toBe(false);
    await releaseBeta();
  });

  it('maps the backend’s rollups and usage into the namespace list', async () => {
    declareClusters();
    app.snapshots.serve('namespaces', scopeOf(alpha), {
      clusterId: alpha.clusterId,
      clusterName: alpha.clusterName,
      namespaces: [
        namespaceRow(alpha, 'team-a', {
          unhealthyWorkloads: 3,
          warningEvents: 2,
          quotaCount: 2,
          quotaHighestUsedPercentage: 92,
          quotaPressure: 'warning',
        }),
      ],
    });
    serveUsage(alpha, [{ name: 'team-a', cpuUsageMilli: 200, memoryUsageBytes: 96 * 1024 ** 2 }], {
      collectedAt: Math.floor(Date.now() / 1000),
    });
    view = await app.render(null);

    const teamA = ns().namespaces.find((item) => item.name === 'team-a');
    expect(teamA).toMatchObject({
      unhealthyWorkloads: 3,
      warningEvents: 2,
      warningEventsState: 'available',
      cpuUsageMilli: 200,
      memoryUsageBytes: 96 * 1024 ** 2,
      utilizationState: 'available',
      quotaHighestUsedPercentage: 92,
      quotaPressure: 'warning',
      quotaPressureState: 'available',
    });
    expect(teamA?.details).toContain('200m CPU, 96Mi memory');
  });

  it('treats a null namespace list from the backend as no namespaces', async () => {
    declareClusters();
    app.snapshots.serve('namespaces', scopeOf(alpha), {
      clusterId: alpha.clusterId,
      clusterName: alpha.clusterName,
      namespaces: null,
    } as unknown as DomainPayloadMap['namespaces']);
    view = await app.render(null);

    expect(ns().namespaces).toEqual([]);
  });

  it('marks utilization stale once the metrics pass their freshness window', async () => {
    vi.useFakeTimers();
    declareClusters();
    serveUsage(alpha, [{ name: 'team-a', cpuUsageMilli: 200, memoryUsageBytes: 1024 ** 2 }], {
      collectedAt: Math.floor(Date.now() / 1000),
      staleAfterSeconds: 30,
    });
    view = await app.render(null);
    const teamADetails = () => ns().namespaces.find((item) => item.name === 'team-a')?.details;
    expect(teamADetails()).not.toContain('Awaiting metrics data');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_500);
    });

    expect(teamADetails()).toContain('Awaiting metrics data');
  });
});

describe('refresh demand', () => {
  it('reads every open cluster’s namespaces at startup without a refresh job', async () => {
    await start();

    expect(readsOf(alpha)).not.toEqual([]);
    expect(readsOf(beta)).not.toEqual([]);
    expect(refreshJobs()).toEqual([]);
  });

  it('reads a cluster’s namespaces only once its lifecycle allows refresh', async () => {
    await start(backend.ClusterLifecycleState.ClusterStateConnected);
    expect(readsOf(alpha)).not.toEqual([]);
    expect(readsOf(beta)).toEqual([]);

    await setLifecycle(beta, 'loading');

    expect(readsOf(beta)).not.toEqual([]);
  });

  it('stops subscribing to clusters that become unavailable but keeps their listed namespaces', async () => {
    vi.useFakeTimers();
    await start();
    app.snapshots.clearReads();

    await setLifecycle(alpha, 'connected');
    await setLifecycle(beta, 'connected');
    await closeReleasedStreams();

    expect(app.streams.active()).not.toContain(streamOf(alpha));
    expect(app.streams.active()).not.toContain(streamOf(beta));
    expect(app.snapshots.reads('namespaces')).toEqual([]);
    expect(listed()).toEqual([ALL, 'team-a', 'team-b']);
  });

  it('paints a retained list on switch before the cluster’s lifecycle allows its refresh', async () => {
    vi.useFakeTimers();
    await start();
    // A late lifecycle edge leaves beta temporarily unavailable for refresh.
    await setLifecycle(beta, 'connected');
    await closeReleasedStreams();
    app.snapshots.clearReads();

    await view.selectCluster(beta);

    expect(listed()).toEqual([ALL, 'team-c', 'team-d']);
    expect(ns().namespaceLoading).toBe(false);
    expect(readsOf(beta)).toEqual([]);
    expect(app.streams.active()).not.toContain(streamOf(beta));

    await setLifecycle(beta, 'loading');

    expect(app.streams.active()).toContain(streamOf(beta));
    expect(listed()).toEqual([ALL, 'team-c', 'team-d']);
  });

  it('never resets another cluster’s namespace list while a tab opens and closes', async () => {
    vi.useFakeTimers();
    alpha = app.cluster({ name: 'dev', context: 'alpha' });
    beta = app.cluster({ name: 'dev', context: 'beta', open: false });
    app.namespaces(alpha, ['team-a']);
    app.namespaces(beta, ['team-c']);
    view = await app.render(null);
    const alphaListed: boolean[] = [];
    function AlphaListLog() {
      alphaListed.push(Boolean(useNamespaceStatesByScope()[scopeOf(alpha)]?.data));
      return null;
    }
    await view.show(<AlphaListLog />);
    const kubeconfig = () => view.owners().kubeconfig;

    let opening!: Promise<void>;
    act(() => {
      opening = kubeconfig().openKubeconfig(beta.selection);
    });
    await act(async () => {
      await opening;
    });
    await setLifecycle(beta, 'ready');
    expect(app.streams.active()).toEqual(expect.arrayContaining([streamOf(alpha), streamOf(beta)]));

    let closing!: Promise<void>;
    act(() => {
      closing = kubeconfig().closeKubeconfig(beta.selection);
    });
    await act(async () => {
      await closing;
    });
    await closeReleasedStreams();

    expect(app.streams.active()).not.toContain(streamOf(beta));
    expect(app.streams.active()).toContain(streamOf(alpha));
    expect(alphaListed).not.toContain(false);
  });

  it('refreshes every open cluster’s namespaces when the user refreshes them', async () => {
    await start();
    app.snapshots.clearReads();

    await act(async () => {
      await ns().loadNamespaces();
    });
    await app.settle();

    expect(readsOf(alpha)).not.toEqual([]);
    expect(readsOf(beta)).not.toEqual([]);
  });

  it('reconciles a rebuilt namespace scope with one read and no refresh job', async () => {
    await start();
    app.snapshots.clearReads();
    const jobsBefore = refreshJobs().length;

    await act(async () => {
      app.events.emit('cluster:scope:changed', { clusterId: alpha.clusterId });
    });
    await app.settle();

    expect(readsOf(alpha)).toHaveLength(1);
    expect(readsOf(beta)).toEqual([]);
    expect(refreshJobs()).toHaveLength(jobsBefore);
  });

  it('keeps the active cluster’s utilization while another surface releases it, and moves it on switch', async () => {
    vi.useFakeTimers();
    await start();
    // The global Namespaces view leases each cluster's utilization too.
    const releaseGlobalView = await view.lease({
      domain: 'namespace-metrics',
      scope: scopeOf(alpha, 'namespace-metrics'),
      preserveState: true,
    });
    await releaseGlobalView();
    await closeReleasedStreams();
    expect(app.streams.active()).toContain(streamOf(alpha, 'namespace-metrics'));

    await view.selectCluster(beta);
    await closeReleasedStreams();

    expect(app.streams.active()).toContain(streamOf(beta, 'namespace-metrics'));
    expect(app.streams.active()).not.toContain(streamOf(alpha, 'namespace-metrics'));
  });
});

describe('namespace selection', () => {
  it('keeps the selected namespace while the list refreshes', async () => {
    vi.useFakeTimers();
    await start();
    await select('team-a');
    const releaseAlpha = holdNamespaceReads(alpha, ['team-a', 'team-b']);
    app.snapshots.clearReads();

    await ringNamespaces(alpha, 'v2');
    expect(readsOf(alpha)).toHaveLength(1);
    expect(selection()).toEqual({ namespace: 'team-a', clusterId: alpha.clusterId });

    await releaseAlpha();
    expect(selection()).toEqual({ namespace: 'team-a', clusterId: alpha.clusterId });
  });

  it('clears the selection when the refreshed list no longer has it', async () => {
    vi.useFakeTimers();
    await start();
    await select('team-a');

    app.namespaces(alpha, ['bravo']);
    await ringNamespaces(alpha, 'v2');

    expect(listed()).toEqual([ALL, 'bravo']);
    expect(selection()).toEqual({ namespace: undefined, clusterId: undefined });
  });

  it('keeps each cluster tab’s own namespace selection', async () => {
    await start();
    await select('team-b');

    await view.selectCluster(beta);
    expect(selection().namespace).toBeUndefined();
    await select('team-d');

    await view.selectCluster(alpha);
    expect(selection()).toEqual({ namespace: 'team-b', clusterId: alpha.clusterId });
  });

  it('selects a namespace in the cluster the caller names', async () => {
    await start();

    await select('team-d', beta.clusterId);

    expect(selection().namespace).toBeUndefined();
    expect(ns().getClusterNamespace(beta.clusterId)).toBe('team-d');
    expect(ns().getClusterNamespace(alpha.clusterId)).toBeUndefined();
  });

  it('forgets a closed cluster tab’s namespace selection', async () => {
    await start();
    await view.selectCluster(beta);
    await select('team-d');

    let closing!: Promise<void>;
    act(() => {
      closing = view.owners().kubeconfig.closeKubeconfig(beta.selection);
    });
    await act(async () => {
      await closing;
    });
    let reopening!: Promise<void>;
    act(() => {
      reopening = view.owners().kubeconfig.openKubeconfig(beta.selection);
    });
    await act(async () => {
      await reopening;
    });
    await app.settle();

    expect(view.owners().kubeconfig.selectedClusterId).toBe(beta.clusterId);
    expect(selection().namespace).toBeUndefined();
  });
});

describe('failures', () => {
  // The refresh layer reports a namespace-list failure
  // (core/refresh/refreshErrorNotifier.ts), once per scope and message.
  const failNamespaces = (cluster: TestCluster, message: string) =>
    app.snapshots.fail('namespaces', scopeOf(cluster), makeErrorStatus('ServerTimeout', message));
  const failureReports = () =>
    app.errors
      .records()
      .filter((record) => record.context?.domain === 'namespaces' || record.context?.context);
  const takeReports = () => app.errors.take(() => true);

  it('reports a transient namespace failure once without marking the list denied', async () => {
    declareClusters();
    failNamespaces(alpha, 'apiserver timeout on startup');
    view = await app.render(null);

    expect(ns().namespacesPermissionDenied).toBe(false);
    expect(failureReports()).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({ domain: 'namespaces', scope: scopeOf(alpha) }),
      }),
    ]);
    takeReports();
  });

  it('does not report a cluster’s namespace failure again when the user switches away and back', async () => {
    declareClusters();
    failNamespaces(alpha, 'apiserver timeout before switching');
    view = await app.render(null);
    expect(failureReports()).toHaveLength(1);

    await view.selectCluster(beta);
    await view.selectCluster(alpha);

    expect(failureReports()).toHaveLength(1);
    takeReports();
  });
});
