/**
 * frontend/src/core/refresh/components/diagnostics/diagnosticsRowModel.test.ts
 *
 * Verifies diagnostics row-model builders without rendering DiagnosticsPanel.
 * These tests keep stream telemetry row semantics local to the row model module.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { PermissionQueryDiagnostics, PermissionStatus } from '@/core/capabilities';
import { getPermissionKey, PERMISSION_FEATURES } from '@/core/capabilities';
import { makeTelemetrySummary } from '../../refreshContractTestBuilders';
import type { TelemetrySummary } from '../../types';
import type { DiagnosticsRow } from './diagnosticsPanelTypes';
import {
  buildBrokerReadRows,
  buildBrokerReadsSummary,
  buildCapabilityBatchRows,
  buildContainerLogsSummary,
  buildEventStreamSummary,
  buildKubernetesAPIClientRows,
  buildKubernetesAPISummary,
  buildMetricsSummary,
  buildOrchestratorSummary,
  buildPermissionRows,
  dedupeDiagnosticsRows,
  selectDomainStreamTelemetry,
} from './diagnosticsRowModel';

const telemetry = (streams: TelemetrySummary['streams']): TelemetrySummary =>
  makeTelemetrySummary({ streams });

describe('diagnosticsRowModel', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const diagnosticsRow = (overrides: Partial<DiagnosticsRow>): DiagnosticsRow => ({
    rowKey: overrides.rowKey ?? 'nodes:cluster-a|',
    domain: overrides.domain ?? 'nodes',
    clusterId: overrides.clusterId ?? '',
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

  test('selects the matching resource-domain telemetry instead of the socket aggregate', () => {
    const socket = {
      name: 'resources',
      activeSessions: 1,
      totalMessages: 100,
      droppedMessages: 9,
      skippedTargets: 0,
      errorCount: 2,
      lastConnect: 10,
      lastEvent: 20,
    };
    const catalog = {
      ...socket,
      leafKind: 'domain' as const,
      leaf: 'catalog',
      activeSessions: 0,
      totalMessages: 7,
      droppedMessages: 0,
      errorCount: 0,
    };

    expect(selectDomainStreamTelemetry([socket, catalog], 'resources', 'catalog')).toBe(catalog);
  });

  test('selects resource-domain telemetry from the requested cluster', () => {
    const forClusterB = {
      name: 'resources',
      clusterId: 'cluster-b',
      leafKind: 'domain' as const,
      leaf: 'catalog',
      activeSessions: 0,
      totalMessages: 20,
      droppedMessages: 2,
      skippedTargets: 0,
      errorCount: 1,
      lastConnect: 10,
      lastEvent: 20,
    };
    const forClusterA = {
      ...forClusterB,
      clusterId: 'cluster-a',
      totalMessages: 7,
      droppedMessages: 0,
      errorCount: 0,
    };

    expect(
      selectDomainStreamTelemetry([forClusterB, forClusterA], 'resources', 'catalog', 'cluster-a')
    ).toBe(forClusterA);
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
          clusterId: '',
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
          clusterId: '',
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
      primary: '1 pending',
      secondary: 'Queue 2 · p95 25 ms',
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
      primary: 'Idle',
      secondary: expect.stringContaining('3 polls'),
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
      primary: '12 delivered',
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
      primary: '8 delivered',
      secondary: expect.stringContaining('1 active'),
      className: 'diagnostics-summary-error',
      // The figures the headline drops stay reachable in the tooltip.
      title: expect.stringContaining('Skipped Targets: 2'),
    });
  });
});
