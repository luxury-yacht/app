/**
 * frontend/src/core/refresh/components/diagnostics/diagnosticsPanelTypes.ts
 *
 * Type definitions for diagnosticsPanelTypes.
 * Defines shared interfaces and payload shapes for the shared components.
 */

import type { RefreshDomain } from '../../types';
import type { DomainStatus } from '../../store';

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
export interface DiagnosticsStreamRow {
  rowKey: string;
  label: string;
  sessions: number;
  delivered: number;
  dropped: number;
  errors: number;
  resyncs: number | null;
  resyncsTooltip?: string;
  fallbacks: number | null;
  fallbacksTooltip?: string;
  lastConnect: string;
  lastConnectTooltip: string;
  lastEvent: string;
  lastEventTooltip: string;
  lastError: string;
}

export interface CapabilityDescriptorActivityDetails {
  namespace: string;
  descriptorLabel: string;
  resourceKind: string;
  verb: string;
  subresource: string | null;
  pendingCount: number;
  inFlightCount: number;
  runtimeDisplay: string;
  lastDurationDisplay: string;
  lastCompleted: { display: string; tooltip: string };
  lastResult: string;
  consecutiveFailureCount: number;
  totalChecks: number;
  lastError: string | null;
}

export interface CapabilityBatchRow {
  key: string;
  namespace: string;
  pendingCount: number;
  inFlightCount: number;
  runtimeDisplay: string;
  runtimeMs: number | null;
  lastDurationDisplay: string;
  lastCompleted: { display: string; tooltip: string };
  lastResult: string;
  lastError: string | null;
  totalChecks: number;
  consecutiveFailureCount: number;
  descriptorSummary: string | null;
  featureSummary: string | null;
}

export interface PermissionRow {
  scope: string;
  namespace: string;
  descriptorLabel: string;
  resource: string;
  verb: string;
  allowed: string;
  isDenied: boolean;
  reason?: string;
  id: string;
  feature?: string;
  descriptorNamespace: string | null;
  pendingCount: number | null;
  inFlightCount: number | null;
  runtimeDisplay: string;
  lastDurationDisplay: string;
  lastCompleted: { display: string; tooltip: string };
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
