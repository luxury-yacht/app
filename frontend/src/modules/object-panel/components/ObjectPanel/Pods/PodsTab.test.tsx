/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.test.tsx
 *
 * A workload or Node panel's Pods tab issues a typed pods query scoped to the
 * panel's object (only while the tab is shown), renders the returned page, and
 * opens, navigates to, and acts on pods and their owners with complete
 * identity in the panel's cluster. PodsTab reads its object from
 * CurrentObjectPanelContext (PodsTab.tsx:77), so the suite mounts the full app
 * (or a native panel window), opens the panel, and switches to the Pods tab
 * through the panel's tab strip. Only the backend boundary is faked
 * (test-utils/appState); the table is stubbed only to reach its cell renders
 * and props.
 */

import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type ResourceBar from '@shared/components/ResourceBar';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import { getTextContent } from '@shared/components/tables/GridTable.utils';
import {
  buildGridTableStorageKey,
  computeClusterHash,
} from '@shared/components/tables/persistence/gridTablePersistence';
import { act, type ComponentProps, isValidElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { objectPanelTabSnapshot } from '@/core/panel-windows/tabTransfer';
import {
  makeCatalogSnapshotPayload,
  makeClusterNodeSnapshotPayload,
  makeNamespaceWorkloadSnapshotPayload,
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope, parseRefreshScope } from '@/core/refresh/scopeSelector';
import type {
  CanonicalRowTestOverrides,
  DomainPayloadMap,
  PodSnapshotEntry,
  PodSnapshotPayload,
} from '@/core/refresh/types';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
  type TestObject,
} from '@/test-utils/appState/harness';
import type { SnapshotAnswer } from '@/test-utils/appState/transport';
import { objectDetailOf } from '@/test-utils/objectDetail';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';

const PODS_TABLE = 'Object Panel Pods';

const gridTables = vi.hoisted(() => new Map<string, unknown>());

vi.mock('@shared/components/tables/GridTable', () => ({
  default: (props: { diagnosticsLabel?: string }) => {
    gridTables.set(props.diagnosticsLabel ?? '', props);
    return <div data-testid="grid-table" data-label={props.diagnosticsLabel} />;
  },
  GRIDTABLE_VIRTUALIZATION_DEFAULT: {},
}));

const app = installAppStateHarness();

const deployment: ObjectIdentity = {
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  namespace: 'default',
  name: 'my-deploy',
};
const nodeIdentity = (name: string): ObjectIdentity => ({
  group: '',
  version: 'v1',
  kind: 'Node',
  namespace: '',
  name,
});
const podIdentity = (name: string, namespace: string): ObjectIdentity => ({
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace,
  name,
});

let dev: TestCluster;
let view: MountedApp;

/** A pod row as backend/refresh/snapshot/pods.go projects it, in the panel's cluster. */
const createPod = (overrides: CanonicalRowTestOverrides<PodSnapshotEntry> = {}) => {
  const { ref, ...row } = overrides;
  return makePodSnapshotEntry({
    ownerKind: 'Deployment',
    ownerName: 'api',
    node: 'node-a',
    status: 'Running',
    statusPresentation: 'ready',
    ready: '1/1',
    restarts: 0,
    age: '1m',
    portForwardAvailable: false,
    ...row,
    ref: { clusterId: dev.clusterId, namespace: 'team-a', name: 'api', ...ref },
  });
};

/** A typed pods page (backend/refresh/snapshot/pods.go PodBuilder.Build). */
const podsPage = (
  rows: PodSnapshotEntry[],
  overrides: Partial<PodSnapshotPayload> = {}
): PodSnapshotPayload =>
  makePodSnapshotPayload({
    clusterId: dev.clusterId,
    clusterName: dev.clusterName,
    rows,
    total: rows.length,
    unfilteredTotal: rows.length,
    totalCount: rows.length,
    namespaces: ['team-a'],
    kinds: ['Pod'],
    ...overrides,
  });

/** Answers the snapshot reads `answer` handles with the payload it returns (test-utils/appState). */
const answerReads = (answer: SnapshotAnswer) => {
  app.snapshots.answer(answer);
};

const podsReads = () =>
  app.snapshots.reads('pods').map((read) => parseRefreshScope('pods', read.scope));

/** Serves `page` for every pods read scoped to a workload or a node. */
const servePodsQuery = (page: () => PodSnapshotPayload) => {
  answerReads(({ domain, scope }) => {
    if (domain !== 'pods') {
      return undefined;
    }
    const { selector } = parseRefreshScope('pods', scope);
    return selector.kind === 'workload' || selector.kind === 'node' ? page() : undefined;
  });
};

/** Serves an empty page for every namespace-scoped read of `domain`. */
const serveNamespaceTables = <D extends 'pods' | 'namespace-workloads'>(
  domain: D,
  payload: () => DomainPayloadMap[D]
) => {
  answerReads((request) => {
    if (request.domain !== domain) {
      return undefined;
    }
    const { selector } = parseRefreshScope(domain, request.scope);
    return selector.kind === 'namespace' ? payload() : undefined;
  });
};

/** The reads a panel makes, with `detail` as its object-details snapshot (test-utils/appState). */
const servePanel = (identity: ObjectIdentity, detail: object): TestObject =>
  app.servePanel(dev, identity, detail as never);

const clusterFields = () => ({ clusterId: dev.clusterId, clusterName: dev.clusterName });

const startCluster = () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default', 'team-a', 'team-b']);
  app.startScreen(dev);
  // Panels and namespace views read their namespace's pods and workloads.
  serveNamespaceTables('pods', () => makePodSnapshotPayload(clusterFields()));
  serveNamespaceTables('namespace-workloads', () =>
    makeNamespaceWorkloadSnapshotPayload(clusterFields())
  );
  // backend/autoscaling_details.go IsWorkloadHPAManaged: no HPA targets the workload.
  app.backend.answer('IsWorkloadHPAManaged', () => false);
  // backend/node_logs.go DiscoverNodeLogs: a Node panel's log sources; none here.
  app.backend.answer('DiscoverNodeLogs', () => ({
    supported: false,
    reason: 'node log proxy unavailable',
  }));
};

const serveDeployment = () =>
  servePanel(
    deployment,
    objectDetailOf('deployment', { name: deployment.name, namespace: deployment.namespace })
  );

/**
 * A Node panel also reads the cluster's node table and its drain jobs
 * (backend/refresh/snapshot/nodes.go, node_maintenance.go).
 */
const serveNode = (name: string) => {
  app.snapshots.serve(
    'nodes',
    buildClusterRefreshScope('nodes', dev.clusterId),
    makeClusterNodeSnapshotPayload(clusterFields())
  );
  app.snapshots.serve(
    'object-maintenance',
    buildClusterRefreshScope('object-maintenance', dev.clusterId),
    { ...clusterFields(), drains: [] }
  );
  return servePanel(nodeIdentity(name), objectDetailOf('node', { name }));
};

const servePod = (name: string, namespace: string) =>
  servePanel(podIdentity(name, namespace), objectDetailOf('pod', { name, namespace }));

const activate = async (run: () => void) => {
  await act(async () => {
    run();
  });
  await app.settle();
};

const selectPanelTab = async (label: string) => {
  const tablist = requireValue(
    document.querySelector('[role="tablist"][aria-label="Object Panel Tabs"]'),
    'expected the object panel tab strip'
  );
  const tab = requireValue(
    (tablist.getAttribute('aria-owns') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id))
      .find((element) => element?.textContent?.trim().toLowerCase() === label),
    `expected the ${label} tab`
  );
  await activate(() => tab.click());
};

/** Opens `panel` in the workspace and shows its Pods tab, which lists `page`. */
const openPodsTab = async (
  page: () => PodSnapshotPayload,
  panel: TestObject = serveDeployment()
) => {
  servePodsQuery(page);
  view = await app.mountApp();
  await activate(() => view.owners().objectPanel.openWithObject(panel.ref));
  await selectPanelTab('pods');
};

const openPods = (rows: PodSnapshotEntry[]) => openPodsTab(() => podsPage(rows));

const podsTable = () =>
  requireValue(
    gridTables.get(PODS_TABLE) as GridTableProps<PodSnapshotEntry> | undefined,
    'expected the rendered Pods table'
  );

const column = (key: string) =>
  requireValue(
    podsTable().columns.find((candidate) => candidate.key === key),
    `expected the ${key} column`
  );

const firstRow = () => requireValue(podsTable().data[0], 'expected a pod row');

const menuItems = (row: PodSnapshotEntry) =>
  requireValue(podsTable().getCustomContextMenuItems, 'expected a context menu')(row, 'name');

type LinkClick = (event: {
  altKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}) => void;

/** Clicks (or Alt+clicks) the link a cell renders for `row`. */
const clickCell = (key: string, row: PodSnapshotEntry, altKey = false) => {
  const cell = requireReactElement<{ onClick: LinkClick }>(
    column(key).render(row),
    `expected an interactive ${key} cell`
  );
  return activate(() =>
    cell.props.onClick({ altKey, preventDefault: vi.fn(), stopPropagation: vi.fn() })
  );
};

/** A native panel window's tab for `identity`, showing `activeView`. */
const panelTab = (identity: ObjectIdentity, activeView: string) => {
  const ref = { clusterId: dev.clusterId, ...identity };
  return objectPanelTabSnapshot(objectPanelId(ref), ref, activeView);
};

const inCluster = (identity: ObjectIdentity) => ({
  clusterId: dev.clusterId,
  clusterName: dev.clusterName,
  ...identity,
});

const workloadQueries = () =>
  podsReads().filter((read) => read.selector.kind === 'workload' && read.query);

const offersFavorite = () =>
  (podsTable().filters?.options?.preActions ?? []).some(
    (item) => 'id' in item && item.id === 'favorite'
  );

afterEach(() => {
  gridTables.clear();
});

describe('PodsTab', () => {
  it('queries the pods of the panel workload and renders the returned page', async () => {
    startCluster();
    await openPods([createPod({ ref: { name: 'query-pod' } })]);

    expect(workloadQueries()).toContainEqual({
      clusterId: dev.clusterId,
      selector: { kind: 'workload', object: { ...deployment } },
      query: expect.stringContaining('limit='),
    });
    expect(podsTable().data.map((pod) => pod.ref.name)).toEqual(['query-pod']);
  });

  it('queries the pods scheduled on a Node panel’s node', async () => {
    startCluster();
    await openPodsTab(
      () => podsPage([createPod({ ref: { name: 'node-pod' } })]),
      serveNode('worker-a')
    );

    expect(podsReads()).toContainEqual({
      clusterId: dev.clusterId,
      selector: { kind: 'node', node: 'worker-a' },
      query: expect.stringContaining('limit='),
    });
    expect(podsTable().data.map((pod) => pod.ref.name)).toEqual(['node-pod']);
  });

  it('queries nothing while its panel is hidden behind another dock tab, until it is shown', async () => {
    startCluster();
    servePodsQuery(() => podsPage([createPod()]));
    serveDeployment();
    servePod('web-0', 'default');
    // A native panel window whose group shows the pod; the Deployment waits on its Pods tab.
    app.panelWindow(dev, {
      tabs: [panelTab(podIdentity('web-0', 'default'), 'details'), panelTab(deployment, 'pods')],
    });
    view = await app.render(null);
    expect(workloadQueries()).toEqual([]);

    const deploymentTab = requireValue(
      Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find(
        (tab) => tab.textContent?.trim() === deployment.name
      ),
      'expected the Deployment dock tab'
    );
    await activate(() => deploymentTab.click());

    expect(workloadQueries()).not.toEqual([]);
  });

  const customOwner = (kind: string): ObjectIdentity => ({
    group: 'operators.example.io',
    version: 'v1beta2',
    kind,
    namespace: 'team-a',
    name: 'custom-owner',
  });
  const ownedPod = (kind: string) =>
    createPod({
      ownerKind: kind,
      ownerName: 'custom-owner',
      ownerApiVersion: 'operators.example.io/v1beta2',
    });

  it.each(['Deployment', 'Widget'])(
    'opens a %s owner with the API group of its apiVersion',
    async (ownerKind) => {
      startCluster();
      const owner = customOwner(ownerKind);
      servePanel(owner, objectDetailOf('customresource', { kind: owner.kind, name: owner.name }));
      await openPods([ownedPod(ownerKind)]);

      await clickCell('owner', firstRow());

      expect(view.openPanels()).toContainEqual(inCluster(owner));
    }
  );

  it('navigates a Deployment-kind owner in a custom API group to the Custom view', async () => {
    startCluster();
    // The namespace Custom view reads the namespace's custom resources from the catalog.
    answerReads((request) =>
      request.domain === 'catalog' ? makeCatalogSnapshotPayload(clusterFields()) : undefined
    );
    // Mirrors backend/preferences_settings.go UpdateAppPreferences: the sidebar
    // expands the destination's group.
    app.backend.answer('UpdateAppPreferences', (request) => ({
      settings: null,
      changedKeys: (request.changes ?? []).map((change) => change.key),
    }));
    await openPods([ownedPod('Deployment')]);
    const focusRequests: unknown[] = [];
    const stopListening = eventBus.on('gridtable:focus-request', (request) => {
      focusRequests.push(request);
    });

    try {
      await clickCell('owner', firstRow(), true);
    } finally {
      stopListening();
    }

    // Not the built-in Workloads table, which cannot list an operators.example.io
    // Deployment: the Custom view is asked to focus the owner by its complete identity.
    expect(focusRequests).toEqual([
      expect.objectContaining({
        ...customOwner('Deployment'),
        clusterId: dev.clusterId,
        destinationViewId: 'namespace-custom',
      }),
    ]);
    expect(view.owners().viewState?.activeNamespaceTab).toBe('custom');
    expect(view.owners().namespace.selectedNamespace).toBe('team-a');
  });

  it.each([
    { ownerKind: 'None', ownerName: 'None' },
    { ownerKind: 'Deployment', ownerName: 'missing-version' },
    { ownerKind: 'Widget', ownerName: 'missing-version' },
  ])(
    'keeps an owner without complete identity display-only: $ownerKind/$ownerName',
    async (owner) => {
      startCluster();
      const pod = createPod({ ...owner, ownerApiVersion: undefined });
      await openPods([pod]);

      const cell = column('owner').render(pod);
      expect(
        isValidElement<{ onClick?: unknown }>(cell) ? cell.props.onClick : undefined
      ).toBeUndefined();
    }
  );

  it('in a native panel window, opens a pod but offers no workspace navigation or Favorite', async () => {
    startCluster();
    servePodsQuery(() => podsPage([createPod()]));
    serveDeployment();
    servePod('api', 'team-a');
    app.panelWindow(dev, {
      tabs: [panelTab(deployment, 'pods')],
    });
    view = await app.render(null);
    expect(workloadQueries()).not.toEqual([]);

    await clickCell('name', firstRow(), true);

    expect(view.openPanels()).toContainEqual(inCluster(podIdentity('api', 'team-a')));
    expect(column('namespace').render(firstRow())).toBe('team-a');
    expect(offersFavorite()).toBe(false);
  });

  // A favorite saves a main-window view, which a table inside an object panel is not.
  it('offers no Favorite in the main window either', async () => {
    startCluster();
    await openPods([createPod()]);

    expect(offersFavorite()).toBe(false);
  });

  it('omits the Status facet and keeps the backend-owned Node facet', async () => {
    startCluster();
    await openPodsTab(() =>
      podsPage([createPod()], {
        facetValues: [
          { key: 'statuses', options: [{ value: 'Running', label: 'Running' }], exact: true },
          { key: 'nodes', options: [{ value: 'node-a', label: 'node-a' }], exact: true },
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
            {
              key: 'nodes',
              label: 'Node',
              placeholder: 'All nodes',
              searchable: true,
              bulkActions: true,
            },
          ],
        },
      })
    );

    expect(podsTable().filters?.options?.queryFacets).toEqual([
      expect.objectContaining({
        key: 'nodes',
        label: 'Node',
        options: [{ value: 'node-a', label: 'node-a' }],
      }),
    ]);
  });

  it("queries with the table sort saved for the panel's cluster", async () => {
    startCluster();
    const other = app.cluster({ name: 'dev', context: 'beta' });
    app.namespaces(other, ['default']);
    const storageKey = async (cluster: TestCluster) =>
      buildGridTableStorageKey({
        clusterHash: await computeClusterHash(cluster.clusterId),
        viewId: 'object-panel-pods',
      }) ?? '';
    // backend/ui_state_store_persistence.go GetGridTablePersistence: saved
    // table states by storage key.
    const saved = {
      [await storageKey(dev)]: { version: 3, sort: { key: 'age', direction: 'desc' } },
      [await storageKey(other)]: { version: 3, sort: { key: 'name', direction: 'desc' } },
    };
    app.backend.answer('GetGridTablePersistence', () => saved as never);

    await openPods([createPod()]);

    expect(podsTable().sortConfig).toEqual({ key: 'age', direction: 'desc' });
    const queries = workloadQueries();
    const lastQuery = new URLSearchParams(queries[queries.length - 1]?.query);
    expect(lastQuery.get('sort')).toBe('age');
    expect(lastQuery.get('sortDirection')).toBe('desc');
  });

  it("keys pod rows by complete identity in the panel's cluster", async () => {
    startCluster();
    await openPods([createPod({ ref: { name: 'api', namespace: 'team-a' } })]);

    expect(podsTable().keyExtractor(firstRow(), 0)).toBe(`${dev.clusterId}|/v1/Pod/team-a/api`);
  });

  it('styles the status from the backend status presentation', async () => {
    startCluster();
    await openPods([createPod({ statusPresentation: 'warning' })]);

    const cell = requireReactElement<{ className?: string }>(
      column('status').render(firstRow()),
      'expected a status cell'
    );
    expect(cell.props.className).toBe('status-text warning');
  });

  // The backend sorts restarts by count; the table shows zero as no value.
  it('shows zero restarts as no value', async () => {
    startCluster();
    await openPods([createPod(), createPod({ ref: { name: 'restarted' }, restarts: 2 })]);
    const quiet = requireValue(podsTable().data[0], 'expected the quiet pod');
    const restarted = requireValue(podsTable().data[1], 'expected the restarted pod');

    const restarts = column('restarts');
    expect(getTextContent(restarts.render(quiet))).toBe('-');
    expect(getTextContent(restarts.render(restarted))).toBe('2');
  });

  it("opens the pod's Map from its context menu", async () => {
    startCluster();
    const pod = servePod('api', 'team-a');
    const podMapScope = requireValue(pod.scopes.mapScope, 'expected the pod map scope');
    app.snapshots.serve('object-map', podMapScope, {
      ...clusterFields(),
      seed: { clusterId: dev.clusterId, ...podIdentity('api', 'team-a') },
      nodes: [],
      edges: [],
      maxNodes: 250,
      truncated: false,
    });
    await openPods([createPod()]);

    const viewMap = requireValue(
      menuItems(firstRow()).find((item) => item.actionId === OBJECT_ACTION_IDS.viewMap),
      'expected the View Map item'
    );
    await activate(() => viewMap.onClick?.());

    // The pod's panel opens on its Map tab, which reads the pod's map.
    expect(view.openPanels()).toContainEqual(inCluster(podIdentity('api', 'team-a')));
    expect(app.snapshots.reads('object-map').map((read) => read.scope)).toContain(podMapScope);
    expect(document.querySelector('[data-testid="map-tab"]')).not.toBeNull();
  });

  it('offers Port Forward only for pods with forwardable ports, and Delete when permitted', async () => {
    startCluster();
    await openPods([
      createPod({ ref: { name: 'web' }, portForwardAvailable: true }),
      createPod({ ref: { name: 'worker' }, portForwardAvailable: false }),
    ]);
    const item = (index: number, actionId: string) =>
      requireValue(
        menuItems(requireValue(podsTable().data[index], 'expected a pod row')).find(
          (candidate) => candidate.actionId === actionId
        ),
        `expected the ${actionId} item`
      );

    expect(item(0, OBJECT_ACTION_IDS.portForward).disabled).toBeFalsy();
    expect(item(1, OBJECT_ACTION_IDS.portForward).disabled).toBe(true);
    expect(item(0, OBJECT_ACTION_IDS.delete).disabled).toBeFalsy();
  });

  it("checks pod permissions in the visible pods' namespaces, in the panel's cluster", async () => {
    startCluster();
    await openPods([createPod({ ref: { name: 'api', namespace: 'team-a' } })]);

    const podQueries = app.backend
      .calls('QueryPermissions')
      .flatMap(([queries]) => queries ?? [])
      .filter((query) => query.resourceKind === 'Pod');
    expect(podQueries).toContainEqual(
      expect.objectContaining({ clusterId: dev.clusterId, namespace: 'team-a', verb: 'delete' })
    );
  });

  it("opens a pod's node in the panel's cluster", async () => {
    startCluster();
    serveNode('worker-b');
    await openPods([createPod({ node: 'worker-b' })]);

    await clickCell('node', firstRow());

    expect(view.openPanels()).toContainEqual(inCluster(nodeIdentity('worker-b')));
  });

  it("selects a pod's namespace and shows its workloads", async () => {
    startCluster();
    await openPods([createPod({ ref: { namespace: 'team-b' } })]);

    await clickCell('namespace', firstRow());

    const owners = view.owners();
    expect(owners.namespace.selectedNamespace).toBe('team-b');
    expect(owners.viewState?.viewType).toBe('namespace');
    expect(owners.viewState?.activeNamespaceTab).toBe('workloads');
  });

  it("projects the panel query's CPU, memory, and metrics freshness into the metric cells", async () => {
    startCluster();
    const pod = createPod({
      cpuUsageMilli: 250,
      cpuRequestMilli: 500,
      cpuLimitMilli: 1000,
      memoryUsageBytes: 64 * 1024 ** 2,
      memoryRequestBytes: 128 * 1024 ** 2,
      memoryLimitBytes: 256 * 1024 ** 2,
    });
    await openPodsTab(() =>
      podsPage([pod], {
        metrics: {
          stale: true,
          lastError: 'panel metrics unavailable',
          successCount: 1,
          failureCount: 1,
          collectedAt: 1700000000,
        },
      })
    );

    const bar = (key: string) =>
      requireReactElement<ComponentProps<typeof ResourceBar>>(
        column(key).render(firstRow()),
        `expected the ${key} cell`
      ).props;
    expect(bar('cpu')).toMatchObject({
      type: 'cpu',
      usage: 250,
      request: 500,
      limit: 1000,
      metricsStale: true,
      metricsError: 'panel metrics unavailable',
    });
    expect(bar('memory')).toMatchObject({
      type: 'memory',
      usage: 64 * 1024 ** 2,
      request: 128 * 1024 ** 2,
      limit: 256 * 1024 ** 2,
      metricsStale: true,
      metricsError: 'panel metrics unavailable',
    });
  });
});
