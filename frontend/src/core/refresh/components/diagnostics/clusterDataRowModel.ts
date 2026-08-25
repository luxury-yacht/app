/**
 * frontend/src/core/refresh/components/diagnostics/clusterDataRowModel.ts
 *
 * Row models for the two merged diagnostics views.
 *
 * Cluster Data is a tree — cluster -> refresh domain -> scope. The authored
 * contract maps every domain to at most one stream, so the transport is an
 * ATTRIBUTE of a domain (columns on its row) rather than a level above it.
 * Broker reads that fetch a domain hang off the same row.
 *
 * Connections & Calls is deliberately flat: sockets, the stream children whose
 * keys are not refresh domains (event scopes, container-logs targets), and the
 * reads that belong to no domain. Those members have no common parent, so a
 * tree would invent a hierarchy that does not exist.
 */

import { isTableNoValueText } from '@shared/components/tables/tableNoValue';

import type { BrokerReadDiagnosticsEntry } from '@/core/read-diagnostics';
import { REFRESH_DOMAIN_DESCRIPTORS } from '../../domainRegistry';
import type { RefreshDomain } from '../../types';
import type { TelemetryStreamStatus } from '../../types.generated';
import type {
  ClusterDataDetail,
  ClusterDataHealth,
  ClusterDataRow,
  ConnectionsRow,
  DiagnosticsRow,
} from './diagnosticsPanelTypes';
import { formatLastUpdated } from './diagnosticsPanelUtils';

export interface ResourceStreamRecoveryStats {
  resyncCount: number;
  fallbackCount: number;
  lastResyncReason?: string;
  lastFallbackReason?: string;
}

const STREAM_LABELS: Record<string, string> = {
  resources: 'Resources',
  events: 'Events',
  'container-logs': 'Container Logs',
};

const NO_STREAM_LABEL = 'Snapshot only';

// The canonical dimmed placeholder used across the diagnostics tables.
const NO_VALUE = '—';

const APP_LEVEL_CLUSTER_ID = '';
const APP_LEVEL_CLUSTER_NAME = 'App (no cluster)';

// transportForDomain reads the authored diagnosticsStream for a domain. A
// domain with no stream is snapshot-only and must show no delivery counters
// rather than a zero that reads like "the stream delivered nothing".
const transportForDomain = (domain: RefreshDomain): { label: string; streamed: boolean } => {
  const stream = REFRESH_DOMAIN_DESCRIPTORS[domain]?.diagnosticsStream;
  if (!stream) {
    return { label: NO_STREAM_LABEL, streamed: false };
  }
  return { label: STREAM_LABELS[stream] ?? stream, streamed: true };
};

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

// scopeError normalizes a row's error to '' when absent. Upstream formatting has
// spelled "no error" as a dash before now, and health must never be decided by
// a display string, so every no-value spelling collapses to empty here.
const scopeError = (row: DiagnosticsRow): string =>
  !row.error || isTableNoValueText(row.error) ? '' : row.error;

// The issue count derives from the SAME classifier as the badges, so the header
// can never claim problems the rows do not show (an earlier version counted
// every row as an issue while every badge read healthy).
const rowHasIssue = (row: DiagnosticsRow): boolean => resolveHealth(row).tone === 'error';

// callerStatsFor folds every refresh-domain broker read that fetched this
// (cluster, domain). Reads through any other adapter answer a different
// question and live in the flat view.
const callerStatsFor = (
  brokerReads: BrokerReadDiagnosticsEntry[],
  clusterId: string,
  domain: RefreshDomain
): {
  callerCount: number;
  callerRequests: number;
  callerBlocked: number;
  callerErrors: number;
  callerTooltip?: string;
} => {
  const matching = brokerReads.filter(
    (entry) =>
      entry.adapter === 'refresh-domain' &&
      entry.resource === domain &&
      entry.clusterId === clusterId
  );
  if (matching.length === 0) {
    return { callerCount: 0, callerRequests: 0, callerBlocked: 0, callerErrors: 0 };
  }
  const reasons = Array.from(new Set(matching.map((entry) => entry.reason ?? 'unknown'))).sort(
    compareStrings
  );
  return {
    callerCount: matching.length,
    callerRequests: matching.reduce((total, entry) => total + entry.totalRequests, 0),
    callerBlocked: matching.reduce((total, entry) => total + entry.blockedCount, 0),
    callerErrors: matching.reduce((total, entry) => total + entry.errorCount, 0),
    callerTooltip: `Reasons: ${reasons.join(', ')}`,
  };
};

const TRANSPORT_TOOLTIP_SUFFIX = 'its poll interval is only the stream-down fallback';

// resolveHealth folds status, health and staleness into ONE badge. The previous
// table stated the same fact in three columns (HEALTH, STATUS and part of
// TELEMETRY), which made a healthy row as loud as a broken one.
const resolveHealth = (row: DiagnosticsRow): ClusterDataHealth => {
  const error = scopeError(row);
  const parts = [`Status: ${row.status}`, `Health: ${row.healthStatus}`];
  if (row.healthTooltip) {
    parts.push(row.healthTooltip);
  }
  if (row.stale) {
    parts.push('Data is stale');
  }
  const tooltip = parts.join(' • ');
  const health = row.healthStatus.toLowerCase();

  // A recorded error or a permission denial is a real fault even on a scope
  // nothing is using, so those are classified first.
  if (error || health.includes('denied')) {
    return { label: error ? 'error' : 'unhealthy', tone: 'error', tooltip };
  }
  // Inactivity outranks every remaining failure classification. A scope that is
  // not running has no stream to be unhealthy about and no refresh to be stale
  // from; reporting it as degraded implies a problem the user does not have.
  if (health.includes('inactive') || row.status === 'idle') {
    return { label: 'inactive', tone: 'inactive', tooltip };
  }
  if (health.includes('unhealthy')) {
    return { label: 'unhealthy', tone: 'error', tooltip };
  }
  if (row.stale || health.includes('degraded') || health.includes('resync')) {
    return { label: row.stale ? 'stale' : 'degraded', tone: 'warn', tooltip };
  }
  return { label: health.includes('healthy') ? 'healthy' : row.status, tone: 'ok', tooltip };
};

// resolveFeed answers "how is this kept fresh" in one cell: which stream feeds
// it, and what the poll is doing. Merges the previous MODE, POLLING and
// INTERVAL columns.
const resolveFeed = (
  row: DiagnosticsRow,
  transport: { label: string; streamed: boolean }
): { feed: string; feedTooltip: string } => {
  const interval = row.interval && row.interval !== NO_VALUE ? row.interval : null;
  const pollingOff = row.pollingStatus === 'disabled' || row.pollingStatus === 'paused';

  if (!transport.streamed) {
    return {
      feed: interval ? `Poll ${interval}` : 'Poll',
      feedTooltip: `${row.domain} has no stream; ${row.pollingTooltip ?? 'it refreshes on its poll interval'}`,
    };
  }
  const suffix = pollingOff ? `poll ${row.pollingStatus}` : interval ? `${interval} poll` : 'poll';
  return {
    feed: `${transport.label} · ${suffix}`,
    feedTooltip:
      `${row.domain} is fed by the ${transport.label} stream; ${TRANSPORT_TOOLTIP_SUFFIX}. ${row.pollingTooltip ?? ''}`.trim(),
  };
};

// resolveActivity is the work this scope has done: polls that succeeded and
// failed, plus how long the last build took.
const resolveActivity = (row: DiagnosticsRow): { activity: string; activityTooltip: string } => {
  const segments: string[] = [];
  if (row.telemetrySuccess !== undefined) {
    segments.push(`${row.telemetrySuccess}✓`, `${row.telemetryFailure ?? 0}✗`);
  }
  if (row.duration && row.duration !== NO_VALUE) {
    segments.push(row.duration);
  }
  const tooltipParts = [row.telemetryTooltip, row.metricsTooltip].filter(Boolean);
  return {
    activity: segments.length > 0 ? segments.join(' ') : NO_VALUE,
    activityTooltip: tooltipParts.join(' • '),
  };
};

// scopeWithoutCluster removes the cluster name (and its selection marker) from
// the front of a scope. The cluster header row directly above already states
// both, so repeating them on every row is the same duplication the domain label
// had — and it inflated the column until it pushed Error off the edge. A scope
// that was ONLY the cluster has no distinguishing part left, so it says so.
const scopeWithoutCluster = (scope: string, clusterName: string): string => {
  const trimmed = scope.trim();
  if (!clusterName || !trimmed.startsWith(clusterName)) {
    return trimmed;
  }
  const tail = trimmed.slice(clusterName.length).replace(/^\s*\((?:active|background)\)/i, '');
  const remainder = tail.replace(/^\s*[-–—]\s*/, '').trim();
  return remainder || 'cluster-wide';
};

const detail = (label: string, value: string | undefined, tooltip?: string): ClusterDataDetail[] =>
  value && value !== NO_VALUE ? [{ label, value, ...(tooltip ? { tooltip } : {}) }] : [];

// buildScopeDetails holds everything the eight visible columns leave out.
// Nothing is dropped by the narrower table; it moves behind the row expander.
const buildScopeDetails = (
  row: DiagnosticsRow,
  domainFacts: ClusterDataDetail[]
): ClusterDataDetail[] => [
  ...detail('Role', row.role, row.roleTooltip),
  ...detail('Namespace', row.namespace),
  ...detail('Mode', row.mode, row.modeTooltip),
  ...detail('Status', row.status),
  ...detail('Version', row.version),
  ...detail('Sync wait', row.syncWait),
  ...detail('Metrics', row.metricsStatus, row.metricsTooltip),
  { label: 'Dropped', value: String(row.dropped) },
  { label: 'Stale', value: row.stale ? 'Yes' : 'No' },
  ...domainFacts,
];

export interface ClusterDataRowInput {
  rows: DiagnosticsRow[];
  clusterNames: Record<string, string>;
  streamStatsByClusterDomain: Record<string, ResourceStreamRecoveryStats>;
  brokerReads: BrokerReadDiagnosticsEntry[];
}

const pluralize = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

export const buildClusterDataRows = ({
  rows,
  clusterNames,
  streamStatsByClusterDomain,
  brokerReads,
}: ClusterDataRowInput): ClusterDataRow[] => {
  const byCluster = new Map<string, Map<RefreshDomain, DiagnosticsRow[]>>();
  rows.forEach((row) => {
    const clusterId = row.clusterId ?? APP_LEVEL_CLUSTER_ID;
    const domains = byCluster.get(clusterId) ?? new Map<RefreshDomain, DiagnosticsRow[]>();
    byCluster.set(clusterId, domains);
    const scopeRows = domains.get(row.domain) ?? [];
    scopeRows.push(row);
    domains.set(row.domain, scopeRows);
  });

  const clusterIds = Array.from(byCluster.keys()).sort((left, right) => {
    // App-level rows sort last: they are the exception, not the headline.
    if (!left) {
      return 1;
    }
    if (!right) {
      return -1;
    }
    return compareStrings(clusterNames[left] ?? left, clusterNames[right] ?? right);
  });

  const out: ClusterDataRow[] = [];
  clusterIds.forEach((clusterId) => {
    const domains = byCluster.get(clusterId);
    if (!domains) {
      return;
    }
    const domainNames = Array.from(domains.keys()).sort(compareStrings);
    const scopeRowsForCluster = domainNames.flatMap((domain) => domains.get(domain) ?? []);
    const issueCount = scopeRowsForCluster.filter(rowHasIssue).length;
    const clusterName = clusterId ? (clusterNames[clusterId] ?? clusterId) : APP_LEVEL_CLUSTER_NAME;

    out.push({
      kind: 'cluster',
      rowKey: `cluster::${clusterId}`,
      clusterId,
      clusterName,
      summary: `${pluralize(domainNames.length, 'domain')} · ${pluralize(scopeRowsForCluster.length, 'scope')}`,
      issueSummary: issueCount > 0 ? pluralize(issueCount, 'issue') : '',
    });

    domainNames.forEach((domain) => {
      const scopeRows = (domains.get(domain) ?? [])
        .slice()
        .sort((left, right) => compareStrings(left.rowKey, right.rowKey));
      const transport = transportForDomain(domain);
      const stats = streamStatsByClusterDomain[`${clusterId}::${domain}`];
      const callers = callerStatsFor(brokerReads, clusterId, domain);
      const label = scopeRows[0]?.label ?? domain;

      // Domain-level facts ride on the scope row when there is only one scope,
      // and on a group row when several scopes share the domain.
      const domainFacts: ClusterDataDetail[] = [
        ...(transport.streamed
          ? [
              { label: 'Resyncs', value: String(stats?.resyncCount ?? 0) },
              {
                label: 'Fallbacks',
                value: String(stats?.fallbackCount ?? 0),
                ...(stats?.lastFallbackReason ? { tooltip: stats.lastFallbackReason } : {}),
              },
            ]
          : []),
        { label: 'Callers', value: String(callers.callerCount) },
        { label: 'Requests', value: String(callers.callerRequests) },
        ...(callers.callerBlocked > 0
          ? [{ label: 'Blocked', value: String(callers.callerBlocked) }]
          : []),
        ...(callers.callerErrors > 0
          ? [{ label: 'Caller errors', value: String(callers.callerErrors) }]
          : []),
      ];

      const grouped = scopeRows.length > 1;
      if (grouped) {
        out.push({
          kind: 'domain',
          rowKey: `domain::${clusterId}::${domain}`,
          clusterId,
          domain,
          label,
          summary: [
            transport.streamed ? transport.label : 'Poll only',
            ...domainFacts.map((fact) => `${fact.label} ${fact.value}`),
            pluralize(scopeRows.length, 'scope'),
          ].join(' · '),
          summaryTooltip: callers.callerTooltip ?? '',
        });
      }

      scopeRows.forEach((row) => {
        const { feed, feedTooltip } = resolveFeed(row, transport);
        const { activity, activityTooltip } = resolveActivity(row);
        out.push({
          kind: 'scope',
          rowKey: `scope::${clusterId}::${domain}::${row.rowKey}`,
          clusterId,
          domain,
          domainLabel: grouped ? '' : label,
          indented: grouped,
          scope: scopeWithoutCluster(row.scope, clusterName),
          // The tooltip keeps the untrimmed scope so nothing is lost.
          scopeTooltip: row.scopeTooltip ?? row.scope,
          ...(row.scopeEntries ? { scopeEntries: row.scopeEntries } : {}),
          health: resolveHealth(row),
          feed,
          feedTooltip,
          count: row.countDisplay,
          ...(row.countTooltip ? { countTooltip: row.countTooltip } : {}),
          ...(row.countClassName ? { countClassName: row.countClassName } : {}),
          updated: row.lastUpdated,
          updatedTooltip: row.lastUpdatedTooltip,
          activity,
          activityTooltip,
          error: scopeError(row),
          details: buildScopeDetails(row, grouped ? [] : domainFacts),
        });
      });
    });
  });
  return out;
};

export const buildClusterDataSummary = (rows: ClusterDataRow[]): string => {
  const clusters = rows.filter((row) => row.kind === 'cluster').length;
  const scopes = rows.filter((row) => row.kind === 'scope').length;
  const domains = new Set(
    rows.flatMap((row) => (row.kind === 'scope' ? [`${row.clusterId}::${row.domain}`] : []))
  ).size;
  const issues = rows.filter((row) => row.kind === 'scope' && Boolean(row.error)).length;
  return `Clusters ${clusters} · Domains ${domains} · Scopes ${scopes} · Issues ${issues}`;
};

export interface ConnectionsRowInput {
  streams: TelemetryStreamStatus[] | null | undefined;
  clusterNames: Record<string, string>;
}

// buildConnectionsRows lists the transport itself. Domain leaves are excluded:
// they belong to their domain in the Cluster Data tree. Scope and target leaves
// stay here because they key by something that is not a refresh domain.
export const buildConnectionsRows = ({
  streams,
  clusterNames,
}: ConnectionsRowInput): ConnectionsRow[] => {
  const entries = streams ?? [];
  const streamNames = Array.from(new Set(entries.map((entry) => entry.name))).sort((left, right) =>
    compareStrings(STREAM_LABELS[left] ?? left, STREAM_LABELS[right] ?? right)
  );

  const out: ConnectionsRow[] = [];
  streamNames.forEach((streamName) => {
    const label = STREAM_LABELS[streamName] ?? streamName;
    const forStream = entries.filter((entry) => entry.name === streamName);
    const clusterLabel = (entry: TelemetryStreamStatus): string =>
      entry.clusterName ??
      (entry.clusterId ? (clusterNames[entry.clusterId] ?? entry.clusterId) : '—');

    forStream
      .filter((entry) => !entry.leafKind)
      .forEach((entry) => {
        const connectInfo = formatLastUpdated(entry.lastConnect || undefined);
        const eventInfo = formatLastUpdated(entry.lastEvent || undefined);
        out.push({
          kind: 'socket',
          rowKey: `socket::${streamName}::${entry.clusterId ?? ''}`,
          stream: streamName,
          label,
          cluster: clusterLabel(entry),
          sessions: entry.activeSessions,
          lastConnect: connectInfo.display,
          lastConnectTooltip: connectInfo.tooltip,
          delivered: entry.totalMessages,
          dropped: entry.droppedMessages,
          errors: entry.errorCount,
          lastEvent: eventInfo.display,
          lastEventTooltip: eventInfo.tooltip,
          lastError: entry.lastError ?? '—',
          ...(entry.lastErrorAt !== undefined ? { lastErrorAt: entry.lastErrorAt } : {}),
        });
      });

    forStream
      .filter((entry) => entry.leafKind === 'scope' || entry.leafKind === 'target')
      .sort((left, right) => compareStrings(left.leaf ?? '', right.leaf ?? ''))
      .forEach((entry) => {
        const eventInfo = formatLastUpdated(entry.lastEvent || undefined);
        out.push({
          kind: 'leaf',
          rowKey: `leaf::${streamName}::${entry.clusterId ?? ''}::${entry.leafKind}::${entry.leaf ?? ''}`,
          stream: streamName,
          label,
          cluster: clusterLabel(entry),
          leafKind: entry.leafKind === 'target' ? 'target' : 'scope',
          leaf: entry.leaf ?? '',
          delivered: entry.totalMessages,
          dropped: entry.droppedMessages,
          errors: entry.errorCount,
          lastEvent: eventInfo.display,
          lastEventTooltip: eventInfo.tooltip,
          lastError: entry.lastError ?? '—',
          ...(entry.lastErrorAt !== undefined ? { lastErrorAt: entry.lastErrorAt } : {}),
        });
      });
  });
  return out;
};

export const buildConnectionsSummary = (rows: ConnectionsRow[], brokerRowCount: number): string => {
  const sockets = rows.filter((row) => row.kind === 'socket');
  const sessions = sockets.reduce(
    (total, row) => total + (row.kind === 'socket' ? row.sessions : 0),
    0
  );
  const errors = rows.reduce((total, row) => total + row.errors, 0);
  return `Sockets: ${sockets.length} • Sessions: ${sessions} • Other leaves: ${rows.length - sockets.length} • Calls: ${brokerRowCount} • Errors: ${errors}`;
};
