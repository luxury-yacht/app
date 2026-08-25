/**
 * frontend/src/core/refresh/components/diagnostics/diagnosticsRowModel.ts
 *
 * Builds diagnostics table rows from refresh, stream, and telemetry state.
 * This keeps row semantics behind a deeper module so DiagnosticsPanel can stay
 * focused on panel layout and tab wiring.
 */

import {
  getPermissionKey,
  PERMISSION_FEATURES,
  type PermissionFeatureKey,
  type PermissionQueryDiagnostics,
  type PermissionStatus,
  permissionFeatureLabel,
} from '@/core/capabilities';
import type { BrokerReadDiagnosticsEntry } from '@/core/read-diagnostics';
import type { KubernetesAPIClientDiagnostics, SelectionDiagnostics } from '../../client';
import type { DomainSnapshotState } from '../../store';
import type {
  CatalogSnapshotPayload,
  TelemetryMetricsStatus,
  TelemetrySnapshotStatus,
  TelemetryStreamStatus,
  TelemetrySummary,
} from '../../types';
import type {
  BrokerReadRow,
  CapabilityBatchRow,
  CapabilityDescriptorActivityDetails,
  DiagnosticsRow,
  KubernetesAPIClientRow,
  PermissionRow,
  SummaryCardData,
} from './diagnosticsPanelTypes';
import { formatDurationMs, formatLastUpdated } from './diagnosticsPanelUtils';

const diagnosticsRowIdentity = (row: DiagnosticsRow): string =>
  [row.domain, row.label, row.namespace, row.scope, row.role].join('\u0000');

const rowHealthRank = (row: DiagnosticsRow): number => {
  const normalized = row.healthStatus.toLowerCase();
  if (normalized.startsWith('healthy')) {
    return 3;
  }
  if (normalized.startsWith('degraded')) {
    return 2;
  }
  if (normalized.startsWith('unhealthy')) {
    return 1;
  }
  return 0;
};

const rowStatusRank = (row: DiagnosticsRow): number => {
  switch (row.status) {
    case 'ready':
      return 5;
    case 'updating':
      return 4;
    case 'loading':
    case 'initialising':
      return 3;
    case 'idle':
      return 2;
    case 'error':
      return 1;
    default:
      return 0;
  }
};

const rowQualityRank = (row: DiagnosticsRow): number =>
  rowHealthRank(row) * 100 +
  rowStatusRank(row) * 10 +
  (row.error === '—' ? 2 : 0) +
  (row.stale ? 0 : 1);

export const dedupeDiagnosticsRows = (rows: DiagnosticsRow[]): DiagnosticsRow[] => {
  const byIdentity = new Map<string, DiagnosticsRow>();
  rows.forEach((row) => {
    const identity = diagnosticsRowIdentity(row);
    const existing = byIdentity.get(identity);
    if (!existing || rowQualityRank(row) > rowQualityRank(existing)) {
      byIdentity.set(identity, row);
    }
  });
  return Array.from(byIdentity.values());
};

// mostRecentError returns the latest error (message + when it occurred) across
// entries, so a stream header or cluster-leaf row shows the most recent of its
// children's errors together with its relative age.
const mostRecentError = (entries: TelemetryStreamStatus[]): { message: string; at?: number } => {
  let message = '—';
  let at = 0;
  entries.forEach((entry) => {
    const trimmed = entry.lastError?.trim();
    if (!trimmed) {
      return;
    }
    const when = entry.lastErrorAt ?? 0;
    if (message === '—' || when >= at) {
      message = trimmed;
      at = when;
    }
  });
  return { message, at: at > 0 ? at : undefined };
};

const sumStreamValue = (
  entries: TelemetryStreamStatus[],
  select: (entry: TelemetryStreamStatus) => number
): number => entries.reduce((total, entry) => total + select(entry), 0);

const maxStreamValue = (
  entries: TelemetryStreamStatus[],
  select: (entry: TelemetryStreamStatus) => number
): number => entries.reduce((latest, entry) => Math.max(latest, select(entry)), 0);

export const selectStreamSocketTelemetry = (
  streams: TelemetryStreamStatus[] | null | undefined,
  streamName: string,
  clusterId = ''
): TelemetryStreamStatus | undefined =>
  (streams ?? []).find(
    (entry) => entry.name === streamName && (entry.clusterId ?? '') === clusterId && !entry.leafKind
  );

export const selectDomainStreamTelemetry = (
  streams: TelemetryStreamStatus[] | null | undefined,
  streamName: string,
  domain: string,
  clusterId = ''
): TelemetryStreamStatus | undefined => {
  const matchingStream = (streams ?? []).filter(
    (entry) => entry.name === streamName && (entry.clusterId ?? '') === clusterId
  );
  // Only a `domain` leaf names a refresh domain; scope/target leaves key by
  // something else entirely and must never be matched here.
  return (
    matchingStream.find((entry) => entry.leafKind === 'domain' && entry.leaf === domain) ??
    selectStreamSocketTelemetry(streams, streamName, clusterId)
  );
};

export const selectDomainSnapshotTelemetry = (
  snapshots: TelemetrySnapshotStatus[] | null | undefined,
  domain: string,
  clusterId = '',
  scope = ''
): TelemetrySnapshotStatus | undefined =>
  (snapshots ?? []).find(
    (entry) =>
      entry.domain === domain &&
      (entry.clusterId ?? '') === clusterId &&
      (entry.scope ?? '') === scope
  );

// Catalog is a domain on the unified resources socket. Present its domain
// deliveries together with the owning socket's session/connect state so the
// summary cannot drift back to the retired standalone catalog stream.
export const selectCatalogStreamTelemetry = (
  streams: TelemetryStreamStatus[] | null | undefined
): TelemetryStreamStatus | undefined => {
  const resourceEntries = (streams ?? []).filter((entry) => entry.name === 'resources');
  const socketEntries = resourceEntries.filter((entry) => !entry.leafKind);
  const catalogEntries = resourceEntries.filter(
    (entry) => entry.leafKind === 'domain' && entry.leaf === 'catalog'
  );
  if (socketEntries.length === 0 && catalogEntries.length === 0) {
    return undefined;
  }

  const error = mostRecentError([...socketEntries, ...catalogEntries]);
  const latestSkip = [...socketEntries, ...catalogEntries]
    .filter((entry) => entry.lastSkipReason)
    .sort((left, right) => right.lastEvent - left.lastEvent)[0]?.lastSkipReason;
  return {
    name: 'resources',
    leafKind: 'domain',
    leaf: 'catalog',
    activeSessions: sumStreamValue(socketEntries, (entry) => entry.activeSessions),
    totalMessages: sumStreamValue(catalogEntries, (entry) => entry.totalMessages),
    droppedMessages:
      sumStreamValue(socketEntries, (entry) => entry.droppedMessages) +
      sumStreamValue(catalogEntries, (entry) => entry.droppedMessages),
    skippedTargets:
      sumStreamValue(socketEntries, (entry) => entry.skippedTargets) +
      sumStreamValue(catalogEntries, (entry) => entry.skippedTargets),
    errorCount:
      sumStreamValue(socketEntries, (entry) => entry.errorCount) +
      sumStreamValue(catalogEntries, (entry) => entry.errorCount),
    lastConnect: maxStreamValue(socketEntries, (entry) => entry.lastConnect),
    lastEvent: maxStreamValue(catalogEntries, (entry) => entry.lastEvent),
    ...(error.message !== '—' ? { lastError: error.message } : {}),
    ...(error.at !== undefined ? { lastErrorAt: error.at } : {}),
    ...(latestSkip ? { lastSkipReason: latestSkip } : {}),
  };
};

const formatQPS = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
};

export const buildKubernetesAPIClientRows = (
  diagnostics: KubernetesAPIClientDiagnostics[]
): KubernetesAPIClientRow[] => {
  return diagnostics.map((entry) => {
    const clusterName = entry.clusterName || entry.clusterId || 'Unknown cluster';
    const lastRequestInfo = formatLastUpdated(entry.lastRequestMs);
    return {
      key: entry.clusterId || clusterName,
      cluster: clusterName,
      clusterTooltip: entry.clusterId || clusterName,
      configured: `${entry.configuredQPS} / ${entry.configuredBurst}`,
      qps1s: formatQPS(entry.qps1s),
      qps10s: formatQPS(entry.qps10s),
      qps60s: formatQPS(entry.qps60s),
      peakQPS1s: entry.peakQPS1s,
      totalRequests: entry.totalRequests,
      status429: entry.status429,
      status5xx: entry.status5xx,
      errors: entry.errors,
      lastRequest: lastRequestInfo.display,
      lastRequestTooltip: lastRequestInfo.tooltip,
    };
  });
};

export const buildKubernetesAPISummary = (
  rows: KubernetesAPIClientRow[],
  diagnosticsError: string | null
): string => {
  if (diagnosticsError && rows.length === 0) {
    return diagnosticsError;
  }
  const totalRequests = rows.reduce((total, row) => total + row.totalRequests, 0);
  const total429s = rows.reduce((total, row) => total + row.status429, 0);
  const total5xx = rows.reduce((total, row) => total + row.status5xx, 0);
  return `Clusters: ${rows.length} • Requests: ${totalRequests} • 429s: ${total429s} • 5xx: ${total5xx}`;
};

const BROKER_READ_TOKEN_LABELS: Record<string, string> = {
  api: 'API',
  crds: 'CRDs',
  gvk: 'GVK',
  hpa: 'HPA',
  rbac: 'RBAC',
  uid: 'UID',
  yaml: 'YAML',
};

const formatBrokerReadLabel = (value: string): string => {
  return value
    .split(/[-_:/]+/)
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      if (BROKER_READ_TOKEN_LABELS[lower]) {
        return BROKER_READ_TOKEN_LABELS[lower];
      }
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(' ');
};

const resolveBrokerReadStatus = (entry: BrokerReadDiagnosticsEntry): string => {
  if (entry.inFlightCount > 0) {
    return 'In Flight';
  }
  const labels: Record<string, string> = {
    never: '—',
    blocked: 'Blocked',
    error: 'Error',
  };
  return labels[entry.lastStatus] ?? 'Success';
};

export const buildBrokerReadRows = (
  diagnostics: BrokerReadDiagnosticsEntry[],
  resolveScope: (scopes: string[]) => { display: string; tooltip?: string }
): BrokerReadRow[] => {
  return diagnostics.map((entry) => {
    const updatedInfo = formatLastUpdated(entry.lastCompletedAt);
    const broker = entry.broker === 'data-access' ? 'Cluster Data' : 'App State';
    const label = entry.label ?? formatBrokerReadLabel(entry.resource);
    const scopeInfo = resolveScope(entry.recentScopes);

    return {
      key: entry.key,
      broker,
      label,
      resource: entry.resource,
      adapter: entry.adapter,
      reason: entry.reason ?? '—',
      scope: scopeInfo.display,
      scopeTooltip: scopeInfo.tooltip,
      inFlightCount: entry.inFlightCount,
      totalRequests: entry.totalRequests,
      successCount: entry.successCount,
      errorCount: entry.errorCount,
      blockedCount: entry.blockedCount,
      lastStatus: resolveBrokerReadStatus(entry),
      lastDuration: formatDurationMs(entry.lastDurationMs),
      lastUpdated: updatedInfo.display,
      lastUpdatedTooltip: updatedInfo.tooltip,
      lastError: entry.lastBlockedReason ?? entry.lastError ?? '—',
    };
  });
};

export const buildBrokerReadsSummary = (rows: BrokerReadRow[]): string => {
  const inFlight = rows.reduce((total, row) => total + row.inFlightCount, 0);
  const totalRequests = rows.reduce((total, row) => total + row.totalRequests, 0);
  const blocked = rows.reduce((total, row) => total + row.blockedCount, 0);
  const errors = rows.reduce((total, row) => total + row.errorCount, 0);
  return `Rows: ${rows.length} • In Flight: ${inFlight} • Requests: ${totalRequests} • Blocked: ${blocked} • Errors: ${errors}`;
};

type CapabilityDescriptor = PermissionQueryDiagnostics['lastDescriptors'][number];
type FeatureDescriptorMap = Map<PermissionFeatureKey, Map<string, string[]>>;

const shouldIncludeCapabilityBatch = (entry: PermissionQueryDiagnostics): boolean =>
  entry.inFlightCount > 0 ||
  entry.pendingCount > 0 ||
  (entry.lastRunCompletedAt !== null && entry.lastRunCompletedAt !== undefined) ||
  entry.lastDescriptors.length > 0;

const capabilityResultLabel = (result: PermissionQueryDiagnostics['lastResult']): string => {
  if (result === 'success') {
    return 'Success';
  }
  return result === 'error' ? 'Error' : '—';
};

const addFeatureDescriptor = (
  featureDescriptors: FeatureDescriptorMap,
  feature: PermissionFeatureKey,
  descriptor: CapabilityDescriptor
) => {
  let resources = featureDescriptors.get(feature);
  if (!resources) {
    resources = new Map<string, string[]>();
    featureDescriptors.set(feature, resources);
  }
  let verbs = resources.get(descriptor.resourceKind);
  if (!verbs) {
    verbs = [];
    resources.set(descriptor.resourceKind, verbs);
  }
  const verbLabel = descriptor.subresource
    ? `${descriptor.verb}/${descriptor.subresource}`
    : descriptor.verb;
  if (!verbs.includes(verbLabel)) {
    verbs.push(verbLabel);
  }
};

interface CapabilityDescriptorContext {
  entry: PermissionQueryDiagnostics;
  scope: string;
  runtimeDisplay: string;
  lastDurationDisplay: string;
  age: ReturnType<typeof formatLastUpdated>;
  lastResultLabel: string;
  totalChecks: number;
}

const recordCapabilityDescriptor = (
  descriptor: CapabilityDescriptor,
  context: CapabilityDescriptorContext,
  permissionMap: Map<string, PermissionStatus>,
  featureDescriptors: FeatureDescriptorMap,
  descriptorIndex: Map<string, CapabilityDescriptorActivityDetails>
) => {
  const { entry } = context;
  const key = getPermissionKey(
    descriptor.resourceKind,
    descriptor.verb,
    descriptor.namespace ?? null,
    descriptor.subresource ?? null,
    entry.clusterId ?? null
  );
  const feature = permissionMap.get(key)?.feature ?? PERMISSION_FEATURES.other;
  addFeatureDescriptor(featureDescriptors, feature, descriptor);
  const descriptorLabel = descriptor.subresource
    ? `${descriptor.resourceKind}/${descriptor.subresource} (${descriptor.verb})`
    : `${descriptor.resourceKind} (${descriptor.verb})`;
  descriptorIndex.set(key, {
    scope: context.scope,
    descriptorLabel,
    resourceKind: descriptor.resourceKind,
    verb: descriptor.verb,
    subresource: descriptor.subresource ?? null,
    pendingCount: entry.pendingCount,
    inFlightCount: entry.inFlightCount,
    runtimeDisplay: context.runtimeDisplay,
    lastDurationDisplay: context.lastDurationDisplay,
    age: context.age,
    lastResult: context.lastResultLabel,
    consecutiveFailureCount: entry.consecutiveFailureCount,
    totalChecks: context.totalChecks,
    lastError: entry.lastError ?? null,
  });
};

const formatFeatureDescriptors = (featureDescriptors: FeatureDescriptorMap) =>
  featureDescriptors.size > 0
    ? Array.from(featureDescriptors.entries()).map(([feature, resources]) => ({
        feature,
        resources: Array.from(resources.entries()).map(
          ([resource, verbs]) => `${resource} (${verbs.join(', ')})`
        ),
      }))
    : null;

const buildCapabilityBatchRow = (
  entry: PermissionQueryDiagnostics,
  diagnosticsClock: number,
  permissionMap: Map<string, PermissionStatus>,
  descriptorIndex: Map<string, CapabilityDescriptorActivityDetails>
): CapabilityBatchRow | null => {
  if (!shouldIncludeCapabilityBatch(entry)) {
    return null;
  }
  const scope = entry.namespace ?? 'Cluster';
  const runtimeMs =
    entry.inFlightCount > 0 && entry.inFlightStartedAt
      ? Math.max(0, diagnosticsClock - entry.inFlightStartedAt)
      : null;
  const age = formatLastUpdated(entry.lastRunCompletedAt);
  const lastDurationDisplay = formatDurationMs(entry.lastRunDurationMs);
  const runtimeDisplay = formatDurationMs(runtimeMs);
  const lastResultLabel = capabilityResultLabel(entry.lastResult);
  const descriptorCount = entry.lastDescriptors.length;
  const totalChecks =
    entry.totalChecks && entry.totalChecks > 0 ? entry.totalChecks : descriptorCount;
  const featureDescriptors: FeatureDescriptorMap = new Map();
  const context = {
    entry,
    scope,
    runtimeDisplay,
    lastDurationDisplay,
    age,
    lastResultLabel,
    totalChecks,
  };
  entry.lastDescriptors.forEach((descriptor) => {
    recordCapabilityDescriptor(
      descriptor,
      context,
      permissionMap,
      featureDescriptors,
      descriptorIndex
    );
  });
  return {
    key: entry.key,
    clusterId: entry.clusterId ?? '',
    scope,
    pendingCount: entry.pendingCount,
    inFlightCount: entry.inFlightCount,
    runtimeDisplay,
    runtimeMs,
    lastDurationDisplay,
    age,
    lastResult: lastResultLabel,
    lastError: entry.lastError ?? null,
    totalChecks,
    consecutiveFailureCount: entry.consecutiveFailureCount,
    descriptorsByFeature: formatFeatureDescriptors(featureDescriptors),
    method: entry.method ?? null,
    ssrrIncomplete: entry.ssrrIncomplete ?? null,
    ssrrRuleCount: entry.ssrrRuleCount ?? null,
    ssarFallbackCount: entry.ssarFallbackCount ?? null,
  };
};

export const buildCapabilityBatchRows = (
  capabilityDiagnostics: PermissionQueryDiagnostics[],
  diagnosticsClock: number,
  permissionMap: Map<string, PermissionStatus>
): {
  capabilityBatchRows: CapabilityBatchRow[];
  capabilityDescriptorIndex: Map<string, CapabilityDescriptorActivityDetails>;
} => {
  const descriptorIndex = new Map<string, CapabilityDescriptorActivityDetails>();

  const batchRows = capabilityDiagnostics
    .map((entry) =>
      buildCapabilityBatchRow(entry, diagnosticsClock, permissionMap, descriptorIndex)
    )
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => {
      if (a.scope === 'Cluster' && b.scope !== 'Cluster') {
        return -1;
      }
      if (b.scope === 'Cluster' && a.scope !== 'Cluster') {
        return 1;
      }
      return a.scope.localeCompare(b.scope);
    });

  return { capabilityBatchRows: batchRows, capabilityDescriptorIndex: descriptorIndex };
};

const permissionAllowedLabel = (status: PermissionStatus): string => {
  if (status.pending) {
    return 'Pending';
  }
  return status.allowed ? 'True' : 'False';
};

const permissionDescriptorLabel = (
  status: PermissionStatus,
  activity: CapabilityDescriptorActivityDetails | undefined
): string =>
  activity?.descriptorLabel ??
  (status.descriptor.subresource
    ? `${status.descriptor.resourceKind}/${status.descriptor.subresource} (${status.descriptor.verb})`
    : `${status.descriptor.resourceKind} (${status.descriptor.verb})`);

const permissionActivityFields = (activity: CapabilityDescriptorActivityDetails | undefined) => ({
  pendingCount: activity?.pendingCount ?? null,
  inFlightCount: activity?.inFlightCount ?? null,
  runtimeDisplay: activity?.runtimeDisplay ?? '—',
  lastDurationDisplay: activity?.lastDurationDisplay ?? '—',
  age: activity?.age ?? { display: '—', tooltip: '—' },
  lastResult: activity?.lastResult ?? '—',
  consecutiveFailureCount: activity?.consecutiveFailureCount ?? 0,
  totalChecks: activity?.totalChecks ?? null,
  lastError: activity?.lastError ?? null,
});

const buildPermissionRow = (
  status: PermissionStatus,
  capabilityDescriptorIndex: Map<string, CapabilityDescriptorActivityDetails>
): PermissionRow => {
  const scope = status.descriptor.namespace ? status.descriptor.namespace : 'Cluster';
  const activity = capabilityDescriptorIndex.get(status.id);
  return {
    clusterId: status.descriptor.clusterId,
    scope:
      activity?.scope ?? status.descriptor.namespace ?? (scope === 'Cluster' ? 'Cluster' : scope),
    descriptorLabel: permissionDescriptorLabel(status, activity),
    resource: status.descriptor.resourceKind,
    verb: status.descriptor.verb,
    allowed: permissionAllowedLabel(status),
    isDenied: !status.pending && !status.allowed,
    reason: status.reason ?? status.error ?? undefined,
    id: status.id,
    feature: status.feature,
    featureLabel: permissionFeatureLabel(status.feature) ?? undefined,
    descriptorNamespace: status.descriptor.namespace ?? null,
    ...permissionActivityFields(activity),
    descriptorKey: status.id,
  };
};

interface PermissionRowFilter {
  scopedFeatureSet: Set<PermissionFeatureKey>;
  hasFeatureFilters: boolean;
  viewType: string;
  selectedNamespaceKey: string | null;
  selectedClusterId?: string | null;
}

const permissionRowMatchesClusterView = (
  row: PermissionRow,
  scopedFeatureSet: Set<PermissionFeatureKey>
): boolean =>
  row.scope === 'Cluster' ||
  Boolean(
    row.descriptorNamespace &&
      row.feature !== null &&
      row.feature !== undefined &&
      scopedFeatureSet.has(row.feature)
  );

const permissionRowMatchesNamespaceView = (
  row: PermissionRow,
  selectedNamespaceKey: string | null
): boolean => {
  if (!row.descriptorNamespace) {
    return false;
  }
  return !selectedNamespaceKey || row.descriptorNamespace.toLowerCase() === selectedNamespaceKey;
};

const permissionRowMatchesFilter = (row: PermissionRow, filter: PermissionRowFilter): boolean => {
  if (filter.selectedClusterId && row.clusterId && row.clusterId !== filter.selectedClusterId) {
    return false;
  }
  const matchesFeature =
    !filter.hasFeatureFilters || Boolean(row.feature && filter.scopedFeatureSet.has(row.feature));
  if (!matchesFeature) {
    return false;
  }
  if (filter.viewType === 'cluster' || filter.viewType === 'overview') {
    return permissionRowMatchesClusterView(row, filter.scopedFeatureSet);
  }
  if (filter.viewType === 'namespace') {
    return permissionRowMatchesNamespaceView(row, filter.selectedNamespaceKey);
  }
  return false;
};

export const buildPermissionRows = (params: {
  permissionMap: Map<string, PermissionStatus>;
  capabilityDescriptorIndex: Map<string, CapabilityDescriptorActivityDetails>;
  scopedFeatures: readonly PermissionFeatureKey[];
  viewType: 'overview' | 'cluster' | 'namespace' | string;
  selectedNamespace?: string | null;
  selectedClusterId?: string | null;
}): PermissionRow[] => {
  const {
    permissionMap,
    capabilityDescriptorIndex,
    scopedFeatures,
    viewType,
    selectedNamespace,
    selectedClusterId,
  } = params;
  const scopedFeatureSet = new Set(scopedFeatures);
  const hasFeatureFilters = scopedFeatureSet.size > 0;
  const selectedNamespaceKey =
    selectedNamespace && !selectedNamespace.endsWith(':all')
      ? selectedNamespace.toLowerCase()
      : null;

  const allPermissionRows = Array.from(permissionMap.values()).map((status) =>
    buildPermissionRow(status, capabilityDescriptorIndex)
  );
  const filter = {
    scopedFeatureSet,
    hasFeatureFilters,
    viewType,
    selectedNamespaceKey,
    selectedClusterId,
  } satisfies PermissionRowFilter;
  const scopedRows = allPermissionRows.filter((row) => permissionRowMatchesFilter(row, filter));

  return scopedRows.sort((a, b) => {
    const scopeA = a.scope;
    const scopeB = b.scope;

    if (scopeA === scopeB) {
      if (a.descriptorLabel === b.descriptorLabel) {
        return a.verb.localeCompare(b.verb);
      }
      return a.descriptorLabel.localeCompare(b.descriptorLabel);
    }

    if (scopeA === 'Cluster') {
      return -1;
    }

    if (scopeB === 'Cluster') {
      return 1;
    }

    return scopeA.localeCompare(scopeB);
  });
};

const orchestratorSummaryClassName = (
  pendingRequests: number,
  queueDepth: number,
  failedMutations: number,
  diagnosticsUnavailable: boolean
): string | undefined => {
  if (diagnosticsUnavailable) {
    return 'diagnostics-summary-warning';
  }
  if (failedMutations > 0) {
    return 'diagnostics-summary-error';
  }
  return queueDepth > 0 || pendingRequests > 0 ? 'diagnostics-summary-warning' : undefined;
};

const orchestratorSummaryTitle = (
  selectionDiagnostics: SelectionDiagnostics | null,
  selectionDiagnosticsError: string | null
): string | undefined => {
  const titleParts: string[] = [];
  if (selectionDiagnosticsError && !selectionDiagnostics) {
    titleParts.push(selectionDiagnosticsError);
  }
  if (selectionDiagnostics?.lastReason) {
    titleParts.push(`Last mutation: ${selectionDiagnostics.lastReason}`);
  }
  if (selectionDiagnostics?.lastError) {
    titleParts.push(`Last error: ${selectionDiagnostics.lastError}`);
  }
  return titleParts.length > 0 ? titleParts.join(' | ') : undefined;
};

export const buildOrchestratorSummary = (params: {
  pendingRequests: number;
  selectionDiagnostics: SelectionDiagnostics | null;
  selectionDiagnosticsError: string | null;
}): SummaryCardData => {
  const { pendingRequests, selectionDiagnostics, selectionDiagnosticsError } = params;
  const queueDepth = selectionDiagnostics?.activeQueueDepth ?? 0;
  const queueP95 = selectionDiagnostics?.queueP95Ms ?? 0;
  const totalMutations = selectionDiagnostics?.totalMutations ?? 0;
  const failedMutations = selectionDiagnostics?.failedMutations ?? 0;
  const canceledMutations = selectionDiagnostics?.canceledMutations ?? 0;
  const supersededMutations = selectionDiagnostics?.supersededMutations ?? 0;
  const diagnosticsUnavailable = Boolean(selectionDiagnosticsError && !selectionDiagnostics);

  const breakdown = `Pending ${pendingRequests} • Queue ${queueDepth} • p95 ${queueP95} ms • Total ${totalMutations} • Failed ${failedMutations} • Canceled ${canceledMutations} • Superseded ${supersededMutations}`;
  const detailTitle = orchestratorSummaryTitle(selectionDiagnostics, selectionDiagnosticsError);
  return {
    primary: `${pendingRequests} pending`,
    secondary: `Queue ${queueDepth} · p95 ${queueP95} ms`,
    className: orchestratorSummaryClassName(
      pendingRequests,
      queueDepth,
      failedMutations,
      diagnosticsUnavailable
    ),
    title: detailTitle ? `${breakdown} | ${detailTitle}` : breakdown,
  };
};

interface MetricsSummaryPresentation {
  statusText: string;
  pollsText: string;
  className?: string;
  title?: string;
  isIdle: boolean;
}

const resolveMetricsSummaryPresentation = (
  telemetryMetrics: TelemetryMetricsStatus | undefined,
  telemetrySummary: TelemetrySummary | null,
  telemetryError: string | null
): MetricsSummaryPresentation => {
  const isIdle = telemetryMetrics?.active === false;
  if (telemetryError && !telemetrySummary) {
    return {
      statusText: 'Unavailable',
      pollsText: '—',
      className: 'diagnostics-summary-warning',
      title: telemetryError,
      isIdle,
    };
  }
  if (!telemetryMetrics) {
    return {
      statusText: telemetrySummary ? 'No data' : 'Loading…',
      pollsText: '—',
      isIdle,
    };
  }
  if (telemetryMetrics.lastError) {
    return {
      statusText: 'Error',
      pollsText: String(telemetryMetrics.successCount),
      className: 'diagnostics-summary-error',
      title: telemetryMetrics.lastError,
      isIdle,
    };
  }
  if (telemetryMetrics.consecutiveFailures > 0) {
    return {
      statusText: 'Retrying',
      pollsText: String(telemetryMetrics.successCount),
      className: 'diagnostics-summary-warning',
      isIdle,
    };
  }
  return {
    statusText: isIdle ? 'Idle' : 'OK',
    pollsText: String(telemetryMetrics.successCount),
    isIdle,
  };
};

const buildMetricsTooltip = (
  telemetryMetrics: TelemetryMetricsStatus | undefined,
  updatedTooltip: string,
  isIdle: boolean
): string | undefined => {
  const tooltipParts: string[] = [];
  if (isIdle) {
    tooltipParts.push('Polling idle (no active metrics views)');
  }
  if (telemetryMetrics?.failureCount) {
    tooltipParts.push(`Failures: ${telemetryMetrics.failureCount}`);
  }
  if (updatedTooltip) {
    tooltipParts.push(`Updated ${updatedTooltip}`);
  }
  return tooltipParts.length > 0 ? tooltipParts.join(' | ') : undefined;
};

export const buildMetricsSummary = (params: {
  telemetryMetrics?: TelemetryMetricsStatus;
  telemetrySummary: TelemetrySummary | null;
  telemetryError: string | null;
}): SummaryCardData => {
  const { telemetryMetrics, telemetrySummary, telemetryError } = params;
  const updatedInfo = formatLastUpdated(telemetryMetrics?.lastCollected);
  const presentation = resolveMetricsSummaryPresentation(
    telemetryMetrics,
    telemetrySummary,
    telemetryError
  );
  const tooltip = buildMetricsTooltip(telemetryMetrics, updatedInfo.tooltip, presentation.isIdle);

  return {
    primary: presentation.statusText,
    secondary: `${presentation.pollsText} polls · ${updatedInfo.display}`,
    className: presentation.className,
    title: presentation.title ?? tooltip,
  };
};

export const buildEventStreamSummary = (params: {
  eventStreamTelemetry?: TelemetryStreamStatus;
  telemetrySummary: TelemetrySummary | null;
  telemetryError: string | null;
}): SummaryCardData => {
  const { eventStreamTelemetry, telemetrySummary, telemetryError } = params;
  if (eventStreamTelemetry) {
    const updatedInfo = formatLastUpdated(eventStreamTelemetry.lastConnect);
    const newestInfo = formatLastUpdated(eventStreamTelemetry.lastEvent);
    let className: string | undefined;

    if (eventStreamTelemetry.errorCount > 0) {
      className = 'diagnostics-summary-error';
    } else if (eventStreamTelemetry.droppedMessages > 0) {
      className = 'diagnostics-summary-warning';
    } else {
      className = undefined;
    }

    const tooltipParts: string[] = [];
    if (eventStreamTelemetry.lastError) {
      tooltipParts.push(eventStreamTelemetry.lastError);
    }
    if (updatedInfo.tooltip) {
      tooltipParts.push(`Updated ${updatedInfo.tooltip}`);
    }
    if (newestInfo.tooltip) {
      tooltipParts.push(`Newest event ${newestInfo.tooltip}`);
    }
    tooltipParts.unshift(
      `Active ${eventStreamTelemetry.activeSessions} • Delivered ${eventStreamTelemetry.totalMessages} • Dropped ${eventStreamTelemetry.droppedMessages} • Newest event ${newestInfo.display}`
    );
    return {
      primary: `${eventStreamTelemetry.totalMessages} delivered`,
      secondary: `${eventStreamTelemetry.activeSessions} active · ${updatedInfo.display}`,
      className,
      title: tooltipParts.join(' | '),
    };
  }

  if (telemetryError && !telemetrySummary) {
    return {
      primary: '—',
      secondary: 'no telemetry',
      className: 'diagnostics-summary-warning',
      title: telemetryError,
    };
  }

  return {
    primary: '—',
    secondary: 'idle',
    className: undefined,
    title: undefined,
  };
};

const streamSummaryClassName = (telemetry: TelemetryStreamStatus): string | undefined => {
  if (telemetry.errorCount > 0) {
    return 'diagnostics-summary-error';
  }
  return telemetry.droppedMessages > 0 ? 'diagnostics-summary-warning' : undefined;
};

const buildCatalogStreamSummary = (
  telemetry: TelemetryStreamStatus,
  firstRowLatencyMs: number | null,
  firstRowDisplay: string
): SummaryCardData => {
  const updatedInfo = formatLastUpdated(telemetry.lastConnect);
  const newestInfo = formatLastUpdated(telemetry.lastEvent);
  const tooltipParts: string[] = [];
  if (telemetry.lastError) {
    tooltipParts.push(telemetry.lastError);
  }
  if (firstRowLatencyMs && firstRowLatencyMs > 0) {
    tooltipParts.push(`First row in ${firstRowDisplay}`);
  }
  if (updatedInfo.tooltip) {
    tooltipParts.push(`Updated ${updatedInfo.tooltip}`);
  }
  if (newestInfo.tooltip) {
    tooltipParts.push(`Latest batch ${newestInfo.tooltip}`);
  }
  tooltipParts.unshift(
    `Active ${telemetry.activeSessions} • Batches ${telemetry.totalMessages} • Dropped ${telemetry.droppedMessages} • Latest batch ${newestInfo.display} • First row ${firstRowDisplay}`
  );
  return {
    primary: `${telemetry.totalMessages} batches`,
    secondary: `${telemetry.activeSessions} active · ${updatedInfo.display}`,
    className: streamSummaryClassName(telemetry),
    title: tooltipParts.join(' | '),
  };
};

export const buildCatalogSummary = (params: {
  catalogState: DomainSnapshotState<unknown>;
  catalogStreamTelemetry?: TelemetryStreamStatus;
  telemetrySummary: TelemetrySummary | null;
  telemetryError: string | null;
}): SummaryCardData => {
  const { catalogState, catalogStreamTelemetry, telemetrySummary, telemetryError } = params;
  const catalogSnapshot = catalogState.data as CatalogSnapshotPayload | null;
  const firstRowLatencyMs =
    catalogState.stats?.timeToFirstRowMs ?? catalogSnapshot?.firstBatchLatencyMs ?? null;
  const firstRowDisplay = formatDurationMs(firstRowLatencyMs);

  if (catalogStreamTelemetry) {
    return buildCatalogStreamSummary(catalogStreamTelemetry, firstRowLatencyMs, firstRowDisplay);
  }

  if (telemetryError && !telemetrySummary) {
    return {
      primary: 'Active: — • Batches: — • Dropped: —',
      secondary: 'Updated: — • Latest Batch: — • First Row: —',
      className: 'diagnostics-summary-warning',
      title: telemetryError,
    };
  }

  return {
    primary: 'Active: — • Batches: — • Dropped: —',
    secondary: 'Updated: — • Latest Batch: — • First Row: —',
    className: undefined,
    title: undefined,
  };
};

interface ContainerLogsSummaryStats {
  totalScopes: number;
  activeScopes: number;
  errorScopes: number;
  lastUpdatedInfo: ReturnType<typeof formatLastUpdated>;
}

const buildContainerLogsStats = (
  entries: Array<[string, DomainSnapshotState<unknown>]>
): ContainerLogsSummaryStats => {
  const activeScopes = entries.filter(([, state]) =>
    ['ready', 'loading', 'updating'].includes(state.status)
  ).length;
  const errorScopes = entries.filter(([, state]) => state.status === 'error').length;
  const latestUpdate = entries.reduce((latest, [, state]) => {
    const timestamp = state.lastUpdated ?? state.lastAutoRefresh ?? state.lastManualRefresh ?? 0;
    return Math.max(latest, timestamp);
  }, 0);
  return {
    totalScopes: entries.length,
    activeScopes,
    errorScopes,
    lastUpdatedInfo: formatLastUpdated(latestUpdate > 0 ? latestUpdate : undefined),
  };
};

// The headline is the one number worth a glance; buildContainerLogsBreakdown
// keeps the rest for the tooltip.
const buildContainerLogsPrimary = (
  stats: ContainerLogsSummaryStats,
  telemetry?: TelemetryStreamStatus
): string => (telemetry ? `${telemetry.totalMessages} delivered` : `${stats.totalScopes} scopes`);

const buildContainerLogsSupporting = (
  stats: ContainerLogsSummaryStats,
  updatedDisplay: string
): string => `${stats.activeScopes} active · ${updatedDisplay}`;

const buildContainerLogsBreakdown = (
  stats: ContainerLogsSummaryStats,
  telemetry?: TelemetryStreamStatus
): string => {
  const parts = [`Scopes: ${stats.totalScopes}`, `Active Scopes: ${stats.activeScopes}`];
  if (telemetry) {
    parts.push(
      `Sessions: ${telemetry.activeSessions}`,
      `Delivered: ${telemetry.totalMessages}`,
      `Dropped: ${telemetry.droppedMessages}`
    );
    if (telemetry.skippedTargets > 0) {
      parts.push(`Skipped Targets: ${telemetry.skippedTargets}`);
    }
  }
  return parts.join(' • ');
};

const buildContainerLogsSecondary = (
  updatedDisplay: string,
  lastConnectDisplay: string,
  lastEventDisplay: string,
  hasTelemetry: boolean
): string => {
  const parts = [`Updated: ${updatedDisplay}`];
  if (hasTelemetry) {
    parts.push(`Last Connect: ${lastConnectDisplay}`, `Last Stream: ${lastEventDisplay}`);
  }
  return parts.join(' • ');
};

const buildContainerLogsTitle = (
  stats: ContainerLogsSummaryStats,
  telemetry: TelemetryStreamStatus | undefined,
  lastConnectTooltip: string
): string | undefined => {
  const parts: string[] = [];
  if (stats.errorScopes > 0) {
    const suffix = stats.errorScopes === 1 ? '' : 's';
    parts.push(`${stats.errorScopes} scope${suffix} reporting errors`);
  }
  if (stats.lastUpdatedInfo.tooltip) {
    parts.push(`Updated ${stats.lastUpdatedInfo.tooltip}`);
  }
  if (telemetry?.lastError) {
    parts.push(telemetry.lastError);
  }
  if (telemetry?.lastSkipReason) {
    parts.push(telemetry.lastSkipReason);
  }
  if (lastConnectTooltip) {
    parts.push(`Connected ${lastConnectTooltip}`);
  }
  return parts.length > 0 ? parts.join(' | ') : undefined;
};

const containerLogsSummaryClassName = (
  errorScopes: number,
  telemetry?: TelemetryStreamStatus
): string | undefined => {
  if (errorScopes > 0) {
    return 'diagnostics-summary-error';
  }
  return telemetry && (telemetry.droppedMessages > 0 || telemetry.skippedTargets > 0)
    ? 'diagnostics-summary-warning'
    : undefined;
};

export const buildContainerLogsSummary = (params: {
  containerLogsScopeEntries: Array<[string, DomainSnapshotState<unknown>]>;
  containerLogsStreamTelemetry?: TelemetryStreamStatus;
}): SummaryCardData => {
  const { containerLogsScopeEntries, containerLogsStreamTelemetry } = params;
  const stats = buildContainerLogsStats(containerLogsScopeEntries);
  const lastConnectInfo = formatLastUpdated(
    containerLogsStreamTelemetry?.lastConnect && containerLogsStreamTelemetry.lastConnect > 0
      ? containerLogsStreamTelemetry.lastConnect
      : undefined
  );
  const lastEventInfo = formatLastUpdated(
    containerLogsStreamTelemetry?.lastEvent && containerLogsStreamTelemetry.lastEvent > 0
      ? containerLogsStreamTelemetry.lastEvent
      : undefined
  );

  const breakdown = [
    buildContainerLogsBreakdown(stats, containerLogsStreamTelemetry),
    buildContainerLogsSecondary(
      stats.lastUpdatedInfo.display,
      lastConnectInfo.display,
      lastEventInfo.display,
      Boolean(containerLogsStreamTelemetry)
    ),
    buildContainerLogsTitle(stats, containerLogsStreamTelemetry, lastConnectInfo.tooltip),
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    primary: buildContainerLogsPrimary(stats, containerLogsStreamTelemetry),
    secondary: buildContainerLogsSupporting(stats, stats.lastUpdatedInfo.display),
    className: containerLogsSummaryClassName(stats.errorScopes, containerLogsStreamTelemetry),
    title: breakdown,
  };
};
