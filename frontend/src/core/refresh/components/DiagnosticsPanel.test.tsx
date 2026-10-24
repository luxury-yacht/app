/**
 * frontend/src/core/refresh/components/DiagnosticsPanel.test.tsx
 *
 * The Diagnostics panel, opened from the native menu's toggle-diagnostics
 * event as the user opens it. It polls the backend's refresh telemetry and its
 * selection and Kubernetes API client diagnostics only while open, one cycle
 * at a time, keeps each source's last good result and reports each failure
 * once until that source recovers; its summary cards describe the visible
 * cluster; its tabs list the API clients, the stream sockets, the reads that
 * belong to no refresh domain, and the permission checks of the visible
 * cluster, namespace, and view. Runs in the full app over a faked backend
 * (test-utils/appState) with the real refresh, permission, and read-diagnostics
 * owners. The Cluster Data tree is DiagnosticsPanel.clusterData.test.tsx; the
 * row builders are diagnosticsRowModel.test.ts and clusterDataRowModel.test.ts.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeClusterConfigSnapshotPayload,
  makeTelemetrySummary,
} from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import { resourceStreamManager } from '@/core/refresh/streaming/resourceStreamManager';
import type { TelemetryStreamStatus, TelemetrySummary } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const identity = (cluster: TestCluster) => ({
  clusterId: cluster.clusterId,
  clusterName: cluster.clusterName,
});

// ---------------------------------------------------------------------------
// Backend fixtures.

const selectionDiagnostics = (overrides = {}) => ({
  activeQueueDepth: 0,
  maxQueueDepth: 0,
  sampleCount: 0,
  totalMutations: 0,
  completedMutations: 0,
  failedMutations: 0,
  canceledMutations: 0,
  supersededMutations: 0,
  ...overrides,
});

const clusterMetrics = (cluster: TestCluster, successCount: number) => ({
  clusterId: cluster.clusterId,
  metrics: {
    lastCollected: Date.now(),
    lastDurationMs: 10,
    consecutiveFailures: 0,
    successCount,
    failureCount: 0,
    active: true,
  },
});

/** Telemetry whose only metrics are `cluster`'s, at `successCount` polls. */
const telemetryWithPolls = (cluster: TestCluster, successCount: number): TelemetrySummary => ({
  ...makeTelemetrySummary(),
  clusterMetrics: [clusterMetrics(cluster, successCount)],
});

const stream = (
  cluster: TestCluster,
  overrides: Partial<TelemetryStreamStatus> = {}
): TelemetryStreamStatus => ({
  name: 'resources',
  clusterId: cluster.clusterId,
  activeSessions: 0,
  totalMessages: 0,
  droppedMessages: 0,
  skippedTargets: 0,
  errorCount: 0,
  lastConnect: Date.now(),
  lastEvent: Date.now(),
  ...overrides,
});

const telemetryReads = () =>
  app.snapshots.requests().filter((request) => request === 'GET /api/v2/telemetry/summary').length;

const diagnosticsReports = () =>
  app.errors
    .take((record) => record.context?.source === 'DiagnosticsPanel')
    .map((record) => record.context?.action);

// ---------------------------------------------------------------------------
// The panel.

const start = async () => {
  view = await app.mountApp();
};

/** The native menu's Diagnostics Panel item: opens a closed panel, closes an open one. */
const toggleDiagnostics = async () => {
  await act(async () => {
    app.events.emit('toggle-diagnostics');
  });
  await app.settle();
};

const panel = () =>
  requireValue(document.querySelector<HTMLElement>('.diagnostics-panel'), 'expected the panel');

const showTab = async (label: string) => {
  const tab = requireValue(
    Array.from(panel().querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (candidate) => candidate.textContent === label
    ),
    `expected the ${label} tab`
  );
  await act(async () => tab.click());
  await app.settle();
};

const poll = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
};

const text = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** A cell's text with its separate labels kept apart (a read's name and resource). */
const cellText = (cell: Element) => {
  const parts: string[] = [];
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    parts.push(node.textContent ?? '');
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
};

/** A diagnostics table's data rows, each as header -> cell text. */
const tableRows = (table: Element): Array<Record<string, string>> => {
  const headers = Array.from(table.querySelectorAll('thead th')).map((header, index, all) => {
    const label = text(header);
    return all.slice(0, index).some((earlier) => text(earlier) === label) ? `${label} 2` : label;
  });
  return Array.from(table.querySelectorAll('tbody tr'))
    .map((row) => Array.from(row.querySelectorAll('td')))
    .filter((cells) => cells.length === headers.length)
    .map((cells) =>
      Object.fromEntries(headers.map((header, index) => [header, cellText(cells[index])]))
    );
};

/** The table whose header row has `header` as its first column. */
const tableStartingWith = (header: string) =>
  requireValue(
    Array.from(panel().querySelectorAll('table')).find(
      (table) => text(table.querySelector('thead th')) === header
    ),
    `expected the table starting with ${header}`
  );

/** The Cluster Data summary cards, by heading. */
const cards = () =>
  Object.fromEntries(
    Array.from(panel().querySelectorAll('.diagnostics-summary-card')).map((card) => {
      const primary = card.querySelector('.diagnostics-summary-primary');
      return [
        text(card.querySelector('.diagnostics-summary-heading')),
        {
          primary: text(primary),
          secondary: text(card.querySelector('.diagnostics-summary-secondary')),
          title: primary?.getAttribute('title') ?? '',
        },
      ];
    })
  );

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
  app.startScreen(dev);
  app.backend.answer('GetSelectionDiagnostics', () => selectionDiagnostics());
  app.backend.answer('GetKubernetesAPIClientDiagnostics', () => []);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DiagnosticsPanel', () => {
  // The panel is always mounted in the layout; closed, it must cost nothing:
  // no polling and no scan of every resource stream on each render.
  it('polls and scans the streams only while open', async () => {
    vi.useFakeTimers();
    const scans = vi.spyOn(resourceStreamManager, 'getTelemetrySummary');
    try {
      await start();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(telemetryReads()).toBe(0);
      expect(app.backend.calls('GetSelectionDiagnostics')).toEqual([]);
      expect(app.backend.calls('GetKubernetesAPIClientDiagnostics')).toEqual([]);
      expect(scans).not.toHaveBeenCalled();

      await toggleDiagnostics();

      expect(telemetryReads()).toBe(1);
      expect(app.backend.calls('GetSelectionDiagnostics')).toHaveLength(1);
      expect(app.backend.calls('GetKubernetesAPIClientDiagnostics')).toHaveLength(1);
      expect(scans).toHaveBeenCalled();

      await toggleDiagnostics();
      scans.mockClear();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(telemetryReads()).toBe(1);
      expect(scans).not.toHaveBeenCalled();
    } finally {
      scans.mockRestore();
    }
  });

  it('keeps one diagnostics cycle in flight so a slow read cannot overtake a newer one', async () => {
    vi.useFakeTimers();
    const releaseSelection = app.backend.hold('GetSelectionDiagnostics');
    await start();
    await toggleDiagnostics();
    await showTab('Cluster Data');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(telemetryReads()).toBe(1);
    expect(app.backend.calls('GetSelectionDiagnostics')).toHaveLength(1);

    app.snapshots.telemetry(telemetryWithPolls(dev, 23));
    await act(async () => releaseSelection());
    await poll();

    expect(telemetryReads()).toBe(2);
    expect(cards().Metrics.secondary).toContain('23 polls');
  });

  it('keeps each source’s last result and reports its failure once, until that source recovers', async () => {
    vi.useFakeTimers();
    app.snapshots.telemetry(telemetryWithPolls(dev, 17));
    await start();
    await toggleDiagnostics();
    await showTab('Cluster Data');
    expect(cards().Metrics.secondary).toContain('17 polls');
    const failEverySource = () => {
      app.snapshots.failTelemetry();
      app.backend.answer('GetSelectionDiagnostics', () => {
        throw new Error('selection diagnostics unavailable');
      });
      app.backend.answer('GetKubernetesAPIClientDiagnostics', () => {
        throw new Error('API client diagnostics unavailable');
      });
    };

    failEverySource();
    await poll();

    expect(diagnosticsReports().sort()).toEqual([
      'loadKubernetesAPIDiagnostics',
      'loadSelectionDiagnostics',
      'loadTelemetryDiagnostics',
    ]);
    expect(cards().Metrics.secondary).toContain('17 polls');

    await poll();
    expect(diagnosticsReports()).toEqual([]);

    // Recovery is per source: telemetry reports its next failure while the
    // two sources that never recovered stay reported once.
    app.snapshots.telemetry(telemetryWithPolls(dev, 18));
    await poll();
    expect(cards().Metrics.secondary).toContain('18 polls');
    failEverySource();
    await poll();

    expect(diagnosticsReports()).toEqual(['loadTelemetryDiagnostics']);
  });

  it('shows telemetry as unavailable when it has never loaded', async () => {
    app.snapshots.failTelemetry();
    await start();

    await toggleDiagnostics();
    await showTab('Cluster Data');

    expect(diagnosticsReports()).toEqual(['loadTelemetryDiagnostics']);
    expect(cards().Metrics.primary).toBe('Unavailable');
    expect(cards().Events.primary).toBe('—');
  });

  it('drops a diagnostics failure that settles after the panel closes', async () => {
    vi.useFakeTimers();
    app.backend.answer('GetSelectionDiagnostics', () => {
      throw new Error('late failure');
    });
    const releaseSelection = app.backend.hold('GetSelectionDiagnostics');
    await start();
    await toggleDiagnostics();
    // Later calls succeed; only the held one fails.
    app.backend.answer('GetSelectionDiagnostics', () => selectionDiagnostics());

    await toggleDiagnostics();
    await act(async () => releaseSelection());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(app.errors.records()).toEqual([]);
    expect(telemetryReads()).toBe(1);

    await toggleDiagnostics();

    expect(telemetryReads()).toBe(2);
  });

  // Every card describes the visible cluster only, whatever other clusters
  // are open, and follows a cluster switch.
  it('summarizes the visible cluster’s refresh activity in the cards', async () => {
    const prod = app.cluster({ name: 'prod', context: 'beta' });
    app.namespaces(prod, ['team-z']);
    app.startScreen(prod);
    app.backend.answer('GetSelectionDiagnostics', () =>
      selectionDiagnostics({
        activeQueueDepth: 1,
        sampleCount: 4,
        totalMutations: 5,
        failedMutations: 1,
        queueP95Ms: 42,
      })
    );
    app.snapshots.telemetry({
      ...makeTelemetrySummary({
        streams: [
          stream(dev, { activeSessions: 1, totalMessages: 15 }),
          // Event-table doorbells are deliveries on the resources socket's
          // cluster-events domain, never on the socket itself.
          stream(dev, { leafKind: 'domain', leaf: 'cluster-events', totalMessages: 12 }),
          stream(dev, {
            leafKind: 'domain',
            leaf: 'catalog',
            totalMessages: 20,
            errorCount: 1,
            lastError: 'Catalog subscription disconnected',
          }),
          stream(dev, { name: 'container-logs', activeSessions: 1, skippedTargets: 5 }),
          // Container logs count deliveries per log target.
          stream(dev, {
            name: 'container-logs',
            leafKind: 'target',
            leaf: 'team-a/web',
            totalMessages: 4,
          }),
          stream(dev, {
            name: 'container-logs',
            leafKind: 'target',
            leaf: 'team-a/api',
            totalMessages: 5,
          }),
          stream(prod, { activeSessions: 1 }),
          stream(prod, { leafKind: 'domain', leaf: 'cluster-events', totalMessages: 600 }),
          stream(prod, {
            name: 'container-logs',
            leafKind: 'target',
            leaf: 'team-z/db',
            totalMessages: 40,
          }),
        ],
      }),
      clusterMetrics: [clusterMetrics(dev, 7), clusterMetrics(prod, 3)],
    });
    // A read the orchestrator has in flight until the test releases it.
    const configScope = buildClusterRefreshScope('cluster-config', dev.clusterId);
    app.snapshots.serve(
      'cluster-config',
      configScope,
      makeClusterConfigSnapshotPayload(identity(dev))
    );
    let releaseConfig: () => void = () => undefined;
    app.snapshots.respond(({ domain }) =>
      domain === 'cluster-config'
        ? new Promise<undefined>((resolve) => {
            releaseConfig = () => resolve(undefined);
          })
        : undefined
    );
    const logsOf = (cluster: TestCluster, namespace: string, name: string) =>
      requireValue(
        app.object(cluster, { group: 'apps', version: 'v1', kind: 'Deployment', namespace, name })
          .scopes.containerLogsScope,
        `expected ${name}’s logs scope`
      );
    await start();
    await view.lease(
      { domain: 'cluster-config', scope: configScope },
      { domain: 'container-logs', scope: logsOf(dev, 'team-a', 'web') },
      { domain: 'container-logs', scope: logsOf(dev, 'team-a', 'api') },
      { domain: 'container-logs', scope: logsOf(prod, 'team-z', 'db') }
    );

    await toggleDiagnostics();
    await showTab('Cluster Data');

    const visible = cards();
    expect(visible.Orchestrator).toMatchObject({
      primary: '1 pending',
      secondary: 'Queue 1 · p95 42 ms',
    });
    expect(visible.Orchestrator.title).toContain('Failed 1');
    expect(visible.Metrics.primary).toBe('OK');
    expect(visible.Metrics.secondary).toContain('7 polls');
    expect(visible.Events.primary).toBe('12 delivered');
    expect(visible['Catalog Stream'].primary).toBe('20 batches');
    expect(visible['Catalog Stream'].title).toContain('Catalog subscription disconnected');
    expect(visible.Logs.primary).toBe('9 delivered');
    // Only this cluster's Logs tabs count; every figure the headline drops
    // stays in its tooltip.
    expect(visible.Logs.title).toContain('Scopes: 2');
    expect(visible.Logs.title).toContain('Skipped Targets: 5');

    await act(async () => releaseConfig());
    await app.settle();
    expect(cards().Orchestrator.primary).toBe('0 pending');

    await view.selectCluster(prod);

    const switched = cards();
    expect(switched.Metrics.secondary).toContain('3 polls');
    expect(switched.Events.primary).toBe('600 delivered');
    expect(switched['Catalog Stream'].primary).not.toContain('20 batches');
    expect(switched.Logs.primary).toBe('40 delivered');
    expect(switched.Logs.title).toContain('Scopes: 1');
  });

  it('lists each cluster’s Kubernetes API client on the K8s API tab', async () => {
    app.backend.answer('GetKubernetesAPIClientDiagnostics', () => [
      {
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        configuredQPS: 500,
        configuredBurst: 1000,
        qps1s: 12,
        qps10s: 7,
        qps60s: 3,
        peakQPS1s: 44,
        totalRequests: 1200,
        status2xx: 1150,
        status3xx: 10,
        status4xx: 4,
        status5xx: 2,
        status429: 1,
        errors: 3,
        lastRequestMs: Date.now(),
      },
    ]);
    await start();

    // K8s API is the tab the panel opens on.
    await toggleDiagnostics();

    expect(tableRows(tableStartingWith('Cluster'))).toEqual([
      expect.objectContaining({
        Cluster: dev.clusterName,
        'QPS / Burst': '500 / 1000',
        'Peak 1s': '44',
        Requests: '1200',
        '429s': '1',
        '5xx': '2',
        Errors: '3',
      }),
    ]);
  });

  // Connections lists the transport: each socket with its errors, and each log
  // target. A domain's deliveries belong to its row in the Cluster Data tree.
  it('lists each stream socket with its errors, and each log target, on the Connections tab', async () => {
    app.snapshots.telemetry(
      makeTelemetrySummary({
        streams: [
          stream(dev, {
            activeSessions: 1,
            totalMessages: 5,
            errorCount: 1,
            lastError: 'Resource stream disconnected',
          }),
          stream(dev, { leafKind: 'domain', leaf: 'catalog', totalMessages: 3 }),
          stream(dev, { name: 'container-logs', activeSessions: 2 }),
          stream(dev, {
            name: 'container-logs',
            leafKind: 'target',
            leaf: 'team-a/web',
            totalMessages: 4,
          }),
        ],
      })
    );
    await start();
    await toggleDiagnostics();

    await showTab('Connections');

    expect(
      tableRows(tableStartingWith('Connection'))
        .map(
          (row) =>
            `${row.Connection} | ${row.Cluster} | ${row.Sessions} | ${row.Delivered} | ${row.Errors} | ${row['Last Error']}`
        )
        .sort()
    ).toEqual(
      [
        `Resources · socket | ${dev.clusterName} | 1 | 5 | 1 | Resource stream disconnected`,
        `Container Logs · socket | ${dev.clusterName} | 2 | 0 | 0 | -`,
        `team-a/web · log target | ${dev.clusterName} | - | 4 | 0 | -`,
      ].sort()
    );
  });

  // A refresh-domain read is counted on its domain's row; the Connections tab
  // lists only the reads with no refresh domain, and can narrow them to the
  // ones in flight, blocked, or failing.
  it('lists the reads that belong to no refresh domain and narrows them to issues', async () => {
    const releaseAppInfo = app.backend.hold('GetAppInfo');
    await start();
    await toggleDiagnostics();
    await showTab('Connections');
    const reads = () =>
      tableRows(tableStartingWith('Broker')).map((row) => ({
        read: row.Read,
        adapter: row.Adapter,
        result: row['Last Result'],
      }));

    expect(reads()).toEqual(
      expect.arrayContaining([
        { read: 'App Info app-info', adapter: 'rpc-read', result: 'In Flight' },
        {
          read: 'Query Permissions query-permissions',
          adapter: 'permission-read',
          result: 'Success',
        },
      ])
    );
    expect(reads().map((read) => read.adapter)).not.toContain('refresh-domain');

    const issuesOnly = requireValue(
      Array.from(panel().querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => text(button) === 'Issues Only'
      ),
      'expected the Issues Only toggle'
    );
    await act(async () => issuesOnly.click());

    expect(reads()).toEqual([
      { read: 'App Info app-info', adapter: 'rpc-read', result: 'In Flight' },
    ]);

    await showTab('Cluster Data');
    const namespacesRow = requireValue(
      Array.from(panel().querySelectorAll<HTMLTableRowElement>('.diagnostics-scope-row')).find(
        (row) => text(row.querySelector('.diagnostics-domain')) === 'Namespaces'
      ),
      'expected the Namespaces row'
    );
    await act(async () =>
      namespacesRow.querySelector<HTMLButtonElement>('.diagnostics-row-expander')?.click()
    );
    const requests = Array.from(
      namespacesRow.nextElementSibling?.querySelectorAll('.diagnostics-detail-item') ?? []
    ).find((item) => text(item.querySelector('dt')) === 'Requests');
    expect(Number(text(requests?.querySelector('dd')))).toBeGreaterThan(0);

    await act(async () => releaseAppInfo());
    await app.settle();
  });

  // Permissions shows what the visible view checks, in the selected namespace
  // and cluster, with the cluster's answer.
  it('lists the permissions the visible view checks, with their answers', async () => {
    app.serveTable(dev, 'namespace-workloads');
    app.serveTable(dev, 'namespace-config');
    app.denyPermissions([{ verb: 'delete', resourceKind: 'Deployment', namespace: 'team-a' }]);
    await start();
    await view.goTo({ namespace: 'team-a', view: 'workloads' });
    await toggleDiagnostics();
    await showTab('Permissions');
    const permissions = () =>
      tableRows(tableStartingWith('Scope')).map(
        (row) => `${row.Scope} | ${row.Descriptor} | ${row.Allowed}`
      );

    expect(permissions()).toEqual(
      expect.arrayContaining([
        'team-a | Deployment (delete) | False',
        'team-a | Deployment (list) | True',
      ])
    );
    expect(permissions().every((permission) => permission.startsWith('team-a | '))).toBe(true);

    await view.goTo({ namespace: 'team-a', view: 'config' });

    expect(permissions()).toEqual(expect.arrayContaining(['team-a | ConfigMap (delete) | True']));
    expect(permissions()).not.toContain('team-a | Deployment (delete) | False');
  });

  // Cap Checks keeps the cluster-wide batch and the selected namespace's batch
  // current with each batch's result, moves other namespaces to Previous, and
  // shows only the visible cluster's batches.
  it('keeps the visible cluster’s cluster and selected-namespace checks current', async () => {
    const prod = app.cluster({ name: 'prod', context: 'beta' });
    app.namespaces(prod, ['team-z']);
    app.startScreen(prod);
    app.serveTable(dev, 'namespace-workloads');
    // The cluster cannot evaluate team-b's checks; every other check is allowed.
    const inactive = `cluster dependency resolution failed: cluster ${dev.clusterId} not active`;
    app.permissions((query) => (query.namespace === 'team-b' ? { error: inactive } : true));
    await start();
    await view.goTo({ namespace: 'team-a', view: 'workloads' });
    await view.goTo({ namespace: 'team-b', view: 'workloads' });
    await toggleDiagnostics();
    await showTab('Cap Checks');
    const checks = () => {
      const table = tableStartingWith('Scope');
      const headers = Array.from(table.querySelectorAll('thead th')).map(text);
      const sections: Record<string, string[]> = {};
      let section = '';
      table.querySelectorAll('tbody tr').forEach((row) => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (row.classList.contains('diagnostics-table-section-header')) {
          section = text(row);
          sections[section] = [];
        } else if (cells.length === headers.length) {
          const cell = (header: string) => text(cells[headers.indexOf(header)]);
          sections[section]?.push(`${cell('Scope')} | ${cell('Result')} | ${cell('Error')}`);
        }
      });
      return sections;
    };

    expect(checks()).toEqual({
      'Current Checks': ['Cluster | Success | -', `team-b | Error | ${inactive}`],
      'Previous Checks': ['team-a | Success | -'],
    });

    // A batch's row expands to the checks it ran.
    const teamA = requireValue(
      Array.from(tableStartingWith('Scope').querySelectorAll<HTMLTableRowElement>('tbody tr')).find(
        (row) => text(row.querySelector('td')) === 'team-a'
      ),
      'expected the team-a batch'
    );
    const ranChecks = () => text(teamA.querySelector('td:last-child'));
    expect(ranChecks()).not.toContain('Deployment');
    await act(async () => teamA.click());
    expect(ranChecks()).toContain('Deployment');

    await view.selectCluster(prod);

    expect(checks()).toEqual({ 'Current Checks': ['Cluster | Success | -'] });
  });

  it('does not take Tab from a control outside the panel', async () => {
    await start();
    await toggleDiagnostics();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      outside.focus();

      await act(async () => {
        outside.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
        );
      });

      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });
});
