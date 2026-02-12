/**
 * frontend/src/core/refresh/components/RefreshDiagnosticsPanel.tsx
 *
 * UI component for RefreshDiagnosticsPanel.
 * Handles rendering and interactions for the shared components.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './DiagnosticsPanel.css';
import { DockablePanel } from '@components/dockable';
import { useRefreshDomain, useRefreshState, useRefreshScopedDomainEntries } from '../store';
import type {
  RefreshDomain,
  NodeMetricsInfo,
  PodSnapshotPayload,
  ObjectLogsSnapshotPayload,
  ClusterOverviewMetrics,
  ClusterEventsSnapshotPayload,
  NamespaceEventsSnapshotPayload,
  TelemetrySummary,
  TelemetryStreamStatus,
  CatalogSnapshotPayload,
} from '../types';
import { refreshManager } from '../RefreshManager';
import { resourceStreamManager } from '../streaming/resourceStreamManager';
import { useShortcut, useKeyboardNavigationScope } from '@ui/shortcuts';
import { KeyboardScopePriority } from '@ui/shortcuts/priorities';
import { fetchTelemetrySummary } from '../client';
import { stripClusterScope, parseClusterScopeList } from '@/core/refresh/clusterScope';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import {
  getPermissionKey,
  useCapabilityDiagnostics,
  useUserPermissions,
} from '@/core/capabilities';
import { useTabStyles } from '@shared/components/tabs/Tabs';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { useNamespace } from '@/modules/namespace/contexts/NamespaceContext';

// Import from extracted modules
import {
  type DiagnosticsRow,
  type DiagnosticsPanelProps,
  type DiagnosticsStreamRow,
  type CapabilityDescriptorActivityDetails,
  formatInterval,
  formatLastUpdated,
  formatDurationMs,
  STALE_THRESHOLD_MS,
  CLUSTER_SCOPE,
  DOMAIN_REFRESHER_MAP,
  DOMAIN_STREAM_MAP,
  PRIORITY_DOMAINS,
  getScopedFeaturesForView,
  resolveDomainNamespace,
} from './diagnostics';
import { DiagnosticsTable, DiagnosticsSummaryCards } from './diagnostics/TableRefreshDomains';
import { DiagnosticsStreamsTable } from './diagnostics/TableStreams';
import { CapabilityChecksTable } from './diagnostics/TableCapabilitesChecks';
import { EffectivePermissionsTable } from './diagnostics/TableEffectivePermissions';

// Re-export for backwards compatibility
export { resolveDomainNamespace } from './diagnostics';

// Stream labels shown in the diagnostics streams section.
const STREAM_LABELS: Record<string, string> = {
  resources: 'Resources',
  events: 'Events',
  catalog: 'Catalog',
  'object-logs': 'Object Logs',
};

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

type StreamHealthSummary = {
  status: HealthStatus;
  reason: string;
  connectionStatus?: 'connected' | 'disconnected';
  lastMessageAt?: number;
  lastDeliveryAt?: number;
};

const METRICS_ONLY_DOMAINS = new Set<RefreshDomain>(['pods', 'namespace-workloads', 'nodes']);
const STREAM_ONLY_DOMAINS = new Set<RefreshDomain>(['object-logs']);
const PAUSE_POLLING_WHEN_STREAMING_DOMAINS = new Set<RefreshDomain>([
  'catalog',
  'cluster-rbac',
  'cluster-storage',
  'cluster-config',
  'cluster-crds',
  'cluster-custom',
  'cluster-events',
  'namespace-config',
  'namespace-network',
  'namespace-rbac',
  'namespace-storage',
  'namespace-autoscaling',
  'namespace-quotas',
  'namespace-custom',
  'namespace-helm',
  'namespace-events',
]);

const STREAM_MODE_BY_NAME: Record<string, 'streaming' | 'watch'> = {
  resources: 'streaming',
  events: 'watch',
  catalog: 'watch',
  'object-logs': 'streaming',
};

const PERMISSION_ERROR_HINTS = ['forbidden', 'permission', 'unauthorized', 'access denied', 'rbac'];

// Diagnostics helpers for scope, error, and health labels.
type ScopeEntry = { label: 'Active' | 'Background'; clusterName: string };

const resolveScopeDetails = (
  scope: string | undefined,
  activeClusterId: string,
  getClusterMeta: (config: string) => { id: string; name: string }
): { display: string; tooltip?: string; entries?: ScopeEntry[] } => {
  const trimmed = (scope ?? '').trim();
  if (!trimmed) {
    return { display: '-', tooltip: 'No active scope' };
  }
  const { clusterIds } = parseClusterScopeList(trimmed);
  if (clusterIds.length === 0) {
    return { display: trimmed, tooltip: trimmed };
  }
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
      if (a.label === 'Active' && b.label !== 'Active') return -1;
      if (b.label === 'Active' && a.label !== 'Active') return 1;
      return a.clusterName.localeCompare(b.clusterName);
    });
  // Format as "cluster-A (active), cluster-B, cluster-C".
  const display = entries
    .map((e) => (e.label === 'Active' ? `${e.clusterName} (active)` : e.clusterName))
    .join(', ');
  return { display, tooltip: trimmed, entries };
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

export const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({ onClose, isOpen }) => {
  useTabStyles();
  const [activeTab, setActiveTab] = useState<
    'refresh-domains' | 'streams' | 'capability-checks' | 'effective-permissions'
  >('refresh-domains');
  const refreshState = useRefreshState();
  const namespaceDomain = useRefreshDomain('namespaces');
  const clusterOverviewDomain = useRefreshDomain('cluster-overview');
  const nodeDomain = useRefreshDomain('nodes');
  const nodeMaintenanceDomain = useRefreshDomain('node-maintenance');
  const clusterConfigDomain = useRefreshDomain('cluster-config');
  const clusterCRDDomain = useRefreshDomain('cluster-crds');
  const clusterCustomDomain = useRefreshDomain('cluster-custom');
  const clusterRBACDomain = useRefreshDomain('cluster-rbac');
  const clusterStorageDomain = useRefreshDomain('cluster-storage');
  const clusterEventsDomain = useRefreshDomain('cluster-events');
  const catalogDomain = useRefreshDomain('catalog');
  const catalogDiffDomain = useRefreshDomain('catalog-diff');
  const namespaceWorkloadsDomain = useRefreshDomain('namespace-workloads');
  const namespaceAutoscalingDomain = useRefreshDomain('namespace-autoscaling');
  const namespaceConfigDomain = useRefreshDomain('namespace-config');
  const namespaceCustomDomain = useRefreshDomain('namespace-custom');
  const namespaceEventsDomain = useRefreshDomain('namespace-events');
  const namespaceHelmDomain = useRefreshDomain('namespace-helm');
  const namespaceNetworkDomain = useRefreshDomain('namespace-network');
  const namespaceQuotasDomain = useRefreshDomain('namespace-quotas');
  const namespaceRBACDomain = useRefreshDomain('namespace-rbac');
  const namespaceStorageDomain = useRefreshDomain('namespace-storage');
  const podScopeEntries = useRefreshScopedDomainEntries('pods');
  const logScopeEntries = useRefreshScopedDomainEntries('object-logs');
  const [telemetrySummary, setTelemetrySummary] = useState<TelemetrySummary | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const permissionMap = useUserPermissions();
  const capabilityDiagnostics = useCapabilityDiagnostics();
  const { viewType, activeClusterTab, activeNamespaceTab } = useViewState();
  const { selectedNamespace } = useNamespace();
  const { selectedClusterId, getClusterMeta } = useKubeconfig();
  const [showAllPermissions, setShowAllPermissions] = useState(false);
  const [diagnosticsClock, setDiagnosticsClock] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen) {
      setTelemetrySummary(null);
      setTelemetryError(null);
      return;
    }

    let cancelled = false;

    const loadTelemetry = async () => {
      try {
        const summary = await fetchTelemetrySummary();
        if (!cancelled) {
          setTelemetrySummary(summary);
          setTelemetryError(null);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load telemetry';
          setTelemetryError(message);
        }
      }
    };

    void loadTelemetry();
    const intervalId = window.setInterval(loadTelemetry, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const hasInFlight = capabilityDiagnostics.some((entry) => entry.inFlightCount > 0);
    if (!hasInFlight) {
      setDiagnosticsClock(Date.now());
      return;
    }

    const intervalId = window.setInterval(() => {
      setDiagnosticsClock(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [capabilityDiagnostics, isOpen]);

  const domainStates = useMemo(
    () => [
      { domain: 'namespaces' as RefreshDomain, label: 'Namespaces', state: namespaceDomain },
      {
        domain: 'cluster-overview' as RefreshDomain,
        label: 'Cluster Overview',
        state: clusterOverviewDomain,
        hasMetrics: true,
      },
      {
        domain: 'nodes' as RefreshDomain,
        label: 'Nodes',
        state: nodeDomain,
        hasMetrics: true,
      },
      {
        domain: 'cluster-config' as RefreshDomain,
        label: 'Cluster Config',
        state: clusterConfigDomain,
      },
      {
        domain: 'cluster-crds' as RefreshDomain,
        label: 'Cluster CRDs',
        state: clusterCRDDomain,
      },
      {
        domain: 'cluster-custom' as RefreshDomain,
        label: 'Cluster Custom Resources',
        state: clusterCustomDomain,
      },
      {
        domain: 'cluster-events' as RefreshDomain,
        label: 'Cluster Events',
        state: clusterEventsDomain,
      },
      {
        domain: 'node-maintenance' as RefreshDomain,
        label: 'Node Maintenance',
        state: nodeMaintenanceDomain,
      },
      {
        domain: 'catalog' as RefreshDomain,
        label: 'Browse Catalog',
        state: catalogDomain,
      },
      {
        domain: 'catalog-diff' as RefreshDomain,
        label: 'Diff Catalog',
        state: catalogDiffDomain,
      },
      {
        domain: 'cluster-rbac' as RefreshDomain,
        label: 'Cluster RBAC',
        state: clusterRBACDomain,
      },
      {
        domain: 'cluster-storage' as RefreshDomain,
        label: 'Cluster Storage',
        state: clusterStorageDomain,
      },
      {
        domain: 'namespace-workloads' as RefreshDomain,
        label: 'Workloads',
        state: namespaceWorkloadsDomain,
      },
      {
        domain: 'namespace-autoscaling' as RefreshDomain,
        label: 'NS Autoscaling',
        state: namespaceAutoscalingDomain,
      },
      {
        domain: 'namespace-config' as RefreshDomain,
        label: 'NS Config',
        state: namespaceConfigDomain,
      },
      {
        domain: 'namespace-custom' as RefreshDomain,
        label: 'NS Custom',
        state: namespaceCustomDomain,
      },
      {
        domain: 'namespace-events' as RefreshDomain,
        label: 'NS Events',
        state: namespaceEventsDomain,
      },
      {
        domain: 'namespace-helm' as RefreshDomain,
        label: 'NS Helm',
        state: namespaceHelmDomain,
      },
      {
        domain: 'namespace-network' as RefreshDomain,
        label: 'NS Network',
        state: namespaceNetworkDomain,
      },
      {
        domain: 'namespace-quotas' as RefreshDomain,
        label: 'NS Quotas',
        state: namespaceQuotasDomain,
      },
      {
        domain: 'namespace-rbac' as RefreshDomain,
        label: 'NS RBAC',
        state: namespaceRBACDomain,
      },
      {
        domain: 'namespace-storage' as RefreshDomain,
        label: 'NS Storage',
        state: namespaceStorageDomain,
      },
    ],
    [
      namespaceDomain,
      clusterOverviewDomain,
      nodeDomain,
      nodeMaintenanceDomain,
      catalogDomain,
      catalogDiffDomain,
      clusterCRDDomain,
      clusterCustomDomain,
      clusterConfigDomain,
      clusterEventsDomain,
      clusterRBACDomain,
      clusterStorageDomain,
      namespaceWorkloadsDomain,
      namespaceAutoscalingDomain,
      namespaceConfigDomain,
      namespaceEventsDomain,
      namespaceCustomDomain,
      namespaceHelmDomain,
      namespaceNetworkDomain,
      namespaceQuotasDomain,
      namespaceRBACDomain,
      namespaceStorageDomain,
    ]
  );

  const resourceStreamStats = resourceStreamManager.getTelemetrySummary();
  const rows = useMemo<DiagnosticsRow[]>(() => {
    const prioritySet = new Set(PRIORITY_DOMAINS);

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

    const resolveHealthDetails = (params: {
      domain: RefreshDomain;
      status: DiagnosticsRow['status'];
      error?: string | null;
      scope?: string;
      streamHealth?: StreamHealthSummary | null;
    }): { label: string; tooltip?: string; status: HealthStatus } => {
      const { domain, status, error, scope, streamHealth } = params;
      const scopeTrimmed = (scope ?? '').trim();
      if (!scopeTrimmed && (domain === 'pods' || domain === 'object-logs')) {
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
        const tooltipParts: string[] = [`Reason: ${streamHealth.reason}`];
        if (streamHealth.connectionStatus) {
          tooltipParts.push(`Connection: ${streamHealth.connectionStatus}`);
        }
        if (streamHealth.lastDeliveryAt) {
          const deliveryInfo = formatLastUpdated(streamHealth.lastDeliveryAt);
          tooltipParts.push(`Last delivery: ${deliveryInfo.tooltip}`);
        }
        if (streamHealth.lastMessageAt) {
          const messageInfo = formatLastUpdated(streamHealth.lastMessageAt);
          tooltipParts.push(`Last message: ${messageInfo.tooltip}`);
        }
        return {
          label: formatHealthLabel(streamHealth.status, streamHealth.reason),
          tooltip: tooltipParts.join('\n'),
          status: streamHealth.status,
        };
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

    const resolvePollingDetails = (params: {
      domain: RefreshDomain;
      refresherName?: (typeof DOMAIN_REFRESHER_MAP)[RefreshDomain];
      streamActive: boolean;
      streamHealthy: boolean;
      metricsOnly: boolean;
    }): { label: string; tooltip?: string; enabled: boolean } => {
      const { domain, refresherName, streamActive, streamHealthy, metricsOnly } = params;
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
        if (PAUSE_POLLING_WHEN_STREAMING_DOMAINS.has(domain) && streamActive) {
          const reason = streamHealthy ? 'stream healthy' : 'stream active';
          return { label: 'paused', tooltip: `Paused while ${reason}`, enabled: false };
        }
        return { label: 'disabled', tooltip: 'Polling disabled for this domain', enabled: false };
      }
      const tooltipParts = [`State: ${refresherState.status}`];
      if (metricsOnly) {
        tooltipParts.push('Metrics-only polling');
      }
      return { label: 'enabled', tooltip: tooltipParts.join(' • '), enabled: true };
    };

    const resolveModeDetails = (params: {
      domain: RefreshDomain;
      streamMode: 'streaming' | 'watch' | null;
      streamActive: boolean;
      streamHealthy: boolean;
      pollingEnabled: boolean;
      metricsOnly: boolean;
    }): { label: string; tooltip?: string } => {
      const { domain, streamMode, streamActive, streamHealthy, pollingEnabled, metricsOnly } =
        params;
      if (streamMode && STREAM_ONLY_DOMAINS.has(domain)) {
        return { label: streamMode, tooltip: 'Stream-only domain' };
      }
      if (metricsOnly && streamHealthy) {
        return {
          label: 'metrics-only',
          tooltip: 'Stream healthy; polling metrics snapshots only',
        };
      }
      if (streamMode && streamActive && streamHealthy) {
        return { label: streamMode, tooltip: 'Stream delivering updates' };
      }
      if (pollingEnabled) {
        return { label: 'polling', tooltip: 'Snapshot polling active' };
      }
      if (streamMode && streamActive) {
        return { label: streamMode, tooltip: 'Stream active but unhealthy' };
      }
      return { label: 'snapshot', tooltip: 'Snapshot fetched on demand' };
    };

    const baseRows = domainStates.map<DiagnosticsRow>(({ domain, state, label, hasMetrics }) => {
      const hasMetricsFlag = Boolean(hasMetrics);
      const telemetryInfo = telemetrySummary?.snapshots.find((entry) => entry.domain === domain);
      const streamName = DOMAIN_STREAM_MAP[domain];
      const streamTelemetry = streamName
        ? telemetrySummary?.streams.find((entry) => entry.name === streamName)
        : undefined;
      const isResourceStreamDomain = streamName === 'resources';
      const streamMode = streamName ? (STREAM_MODE_BY_NAME[streamName] ?? 'streaming') : null;
      const scopeDetails = resolveScopeDetails(state.scope, selectedClusterId, getClusterMeta);
      const streamLastEvent = isResourceStreamDomain ? streamTelemetry?.lastEvent : 0;
      const baseLastUpdated = state.lastUpdated ?? state.lastAutoRefresh ?? state.lastManualRefresh;
      const lastUpdated = (() => {
        const combined = Math.max(baseLastUpdated ?? 0, streamLastEvent ?? 0);
        return combined > 0 ? combined : undefined;
      })();
      const isStale = lastUpdated ? Date.now() - lastUpdated > STALE_THRESHOLD_MS : false;
      const metricsInfo: (NodeMetricsInfo | ClusterOverviewMetrics) | undefined = hasMetricsFlag
        ? (state.data as any)?.metrics
        : undefined;
      const telemetryLastUpdatedInfo = (() => {
        if (streamLastEvent && streamLastEvent > 0) {
          return formatLastUpdated(streamLastEvent);
        }
        if (telemetryInfo?.lastUpdated) {
          return formatLastUpdated(telemetryInfo.lastUpdated);
        }
        return null;
      })();
      const durationLabel = telemetryInfo?.lastDurationMs
        ? `${telemetryInfo.lastDurationMs} ms`
        : '—';
      const telemetrySuccess = telemetryInfo?.successCount;
      const telemetryFailure = telemetryInfo?.failureCount;
      const telemetryLastError = telemetryInfo?.lastError?.trim() ?? '';
      const combinedError = telemetryLastError || state.error || '—';
      const snapshotTelemetryStatus = (() => {
        if (!telemetrySummary) {
          return '—';
        }
        if (!telemetryInfo) {
          return 'No data';
        }
        return telemetryInfo.lastStatus === 'error'
          ? `Error (${telemetryInfo.failureCount})`
          : `Success (${telemetryInfo.successCount})`;
      })();
      const streamTelemetryStatus =
        isResourceStreamDomain && streamTelemetry
          ? streamTelemetry.errorCount > 0
            ? `Stream Error (${streamTelemetry.errorCount})`
            : streamTelemetry.droppedMessages > 0
              ? `Stream Dropped (${streamTelemetry.droppedMessages})`
              : 'Stream OK'
          : null;
      // Show resource stream health alongside snapshot and telemetry summaries.
      const streamHealth =
        isResourceStreamDomain && state.scope
          ? toStreamHealthSummary(resourceStreamManager.getHealthSnapshot(domain, state.scope))
          : resolveStreamTelemetryHealth(streamTelemetry);
      const streamHealthStatus = streamHealth ? `Stream ${streamHealth.status}` : null;
      const telemetryStatus = [snapshotTelemetryStatus, streamTelemetryStatus, streamHealthStatus]
        .filter(Boolean)
        .join(' • ');
      const streamDropped = isResourceStreamDomain ? (streamTelemetry?.droppedMessages ?? 0) : 0;
      const telemetryTooltipParts: string[] = [];
      if (telemetryLastError) {
        telemetryTooltipParts.push(telemetryLastError);
      }
      if (isResourceStreamDomain && streamTelemetry) {
        telemetryTooltipParts.push(`Stream delivered: ${streamTelemetry.totalMessages}`);
        telemetryTooltipParts.push(`Stream dropped: ${streamTelemetry.droppedMessages}`);
        if (streamTelemetry.lastError) {
          telemetryTooltipParts.push(`Stream error: ${streamTelemetry.lastError}`);
        }
        if (resourceStreamStats.resyncCount > 0) {
          telemetryTooltipParts.push(`Stream resyncs: ${resourceStreamStats.resyncCount}`);
        }
        if (resourceStreamStats.fallbackCount > 0) {
          telemetryTooltipParts.push(`Stream fallbacks: ${resourceStreamStats.fallbackCount}`);
        }
        if (resourceStreamStats.lastResyncReason) {
          telemetryTooltipParts.push(`Last resync: ${resourceStreamStats.lastResyncReason}`);
        }
        if (resourceStreamStats.lastFallbackReason) {
          telemetryTooltipParts.push(`Last fallback: ${resourceStreamStats.lastFallbackReason}`);
        }
      }
      if (streamHealth) {
        telemetryTooltipParts.push(`Stream health: ${streamHealth.status}`);
        telemetryTooltipParts.push(`Stream reason: ${streamHealth.reason}`);
        if (streamHealth.lastDeliveryAt) {
          const deliveryInfo = formatLastUpdated(streamHealth.lastDeliveryAt);
          telemetryTooltipParts.push(`Stream last delivery: ${deliveryInfo.tooltip}`);
        }
        if (streamHealth.lastMessageAt) {
          const messageInfo = formatLastUpdated(streamHealth.lastMessageAt);
          telemetryTooltipParts.push(`Stream last message: ${messageInfo.tooltip}`);
        }
      }
      const telemetryTooltip =
        telemetryTooltipParts.length > 0 ? telemetryTooltipParts.join('\n') : undefined;
      const successCount = metricsInfo?.successCount ?? (hasMetricsFlag ? 0 : undefined);
      const failureCount = metricsInfo?.failureCount ?? (hasMetricsFlag ? 0 : undefined);
      const metricsStatus = hasMetricsFlag
        ? metricsInfo
          ? metricsInfo.lastError
            ? `Error (${failureCount} fails)`
            : metricsInfo.stale
              ? `Unavailable (${failureCount} fails)`
              : `OK (${successCount} polls)`
          : 'N/A'
        : '—';
      const tooltipLines: string[] = [];
      if (metricsInfo) {
        tooltipLines.push(`Successful polls: ${successCount}`);
        tooltipLines.push(`Failed polls: ${failureCount}`);
        if (metricsInfo.lastError) {
          tooltipLines.push(`Last error: ${metricsInfo.lastError}`);
        } else if (metricsInfo.stale) {
          tooltipLines.push('Metrics API unavailable');
        } else if (metricsInfo.collectedAt) {
          tooltipLines.push('Metrics are up to date');
        }
      }
      const metricsTooltip =
        tooltipLines.length > 0
          ? tooltipLines.join('\n')
          : hasMetricsFlag
            ? 'No metrics available'
            : 'Not applicable';
      const data = state.data as any;
      let count = (() => {
        if (!data) {
          return 0;
        }
        switch (domain) {
          case 'namespaces':
            return Array.isArray(data.namespaces) ? data.namespaces.length : 0;
          case 'cluster-overview':
            return data.overview?.totalNodes ?? 0;
          case 'nodes':
            return Array.isArray(data.nodes) ? data.nodes.length : 0;
          case 'node-maintenance':
            return Array.isArray(data.drains) ? data.drains.length : 0;
          case 'cluster-rbac':
            return Array.isArray(data.resources) ? data.resources.length : 0;
          case 'cluster-storage':
            return Array.isArray(data.volumes) ? data.volumes.length : 0;
          case 'cluster-config':
            return Array.isArray(data.resources) ? data.resources.length : 0;
          case 'cluster-crds':
            return Array.isArray(data.definitions) ? data.definitions.length : 0;
          case 'cluster-custom':
            return Array.isArray(data.resources) ? data.resources.length : 0;
          case 'cluster-events':
            return Array.isArray(data.events) ? data.events.length : 0;
          case 'catalog':
            return Array.isArray(data.items) ? data.items.length : 0;
          case 'namespace-workloads':
            return Array.isArray(data.workloads) ? data.workloads.length : 0;
          case 'namespace-config':
            return Array.isArray(data.resources) ? data.resources.length : 0;
          case 'namespace-network':
            return Array.isArray(data.resources) ? data.resources.length : 0;
          case 'namespace-rbac':
            return Array.isArray(data.resources) ? data.resources.length : 0;
          case 'namespace-storage':
            return Array.isArray(data.resources) ? data.resources.length : 0;
          case 'namespace-autoscaling':
            return Array.isArray(data.resources) ? data.resources.length : 0;
          case 'namespace-quotas':
            return Array.isArray(data.resources) ? data.resources.length : 0;
          case 'namespace-events':
            return Array.isArray(data.events) ? data.events.length : 0;
          case 'namespace-custom':
            return Array.isArray(data.resources) ? data.resources.length : 0;
          case 'namespace-helm':
            return Array.isArray(data.releases) ? data.releases.length : 0;
          default:
            return 0;
        }
      })();
      const lastUpdatedInfo = formatLastUpdated(lastUpdated);
      const refresherName = DOMAIN_REFRESHER_MAP[domain];
      const intervalLabel = formatInterval(
        refresherName ? refreshManager.getRefresherInterval(refresherName) : null
      );
      const namespaceLabel = resolveDomainNamespace(domain, state.scope);
      const stats = state.stats;
      let truncated = Boolean(stats?.truncated);
      let totalItems = stats?.totalItems ?? (truncated ? count : undefined);
      let warnings = (stats?.warnings ?? []).filter((warning) => warning && warning.trim().length);
      if (domain === 'catalog') {
        const catalogTotal =
          stats?.totalItems ??
          (typeof data?.total === 'number'
            ? data.total
            : Array.isArray(data?.items)
              ? data.items.length
              : 0);
        count = catalogTotal;
        totalItems = catalogTotal;
        truncated = false;
      }
      if (truncated && totalItems !== undefined && warnings.length === 0 && count !== totalItems) {
        warnings = [`Showing most recent ${count} of ${totalItems} items`];
      }
      const countDisplay =
        truncated && totalItems !== undefined ? `${count} / ${totalItems}` : String(count);
      const countTooltip = warnings.length > 0 ? warnings.join('\n') : undefined;
      const countClassName = warnings.length > 0 ? 'diagnostics-count-warning' : undefined;

      const version = state.version != null ? String(state.version) : '—';
      const streamActive = isResourceStreamDomain
        ? Boolean(streamHealth && streamHealth.reason !== 'inactive')
        : Boolean(streamTelemetry?.activeSessions);
      const streamHealthy = streamHealth?.status === 'healthy';
      const metricsOnly = METRICS_ONLY_DOMAINS.has(domain);
      const pollingDetails = resolvePollingDetails({
        domain,
        refresherName,
        streamActive,
        streamHealthy,
        metricsOnly,
      });
      const modeDetails = resolveModeDetails({
        domain,
        streamMode,
        streamActive,
        streamHealthy,
        pollingEnabled: pollingDetails.enabled,
        metricsOnly,
      });
      const healthDetails = resolveHealthDetails({
        domain,
        status: state.status,
        error: state.error,
        scope: state.scope,
        streamHealth,
      });

      return {
        rowKey: domain,
        domain,
        label,
        status: state.status,
        version,
        interval: intervalLabel,
        lastUpdated: telemetryLastUpdatedInfo?.display ?? lastUpdatedInfo.display,
        lastUpdatedTooltip: telemetryLastUpdatedInfo?.tooltip ?? lastUpdatedInfo.tooltip,
        dropped: state.droppedAutoRefreshes + streamDropped,
        stale: isStale,
        error: combinedError,
        telemetryStatus,
        telemetryTooltip,
        metricsStatus,
        metricsTooltip,
        metricsStale: metricsInfo?.stale,
        metricsSuccess: successCount,
        metricsFailure: failureCount,
        duration: durationLabel,
        telemetrySuccess,
        telemetryFailure,
        hasMetrics: hasMetricsFlag,
        count,
        countDisplay,
        countTooltip,
        countClassName,
        warnings,
        truncated,
        totalItems,
        namespace: namespaceLabel,
        scope: scopeDetails.display,
        scopeTooltip: scopeDetails.tooltip,
        scopeEntries: scopeDetails.entries,
        mode: modeDetails.label,
        modeTooltip: modeDetails.tooltip,
        healthStatus: healthDetails.label,
        healthTooltip: healthDetails.tooltip,
        pollingStatus: pollingDetails.label,
        pollingTooltip: pollingDetails.tooltip,
      };
    });

    const podScopes = podScopeEntries;

    const podSummaryInterval = formatInterval(
      DOMAIN_REFRESHER_MAP.pods
        ? refreshManager.getRefresherInterval(DOMAIN_REFRESHER_MAP.pods)
        : null
    );

    const podSummaryLastUpdatedTs = podScopes.reduce((latest, [, state]) => {
      const timestamp = state.lastUpdated ?? state.lastAutoRefresh ?? state.lastManualRefresh ?? 0;
      return Math.max(latest, timestamp);
    }, 0);

    const podSummaryLastUpdatedInfo = formatLastUpdated(
      podSummaryLastUpdatedTs > 0 ? podSummaryLastUpdatedTs : undefined
    );

    const podSummaryStatus = (() => {
      if (podScopes.some(([, state]) => state.status === 'error')) return 'error';
      if (podScopes.some(([, state]) => state.status === 'initialising')) return 'initialising';
      if (podScopes.some(([, state]) => state.status === 'loading')) return 'loading';
      if (podScopes.some(([, state]) => state.status === 'updating')) return 'updating';
      if (podScopes.some(([, state]) => state.status === 'ready')) return 'ready';
      return 'idle';
    })();

    const podSummaryDropped = podScopes.reduce(
      (acc, [, state]) => acc + (state.droppedAutoRefreshes ?? 0),
      0
    );

    const podSummaryCount = podScopes.reduce((acc, [, state]) => {
      const payload = state.data as PodSnapshotPayload | null;
      return acc + (payload?.pods?.length ?? 0);
    }, 0);

    const podSummaryStale = podScopes.some(([, state]) => {
      const payload = state.data as PodSnapshotPayload | null;
      return Boolean(payload?.metrics?.stale);
    });

    const podSummaryError = (() => {
      const problem = podScopes.find(([, state]) => state.error);
      return problem?.[1].error ?? '—';
    })();

    const podSummaryVersion = (() => {
      const maxVersion = podScopes.reduce((acc, [, state]) => {
        const version = state.version ?? 0;
        return version > acc ? version : acc;
      }, 0);
      return maxVersion > 0 ? String(maxVersion) : '—';
    })();

    const podSuccess = podScopes.reduce((acc, [, state]) => {
      const payload = state.data as PodSnapshotPayload | null;
      return acc + (payload?.metrics?.successCount ?? 0);
    }, 0);

    const podFailures = podScopes.reduce((acc, [, state]) => {
      const payload = state.data as PodSnapshotPayload | null;
      return acc + (payload?.metrics?.failureCount ?? 0);
    }, 0);

    const anyMetricsError = podScopes.some(([, state]) => {
      const payload = state.data as PodSnapshotPayload | null;
      return Boolean(payload?.metrics?.lastError);
    });

    let podSummaryMetricsStatus = '—';
    let podSummaryMetricsTooltip = podScopes.length
      ? 'Aggregated across pod scopes'
      : 'No pod scopes active';

    if (podScopes.length) {
      if (anyMetricsError) {
        podSummaryMetricsStatus = `Error (${podFailures} fails)`;
        podSummaryMetricsTooltip = 'One or more pod scopes reported metrics errors';
      } else if (podSummaryStale) {
        podSummaryMetricsStatus = `Unavailable (${podFailures} fails)`;
        podSummaryMetricsTooltip = 'One or more pod scopes have stale metrics data';
      } else if (podSuccess > 0) {
        podSummaryMetricsStatus = `OK (${podSuccess} polls)`;
        podSummaryMetricsTooltip = 'Pod metrics polls aggregated across scopes';
      } else {
        podSummaryMetricsStatus = 'N/A';
      }
    }

    // Aggregate pod stream health across scopes using worst-status wins.
    const podSummaryHealth = (() => {
      if (!podScopes.length) {
        return null;
      }
      let hasHealthEntry = false;
      const healthOrder = { healthy: 0, degraded: 1, unhealthy: 2 } as const;
      let status: keyof typeof healthOrder = 'healthy';
      let reason = 'delivering';
      let lastDeliveryAt = 0;
      let lastMessageAt = 0;
      let connectionStatus: StreamHealthSummary['connectionStatus'];
      podScopes.forEach(([scope]) => {
        const health = resourceStreamManager.getHealthSnapshot('pods', scope);
        if (!health) {
          return;
        }
        hasHealthEntry = true;
        if (!connectionStatus) {
          connectionStatus = health.connectionStatus;
        }
        if (healthOrder[health.status] > healthOrder[status]) {
          status = health.status;
          reason = health.reason;
        }
        lastDeliveryAt = Math.max(lastDeliveryAt, health.lastDeliveryAt ?? 0);
        lastMessageAt = Math.max(lastMessageAt, health.lastMessageAt ?? 0);
      });
      if (!hasHealthEntry) {
        return null;
      }
      return {
        status,
        reason,
        connectionStatus,
        lastDeliveryAt: lastDeliveryAt || undefined,
        lastMessageAt: lastMessageAt || undefined,
      };
    })();

    const podSummaryTelemetryStatus = [
      podSummaryStatus,
      podSummaryHealth ? `Stream ${podSummaryHealth.status}` : null,
    ]
      .filter(Boolean)
      .join(' • ');
    const podSummaryTelemetryTooltipParts: string[] = [];
    if (podSummaryError !== '—') {
      podSummaryTelemetryTooltipParts.push(podSummaryError);
    }
    if (podSummaryHealth) {
      podSummaryTelemetryTooltipParts.push(`Stream health: ${podSummaryHealth.status}`);
      podSummaryTelemetryTooltipParts.push(`Stream reason: ${podSummaryHealth.reason}`);
      if (podSummaryHealth.lastDeliveryAt) {
        const deliveryInfo = formatLastUpdated(podSummaryHealth.lastDeliveryAt);
        podSummaryTelemetryTooltipParts.push(`Stream last delivery: ${deliveryInfo.tooltip}`);
      }
      if (podSummaryHealth.lastMessageAt) {
        const messageInfo = formatLastUpdated(podSummaryHealth.lastMessageAt);
        podSummaryTelemetryTooltipParts.push(`Stream last message: ${messageInfo.tooltip}`);
      }
    }
    const podSummaryTelemetryTooltip =
      podSummaryTelemetryTooltipParts.length > 0
        ? podSummaryTelemetryTooltipParts.join('\n')
        : undefined;

    const podScopeDetails = (() => {
      if (!podScopes.length) {
        return { display: '-', tooltip: 'No pod scopes active' };
      }
      if (podScopes.length === 1) {
        return resolveScopeDetails(podScopes[0][0], selectedClusterId, getClusterMeta);
      }
      return {
        display: 'multiple',
        tooltip: podScopes.map(([scope]) => scope).join('\n'),
      };
    })();

    const podStreamMode = STREAM_MODE_BY_NAME.resources;
    const podStreamActive = Boolean(podSummaryHealth && podSummaryHealth.reason !== 'inactive');
    const podStreamHealthy = podSummaryHealth?.status === 'healthy';
    const podPollingDetails = resolvePollingDetails({
      domain: 'pods',
      refresherName: DOMAIN_REFRESHER_MAP.pods,
      streamActive: podStreamActive,
      streamHealthy: podStreamHealthy,
      metricsOnly: true,
    });
    const podModeDetails = resolveModeDetails({
      domain: 'pods',
      streamMode: podStreamMode,
      streamActive: podStreamActive,
      streamHealthy: podStreamHealthy,
      pollingEnabled: podPollingDetails.enabled,
      metricsOnly: true,
    });
    const podHealthDetails = resolveHealthDetails({
      domain: 'pods',
      status: podSummaryStatus,
      error: podSummaryError !== '—' ? podSummaryError : null,
      scope: podScopes.length ? podScopeDetails.display : '',
      streamHealth: podSummaryHealth ?? null,
    });

    const podSummaryRow: DiagnosticsRow = {
      rowKey: 'pods-summary',
      domain: 'pods' as RefreshDomain,
      label: 'Pods',
      status: podSummaryStatus,
      version: podSummaryVersion,
      interval: podSummaryInterval,
      lastUpdated: podSummaryLastUpdatedInfo.display,
      lastUpdatedTooltip: podSummaryLastUpdatedInfo.tooltip,
      duration: '—',
      dropped: podSummaryDropped,
      stale: podSummaryStale,
      error: podSummaryError,
      telemetryStatus: podSummaryTelemetryStatus,
      telemetryTooltip: podSummaryTelemetryTooltip,
      metricsStatus: podSummaryMetricsStatus,
      metricsTooltip: podSummaryMetricsTooltip,
      metricsStale: podSummaryStale,
      metricsSuccess: podSuccess,
      metricsFailure: podFailures,
      telemetrySuccess: podSuccess,
      telemetryFailure: podFailures,
      hasMetrics: podScopes.length > 0,
      count: podSummaryCount,
      countDisplay: String(podSummaryCount),
      countTooltip: undefined,
      countClassName: undefined,
      warnings: [],
      truncated: false,
      totalItems: undefined,
      namespace: '-',
      scope: podScopeDetails.display,
      scopeTooltip: podScopeDetails.tooltip,
      scopeEntries: podScopeDetails.entries,
      mode: podModeDetails.label,
      modeTooltip: podModeDetails.tooltip,
      healthStatus: podHealthDetails.label,
      healthTooltip: podHealthDetails.tooltip,
      pollingStatus: podPollingDetails.label,
      pollingTooltip: podPollingDetails.tooltip,
    };

    const podRows = podScopes.map<DiagnosticsRow>(([scope, state]) => {
      const payload = state.data as PodSnapshotPayload | null;
      const metricsInfo = payload?.metrics;
      const lastUpdated = state.lastUpdated ?? state.lastAutoRefresh ?? state.lastManualRefresh;
      const isStale = lastUpdated ? Date.now() - lastUpdated > STALE_THRESHOLD_MS : false;
      const lastUpdatedInfo = formatLastUpdated(lastUpdated);
      const refresherName = DOMAIN_REFRESHER_MAP.pods;
      const intervalLabel = formatInterval(
        refresherName ? refreshManager.getRefresherInterval(refresherName) : null
      );
      const namespaceLabel = resolveDomainNamespace('pods', scope);
      const count = payload?.pods?.length ?? 0;
      const stats = state.stats;
      const truncated = Boolean(stats?.truncated);
      const totalItems = stats?.totalItems ?? (truncated ? count : undefined);
      let warnings = (stats?.warnings ?? []).filter((warning) => warning && warning.trim().length);
      if (truncated && totalItems !== undefined && warnings.length === 0 && count !== totalItems) {
        warnings = [`Showing most recent ${count} of ${totalItems} pods`];
      }
      const countDisplay =
        truncated && totalItems !== undefined ? `${count} / ${totalItems}` : String(count);
      const countTooltip = warnings.length > 0 ? warnings.join('\n') : undefined;
      const countClassName = warnings.length > 0 ? 'diagnostics-count-warning' : undefined;
      const successCount = metricsInfo?.successCount ?? 0;
      const failureCount = metricsInfo?.failureCount ?? 0;
      const metricsStatus = metricsInfo
        ? metricsInfo.lastError
          ? `Error (${failureCount} fails)`
          : metricsInfo.stale
            ? `Unavailable (${failureCount} fails)`
            : `OK (${successCount} polls)`
        : 'N/A';
      const metricsTooltipLines: string[] = [];
      if (metricsInfo) {
        metricsTooltipLines.push(`Successful polls: ${successCount}`);
        metricsTooltipLines.push(`Failed polls: ${failureCount}`);
        if (metricsInfo.lastError) {
          metricsTooltipLines.push(`Last error: ${metricsInfo.lastError}`);
        } else if (metricsInfo.stale) {
          metricsTooltipLines.push('Metrics API unavailable (pods.metrics.k8s.io)');
        } else if (metricsInfo.collectedAt) {
          metricsTooltipLines.push('Metrics are up to date');
        }
      }
      const version = state.version != null ? String(state.version) : '—';
      const streamHealth = toStreamHealthSummary(
        resourceStreamManager.getHealthSnapshot('pods', scope)
      );
      const streamActive = Boolean(streamHealth && streamHealth.reason !== 'inactive');
      const streamHealthy = streamHealth?.status === 'healthy';
      const modeDetails = resolveModeDetails({
        domain: 'pods',
        streamMode: podStreamMode,
        streamActive,
        streamHealthy,
        pollingEnabled: podPollingDetails.enabled,
        metricsOnly: true,
      });
      const healthDetails = resolveHealthDetails({
        domain: 'pods',
        status: state.status,
        error: state.error,
        scope,
        streamHealth,
      });
      const scopeDetails = resolveScopeDetails(scope, selectedClusterId, getClusterMeta);
      const telemetryStatus = [state.status, streamHealth ? `Stream ${streamHealth.status}` : null]
        .filter(Boolean)
        .join(' • ');
      const telemetryTooltipParts: string[] = [];
      if (state.error) {
        telemetryTooltipParts.push(state.error);
      }
      if (streamHealth) {
        telemetryTooltipParts.push(`Stream health: ${streamHealth.status}`);
        telemetryTooltipParts.push(`Stream reason: ${streamHealth.reason}`);
        if (streamHealth.lastDeliveryAt) {
          const deliveryInfo = formatLastUpdated(streamHealth.lastDeliveryAt);
          telemetryTooltipParts.push(`Stream last delivery: ${deliveryInfo.tooltip}`);
        }
        if (streamHealth.lastMessageAt) {
          const messageInfo = formatLastUpdated(streamHealth.lastMessageAt);
          telemetryTooltipParts.push(`Stream last message: ${messageInfo.tooltip}`);
        }
      }
      const telemetryTooltip =
        telemetryTooltipParts.length > 0 ? telemetryTooltipParts.join('\n') : undefined;

      const displayScope = stripClusterScope(scope);
      let label = 'Pods';
      if (displayScope.startsWith('namespace:')) {
        const namespace = displayScope.slice('namespace:'.length) || 'all';
        label = namespace === 'all' ? 'Pods (All namespaces)' : `Pods (${namespace})`;
      } else if (displayScope.startsWith('node:')) {
        const nodeName = displayScope.slice('node:'.length);
        label = `Pods (Node ${nodeName})`;
      } else if (displayScope.startsWith('workload:')) {
        const [, namespace, kind, name] = displayScope.split(':');
        label = `Pods (${namespace}/${kind}/${name})`;
      }

      return {
        rowKey: `pods:${scope}`,
        domain: 'pods' as RefreshDomain,
        label,
        status: state.status,
        version,
        interval: intervalLabel,
        lastUpdated: lastUpdatedInfo.display,
        lastUpdatedTooltip: lastUpdatedInfo.tooltip,
        duration: '—',
        dropped: state.droppedAutoRefreshes,
        stale: isStale,
        error: state.error ?? '—',
        telemetryStatus,
        telemetryTooltip,
        metricsStatus,
        metricsTooltip:
          metricsTooltipLines.length > 0 ? metricsTooltipLines.join('\n') : 'No metrics available',
        metricsStale: Boolean(metricsInfo?.stale),
        metricsSuccess: successCount,
        metricsFailure: failureCount,
        telemetrySuccess: successCount,
        telemetryFailure: failureCount,
        hasMetrics: true,
        count,
        countDisplay,
        countTooltip,
        countClassName,
        warnings,
        truncated,
        totalItems,
        namespace: namespaceLabel,
        scope: scopeDetails.display,
        scopeTooltip: scopeDetails.tooltip,
        scopeEntries: scopeDetails.entries,
        mode: modeDetails.label,
        modeTooltip: modeDetails.tooltip,
        healthStatus: healthDetails.label,
        healthTooltip: healthDetails.tooltip,
        pollingStatus: podPollingDetails.label,
        pollingTooltip: podPollingDetails.tooltip,
      };
    });

    const orderedPodRows = podRows.sort((a, b) => a.label.localeCompare(b.label));

    const logSummaryLastUpdatedTs = logScopeEntries.reduce((latest, [, state]) => {
      const timestamp = state.lastUpdated ?? state.lastAutoRefresh ?? state.lastManualRefresh ?? 0;
      return Math.max(latest, timestamp);
    }, 0);

    const logSummaryLastUpdatedInfo = formatLastUpdated(
      logSummaryLastUpdatedTs > 0 ? logSummaryLastUpdatedTs : undefined
    );

    const logSummaryStatus = (() => {
      if (logScopeEntries.some(([, state]) => state.status === 'error')) return 'error';
      if (logScopeEntries.some(([, state]) => state.status === 'initialising'))
        return 'initialising';
      if (logScopeEntries.some(([, state]) => state.status === 'loading')) return 'loading';
      if (logScopeEntries.some(([, state]) => state.status === 'updating')) return 'updating';
      if (logScopeEntries.some(([, state]) => state.status === 'ready')) return 'ready';
      return 'idle';
    })();

    const logSummaryDropped = logScopeEntries.reduce(
      (acc, [, state]) => acc + (state.droppedAutoRefreshes ?? 0),
      0
    );

    const logSummaryCount = logScopeEntries.reduce((acc, [, state]) => {
      const payload = state.data as ObjectLogsSnapshotPayload | null;
      return acc + (payload?.entries?.length ?? 0);
    }, 0);

    const logSummaryError = (() => {
      const problem = logScopeEntries.find(([, state]) => state.error);
      return problem?.[1].error ?? '—';
    })();

    const logSummaryVersion = (() => {
      const maxReset = logScopeEntries.reduce((acc, [, state]) => {
        const payload = state.data as ObjectLogsSnapshotPayload | null;
        const resetCount = payload?.resetCount ?? 0;
        return Math.max(acc, resetCount);
      }, 0);
      return maxReset > 0 ? String(maxReset) : '—';
    })();

    const logScopeDetails = (() => {
      if (!logScopeEntries.length) {
        return { display: '-', tooltip: 'No log scopes active' };
      }
      if (logScopeEntries.length === 1) {
        return resolveScopeDetails(logScopeEntries[0][0], selectedClusterId, getClusterMeta);
      }
      return {
        display: 'multiple',
        tooltip: logScopeEntries.map(([scope]) => scope).join('\n'),
      };
    })();

    const logStreamTelemetry = telemetrySummary?.streams.find(
      (entry) => entry.name === 'object-logs'
    );
    const logStreamHealth = resolveStreamTelemetryHealth(logStreamTelemetry);
    const logStreamActive = Boolean(logStreamTelemetry?.activeSessions);
    const logStreamHealthy = logStreamHealth?.status === 'healthy';
    const logPollingDetails = resolvePollingDetails({
      domain: 'object-logs',
      refresherName: DOMAIN_REFRESHER_MAP['object-logs'],
      streamActive: logStreamActive,
      streamHealthy: logStreamHealthy,
      metricsOnly: false,
    });
    const logModeDetails = resolveModeDetails({
      domain: 'object-logs',
      streamMode: STREAM_MODE_BY_NAME['object-logs'],
      streamActive: logStreamActive,
      streamHealthy: logStreamHealthy,
      pollingEnabled: logPollingDetails.enabled,
      metricsOnly: false,
    });
    const logHealthDetails = resolveHealthDetails({
      domain: 'object-logs',
      status: logSummaryStatus,
      error: logSummaryError !== '—' ? logSummaryError : null,
      scope: logScopeEntries.length ? logScopeDetails.display : '',
      streamHealth: logStreamHealth,
    });

    const logSummaryRow: DiagnosticsRow = {
      rowKey: 'object-logs-summary',
      domain: 'object-logs' as RefreshDomain,
      label: 'Object Logs',
      status: logSummaryStatus,
      version: logSummaryVersion,
      interval: '—',
      lastUpdated: logSummaryLastUpdatedInfo.display,
      lastUpdatedTooltip: logSummaryLastUpdatedInfo.tooltip,
      duration: '—',
      dropped: logSummaryDropped,
      stale: false,
      error: logSummaryError,
      telemetryStatus: logSummaryStatus,
      telemetryTooltip: logSummaryError !== '—' ? logSummaryError : undefined,
      metricsStatus: '—',
      metricsTooltip: 'Streaming domain',
      metricsStale: false,
      metricsSuccess: undefined,
      metricsFailure: undefined,
      telemetrySuccess: undefined,
      telemetryFailure: undefined,
      hasMetrics: false,
      count: logSummaryCount,
      countDisplay: String(logSummaryCount),
      countTooltip: undefined,
      countClassName: undefined,
      warnings: [],
      truncated: false,
      totalItems: undefined,
      namespace: '-',
      scope: logScopeDetails.display,
      scopeTooltip: logScopeDetails.tooltip,
      scopeEntries: logScopeDetails.entries,
      mode: logModeDetails.label,
      modeTooltip: logModeDetails.tooltip,
      healthStatus: logHealthDetails.label,
      healthTooltip: logHealthDetails.tooltip,
      pollingStatus: logPollingDetails.label,
      pollingTooltip: logPollingDetails.tooltip,
    };

    const logRows = logScopeEntries.map<DiagnosticsRow>(([scope, state]) => {
      const payload = state.data as ObjectLogsSnapshotPayload | null;
      const lastUpdated = state.lastUpdated ?? state.lastAutoRefresh ?? state.lastManualRefresh;
      const lastUpdatedInfo = formatLastUpdated(lastUpdated);
      const parts = scope.split(':');
      const namespace = parts[0] ?? '';
      const kind = parts[1] ?? '';
      const name = parts.slice(2).join(':');
      const namespaceLabel = namespace && namespace !== CLUSTER_SCOPE ? namespace : '-';
      const label = kind && name ? `${kind}/${name}` : name || scope;
      const resetCount = payload?.resetCount ?? 0;
      const count = payload?.entries?.length ?? 0;
      const stats = state.stats;
      const truncated = Boolean(stats?.truncated);
      const totalItems = stats?.totalItems ?? (truncated ? count : undefined);
      let warnings = (stats?.warnings ?? []).filter((warning) => warning && warning.trim().length);
      if (truncated && totalItems !== undefined && warnings.length === 0 && count !== totalItems) {
        warnings = [`Showing most recent ${count} of ${totalItems} entries`];
      }
      const countDisplay =
        truncated && totalItems !== undefined ? `${count} / ${totalItems}` : String(count);
      const countTooltip = warnings.length > 0 ? warnings.join('\n') : undefined;
      const countClassName = warnings.length > 0 ? 'diagnostics-count-warning' : undefined;
      const scopeDetails = resolveScopeDetails(scope, selectedClusterId, getClusterMeta);
      const healthDetails = resolveHealthDetails({
        domain: 'object-logs',
        status: state.status,
        error: state.error,
        scope,
        streamHealth: logStreamHealth,
      });

      return {
        rowKey: `object-logs:${scope}`,
        domain: 'object-logs' as RefreshDomain,
        label,
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
        count,
        countDisplay,
        countTooltip,
        countClassName,
        warnings,
        truncated,
        totalItems,
        namespace: namespaceLabel,
        scope: scopeDetails.display,
        scopeTooltip: scopeDetails.tooltip,
        scopeEntries: scopeDetails.entries,
        mode: logModeDetails.label,
        modeTooltip: logModeDetails.tooltip,
        healthStatus: healthDetails.label,
        healthTooltip: healthDetails.tooltip,
        pollingStatus: logPollingDetails.label,
        pollingTooltip: logPollingDetails.tooltip,
      };
    });

    const orderedLogRows = logRows.sort((a, b) => a.label.localeCompare(b.label));

    const clusterEventsRow: DiagnosticsRow = (() => {
      const state = clusterEventsDomain;
      const payload = state.data as ClusterEventsSnapshotPayload | null;
      const lastUpdated = state.lastUpdated ?? state.lastAutoRefresh ?? state.lastManualRefresh;
      const lastUpdatedInfo = formatLastUpdated(lastUpdated);
      const count = payload?.events?.length ?? 0;
      const stats = state.stats;
      const truncated = Boolean(stats?.truncated);
      const totalItems = stats?.totalItems ?? (truncated ? count : undefined);
      let warnings = (stats?.warnings ?? []).filter((warning) => warning && warning.trim().length);
      if (truncated && totalItems !== undefined && warnings.length === 0 && count !== totalItems) {
        warnings = [`Showing most recent ${count} of ${totalItems} events`];
      }
      const countDisplay =
        truncated && totalItems !== undefined ? `${count} / ${totalItems}` : String(count);
      const countTooltip = warnings.length > 0 ? warnings.join('\n') : undefined;
      const countClassName = warnings.length > 0 ? 'diagnostics-count-warning' : undefined;
      const status = state.status;
      const error = state.error ?? '—';
      const refresherName = DOMAIN_REFRESHER_MAP['cluster-events'];
      const intervalLabel = formatInterval(
        refresherName ? refreshManager.getRefresherInterval(refresherName) : null
      );
      const scopeDetails = resolveScopeDetails(state.scope, selectedClusterId, getClusterMeta);
      const streamTelemetry = telemetrySummary?.streams.find((entry) => entry.name === 'events');
      const streamHealth = resolveStreamTelemetryHealth(streamTelemetry);
      const streamActive = Boolean(streamTelemetry?.activeSessions);
      const streamHealthy = streamHealth?.status === 'healthy';
      const pollingDetails = resolvePollingDetails({
        domain: 'cluster-events',
        refresherName,
        streamActive,
        streamHealthy,
        metricsOnly: false,
      });
      const modeDetails = resolveModeDetails({
        domain: 'cluster-events',
        streamMode: STREAM_MODE_BY_NAME.events,
        streamActive,
        streamHealthy,
        pollingEnabled: pollingDetails.enabled,
        metricsOnly: false,
      });
      const healthDetails = resolveHealthDetails({
        domain: 'cluster-events',
        status,
        error: state.error,
        scope: state.scope,
        streamHealth,
      });

      return {
        rowKey: 'cluster-events',
        domain: 'cluster-events' as RefreshDomain,
        label: 'Cluster Events',
        status,
        version: payload ? String(payload.events?.length ?? 0) : '—',
        interval: intervalLabel,
        lastUpdated: lastUpdatedInfo.display,
        lastUpdatedTooltip: lastUpdatedInfo.tooltip,
        dropped: state.droppedAutoRefreshes,
        stale: false,
        error,
        telemetryStatus: status,
        telemetryTooltip: error !== '—' ? error : undefined,
        metricsStatus: 'Streaming',
        metricsTooltip: 'Streaming domain',
        metricsStale: false,
        metricsSuccess: undefined,
        metricsFailure: undefined,
        hasMetrics: false,
        count,
        countDisplay,
        countTooltip,
        countClassName,
        warnings,
        truncated,
        totalItems,
        namespace: '-',
        scope: scopeDetails.display,
        scopeTooltip: scopeDetails.tooltip,
        scopeEntries: scopeDetails.entries,
        mode: modeDetails.label,
        modeTooltip: modeDetails.tooltip,
        healthStatus: healthDetails.label,
        healthTooltip: healthDetails.tooltip,
        pollingStatus: pollingDetails.label,
        pollingTooltip: pollingDetails.tooltip,
      };
    })();

    const namespaceEventsRow: DiagnosticsRow = (() => {
      const state = namespaceEventsDomain;
      const payload = state.data as NamespaceEventsSnapshotPayload | null;
      const lastUpdated = state.lastUpdated ?? state.lastAutoRefresh ?? state.lastManualRefresh;
      const lastUpdatedInfo = formatLastUpdated(lastUpdated);
      const count = payload?.events?.length ?? 0;
      const stats = state.stats;
      const truncated = Boolean(stats?.truncated);
      const totalItems = stats?.totalItems ?? (truncated ? count : undefined);
      let warnings = (stats?.warnings ?? []).filter((warning) => warning && warning.trim().length);
      if (truncated && totalItems !== undefined && warnings.length === 0 && count !== totalItems) {
        warnings = [`Showing most recent ${count} of ${totalItems} events`];
      }
      const countDisplay =
        truncated && totalItems !== undefined ? `${count} / ${totalItems}` : String(count);
      const countTooltip = warnings.length > 0 ? warnings.join('\n') : undefined;
      const countClassName = warnings.length > 0 ? 'diagnostics-count-warning' : undefined;
      const status = state.status;
      const error = state.error ?? '—';
      const refresherName = DOMAIN_REFRESHER_MAP['namespace-events'];
      const intervalLabel = formatInterval(
        refresherName ? refreshManager.getRefresherInterval(refresherName) : null
      );
      const namespaceLabel = resolveDomainNamespace('namespace-events', state.scope);
      const scopeDetails = resolveScopeDetails(state.scope, selectedClusterId, getClusterMeta);
      const streamTelemetry = telemetrySummary?.streams.find((entry) => entry.name === 'events');
      const streamHealth = resolveStreamTelemetryHealth(streamTelemetry);
      const streamActive = Boolean(streamTelemetry?.activeSessions);
      const streamHealthy = streamHealth?.status === 'healthy';
      const pollingDetails = resolvePollingDetails({
        domain: 'namespace-events',
        refresherName,
        streamActive,
        streamHealthy,
        metricsOnly: false,
      });
      const modeDetails = resolveModeDetails({
        domain: 'namespace-events',
        streamMode: STREAM_MODE_BY_NAME.events,
        streamActive,
        streamHealthy,
        pollingEnabled: pollingDetails.enabled,
        metricsOnly: false,
      });
      const healthDetails = resolveHealthDetails({
        domain: 'namespace-events',
        status,
        error: state.error,
        scope: state.scope,
        streamHealth,
      });

      return {
        rowKey: `namespace-events:${state.scope ?? '-'}`,
        domain: 'namespace-events' as RefreshDomain,
        label: 'NS Events',
        status,
        version: payload ? String(payload.events?.length ?? 0) : '—',
        interval: intervalLabel,
        lastUpdated: lastUpdatedInfo.display,
        lastUpdatedTooltip: lastUpdatedInfo.tooltip,
        duration: '—',
        dropped: state.droppedAutoRefreshes,
        stale: false,
        error,
        metricsStatus: 'Streaming',
        metricsTooltip: 'Streaming domain',
        metricsStale: false,
        metricsSuccess: undefined,
        metricsFailure: undefined,
        telemetrySuccess: undefined,
        telemetryFailure: undefined,
        hasMetrics: false,
        count,
        countDisplay,
        countTooltip,
        countClassName,
        warnings,
        truncated,
        totalItems,
        namespace: namespaceLabel,
        scope: scopeDetails.display,
        scopeTooltip: scopeDetails.tooltip,
        scopeEntries: scopeDetails.entries,
        mode: modeDetails.label,
        modeTooltip: modeDetails.tooltip,
        healthStatus: healthDetails.label,
        healthTooltip: healthDetails.tooltip,
        pollingStatus: pollingDetails.label,
        pollingTooltip: pollingDetails.tooltip,
      };
    })();

    const priorityRows = baseRows.filter((row) => prioritySet.has(row.domain));
    const remainingRows = baseRows.filter(
      (row) =>
        !prioritySet.has(row.domain) &&
        row.domain !== 'pods' &&
        row.domain !== 'object-logs' &&
        row.domain !== 'cluster-events' &&
        row.domain !== 'namespace-events'
    );

    // Ensure priority order matches requested sequence
    const sortedPriorityRows = PRIORITY_DOMAINS.map((domain) =>
      priorityRows.find((row) => row.domain === domain)
    ).filter(Boolean) as typeof priorityRows;

    // Sort all rows alphabetically by the Domain label.
    return [
      ...sortedPriorityRows,
      podSummaryRow,
      ...orderedPodRows,
      logSummaryRow,
      ...orderedLogRows,
      clusterEventsRow,
      namespaceEventsRow,
      ...remainingRows,
    ].sort((a, b) => a.label.localeCompare(b.label));
  }, [
    domainStates,
    podScopeEntries,
    logScopeEntries,
    clusterEventsDomain,
    namespaceEventsDomain,
    telemetrySummary,
    resourceStreamStats,
    selectedClusterId,
    getClusterMeta,
  ]);

  // Build stream telemetry rows for the dedicated diagnostics section.
  const streamRows = useMemo<DiagnosticsStreamRow[]>(() => {
    if (!telemetrySummary?.streams?.length) {
      return [];
    }
    return telemetrySummary.streams
      .map((stream) => {
        const label = STREAM_LABELS[stream.name] ?? stream.name;
        const lastConnectInfo = formatLastUpdated(
          stream.lastConnect > 0 ? stream.lastConnect : undefined
        );
        const lastEventInfo = formatLastUpdated(
          stream.lastEvent > 0 ? stream.lastEvent : undefined
        );
        const isResourceStream = stream.name === 'resources';
        const lastResyncInfo = resourceStreamStats.lastResyncAt
          ? formatLastUpdated(resourceStreamStats.lastResyncAt)
          : null;
        const lastFallbackInfo = resourceStreamStats.lastFallbackAt
          ? formatLastUpdated(resourceStreamStats.lastFallbackAt)
          : null;
        const resyncsTooltip = (() => {
          if (!isResourceStream) {
            return undefined;
          }
          if (resourceStreamStats.lastResyncReason && lastResyncInfo?.tooltip) {
            return `${resourceStreamStats.lastResyncReason} (${lastResyncInfo.tooltip})`;
          }
          if (resourceStreamStats.lastResyncReason) {
            return resourceStreamStats.lastResyncReason;
          }
          if (lastResyncInfo?.tooltip) {
            return `Last resync ${lastResyncInfo.tooltip}`;
          }
          return undefined;
        })();
        const fallbacksTooltip = (() => {
          if (!isResourceStream) {
            return undefined;
          }
          if (resourceStreamStats.lastFallbackReason && lastFallbackInfo?.tooltip) {
            return `${resourceStreamStats.lastFallbackReason} (${lastFallbackInfo.tooltip})`;
          }
          if (resourceStreamStats.lastFallbackReason) {
            return resourceStreamStats.lastFallbackReason;
          }
          if (lastFallbackInfo?.tooltip) {
            return `Last fallback ${lastFallbackInfo.tooltip}`;
          }
          return undefined;
        })();
        return {
          rowKey: stream.name,
          label,
          sessions: stream.activeSessions,
          delivered: stream.totalMessages,
          dropped: stream.droppedMessages,
          errors: stream.errorCount,
          resyncs: isResourceStream ? resourceStreamStats.resyncCount : null,
          resyncsTooltip,
          fallbacks: isResourceStream ? resourceStreamStats.fallbackCount : null,
          fallbacksTooltip,
          lastConnect: lastConnectInfo.display,
          lastConnectTooltip: lastConnectInfo.tooltip,
          lastEvent: lastEventInfo.display,
          lastEventTooltip: lastEventInfo.tooltip,
          lastError: stream.lastError?.trim() || '—',
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [resourceStreamStats, telemetrySummary]);

  // Streams tab shows all telemetry rows without filtering controls.
  const streamSummary = useMemo(() => {
    if (streamRows.length === 0) {
      return 'No stream telemetry available';
    }
    const sessionTotal = streamRows.reduce((acc, row) => acc + row.sessions, 0);
    return `Sessions: ${sessionTotal} • Streams: ${streamRows.length}`;
  }, [streamRows]);

  const filteredRows = useMemo(() => rows.filter((row) => row.status !== 'idle'), [rows]);
  const { capabilityBatchRows, capabilityDescriptorIndex } = useMemo(() => {
    const descriptorIndex = new Map<string, CapabilityDescriptorActivityDetails>();

    const batchRows = capabilityDiagnostics
      .map((entry) => {
        const include =
          entry.inFlightCount > 0 ||
          entry.pendingCount > 0 ||
          entry.lastRunCompletedAt != null ||
          entry.lastDescriptors.length > 0;
        if (!include) {
          return null;
        }

        const namespace = entry.namespace ?? 'Cluster';
        const runtimeMs =
          entry.inFlightCount > 0 && entry.inFlightStartedAt
            ? Math.max(0, diagnosticsClock - entry.inFlightStartedAt)
            : null;
        const lastCompleted = formatLastUpdated(entry.lastRunCompletedAt);
        const lastDurationDisplay = formatDurationMs(entry.lastRunDurationMs);
        const runtimeDisplay = formatDurationMs(runtimeMs);
        const lastResultLabel =
          entry.lastResult === 'success' ? 'Success' : entry.lastResult === 'error' ? 'Error' : '—';
        const descriptorCount = entry.lastDescriptors.length;
        const totalChecks =
          entry.totalChecks && entry.totalChecks > 0 ? entry.totalChecks : descriptorCount;
        const descriptorSummary =
          entry.lastDescriptors.length > 0
            ? entry.lastDescriptors
                .map(
                  (descriptor) =>
                    `${descriptor.resourceKind}/${descriptor.verb}${
                      descriptor.subresource ? ` (${descriptor.subresource})` : ''
                    }`
                )
                .join(', ')
            : null;

        const featureSet = new Set<string>();
        entry.lastDescriptors.forEach((descriptor) => {
          const key = getPermissionKey(
            descriptor.resourceKind,
            descriptor.verb,
            descriptor.namespace ?? null,
            descriptor.subresource ?? null
          );
          const status = permissionMap.get(key);
          if (status?.feature) {
            featureSet.add(status.feature);
          }
          const descriptorLabel = descriptor.subresource
            ? `${descriptor.resourceKind}/${descriptor.subresource} (${descriptor.verb})`
            : `${descriptor.resourceKind} (${descriptor.verb})`;
          descriptorIndex.set(key, {
            namespace,
            descriptorLabel,
            resourceKind: descriptor.resourceKind,
            verb: descriptor.verb,
            subresource: descriptor.subresource ?? null,
            pendingCount: entry.pendingCount,
            inFlightCount: entry.inFlightCount,
            runtimeDisplay,
            lastDurationDisplay,
            lastCompleted,
            lastResult: lastResultLabel,
            consecutiveFailureCount: entry.consecutiveFailureCount,
            totalChecks,
            lastError: entry.lastError ?? null,
          });
        });
        const featureSummary = featureSet.size > 0 ? Array.from(featureSet).join(', ') : null;

        return {
          key: entry.key,
          namespace,
          pendingCount: entry.pendingCount,
          inFlightCount: entry.inFlightCount,
          runtimeDisplay,
          runtimeMs,
          lastDurationDisplay,
          lastCompleted,
          lastResult: lastResultLabel,
          lastError: entry.lastError ?? null,
          totalChecks,
          consecutiveFailureCount: entry.consecutiveFailureCount,
          descriptorSummary,
          featureSummary,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => {
        if (a.namespace === 'Cluster' && b.namespace !== 'Cluster') {
          return -1;
        }
        if (b.namespace === 'Cluster' && a.namespace !== 'Cluster') {
          return 1;
        }
        return a.namespace.localeCompare(b.namespace);
      });

    return { capabilityBatchRows: batchRows, capabilityDescriptorIndex: descriptorIndex };
  }, [capabilityDiagnostics, diagnosticsClock, permissionMap]);

  const permissionRows = useMemo(() => {
    const scopedFeatures = showAllPermissions
      ? null
      : new Set(getScopedFeaturesForView(viewType, activeClusterTab ?? null, activeNamespaceTab));
    const hasFeatureFilters = scopedFeatures != null && scopedFeatures.size > 0;
    const selectedNamespaceKey = selectedNamespace?.toLowerCase() ?? null;

    const allPermissionRows = Array.from(permissionMap.values()).map((status) => {
      const scope = status.descriptor.namespace ? status.descriptor.namespace : 'Cluster';
      const allowedLabel = status.pending ? 'Pending' : status.allowed ? 'Allowed' : 'Denied';
      const reason = status.reason ?? status.error ?? undefined;
      const descriptorKey = getPermissionKey(
        status.descriptor.resourceKind,
        status.descriptor.verb,
        status.descriptor.namespace ?? null,
        status.descriptor.subresource ?? null
      );
      const activity = capabilityDescriptorIndex.get(descriptorKey);
      const descriptorLabel =
        activity?.descriptorLabel ??
        (status.descriptor.subresource
          ? `${status.descriptor.resourceKind}/${status.descriptor.subresource} (${status.descriptor.verb})`
          : `${status.descriptor.resourceKind} (${status.descriptor.verb})`);
      const namespaceLabel =
        activity?.namespace ??
        status.descriptor.namespace ??
        (scope === 'Cluster' ? 'Cluster' : scope);
      const lastCompleted = activity?.lastCompleted ?? { display: '—', tooltip: '—' };

      return {
        scope,
        namespace: namespaceLabel,
        descriptorLabel,
        resource: status.descriptor.resourceKind,
        verb: status.descriptor.verb,
        allowed: allowedLabel,
        isDenied: !status.pending && !status.allowed,
        reason,
        id: status.id,
        feature: status.feature,
        descriptorNamespace: status.descriptor.namespace ?? null,
        pendingCount: activity?.pendingCount ?? null,
        inFlightCount: activity?.inFlightCount ?? null,
        runtimeDisplay: activity?.runtimeDisplay ?? '—',
        lastDurationDisplay: activity?.lastDurationDisplay ?? '—',
        lastCompleted,
        lastResult: activity?.lastResult ?? '—',
        consecutiveFailureCount: activity?.consecutiveFailureCount ?? 0,
        totalChecks: activity?.totalChecks ?? null,
        lastError: activity?.lastError ?? null,
        descriptorKey,
      };
    });

    const scopedRows = allPermissionRows.filter((row) => {
      if (showAllPermissions) {
        return true;
      }

      const matchesFeature =
        !hasFeatureFilters || (row.feature && scopedFeatures?.has(row.feature));

      if (!matchesFeature) {
        // If there are no feature filters (empty set), allow rows with undefined features.
        if (hasFeatureFilters) {
          return false;
        }
      }

      if (viewType === 'cluster' || viewType === 'overview') {
        if (row.scope === 'Cluster') {
          return true;
        }
        return row.descriptorNamespace && row.feature != null && scopedFeatures?.has(row.feature);
      }

      if (viewType === 'namespace') {
        if (!row.descriptorNamespace) {
          return false;
        }
        if (!selectedNamespaceKey) {
          return true;
        }
        return row.descriptorNamespace.toLowerCase() === selectedNamespaceKey;
      }

      return false;
    });

    return scopedRows.sort((a, b) => {
      const namespaceA = a.namespace ?? a.scope;
      const namespaceB = b.namespace ?? b.scope;

      if (namespaceA === namespaceB) {
        if (a.descriptorLabel === b.descriptorLabel) {
          return a.verb.localeCompare(b.verb);
        }
        return a.descriptorLabel.localeCompare(b.descriptorLabel);
      }

      if (namespaceA === 'Cluster') {
        return -1;
      }

      if (namespaceB === 'Cluster') {
        return 1;
      }

      return namespaceA.localeCompare(namespaceB);
    });
  }, [
    permissionMap,
    capabilityDescriptorIndex,
    showAllPermissions,
    viewType,
    activeClusterTab,
    activeNamespaceTab,
    selectedNamespace,
  ]);

  const telemetryMetrics = telemetrySummary?.metrics;
  const eventStreamTelemetry = telemetrySummary?.streams.find((entry) => entry.name === 'events');
  const catalogStreamTelemetry = telemetrySummary?.streams.find(
    (entry) => entry.name === 'catalog'
  );
  const logStreamTelemetry = telemetrySummary?.streams.find(
    (entry) => entry.name === 'object-logs'
  );
  const metricsSummary = useMemo(() => {
    const updatedInfo = formatLastUpdated(telemetryMetrics?.lastCollected);
    // Demand-driven metrics polling reports inactive when no metrics views are open.
    const isIdle = telemetryMetrics?.active === false;
    let statusText = 'Loading…';
    let className: string | undefined;
    let title: string | undefined;
    let pollsText = '—';

    if (telemetryError && !telemetrySummary) {
      statusText = 'Unavailable';
      className = 'diagnostics-summary-warning';
      title = telemetryError ?? undefined;
    } else if (!telemetryMetrics) {
      statusText = telemetrySummary ? 'No data' : 'Loading…';
    } else {
      pollsText = String(telemetryMetrics.successCount);
      if (telemetryMetrics.lastError) {
        statusText = 'Error';
        className = 'diagnostics-summary-error';
        title = telemetryMetrics.lastError;
      } else if (telemetryMetrics.consecutiveFailures > 0) {
        statusText = 'Retrying';
        className = 'diagnostics-summary-warning';
      } else if (isIdle) {
        statusText = 'Idle';
      } else {
        statusText = 'OK';
      }
    }

    const tooltipParts: string[] = [];
    if (isIdle) {
      tooltipParts.push('Polling idle (no active metrics views)');
    }
    if (telemetryMetrics?.failureCount) {
      tooltipParts.push(`Failures: ${telemetryMetrics.failureCount}`);
    }
    if (updatedInfo.tooltip) {
      tooltipParts.push(`Updated ${updatedInfo.tooltip}`);
    }
    if (!title && telemetryMetrics?.lastError) {
      title = telemetryMetrics.lastError;
    }

    return {
      primary: `Status: ${statusText} • Polls: ${pollsText}`,
      secondary: `Updated: ${updatedInfo.display}`,
      className,
      title: title ?? (tooltipParts.length > 0 ? tooltipParts.join(' | ') : undefined),
    };
  }, [telemetryMetrics, telemetrySummary, telemetryError]);

  const eventSummary = useMemo(() => {
    if (eventStreamTelemetry) {
      const updatedInfo = formatLastUpdated(eventStreamTelemetry.lastConnect);
      const newestInfo = formatLastUpdated(eventStreamTelemetry.lastEvent);
      const className =
        eventStreamTelemetry.errorCount > 0
          ? 'diagnostics-summary-error'
          : eventStreamTelemetry.droppedMessages > 0
            ? 'diagnostics-summary-warning'
            : undefined;
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
      return {
        primary: `Active: ${eventStreamTelemetry.activeSessions} • Delivered: ${eventStreamTelemetry.totalMessages} • Dropped: ${eventStreamTelemetry.droppedMessages}`,
        secondary: `Updated: ${updatedInfo.display} • Newest Event: ${newestInfo.display}`,
        className,
        title: tooltipParts.length > 0 ? tooltipParts.join(' | ') : undefined,
      };
    }

    if (telemetryError && !telemetrySummary) {
      return {
        primary: 'Active: — • Delivered: — • Dropped: —',
        secondary: 'Updated: — • Newest Event: —',
        className: 'diagnostics-summary-warning',
        title: telemetryError ?? undefined,
      };
    }

    return {
      primary: 'Active: — • Delivered: — • Dropped: —',
      secondary: 'Updated: — • Newest Event: —',
      className: undefined,
      title: undefined,
    };
  }, [eventStreamTelemetry, telemetryError, telemetrySummary]);

  const catalogSummary = useMemo(() => {
    const catalogSnapshot = catalogDomain.data as CatalogSnapshotPayload | null;
    const firstRowLatencyMs =
      catalogDomain.stats?.timeToFirstRowMs ?? catalogSnapshot?.firstBatchLatencyMs ?? null;
    const firstRowDisplay = formatDurationMs(firstRowLatencyMs);

    if (catalogStreamTelemetry) {
      const updatedInfo = formatLastUpdated(catalogStreamTelemetry.lastConnect);
      const newestInfo = formatLastUpdated(catalogStreamTelemetry.lastEvent);
      const className =
        catalogStreamTelemetry.errorCount > 0
          ? 'diagnostics-summary-error'
          : catalogStreamTelemetry.droppedMessages > 0
            ? 'diagnostics-summary-warning'
            : undefined;
      const tooltipParts: string[] = [];
      if (catalogStreamTelemetry.lastError) {
        tooltipParts.push(catalogStreamTelemetry.lastError);
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
      return {
        primary: `Active: ${catalogStreamTelemetry.activeSessions} • Batches: ${catalogStreamTelemetry.totalMessages} • Dropped: ${catalogStreamTelemetry.droppedMessages}`,
        secondary: `Updated: ${updatedInfo.display} • Latest Batch: ${newestInfo.display} • First Row: ${firstRowDisplay}`,
        className,
        title: tooltipParts.length > 0 ? tooltipParts.join(' | ') : undefined,
      };
    }

    if (telemetryError && !telemetrySummary) {
      return {
        primary: 'Active: — • Batches: — • Dropped: —',
        secondary: 'Updated: — • Latest Batch: — • First Row: —',
        className: 'diagnostics-summary-warning',
        title: telemetryError ?? undefined,
      };
    }

    return {
      primary: 'Active: — • Batches: — • Dropped: —',
      secondary: 'Updated: — • Latest Batch: — • First Row: —',
      className: undefined,
      title: undefined,
    };
  }, [catalogDomain, catalogStreamTelemetry, telemetryError, telemetrySummary]);

  const logSummary = useMemo(() => {
    const totalScopes = logScopeEntries.length;
    const activeScopes = logScopeEntries.filter(([, state]) =>
      ['ready', 'loading', 'updating'].includes(state.status)
    ).length;
    const errorScopes = logScopeEntries.filter(([, state]) => state.status === 'error').length;
    const latestUpdate = logScopeEntries.reduce((latest, [, state]) => {
      const timestamp = state.lastUpdated ?? state.lastAutoRefresh ?? state.lastManualRefresh ?? 0;
      return Math.max(latest, timestamp);
    }, 0);
    const lastUpdatedInfo = formatLastUpdated(latestUpdate > 0 ? latestUpdate : undefined);

    const delivered = logStreamTelemetry?.totalMessages ?? 0;
    const dropped = logStreamTelemetry?.droppedMessages ?? 0;
    const activeSessions = logStreamTelemetry?.activeSessions ?? 0;
    const lastConnectInfo = formatLastUpdated(
      logStreamTelemetry?.lastConnect && logStreamTelemetry.lastConnect > 0
        ? logStreamTelemetry.lastConnect
        : undefined
    );
    const lastEventInfo = formatLastUpdated(
      logStreamTelemetry?.lastEvent && logStreamTelemetry.lastEvent > 0
        ? logStreamTelemetry.lastEvent
        : undefined
    );

    const summaryParts: string[] = [`Scopes: ${totalScopes}`, `Active Scopes: ${activeScopes}`];
    if (logStreamTelemetry) {
      summaryParts.push(`Sessions: ${activeSessions}`);
      summaryParts.push(`Delivered: ${delivered}`);
      summaryParts.push(`Dropped: ${dropped}`);
    }

    const secondaryParts: string[] = [`Updated: ${lastUpdatedInfo.display}`];
    if (logStreamTelemetry) {
      secondaryParts.push(`Last Connect: ${lastConnectInfo.display}`);
      secondaryParts.push(`Last Stream: ${lastEventInfo.display}`);
    }

    let className = errorScopes > 0 ? 'diagnostics-summary-error' : undefined;
    const titleParts: string[] = [];
    if (errorScopes > 0) {
      titleParts.push(`${errorScopes} scope${errorScopes === 1 ? '' : 's'} reporting errors`);
    }
    if (lastUpdatedInfo.tooltip) {
      titleParts.push(`Updated ${lastUpdatedInfo.tooltip}`);
    }
    if (logStreamTelemetry?.lastError) {
      titleParts.push(logStreamTelemetry.lastError);
    }
    if (lastConnectInfo.tooltip) {
      titleParts.push(`Connected ${lastConnectInfo.tooltip}`);
    }
    if (className !== 'diagnostics-summary-error' && dropped > 0) {
      className = 'diagnostics-summary-warning';
    }

    return {
      primary: summaryParts.join(' • '),
      secondary: secondaryParts.join(' • '),
      className,
      title: titleParts.length > 0 ? titleParts.join(' | ') : undefined,
    };
  }, [logScopeEntries, logStreamTelemetry]);

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
    view: 'global',
    priority: isOpen ? 35 : 0,
  });

  // Refresh Domains tab content.
  const refreshDomainsContent = (
    <>
      <DiagnosticsSummaryCards
        orchestratorPendingRequests={refreshState.pendingRequests}
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

  // Split capability batch rows into current (Cluster + selected namespace + in-flight)
  // and previous (everything else).
  const { currentCapabilityRows, previousCapabilityRows } = useMemo(() => {
    const current: typeof capabilityBatchRows = [];
    const previous: typeof capabilityBatchRows = [];
    const activeNamespaceKey = selectedNamespace?.toLowerCase() ?? null;

    for (const row of capabilityBatchRows) {
      const isCurrent =
        row.namespace === 'Cluster' ||
        row.pendingCount > 0 ||
        row.inFlightCount > 0 ||
        (activeNamespaceKey != null && row.namespace.toLowerCase() === activeNamespaceKey);
      if (isCurrent) {
        current.push(row);
      } else {
        previous.push(row);
      }
    }
    return { currentCapabilityRows: current, previousCapabilityRows: previous };
  }, [capabilityBatchRows, selectedNamespace]);

  // Capabilities Checks tab content.
  const capabilityChecksContent = (
    <CapabilityChecksTable
      currentRows={currentCapabilityRows}
      previousRows={previousCapabilityRows}
      summary={`${capabilityBatchRows.length} namespace${
        capabilityBatchRows.length === 1 ? '' : 's'
      }`}
    />
  );

  // Effective Permissions tab content.
  const effectivePermissionsContent = (
    <EffectivePermissionsTable
      rows={permissionRows}
      showAllPermissions={showAllPermissions}
      onToggleShowAll={() => setShowAllPermissions((prev) => !prev)}
    />
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

  useKeyboardNavigationScope({
    ref: panelRef,
    priority: KeyboardScopePriority.DIAGNOSTICS_PANEL,
    disabled: !isOpen,
    allowNativeSelector: '.diagnostics-content *',
    onNavigate: ({ direction }) => {
      const items = focusables();
      if (items.length === 0) {
        return 'bubble';
      }
      const current = findActiveIndex();
      if (current === -1) {
        return direction === 'forward'
          ? focusFirst()
            ? 'handled'
            : 'bubble'
          : focusLast()
            ? 'handled'
            : 'bubble';
      }
      const next = direction === 'forward' ? current + 1 : current - 1;
      if (next < 0 || next >= items.length) {
        return 'bubble';
      }
      focusAt(next);
      return 'handled';
    },
    onEnter: ({ direction }) => {
      if (direction === 'forward') {
        focusFirst();
      } else {
        focusLast();
      }
    },
  });

  return (
    <DockablePanel
      panelRef={panelRef}
      panelId="diagnostics"
      title="Diagnostics"
      isOpen={isOpen}
      defaultPosition="bottom"
      defaultSize={{ width: 840, height: 320 }}
      allowMaximize
      maximizeTargetSelector=".content-body"
      onClose={onClose}
      headerContent={
        <div className="diagnostics-header-content">
          <div className="diagnostics-header-info">
            <span className="diagnostics-title">Diagnostics</span>
          </div>
        </div>
      }
      contentClassName="diagnostics-content"
      className="diagnostics-panel"
    >
      <div className="tabs diagnostics-tabs">
        <button
          className={`tab ${activeTab === 'refresh-domains' ? 'active' : ''}`}
          onClick={() => setActiveTab('refresh-domains')}
          data-diagnostics-focusable="true"
          tabIndex={-1}
        >
          REFRESH DOMAINS
        </button>
        <button
          className={`tab ${activeTab === 'streams' ? 'active' : ''}`}
          onClick={() => setActiveTab('streams')}
          data-diagnostics-focusable="true"
          tabIndex={-1}
        >
          STREAMS
        </button>
        <button
          className={`tab ${activeTab === 'capability-checks' ? 'active' : ''}`}
          onClick={() => setActiveTab('capability-checks')}
          data-diagnostics-focusable="true"
          tabIndex={-1}
        >
          CAPABILITIES CHECKS
        </button>
        <button
          className={`tab ${activeTab === 'effective-permissions' ? 'active' : ''}`}
          onClick={() => setActiveTab('effective-permissions')}
          data-diagnostics-focusable="true"
          tabIndex={-1}
        >
          EFFECTIVE PERMISSIONS
        </button>
      </div>
      <div className="diagnostics-scroll-area">
        {activeTab === 'refresh-domains'
          ? refreshDomainsContent
          : activeTab === 'streams'
            ? streamsContent
            : activeTab === 'capability-checks'
              ? capabilityChecksContent
              : effectivePermissionsContent}
      </div>
    </DockablePanel>
  );
};
