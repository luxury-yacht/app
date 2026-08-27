import { describe, expect, it } from 'vitest';

import type { BrokerReadDiagnosticsEntry } from '@/core/read-diagnostics';
import type { TelemetryStreamStatus } from '../../types.generated';
import {
  buildClusterDataRows,
  buildClusterDataSummary,
  buildConnectionsRows,
} from './clusterDataRowModel';
import type { DiagnosticsRow } from './diagnosticsPanelTypes';

const scopeRow = (over: Partial<DiagnosticsRow> & Pick<DiagnosticsRow, 'domain' | 'clusterId'>) =>
  ({
    rowKey: `${over.domain}:${over.clusterId}:${over.scope ?? ''}`,
    label: over.domain,
    status: 'ready',
    version: '1',
    interval: '5s',
    lastUpdated: 'now',
    lastUpdatedTooltip: '',
    metricsStatus: '—',
    metricsTooltip: '',
    dropped: 0,
    stale: false,
    error: '',
    hasMetrics: false,
    count: 0,
    countDisplay: '0',
    namespace: '—',
    scope: '',
    role: 'Snapshot',
    mode: 'snapshot',
    healthStatus: 'ok',
    pollingStatus: 'on',
    ...over,
  }) as DiagnosticsRow;

const brokerRow = (over: Partial<BrokerReadDiagnosticsEntry>): BrokerReadDiagnosticsEntry =>
  ({
    key: 'k',
    broker: 'data-access',
    clusterId: '',
    resource: 'pods',
    adapter: 'refresh-domain',
    reason: 'background',
    totalRequests: 0,
    inFlightCount: 0,
    successCount: 0,
    errorCount: 0,
    blockedCount: 0,
    lastStatus: 'success',
    recentScopes: [],
    ...over,
  }) as BrokerReadDiagnosticsEntry;

describe('buildClusterDataRows', () => {
  it('covers buildClusterDataRows scenarios', async () => {
    {
      // Scenario: gives a single-scope domain ONE row that names its own domain
      const rows = buildClusterDataRows({
        rows: [
          scopeRow({ domain: 'pods', clusterId: 'c1', scope: 'default', label: 'Pods' }),
          scopeRow({ domain: 'nodes', clusterId: 'c1', label: 'Nodes' }),
        ],
        clusterNames: { c1: 'Cluster One' },
        streamStatsByClusterDomain: {},
        brokerReads: [],
      });

      // One cluster header, then one row per domain — no duplicate group row and
      // no repeated label, which is what made the first version hard to read.
      expect(rows.map((row) => row.kind)).toEqual(['cluster', 'scope', 'scope']);
      const scopes = rows.filter((row) => row.kind === 'scope');
      expect(scopes.map((row) => (row.kind === 'scope' ? row.domainLabel : ''))).toEqual([
        'Nodes',
        'Pods',
      ]);
      expect(scopes.every((row) => row.kind === 'scope' && row.depth === 1)).toBe(true);
    }

    {
      // Scenario: adds a domain group row only when several scopes share a domain
      const rows = buildClusterDataRows({
        rows: [
          scopeRow({ domain: 'pods', clusterId: 'c1', scope: 'default' }),
          scopeRow({ domain: 'pods', clusterId: 'c1', scope: 'kube-system' }),
          scopeRow({ domain: 'nodes', clusterId: 'c1' }),
        ],
        clusterNames: { c1: 'Cluster One' },
        streamStatsByClusterDomain: {},
        brokerReads: [],
      });

      expect(rows.map((row) => row.kind)).toEqual([
        'cluster',
        'scope', // nodes: single scope, no group row
        'domain', // pods: two scopes, so the domain is worth grouping
        'scope',
        'scope',
      ]);
      const grouped = rows.filter((row) => row.kind === 'scope' && row.depth === 2);
      expect(grouped).toHaveLength(2);
      // Rows under a group row must not repeat the domain name.
      expect(grouped.every((row) => row.kind === 'scope' && row.domainLabel === '')).toBe(true);
    }

    {
      // Scenario: drops the cluster prefix the cluster header already states
      const rows = buildClusterDataRows({
        rows: [
          scopeRow({
            domain: 'catalog',
            clusterId: 'c1',
            scope: 'fusionauth-svc (active) - limit=1, resourceScope=cluster',
          }),
          // A scope that is nothing but the cluster carries no extra information.
          scopeRow({ domain: 'nodes', clusterId: 'c1', scope: 'fusionauth-svc (active)' }),
        ],
        clusterNames: { c1: 'fusionauth-svc' },
        streamStatsByClusterDomain: {},
        brokerReads: [],
      });

      const scopes = rows.flatMap((row) => (row.kind === 'scope' ? [row.scope] : []));
      expect(scopes).toEqual(['limit=1, resourceScope=cluster', 'cluster-wide']);
      // The full original stays in the tooltip so nothing is lost.
      const catalog = rows.find((row) => row.kind === 'scope' && row.domain === 'catalog');
      expect(catalog?.kind === 'scope' && catalog.scopeTooltip).toContain('fusionauth-svc');
      // The cluster header is where the name and selection state belong.
      expect(rows[0].kind === 'cluster' && rows[0].clusterName).toBe('fusionauth-svc');
    }

    {
      // Scenario: does not treat the no-value placeholder as an error
      // resolveTelemetryError yields the dimmed placeholder for "no error". Read
      // as data it made every healthy row report `error` and counted every scope
      // as an issue — a display string must never decide health.
      const rows = buildClusterDataRows({
        rows: [
          scopeRow({ domain: 'pods', clusterId: 'c1', scope: 'a', error: '—' }),
          scopeRow({ domain: 'nodes', clusterId: 'c1', error: '-' }),
        ],
        clusterNames: { c1: 'Cluster One' },
        streamStatsByClusterDomain: {},
        brokerReads: [],
      });

      const scopes = rows.filter((row) => row.kind === 'scope');
      expect(scopes.map((row) => (row.kind === 'scope' ? row.health.tone : ''))).toEqual([
        'ok',
        'ok',
      ]);
      expect(scopes.every((row) => row.kind === 'scope' && row.error === '')).toBe(true);
      expect(rows[0].kind === 'cluster' && rows[0].issueSummary).toBe('');
    }

    {
      // Scenario: reports a domain that is not running as inactive, never as a fault
      // A scope with no stream is not broken — nothing is leasing it. Showing
      // that as degraded/unhealthy makes an idle panel look like an incident.
      const rows = buildClusterDataRows({
        rows: [
          scopeRow({ domain: 'pods', clusterId: 'c1', scope: 'a', healthStatus: 'inactive' }),
          scopeRow({ domain: 'nodes', clusterId: 'c1', status: 'idle' }),
          // A stream that IS running but failing stays a real signal.
          scopeRow({ domain: 'catalog', clusterId: 'c1', healthStatus: 'degraded (resyncing)' }),
          scopeRow({
            domain: 'namespaces',
            clusterId: 'c1',
            healthStatus: 'unhealthy (no-delivery)',
          }),
        ],
        clusterNames: { c1: 'Cluster One' },
        streamStatsByClusterDomain: {},
        brokerReads: [],
      });

      const badges = rows.flatMap((row) =>
        row.kind === 'scope' ? [[row.domain, row.health.label, row.health.tone]] : []
      );
      expect(badges).toEqual([
        ['catalog', 'degraded', 'warn'],
        ['namespaces', 'unhealthy', 'error'],
        ['nodes', 'inactive', 'inactive'],
        ['pods', 'inactive', 'inactive'],
      ]);
      // Only the genuinely unhealthy stream counts: the two inactive scopes and
      // the degraded (still-running) one must not inflate the header.
      expect(rows[0].kind === 'cluster' && rows[0].issueSummary).toBe('1 issue');
    }

    {
      // Scenario: counts exactly the rows whose badge says something is wrong
      // The header count and the badges are derived from ONE classifier, so they
      // cannot drift apart the way a separately-computed count did.
      const rows = buildClusterDataRows({
        rows: [
          scopeRow({ domain: 'pods', clusterId: 'c1', scope: 'a', status: 'idle' }),
          scopeRow({ domain: 'nodes', clusterId: 'c1', healthStatus: 'degraded (resyncing)' }),
          scopeRow({
            domain: 'catalog',
            clusterId: 'c1',
            healthStatus: 'unhealthy (no-delivery)',
          }),
          scopeRow({ domain: 'namespaces', clusterId: 'c1', error: 'boom' }),
        ],
        clusterNames: { c1: 'Cluster One' },
        streamStatsByClusterDomain: {},
        brokerReads: [],
      });

      const faults = rows.filter(
        (row) => row.kind === 'scope' && row.health.tone === 'error'
      ).length;
      expect(rows[0].kind === 'cluster' && rows[0].issueSummary).toBe(`${faults} issues`);
      expect(faults).toBe(2);
    }

    {
      // Scenario: still reports a real fault on a scope that is also idle
      // Inactivity must not mask a permission denial or a recorded error.
      const rows = buildClusterDataRows({
        rows: [
          scopeRow({ domain: 'pods', clusterId: 'c1', scope: 'a', status: 'idle', error: 'boom' }),
          scopeRow({
            domain: 'nodes',
            clusterId: 'c1',
            status: 'idle',
            healthStatus: 'unhealthy (permission denied)',
          }),
        ],
        clusterNames: { c1: 'Cluster One' },
        streamStatsByClusterDomain: {},
        brokerReads: [],
      });

      const tones = rows.flatMap((row) => (row.kind === 'scope' ? [row.health.tone] : []));
      expect(tones).toEqual(['error', 'error']);
    }

    {
      // Scenario: states the tree connection lines as data, so depth is never guessed
      const rows = buildClusterDataRows({
        rows: [
          scopeRow({ domain: 'catalog', clusterId: 'c1', scope: 'limit=1' }),
          scopeRow({ domain: 'catalog', clusterId: 'c1', scope: 'limit=50' }),
          scopeRow({ domain: 'nodes', clusterId: 'c1' }),
          scopeRow({ domain: 'pods', clusterId: 'c1', scope: 'default' }),
        ],
        clusterNames: { c1: 'Cluster One' },
        streamStatsByClusterDomain: {},
        brokerReads: [],
      });

      const tree = rows.flatMap((row) =>
        row.kind === 'cluster' ? [] : [[row.kind, row.depth, row.guides.join('|'), row.connector]]
      );
      expect(tree).toEqual([
        // catalog is grouped and has domains after it, so its children carry a
        // pass-through rule at level 1 and the group row is a tee.
        ['domain', 1, '', 'tee'],
        ['scope', 2, 'line', 'tee'],
        ['scope', 2, 'line', 'end'],
        ['scope', 1, '', 'tee'],
        // the cluster's last child closes the rule
        ['scope', 1, '', 'end'],
      ]);
    }

    {
      // Scenario: stops the level-1 rule under the cluster's last domain
      const rows = buildClusterDataRows({
        rows: [
          scopeRow({ domain: 'nodes', clusterId: 'c1' }),
          // pods sorts last AND is grouped: its children must draw no
          // pass-through rule, or the tree would imply a sibling below.
          scopeRow({ domain: 'pods', clusterId: 'c1', scope: 'a' }),
          scopeRow({ domain: 'pods', clusterId: 'c1', scope: 'b' }),
        ],
        clusterNames: { c1: 'Cluster One' },
        streamStatsByClusterDomain: {},
        brokerReads: [],
      });

      const nested = rows.filter((row) => row.kind === 'scope' && row.depth === 2);
      expect(nested.map((row) => (row.kind === 'scope' ? row.guides.join('|') : ''))).toEqual([
        'blank',
        'blank',
      ]);
      expect(nested.map((row) => (row.kind === 'scope' ? row.connector : ''))).toEqual([
        'tee',
        'end',
      ]);
    }

    {
      // Scenario: folds status, health and staleness into one badge
      const rows = buildClusterDataRows({
        rows: [
          scopeRow({
            domain: 'pods',
            clusterId: 'c1',
            scope: 'a',
            healthStatus: 'healthy (delivering)',
          }),
          scopeRow({ domain: 'nodes', clusterId: 'c1', healthStatus: 'degraded (resyncing)' }),
          scopeRow({ domain: 'catalog', clusterId: 'c1', error: 'boom' }),
        ],
        clusterNames: { c1: 'Cluster One' },
        streamStatsByClusterDomain: {},
        brokerReads: [],
      });

      const tones = rows.flatMap((row) =>
        row.kind === 'scope' ? [[row.domain, row.health.tone, row.health.label]] : []
      );
      expect(tones).toEqual([
        ['catalog', 'error', 'error'],
        ['nodes', 'warn', 'degraded'],
        ['pods', 'ok', 'healthy'],
      ]);
      // The badge tooltip still carries the underlying facts it replaced.
      const pods = rows.find((row) => row.kind === 'scope' && row.domain === 'pods');
      expect(pods?.kind === 'scope' && pods.health.tooltip).toContain('Status: ready');
      expect(pods?.kind === 'scope' && pods.health.tooltip).toContain(
        'Health: healthy (delivering)'
      );
    }

    {
      // Scenario: states the transport and its poll in one Feed cell
      const rows = buildClusterDataRows({
        rows: [
          scopeRow({ domain: 'pods', clusterId: 'c1', scope: 'a', interval: '5s' }),
          scopeRow({ domain: 'object-yaml', clusterId: 'c1', interval: '10s' }),
        ],
        clusterNames: { c1: 'Cluster One' },
        streamStatsByClusterDomain: {},
        brokerReads: [],
      });

      const pods = rows.find((row) => row.kind === 'scope' && row.domain === 'pods');
      expect(pods?.kind === 'scope' && pods.feed).toBe('Resources · 5s poll');
      // A domain with no stream must not imply one.
      const yaml = rows.find((row) => row.kind === 'scope' && row.domain === 'object-yaml');
      expect(yaml?.kind === 'scope' && yaml.feed).toBe('Poll 10s');
    }

    {
      // Scenario: moves everything the eight columns omit into the row expander
      const rows = buildClusterDataRows({
        rows: [
          scopeRow({
            domain: 'pods',
            clusterId: 'c1',
            scope: 'default',
            version: '623193373',
            syncWait: '1200 ms',
          }),
        ],
        clusterNames: { c1: 'Cluster One' },
        streamStatsByClusterDomain: { 'c1::pods': { resyncCount: 3, fallbackCount: 2 } },
        brokerReads: [
          brokerRow({
            key: 'a',
            clusterId: 'c1',
            resource: 'pods',
            totalRequests: 4,
            blockedCount: 1,
          }),
        ],
      });

      const pods = rows.find((row) => row.kind === 'scope');
      const details = Object.fromEntries(
        (pods?.kind === 'scope' ? pods.details : []).map((item) => [item.label, item.value])
      );
      expect(details).toMatchObject({
        Version: '623193373',
        'Sync wait': '1200 ms',
        Resyncs: '3',
        Fallbacks: '2',
        Callers: '1',
        Requests: '4',
        Blocked: '1',
      });
    }

    {
      // Scenario: counts issues on the cluster header and leaves it empty when clean
      const clean = buildClusterDataRows({
        rows: [scopeRow({ domain: 'pods', clusterId: 'c1', scope: 'a' })],
        clusterNames: { c1: 'Cluster One' },
        streamStatsByClusterDomain: {},
        brokerReads: [],
      });
      expect(clean[0].kind === 'cluster' && clean[0].issueSummary).toBe('');
      expect(clean[0].kind === 'cluster' && clean[0].summary).toBe('1 domain · 1 scope');

      const broken = buildClusterDataRows({
        rows: [scopeRow({ domain: 'pods', clusterId: 'c1', scope: 'a', error: 'boom' })],
        clusterNames: { c1: 'Cluster One' },
        streamStatsByClusterDomain: {},
        brokerReads: [],
      });
      expect(broken[0].kind === 'cluster' && broken[0].issueSummary).toBe('1 issue');
    }

    {
      // Scenario: uses the same health classification in the overall issue summary
      const rows = buildClusterDataRows({
        rows: [
          scopeRow({
            domain: 'pods',
            clusterId: 'c1',
            scope: 'a',
            healthStatus: 'unhealthy (no-delivery)',
          }),
        ],
        clusterNames: { c1: 'Cluster One' },
        streamStatsByClusterDomain: {},
        brokerReads: [],
      });

      expect(rows[0].kind === 'cluster' && rows[0].issueSummary).toBe('1 issue');
      expect(buildClusterDataSummary(rows)).toContain('Issues 1');
    }
  });
});

describe('buildConnectionsRows', () => {
  const stream = (over: Partial<TelemetryStreamStatus>): TelemetryStreamStatus =>
    ({
      name: 'resources',
      activeSessions: 0,
      totalMessages: 0,
      droppedMessages: 0,
      skippedTargets: 0,
      errorCount: 0,
      lastConnect: 0,
      lastEvent: 0,
      ...over,
    }) as TelemetryStreamStatus;

  it('lists sockets and the leaves that are not refresh domains', () => {
    const rows = buildConnectionsRows({
      streams: [
        stream({ name: 'resources', clusterId: 'c1', activeSessions: 2, lastConnect: 10 }),
        // A domain leaf belongs in the Cluster Data tree, not here.
        stream({
          name: 'resources',
          clusterId: 'c1',
          leafKind: 'domain',
          leaf: 'pods',
          totalMessages: 5,
        }),
        stream({ name: 'events', clusterId: 'c1', activeSessions: 1, lastConnect: 11 }),
        stream({
          name: 'events',
          clusterId: 'c1',
          leafKind: 'scope',
          leaf: 'namespace:demo',
          totalMessages: 3,
        }),
        stream({ name: 'container-logs', clusterId: 'c1', activeSessions: 1, lastConnect: 12 }),
        stream({
          name: 'container-logs',
          clusterId: 'c1',
          leafKind: 'target',
          leaf: 'demo/pod/app',
          totalMessages: 7,
        }),
      ],
      clusterNames: { c1: 'Cluster One' },
    });

    expect(
      rows.map((row) => `${row.kind}:${row.stream}:${row.kind === 'leaf' ? row.leaf : ''}`)
    ).toEqual([
      'socket:container-logs:',
      'leaf:container-logs:demo/pod/app',
      'socket:events:',
      'leaf:events:namespace:demo',
      'socket:resources:',
    ]);
    // The resources socket carries a pods DOMAIN leaf; it must not appear here,
    // because that leaf belongs to the pods domain in the Cluster Data tree.
    expect(rows.some((row) => row.kind === 'leaf' && row.leaf === 'pods')).toBe(false);
  });
});
