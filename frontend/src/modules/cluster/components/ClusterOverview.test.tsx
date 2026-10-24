/**
 * frontend/src/modules/cluster/components/ClusterOverview.test.tsx
 *
 * The cluster Overview, the full app's start screen. It reads only the
 * visible cluster's overview (not before the cluster's data services start),
 * shows placeholders until that overview arrives and the newly visible
 * cluster's overview after a tab switch, reconciles once while auto-refresh
 * is paused, reports a failed read inline, shows the node breakdown the
 * cluster's provider has, and explains each source the backend could not read
 * in the card it affects, dashing what it cannot know rather than showing
 * zero. Its pod and node cards navigate to the matching Attention findings,
 * the All Namespaces Pods view, or the Nodes view; its latest warning events
 * open their object on the Events tab and form one keyboard stop whose focus
 * survives refreshes. Runs in the full app over a faked backend
 * (test-utils/appState).
 */

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { getTabbableElements } from '@shared/components/modals/getTabbableElements';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backend, objectcatalog } from '@/core/backend-api/models';
import { makeClusterOverviewSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import type {
  ClusterOverviewPayload,
  ClusterOverviewSnapshotPayload,
  RecentEventEntry,
} from '@/core/refresh/types';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';

const GIB = 1024 ** 3;

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const overviewScope = (cluster: TestCluster) =>
  buildClusterRefreshScope('cluster-overview', cluster.clusterId);

/** The cluster's overview as backend/refresh/snapshot/cluster_overview.go builds it. */
const overviewPayload = (
  cluster: TestCluster,
  overview: Partial<ClusterOverviewPayload>,
  extra: Partial<ClusterOverviewSnapshotPayload> = {}
): ClusterOverviewSnapshotPayload => {
  const payload = makeClusterOverviewSnapshotPayload({
    clusterId: cluster.clusterId,
    clusterName: cluster.clusterName,
  });
  return { ...payload, ...extra, overview: { ...payload.overview, ...overview } };
};

const serveOverview = (
  cluster: TestCluster,
  overview: Partial<ClusterOverviewPayload>,
  extra: Partial<ClusterOverviewSnapshotPayload> = {}
) => {
  app.snapshots.serve(
    'cluster-overview',
    overviewScope(cluster),
    overviewPayload(cluster, overview, extra)
  );
};

const openCluster = (name: string, lifecycle?: backend.ClusterLifecycleState) => {
  const cluster = app.cluster({ name, context: name, lifecycle });
  app.namespaces(cluster, ['team-a']);
  app.startScreen(cluster);
  return cluster;
};

/** Parks every overview read until the returned release answers it with `payload`. */
const holdOverviewReads = (payload: ClusterOverviewSnapshotPayload) => {
  const parked: Array<() => void> = [];
  app.snapshots.respond(({ domain, scope }) =>
    domain === 'cluster-overview'
      ? new Promise<Response>((resolve) => {
          parked.push(() => resolve(snapshotResponse({ domain, scope, version: 100, payload })));
        })
      : undefined
  );
  return async () => {
    app.snapshots.respond(null);
    await act(async () => {
      parked.splice(0).forEach((answer) => {
        answer();
      });
    });
    await app.settle();
  };
};

const text = () => view.container.textContent ?? '';

const byTestId = (id: string) => view.container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** The count a metric card shows for `label`; empty when the card is absent. */
const statValueFor = (label: string): string => {
  const labelElement = Array.from(view.container.querySelectorAll('.metric-stat__label')).find(
    (element) => element.textContent === label
  );
  return (
    labelElement
      ?.closest('.metric-stat')
      ?.querySelector('.metric-stat__count')
      ?.textContent?.trim() ?? ''
  );
};

const click = async (element: Element | null | undefined, what: string) => {
  const target = requireValue(element as HTMLElement | null | undefined, `expected ${what}`);
  await act(async () => target.click());
  await app.settle();
};

const overviewReads = () => app.snapshots.reads('cluster-overview').map((read) => read.scope);

beforeEach(() => {
  dev = openCluster('dev');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ClusterOverview', () => {
  it('shows placeholders until the visible cluster’s overview arrives, then its figures', async () => {
    const overview = overviewPayload(dev, {
      clusterType: 'EKS',
      clusterVersion: '1.26.3',
      cpuUsageMilli: 400,
      cpuAllocatableMilli: 2000,
      memoryUsageBytes: 2 * GIB,
      memoryAllocatableBytes: 16 * GIB,
      totalNodes: 3,
      readyNodes: 3,
      totalNamespaces: 6,
      totalPods: 42,
      readyPods: 40,
      startingPods: 1,
      failingPods: 1,
      terminatingPods: 2,
      restartedPods: 7,
      notReadyPods: 9,
    });
    app.snapshots.serve('cluster-overview', overviewScope(dev), overview);
    const release = holdOverviewReads(overview);
    view = await app.mountApp();

    expect(statValueFor('total')).toBe('—');
    expect(statValueFor('namespaces')).toBe('—');

    await release();

    expect(statValueFor('total')).toBe('3');
    expect(statValueFor('namespaces')).toBe('6');
    expect(statValueFor('pods')).toBe('42');
    expect(text()).toContain('EKS');
    expect(text()).toContain('1.26.3');
    expect(text()).toContain('400m of 2 cores');
    expect(text()).toContain('2.0Gi of 16.0Gi');
    expect(
      ['ready', 'starting', 'failing', 'terminating', 'restarted', 'not-ready'].map((key) =>
        byTestId(`cluster-pod-status-${key}`)?.textContent?.replace(/\D/g, '')
      )
    ).toEqual(['40', '1', '1', '2', '7', '9']);
    // Every source was readable: no card explains a restriction.
    expect(view.container.querySelector('[data-testid$="-permission-note"]')).toBeNull();
    expect(view.container.querySelector('[data-testid$="-permission-chip"]')).toBeNull();
  });

  it('does not read the overview before the cluster’s data services start', async () => {
    const connecting = app.cluster({
      name: 'connecting',
      context: 'connecting',
      lifecycle: backend.ClusterLifecycleState.ClusterStateConnecting,
    });
    view = await app.mountApp();

    await view.selectCluster(connecting);

    expect(overviewReads()).not.toContain(overviewScope(connecting));
    expect(statValueFor('total')).toBe('—');
    expect(text()).not.toContain('Failed to load Cluster Overview data');
  });

  it('reads only the visible cluster’s overview and follows a cluster-tab switch', async () => {
    const prod = openCluster('prod');
    serveOverview(dev, { totalNodes: 3 });
    serveOverview(prod, { totalNodes: 9 });
    view = await app.mountApp();

    expect(statValueFor('total')).toBe('3');
    expect(overviewReads()).not.toContain(overviewScope(prod));

    await view.selectCluster(prod);

    expect(statValueFor('total')).toBe('9');
    expect(overviewReads()).toContain(overviewScope(prod));
  });

  it('reconciles the overview once and reports auto-refresh as paused when it is off', async () => {
    app.preferences({ autoRefreshEnabled: false });
    serveOverview(dev, { totalNodes: 3 });
    view = await app.mountApp();

    expect(overviewReads().filter((scope) => scope === overviewScope(dev))).toHaveLength(1);
    expect(statValueFor('total')).toBe('3');
    expect(text()).toContain('Auto-refresh paused');
  });

  it('reports a failed overview read inline and keeps zeroed figures', async () => {
    app.snapshots.fail(
      'cluster-overview',
      overviewScope(dev),
      makeErrorStatus('Forbidden', 'forbidden')
    );
    view = await app.mountApp();

    expect(text()).toContain('Failed to load Cluster Overview data');
    expect(text()).toContain('forbidden');
    expect(statValueFor('total')).toBe('0');
    app.errors.take((record) => String(record.error).includes('forbidden'));
  });

  it.each([
    ['EKS', { ec2Nodes: 3, fargateNodes: 2 }, { ec2: '3', fargate: '2', vm: '', virtual: '' }],
    ['AKS', { vmNodes: 3, virtualNodes: 2 }, { ec2: '', fargate: '', vm: '3', virtual: '2' }],
    ['GKE', {}, { ec2: '', fargate: '', vm: '', virtual: '' }],
  ] as const)('shows the node breakdown a %s cluster has', async (clusterType, nodes, expected) => {
    serveOverview(dev, { clusterType, totalNodes: 5, ...nodes });
    view = await app.mountApp();

    expect(statValueFor('total')).toBe('5');
    expect({
      ec2: statValueFor('ec2'),
      fargate: statValueFor('fargate'),
      vm: statValueFor('vm'),
      virtual: statValueFor('virtual'),
    }).toEqual(expected);
  });

  it('dashes node counts and capacity percentages the backend could not read, and says why', async () => {
    serveOverview(dev, {
      cpuUsageMilli: 400,
      cpuLimitsMilli: 1000,
      memoryUsageBytes: 2 * GIB,
      memoryLimitsBytes: 8 * GIB,
      totalPods: 42,
      totalNamespaces: 6,
      unavailableResources: ['core/nodes'],
    });
    view = await app.mountApp();

    expect(statValueFor('total')).toBe('—');
    // Without node capacity there is no denominator: usage only, no percentage.
    expect(text()).toContain('400m used');
    expect(text()).toContain('2.0Gi used');
    expect(
      Array.from(view.container.querySelectorAll('.metric-header__percent')).map(
        (element) => element.textContent
      )
    ).toEqual(['—', '—']);
    // The notices name the RBAC verbs the app needs ("view" is a ClusterRole, not a verb).
    expect(byTestId('cluster-nodes-permission-note')?.textContent).toContain('list, watch');
    expect(byTestId('utilization-capacity-permission-chip')?.textContent).toContain('list, watch');
    expect(statValueFor('pods')).toBe('42');
    expect(statValueFor('namespaces')).toBe('6');
    expect(byTestId('workloads-pods-permission-note')).toBeNull();
  });

  it('explains unreadable pods and namespaces in their cards while keeping node figures', async () => {
    serveOverview(dev, {
      totalNodes: 2,
      readyNodes: 2,
      cpuUsageMilli: 400,
      cpuAllocatableMilli: 2000,
      unavailableResources: ['core/pods', 'core/namespaces'],
    });
    view = await app.mountApp();

    expect(byTestId('utilization-requests-permission-chip')?.textContent).toContain('list, watch');
    expect(byTestId('workloads-pods-permission-note')?.textContent).toContain('list, watch');
    expect(byTestId('workloads-namespaces-permission-note')?.textContent).toContain('list');
    expect(byTestId('cluster-nodes-permission-note')).toBeNull();
    expect(statValueFor('total')).toBe('2');
    expect(text()).toContain('400m of 2 cores');
  });

  it('explains permanently unavailable metrics in place of the collecting notice', async () => {
    serveOverview(
      dev,
      { totalNodes: 2, readyNodes: 2 },
      {
        // A disabled metrics poller reports its terminal reason.
        metrics: {
          disabled: true,
          lastError: 'Insufficient permissions for Metrics API',
          stale: true,
          successCount: 0,
          failureCount: 0,
        },
      }
    );
    view = await app.mountApp();

    expect(byTestId('utilization-metrics-permission-note')?.textContent).toContain(
      'Insufficient permissions for Metrics API'
    );
    expect(text()).not.toContain('Collecting metrics');
  });

  it('expands and collapses the utilization legend', async () => {
    serveOverview(dev, { totalNodes: 1 });
    view = await app.mountApp();
    const toggle = requireValue(
      byTestId('utilization-legend-toggle'),
      'expected the legend toggle'
    );

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(byTestId('utilization-legend')).toBeNull();
    await click(toggle, 'the legend toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(byTestId('utilization-legend')).not.toBeNull();
    await click(toggle, 'the legend toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(byTestId('utilization-legend')).toBeNull();
  });

  it('opens Attention filtered to the findings behind a failing or not-ready pod card', async () => {
    serveOverview(dev, { failingPods: 2, notReadyPods: 3 });
    app.serveTable(dev, 'cluster-attention');
    view = await app.mountApp();

    const attentionFilters = () => {
      const scope = requireValue(
        app.snapshots.reads('cluster-attention').slice(-1)[0],
        'query'
      ).scope;
      const params = new URLSearchParams(scope.slice(scope.indexOf('?') + 1));
      return { kinds: params.getAll('kinds'), findings: params.getAll('facet.findings') };
    };

    await click(byTestId('cluster-pod-status-failing'), 'the failing card');
    expect(view.owners().viewState?.activeClusterTab).toBe('attention');
    expect(attentionFilters()).toEqual({ kinds: ['Pod'], findings: ['error-presentation'] });

    await view.goTo({ clusterView: 'overview' });
    await click(byTestId('cluster-pod-status-not-ready'), 'the not-ready card');
    expect(view.owners().viewState?.activeClusterTab).toBe('attention');
    expect(attentionFilters()).toEqual({ kinds: ['Pod'], findings: ['pod-not-ready'] });
  });

  it('opens every namespace’s Pods, unfiltered, from the ready pod card', async () => {
    serveOverview(dev, { readyPods: 5 });
    app.serveTable(dev, 'pods');
    view = await app.mountApp();

    await click(byTestId('cluster-pod-status-ready'), 'the ready card');

    const { namespace, viewState } = view.owners();
    expect(namespace.selectedNamespace).toBe(ALL_NAMESPACES_SCOPE);
    expect(viewState?.viewType).toBe('namespace');
    expect(viewState?.activeNamespaceTab).toBe('pods');
    const podsQuery = requireValue(
      app.snapshots.reads('pods').slice(-1)[0],
      'expected a pods query'
    );
    expect(podsQuery.scope).not.toContain('facet.');
  });

  it('opens Nodes from the not-ready and cordoned node signals only', async () => {
    serveOverview(dev, { totalNodes: 5, readyNodes: 3, notReadyNodes: 2, cordonedNodes: 1 });
    app.serveTable(dev, 'nodes');
    // The Nodes view reads the cluster's drain jobs
    // (backend/refresh/snapshot/node_maintenance.go).
    app.snapshots.serve(
      'object-maintenance',
      buildClusterRefreshScope('object-maintenance', dev.clusterId),
      { clusterId: dev.clusterId, clusterName: dev.clusterName, drains: [] }
    );
    view = await app.mountApp();

    expect(byTestId('cluster-node-health-ready')?.tagName).not.toBe('BUTTON');
    await click(byTestId('cluster-node-health-notReady'), 'the not-ready node signal');
    expect(view.owners().viewState?.activeClusterTab).toBe('nodes');

    await view.goTo({ clusterView: 'overview' });
    await click(byTestId('cluster-node-health-cordoned'), 'the cordoned node signal');
    expect(view.owners().viewState?.viewType).toBe('cluster');
    expect(view.owners().viewState?.activeClusterTab).toBe('nodes');
  });

  it('opens a warning event’s object on its Events tab, resolving it by UID', async () => {
    const pod: ObjectIdentity = {
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'team-a',
      name: 'api-7c8d9',
    };
    const panel = app.servePanel(dev, pod);
    // The catalog's summary of the object
    // (backend/resource_gateway_catalog.go FindCatalogObjectByUID).
    app.backend.answer('FindCatalogObjectByUID', () => ({
      ref: { ...pod, clusterId: dev.clusterId, resource: 'pods', uid: 'pod-uid-1' },
      resourceVersion: '1',
      creationTimestamp: '',
      scope: objectcatalog.Scope.ScopeNamespace,
    }));
    serveOverview(dev, {
      recentEvents: [
        {
          clusterId: dev.clusterId,
          clusterName: dev.clusterName,
          eventUid: 'event-1',
          reason: 'Failed',
          message: 'Back-off restarting failed container',
          timestamp: Date.now(),
          objectKind: 'Pod',
          objectName: 'api-7c8d9',
          objectNamespace: 'team-a',
          objectUid: 'pod-uid-1',
          // The backend sends a display-only link when the event has no apiVersion.
          involvedObject: {
            display: {
              clusterId: dev.clusterId,
              kind: 'Pod',
              namespace: 'team-a',
              name: 'api-7c8d9',
              uid: 'pod-uid-1',
            },
          },
        },
      ],
    });
    view = await app.mountApp();

    await click(view.container.querySelector('.recent-events__row'), 'the warning event');

    expect(app.backend.calls('FindCatalogObjectByUID')).toEqual([[dev.clusterId, 'pod-uid-1']]);
    expect(view.openPanels()).toEqual([
      { ...pod, clusterId: dev.clusterId, clusterName: dev.clusterName },
    ]);
    expect(
      view.owners().objectPanels.getOwnedPanel(dev.clusterId, objectPanelId(panel.ref))?.activeView
    ).toBe('events');
  });

  describe('latest warning events keyboard stop', () => {
    const warning = (id: string): RecentEventEntry => ({
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      eventUid: id,
      reason: 'Failed',
      message: `Warning ${id}`,
      timestamp: Date.now(),
      objectKind: 'Pod',
      objectName: id,
      objectNamespace: 'team-a',
      objectUid: `pod-${id}`,
      involvedObject: {
        ref: {
          clusterId: dev.clusterId,
          group: '',
          version: 'v1',
          kind: 'Pod',
          resource: 'pods',
          namespace: 'team-a',
          name: id,
          uid: `pod-${id}`,
        },
      },
    });

    const press = async (key: string, modifiers: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...modifiers,
      });
      await act(async () => document.activeElement?.dispatchEvent(event));
      return event;
    };

    const card = () =>
      requireValue(view.container.querySelector<HTMLElement>('.recent-events'), 'card');
    const rows = () => Array.from(card().querySelectorAll<HTMLElement>('.recent-events__row'));

    it('is one Tab stop whose arrows, Home, and End move between rows', async () => {
      serveOverview(dev, { recentEvents: ['first', 'second', 'last'].map(warning) });
      view = await app.mountApp();

      expect(getTabbableElements(card())).toEqual([rows()[0]]);
      await act(async () => rows()[0]?.focus());
      await press('ArrowUp');
      expect(document.activeElement).toBe(rows()[0]);
      await press('ArrowDown');
      expect(document.activeElement).toBe(rows()[1]);
      expect(getTabbableElements(card())).toEqual([rows()[1]]);
      await press('End');
      expect(document.activeElement).toBe(rows()[2]);
      await press('ArrowDown');
      expect(document.activeElement).toBe(rows()[2]);
      // A modified arrow belongs to the app's shortcuts, not the list.
      expect((await press('ArrowUp', { ctrlKey: true })).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(rows()[2]);
      await press('Home');
      expect(document.activeElement).toBe(rows()[0]);
      // Activation stays with the row's own button.
      expect((await press('Enter')).defaultPrevented).toBe(false);

      // Leaving the list and coming back returns to the row the user left.
      await press('ArrowDown');
      await press('Tab');
      expect(card().contains(document.activeElement)).toBe(false);
      await press('Tab', { shiftKey: true });
      expect(document.activeElement).toBe(rows()[1]);
    });

    it('keeps the focused row through a refresh and recovers when rows disappear', async () => {
      vi.useFakeTimers();
      serveOverview(dev, { recentEvents: ['first', 'last'].map(warning) });
      view = await app.mountApp();
      // New warnings arrive: the overview rings its metric clock and is read again.
      const refresh = async (ids: string[], version: string) => {
        serveOverview(dev, { recentEvents: ids.map(warning) });
        await act(async () => {
          app.streams.ring('cluster-overview', overviewScope(dev), 'metric', version);
          // Signals apply after the stream's coalescing window (resourceStreamManager.ts).
          await vi.advanceTimersByTimeAsync(200);
        });
        await app.settle();
      };
      const first = requireValue(rows()[0], 'expected the first row');
      await act(async () => first.focus());

      await refresh(['new', 'first', 'last'], 'v2');
      expect(rows().map((row) => row.textContent)).toHaveLength(3);
      expect(document.activeElement).toBe(first);

      await refresh(['new', 'last'], 'v3');
      expect(document.activeElement).toBe(rows()[0]);

      await refresh([], 'v4');
      expect(document.activeElement).toBe(card());
      expect(getTabbableElements(card())).toEqual([]);
      expect((await press('ArrowDown')).defaultPrevented).toBe(false);
    });

    it('leaves focus where the user moved it when the list refreshes', async () => {
      vi.useFakeTimers();
      serveOverview(dev, { recentEvents: ['first', 'last'].map(warning) });
      view = await app.mountApp();
      await act(async () => rows()[0]?.focus());
      await press('Tab');
      const outside = document.activeElement;
      expect(card().contains(outside)).toBe(false);

      serveOverview(dev, { recentEvents: [warning('last')] });
      await act(async () => {
        app.streams.ring('cluster-overview', overviewScope(dev), 'metric', 'v2');
        await vi.advanceTimersByTimeAsync(200);
      });
      await app.settle();

      expect(rows()).toHaveLength(1);
      expect(document.activeElement).toBe(outside);
    });
  });
});
