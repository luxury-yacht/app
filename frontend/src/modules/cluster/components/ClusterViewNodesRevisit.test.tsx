/**
 * frontend/src/modules/cluster/components/ClusterViewNodesRevisit.test.tsx
 *
 * Revisiting the cluster Nodes view: while the revisit's query is in flight
 * the view keeps the rows it showed before (never the empty state), then
 * shows what the query returns: fresh rows when the nodes changed while the
 * user was away, or the empty state, without stale rows, when the query
 * settles empty. The user leaves for the cluster Overview and comes back
 * through the sidebar, in the full app over a faked backend
 * (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import {
  makeClusterNodeSnapshotEntry,
  makeClusterNodeSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import type { ClusterNodeSnapshotEntry } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';

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

const firstVisit = async (names: string[]) => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  stopServingNodes = () => undefined;
  app.namespaces(dev, ['team-a']);
  app.startScreen(dev);
  // The view follows the cluster's drain jobs (backend/node_maintenance.go); none here.
  app.snapshots.serve(
    'object-maintenance',
    buildClusterRefreshScope('object-maintenance', dev.clusterId),
    { clusterId: dev.clusterId, clusterName: dev.clusterName, drains: [] }
  );
  serveNodes(names);
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
});
