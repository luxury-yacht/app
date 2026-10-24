/**
 * frontend/src/modules/cluster/components/ClusterViewNodesRevisit.test.tsx
 *
 * Revisiting the cluster Nodes view: while the revisit's query is in flight
 * the view keeps the rows it showed before (never the empty state), then
 * shows what the query returns: fresh rows when the nodes changed while the
 * user was away, or the empty state, without stale rows, when the query
 * settles empty. Pods the user opened under node rows open again on return,
 * each cluster tab keeps its own, and closing the cluster forgets them. The
 * user leaves for the cluster Overview and comes back through the sidebar, in
 * the full app over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { backend } from '@/core/backend-api/models';
import {
  makeClusterNodeSnapshotEntry,
  makeClusterNodeSnapshotPayload,
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope, parseRefreshScope } from '@/core/refresh/scopeSelector';
import type { ClusterNodeSnapshotEntry } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;
let stopServingNodes: () => void = () => undefined;

const node = (name: string): ClusterNodeSnapshotEntry =>
  makeClusterNodeSnapshotEntry({ ref: { clusterId: dev.clusterId, name } });

/** The backend's nodes query answers these nodes from now on. */
const serveNodes = (names: string[]) => {
  stopServingNodes();
  stopServingNodes = app.serveTable(dev, 'nodes', { rows: names.map(node) });
};

/** An open cluster with no drain jobs (backend/node_maintenance.go) that the view follows. */
const openCluster = (name: string, context: string): TestCluster => {
  const cluster = app.cluster({ name, context });
  app.namespaces(cluster, ['team-a']);
  app.startScreen(cluster);
  app.snapshots.serve(
    'object-maintenance',
    buildClusterRefreshScope('object-maintenance', cluster.clusterId),
    { clusterId: cluster.clusterId, clusterName: cluster.clusterName, drains: [] }
  );
  return cluster;
};

/** Serves one `<node>-web` pod per node to the pods queries that select a node (`facet.nodes`). */
const serveNodePods = () => {
  app.snapshots.answer(({ domain, scope }) => {
    if (domain !== 'pods') {
      return undefined;
    }
    const { clusterId, query } = parseRefreshScope('pods', scope);
    const nodeName = new URLSearchParams(query).get('facet.nodes');
    const rows = nodeName
      ? [
          makePodSnapshotEntry({
            node: nodeName,
            ref: { clusterId, namespace: 'team-a', name: `${nodeName}-web` },
          }),
        ]
      : [];
    return makePodSnapshotPayload({ clusterId, rows, total: rows.length });
  });
};

const firstVisit = async (names: string[], openOtherClusters: () => void = () => undefined) => {
  dev = openCluster('dev', 'alpha');
  stopServingNodes = () => undefined;
  serveNodes(names);
  openOtherClusters();
  serveNodePods();
  view = await app.mountApp();
  await view.goTo({ clusterView: 'nodes' });
};

const leaveAndReturn = async () => {
  await view.goTo({ clusterView: 'overview' });
  await view.goTo({ clusterView: 'nodes' });
};

const nodeNames = () =>
  Array.from(
    view.container.querySelectorAll<HTMLElement>(
      'table.gridtable--body.gridtable-nodes [data-column="name"]'
    )
  ).map((cell) => cell.textContent?.trim());

const text = () => view.container.textContent ?? '';

const NODES_BODY = 'table.gridtable--body.gridtable-nodes';

/** The Pods count of a node's row in the Nodes table (not in a nested pods table). */
const podsToggle = (name: string) => {
  const table = view.container.querySelector<HTMLElement>(NODES_BODY);
  const row = Array.from(table?.querySelectorAll<HTMLElement>('.gridtable-row') ?? []).find(
    (candidate) =>
      candidate.closest('table') === table &&
      candidate.querySelector('[data-column="name"]')?.textContent?.trim() === name
  );
  return requireValue(
    row?.querySelector<HTMLButtonElement>('[data-column="pods"] button'),
    `expected the ${name} Pods count`
  );
};

/** The pods tables open under node rows, by the pods they list. */
const openPodTables = () =>
  Array.from(
    view.container.querySelectorAll<HTMLElement>(`${NODES_BODY} table.gridtable--body`)
  ).map((table) =>
    Array.from(table.querySelectorAll<HTMLElement>('.gridtable-row [data-column="name"]')).map(
      (cell) => cell.textContent?.trim()
    )
  );

const settled = async (run: () => unknown) => {
  await act(async () => {
    await run();
  });
  await app.settle();
};

describe('revisiting the Nodes view', () => {
  it('keeps the rows it showed, never the empty state, while the revisit’s query is in flight', async () => {
    await firstVisit(['node-1']);
    expect(nodeNames()).toEqual(['node-1']);
    // The revisit's query is in flight until the backend answers it.
    const parked: Array<() => void> = [];
    app.snapshots.respond(({ domain, scope }) =>
      domain === 'nodes'
        ? new Promise<Response>((resolve) => {
            parked.push(() =>
              resolve(
                snapshotResponse({
                  domain,
                  scope,
                  version: 100,
                  payload: makeClusterNodeSnapshotPayload({
                    clusterId: dev.clusterId,
                    clusterName: dev.clusterName,
                    rows: [node('node-1'), node('node-2')],
                    total: 2,
                  }),
                })
              )
            );
          })
        : undefined
    );

    await leaveAndReturn();

    expect(parked).not.toEqual([]);
    expect(nodeNames()).toEqual(['node-1']);
    expect(text()).not.toMatch(/No nodes found|No data available/);

    app.snapshots.respond(null);
    await act(async () => {
      parked.splice(0).forEach((answer) => {
        answer();
      });
    });
    await app.settle();
    expect(nodeNames()).toEqual(['node-1', 'node-2']);
  });

  it('shows fresh rows when the nodes changed while the user was away', async () => {
    await firstVisit(['node-1']);
    expect(nodeNames()).toEqual(['node-1']);
    serveNodes(['node-2']);

    await leaveAndReturn();

    expect(nodeNames()).toEqual(['node-2']);
  });

  it('shows the empty state, without stale rows, when the revisit’s query settles empty', async () => {
    await firstVisit(['node-1']);
    expect(nodeNames()).toEqual(['node-1']);
    serveNodes([]);

    await leaveAndReturn();

    expect(nodeNames()).toEqual([]);
    expect(text()).toContain('No nodes found');
  });

  it('opens again the node pods the user left open', async () => {
    await firstVisit(['node-1', 'node-2']);
    await settled(() => podsToggle('node-2').click());
    expect(openPodTables()).toEqual([['node-2-web']]);

    await leaveAndReturn();

    expect(podsToggle('node-2').getAttribute('aria-expanded')).toBe('true');
    expect(podsToggle('node-1').getAttribute('aria-expanded')).toBe('false');
    expect(openPodTables()).toEqual([['node-2-web']]);
  });

  it('keeps each cluster tab’s open node pods to itself across a tab switch', async () => {
    const others: TestCluster[] = [];
    await firstVisit(['node-1'], () => {
      const prod = openCluster('prod', 'beta');
      app.serveTable(prod, 'nodes', {
        rows: [
          makeClusterNodeSnapshotEntry({ ref: { clusterId: prod.clusterId, name: 'node-1' } }),
        ],
      });
      others.push(prod);
    });
    const prod = requireValue(others[0], 'expected the prod cluster');
    await settled(() => podsToggle('node-1').click());

    await view.selectCluster(prod);
    await view.goTo({ clusterView: 'nodes' });
    expect(podsToggle('node-1').getAttribute('aria-expanded')).toBe('false');
    expect(openPodTables()).toEqual([]);

    await view.selectCluster(dev);
    await view.goTo({ clusterView: 'nodes' });
    expect(podsToggle('node-1').getAttribute('aria-expanded')).toBe('true');
    expect(openPodTables()).toEqual([['node-1-web']]);
  });

  it('forgets the open node pods once the cluster closes, and loads the reopened cluster’s nodes', async () => {
    // A second open tab keeps the workspace non-empty, so only dev's close is in play.
    await firstVisit(['node-1'], () => {
      openCluster('prod', 'beta');
    });
    await settled(() => podsToggle('node-1').click());
    await leaveAndReturn();
    expect(openPodTables()).toEqual([['node-1-web']]);

    // Reopened at once: inside the stream unsubscribe debounce
    // (resourceStreamManager.ts STREAM_UNSUBSCRIBE_DEBOUNCE_MS).
    await settled(() => view.owners().kubeconfig.closeKubeconfig(dev.selection));
    await settled(() => view.owners().kubeconfig.openKubeconfig(dev.selection));
    // The reopened cluster connects until the backend reports it ready.
    await app.setClusterState(dev, { lifecycle: backend.ClusterLifecycleState.ClusterStateReady });
    await view.goTo({ clusterView: 'nodes' });

    expect(view.owners().kubeconfig.selectedClusterId).toBe(dev.clusterId);
    expect(podsToggle('node-1').getAttribute('aria-expanded')).toBe('false');
    expect(openPodTables()).toEqual([]);
  });
});
