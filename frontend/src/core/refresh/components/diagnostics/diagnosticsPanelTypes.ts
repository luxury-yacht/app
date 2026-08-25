/**
 * frontend/src/core/refresh/components/diagnostics/diagnosticsPanelTypes.ts
 *
 * Type definitions for diagnosticsPanelTypes.
 * Defines shared interfaces and payload shapes for the shared components.
 */

import type { PermissionFeatureKey } from '@/core/capabilities/permissionFeatures';
import type { DomainStatus } from '../../store';
import type { RefreshDomain } from '../../types';

export interface DiagnosticsPanelProps {
  onClose: () => void;
  isOpen: boolean;
}

export interface DiagnosticsRow {
  rowKey: string;
  domain: RefreshDomain;
  // Cluster that owns this scope, parsed from the raw (cluster-prefixed) scope.
  // Empty for app-level scopes and multi-cluster aggregate scopes, which group
  // under the app rather than a cluster.
  clusterId: string;
  label: string;
  status: DomainStatus;
  version: string;
  interval: string;
  lastUpdated: string;
  lastUpdatedTooltip: string;
  telemetryStatus?: string;
  telemetryTooltip?: string;
  duration?: string;
  // Formatted peak informer-sync-gate wait (initial-LIST gating cost) for this
  // domain; '—' / undefined when no wait was recorded.
  syncWait?: string;
  telemetrySuccess?: number;
  telemetryFailure?: number;
  metricsStatus: string;
  metricsTooltip: string;
  metricsSuccess?: number;
  metricsFailure?: number;
  metricsStale?: boolean;
  dropped: number;
  stale: boolean;
  error: string;
  hasMetrics: boolean;
  count: number;
  countDisplay: string;
  countTooltip?: string;
  countClassName?: string;
  warnings?: string[];
  truncated?: boolean;
  totalItems?: number;
  namespace: string;
  // Scope/mode/health/polling describe how data is retrieved for this row.
  scope: string;
  scopeTooltip?: string;
  role: string;
  roleTooltip?: string;
  // Structured scope entries for multi-line display (Active/Background clusters).
  scopeEntries?: { label: 'Active' | 'Background'; clusterName: string }[];
  mode: string;
  modeTooltip?: string;
  healthStatus: string;
  healthTooltip?: string;
  pollingStatus: string;
  pollingTooltip?: string;
}

// ClusterDataRow is the Cluster Data tree: cluster -> [domain] -> scope.
//
// A domain with a single scope produces ONE row, not two: the scope row names
// its own domain. A domain group row appears only when several scopes share a
// domain and there is something to group. The domain -> transport mapping is a
// total function in the authored contract, so a stream is an attribute of a
// domain, never a level above it.
//
// The row model pre-formats every visible cell. The table renders it and adds
// no logic of its own, so what the user sees is what the tests assert.
export type ClusterDataRow = ClusterDataClusterRow | ClusterDataDomainRow | ClusterDataScopeRow;

export type ClusterDataHealthTone = 'ok' | 'warn' | 'error' | 'inactive';

export interface ClusterDataHealth {
  label: string;
  tone: ClusterDataHealthTone;
  tooltip: string;
}

// One labelled fact in a scope row's expander. Everything the eight visible
// columns leave out lives here rather than widening the table.
export interface ClusterDataDetail {
  label: string;
  value: string;
  tooltip?: string;
}

export interface ClusterDataClusterRow {
  kind: 'cluster';
  rowKey: string;
  clusterId: string;
  clusterName: string;
  // Pre-formatted right-hand summary, e.g. "2 domains · 2 scopes".
  summary: string;
  // Rendered separately so it can carry the attention tone; empty when clean.
  issueSummary: string;
}

// Only emitted for a domain with more than one scope.
export interface ClusterDataDomainRow {
  kind: 'domain';
  rowKey: string;
  clusterId: string;
  domain: RefreshDomain;
  label: string;
  summary: string;
  summaryTooltip: string;
}

export interface ClusterDataScopeRow {
  kind: 'scope';
  rowKey: string;
  clusterId: string;
  domain: RefreshDomain;
  // Empty when a domain group row directly above already names the domain.
  domainLabel: string;
  // True when this row sits under a domain group row.
  indented: boolean;
  scope: string;
  scopeTooltip?: string;
  scopeEntries?: { label: 'Active' | 'Background'; clusterName: string }[];
  health: ClusterDataHealth;
  feed: string;
  feedTooltip: string;
  count: string;
  countTooltip?: string;
  countClassName?: string;
  updated: string;
  updatedTooltip: string;
  activity: string;
  activityTooltip: string;
  error: string;
  details: ClusterDataDetail[];
}

// ConnectionsRow is the flat Connections & Calls view. Its members genuinely
// have no common parent - a socket, an event scope, a log target and an app
// state read do not nest - so it is a list, not a tree.
export type ConnectionsRow = ConnectionsSocketRow | ConnectionsLeafRow;

export interface ConnectionsSocketRow {
  kind: 'socket';
  rowKey: string;
  stream: string;
  label: string;
  cluster: string;
  sessions: number;
  lastConnect: string;
  lastConnectTooltip: string;
  delivered: number;
  dropped: number;
  errors: number;
  lastEvent: string;
  lastEventTooltip: string;
  lastError: string;
  lastErrorAt?: number;
}

// A stream child whose key is NOT a refresh domain: an events scope or a
// container-logs target. These cannot join the Cluster Data tree.
export interface ConnectionsLeafRow {
  kind: 'leaf';
  rowKey: string;
  stream: string;
  label: string;
  cluster: string;
  leafKind: 'scope' | 'target';
  leaf: string;
  delivered: number;
  dropped: number;
  errors: number;
  lastEvent: string;
  lastEventTooltip: string;
  lastError: string;
  lastErrorAt?: number;
}

export interface KubernetesAPIClientRow {
  key: string;
  cluster: string;
  clusterTooltip: string;
  configured: string;
  qps1s: string;
  qps10s: string;
  qps60s: string;
  peakQPS1s: number;
  totalRequests: number;
  status429: number;
  status5xx: number;
  errors: number;
  lastRequest: string;
  lastRequestTooltip: string;
}

export interface CapabilityDescriptorActivityDetails {
  scope: string;
  descriptorLabel: string;
  resourceKind: string;
  verb: string;
  subresource: string | null;
  pendingCount: number;
  inFlightCount: number;
  runtimeDisplay: string;
  lastDurationDisplay: string;
  age: { display: string; tooltip: string };
  lastResult: string;
  consecutiveFailureCount: number;
  totalChecks: number;
  lastError: string | null;
}

export interface CapabilityBatchRow {
  key: string;
  clusterId: string;
  scope: string;
  pendingCount: number;
  inFlightCount: number;
  runtimeDisplay: string;
  runtimeMs: number | null;
  lastDurationDisplay: string;
  age: { display: string; tooltip: string };
  lastResult: string;
  lastError: string | null;
  totalChecks: number;
  consecutiveFailureCount: number;
  descriptorsByFeature: Array<{ feature: PermissionFeatureKey; resources: string[] }> | null;
  method: string | null;
  ssrrIncomplete: boolean | null;
  ssrrRuleCount: number | null;
  ssarFallbackCount: number | null;
}

export interface PermissionRow {
  clusterId: string;
  scope: string;
  descriptorLabel: string;
  resource: string;
  verb: string;
  allowed: string;
  isDenied: boolean;
  reason?: string;
  id: string;
  feature?: PermissionFeatureKey;
  featureLabel?: string;
  descriptorNamespace: string | null;
  pendingCount: number | null;
  inFlightCount: number | null;
  runtimeDisplay: string;
  lastDurationDisplay: string;
  age: { display: string; tooltip: string };
  lastResult: string;
  consecutiveFailureCount: number;
  totalChecks: number | null;
  lastError: string | null;
  descriptorKey: string;
}

export interface SummaryCardData {
  primary: string;
  secondary?: string;
  className?: string;
  title?: string;
}

export interface BrokerReadRow {
  key: string;
  broker: string;
  label: string;
  resource: string;
  adapter: string;
  reason: string;
  scope: string;
  scopeTooltip?: string;
  inFlightCount: number;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  blockedCount: number;
  lastStatus: string;
  lastDuration: string;
  lastUpdated: string;
  lastUpdatedTooltip: string;
  lastError: string;
}
