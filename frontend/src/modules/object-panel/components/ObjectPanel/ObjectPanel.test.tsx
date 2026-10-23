/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.test.tsx
 *
 * An opened object panel: which tabs it offers for its kind and the user's
 * permissions, what it hands each tab, how it reads, keeps, and refreshes its
 * object's details, when it marks the object deleted, which namespace
 * permissions it evaluates, and that it collects metrics from the moment it
 * opens. Runs the full app (AppLayout hosts the panel); each tab's content is
 * stubbed to capture what the panel gives it. Only the backend boundary is
 * faked (test-utils/appState).
 */

import { objectPanelId } from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { requestObjectPanelTab } from '@modules/object-panel/objectPanelTabRequests';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeClusterNodeSnapshotPayload,
  makePodSnapshotEntry,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import { buildRefreshScope, CLUSTER_SELECTOR } from '@/core/refresh/scopeSelector';
import { getScopedDomainState } from '@/core/refresh/store';
import type { ErrorStatusObjectRef } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type PermissionDecision,
  type PermissionQuery,
  type TestCluster,
  type TestObject,
} from '@/test-utils/appState/harness';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { requireValue } from '@/test-utils/requireValue';

const tabProps = vi.hoisted(() => ({
  details: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
  shell: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  yaml: [] as Array<Record<string, unknown>>,
  manifest: [] as Array<Record<string, unknown>>,
  values: [] as Array<Record<string, unknown>>,
}));

const captureTab = (key: keyof typeof tabProps) => ({
  default: (props: Record<string, unknown>) => {
    tabProps[key].push(props);
    return null;
  },
});
vi.mock('@modules/object-panel/components/ObjectPanel/Details/DetailsTab', () =>
  captureTab('details')
);
vi.mock('@modules/object-panel/components/ObjectPanel/Logs/LogViewer', () => captureTab('logs'));
vi.mock('@modules/object-panel/components/ObjectPanel/Shell/ShellTab', () => captureTab('shell'));
vi.mock('@modules/object-panel/components/ObjectPanel/Events/EventsTab', () =>
  captureTab('events')
);
vi.mock('@modules/object-panel/components/ObjectPanel/Yaml/YamlTab', () => captureTab('yaml'));
vi.mock('@modules/object-panel/components/ObjectPanel/Helm/ManifestTab', () =>
  captureTab('manifest')
);
vi.mock('@modules/object-panel/components/ObjectPanel/Helm/ValuesTab', () => captureTab('values'));

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];
const lastDetailsProps = () => requireValue(last(tabProps.details), 'Details tab props');

const identity = (
  kind: string,
  name: string,
  namespace = 'team-a',
  group = '',
  version = 'v1'
): ObjectIdentity => ({ group, version, kind, namespace, name });
const deployment = identity('Deployment', 'api', 'team-a', 'apps');
const widget = identity('Widget', 'api', 'team-a', 'example.com');

type DetailsAnswer =
  | { details: object; deletion?: object }
  | { fail: ReturnType<typeof makeErrorStatus> }
  | { respond: () => Response };

/**
 * Serves what `identity`'s panel reads in `cluster` (test-utils/appState), with
 * its details failed or answered by hand when `answer` says so. A node panel
 * also reads its cluster's nodes and discovers its logs.
 */
const servePanel = (
  target: ObjectIdentity,
  answer: DetailsAnswer = { details: {} },
  cluster = dev
): TestObject => {
  const object = app.servePanel(
    cluster,
    target,
    'details' in answer
      ? ({
          details: answer.details,
          ...(answer.deletion ? { deletion: answer.deletion } : {}),
        } as never)
      : undefined
  );
  const scope = object.scopes.detailScope ?? '';
  if ('fail' in answer) {
    app.snapshots.fail('object-details', scope, answer.fail);
  } else if ('respond' in answer) {
    app.snapshots.respond((request) =>
      request.domain === 'object-details' && request.scope === scope ? answer.respond() : undefined
    );
  }
  if (target.kind.toLowerCase() === 'node') {
    const identityOfCluster = { clusterId: cluster.clusterId, clusterName: cluster.clusterName };
    app.snapshots.serve(
      'nodes',
      buildRefreshScope('nodes', { clusterId: cluster.clusterId, selector: CLUSTER_SELECTOR }),
      makeClusterNodeSnapshotPayload(identityOfCluster)
    );
    // backend/node_logs.go: no test here reads a node's logs.
    app.backend.answer('DiscoverNodeLogs', () => ({
      supported: false,
      sources: [],
      reason: 'node log query is not enabled',
    }));
  }
  return object;
};

const start = async (clusters: TestCluster[] = [dev]) => {
  for (const cluster of clusters) {
    app.startScreen(cluster);
  }
  view = await app.mountApp();
};

const open = async (object: TestObject) => {
  await act(async () => {
    view.owners().objectPanel.openWithObject(object.ref);
  });
  await app.settle();
};

/** Opens `target` as the only panel, in a freshly mounted app. */
const openOnly = async (target: ObjectIdentity, answer?: DetailsAnswer) => {
  const object = servePanel(target, answer);
  await start();
  await open(object);
  return object;
};

// The panel's tab strip owns its tabs through aria-owns.
const panelTabs = () =>
  (
    view.container.querySelector('[aria-label="Object Panel Tabs"]')?.getAttribute('aria-owns') ??
    ''
  )
    .split(' ')
    .filter(Boolean)
    .map((id) => requireValue(document.getElementById(id), `tab ${id}`));
const tabLabels = () => panelTabs().map((tab) => tab.textContent?.trim());
const selectTab = async (label: string) => {
  const tab = requireValue(
    panelTabs().find((element) => element.textContent?.trim() === label),
    `${label} tab`
  );
  await act(async () => {
    tab.click();
  });
  await app.settle();
};

const allowAllBut = (deny: (query: PermissionQuery) => PermissionDecision | null) => {
  app.permissions((query) => deny(query) ?? true);
};

// Only the group's front panel is shown; the others' content hosts are hidden.
const isMarkedDeleted = () =>
  [...view.container.querySelectorAll('.object-panel-empty-state')].some(
    (state) => !state.closest('[hidden]')
  );

const detailReads = (object: TestObject) =>
  app.snapshots.reads('object-details').filter((read) => read.scope === object.scopes.detailScope)
    .length;

beforeEach(() => {
  for (const key of Object.keys(tabProps) as Array<keyof typeof tabProps>) {
    tabProps[key] = [];
  }
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
  app.backend.answer('IsWorkloadHPAManaged', () => false);
  app.backend.answer('AppendPanelMetricSample', () => undefined);
});

describe('tab availability', () => {
  it('hides the logs tab when log access is denied', async () => {
    allowAllBut((query) =>
      query.resourceKind === 'Pod' && query.subresource === 'log' ? false : null
    );

    await openOnly(identity('Pod', 'api'));

    expect(tabLabels()).not.toContain('Logs');
    expect(tabLabels()).toEqual(expect.arrayContaining(['Details', 'Events', 'YAML']));
  });

  it('shows manifest and values for Helm releases while hiding events and YAML', async () => {
    await openOnly(identity('HelmRelease', 'my-app', 'team-a', 'helm.sh', 'v3'));

    expect(tabLabels()).toEqual(expect.arrayContaining(['Details', 'Manifest', 'Values']));
    expect(tabLabels()).not.toContain('Events');
    expect(tabLabels()).not.toContain('YAML');
  });

  it('suppresses logs, events, and YAML tabs for event resources', async () => {
    await openOnly(identity('Event', 'warning-123'));

    expect(tabLabels()).toContain('Details');
    expect(tabLabels()).not.toContain('Logs');
    expect(tabLabels()).not.toContain('Events');
    expect(tabLabels()).not.toContain('YAML');
  });

  it('opens on the shell tab a shell session asks for as it opens the panel', async () => {
    const pod = servePanel(identity('Pod', 'api'));
    await start();

    // As the sessions menu does: open the pod, then ask for its shell tab
    // before the panel has mounted.
    await act(async () => {
      view.owners().objectPanel.openWithObject(pod.ref);
      requestObjectPanelTab(objectPanelId(pod.ref), 'shell');
    });
    await app.settle();

    const shell = requireValue(
      panelTabs().find((tab) => tab.textContent?.trim() === 'Shell'),
      'Shell tab'
    );
    expect(shell.classList.contains('tab-item--active')).toBe(true);
  });
});

describe('what each tab receives', () => {
  it('gives the Logs tab its pod once selected', async () => {
    await openOnly(identity('Pod', 'api'));
    expect(tabProps.logs).toEqual([]);

    await selectTab('Logs');

    expect(last(tabProps.logs)).toMatchObject({
      resourceKind: 'pod',
      isActive: true,
      clusterId: dev.clusterId,
    });
  });

  it('gives the Events tab its object once selected', async () => {
    await openOnly(deployment);

    await selectTab('Events');

    expect(last(tabProps.events)).toMatchObject({
      objectData: expect.objectContaining({ kind: 'Deployment', name: 'api' }),
      isActive: true,
    });
  });

  it('gives the YAML tab its scope and the denied edit permission', async () => {
    allowAllBut((query) =>
      query.resourceKind === 'Deployment' && query.verb === 'patch' ? { reason: 'forbidden' } : null
    );
    const object = await openOnly(deployment);

    await selectTab('YAML');

    expect(last(tabProps.yaml)).toMatchObject({
      scope: object.scopes.detailScope,
      canEdit: false,
      editDisabledReason: 'forbidden',
      isActive: true,
    });
  });

  it('gives the Helm manifest and values tabs the release scope', async () => {
    const release = await openOnly(identity('HelmRelease', 'my-app', 'team-a', 'helm.sh', 'v3'));

    await selectTab('Manifest');
    expect(last(tabProps.manifest)).toMatchObject({
      scope: release.scopes.helmScope,
      isActive: true,
    });
    await selectTab('Values');
    expect(last(tabProps.values)).toMatchObject({
      scope: release.scopes.helmScope,
      isActive: true,
    });
  });

  it('passes the received detail payload and deletion metadata to the Details tab', async () => {
    const deletion = {
      deletionTimestamp: '2026-08-09T12:34:56Z',
      finalizers: ['example.com/cleanup'],
    };
    await openOnly(identity('ConfigMap', 'resource'), {
      details: { data: { key: 'value' } },
      deletion,
    });

    expect(lastDetailsProps()).toMatchObject({
      detailModel: expect.objectContaining({
        activeDetail: expect.objectContaining({ details: { data: { key: 'value' } } }),
      }),
      deletion,
    });
  });

  it('derives no typed detail sections for unknown kinds', async () => {
    await openOnly(identity('UnknownKind', 'mystery', 'team-a', 'example.com'), {
      details: { value: 1 },
    });

    const model = lastDetailsProps().detailModel as Record<string, unknown>;
    expect(model.containerSection).toBeNull();
    expect(model.dataSection).toBeNull();
    expect(model.roleRules).toBeUndefined();
    expect(model.desiredScaleReplicas).toBe(0);
    expect(model.activePodNames).toBeNull();
  });
});

describe('its object’s details', () => {
  it('reads them on open and keeps them while another cluster is shown', async () => {
    const staging = app.cluster({ name: 'dev', context: 'staging' });
    app.namespaces(staging, ['default']);
    const pod = servePanel(identity('Pod', 'api'), { details: { status: 'Running' } });
    await start([dev, staging]);
    await open(pod);
    expect(detailReads(pod)).toBeGreaterThan(0);

    await view.selectCluster(staging);

    // The panel stops refreshing but keeps its read for the way back.
    expect(
      getScopedDomainState('object-details', pod.scopes.detailScope ?? '').data
    ).not.toBeNull();
  });

  it('closes the panel after the Details tab deletes its object', async () => {
    await openOnly(identity('Pod', 'api'));

    await act(async () => {
      (lastDetailsProps().onAfterDelete as () => void)();
    });
    await app.settle();

    expect(view.openPanels()).toEqual([]);
  });

  it('reads them again after the Details tab runs a mutating action', async () => {
    const object = await openOnly(deployment);
    const readsBefore = detailReads(object);

    await act(async () => {
      (lastDetailsProps().onAfterAction as () => void)();
    });
    await app.settle();

    expect(detailReads(object)).toBeGreaterThan(readsBefore);
  });
});

// The panel marks its object deleted on a NotFound only when it names this
// exact object.
describe('marks its object deleted', () => {
  const widgetRef = (cluster = dev): ErrorStatusObjectRef => ({
    clusterId: cluster.clusterId,
    group: 'example.com',
    version: 'v1',
    kind: 'Widget',
    namespace: 'team-a',
    name: 'api',
  });
  const notFound = (ref?: ErrorStatusObjectRef) =>
    makeErrorStatus('NotFound', 'widgets.example.com "api" not found', { ref });

  it('when the NotFound names this object', async () => {
    await openOnly(widget, { fail: notFound(widgetRef()) });

    expect(isMarkedDeleted()).toBe(true);
  });

  // Links may spell the kind in any case (the Pod's Node link sends `node`);
  // the backend names the canonical kind.
  it('when the NotFound names this object with its canonical kind spelling', async () => {
    const node = { clusterId: dev.clusterId, group: '', version: 'v1', name: 'worker-1' };
    await openOnly(
      { group: '', version: 'v1', kind: 'node', namespace: '', name: 'worker-1' },
      { fail: notFound({ ...node, kind: 'Node' }) }
    );

    expect(isMarkedDeleted()).toBe(true);
  });

  it.each([
    ['carries no reference', () => undefined],
    ['names the same name in another namespace', () => ({ ...widgetRef(), namespace: 'team-b' })],
    [
      'names the same kind and name in another group',
      () => ({ ...widgetRef(), group: 'other.example.com' }),
    ],
    [
      'names the same object in another cluster',
      () => ({ ...widgetRef(), clusterId: 'dev:stage' }),
    ],
    ['names an object too incomplete to identify', () => ({ ...widgetRef(), version: '' })],
  ])('not when the NotFound %s', async (_case, ref) => {
    await openOnly(widget, { fail: notFound(ref()) });

    expect(isMarkedDeleted()).toBe(false);
    app.errors.take(() => true);
  });

  it('not when the failure only says "not found" in its text', async () => {
    await openOnly(widget, {
      respond: () => new Response('Widget api not found', { status: 500 }),
    });

    expect(isMarkedDeleted()).toBe(false);
    app.errors.take(() => true);
  });

  it.each([
    { cluster: 'other', group: 'example.com', version: 'v1' },
    { cluster: 'same', group: 'another.example.com', version: 'v1' },
    { cluster: 'same', group: 'example.com', version: 'v2' },
  ] as const)(
    'does not carry the marker to a different complete identity: %j',
    async ({ cluster, group, version }) => {
      const other = app.cluster({ name: 'dev', context: 'beta' });
      app.namespaces(other, ['team-a']);
      const gone = servePanel(widget, { fail: notFound(widgetRef()) });
      const target = cluster === 'other' ? other : dev;
      const present = servePanel(
        { ...widget, group, version },
        { details: { status: 'Ready' } },
        target
      );
      await start([dev, other]);
      await open(gone);
      expect(isMarkedDeleted()).toBe(true);

      await open(present);

      expect(isMarkedDeleted()).toBe(false);
      expect(
        (lastDetailsProps().detailModel as { activeDetail?: { details?: unknown } }).activeDetail
          ?.details
      ).toEqual({ status: 'Ready' });
    }
  );
});

describe('namespace permissions', () => {
  const namespaceQueries = (cluster = dev) =>
    app.backend
      .calls('QueryPermissions')
      .flatMap(([queries]) => queries ?? [])
      .filter((query) => query.clusterId === cluster.clusterId && query.namespace);

  it('evaluates the panel’s namespace, trimmed', async () => {
    await openOnly(identity('Pod', 'api', ' team-a '));

    expect(namespaceQueries().map((query) => query.namespace)).toContain('team-a');
  });

  it('evaluates no namespace for a cluster-scoped object', async () => {
    const namespace = servePanel({
      group: '',
      version: 'v1',
      kind: 'Namespace',
      namespace: '',
      name: 'platform',
    });
    await start();
    const before = namespaceQueries().length;

    await open(namespace);

    expect(
      namespaceQueries()
        .slice(before)
        .map((query) => query.namespace)
    ).not.toContain('platform');
  });

  it('evaluates the same namespace independently in another cluster', async () => {
    const prod = app.cluster({ name: 'config', context: 'Prod' });
    const prodLower = app.cluster({ name: 'config', context: 'prod' });
    app.namespaces(prod, ['team-a']);
    app.namespaces(prodLower, ['team-a']);
    const first = servePanel(identity('Pod', 'api'), { details: {} }, prod);
    const second = servePanel(identity('Pod', 'api'), { details: {} }, prodLower);
    await start([dev, prod, prodLower]);
    await open(first);

    await open(second);

    expect(namespaceQueries(prodLower).map((query) => query.namespace)).toContain('team-a');
  });
});

describe('metrics collection', () => {
  const T0 = 1_800_000_000;
  const serveMetrics = (pod: ObjectIdentity, collectedAt = T0) =>
    app.snapshots.serve(
      'pods',
      buildRefreshScope('pods', {
        clusterId: dev.clusterId,
        selector: { kind: 'namespace', namespace: pod.namespace ?? '' },
      }),
      makePodSnapshotPayload({
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        rows: [
          makePodSnapshotEntry({
            clusterId: dev.clusterId,
            namespace: pod.namespace,
            name: pod.name,
            cpuUsageMilli: 100,
            cpuLimitMilli: 500,
          }),
        ],
        metrics: { collectedAt, stale: false, successCount: 1, failureCount: 0 },
      })
    );
  const samplesFor = (object: TestObject) =>
    app.backend
      .calls('AppendPanelMetricSample')
      .filter((args) => (args as unknown[]).includes(objectPanelId(object.ref)));

  it('collects from the moment the panel opens, on whatever tab it shows', async () => {
    const pod = identity('Pod', 'api-1');
    const object = servePanel(pod);
    serveMetrics(pod);
    await start();

    await open(object);

    expect(tabLabels()).toContain('Details');
    expect(samplesFor(object).length).toBeGreaterThan(0);
  });

  it('pauses collection while auto-refresh is paused', async () => {
    app.preferences({ autoRefreshEnabled: false });
    const pod = identity('Pod', 'api-1');
    const object = servePanel(pod);
    serveMetrics(pod);
    await start();

    await open(object);

    expect(samplesFor(object)).toEqual([]);
  });

  it('keeps collecting behind another panel of its dock group', async () => {
    const pod = identity('Pod', 'api-1');
    const behind = servePanel(pod);
    const front = servePanel(identity('Pod', 'api-2'));
    serveMetrics(pod);
    await start();
    await open(behind);
    await open(front);
    const samplesBefore = samplesFor(behind).length;

    // A new collection arrives for the namespace.
    serveMetrics(pod, T0 + 15);
    await act(async () => {
      app.streams.ring(
        'pods',
        buildRefreshScope('pods', {
          clusterId: dev.clusterId,
          selector: { kind: 'namespace', namespace: 'team-a' },
        }),
        'metric',
        '2'
      );
      // Signals apply after the stream's coalescing window.
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    await app.settle();

    expect(samplesFor(behind).length).toBeGreaterThan(samplesBefore);
  });
});
