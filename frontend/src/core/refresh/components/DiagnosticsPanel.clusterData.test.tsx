/**
 * frontend/src/core/refresh/components/DiagnosticsPanel.clusterData.test.tsx
 *
 * The Diagnostics panel's Cluster Data tab lists every refresh scope the app
 * holds, grouped under its cluster: whether the cluster is the visible one,
 * the scope's count, its joined metrics freshness, the backend's snapshot
 * telemetry for that exact scope, its stream health and fallback polls, and
 * only the table scopes still in use. Runs in the full app over a faked
 * backend (test-utils/appState) with the real refresh orchestrator, store, and
 * streams; the panel opens from the native menu's toggle-diagnostics event.
 * Scopes come from real views, or from a probe that leases them through the
 * production lifecycle hook as a view or object panel does. The test
 * acknowledges streams itself so stream health can be driven. The row model's
 * own shaping (tree, badges, feed text) is covered by clusterDataRowModel.test.ts.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeCatalogSnapshotPayload,
  makeClusterConfigSnapshotPayload,
  makeClusterNodeSnapshotPayload,
  makeClusterOverviewSnapshotPayload,
  makeNamespaceWorkloadSnapshotPayload,
  makePodSnapshotPayload,
  makeTelemetrySummary,
} from '@/core/refresh/refreshContractTestBuilders';
import {
  buildClusterRefreshScope,
  buildRefreshScope,
  CLUSTER_SELECTOR,
} from '@/core/refresh/scopeSelector';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness({ streams: 'manual' });
let dev: TestCluster;
let view: MountedApp;

const identity = (cluster: TestCluster) => ({
  clusterId: cluster.clusterId,
  clusterName: cluster.clusterName,
});
const teamA = { kind: 'namespace', namespace: 'team-a' } as const;

// ---------------------------------------------------------------------------
// The panel.

const start = async () => {
  view = await app.mountApp();
};

const panel = () =>
  requireValue(document.querySelector<HTMLElement>('.diagnostics-panel'), 'expected the panel');

/** Opens the panel from the native menu, then its Cluster Data tab. */
const openClusterData = async () => {
  await act(async () => {
    app.events.emit('toggle-diagnostics');
  });
  await app.settle();
  const tab = requireValue(
    Array.from(panel().querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (candidate) => candidate.textContent === 'Cluster Data'
    ),
    'expected the Cluster Data tab'
  );
  await act(async () => tab.click());
  await app.settle();
};

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

interface ScopeRow {
  cluster: string;
  domain: string;
  /** The raw refresh scope (the Scope cell's tooltip). */
  key: string;
  scope: string;
  health: string;
  healthTooltip: string;
  count: string;
  countTooltip: string;
  activity: string;
  error: string;
  element: HTMLTableRowElement;
}

// Walks the tree as a reader does: a cluster row names the cluster for the
// rows under it, and a domain group row names the domain of its unlabelled
// scope rows.
const scopeRows = (): ScopeRow[] => {
  const table = requireValue(
    panel().querySelector<HTMLTableElement>('.diagnostics-table--cluster-data'),
    'expected the Cluster Data table'
  );
  const columns = Array.from(table.querySelectorAll('thead th')).map(text);
  const cell = (row: Element, column: string) =>
    row.querySelectorAll('td')[columns.indexOf(column)];
  const rows: ScopeRow[] = [];
  let cluster = '';
  let group = '';
  table.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
    if (row.classList.contains('diagnostics-cluster-row')) {
      cluster = text(row.querySelector('.diagnostics-cluster-label'));
      group = '';
      return;
    }
    if (row.classList.contains('diagnostics-domain-row')) {
      group = text(row.querySelector('.diagnostics-domain'));
      return;
    }
    if (!row.classList.contains('diagnostics-scope-row')) {
      return;
    }
    rows.push({
      cluster,
      domain: text(row.querySelector('.diagnostics-domain')) || group,
      key: cell(row, 'Scope')?.getAttribute('title') ?? '',
      scope: text(cell(row, 'Scope')),
      health: text(cell(row, 'Health')),
      healthTooltip: cell(row, 'Health')?.getAttribute('title') ?? '',
      count: text(cell(row, 'Count')),
      countTooltip: cell(row, 'Count')?.getAttribute('title') ?? '',
      activity: text(cell(row, 'Activity')),
      error: text(cell(row, 'Error')),
      element: row,
    });
  });
  return rows;
};

const rowOf = (domain: string, key?: string) =>
  requireValue(
    scopeRows().find((row) => row.domain === domain && (key === undefined || row.key === key)),
    `expected a ${domain} row${key ? ` for ${key}` : ''}`
  );

/** The fields the row's expander shows, as label -> value. */
const detailsOf = async (row: ScopeRow): Promise<Record<string, string>> => {
  const expander = requireValue(
    row.element.querySelector<HTMLButtonElement>('.diagnostics-row-expander'),
    `expected the ${row.domain} row's expander`
  );
  if (expander.getAttribute('aria-expanded') !== 'true') {
    await act(async () => expander.click());
  }
  return Object.fromEntries(
    Array.from(
      row.element.nextElementSibling?.querySelectorAll('.diagnostics-detail-item') ?? []
    ).map((item) => [text(item.querySelector('dt')), text(item.querySelector('dd'))])
  );
};

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
  app.startScreen(dev);
  app.backend.answer('GetSelectionDiagnostics', () => ({
    activeQueueDepth: 0,
    maxQueueDepth: 0,
    sampleCount: 0,
    totalMutations: 0,
    completedMutations: 0,
    failedMutations: 0,
    canceledMutations: 0,
    supersededMutations: 0,
  }));
  app.backend.answer('GetKubernetesAPIClientDiagnostics', () => []);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DiagnosticsPanel Cluster Data', () => {
  // Usage is joined onto the base payloads at serve, so each base row reports
  // the poller freshness its own payload carries; pod rows point at the join.
  it('reports each base domain’s joined metrics freshness on its own row', async () => {
    const nodesScope = buildClusterRefreshScope('nodes', dev.clusterId);
    const workloadsScope = buildRefreshScope('namespace-workloads', {
      clusterId: dev.clusterId,
      selector: teamA,
    });
    const podsScope = buildRefreshScope('pods', { clusterId: dev.clusterId, selector: teamA });
    app.snapshots.serve(
      'cluster-overview',
      buildClusterRefreshScope('cluster-overview', dev.clusterId),
      makeClusterOverviewSnapshotPayload({
        ...identity(dev),
        metrics: { stale: false, successCount: 5, failureCount: 0 },
      })
    );
    app.snapshots.serve(
      'nodes',
      nodesScope,
      makeClusterNodeSnapshotPayload({
        ...identity(dev),
        metrics: { stale: true, successCount: 1, failureCount: 2, consecutiveFailures: 2 },
      })
    );
    app.snapshots.serve(
      'namespace-workloads',
      workloadsScope,
      makeNamespaceWorkloadSnapshotPayload({
        ...identity(dev),
        metrics: {
          stale: false,
          successCount: 2,
          failureCount: 1,
          lastError: 'metrics-server timed out',
        },
      })
    );
    app.snapshots.serve('pods', podsScope, makePodSnapshotPayload(identity(dev)));
    await start();
    await view.lease(
      { domain: 'nodes', scope: nodesScope },
      { domain: 'namespace-workloads', scope: workloadsScope },
      { domain: 'pods', scope: podsScope }
    );

    await openClusterData();

    expect((await detailsOf(rowOf('Cluster Overview'))).Metrics).toBe('OK (5 polls)');
    expect((await detailsOf(rowOf('Nodes'))).Metrics).toBe('Unavailable (2 fails)');
    expect((await detailsOf(rowOf('Workloads'))).Metrics).toBe('Error (1 fails)');
    expect((await detailsOf(rowOf('ObjPanel - Pods - team-a'))).Metrics).toBe('N/A');
    // A cluster-wide scope names its cluster; a namespace scope names only the
    // namespace, under its cluster's group.
    expect(rowOf('Nodes')).toMatchObject({
      cluster: dev.clusterName,
      scope: `${dev.clusterName} (active)`,
    });
    expect(rowOf('Workloads')).toMatchObject({
      cluster: dev.clusterName,
      scope: 'namespace:team-a',
    });
  });

  // A stuck Helm Values tab must be traceable to its release and namespace.
  it('names a Helm release panel’s row by its release and namespace', async () => {
    const release = app.object(dev, {
      group: 'helm.sh',
      version: 'v3',
      kind: 'HelmRelease',
      namespace: 'team-a',
      name: 'web-release',
    });
    const scope = requireValue(release.scopes.helmScope, 'expected the release’s Helm scope');
    app.snapshots.serve('object-helm-values', scope, {
      ...identity(dev),
      defaults: {},
      merged: {},
      overrides: {},
      subchartPaths: [],
    });
    await start();
    // Object-panel tabs read their scope when they enable it (ValuesTab.tsx).
    await view.lease({ domain: 'object-helm-values', scope, fetchOnEnable: 'startup' });

    await openClusterData();

    expect((await detailsOf(rowOf('ObjPanel - Values - web-release'))).Namespace).toBe('team-a');
  });

  // Every open cluster's scopes stay listed under that cluster; only the
  // visible cluster's are marked active, and the mark follows a cluster switch.
  it('lists every open cluster’s scopes under it and marks only the visible cluster active', async () => {
    const prod = app.cluster({ name: 'prod', context: 'beta' });
    app.namespaces(prod, ['team-z']);
    app.startScreen(prod);
    // Node counts tell the two clusters' overview rows apart.
    for (const [cluster, totalNodes] of [
      [dev, 4],
      [prod, 6],
    ] as const) {
      const overview = makeClusterOverviewSnapshotPayload(identity(cluster));
      app.snapshots.serve(
        'cluster-overview',
        buildClusterRefreshScope('cluster-overview', cluster.clusterId),
        { ...overview, overview: { ...overview.overview, totalNodes } }
      );
    }
    const configScope = buildClusterRefreshScope('cluster-config', dev.clusterId);
    app.snapshots.serve(
      'cluster-config',
      configScope,
      makeClusterConfigSnapshotPayload(identity(dev))
    );
    await start();
    await view.lease({ domain: 'cluster-config', scope: configScope });
    await openClusterData();
    const listed = () =>
      scopeRows()
        .filter((row) => ['Cluster Config', 'Cluster Overview', 'Namespaces'].includes(row.domain))
        .map((row) => `${row.cluster} | ${row.domain} | ${row.scope} | ${row.count}`)
        .sort();

    expect(listed()).toEqual(
      [
        `${dev.clusterName} | Cluster Config | ${dev.clusterName} (active) | 0`,
        `${dev.clusterName} | Cluster Overview | ${dev.clusterName} (active) | 4`,
        `${dev.clusterName} | Namespaces | ${dev.clusterName} (active) | 2`,
        `${prod.clusterName} | Namespaces | ${prod.clusterName} | 1`,
      ].sort()
    );

    await view.selectCluster(prod);

    // dev's Cluster Config stays listed although the visible cluster has none.
    expect(listed()).toEqual(
      [
        `${dev.clusterName} | Cluster Config | ${dev.clusterName} | 0`,
        `${dev.clusterName} | Cluster Overview | ${dev.clusterName} | 4`,
        `${dev.clusterName} | Namespaces | ${dev.clusterName} | 2`,
        `${prod.clusterName} | Cluster Overview | ${prod.clusterName} (active) | 6`,
        `${prod.clusterName} | Namespaces | ${prod.clusterName} (active) | 1`,
      ].sort()
    );
  });

  // The backend reports telemetry per (domain, cluster, scope); Browse's live
  // catalog scope and its metadata query share a domain, so each row must
  // carry its own scope's figures.
  it('joins the backend’s snapshot telemetry onto the row of exactly that scope', async () => {
    app.snapshots.answer(({ domain, scope }) =>
      domain === 'catalog' && scope.includes('resourceScope=')
        ? makeCatalogSnapshotPayload(identity(dev))
        : undefined
    );
    await start();
    await view.goTo({ clusterView: 'browse' });
    const browseScopes = [
      ...new Set(
        app.snapshots
          .reads('catalog')
          .map((read) => read.scope)
          .filter((scope) => scope.includes('resourceScope='))
      ),
    ];
    const metadataScope = requireValue(
      browseScopes.find((scope) => scope.startsWith(`${dev.clusterId}|limit=1&`)),
      'expected Browse’s metadata query'
    );
    const liveScope = buildClusterRefreshScope('catalog', dev.clusterId);
    const namespacesScope = buildClusterRefreshScope('namespaces', dev.clusterId);
    app.snapshots.telemetry(
      makeTelemetrySummary({
        snapshots: [
          {
            domain: 'catalog',
            clusterId: dev.clusterId,
            scope: liveScope,
            lastStatus: 'error',
            lastError: 'catalog read failed',
            lastDurationMs: 10,
            lastUpdated: Date.now(),
            successCount: 2,
            failureCount: 1,
          },
          {
            domain: 'catalog',
            clusterId: dev.clusterId,
            scope: metadataScope,
            lastStatus: 'success',
            lastDurationMs: 20,
            lastUpdated: Date.now(),
            successCount: 7,
            failureCount: 0,
          },
          {
            domain: 'namespaces',
            clusterId: dev.clusterId,
            scope: namespacesScope,
            lastStatus: 'success',
            lastDurationMs: 12,
            lastUpdated: Date.now(),
            successCount: 1,
            failureCount: 0,
            // The cold-start build blocked 1500 ms on the initial-LIST gate.
            maxSyncWaitMs: 1500,
          },
        ],
      })
    );

    await openClusterData();

    const live = rowOf('Browse Catalog', liveScope);
    const metadata = rowOf('Browse Catalog', metadataScope);
    expect(live.activity).toBe('2✓ 1✗ 10 ms');
    expect(live.error).toContain('catalog read failed');
    expect(metadata.activity).toBe('7✓ 0✗ 20 ms');
    expect(metadata.error).not.toContain('catalog read failed');
    expect((await detailsOf(live)).Role).toBe('Live Scope');
    expect((await detailsOf(metadata)).Role).toBe('Metadata');
    expect((await detailsOf(rowOf('Namespaces', namespacesScope)))['Sync wait']).toBe('1500 ms');
  });

  // A query-backed table never reads its live scope's snapshot, so that scope
  // stays idle while its stream serves the table; it is in use and listed.
  // The table's page queries are transient and never listed, and once the
  // user leaves, the idle scope with no stream is no longer in use.
  it('lists a table’s live scope while its stream serves it, never its page queries', async () => {
    vi.useFakeTimers();
    app.serveTable(dev, 'nodes');
    app.serveTable(dev, 'pods');
    // The Nodes view also reads node drains (ClusterViewNodes).
    app.snapshots.serve(
      'object-maintenance',
      buildClusterRefreshScope('object-maintenance', dev.clusterId),
      { ...identity(dev), drains: [] }
    );
    let releasePage: () => void = () => undefined;
    app.snapshots.respond(({ domain, scope }) =>
      domain === 'nodes' && scope.includes('?')
        ? new Promise<undefined>((resolve) => {
            releasePage = () => resolve(undefined);
          })
        : undefined
    );
    const nodesScope = buildClusterRefreshScope('nodes', dev.clusterId);
    await start();
    await openClusterData();

    await view.goTo({ clusterView: 'nodes' });

    expect(
      app.snapshots.reads('nodes').some((read) => read.scope.startsWith(`${nodesScope}?`))
    ).toBe(true);
    expect(
      scopeRows()
        .filter((row) => row.domain === 'Nodes')
        .map((row) => row.key)
    ).toEqual([nodesScope]);
    expect((await detailsOf(rowOf('Nodes'))).Role).toBe('Live Scope');

    await act(async () => releasePage());
    await view.goTo({ namespace: 'team-a', view: 'pods' });
    expect(scopeRows().map((row) => row.domain)).toContain('ObjPanel - Pods - team-a');

    await view.goTo({ clusterView: 'overview' });
    // A released stream closes after the unsubscribe debounce (resourceStreamManager.ts).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    const domains = scopeRows().map((row) => row.domain);
    expect(domains).not.toContain('Nodes');
    expect(domains).not.toContain('ObjPanel - Pods - team-a');
  });

  // The catalog's count is the objects it retains, and the kinds it cannot
  // watch are flagged on that count.
  it('shows the catalog’s retained object count with its watch warnings', async () => {
    const warning = 'widgets.example.com (namespace list-only)';
    const metadataScope = buildRefreshScope('catalog', {
      clusterId: dev.clusterId,
      selector: CLUSTER_SELECTOR,
      query: 'limit=1',
    });
    app.snapshots.respond(({ domain, scope }) =>
      domain === 'catalog' && scope === metadataScope
        ? new Response(
            JSON.stringify({
              domain,
              scope,
              version: 1,
              checksum: 'catalog-1',
              generatedAt: Date.now(),
              sequence: 1,
              payload: makeCatalogSnapshotPayload({ ...identity(dev), total: 42 }),
              stats: { itemCount: 0, buildDurationMs: 1, totalItems: 42, warnings: [warning] },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        : undefined
    );
    await start();

    await openClusterData();

    expect(rowOf('Browse Catalog', metadataScope)).toMatchObject({
      count: '42',
      countTooltip: warning,
    });
  });

  // A scope whose stream has not synchronized is not an error: its Health
  // reads degraded, its polls run as the stream's fallback and are counted,
  // and it reads healthy once the stream synchronizes.
  it('shows a stream that is not delivering on its row and counts the polls it falls back to', async () => {
    vi.useFakeTimers();
    const configScope = buildClusterRefreshScope('cluster-config', dev.clusterId);
    app.snapshots.serve(
      'cluster-config',
      configScope,
      makeClusterConfigSnapshotPayload(identity(dev))
    );
    await start();
    await view.lease({ domain: 'cluster-config', scope: configScope });
    await openClusterData();

    expect(rowOf('Cluster Config')).toMatchObject({ health: 'degraded', error: '-' });
    expect(rowOf('Cluster Config').healthTooltip).toContain('awaiting updates');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    const fallbackPolls = app.snapshots.reads('cluster-config').length - 1;
    expect(fallbackPolls).toBeGreaterThan(0);
    expect(await detailsOf(rowOf('Cluster Config'))).toMatchObject({
      Mode: 'polling (fallback)',
      Fallbacks: String(fallbackPolls),
    });

    await act(async () => {
      app.streams.acknowledge('cluster-config', configScope);
    });
    await app.settle();

    expect(rowOf('Cluster Config').health).toBe('healthy');
  });

  // Each cluster has its own container-logs socket; one cluster's socket
  // failure must not mark another cluster's Logs tab.
  it('keeps each cluster’s container-log socket health on that cluster’s Logs rows', async () => {
    const prod = app.cluster({ name: 'prod', context: 'beta' });
    app.namespaces(prod, ['team-z']);
    const logsOf = (cluster: TestCluster, namespace: string, name: string) =>
      requireValue(
        app.object(cluster, { group: 'apps', version: 'v1', kind: 'Deployment', namespace, name })
          .scopes.containerLogsScope,
        `expected ${name}’s logs scope`
      );
    const socket = {
      name: 'container-logs',
      activeSessions: 1,
      droppedMessages: 0,
      skippedTargets: 0,
      lastConnect: Date.now(),
      lastEvent: Date.now(),
    };
    app.snapshots.telemetry(
      makeTelemetrySummary({
        streams: [
          {
            ...socket,
            clusterId: prod.clusterId,
            totalMessages: 1,
            errorCount: 1,
            lastError: 'prod socket failed',
          },
          { ...socket, clusterId: dev.clusterId, totalMessages: 5, errorCount: 0 },
        ],
      })
    );
    await start();
    await view.lease(
      { domain: 'container-logs', scope: logsOf(dev, 'team-a', 'web') },
      { domain: 'container-logs', scope: logsOf(prod, 'team-z', 'api') }
    );

    await openClusterData();

    expect(rowOf('ObjPanel - Logs - web')).toMatchObject({
      cluster: dev.clusterName,
      health: 'healthy',
    });
    expect(rowOf('ObjPanel - Logs - api')).toMatchObject({
      cluster: prod.clusterName,
      health: 'unhealthy',
    });
  });
});
