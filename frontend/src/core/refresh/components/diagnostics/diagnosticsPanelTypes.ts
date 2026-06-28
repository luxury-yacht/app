/**
 * frontend/src/core/refresh/components/diagnostics/diagnosticsPanelTypes.ts
 *
 * Type definitions for diagnosticsPanelTypes.
 * Defines shared interfaces and payload shapes for the shared components.
 */

import type { RefreshDomain } from '../../types';
import type { DomainStatus } from '../../store';
import type { PermissionFeatureKey } from '@/core/capabilities/permissionFeatures';

export interface DiagnosticsPanelProps {
  onClose: () => void;
  isOpen: boolean;
}

export interface DiagnosticsRow {
  rowKey: string;
  domain: RefreshDomain;
  label: string;
  status: DomainStatus;
  version: string;
  interval: string;
  lastUpdated: string;
  lastUpdatedTooltip: string;
  telemetryStatus?: string;
  telemetryTooltip?: string;
  duration?: string;
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

// DiagnosticsStreamRow captures formatted stream telemetry for the streams table.
// The Streams table is a tree: a per-stream header (socket-level: sessions/
// connect/socket-backlog drops, since one multiplexed socket spans all clusters)
// → a cluster group row → per-domain rows (per-domain delivery/recovery).
export type DiagnosticsStreamRow =
  DiagnosticsStreamHeaderRow | DiagnosticsStreamClusterRow | DiagnosticsStreamDomainRow;

// Stream header: socket-level metrics for one stream (Sessions/Last Connect are
// a property of the single socket, not any cluster/domain).
export interface DiagnosticsStreamHeaderRow {
  kind: 'stream';
  rowKey: string;
  label: string;
  sessions: number;
  lastConnect: string;
  lastConnectTooltip: string;
  // Stream-level (socket) delivery/backlog: events/catalog deliver here; for the
  // resources stream this is the socket-level backpressure (per-domain delivery
  // lives on the domain rows below).
  delivered: number;
  dropped: number;
  errors: number;
  lastEvent: string;
  lastEventTooltip: string;
  lastError: string;
  // When the last error occurred (unix ms), for the relative age in the column.
  lastErrorAt?: number;
  // Number of per-domain child rows under this stream (for the section summary).
  activeDomainCount: number;
}

// Cluster row under a stream. Usually a group label with domain leaves below it
// (resources/events/container-logs). For streams with no sub-cluster breakdown
// (catalog), the cluster IS the leaf, so `leaf` carries its per-cluster metrics.
export interface DiagnosticsStreamClusterRow {
  kind: 'cluster';
  rowKey: string;
  cluster: string;
  leaf?: {
    delivered: number;
    dropped: number;
    errors: number;
    lastEvent: string;
    lastEventTooltip: string;
    lastError: string;
    lastErrorAt?: number;
  };
}

// A single (cluster, domain) leaf with its per-domain counters.
export interface DiagnosticsStreamDomainRow {
  kind: 'domain';
  rowKey: string;
  cluster: string;
  domain: string;
  delivered: number;
  dropped: number;
  errors: number;
  resyncs: number | null;
  resyncsTooltip?: string;
  fallbacks: number | null;
  fallbacksTooltip?: string;
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
