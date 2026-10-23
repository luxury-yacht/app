/**
 * frontend/src/modules/cluster/components/ClusterViewNodes.test.tsx
 *
 * The cluster Nodes view lists the visible cluster's nodes from the backend's
 * nodes query, with the backend's status as given. Its name link and Enter
 * open a node's panel, and its row menu opens the node's Map, with complete
 * identity. A node's Pods count (or Space) opens that node's pods
 * under its row, without opening the node; several nodes' pods stay open
 * until each is closed, and a node that leaves the list takes its open pods
 * and highlight with it. A row click only highlights; a click on the table's
 * empty area clears the highlight. The view keeps its loading state until
 * the first query answers and omits the backend's Status facet. Revisiting
 * the view is covered by ClusterViewNodesRevisit.test.tsx. Runs in the full
 * app, navigated through the sidebar, over a faked backend
 * (test-utils/appState).
 */

import { objectPanelId } from '@modules/object-panel/objectPanelRef';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const nodeIdentity = (name: string): ObjectIdentity => ({
  group: '',
  version: 'v1',
  kind: 'Node',
  namespace: '',
  name,
});

/** A node row as backend/refresh/snapshot/nodes.go projects it, in the visible cluster. */
const node = (name: string, overrides: Partial<ClusterNodeSnapshotEntry> = {}) =>
  makeClusterNodeSnapshotEntry({ ...overrides, ref: { clusterId: dev.clusterId, name } });

const clusterFields = () => ({ clusterId: dev.clusterId, clusterName: dev.clusterName });

/** The node a pods query selects (its `facet.nodes`), with the rest of its scope. */
const podsQuery = (scope: string) => {
  const { clusterId, selector, query } = parseRefreshScope('pods', scope);
  return { clusterId, selector, node: new URLSearchParams(query).get('facet.nodes') };
};

/** Serves each node's pods, one `<node>-web` pod per node, to the pods queries that select it. */
const serveNodePods = () => {
  app.snapshots.answer(({ domain, scope }) => {
    if (domain !== 'pods') {
      return undefined;
    }
    const { node: nodeName } = podsQuery(scope);
    const rows = nodeName
      ? [
          makePodSnapshotEntry({
            node: nodeName,
            ref: { clusterId: dev.clusterId, namespace: 'team-a', name: `${nodeName}-web` },
          }),
        ]
      : [];
    return makePodSnapshotPayload({ ...clusterFields(), rows, total: rows.length });
  });
};

const startCluster = () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
  app.startScreen(dev);
  // The view follows the cluster's drain jobs (backend/node_maintenance.go); none here.
  app.snapshots.serve(
    'object-maintenance',
    buildClusterRefreshScope('object-maintenance', dev.clusterId),
    { ...clusterFields(), drains: [] }
  );
};

const openView = async () => {
  view = await app.mountApp();
  await view.goTo({ clusterView: 'nodes' });
};

const start = async (rows: () => ClusterNodeSnapshotEntry[] = () => [node('node-1')]) => {
  startCluster();
  app.serveTable(dev, 'nodes', { rows: rows() });
  serveNodePods();
  await openView();
};

const NODES_BODY = 'table.gridtable--body.gridtable-nodes';

const nodesTable = () =>
  requireValue(view.container.querySelector<HTMLElement>(NODES_BODY), 'expected the Nodes table');

/** The Nodes table's own rows (a node's pods render in nested tables). */
const nodeRows = () => {
  const table = view.container.querySelector<HTMLElement>(NODES_BODY);
  return Array.from(table?.querySelectorAll<HTMLElement>('.gridtable-row') ?? []).filter(
    (row) => row.closest('table') === table
  );
};

const rowOf = (name: string) =>
  requireValue(
    nodeRows().find(
      (row) => row.querySelector('[data-column="name"]')?.textContent?.trim() === name
    ),
    `expected the ${name} row`
  );

const isHighlighted = (name: string) => rowOf(name).dataset.rowSelected === 'true';

const podsToggle = (name: string) =>
  requireValue(
    rowOf(name).querySelector<HTMLButtonElement>('[data-column="pods"] button'),
    `expected the ${name} Pods count`
  );

/** The pods tables open under node rows, by the pods they list. */
const openPodTables = () =>
  Array.from(
    view.container.querySelectorAll<HTMLElement>(`${NODES_BODY} table.gridtable--body`)
  ).map((table) =>
    Array.from(table.querySelectorAll<HTMLElement>('.gridtable-row')).map((row) =>
      row.querySelector('[data-column="name"]')?.textContent?.trim()
    )
  );

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

const press = async (key: string) => {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    );
  });
  await app.settle();
};

const nodeNames = () =>
  nodeRows().map((row) => row.querySelector('[data-column="name"]')?.textContent?.trim());

/** The nodes domain rings its object clock; the view re-queries after the stream's coalescing window. */
const ringNodes = async (version: string) => {
  await act(async () => {
    app.streams.ring('nodes', buildClusterRefreshScope('nodes', dev.clusterId), 'object', version);
    await vi.advanceTimersByTimeAsync(200);
  });
  await app.settle();
};

/** Closes the pods table open under `name` with its own Close. */
const closePodsOf = async (name: string) => {
  const detail = requireValue(
    rowOf(name).nextElementSibling as HTMLElement | null,
    `expected the pods under ${name}`
  );
  await click(
    requireValue(
      detail.querySelector<HTMLButtonElement>('button[aria-label="Close pods"]'),
      'expected the attached table Close'
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

describe('ClusterViewNodes', () => {
  it('lists the visible cluster’s nodes with the backend’s status, version, pods, and restarts', async () => {
    await start(() => [
      // A cordoned node the backend still reports as Ready: the view does not reinterpret it.
      node('node-1', {
        status: 'Ready',
        unschedulable: true,
        taints: [{ key: 'node.kubernetes.io/unschedulable', effect: 'NoSchedule' }],
        pods: '3',
        restarts: 0,
      }),
      node('node-2', { status: 'Ready (Cordoned)', unschedulable: true, restarts: 4 }),
      node('node-3', { status: 'Terminating', version: 'v1.30.2' }),
    ]);

    expect(
      nodeRows().map((row) =>
        ['name', 'status', 'version', 'pods', 'restarts'].map((column) =>
          row.querySelector(`[data-column="${column}"]`)?.textContent?.trim()
        )
      )
    ).toEqual([
      ['node-1', 'Ready', 'v1.31.0', '3', '-'],
      ['node-2', 'Ready (Cordoned)', 'v1.31.0', '18', '4'],
      ['node-3', 'Terminating', 'v1.30.2', '18', '-'],
    ]);
    expect(
      app.snapshots.reads('nodes').every((read) => read.scope.startsWith(`${dev.clusterId}|`))
    ).toBe(true);
  });

  it('opens a node’s panel from its name, and its Map from its row menu, with complete identity', async () => {
    await start();
    const panel = app.servePanel(dev, nodeIdentity('node-1'));
    app.snapshots.serve('object-map', requireValue(panel.scopes.mapScope, 'expected a map scope'), {
      ...clusterFields(),
      seed: { clusterId: dev.clusterId, ...nodeIdentity('node-1') },
      nodes: [],
      edges: [],
      maxNodes: 250,
      truncated: false,
    });
    // A Node panel lists its node's log sources (backend/node_logs.go); none here.
    app.backend.answer('DiscoverNodeLogs', () => ({ supported: false, reason: 'unavailable' }));

    await click(
      requireValue(
        rowOf('node-1').querySelector<HTMLButtonElement>('[data-column="name"] button'),
        'expected the name link'
      )
    );
    expect(view.openPanels()).toEqual([inCluster(nodeIdentity('node-1'))]);

    await act(async () => {
      requireValue(
        rowOf('node-1').querySelector<HTMLElement>('[data-column="status"]'),
        'expected a cell'
      ).dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
      );
    });
    await app.settle();
    await click(
      requireValue(
        Array.from(
          document.body.querySelectorAll<HTMLElement>('[role="menu"] .context-menu-item')
        ).find(
          (item) => item.querySelector('.context-menu-label')?.textContent?.trim() === 'Open Map'
        ),
        'expected Open Map'
      )
    );

    expect(view.openPanels()).toEqual([inCluster(nodeIdentity('node-1'))]);
    expect(
      view.owners().objectPanels.getOwnedPanel(dev.clusterId, objectPanelId(panel.ref))?.activeView
    ).toBe('map');
  });

  it('opens a node’s pods under its row from its Pods count without opening the node', async () => {
    await start();
    expect(openPodTables()).toEqual([]);
    expect(podsToggle('node-1').getAttribute('aria-expanded')).toBe('false');

    await click(podsToggle('node-1'));

    expect(podsToggle('node-1').getAttribute('aria-expanded')).toBe('true');
    // The node's pods across every namespace of the visible cluster.
    expect(app.snapshots.reads('pods').map((read) => podsQuery(read.scope))).toContainEqual({
      clusterId: dev.clusterId,
      selector: { kind: 'all-namespaces' },
      node: 'node-1',
    });
    expect(openPodTables()).toEqual([['node-1-web']]);
    expect(isHighlighted('node-1')).toBe(true);
    expect(view.openPanels()).toEqual([]);

    // The count closes them again; so does the attached table's own Close.
    // Either way the node keeps its highlight.
    await click(podsToggle('node-1'));
    expect(openPodTables()).toEqual([]);
    expect(isHighlighted('node-1')).toBe(true);
    await click(podsToggle('node-1'));
    await closePodsOf('node-1');
    expect(openPodTables()).toEqual([]);
    expect(isHighlighted('node-1')).toBe(true);
  });

  it('keeps each node’s pods open while another opens, and closes only the one asked', async () => {
    await start(() => [node('node-1'), node('node-2')]);

    await click(podsToggle('node-1'));
    await click(podsToggle('node-2'));
    expect(openPodTables()).toEqual([['node-1-web'], ['node-2-web']]);

    await closePodsOf('node-1');
    expect(openPodTables()).toEqual([['node-2-web']]);
  });

  it('only highlights a node on a row click, opens its pods with Space, and clears the highlight on the table’s empty area', async () => {
    await start();

    await click(
      requireValue(
        rowOf('node-1').querySelector<HTMLElement>('[data-column="version"]'),
        'expected a cell'
      )
    );
    expect(isHighlighted('node-1')).toBe(true);
    expect(openPodTables()).toEqual([]);
    expect(view.openPanels()).toEqual([]);

    await act(async () => nodesTable().focus());
    await press(' ');
    expect(openPodTables()).toEqual([['node-1-web']]);

    await click(requireValue(nodesTable().parentElement, 'expected the table area'));
    expect(isHighlighted('node-1')).toBe(false);
  });

  it('closes a node’s pods and clears its highlight when the node leaves the list', async () => {
    vi.useFakeTimers();
    let listed = ['node-1', 'node-2'];
    startCluster();
    app.snapshots.answer(({ domain, scope }) =>
      domain === 'nodes' && scope.startsWith(`${dev.clusterId}|`)
        ? makeClusterNodeSnapshotPayload({
            ...clusterFields(),
            rows: listed.map((name) => node(name)),
            total: listed.length,
          })
        : undefined
    );
    serveNodePods();
    await openView();
    await click(podsToggle('node-2'));
    expect(openPodTables()).toEqual([['node-2-web']]);
    expect(isHighlighted('node-2')).toBe(true);

    // node-2 is deleted; the nodes domain rings its object clock.
    listed = ['node-1'];
    await ringNodes('v2');
    expect(nodeNames()).toEqual(['node-1']);

    // Should node-2 come back, it returns with its pods closed and unhighlighted.
    listed = ['node-1', 'node-2'];
    await ringNodes('v3');
    expect(nodeNames()).toEqual(['node-1', 'node-2']);
    expect(openPodTables()).toEqual([]);
    expect(isHighlighted('node-2')).toBe(false);
  });

  it('opens the focused node’s panel on Enter', async () => {
    await start();
    app.servePanel(dev, nodeIdentity('node-1'));
    app.backend.answer('DiscoverNodeLogs', () => ({ supported: false, reason: 'unavailable' }));

    await act(async () => nodesTable().focus());
    await press('Enter');

    expect(view.openPanels()).toEqual([inCluster(nodeIdentity('node-1'))]);
  });

  it('omits the Status facet the backend advertises for nodes', async () => {
    startCluster();
    app.serveTable(dev, 'nodes', {
      rows: [node('node-1')],
      facetValues: [
        {
          key: 'statuses',
          options: [
            { value: 'NotReady', label: 'NotReady' },
            { value: 'Ready', label: 'Ready' },
          ],
          exact: true,
        },
      ],
      capabilities: {
        sortableFields: [],
        filterableFields: [],
        searchableFields: [],
        kindVocabulary: [],
        queryFacets: [
          {
            key: 'statuses',
            label: 'Status',
            placeholder: 'All statuses',
            searchable: false,
            bulkActions: true,
          },
        ],
      },
    });
    await openView();

    expect(rowOf('node-1')).toBeDefined();
    expect(
      view.container.querySelector('[data-gridtable-filter-role="query-facet-statuses"]')
    ).toBeNull();
  });

  it('shows the loading state, not an empty table, until the first nodes query answers', async () => {
    startCluster();
    // The nodes query is in flight until the backend answers it.
    const parked: Array<() => void> = [];
    app.snapshots.respond(({ domain, scope }) =>
      domain === 'nodes'
        ? new Promise<Response>((resolve) => {
            parked.push(() =>
              resolve(
                snapshotResponse({
                  domain,
                  scope,
                  version: 1,
                  payload: makeClusterNodeSnapshotPayload({
                    ...clusterFields(),
                    rows: [node('node-1')],
                    total: 1,
                  }),
                })
              )
            );
          })
        : undefined
    );
    await openView();

    expect(nodeRows()).toEqual([]);
    expect(view.container.textContent).toContain('Loading nodes');
    expect(view.container.textContent).not.toContain('No nodes found');

    app.snapshots.respond(null);
    await act(async () => {
      parked.splice(0).forEach((answer) => {
        answer();
      });
    });
    await app.settle();
    expect(nodeNames()).toEqual(['node-1']);
  });
});
