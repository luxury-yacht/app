/**
 * frontend/src/core/refresh/components/diagnostics/diagnosticsRowModel.test.ts
 *
 * Verifies diagnostics row-model builders without rendering DiagnosticsPanel.
 * These tests keep stream telemetry row semantics local to the row model module.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { getPermissionKey, PERMISSION_FEATURES } from '@/core/capabilities';
import type { PermissionQueryDiagnostics, PermissionStatus } from '@/core/capabilities';
import type { TelemetrySummary } from '../../types';
import type { DiagnosticsRow, DiagnosticsStreamRow } from './diagnosticsPanelTypes';
import {
  buildCapabilityBatchRows,
  dedupeDiagnosticsRows,
  buildDiagnosticsStreamRows,
  buildDiagnosticsStreamSummary,
  buildBrokerReadRows,
  buildBrokerReadsSummary,
  buildKubernetesAPIClientRows,
  buildKubernetesAPISummary,
  buildPermissionRows,
  buildContainerLogsSummary,
  buildEventStreamSummary,
  buildMetricsSummary,
  buildOrchestratorSummary,
} from './diagnosticsRowModel';

const telemetry = (streams: TelemetrySummary['streams']): TelemetrySummary => ({
  snapshots: [],
  metrics: {
    lastCollected: 0,
    lastDurationMs: 0,
    consecutiveFailures: 0,
    successCount: 0,
    failureCount: 0,
  },
  streams,
});

describe('diagnosticsRowModel', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const diagnosticsRow = (overrides: Partial<DiagnosticsRow>): DiagnosticsRow => ({
    rowKey: overrides.rowKey ?? 'nodes:cluster-a|',
    domain: overrides.domain ?? 'nodes',
    label: overrides.label ?? 'Nodes',
    status: overrides.status ?? 'ready',
    version: overrides.version ?? '1',
    interval: overrides.interval ?? '5s',
    lastUpdated: overrides.lastUpdated ?? '1s',
    lastUpdatedTooltip: overrides.lastUpdatedTooltip ?? '1 second ago',
    metricsStatus: overrides.metricsStatus ?? '—',
    metricsTooltip: overrides.metricsTooltip ?? 'Not applicable',
    dropped: overrides.dropped ?? 0,
    stale: overrides.stale ?? false,
    error: overrides.error ?? '—',
    hasMetrics: overrides.hasMetrics ?? false,
    count: overrides.count ?? 1,
    countDisplay: overrides.countDisplay ?? '1',
    namespace: overrides.namespace ?? '-',
    scope: overrides.scope ?? 'cluster-a (active)',
    role: overrides.role ?? 'Live Scope',
    mode: overrides.mode ?? 'snapshot',
    healthStatus: overrides.healthStatus ?? 'healthy (ready)',
    pollingStatus: overrides.pollingStatus ?? 'enabled',
    ...overrides,
  });

  test('dedupes equivalent visible refresh-domain rows and keeps the healthier row', () => {
    const unhealthyAlias = diagnosticsRow({
      rowKey: 'nodes:cluster-a|cluster',
      healthStatus: 'unhealthy (inactive)',
      error: 'stream inactive',
    });
    const healthyCanonical = diagnosticsRow({
      rowKey: 'nodes:cluster-a|',
      healthStatus: 'healthy (ready)',
      error: '—',
    });
    const queryRow = diagnosticsRow({
      rowKey: 'nodes:cluster-a|?limit=50',
      scope: 'cluster-a (active) - limit=50',
      mode: 'snapshot',
    });

    expect(dedupeDiagnosticsRows([unhealthyAlias, healthyCanonical, queryRow])).toEqual([
      healthyCanonical,
      queryRow,
    ]);
  });

  test('returns empty stream rows when telemetry is unavailable', () => {
    expect(buildDiagnosticsStreamRows(null, [], {})).toEqual([]);
  });

  test('builds the resources stream as a tree: header (socket-level) + cluster + per-domain leaves', () => {
    const rows = buildDiagnosticsStreamRows(
      telemetry([
        // Socket-level entry (no domain): Sessions/Connect + socket backlog drops.
        {
          name: 'resources',
          clusterId: 'c1',
          clusterName: 'kwok',
          activeSessions: 1,
          totalMessages: 0,
          droppedMessages: 809,
          skippedTargets: 0,
          errorCount: 809,
          lastConnect: 0,
          lastEvent: 0,
          lastError: 'subscriber backlog',
        },
        {
          name: 'resources',
          clusterId: 'c1',
          clusterName: 'kwok',
          domain: 'nodes',
          activeSessions: 0,
          totalMessages: 100,
          droppedMessages: 3,
          skippedTargets: 0,
          errorCount: 0,
          lastConnect: 0,
          lastEvent: 0,
        },
        {
          name: 'resources',
          clusterId: 'c1',
          clusterName: 'kwok',
          domain: 'pods',
          activeSessions: 0,
          totalMessages: 5,
          droppedMessages: 0,
          skippedTargets: 0,
          errorCount: 1,
          lastConnect: 0,
          lastEvent: 0,
          lastError: 'pods backlog',
          lastErrorAt: 1700,
        },
      ]),
      [
        { domain: 'nodes', label: 'Nodes' },
        { domain: 'pods', label: 'Pods' },
      ],
      {
        'c1::nodes': { resyncCount: 7, fallbackCount: 1 },
        'c1::pods': { resyncCount: 0, fallbackCount: 0 },
      }
    );

    // Ordered tree: stream header → cluster group → domain leaves.
    expect(rows.map((row) => row.kind)).toEqual(['stream', 'cluster', 'domain', 'domain']);

    // Socket-level metrics (Sessions, the 809 backlog) live on the header, not a domain.
    expect(rows[0]).toMatchObject({
      kind: 'stream',
      label: 'Resources',
      sessions: 1,
      dropped: 809,
      errors: 809,
      lastError: 'subscriber backlog',
    });
    expect(rows[1]).toMatchObject({ kind: 'cluster', cluster: 'kwok' });

    const nodes = rows.find((row) => row.kind === 'domain' && row.domain === 'Nodes');
    const pods = rows.find((row) => row.kind === 'domain' && row.domain === 'Pods');
    expect(nodes).toMatchObject({
      cluster: 'kwok',
      delivered: 100,
      dropped: 3,
      resyncs: 7,
      fallbacks: 1,
    });
    expect(pods).toMatchObject({
      cluster: 'kwok',
      delivered: 5,
      errors: 1,
      resyncs: 0,
      fallbacks: 0,
      lastError: 'pods backlog',
      lastErrorAt: 1700,
    });
  });

  test('renders a non-per-domain stream (catalog) as a header-only row with no children', () => {
    const rows = buildDiagnosticsStreamRows(
      telemetry([
        {
          name: 'catalog',
          activeSessions: 1,
          totalMessages: 3,
          droppedMessages: 2,
          skippedTargets: 0,
          errorCount: 1,
          lastConnect: 0,
          lastEvent: 0,
          lastError: 'catalog stalled',
        },
      ]),
      [{ domain: 'catalog', label: 'Browse Catalog' }],
      {}
    );

    // Catalog has no per-domain telemetry → just a header row; its delivery is stream-level.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'stream',
      label: 'Catalog',
      sessions: 1,
      delivered: 3,
      dropped: 2,
      errors: 1,
      lastError: 'catalog stalled',
    });
  });

  test('builds a cluster-leaf stream (catalog) as header + one leaf per cluster', () => {
    const rows = buildDiagnosticsStreamRows(
      telemetry([
        {
          name: 'catalog',
          clusterId: 'c1',
          clusterName: 'kwok',
          activeSessions: 1,
          totalMessages: 20,
          droppedMessages: 0,
          skippedTargets: 0,
          errorCount: 0,
          lastConnect: 0,
          lastEvent: 0,
        },
        {
          name: 'catalog',
          clusterId: 'c2',
          clusterName: 'kind',
          activeSessions: 1,
          totalMessages: 5,
          droppedMessages: 2,
          skippedTargets: 0,
          errorCount: 1,
          lastConnect: 0,
          lastEvent: 0,
          lastError: 'catalog stalled',
        },
      ]),
      [],
      {}
    );

    // No sub-cluster child → the cluster IS the leaf: header → one cluster leaf
    // per cluster (sorted), each carrying its own metrics.
    expect(rows.map((row) => row.kind)).toEqual(['stream', 'cluster', 'cluster']);
    expect(rows[0]).toMatchObject({ kind: 'stream', label: 'Catalog', sessions: 2 });
    const kind = rows.find((row) => row.kind === 'cluster' && row.cluster === 'kind');
    const kwok = rows.find((row) => row.kind === 'cluster' && row.cluster === 'kwok');
    expect(kind).toMatchObject({
      leaf: { delivered: 5, dropped: 2, errors: 1, lastError: 'catalog stalled' },
    });
    expect(kwok).toMatchObject({ leaf: { delivered: 20, dropped: 0, errors: 0 } });
  });

  test('summarizes the tree: sessions from headers, active domains from leaves', () => {
    const rows: DiagnosticsStreamRow[] = [
      {
        kind: 'stream',
        rowKey: 'stream::resources',
        label: 'Resources',
        sessions: 3,
        lastConnect: '1s',
        lastConnectTooltip: '1s',
        delivered: 0,
        dropped: 0,
        errors: 0,
        lastEvent: '1s',
        lastEventTooltip: '1s',
        lastError: '—',
        activeDomainCount: 2,
      },
      { kind: 'cluster', rowKey: 'cluster::resources::kwok', cluster: 'kwok' },
      {
        kind: 'domain',
        rowKey: 'domain::resources::c1::nodes',
        cluster: 'kwok',
        domain: 'Nodes',
        delivered: 10,
        dropped: 0,
        errors: 0,
        resyncs: 1,
        fallbacks: 0,
        lastEvent: '1s',
        lastEventTooltip: '1s',
        lastError: '—',
      },
      {
        kind: 'domain',
        rowKey: 'domain::resources::c1::pods',
        cluster: 'kwok',
        domain: 'Pods',
        delivered: 4,
        dropped: 0,
        errors: 0,
        resyncs: null,
        fallbacks: null,
        lastEvent: '1s',
        lastEventTooltip: '1s',
        lastError: '—',
      },
      {
        kind: 'stream',
        rowKey: 'stream::catalog',
        label: 'Catalog',
        sessions: 1,
        lastConnect: '1s',
        lastConnectTooltip: '1s',
        delivered: 4,
        dropped: 0,
        errors: 0,
        lastEvent: '1s',
        lastEventTooltip: '1s',
        lastError: '—',
        activeDomainCount: 0,
      },
    ];

    // Sessions = 3 + 1 (headers); Streams = 2 headers; Active Domains = 2 leaves.
    expect(buildDiagnosticsStreamSummary(rows)).toBe(
      'Sessions: 4 • Streams: 2 • Active Domains: 2'
    );
    expect(buildDiagnosticsStreamSummary([])).toBe('No stream telemetry available');
  });

  test('builds Kubernetes API client rows and summary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    const now = Date.now();

    const rows = buildKubernetesAPIClientRows([
      {
        clusterId: 'cluster-a',
        clusterName: 'Cluster A',
        configuredQPS: 50,
        configuredBurst: 100,
        qps1s: 9.25,
        qps10s: 12.75,
        qps60s: 0,
        peakQPS1s: 17,
        totalRequests: 200,
        status2xx: 190,
        status3xx: 4,
        status4xx: 5,
        status429: 3,
        status5xx: 1,
        errors: 2,
        lastRequestMs: now - 1000,
      },
      {
        clusterId: 'cluster-b',
        clusterName: '',
        configuredQPS: 20,
        configuredBurst: 40,
        qps1s: Number.NaN,
        qps10s: 1.25,
        qps60s: 10,
        peakQPS1s: 12,
        totalRequests: 50,
        status2xx: 45,
        status3xx: 1,
        status4xx: 2,
        status429: 0,
        status5xx: 2,
        errors: 1,
        lastRequestMs: 0,
      },
    ]);

    expect(rows[0]).toMatchObject({
      key: 'cluster-a',
      cluster: 'Cluster A',
      clusterTooltip: 'cluster-a',
      configured: '50 / 100',
      qps1s: '9.3',
      qps10s: '13',
      qps60s: '0',
      totalRequests: 200,
    });
    expect(rows[1]).toMatchObject({
      key: 'cluster-b',
      cluster: 'cluster-b',
      qps1s: '0',
      qps10s: '1.3',
      qps60s: '10',
      lastRequest: '—',
    });
    expect(buildKubernetesAPISummary(rows, null)).toBe(
      'Clusters: 2 • Requests: 250 • 429s: 3 • 5xx: 3'
    );
    expect(buildKubernetesAPISummary([], 'diagnostics unavailable')).toBe(
      'diagnostics unavailable'
    );
  });

  test('builds broker read rows and summary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    const now = Date.now();

    const rows = buildBrokerReadRows(
      [
        {
          key: 'data-access:api-resource',
          broker: 'data-access',
          resource: 'api-resource',
          adapter: 'refresh-domain',
          reason: 'background',
          totalRequests: 7,
          inFlightCount: 0,
          successCount: 5,
          errorCount: 1,
          blockedCount: 1,
          lastStatus: 'blocked',
          lastCompletedAt: now - 1000,
          lastDurationMs: 125,
          lastBlockedReason: 'refresh paused',
          lastError: 'boom',
          recentScopes: ['cluster:test-cluster', 'cluster:other-cluster'],
        },
        {
          key: 'app-state:settings',
          broker: 'app-state-access',
          resource: 'settings-schema',
          label: 'Settings Schema',
          adapter: 'rpc-read',
          totalRequests: 2,
          inFlightCount: 1,
          successCount: 1,
          errorCount: 0,
          blockedCount: 0,
          lastStatus: 'success',
          lastDurationMs: 2500,
          recentScopes: [],
        },
      ],
      (scopes) => ({
        display: scopes[0] ?? '—',
        tooltip: scopes.join(' || ') || undefined,
      })
    );

    expect(rows[0]).toMatchObject({
      broker: 'Cluster Data',
      label: 'API Resource',
      reason: 'background',
      scope: 'cluster:test-cluster',
      scopeTooltip: 'cluster:test-cluster || cluster:other-cluster',
      lastStatus: 'Blocked',
      lastDuration: '125ms',
      lastError: 'refresh paused',
    });
    expect(rows[1]).toMatchObject({
      broker: 'App State',
      label: 'Settings Schema',
      reason: '—',
      scope: '—',
      lastStatus: 'In Flight',
      lastDuration: '2.5s',
      lastError: '—',
    });
    expect(buildBrokerReadsSummary(rows)).toBe(
      'Rows: 2 • In Flight: 1 • Requests: 9 • Blocked: 1 • Errors: 1'
    );
  });

  test('builds capability rows and filters permission rows by cluster and namespace', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    const now = Date.now();
    const podGetKey = getPermissionKey('Pod', 'get', 'team-a', null, 'cluster-a');
    const deploymentPatchKey = getPermissionKey('Deployment', 'patch', 'team-a', null, 'cluster-a');
    const otherClusterKey = getPermissionKey('Pod', 'get', 'team-a', null, 'cluster-b');

    const permissionMap = new Map<string, PermissionStatus>([
      [
        podGetKey,
        {
          id: podGetKey,
          allowed: true,
          pending: false,
          reason: null,
          error: null,
          source: 'ssrr',
          descriptor: {
            clusterId: 'cluster-a',
            group: '',
            version: 'v1',
            resourceKind: 'Pod',
            verb: 'get',
            namespace: 'team-a',
            subresource: null,
          },
          feature: PERMISSION_FEATURES.namespacePods,
          entry: { status: 'ready' },
        },
      ],
      [
        deploymentPatchKey,
        {
          id: deploymentPatchKey,
          allowed: false,
          pending: false,
          reason: 'denied',
          error: null,
          source: 'denied',
          descriptor: {
            clusterId: 'cluster-a',
            group: 'apps',
            version: 'v1',
            resourceKind: 'Deployment',
            verb: 'patch',
            namespace: 'team-a',
            subresource: null,
          },
          feature: PERMISSION_FEATURES.namespaceWorkloads,
          entry: { status: 'ready' },
        },
      ],
      [
        otherClusterKey,
        {
          id: otherClusterKey,
          allowed: true,
          pending: false,
          reason: null,
          error: null,
          source: 'ssrr',
          descriptor: {
            clusterId: 'cluster-b',
            group: '',
            version: 'v1',
            resourceKind: 'Pod',
            verb: 'get',
            namespace: 'team-a',
            subresource: null,
          },
          feature: PERMISSION_FEATURES.namespacePods,
          entry: { status: 'ready' },
        },
      ],
    ]);
    const diagnostics: PermissionQueryDiagnostics[] = [
      {
        key: 'cluster-a:team-a',
        clusterId: 'cluster-a',
        namespace: 'team-a',
        method: 'ssrr',
        pendingCount: 1,
        inFlightCount: 1,
        inFlightStartedAt: now - 1500,
        lastRunDurationMs: 250,
        lastRunCompletedAt: now - 5000,
        lastResult: 'success',
        totalChecks: 2,
        consecutiveFailureCount: 0,
        lastDescriptors: [
          { resourceKind: 'Pod', verb: 'get', namespace: 'team-a' },
          { resourceKind: 'Deployment', verb: 'patch', namespace: 'team-a' },
        ],
      },
    ];

    const { capabilityBatchRows, capabilityDescriptorIndex } = buildCapabilityBatchRows(
      diagnostics,
      now,
      permissionMap
    );
    expect(capabilityBatchRows).toHaveLength(1);
    expect(capabilityBatchRows[0]).toMatchObject({
      clusterId: 'cluster-a',
      scope: 'team-a',
      pendingCount: 1,
      inFlightCount: 1,
      runtimeDisplay: '1.5s',
      lastDurationDisplay: '250ms',
      lastResult: 'Success',
      totalChecks: 2,
    });
    expect(capabilityDescriptorIndex.get(podGetKey)).toMatchObject({
      scope: 'team-a',
      descriptorLabel: 'Pod (get)',
      pendingCount: 1,
      inFlightCount: 1,
    });

    const permissionRows = buildPermissionRows({
      permissionMap,
      capabilityDescriptorIndex,
      scopedFeatures: [PERMISSION_FEATURES.namespacePods],
      viewType: 'namespace',
      selectedNamespace: 'team-a',
      selectedClusterId: 'cluster-a',
    });
    expect(permissionRows).toHaveLength(1);
    expect(permissionRows[0]).toMatchObject({
      clusterId: 'cluster-a',
      scope: 'team-a',
      descriptorLabel: 'Pod (get)',
      resource: 'Pod',
      allowed: 'True',
      feature: PERMISSION_FEATURES.namespacePods,
      pendingCount: 1,
      inFlightCount: 1,
      lastResult: 'Success',
    });
  });

  test('builds diagnostics summary cards', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    const now = Date.now();

    expect(
      buildOrchestratorSummary({
        pendingRequests: 1,
        selectionDiagnostics: {
          activeQueueDepth: 2,
          maxQueueDepth: 4,
          sampleCount: 1,
          totalMutations: 5,
          completedMutations: 2,
          failedMutations: 1,
          canceledMutations: 1,
          supersededMutations: 1,
          queueP95Ms: 25,
          lastReason: 'view change',
          lastError: 'mutation failed',
        },
        selectionDiagnosticsError: null,
      })
    ).toMatchObject({
      primary: 'Pending Requests: 1 • Selection Queue: 2',
      secondary: 'Queue p95: 25 ms • Total: 5 • Failed: 1 • Canceled: 1 • Superseded: 1',
      className: 'diagnostics-summary-error',
    });

    expect(
      buildMetricsSummary({
        telemetryMetrics: {
          lastCollected: now - 1000,
          lastDurationMs: 20,
          consecutiveFailures: 0,
          successCount: 3,
          failureCount: 0,
          active: false,
        },
        telemetrySummary: telemetry([]),
        telemetryError: null,
      })
    ).toMatchObject({
      primary: 'Status: Idle • Polls: 3',
      secondary: expect.stringContaining('Updated:'),
      title: expect.stringContaining('Polling idle'),
    });

    expect(
      buildEventStreamSummary({
        eventStreamTelemetry: {
          name: 'events',
          activeSessions: 1,
          totalMessages: 12,
          droppedMessages: 1,
          skippedTargets: 0,
          errorCount: 0,
          lastConnect: now - 1000,
          lastEvent: now - 500,
        },
        telemetrySummary: telemetry([]),
        telemetryError: null,
      })
    ).toMatchObject({
      primary: 'Active: 1 • Delivered: 12 • Dropped: 1',
      className: 'diagnostics-summary-warning',
    });

    expect(
      buildContainerLogsSummary({
        containerLogsScopeEntries: [
          [
            'scope-a',
            {
              status: 'ready',
              data: null,
              stats: null,
              error: null,
              droppedAutoRefreshes: 0,
              lastUpdated: now - 1000,
            },
          ],
          [
            'scope-b',
            {
              status: 'error',
              data: null,
              stats: null,
              error: 'failed',
              droppedAutoRefreshes: 0,
            },
          ],
        ],
        containerLogsStreamTelemetry: {
          name: 'container-logs',
          activeSessions: 1,
          totalMessages: 8,
          droppedMessages: 0,
          skippedTargets: 2,
          errorCount: 0,
          lastConnect: now - 500,
          lastEvent: now - 250,
          lastSkipReason: 'pod not ready',
        },
      })
    ).toMatchObject({
      primary:
        'Scopes: 2 • Active Scopes: 1 • Sessions: 1 • Delivered: 8 • Dropped: 0 • Skipped Targets: 2',
      className: 'diagnostics-summary-error',
      title: expect.stringContaining('pod not ready'),
    });
  });
});
