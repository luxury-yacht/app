/**
 * frontend/src/core/refresh/components/RefreshDiagnosticsPanel.tsx
 *
 * Renders the refresh diagnostics panel. It combines refresh-domain state,
 * stream health, permission diagnostics, broker reads, and table diagnostics
 * into the developer-facing runtime inspection surface.
 */

import React, {
  type HTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import './DiagnosticsPanel.css';
import {
  resetGridTablePerformanceDiagnostics,
  useGridTablePerformanceDiagnostics,
} from '@shared/components/tables/performance/gridTablePerformanceStore';
import { type TabDescriptor, Tabs } from '@shared/components/tabs';
import { DockablePanel } from '@ui/dockable';
import { useKeyboardSurface, useShortcut } from '@ui/shortcuts';
import { KeyboardScopePriority } from '@ui/shortcuts/priorities';
import { errorHandler } from '@utils/errorHandler';
import { useCapabilityDiagnostics, useUserPermissions } from '@/core/capabilities';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { useBrokerReadDiagnostics } from '@/core/read-diagnostics';
import { parseClusterScopeList, stripClusterScope } from '@/core/refresh/clusterScope';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@/modules/namespace/contexts/NamespaceContext';
import {
  fetchKubernetesAPIClientDiagnostics,
  fetchSelectionDiagnostics,
  fetchTelemetrySummary,
  type KubernetesAPIClientDiagnostics,
  type NormalizedTelemetrySummary,
  type SelectionDiagnostics,
} from '../client';
import { refreshOrchestrator } from '../orchestrator';
import { refreshManager } from '../RefreshManager';
import { type DomainSnapshotState, useRefreshScopedDomainEntries, useRefreshState } from '../store';
import { resourceStreamManager } from '../streaming/resourceStreamManager';
import type {
  ContainerLogsSnapshotPayload,
  NodeMetricsInfo,
  PodSnapshotPayload,
  RefreshDomain,
  TelemetryStreamStatus,
} from '../types';

// Import from extracted modules
import {
  buildBrokerReadRows,
  buildBrokerReadsSummary,
  buildCapabilityBatchRows,
  buildCatalogSummary,
  buildContainerLogsSummary,
  buildDiagnosticsStreamRows,
  buildDiagnosticsStreamSummary,
  buildEventStreamSummary,
  buildKubernetesAPIClientRows,
  buildKubernetesAPISummary,
  buildMetricsSummary,
  buildOrchestratorSummary,
  buildPermissionRows,
  type CapabilityBatchRow,
  CLUSTER_SCOPE,
  type DiagnosticsPanelProps,
  type DiagnosticsRow,
  DOMAIN_REFRESHER_MAP,
  DOMAIN_STREAM_MAP,
  dedupeDiagnosticsRows,
  formatInterval,
  formatLastUpdated,
  getScopedFeaturesForView,
  PAUSE_POLLING_WHEN_STREAMING_DOMAINS,
  PRIORITY_DOMAINS,
  resolveDomainNamespace,
  STALE_THRESHOLD_MS,
  STREAM_MODE_BY_NAME,
  STREAM_ONLY_DOMAINS,
} from './diagnostics';
import { GridTablePerformance } from './diagnostics/GridTablePerformance';
import { resolveModeDetails } from './diagnostics/modeDetails';
import { BrokerReadsTable } from './diagnostics/TableBrokerReads';
import { CapabilityChecksTable } from './diagnostics/TableCapabilitesChecks';
import { EffectivePermissionsTable } from './diagnostics/TableEffectivePermissions';
import { KubernetesAPIClientsTable } from './diagnostics/TableKubernetesAPIClients';
import { DiagnosticsSummaryCards, DiagnosticsTable } from './diagnostics/TableRefreshDomains';
import { DiagnosticsStreamsTable } from './diagnostics/TableStreams';

// Re-export for backwards compatibility
export { resolveDomainNamespace } from './diagnostics';

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

type StreamHealthSummary = {
  status: HealthStatus;
  reason: string;
  connectionStatus?: 'connected' | 'disconnected';
  lastMessageAt?: number;
  lastDeliveryAt?: number;
};

const PERMISSION_ERROR_HINTS = ['forbidden', 'permission', 'unauthorized', 'access denied', 'rbac'];

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;

type DiagnosticsTabId =
  | 'refresh-domains'
  | 'streams'
  | 'k8s-api'
  | 'table-performance'
  | 'capability-checks'
  | 'effective-permissions'
  | 'broker-reads';

// Applied to every diagnostics tab via extraProps. The panel's custom focus
// walker (querySelectorAll below) locates tabs through this marker — if it
// ever stops being forwarded, keyboard navigation silently breaks.
// The cast is needed because TypeScript's HTMLAttributes type doesn't include
// an index signature for data-* attributes.
const DIAGNOSTICS_FOCUSABLE_PROPS = {
  'data-diagnostics-focusable': 'true',
} as HTMLAttributes<HTMLElement>;

const DIAGNOSTICS_TAB_DESCRIPTORS: TabDescriptor[] = [
  { id: 'k8s-api', label: 'K8s API', extraProps: DIAGNOSTICS_FOCUSABLE_PROPS },
  { id: 'refresh-domains', label: 'Refresh Domains', extraProps: DIAGNOSTICS_FOCUSABLE_PROPS },
  { id: 'streams', label: 'Streams', extraProps: DIAGNOSTICS_FOCUSABLE_PROPS },
  { id: 'broker-reads', label: 'Broker Reads', extraProps: DIAGNOSTICS_FOCUSABLE_PROPS },
  { id: 'table-performance', label: 'Tables', extraProps: DIAGNOSTICS_FOCUSABLE_PROPS },
  {
    id: 'capability-checks',
    label: 'Cap Checks',
    extraProps: DIAGNOSTICS_FOCUSABLE_PROPS,
  },
  {
    id: 'effective-permissions',
    label: 'Permissions',
    extraProps: DIAGNOSTICS_FOCUSABLE_PROPS,
  },
];

// Diagnostics helpers for scope, error, and health labels.
type ScopeEntry = { label: 'Active' | 'Background'; clusterName: string };

const MAX_SCOPE_QUERY_PARTS = 4;
const MAX_SCOPE_QUERY_VALUE_LENGTH = 48;

const formatScopeQueryValue = (value: string): string => {
  if (value.length <= MAX_SCOPE_QUERY_VALUE_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_SCOPE_QUERY_VALUE_LENGTH)}...`;
};

const formatScopeQuery = (query: string): string => {
  const trimmed = query.trim();
  if (!trimmed) {
    return '';
  }
  try {
    const params = new URLSearchParams(trimmed);
    const entries = Array.from(params.entries());
    if (entries.length === 0) {
      return trimmed;
    }
    const visibleEntries = entries
      .slice(0, MAX_SCOPE_QUERY_PARTS)
      .map(([key, value]) => `${key}=${formatScopeQueryValue(value)}`);
    if (entries.length > MAX_SCOPE_QUERY_PARTS) {
      visibleEntries.push(`+${entries.length - MAX_SCOPE_QUERY_PARTS} more`);
    }
    return visibleEntries.join(', ');
  } catch {
    return trimmed;
  }
};

const formatScopeTail = (scope: string): string => {
  const trimmed = scope.trim();
  const normalized = trimmed.toLowerCase();
  if (!trimmed || normalized === CLUSTER_SCOPE || normalized === 'cluster') {
    return '';
  }
  const queryIndex = trimmed.indexOf('?');
  if (queryIndex >= 0) {
    const base = trimmed.slice(0, queryIndex).trim();
    const query = formatScopeQuery(trimmed.slice(queryIndex + 1));
    return [base, query].filter(Boolean).join(' ? ');
  }
  if (trimmed.includes('=') || trimmed.includes('&')) {
    return formatScopeQuery(trimmed);
  }
  return trimmed;
};

const resolveScopeDetails = (
  scope: string | undefined,
  activeClusterId: string,
  getClusterMeta: (config: string) => { id: string; name: string }
): { display: string; tooltip?: string; entries?: ScopeEntry[] } => {
  const trimmed = (scope ?? '').trim();
  if (!trimmed) {
    return { display: '-', tooltip: 'No active scope' };
  }
  const { clusterIds, scope: scopeTail } = parseClusterScopeList(trimmed);
  if (clusterIds.length === 0) {
    return { display: trimmed, tooltip: trimmed };
  }
  const tailDisplay = formatScopeTail(scopeTail);
  // Build structured entries sorted with active cluster first.
  const entries: ScopeEntry[] = clusterIds
    .map((id) => {
      const meta = getClusterMeta(id);
      const name = meta.name || id;
      const isActive = id === activeClusterId;
      return {
        label: (isActive ? 'Active' : 'Background') as ScopeEntry['label'],
        clusterName: name,
      };
    })
    .sort((a, b) => {
      if (a.label === 'Active' && b.label !== 'Active') {
        return -1;
      }
      if (b.label === 'Active' && a.label !== 'Active') {
        return 1;
      }
      return a.clusterName.localeCompare(b.clusterName);
    });
  // Format as "cluster-A (active), cluster-B, cluster-C".
  const display = entries
    .map((e) => (e.label === 'Active' ? `${e.clusterName} (active)` : e.clusterName))
    .join(', ');
  if (tailDisplay) {
    return { display: `${display} - ${tailDisplay}`, tooltip: trimmed };
  }
  return { display, tooltip: trimmed, entries };
};

const parseScopeQueryParams = (scopeTail: string): URLSearchParams => {
  const trimmed = scopeTail.trim();
  const queryIndex = trimmed.indexOf('?');
  const query = queryIndex >= 0 ? trimmed.slice(queryIndex + 1) : trimmed;
  return new URLSearchParams(query);
};

const scopeTailHasQuery = (scopeTail: string): boolean =>
  scopeTail.includes('?') || scopeTail.includes('=') || scopeTail.includes('&');

const isTransientResourceTableQueryScope = (
  domain: RefreshDomain,
  scope: string | undefined
): boolean => {
  if (DOMAIN_STREAM_MAP[domain] !== 'resources') {
    return false;
  }
  const { scope: scopeTail } = parseClusterScopeList((scope ?? '').trim());
  return scopeTailHasQuery(scopeTail);
};

const FIXED_SCOPE_ROLES: Partial<Record<RefreshDomain, { label: string; tooltip: string }>> = {
  'catalog-diff': { label: 'Object Diff', tooltip: 'Object diff modal catalog query' },
  'container-logs': { label: 'Log Stream', tooltip: 'Object panel log stream scope' },
  'object-details': { label: 'Object Panel', tooltip: 'Scoped object panel data' },
  'object-events': { label: 'Object Panel', tooltip: 'Scoped object panel data' },
  'object-yaml': { label: 'Object Panel', tooltip: 'Scoped object panel data' },
  'object-helm-manifest': { label: 'Object Panel', tooltip: 'Scoped object panel data' },
  'object-helm-values': { label: 'Object Panel', tooltip: 'Scoped object panel data' },
  pods: { label: 'Object Panel', tooltip: 'Scoped object panel data' },
  'object-maintenance': { label: 'Operation', tooltip: 'Node maintenance operation state' },
  namespaces: { label: 'System', tooltip: 'System refresh scope' },
  'cluster-overview': { label: 'System', tooltip: 'System refresh scope' },
};

const resolveCatalogScopeRole = (scopeTail: string): { label: string; tooltip: string } => {
  const params = parseScopeQueryParams(scopeTail);
  return params.get('limit') === '1'
    ? {
        label: 'Metadata',
        tooltip: 'Catalog metadata/facet support query for the current Browse view',
      }
    : { label: 'Page Query', tooltip: 'Current Browse table page query' };
};

const resolveResourceStreamScopeRole = (scopeTail: string): { label: string; tooltip: string } => {
  if (scopeTailHasQuery(scopeTail)) {
    return {
      label: 'Table Query',
      tooltip: 'Query-backed GridTable snapshot for filters, sorting, or pagination',
    };
  }
  const normalizedTail = scopeTail.trim().toLowerCase();
  return {
    label: 'Live Scope',
    tooltip:
      !normalizedTail || normalizedTail === 'cluster'
        ? 'Base resource-stream scope retained for live data and metrics'
        : 'Resource-stream scope retained for live data and metrics',
  };
};

const resolveScopeRole = (
  domain: RefreshDomain,
  scope: string | undefined
): { label: string; tooltip?: string } => {
  const trimmed = (scope ?? '').trim();
  const { scope: scopeTail } = parseClusterScopeList(trimmed);
  if (domain === 'catalog') {
    return resolveCatalogScopeRole(scopeTail);
  }
  if (DOMAIN_STREAM_MAP[domain] === 'resources') {
    return resolveResourceStreamScopeRole(scopeTail);
  }
  return FIXED_SCOPE_ROLES[domain] ?? { label: 'Snapshot', tooltip: 'Snapshot refresh scope' };
};

const resolveErrorReason = (error?: string | null): string | null => {
  if (!error) {
    return null;
  }
  const trimmed = error.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.toLowerCase();
  if (PERMISSION_ERROR_HINTS.some((token) => normalized.includes(token))) {
    return 'permissions';
  }
  return trimmed;
};

const resolveStreamTelemetryHealth = (
  streamTelemetry?: TelemetryStreamStatus | null
): StreamHealthSummary | null => {
  if (!streamTelemetry) {
    return null;
  }
  if (streamTelemetry.activeSessions <= 0) {
    return { status: 'unhealthy', reason: 'inactive' };
  }
  if (streamTelemetry.lastError) {
    return { status: 'unhealthy', reason: streamTelemetry.lastError };
  }
  if (streamTelemetry.errorCount > 0) {
    return { status: 'unhealthy', reason: 'stream errors' };
  }
  if (streamTelemetry.droppedMessages > 0) {
    return { status: 'degraded', reason: 'dropped messages' };
  }
  if (streamTelemetry.totalMessages === 0) {
    return { status: 'degraded', reason: 'awaiting updates' };
  }
  return { status: 'healthy', reason: 'delivering' };
};

const formatHealthLabel = (status: HealthStatus, reason: string): string =>
  reason ? `${status} (${reason})` : status;

const resolveBrokerReadScope = (
  scopes: string[],
  activeClusterId: string,
  getClusterMeta: (config: string) => { id: string; name: string }
): { display: string; tooltip?: string } => {
  const trimmedScopes = scopes.map((scope) => scope.trim()).filter(Boolean);
  const trimmed = trimmedScopes[0] ?? '';
  if (!trimmed) {
    return { display: '—' };
  }

  const scopeDetails = resolveScopeDetails(trimmed, activeClusterId, getClusterMeta);
  const recentScopeCount = trimmedScopes.length;
  if (recentScopeCount <= 1) {
    return {
      display: scopeDetails.display,
      tooltip: scopeDetails.tooltip ?? trimmed,
    };
  }

  return {
    display: `${scopeDetails.display} (+${recentScopeCount - 1} more)`,
    tooltip: trimmedScopes.join(' || '),
  };
};

const emptyDomainSnapshotState = (): DomainSnapshotState<unknown> => ({
  status: 'idle',
  data: null,
  stats: null,
  error: null,
  droppedAutoRefreshes: 0,
});

const entryMatchesCluster = (
  entry: [string, DomainSnapshotState<unknown>],
  clusterId: string
): boolean => {
  const [scopeKey, state] = entry;
  return parseClusterScopeList(state.scope ?? scopeKey).clusterIds.includes(clusterId);
};

const entryHasClusterScope = (entry: [string, DomainSnapshotState<unknown>]): boolean => {
  const [scopeKey, state] = entry;
  return parseClusterScopeList(state.scope ?? scopeKey).clusterIds.length > 0;
};

const pickPreferredScopeState = (
  entries: Array<[string, DomainSnapshotState<unknown>]>,
  preferredClusterId: string | undefined
): DomainSnapshotState<unknown> => {
  if (entries.length === 0) {
    return emptyDomainSnapshotState();
  }
  const clusterId = (preferredClusterId ?? '').trim();
  const clusterMatches = clusterId
    ? entries.filter((entry) => entryMatchesCluster(entry, clusterId))
    : [];
  if (clusterId && clusterMatches.length === 0 && entries.some(entryHasClusterScope)) {
    return emptyDomainSnapshotState();
  }
  const candidates = clusterMatches.length > 0 ? clusterMatches : entries;
  const selected =
    candidates.find(([, state]) => state.data !== null) ??
    candidates.find(([, state]) => state.status !== 'idle') ??
    candidates[0];
  const [scopeKey, scopedState] = selected;
  return scopedState.scope?.trim() ? scopedState : { ...scopedState, scope: scopeKey };
};

const toStreamHealthSummary = (
  health: ReturnType<typeof resourceStreamManager.getHealthSnapshot> | null
): StreamHealthSummary | null => {
  if (!health) {
    return null;
  }
  return {
    status: health.status,
    reason: health.reason,
    connectionStatus: health.connectionStatus,
    lastMessageAt: health.lastMessageAt,
    lastDeliveryAt: health.lastDeliveryAt,
  };
};

const buildStreamHealthTooltip = (streamHealth: StreamHealthSummary): string[] => {
  const parts = [`Reason: ${streamHealth.reason}`];
  if (streamHealth.connectionStatus) {
    parts.push(`Connection: ${streamHealth.connectionStatus}`);
  }
  if (streamHealth.lastDeliveryAt) {
    parts.push(`Last delivery: ${formatLastUpdated(streamHealth.lastDeliveryAt).tooltip}`);
  }
  if (streamHealth.lastMessageAt) {
    parts.push(`Last message: ${formatLastUpdated(streamHealth.lastMessageAt).tooltip}`);
  }
  return parts;
};

interface HealthDetails {
  label: string;
  tooltip?: string;
  status: HealthStatus;
}

const resolveStreamHealthDetails = (
  status: DiagnosticsRow['status'],
  streamHealth: StreamHealthSummary
): HealthDetails => {
  const tooltipParts = buildStreamHealthTooltip(streamHealth);
  if (streamHealth.reason === 'inactive' && status !== 'idle') {
    return {
      label: formatHealthLabel('degraded', 'inactive'),
      tooltip: ['Retained snapshot is ready; stream is inactive for this scope.']
        .concat(tooltipParts)
        .join('\n'),
      status: 'degraded',
    };
  }
  return {
    label: formatHealthLabel(streamHealth.status, streamHealth.reason),
    tooltip: tooltipParts.join('\n'),
    status: streamHealth.status,
  };
};

const resolveHealthDetails = (params: {
  domain: RefreshDomain;
  status: DiagnosticsRow['status'];
  error?: string | null;
  scope?: string;
  streamHealth?: StreamHealthSummary | null;
}): HealthDetails => {
  const { domain, status, error, scope, streamHealth } = params;
  const scopeTrimmed = (scope ?? '').trim();
  if (!scopeTrimmed && (domain === 'pods' || domain === 'container-logs')) {
    return {
      label: formatHealthLabel('unhealthy', 'no scope'),
      tooltip: 'No active scope',
      status: 'unhealthy',
    };
  }
  if (status === 'error') {
    const reason = resolveErrorReason(error) ?? 'error';
    return {
      label: formatHealthLabel('unhealthy', reason),
      tooltip: error ?? reason,
      status: 'unhealthy',
    };
  }
  if (streamHealth) {
    return resolveStreamHealthDetails(status, streamHealth);
  }
  if (status === 'loading' || status === 'initialising') {
    return {
      label: formatHealthLabel('degraded', status),
      tooltip: 'Awaiting snapshot data',
      status: 'degraded',
    };
  }
  if (status === 'idle') {
    return {
      label: formatHealthLabel('degraded', 'idle'),
      tooltip: 'Domain is idle',
      status: 'degraded',
    };
  }
  return {
    label: formatHealthLabel('healthy', 'ready'),
    tooltip: 'Snapshot data is up to date',
    status: 'healthy',
  };
};

interface PollingDetails {
  label: string;
  tooltip?: string;
  enabled: boolean;
}

const resolveDisabledPollingDetails = (
  domain: RefreshDomain,
  streamActive: boolean,
  streamHealthy: boolean
): PollingDetails => {
  if (PAUSE_POLLING_WHEN_STREAMING_DOMAINS.has(domain) && streamActive) {
    const reason = streamHealthy ? 'stream healthy' : 'stream active';
    return { label: 'paused', tooltip: `Paused while ${reason}`, enabled: false };
  }
  return { label: 'disabled', tooltip: 'Polling disabled for this domain', enabled: false };
};

const resolvePollingDetails = (params: {
  domain: RefreshDomain;
  refresherName?: (typeof DOMAIN_REFRESHER_MAP)[RefreshDomain];
  streamActive: boolean;
  streamHealthy: boolean;
}): PollingDetails => {
  const { domain, refresherName, streamActive, streamHealthy } = params;
  if (!refresherName) {
    return { label: '—', tooltip: 'No polling refresher', enabled: false };
  }
  const refresherState = refreshManager.getState(refresherName);
  if (!refresherState) {
    return { label: '—', tooltip: 'Polling not registered', enabled: false };
  }
  if (refresherState.status === 'paused') {
    return { label: 'paused', tooltip: 'Polling paused by auto-refresh', enabled: false };
  }
  if (refresherState.status === 'disabled') {
    return resolveDisabledPollingDetails(domain, streamActive, streamHealthy);
  }
  return { label: 'enabled', tooltip: `State: ${refresherState.status}`, enabled: true };
};

const ROW_COUNT_DOMAINS = new Set<RefreshDomain>([
  'nodes',
  'cluster-rbac',
  'cluster-storage',
  'cluster-config',
  'cluster-crds',
  'cluster-events',
  'namespace-workloads',
  'namespace-config',
  'namespace-network',
  'namespace-rbac',
  'namespace-storage',
  'namespace-autoscaling',
  'namespace-quotas',
  'namespace-events',
  'namespace-helm',
]);

const arrayLength = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

const resolveDomainCount = (
  domain: RefreshDomain,
  data: Record<string, unknown> | null
): number => {
  if (!data) {
    return 0;
  }
  if (domain === 'namespaces') {
    return arrayLength(data.namespaces);
  }
  if (domain === 'cluster-overview') {
    const totalNodes = asRecord(data.overview)?.totalNodes;
    return typeof totalNodes === 'number' ? totalNodes : 0;
  }
  if (domain === 'object-maintenance') {
    return arrayLength(data.drains);
  }
  if (domain === 'cluster-custom' || domain === 'namespace-custom') {
    return arrayLength(data.resources);
  }
  if (domain === 'catalog') {
    return arrayLength(data.items);
  }
  return ROW_COUNT_DOMAINS.has(domain) ? arrayLength(data.rows) : 0;
};

interface DiagnosticsCountDetails {
  count: number;
  countDisplay: string;
  countTooltip?: string;
  countClassName?: string;
  warnings: string[];
  truncated: boolean;
  totalItems?: number;
}

const filteredWarnings = (state: DomainSnapshotState<unknown>): string[] =>
  (state.stats?.warnings ?? []).filter((warning) => warning?.trim().length);

const buildDiagnosticsCountDetails = (
  count: number,
  state: DomainSnapshotState<unknown>,
  itemLabel: string
): DiagnosticsCountDetails => {
  const truncated = Boolean(state.stats?.truncated);
  const totalItems = state.stats?.totalItems ?? (truncated ? count : undefined);
  const warnings = filteredWarnings(state);
  if (truncated && totalItems !== undefined && warnings.length === 0 && count !== totalItems) {
    warnings.push(`Showing most recent ${count} of ${totalItems} ${itemLabel}`);
  }
  return {
    count,
    countDisplay:
      truncated && totalItems !== undefined ? `${count} / ${totalItems}` : String(count),
    countTooltip: warnings.length > 0 ? warnings.join('\n') : undefined,
    countClassName: warnings.length > 0 ? 'diagnostics-count-warning' : undefined,
    warnings,
    truncated,
    totalItems,
  };
};

const buildCatalogCountDetails = (
  data: Record<string, unknown> | null,
  state: DomainSnapshotState<unknown>
): DiagnosticsCountDetails => {
  const dataTotal = typeof data?.total === 'number' ? data.total : arrayLength(data?.items);
  const count = state.stats?.totalItems ?? dataTotal;
  const warnings = filteredWarnings(state);
  return {
    count,
    countDisplay: String(count),
    countTooltip: warnings.length > 0 ? warnings.join('\n') : undefined,
    countClassName: warnings.length > 0 ? 'diagnostics-count-warning' : undefined,
    warnings,
    truncated: false,
    totalItems: count,
  };
};

const resolveDiagnosticsCountDetails = (
  domain: RefreshDomain,
  state: DomainSnapshotState<unknown>,
  data: Record<string, unknown> | null
): DiagnosticsCountDetails =>
  domain === 'catalog'
    ? buildCatalogCountDetails(data, state)
    : buildDiagnosticsCountDetails(resolveDomainCount(domain, data), state, 'items');

type SnapshotTelemetryEntry = NormalizedTelemetrySummary['snapshots'][number];
type ResourceStreamStats = ReturnType<typeof resourceStreamManager.getTelemetrySummary>;

interface DomainTelemetrySources {
  telemetryInfo?: SnapshotTelemetryEntry;
  streamTelemetry?: TelemetryStreamStatus;
  isResourceStreamDomain: boolean;
  streamMode: Parameters<typeof resolveModeDetails>[0]['streamMode'];
}

const resolveDomainTelemetrySources = (
  domain: RefreshDomain,
  telemetrySummary: NormalizedTelemetrySummary | null
): DomainTelemetrySources => {
  const streamName = DOMAIN_STREAM_MAP[domain];
  return {
    telemetryInfo: telemetrySummary?.snapshots.find((entry) => entry.domain === domain),
    streamTelemetry: streamName
      ? telemetrySummary?.streams.find((entry) => entry.name === streamName)
      : undefined,
    isResourceStreamDomain: streamName === 'resources',
    streamMode: streamName ? (STREAM_MODE_BY_NAME[streamName] ?? 'streaming') : null,
  };
};

const formatTelemetryMilliseconds = (value: number | undefined): string =>
  value ? `${value} ms` : '—';

const resolveTelemetryError = (
  telemetryLastError: string,
  stateError: string | null | undefined
): string => telemetryLastError || stateError || '—';

const resolveStreamDropped = (
  isResourceStreamDomain: boolean,
  streamTelemetry: TelemetryStreamStatus | undefined
): number => (isResourceStreamDomain ? (streamTelemetry?.droppedMessages ?? 0) : 0);

const resolveStreamActive = (
  isResourceStreamDomain: boolean,
  streamTelemetry: TelemetryStreamStatus | undefined,
  streamHealth: StreamHealthSummary | null
): boolean =>
  isResourceStreamDomain
    ? Boolean(streamHealth && streamHealth.reason !== 'inactive')
    : Boolean(streamTelemetry?.activeSessions);

const isTimestampStale = (timestamp: number | undefined): boolean =>
  timestamp ? Date.now() - timestamp > STALE_THRESHOLD_MS : false;

const resolveSnapshotTelemetryStatus = (
  telemetrySummary: NormalizedTelemetrySummary | null,
  telemetryInfo: SnapshotTelemetryEntry | undefined
): string => {
  if (!telemetrySummary) {
    return '—';
  }
  if (!telemetryInfo) {
    return 'No data';
  }
  return telemetryInfo.lastStatus === 'error'
    ? `Error (${telemetryInfo.failureCount})`
    : `Success (${telemetryInfo.successCount})`;
};

const resolveStreamTelemetryStatus = (
  isResourceStreamDomain: boolean,
  streamTelemetry: TelemetryStreamStatus | undefined
): string | null => {
  if (!isResourceStreamDomain || !streamTelemetry) {
    return null;
  }
  if (streamTelemetry.errorCount > 0) {
    return `Stream Error (${streamTelemetry.errorCount})`;
  }
  return streamTelemetry.droppedMessages > 0
    ? `Stream Dropped (${streamTelemetry.droppedMessages})`
    : 'Stream OK';
};

const resolveStreamHealthStatus = (streamHealth: StreamHealthSummary | null): string | null => {
  if (!streamHealth) {
    return null;
  }
  return streamHealth.reason === 'inactive' ? 'Stream inactive' : `Stream ${streamHealth.status}`;
};

const appendResourceStreamTelemetryTooltip = (
  parts: string[],
  streamTelemetry: TelemetryStreamStatus,
  resourceStreamStats: ResourceStreamStats
) => {
  parts.push(
    `Stream delivered: ${streamTelemetry.totalMessages}`,
    `Stream dropped: ${streamTelemetry.droppedMessages}`
  );
  if (streamTelemetry.lastError) {
    parts.push(`Stream error: ${streamTelemetry.lastError}`);
  }
  if (resourceStreamStats.resyncCount > 0) {
    parts.push(`Stream resyncs: ${resourceStreamStats.resyncCount}`);
  }
  if (resourceStreamStats.fallbackCount > 0) {
    parts.push(`Stream fallbacks: ${resourceStreamStats.fallbackCount}`);
  }
  if (resourceStreamStats.lastResyncReason) {
    parts.push(`Last resync: ${resourceStreamStats.lastResyncReason}`);
  }
  if (resourceStreamStats.lastFallbackReason) {
    parts.push(`Last fallback: ${resourceStreamStats.lastFallbackReason}`);
  }
};

const appendStreamHealthTelemetryTooltip = (parts: string[], streamHealth: StreamHealthSummary) => {
  parts.push(`Stream health: ${streamHealth.status}`, `Stream reason: ${streamHealth.reason}`);
  if (streamHealth.lastDeliveryAt) {
    parts.push(`Stream last delivery: ${formatLastUpdated(streamHealth.lastDeliveryAt).tooltip}`);
  }
  if (streamHealth.lastMessageAt) {
    parts.push(`Stream last message: ${formatLastUpdated(streamHealth.lastMessageAt).tooltip}`);
  }
};

const buildTelemetryTooltip = (params: {
  telemetryLastError: string;
  isResourceStreamDomain: boolean;
  streamTelemetry?: TelemetryStreamStatus;
  resourceStreamStats: ResourceStreamStats;
  streamHealth: StreamHealthSummary | null;
}): string | undefined => {
  const parts: string[] = [];
  if (params.telemetryLastError) {
    parts.push(params.telemetryLastError);
  }
  if (params.isResourceStreamDomain && params.streamTelemetry) {
    appendResourceStreamTelemetryTooltip(parts, params.streamTelemetry, params.resourceStreamStats);
  }
  if (params.streamHealth) {
    appendStreamHealthTelemetryTooltip(parts, params.streamHealth);
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
};

const resolveTelemetryLastUpdated = (
  streamLastEvent: number | undefined,
  telemetryInfo: SnapshotTelemetryEntry | undefined
): ReturnType<typeof formatLastUpdated> | null => {
  if (streamLastEvent && streamLastEvent > 0) {
    return formatLastUpdated(streamLastEvent);
  }
  return telemetryInfo?.lastUpdated ? formatLastUpdated(telemetryInfo.lastUpdated) : null;
};

const resolveStreamHealth = (
  domain: RefreshDomain,
  scope: string | undefined,
  isResourceStreamDomain: boolean,
  streamTelemetry: TelemetryStreamStatus | undefined
): StreamHealthSummary | null =>
  isResourceStreamDomain && scope
    ? toStreamHealthSummary(resourceStreamManager.getHealthSnapshot(domain, scope))
    : resolveStreamTelemetryHealth(streamTelemetry);

interface DomainTelemetryDetails {
  streamMode: Parameters<typeof resolveModeDetails>[0]['streamMode'];
  lastUpdated: number | undefined;
  telemetryLastUpdatedInfo: ReturnType<typeof formatLastUpdated> | null;
  combinedError: string;
  telemetryStatus: string;
  telemetryTooltip?: string;
  streamDropped: number;
  telemetrySuccess?: number;
  telemetryFailure?: number;
  durationLabel: string;
  syncWaitLabel: string;
  streamHealth: StreamHealthSummary | null;
  streamActive: boolean;
  streamHealthy: boolean;
}

const buildDomainTelemetryDetails = (params: {
  domain: RefreshDomain;
  state: DomainSnapshotState<unknown>;
  scope?: string;
  telemetrySummary: NormalizedTelemetrySummary | null;
  resourceStreamStats: ResourceStreamStats;
}): DomainTelemetryDetails => {
  const { domain, state, scope, telemetrySummary, resourceStreamStats } = params;
  const { telemetryInfo, streamTelemetry, isResourceStreamDomain, streamMode } =
    resolveDomainTelemetrySources(domain, telemetrySummary);
  const streamLastEvent = isResourceStreamDomain ? streamTelemetry?.lastEvent : 0;
  const baseLastUpdated = state.lastUpdated ?? state.lastAutoRefresh ?? state.lastManualRefresh;
  const combinedLastUpdated = Math.max(baseLastUpdated ?? 0, streamLastEvent ?? 0);
  const streamHealth = resolveStreamHealth(domain, scope, isResourceStreamDomain, streamTelemetry);
  const telemetryLastError = telemetryInfo?.lastError?.trim() ?? '';
  return {
    streamMode,
    lastUpdated: combinedLastUpdated > 0 ? combinedLastUpdated : undefined,
    telemetryLastUpdatedInfo: resolveTelemetryLastUpdated(streamLastEvent, telemetryInfo),
    combinedError: resolveTelemetryError(telemetryLastError, state.error),
    telemetryStatus: [
      resolveSnapshotTelemetryStatus(telemetrySummary, telemetryInfo),
      resolveStreamTelemetryStatus(isResourceStreamDomain, streamTelemetry),
      resolveStreamHealthStatus(streamHealth),
    ]
      .filter(Boolean)
      .join(' • '),
    telemetryTooltip: buildTelemetryTooltip({
      telemetryLastError,
      isResourceStreamDomain,
      streamTelemetry,
      resourceStreamStats,
      streamHealth,
    }),
    streamDropped: resolveStreamDropped(isResourceStreamDomain, streamTelemetry),
    telemetrySuccess: telemetryInfo?.successCount,
    telemetryFailure: telemetryInfo?.failureCount,
    durationLabel: formatTelemetryMilliseconds(telemetryInfo?.lastDurationMs),
    syncWaitLabel: formatTelemetryMilliseconds(telemetryInfo?.maxInformerSyncWaitMs),
    streamHealth,
    streamActive: resolveStreamActive(isResourceStreamDomain, streamTelemetry, streamHealth),
    streamHealthy: streamHealth?.status === 'healthy',
  };
};

const resolveNodeMetricsInfo = (
  state: DomainSnapshotState<unknown>,
  hasMetrics: boolean
): NodeMetricsInfo | undefined => {
  if (!hasMetrics) {
    return undefined;
  }
  const metrics = asRecord(state.data)?.metrics;
  return asRecord(metrics) ? (metrics as NodeMetricsInfo) : undefined;
};

const resolveMetricsStatus = (
  metricsInfo: NodeMetricsInfo | undefined,
  hasMetrics: boolean,
  successCount: number | undefined,
  failureCount: number | undefined
): string => {
  if (!hasMetrics) {
    return '—';
  }
  if (!metricsInfo) {
    return 'N/A';
  }
  if (metricsInfo.lastError) {
    return `Error (${failureCount} fails)`;
  }
  return metricsInfo.stale ? `Unavailable (${failureCount} fails)` : `OK (${successCount} polls)`;
};

const resolveMetricsTooltip = (
  metricsInfo: NodeMetricsInfo | undefined,
  hasMetrics: boolean,
  successCount: number | undefined,
  failureCount: number | undefined
): string => {
  if (!metricsInfo) {
    return hasMetrics ? 'No metrics available' : 'Not applicable';
  }
  const lines = [`Successful polls: ${successCount}`, `Failed polls: ${failureCount}`];
  if (metricsInfo.lastError) {
    lines.push(`Last error: ${metricsInfo.lastError}`);
  } else if (metricsInfo.stale) {
    lines.push('Metrics API unavailable');
  } else if (metricsInfo.collectedAt) {
    lines.push('Metrics are up to date');
  }
  return lines.join('\n');
};

const buildDomainMetricsDetails = (state: DomainSnapshotState<unknown>, hasMetrics: boolean) => {
  const metricsInfo = resolveNodeMetricsInfo(state, hasMetrics);
  const successCount = metricsInfo?.successCount ?? (hasMetrics ? 0 : undefined);
  const failureCount = metricsInfo?.failureCount ?? (hasMetrics ? 0 : undefined);
  return {
    metricsInfo,
    successCount,
    failureCount,
    metricsStatus: resolveMetricsStatus(metricsInfo, hasMetrics, successCount, failureCount),
    metricsTooltip: resolveMetricsTooltip(metricsInfo, hasMetrics, successCount, failureCount),
  };
};

type GetClusterMeta = (config: string) => { id: string; name: string };

interface ScopedRowContext {
  selectedClusterId: string;
  getClusterMeta: GetClusterMeta;
}

const stateLastUpdated = (state: DomainSnapshotState<unknown>): number | undefined =>
  state.lastUpdated ?? state.lastAutoRefresh ?? state.lastManualRefresh;

const stateVersion = (state: DomainSnapshotState<unknown>): string =>
  state.version !== null && state.version !== undefined ? String(state.version) : '—';

const resolvePodLabel = (scope: string): string => {
  const displayScope = stripClusterScope(scope);
  if (displayScope.startsWith('namespace:')) {
    const namespace = displayScope.slice('namespace:'.length) || 'all';
    return namespace === 'all'
      ? 'ObjPanel - Pods - All namespaces'
      : `ObjPanel - Pods - ${namespace}`;
  }
  if (displayScope.startsWith('node:')) {
    return `ObjPanel - Pods - ${displayScope.slice('node:'.length)}`;
  }
  if (displayScope.startsWith('workload:')) {
    const parts = displayScope.split(':');
    return `ObjPanel - Pods - ${parts[parts.length - 1]}`;
  }
  return 'ObjPanel - Pods';
};

const buildPodTelemetryTooltip = (
  error: string | null | undefined,
  streamHealth: StreamHealthSummary | null
): string | undefined => {
  const parts: string[] = [];
  if (error) {
    parts.push(error);
  }
  if (streamHealth) {
    appendStreamHealthTelemetryTooltip(parts, streamHealth);
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
};

const buildPodDiagnosticsRow = (
  [scope, state]: [string, DomainSnapshotState<unknown>],
  context: ScopedRowContext
): DiagnosticsRow => {
  const payload = state.data as PodSnapshotPayload | null;
  const lastUpdated = stateLastUpdated(state);
  const lastUpdatedInfo = formatLastUpdated(lastUpdated);
  const refresherName = DOMAIN_REFRESHER_MAP.pods;
  const streamHealth = toStreamHealthSummary(
    resourceStreamManager.getHealthSnapshot('pods', scope)
  );
  const streamActive = Boolean(streamHealth && streamHealth.reason !== 'inactive');
  const streamHealthy = streamHealth?.status === 'healthy';
  const pollingDetails = resolvePollingDetails({
    domain: 'pods',
    refresherName,
    streamActive,
    streamHealthy,
  });
  const modeDetails = resolveModeDetails({
    domain: 'pods',
    streamMode: STREAM_MODE_BY_NAME.resources,
    streamActive,
    streamHealthy,
    pollingEnabled: pollingDetails.enabled,
    streamingBlocked: refreshOrchestrator.isStreamingBlocked('pods', scope),
    streamOnly: STREAM_ONLY_DOMAINS.has('pods'),
  });
  const healthDetails = resolveHealthDetails({
    domain: 'pods',
    status: state.status,
    error: state.error,
    scope,
    streamHealth,
  });
  const scopeDetails = resolveScopeDetails(
    scope,
    context.selectedClusterId,
    context.getClusterMeta
  );
  const roleDetails = resolveScopeRole('pods', scope);
  const countDetails = buildDiagnosticsCountDetails(payload?.rows?.length ?? 0, state, 'pods');
  return {
    rowKey: `pods:${scope}`,
    domain: 'pods',
    label: resolvePodLabel(scope),
    status: state.status,
    version: stateVersion(state),
    interval: formatInterval(
      refresherName ? refreshManager.getRefresherInterval(refresherName) : null
    ),
    lastUpdated: lastUpdatedInfo.display,
    lastUpdatedTooltip: lastUpdatedInfo.tooltip,
    duration: '—',
    dropped: state.droppedAutoRefreshes,
    stale: lastUpdated ? Date.now() - lastUpdated > STALE_THRESHOLD_MS : false,
    error: state.error ?? '—',
    telemetryStatus: [state.status, streamHealth ? `Stream ${streamHealth.status}` : null]
      .filter(Boolean)
      .join(' • '),
    telemetryTooltip: buildPodTelemetryTooltip(state.error, streamHealth),
    metricsStatus: 'N/A',
    metricsTooltip: 'Pod usage is joined onto the pods rows at serve',
    hasMetrics: false,
    ...countDetails,
    namespace: resolveDomainNamespace('pods', scope),
    scope: scopeDetails.display,
    scopeTooltip: scopeDetails.tooltip,
    role: roleDetails.label,
    roleTooltip: roleDetails.tooltip,
    scopeEntries: scopeDetails.entries,
    mode: modeDetails.label,
    modeTooltip: modeDetails.tooltip,
    healthStatus: healthDetails.label,
    healthTooltip: healthDetails.tooltip,
    pollingStatus: pollingDetails.label,
    pollingTooltip: pollingDetails.tooltip,
  };
};

const resolveObjectPanelScopeIdentity = (
  scope: string
): { namespaceLabel: string; name: string } => {
  const parts = stripClusterScope(scope).split(':');
  const namespace = parts[0] ?? '';
  return {
    namespaceLabel: namespace && namespace !== CLUSTER_SCOPE ? namespace : '-',
    name: parts.slice(2).join(':'),
  };
};

interface ContainerLogsRowContext extends ScopedRowContext {
  streamHealth: StreamHealthSummary | null;
  modeDetails: ReturnType<typeof resolveModeDetails>;
  pollingDetails: PollingDetails;
}

const buildContainerLogsDiagnosticsRow = (
  [scope, state]: [string, DomainSnapshotState<unknown>],
  context: ContainerLogsRowContext
): DiagnosticsRow => {
  const payload = state.data as ContainerLogsSnapshotPayload | null;
  const lastUpdatedInfo = formatLastUpdated(stateLastUpdated(state));
  const identity = resolveObjectPanelScopeIdentity(scope);
  const roleDetails = resolveScopeRole('container-logs', scope);
  const countDetails = buildDiagnosticsCountDetails(
    payload?.entries?.length ?? 0,
    state,
    'entries'
  );
  const scopeDetails = resolveScopeDetails(
    scope,
    context.selectedClusterId,
    context.getClusterMeta
  );
  const healthDetails = resolveHealthDetails({
    domain: 'container-logs',
    status: state.status,
    error: state.error,
    scope,
    streamHealth: context.streamHealth,
  });
  const resetCount = payload?.resetCount ?? 0;
  return {
    rowKey: `container-logs:${scope}`,
    domain: 'container-logs',
    label: identity.name ? `ObjPanel - Logs - ${identity.name}` : scope,
    status: state.status,
    version: resetCount > 0 ? String(resetCount) : '—',
    interval: '—',
    lastUpdated: lastUpdatedInfo.display,
    lastUpdatedTooltip: lastUpdatedInfo.tooltip,
    duration: '—',
    dropped: state.droppedAutoRefreshes,
    stale: false,
    error: state.error ?? '—',
    telemetryStatus: state.status,
    telemetryTooltip: state.error ?? undefined,
    metricsStatus: '—',
    metricsTooltip: 'Streaming domain',
    metricsStale: false,
    metricsSuccess: undefined,
    metricsFailure: undefined,
    telemetrySuccess: undefined,
    telemetryFailure: undefined,
    hasMetrics: false,
    ...countDetails,
    namespace: identity.namespaceLabel,
    scope: scopeDetails.display,
    scopeTooltip: scopeDetails.tooltip,
    role: roleDetails.label,
    roleTooltip: roleDetails.tooltip,
    scopeEntries: scopeDetails.entries,
    mode: context.modeDetails.label,
    modeTooltip: context.modeDetails.tooltip,
    healthStatus: healthDetails.label,
    healthTooltip: healthDetails.tooltip,
    pollingStatus: context.pollingDetails.label,
    pollingTooltip: context.pollingDetails.tooltip,
  };
};

const buildObjectPanelDiagnosticsRow = (
  domain: RefreshDomain,
  tabName: string,
  [scope, state]: [string, DomainSnapshotState<unknown>],
  context: ScopedRowContext
): DiagnosticsRow => {
  const lastUpdatedInfo = formatLastUpdated(stateLastUpdated(state));
  const identity = resolveObjectPanelScopeIdentity(scope);
  const scopeDetails = resolveScopeDetails(
    scope,
    context.selectedClusterId,
    context.getClusterMeta
  );
  const roleDetails = resolveScopeRole(domain, scope);
  const healthDetails = resolveHealthDetails({
    domain,
    status: state.status,
    error: state.error,
    scope,
  });
  return {
    rowKey: `${domain}:${scope}`,
    domain,
    label: identity.name ? `ObjPanel - ${tabName} - ${identity.name}` : `ObjPanel - ${tabName}`,
    status: state.status,
    version: stateVersion(state),
    interval: '—',
    lastUpdated: lastUpdatedInfo.display,
    lastUpdatedTooltip: lastUpdatedInfo.tooltip,
    duration: '—',
    dropped: state.droppedAutoRefreshes,
    stale: false,
    error: state.error ?? '—',
    telemetryStatus: state.status,
    telemetryTooltip: state.error ?? undefined,
    metricsStatus: '—',
    metricsTooltip: 'Polling domain',
    metricsStale: false,
    metricsSuccess: undefined,
    metricsFailure: undefined,
    telemetrySuccess: undefined,
    telemetryFailure: undefined,
    hasMetrics: false,
    count: 0,
    countDisplay: '—',
    namespace: identity.namespaceLabel,
    scope: scopeDetails.display,
    scopeTooltip: scopeDetails.tooltip,
    role: roleDetails.label,
    roleTooltip: roleDetails.tooltip,
    scopeEntries: scopeDetails.entries,
    mode: 'polling',
    modeTooltip: 'Polling via object panel refresher',
    healthStatus: healthDetails.label,
    healthTooltip: healthDetails.tooltip,
    pollingStatus: '—',
    pollingTooltip: undefined,
  };
};

const capabilityRowIsCurrent = (
  row: CapabilityBatchRow,
  activeNamespaceKey: string | null
): boolean =>
  row.scope === 'Cluster' ||
  row.pendingCount > 0 ||
  row.inFlightCount > 0 ||
  Boolean(activeNamespaceKey && row.scope.toLowerCase() === activeNamespaceKey);

const splitCapabilityRows = (
  rows: CapabilityBatchRow[],
  selectedNamespace: string | undefined,
  selectedClusterId: string
): {
  currentCapabilityRows: CapabilityBatchRow[];
  previousCapabilityRows: CapabilityBatchRow[];
} => {
  const currentCapabilityRows: CapabilityBatchRow[] = [];
  const previousCapabilityRows: CapabilityBatchRow[] = [];
  const activeNamespaceKey = selectedNamespace?.toLowerCase() ?? null;
  for (const row of rows) {
    if (selectedClusterId && row.clusterId && row.clusterId !== selectedClusterId) {
      continue;
    }
    if (capabilityRowIsCurrent(row, activeNamespaceKey)) {
      currentCapabilityRows.push(row);
    } else {
      previousCapabilityRows.push(row);
    }
  }
  return { currentCapabilityRows, previousCapabilityRows };
};

interface DiagnosticsFocusNavigation {
  panel: HTMLDivElement | null;
  focusables: () => HTMLElement[];
  findActiveIndex: () => number;
  focusFirst: () => boolean;
  focusLast: () => boolean;
  focusAt: (index: number) => boolean;
}

const handleDiagnosticsTabKey = (
  event: KeyboardEvent,
  navigation: DiagnosticsFocusNavigation
): boolean => {
  if (event.key !== 'Tab') {
    return false;
  }
  const target = event.target as HTMLElement | null;
  if (target?.closest('.diagnostics-content')) {
    return false;
  }
  const items = navigation.focusables();
  if (items.length === 0) {
    return false;
  }
  const direction = event.shiftKey ? -1 : 1;
  const current = target && navigation.panel?.contains(target) ? navigation.findActiveIndex() : -1;
  if (current === -1) {
    return direction > 0 ? navigation.focusFirst() : navigation.focusLast();
  }
  const next = current + direction;
  return next >= 0 && next < items.length ? navigation.focusAt(next) : false;
};

export const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({ onClose, isOpen }) => {
  const [activeTab, setActiveTab] = useState<DiagnosticsTabId>('k8s-api');
  const gridTablePerformanceRows = useGridTablePerformanceDiagnostics();
  const brokerReadDiagnostics = useBrokerReadDiagnostics();
  const refreshState = useRefreshState();
  // Scoped domains — read all scope entries for diagnostics.
  const objectMaintenanceScopeEntries = useRefreshScopedDomainEntries('object-maintenance');
  const namespaceScopeEntries = useRefreshScopedDomainEntries('namespaces');
  const clusterOverviewScopeEntries = useRefreshScopedDomainEntries('cluster-overview');
  const nodeScopeEntries = useRefreshScopedDomainEntries('nodes');
  const clusterConfigScopeEntries = useRefreshScopedDomainEntries('cluster-config');
  const clusterCRDScopeEntries = useRefreshScopedDomainEntries('cluster-crds');
  const clusterCustomScopeEntries = useRefreshScopedDomainEntries('cluster-custom');
  const clusterRBACScopeEntries = useRefreshScopedDomainEntries('cluster-rbac');
  const clusterStorageScopeEntries = useRefreshScopedDomainEntries('cluster-storage');
  const clusterEventsScopeEntries = useRefreshScopedDomainEntries('cluster-events');
  const catalogScopeEntries = useRefreshScopedDomainEntries('catalog');
  const catalogDiffScopeEntries = useRefreshScopedDomainEntries('catalog-diff');
  const namespaceWorkloadsScopeEntries = useRefreshScopedDomainEntries('namespace-workloads');
  const namespaceAutoscalingScopeEntries = useRefreshScopedDomainEntries('namespace-autoscaling');
  const namespaceConfigScopeEntries = useRefreshScopedDomainEntries('namespace-config');
  const namespaceCustomScopeEntries = useRefreshScopedDomainEntries('namespace-custom');
  const namespaceEventsScopeEntries = useRefreshScopedDomainEntries('namespace-events');
  const namespaceHelmScopeEntries = useRefreshScopedDomainEntries('namespace-helm');
  const namespaceNetworkScopeEntries = useRefreshScopedDomainEntries('namespace-network');
  const namespaceQuotasScopeEntries = useRefreshScopedDomainEntries('namespace-quotas');
  const namespaceRBACScopeEntries = useRefreshScopedDomainEntries('namespace-rbac');
  const namespaceStorageScopeEntries = useRefreshScopedDomainEntries('namespace-storage');
  const podScopeEntries = useRefreshScopedDomainEntries('pods');
  const containerLogsScopeEntries = useRefreshScopedDomainEntries('container-logs');
  // Object panel scoped domains – visible only while the object panel is open.
  const objectDetailsScopeEntries = useRefreshScopedDomainEntries('object-details');
  const objectEventsScopeEntries = useRefreshScopedDomainEntries('object-events');
  const objectYamlScopeEntries = useRefreshScopedDomainEntries('object-yaml');
  const objectHelmManifestScopeEntries = useRefreshScopedDomainEntries('object-helm-manifest');
  const objectHelmValuesScopeEntries = useRefreshScopedDomainEntries('object-helm-values');

  const [telemetrySummary, setTelemetrySummary] = useState<NormalizedTelemetrySummary | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [selectionDiagnostics, setSelectionDiagnostics] = useState<SelectionDiagnostics | null>(
    null
  );
  const [selectionDiagnosticsError, setSelectionDiagnosticsError] = useState<string | null>(null);
  const [kubernetesAPIDiagnostics, setKubernetesAPIDiagnostics] = useState<
    KubernetesAPIClientDiagnostics[]
  >([]);
  const [kubernetesAPIDiagnosticsError, setKubernetesAPIDiagnosticsError] = useState<string | null>(
    null
  );
  const permissionMap = useUserPermissions();
  const capabilityDiagnostics = useCapabilityDiagnostics();
  const { viewType, activeClusterTab, activeNamespaceTab } = useViewState();
  const { selectedNamespace } = useNamespace();
  const { selectedClusterId, getClusterMeta } = useKubeconfig();
  const [diagnosticsClock, setDiagnosticsClock] = useState(() => Date.now());
  const reportedDiagnosticsFailuresRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (!isOpen) {
      reportedDiagnosticsFailuresRef.current.clear();
      setTelemetrySummary(null);
      setTelemetryError(null);
      setSelectionDiagnostics(null);
      setSelectionDiagnosticsError(null);
      setKubernetesAPIDiagnostics([]);
      setKubernetesAPIDiagnosticsError(null);
      return;
    }

    let cancelled = false;

    const presentDiagnosticsFailure = (
      key: string,
      reason: unknown,
      action: string,
      fallbackMessage: string
    ): string => {
      const previouslyReportedMessage = reportedDiagnosticsFailuresRef.current.get(key);
      if (previouslyReportedMessage !== undefined) {
        return previouslyReportedMessage;
      }
      const error = reason instanceof Error ? reason : new Error(fallbackMessage);
      const details = errorHandler.handleInline(error, {
        action,
        source: 'DiagnosticsPanel',
      });
      reportedDiagnosticsFailuresRef.current.set(key, details.message);
      return details.message;
    };

    const loadDiagnostics = async () => {
      const [telemetryResult, selectionResult, kubernetesAPIResult] = await Promise.allSettled([
        fetchTelemetrySummary(),
        fetchSelectionDiagnostics(),
        fetchKubernetesAPIClientDiagnostics(),
      ]);

      if (cancelled) {
        return;
      }

      if (telemetryResult.status === 'fulfilled') {
        reportedDiagnosticsFailuresRef.current.delete('telemetry');
        setTelemetrySummary(telemetryResult.value);
        setTelemetryError(null);
      } else {
        setTelemetryError(
          presentDiagnosticsFailure(
            'telemetry',
            telemetryResult.reason,
            'loadTelemetryDiagnostics',
            'Failed to load telemetry'
          )
        );
      }

      if (selectionResult.status === 'fulfilled') {
        reportedDiagnosticsFailuresRef.current.delete('selection');
        setSelectionDiagnostics(selectionResult.value);
        setSelectionDiagnosticsError(null);
      } else {
        setSelectionDiagnosticsError(
          presentDiagnosticsFailure(
            'selection',
            selectionResult.reason,
            'loadSelectionDiagnostics',
            'Failed to load selection diagnostics'
          )
        );
      }

      if (kubernetesAPIResult.status === 'fulfilled') {
        reportedDiagnosticsFailuresRef.current.delete('kubernetes-api');
        setKubernetesAPIDiagnostics(kubernetesAPIResult.value);
        setKubernetesAPIDiagnosticsError(null);
      } else {
        setKubernetesAPIDiagnosticsError(
          presentDiagnosticsFailure(
            'kubernetes-api',
            kubernetesAPIResult.reason,
            'loadKubernetesAPIDiagnostics',
            'Failed to load Kubernetes API client diagnostics'
          )
        );
      }
    };

    void loadDiagnostics();
    const intervalId = window.setInterval(loadDiagnostics, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // Tick every second so age columns stay current.
    setDiagnosticsClock(Date.now());
    const intervalId = window.setInterval(() => {
      setDiagnosticsClock(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isOpen]);

  const domainScopedStates = useMemo(
    () =>
      [
        {
          domain: 'namespaces' as RefreshDomain,
          label: 'Namespaces',
          entries: namespaceScopeEntries,
        },
        {
          domain: 'cluster-overview' as RefreshDomain,
          label: 'Cluster Overview',
          hasMetrics: true,
          entries: clusterOverviewScopeEntries,
        },
        {
          domain: 'nodes' as RefreshDomain,
          label: 'Nodes',
          hasMetrics: true,
          entries: nodeScopeEntries,
        },
        {
          domain: 'cluster-config' as RefreshDomain,
          label: 'Cluster Config',
          entries: clusterConfigScopeEntries,
        },
        {
          domain: 'cluster-crds' as RefreshDomain,
          label: 'Cluster CRDs',
          entries: clusterCRDScopeEntries,
        },
        {
          domain: 'cluster-custom' as RefreshDomain,
          label: 'Cluster Custom',
          entries: clusterCustomScopeEntries,
        },
        {
          domain: 'cluster-events' as RefreshDomain,
          label: 'Cluster Events',
          entries: clusterEventsScopeEntries,
        },
        {
          domain: 'object-maintenance' as RefreshDomain,
          label: 'ObjPanel - Maintenance',
          entries: objectMaintenanceScopeEntries,
        },
        {
          domain: 'catalog' as RefreshDomain,
          label: 'Browse Catalog',
          entries: catalogScopeEntries,
        },
        {
          domain: 'catalog-diff' as RefreshDomain,
          label: 'Diff Catalog',
          entries: catalogDiffScopeEntries,
        },
        {
          domain: 'cluster-rbac' as RefreshDomain,
          label: 'Cluster RBAC',
          entries: clusterRBACScopeEntries,
        },
        {
          domain: 'cluster-storage' as RefreshDomain,
          label: 'Cluster Storage',
          entries: clusterStorageScopeEntries,
        },
        {
          domain: 'namespace-workloads' as RefreshDomain,
          label: 'Workloads',
          hasMetrics: true,
          entries: namespaceWorkloadsScopeEntries,
        },
        {
          domain: 'namespace-autoscaling' as RefreshDomain,
          label: 'NS Autoscaling',
          entries: namespaceAutoscalingScopeEntries,
        },
        {
          domain: 'namespace-config' as RefreshDomain,
          label: 'NS Config',
          entries: namespaceConfigScopeEntries,
        },
        {
          domain: 'namespace-custom' as RefreshDomain,
          label: 'NS Custom',
          entries: namespaceCustomScopeEntries,
        },
        {
          domain: 'namespace-events' as RefreshDomain,
          label: 'NS Events',
          entries: namespaceEventsScopeEntries,
        },
        {
          domain: 'namespace-helm' as RefreshDomain,
          label: 'NS Helm',
          entries: namespaceHelmScopeEntries,
        },
        {
          domain: 'namespace-network' as RefreshDomain,
          label: 'NS Network',
          entries: namespaceNetworkScopeEntries,
        },
        {
          domain: 'namespace-quotas' as RefreshDomain,
          label: 'NS Quotas',
          entries: namespaceQuotasScopeEntries,
        },
        {
          domain: 'namespace-rbac' as RefreshDomain,
          label: 'NS RBAC',
          entries: namespaceRBACScopeEntries,
        },
        {
          domain: 'namespace-storage' as RefreshDomain,
          label: 'NS Storage',
          entries: namespaceStorageScopeEntries,
        },
      ].flatMap(({ domain, label, hasMetrics, entries }) =>
        entries.map(([scopeKey, state]) => {
          const resolvedScope = state.scope?.trim() ? state.scope : scopeKey;
          return {
            domain,
            label,
            hasMetrics: Boolean(hasMetrics),
            state: resolvedScope === state.scope ? state : { ...state, scope: resolvedScope },
          };
        })
      ),
    [
      objectMaintenanceScopeEntries,
      namespaceScopeEntries,
      clusterOverviewScopeEntries,
      nodeScopeEntries,
      clusterConfigScopeEntries,
      clusterCRDScopeEntries,
      clusterCustomScopeEntries,
      clusterEventsScopeEntries,
      clusterRBACScopeEntries,
      clusterStorageScopeEntries,
      catalogScopeEntries,
      catalogDiffScopeEntries,
      namespaceWorkloadsScopeEntries,
      namespaceAutoscalingScopeEntries,
      namespaceConfigScopeEntries,
      namespaceEventsScopeEntries,
      namespaceCustomScopeEntries,
      namespaceHelmScopeEntries,
      namespaceNetworkScopeEntries,
      namespaceQuotasScopeEntries,
      namespaceRBACScopeEntries,
      namespaceStorageScopeEntries,
    ]
  );

  const resourceStreamStats = resourceStreamManager.getTelemetrySummary();
  // Per-(cluster, domain) resync/fallback stats for the per-domain Streams rows.
  const resourceStreamStatsByClusterDomain =
    resourceStreamManager.getTelemetrySummaryByClusterDomain();
  const rows = useMemo<DiagnosticsRow[]>(() => {
    const prioritySet = new Set(PRIORITY_DOMAINS);

    const baseRows = domainScopedStates
      .filter(({ domain, state }) => !isTransientResourceTableQueryScope(domain, state.scope))
      .map<DiagnosticsRow>(({ domain, state, label, hasMetrics }) => {
        const effectiveScope = state.scope;
        const hasMetricsFlag = hasMetrics;
        const scopeDetails = resolveScopeDetails(effectiveScope, selectedClusterId, getClusterMeta);
        const roleDetails = resolveScopeRole(domain, effectiveScope);
        const telemetryDetails = buildDomainTelemetryDetails({
          domain,
          state,
          scope: effectiveScope,
          telemetrySummary,
          resourceStreamStats,
        });
        const metricsDetails = buildDomainMetricsDetails(state, hasMetricsFlag);

        const data = asRecord(state.data);
        const countDetails = resolveDiagnosticsCountDetails(domain, state, data);
        const lastUpdatedInfo = formatLastUpdated(telemetryDetails.lastUpdated);
        const refresherName = DOMAIN_REFRESHER_MAP[domain];
        const intervalLabel = formatInterval(
          refresherName ? refreshManager.getRefresherInterval(refresherName) : null
        );
        const namespaceLabel = resolveDomainNamespace(domain, effectiveScope);

        const version =
          state.version !== null && state.version !== undefined ? String(state.version) : '—';
        const pollingDetails = resolvePollingDetails({
          domain,
          refresherName,
          streamActive: telemetryDetails.streamActive,
          streamHealthy: telemetryDetails.streamHealthy,
        });
        const modeDetails = resolveModeDetails({
          domain,
          streamMode: telemetryDetails.streamMode,
          streamActive: telemetryDetails.streamActive,
          streamHealthy: telemetryDetails.streamHealthy,
          pollingEnabled: pollingDetails.enabled,
          streamingBlocked: refreshOrchestrator.isStreamingBlocked(domain, effectiveScope),
          streamOnly: STREAM_ONLY_DOMAINS.has(domain),
        });
        const healthDetails = resolveHealthDetails({
          domain,
          status: state.status,
          error: state.error,
          scope: effectiveScope,
          streamHealth: telemetryDetails.streamHealth,
        });

        return {
          rowKey: `${domain}:${effectiveScope ?? '-'}`,
          domain,
          label,
          status: state.status,
          version,
          interval: intervalLabel,
          lastUpdated:
            telemetryDetails.telemetryLastUpdatedInfo?.display ?? lastUpdatedInfo.display,
          lastUpdatedTooltip:
            telemetryDetails.telemetryLastUpdatedInfo?.tooltip ?? lastUpdatedInfo.tooltip,
          dropped: state.droppedAutoRefreshes + telemetryDetails.streamDropped,
          stale: isTimestampStale(telemetryDetails.lastUpdated),
          error: telemetryDetails.combinedError,
          telemetryStatus: telemetryDetails.telemetryStatus,
          telemetryTooltip: telemetryDetails.telemetryTooltip,
          metricsStatus: metricsDetails.metricsStatus,
          metricsTooltip: metricsDetails.metricsTooltip,
          metricsStale: metricsDetails.metricsInfo?.stale,
          metricsSuccess: metricsDetails.successCount,
          metricsFailure: metricsDetails.failureCount,
          duration: telemetryDetails.durationLabel,
          syncWait: telemetryDetails.syncWaitLabel,
          telemetrySuccess: telemetryDetails.telemetrySuccess,
          telemetryFailure: telemetryDetails.telemetryFailure,
          hasMetrics: hasMetricsFlag,
          ...countDetails,
          namespace: namespaceLabel,
          scope: scopeDetails.display,
          scopeTooltip: scopeDetails.tooltip,
          role: roleDetails.label,
          roleTooltip: roleDetails.tooltip,
          scopeEntries: scopeDetails.entries,
          mode: modeDetails.label,
          modeTooltip: modeDetails.tooltip,
          healthStatus: healthDetails.label,
          healthTooltip: healthDetails.tooltip,
          pollingStatus: pollingDetails.label,
          pollingTooltip: pollingDetails.tooltip,
        };
      });

    const scopedRowContext = { selectedClusterId, getClusterMeta };
    const podRows = podScopeEntries.map((entry) => buildPodDiagnosticsRow(entry, scopedRowContext));

    const orderedPodRows = podRows.sort((a, b) => a.label.localeCompare(b.label));

    const containerLogsStreamTelemetry = telemetrySummary?.streams.find(
      (entry) => entry.name === 'container-logs'
    );
    const containerLogsStreamHealth = resolveStreamTelemetryHealth(containerLogsStreamTelemetry);
    const containerLogsStreamActive = Boolean(containerLogsStreamTelemetry?.activeSessions);
    const containerLogsStreamHealthy = containerLogsStreamHealth?.status === 'healthy';
    const logPollingDetails = resolvePollingDetails({
      domain: 'container-logs',
      refresherName: DOMAIN_REFRESHER_MAP['container-logs'],
      streamActive: containerLogsStreamActive,
      streamHealthy: containerLogsStreamHealthy,
    });
    const logModeDetails = resolveModeDetails({
      domain: 'container-logs',
      streamMode: STREAM_MODE_BY_NAME['container-logs'],
      streamActive: containerLogsStreamActive,
      streamHealthy: containerLogsStreamHealthy,
      pollingEnabled: logPollingDetails.enabled,
      streamingBlocked: false,
      streamOnly: STREAM_ONLY_DOMAINS.has('container-logs'),
    });
    const logRowContext = {
      ...scopedRowContext,
      streamHealth: containerLogsStreamHealth,
      modeDetails: logModeDetails,
      pollingDetails: logPollingDetails,
    };
    const logRows = containerLogsScopeEntries.map((entry) =>
      buildContainerLogsDiagnosticsRow(entry, logRowContext)
    );

    const orderedLogRows = logRows.sort((a, b) => a.label.localeCompare(b.label));

    // Build rows for object panel scoped domains (details, events, yaml, helm).
    const buildObjectPanelRows = (
      domain: RefreshDomain,
      tabName: string,
      entries: Array<[string, DomainSnapshotState<unknown>]>
    ): DiagnosticsRow[] =>
      entries.map((entry) =>
        buildObjectPanelDiagnosticsRow(domain, tabName, entry, scopedRowContext)
      );

    const objectDetailsRows = buildObjectPanelRows(
      'object-details',
      'Details',
      objectDetailsScopeEntries
    );
    const objectEventsRows = buildObjectPanelRows(
      'object-events',
      'Events',
      objectEventsScopeEntries
    );
    const objectYamlRows = buildObjectPanelRows('object-yaml', 'YAML', objectYamlScopeEntries);
    const objectHelmManifestRows = buildObjectPanelRows(
      'object-helm-manifest',
      'Manifest',
      objectHelmManifestScopeEntries
    );
    const objectHelmValuesRows = buildObjectPanelRows(
      'object-helm-values',
      'Values',
      objectHelmValuesScopeEntries
    );

    const priorityRows = baseRows.filter((row) => prioritySet.has(row.domain));
    const remainingRows = baseRows.filter(
      (row) =>
        !prioritySet.has(row.domain) && row.domain !== 'pods' && row.domain !== 'container-logs'
    );

    // Keep configured priority order while preserving every scoped row per domain.
    const sortedPriorityRows = PRIORITY_DOMAINS.flatMap((domain) =>
      priorityRows.filter((row) => row.domain === domain)
    );

    // Sort all rows alphabetically by the Domain label.
    const sortedRows = [
      ...sortedPriorityRows,
      ...orderedPodRows,
      ...orderedLogRows,
      ...remainingRows,
      ...objectDetailsRows,
      ...objectEventsRows,
      ...objectYamlRows,
      ...objectHelmManifestRows,
      ...objectHelmValuesRows,
    ].sort((a, b) => {
      const labelCompare = a.label.localeCompare(b.label);
      if (labelCompare !== 0) {
        return labelCompare;
      }
      return a.rowKey.localeCompare(b.rowKey);
    });
    return dedupeDiagnosticsRows(sortedRows);
  }, [
    domainScopedStates,
    podScopeEntries,
    containerLogsScopeEntries,
    objectDetailsScopeEntries,
    objectEventsScopeEntries,
    objectYamlScopeEntries,
    objectHelmManifestScopeEntries,
    objectHelmValuesScopeEntries,
    telemetrySummary,
    resourceStreamStats,
    selectedClusterId,
    getClusterMeta,
  ]);

  const filteredRows = useMemo(() => rows.filter((row) => row.status !== 'idle'), [rows]);
  // Build stream telemetry rows for the dedicated diagnostics section.
  const streamRows = useMemo(
    () =>
      buildDiagnosticsStreamRows(
        telemetrySummary,
        filteredRows,
        resourceStreamStatsByClusterDomain
      ),
    [filteredRows, resourceStreamStatsByClusterDomain, telemetrySummary]
  );

  // Streams tab includes stream telemetry plus active scoped domains for each stream.
  const streamSummary = useMemo(() => buildDiagnosticsStreamSummary(streamRows), [streamRows]);

  const kubernetesAPIClientRows = useMemo(
    () => buildKubernetesAPIClientRows(kubernetesAPIDiagnostics),
    [kubernetesAPIDiagnostics]
  );

  const kubernetesAPISummary = useMemo(() => {
    return buildKubernetesAPISummary(kubernetesAPIClientRows, kubernetesAPIDiagnosticsError);
  }, [kubernetesAPIClientRows, kubernetesAPIDiagnosticsError]);

  const { capabilityBatchRows, capabilityDescriptorIndex } = useMemo(() => {
    return buildCapabilityBatchRows(capabilityDiagnostics, diagnosticsClock, permissionMap);
  }, [capabilityDiagnostics, diagnosticsClock, permissionMap]);

  const permissionRows = useMemo(() => {
    return buildPermissionRows({
      permissionMap,
      capabilityDescriptorIndex,
      scopedFeatures: getScopedFeaturesForView(
        viewType,
        activeClusterTab ?? null,
        activeNamespaceTab
      ),
      viewType,
      selectedNamespace,
      selectedClusterId,
    });
  }, [
    permissionMap,
    capabilityDescriptorIndex,
    viewType,
    activeClusterTab,
    activeNamespaceTab,
    selectedNamespace,
    selectedClusterId,
  ]);

  const telemetryMetrics = telemetrySummary?.metrics;
  const eventStreamTelemetry = telemetrySummary?.streams.find((entry) => entry.name === 'events');
  const catalogStreamTelemetry = telemetrySummary?.streams.find(
    (entry) => entry.name === 'catalog'
  );
  const containerLogsStreamTelemetry = telemetrySummary?.streams.find(
    (entry) => entry.name === 'container-logs'
  );
  const orchestratorSummary = useMemo(() => {
    return buildOrchestratorSummary({
      pendingRequests: refreshState.pendingRequests,
      selectionDiagnostics,
      selectionDiagnosticsError,
    });
  }, [refreshState.pendingRequests, selectionDiagnostics, selectionDiagnosticsError]);

  const metricsSummary = useMemo(() => {
    return buildMetricsSummary({ telemetryMetrics, telemetrySummary, telemetryError });
  }, [telemetryMetrics, telemetrySummary, telemetryError]);

  const eventSummary = useMemo(() => {
    return buildEventStreamSummary({ eventStreamTelemetry, telemetrySummary, telemetryError });
  }, [eventStreamTelemetry, telemetryError, telemetrySummary]);

  const catalogSummary = useMemo(() => {
    const catalogState = pickPreferredScopeState(catalogScopeEntries, selectedClusterId);
    return buildCatalogSummary({
      catalogState,
      catalogStreamTelemetry,
      telemetrySummary,
      telemetryError,
    });
  }, [
    catalogScopeEntries,
    selectedClusterId,
    catalogStreamTelemetry,
    telemetryError,
    telemetrySummary,
  ]);

  const logSummary = useMemo(() => {
    return buildContainerLogsSummary({
      containerLogsScopeEntries,
      containerLogsStreamTelemetry,
    });
  }, [containerLogsScopeEntries, containerLogsStreamTelemetry]);

  useShortcut({
    key: 'Escape',
    handler: () => {
      if (!isOpen) {
        return false;
      }
      onClose();
      return true;
    },
    description: 'Close diagnostics panel',
    category: 'Diagnostics',
    enabled: isOpen,
    priority: isOpen ? 35 : 0,
  });

  // Refresh Domains tab content.
  const refreshDomainsContent = (
    <>
      <DiagnosticsSummaryCards
        orchestratorSummary={orchestratorSummary}
        metricsSummary={metricsSummary}
        eventSummary={eventSummary}
        catalogSummary={catalogSummary}
        logSummary={logSummary}
      />
      <DiagnosticsTable rows={filteredRows} />
    </>
  );

  // Streams tab content.
  const streamsContent = (
    <DiagnosticsStreamsTable
      rows={streamRows}
      summary={streamSummary}
      emptyMessage={
        streamRows.length === 0 ? 'Stream telemetry is not available yet.' : 'No streams available.'
      }
    />
  );

  const kubernetesAPIContent = (
    <KubernetesAPIClientsTable rows={kubernetesAPIClientRows} summary={kubernetesAPISummary} />
  );

  const tablePerformanceContent = (
    <GridTablePerformance
      onReset={resetGridTablePerformanceDiagnostics}
      rows={gridTablePerformanceRows}
      summary="Rolling GridTable measurements for the instrumented large-data views."
    />
  );

  // Split capability batch rows into current (Cluster + selected namespace + in-flight)
  // and previous (everything else).
  const { currentCapabilityRows, previousCapabilityRows } = useMemo(
    () => splitCapabilityRows(capabilityBatchRows, selectedNamespace, selectedClusterId),
    [capabilityBatchRows, selectedNamespace, selectedClusterId]
  );

  // Cap Checks tab content.
  const capabilityChecksContent = (
    <CapabilityChecksTable
      currentRows={currentCapabilityRows}
      previousRows={previousCapabilityRows}
      summary={`${currentCapabilityRows.length + previousCapabilityRows.length} namespace${
        currentCapabilityRows.length + previousCapabilityRows.length === 1 ? '' : 's'
      }`}
    />
  );

  // Permissions tab content.
  const effectivePermissionsContent = <EffectivePermissionsTable rows={permissionRows} />;

  const brokerReadRows = useMemo(
    () =>
      buildBrokerReadRows(brokerReadDiagnostics, (scopes) =>
        resolveBrokerReadScope(scopes, selectedClusterId, getClusterMeta)
      ),
    [brokerReadDiagnostics, getClusterMeta, selectedClusterId]
  );

  const brokerReadsSummary = useMemo(
    () => buildBrokerReadsSummary(brokerReadRows),
    [brokerReadRows]
  );

  const brokerReadsContent = (
    <BrokerReadsTable rows={brokerReadRows} summary={brokerReadsSummary} />
  );

  const panelRef = useRef<HTMLDivElement>(null);

  const focusables = useCallback(() => {
    if (!panelRef.current) {
      return [];
    }
    return Array.from(
      panelRef.current.querySelectorAll<HTMLElement>('[data-diagnostics-focusable="true"]')
    );
  }, []);

  const focusAt = useCallback(
    (index: number) => {
      const items = focusables();
      if (index < 0 || index >= items.length) {
        return false;
      }
      items[index].focus();
      return true;
    },
    [focusables]
  );

  const focusFirst = useCallback(() => focusAt(0), [focusAt]);
  const focusLast = useCallback(() => {
    const items = focusables();
    return focusAt(items.length - 1);
  }, [focusAt, focusables]);

  const findActiveIndex = useCallback(() => {
    const items = focusables();
    const active = document.activeElement as HTMLElement | null;
    return items.findIndex((el) => el === active || el.contains(active));
  }, [focusables]);

  useKeyboardSurface({
    kind: 'panel',
    rootRef: panelRef,
    active: isOpen,
    captureWhenActive: true,
    priority: KeyboardScopePriority.DIAGNOSTICS_PANEL,
    onKeyDown: (event) =>
      handleDiagnosticsTabKey(event, {
        panel: panelRef.current,
        focusables,
        findActiveIndex,
        focusFirst,
        focusLast,
        focusAt,
      }),
  });

  const contentByTab: Record<DiagnosticsTabId, React.ReactNode> = {
    'refresh-domains': refreshDomainsContent,
    streams: streamsContent,
    'k8s-api': kubernetesAPIContent,
    'table-performance': tablePerformanceContent,
    'capability-checks': capabilityChecksContent,
    'effective-permissions': effectivePermissionsContent,
    'broker-reads': brokerReadsContent,
  };

  return (
    <DockablePanel
      panelRef={panelRef}
      panelId="diagnostics"
      title="Diagnostics"
      isOpen={isOpen}
      defaultPosition="bottom"
      allowMaximize
      maximizeTargetSelector=".content-body"
      onClose={onClose}
      contentClassName="diagnostics-content"
      className="diagnostics-panel"
    >
      <Tabs
        aria-label="Diagnostics Panel Tabs"
        tabs={DIAGNOSTICS_TAB_DESCRIPTORS}
        activeId={activeTab}
        onActivate={(id) => setActiveTab(id as DiagnosticsTabId)}
        textTransform="uppercase"
        disableRovingTabIndex
      />
      <div className="diagnostics-scroll-area">{contentByTab[activeTab]}</div>
    </DockablePanel>
  );
};
