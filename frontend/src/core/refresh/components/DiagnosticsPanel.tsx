/**
 * frontend/src/core/refresh/components/RefreshDiagnosticsPanel.tsx
 *
 * Renders the refresh diagnostics panel. It combines refresh-domain state,
 * stream health, permission diagnostics, broker reads, and table diagnostics
 * into the developer-facing runtime inspection surface.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from 'react';
import './DiagnosticsPanel.css';
import { DockablePanel } from '@ui/dockable';
import { useRefreshState, useRefreshScopedDomainEntries, type DomainSnapshotState } from '../store';
import type {
  RefreshDomain,
  NodeMetricsInfo,
  PodSnapshotPayload,
  ContainerLogsSnapshotPayload,
  TelemetrySummary,
  TelemetryStreamStatus,
} from '../types';
import { refreshManager } from '../RefreshManager';
import { resourceStreamManager } from '../streaming/resourceStreamManager';
import { useShortcut, useKeyboardSurface } from '@ui/shortcuts';
import { KeyboardScopePriority } from '@ui/shortcuts/priorities';
import {
  fetchKubernetesAPIClientDiagnostics,
  fetchSelectionDiagnostics,
  fetchTelemetrySummary,
  type KubernetesAPIClientDiagnostics,
  type SelectionDiagnostics,
} from '../client';
import { stripClusterScope, parseClusterScopeList } from '@/core/refresh/clusterScope';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import { useCapabilityDiagnostics, useUserPermissions } from '@/core/capabilities';
import { useBrokerReadDiagnostics } from '@/core/read-diagnostics';
import { Tabs, type TabDescriptor } from '@shared/components/tabs';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { useNamespace } from '@/modules/namespace/contexts/NamespaceContext';

// Import from extracted modules
import {
  type DiagnosticsRow,
  type DiagnosticsPanelProps,
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
  dedupeDiagnosticsRows,
  formatInterval,
  formatLastUpdated,
  STALE_THRESHOLD_MS,
  CLUSTER_SCOPE,
  DOMAIN_REFRESHER_MAP,
  DOMAIN_STREAM_MAP,
  METRICS_ONLY_DOMAINS,
  PAUSE_POLLING_WHEN_STREAMING_DOMAINS,
  PRIORITY_DOMAINS,
  STREAM_MODE_BY_NAME,
  STREAM_ONLY_DOMAINS,
  getScopedFeaturesForView,
  resolveDomainNamespace,
} from './diagnostics';
import { DiagnosticsTable, DiagnosticsSummaryCards } from './diagnostics/TableRefreshDomains';
import { DiagnosticsStreamsTable } from './diagnostics/TableStreams';
import { KubernetesAPIClientsTable } from './diagnostics/TableKubernetesAPIClients';
import { BrokerReadsTable } from './diagnostics/TableBrokerReads';
import { CapabilityChecksTable } from './diagnostics/TableCapabilitesChecks';
import { EffectivePermissionsTable } from './diagnostics/TableEffectivePermissions';
import { GridTablePerformance } from './diagnostics/GridTablePerformance';
import {
  resetGridTablePerformanceDiagnostics,
  useGridTablePerformanceDiagnostics,
} from '@shared/components/tables/performance/gridTablePerformanceStore';

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
      if (a.label === 'Active' && b.label !== 'Active') return -1;
      if (b.label === 'Active' && a.label !== 'Active') return 1;
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

const resolveScopeRole = (
  domain: RefreshDomain,
  scope: string | undefined
): { label: string; tooltip?: string } => {
  const trimmed = (scope ?? '').trim();
  const { scope: scopeTail } = parseClusterScopeList(trimmed);
  const normalizedTail = scopeTail.trim().toLowerCase();
  const hasQueryScope =
    scopeTail.includes('?') || scopeTail.includes('=') || scopeTail.includes('&');

  if (domain === 'catalog') {
    const params = parseScopeQueryParams(scopeTail);
    if (params.get('limit') === '1') {
      return {
        label: 'Metadata',
        tooltip: 'Catalog metadata/facet support query for the current Browse view',
      };
    }
    return {
      label: 'Page Query',
      tooltip: 'Current Browse table page query',
    };
  }

  if (domain === 'catalog-diff') {
    return { label: 'Object Diff', tooltip: 'Object diff modal catalog query' };
  }

  if (domain === 'container-logs') {
    return { label: 'Log Stream', tooltip: 'Object panel log stream scope' };
  }

  if (
    domain === 'object-details' ||
    domain === 'object-events' ||
    domain === 'object-yaml' ||
    domain === 'object-helm-manifest' ||
    domain === 'object-helm-values' ||
    domain === 'pods'
  ) {
    return { label: 'Object Panel', tooltip: 'Scoped object panel data' };
  }

  if (domain === 'object-maintenance') {
    return { label: 'Operation', tooltip: 'Node maintenance operation state' };
  }

  if (DOMAIN_STREAM_MAP[domain] === 'resources') {
    if (hasQueryScope) {
      return {
        label: 'Table Query',
        tooltip: 'Query-backed GridTable snapshot for filters, sorting, or pagination',
      };
    }
    if (!normalizedTail || normalizedTail === 'cluster') {
      return {
        label: 'Live Scope',
        tooltip: 'Base resource-stream scope retained for live data and metrics',
      };
    }
    return {
      label: 'Live Scope',
      tooltip: 'Resource-stream scope retained for live data and metrics',
    };
  }

  if (domain === 'namespaces' || domain === 'cluster-overview') {
    return { label: 'System', tooltip: 'System refresh scope' };
  }

  return { label: 'Snapshot', tooltip: 'Snapshot refresh scope' };
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

  // Pick the scoped domain state that best matches the active cluster context.
  // Diagnostics renders one summary row per domain, so prefer entries scoped to the
  // active cluster before falling back to generic "first populated" selection.
  const pickPreferredScopeState = useCallback(
    (
      entries: Array<[string, DomainSnapshotState<any>]>,
      preferredClusterId: string | undefined
    ): DomainSnapshotState<any> => {
      if (entries.length === 0) {
        return { status: 'idle', data: null, stats: null, error: null, droppedAutoRefreshes: 0 };
      }

      let candidates = entries;
      const clusterId = (preferredClusterId ?? '').trim();
      if (clusterId) {
        const clusterMatches = entries.filter(([scopeKey, state]) => {
          const parsed = parseClusterScopeList(state.scope ?? scopeKey);
          return parsed.clusterIds.includes(clusterId);
        });
        if (clusterMatches.length > 0) {
          candidates = clusterMatches;
        } else {
          const hasClusterScopedEntries = entries.some(([scopeKey, state]) => {
            const parsed = parseClusterScopeList(state.scope ?? scopeKey);
            return parsed.clusterIds.length > 0;
          });
          if (hasClusterScopedEntries) {
            // Keep diagnostics cluster-aware: never fall back to a different
            // cluster's scoped entry when the active cluster has no match.
            return {
              status: 'idle',
              data: null,
              stats: null,
              error: null,
              droppedAutoRefreshes: 0,
            };
          }
        }
      }

      // Prefer entries with data, then non-idle entries, then the first candidate.
      const selected =
        candidates.find(([, s]) => s.data !== null) ??
        candidates.find(([, s]) => s.status !== 'idle') ??
        candidates[0];

      const [scopeKey, scopedState] = selected;
      if (scopedState.scope && scopedState.scope.trim()) {
        return scopedState;
      }
      return { ...scopedState, scope: scopeKey };
    },
    []
  );
  const [telemetrySummary, setTelemetrySummary] = useState<TelemetrySummary | null>(null);
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

  useEffect(() => {
    if (!isOpen) {
      setTelemetrySummary(null);
      setTelemetryError(null);
      setSelectionDiagnostics(null);
      setSelectionDiagnosticsError(null);
      setKubernetesAPIDiagnostics([]);
      setKubernetesAPIDiagnosticsError(null);
      return;
    }

    let cancelled = false;

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
        setTelemetrySummary(telemetryResult.value);
        setTelemetryError(null);
      } else {
        const message =
          telemetryResult.reason instanceof Error
            ? telemetryResult.reason.message
            : 'Failed to load telemetry';
        setTelemetryError(message);
      }

      if (selectionResult.status === 'fulfilled') {
        setSelectionDiagnostics(selectionResult.value);
        setSelectionDiagnosticsError(null);
      } else {
        const message =
          selectionResult.reason instanceof Error
            ? selectionResult.reason.message
            : 'Failed to load selection diagnostics';
        setSelectionDiagnosticsError(message);
      }

      if (kubernetesAPIResult.status === 'fulfilled') {
        setKubernetesAPIDiagnostics(kubernetesAPIResult.value);
        setKubernetesAPIDiagnosticsError(null);
      } else {
        const message =
          kubernetesAPIResult.reason instanceof Error
            ? kubernetesAPIResult.reason.message
            : 'Failed to load Kubernetes API client diagnostics';
        setKubernetesAPIDiagnosticsError(message);
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

    const baseRows = domainScopedStates.map<DiagnosticsRow>(
      ({ domain, state, label, hasMetrics }) => {
        const effectiveScope = state.scope;
        const hasMetricsFlag = hasMetrics;
        const telemetryInfo = telemetrySummary?.snapshots.find((entry) => entry.domain === domain);
        const streamName = DOMAIN_STREAM_MAP[domain];
        const streamTelemetry = streamName
          ? telemetrySummary?.streams.find((entry) => entry.name === streamName)
          : undefined;
        const isResourceStreamDomain = streamName === 'resources';
        const streamMode = streamName ? (STREAM_MODE_BY_NAME[streamName] ?? 'streaming') : null;
        const scopeDetails = resolveScopeDetails(effectiveScope, selectedClusterId, getClusterMeta);
        const roleDetails = resolveScopeRole(domain, effectiveScope);
        const streamLastEvent = isResourceStreamDomain ? streamTelemetry?.lastEvent : 0;
        const baseLastUpdated =
          state.lastUpdated ?? state.lastAutoRefresh ?? state.lastManualRefresh;
        const lastUpdated = (() => {
          const combined = Math.max(baseLastUpdated ?? 0, streamLastEvent ?? 0);
          return combined > 0 ? combined : undefined;
        })();
        const isStale = lastUpdated ? Date.now() - lastUpdated > STALE_THRESHOLD_MS : false;
        const metricsInfo: NodeMetricsInfo | undefined = (() => {
          if (!hasMetricsFlag) {
            return undefined;
          }
          return (state.data as any)?.metrics;
        })();
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
          isResourceStreamDomain && effectiveScope
            ? toStreamHealthSummary(resourceStreamManager.getHealthSnapshot(domain, effectiveScope))
            : resolveStreamTelemetryHealth(streamTelemetry);
        const streamHealthStatus = streamHealth
          ? streamHealth.reason === 'inactive'
            ? 'Stream inactive'
            : `Stream ${streamHealth.status}`
          : null;
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
              if (!Array.isArray(data.namespaces)) {
                return 0;
              }
              return data.namespaces.length;
            case 'cluster-overview':
              return data.overview?.totalNodes ?? 0;
            case 'nodes':
              return Array.isArray(data.rows) ? data.rows.length : 0;
            case 'object-maintenance':
              return Array.isArray(data.drains) ? data.drains.length : 0;
            case 'cluster-rbac':
              return Array.isArray(data.rows) ? data.rows.length : 0;
            case 'cluster-storage':
              return Array.isArray(data.rows) ? data.rows.length : 0;
            case 'cluster-config':
              return Array.isArray(data.rows) ? data.rows.length : 0;
            case 'cluster-crds':
              return Array.isArray(data.rows) ? data.rows.length : 0;
            case 'cluster-custom':
              return Array.isArray(data.resources) ? data.resources.length : 0;
            case 'cluster-events':
              return Array.isArray(data.rows) ? data.rows.length : 0;
            case 'catalog':
              return Array.isArray(data.items) ? data.items.length : 0;
            case 'namespace-workloads':
              return Array.isArray(data.rows) ? data.rows.length : 0;
            case 'namespace-config':
              return Array.isArray(data.rows) ? data.rows.length : 0;
            case 'namespace-network':
              return Array.isArray(data.rows) ? data.rows.length : 0;
            case 'namespace-rbac':
              return Array.isArray(data.rows) ? data.rows.length : 0;
            case 'namespace-storage':
              return Array.isArray(data.rows) ? data.rows.length : 0;
            case 'namespace-autoscaling':
              return Array.isArray(data.rows) ? data.rows.length : 0;
            case 'namespace-quotas':
              return Array.isArray(data.rows) ? data.rows.length : 0;
            case 'namespace-events':
              return Array.isArray(data.rows) ? data.rows.length : 0;
            case 'namespace-custom':
              return Array.isArray(data.resources) ? data.resources.length : 0;
            case 'namespace-helm':
              return Array.isArray(data.rows) ? data.rows.length : 0;
            default:
              return 0;
          }
        })();
        const lastUpdatedInfo = formatLastUpdated(lastUpdated);
        const refresherName = DOMAIN_REFRESHER_MAP[domain];
        const intervalLabel = formatInterval(
          refresherName ? refreshManager.getRefresherInterval(refresherName) : null
        );
        const namespaceLabel = resolveDomainNamespace(domain, effectiveScope);
        const stats = state.stats;
        let truncated = Boolean(stats?.truncated);
        let totalItems = stats?.totalItems ?? (truncated ? count : undefined);
        let warnings = (stats?.warnings ?? []).filter(
          (warning) => warning && warning.trim().length
        );
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
        if (
          truncated &&
          totalItems !== undefined &&
          warnings.length === 0 &&
          count !== totalItems
        ) {
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
          scope: effectiveScope,
          streamHealth,
        });

        return {
          rowKey: `${domain}:${effectiveScope ?? '-'}`,
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
      }
    );

    const podRows = podScopeEntries.map<DiagnosticsRow>(([scope, state]) => {
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
      const count = payload?.rows?.length ?? 0;
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
      const roleDetails = resolveScopeRole('pods', scope);
      const streamActive = Boolean(streamHealth && streamHealth.reason !== 'inactive');
      const streamHealthy = streamHealth?.status === 'healthy';
      const pollingDetails = resolvePollingDetails({
        domain: 'pods',
        refresherName: DOMAIN_REFRESHER_MAP.pods,
        streamActive,
        streamHealthy,
        metricsOnly: true,
      });
      const modeDetails = resolveModeDetails({
        domain: 'pods',
        streamMode: STREAM_MODE_BY_NAME.resources,
        streamActive,
        streamHealthy,
        pollingEnabled: pollingDetails.enabled,
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
      let label = 'ObjPanel - Pods';
      if (displayScope.startsWith('namespace:')) {
        const namespace = displayScope.slice('namespace:'.length) || 'all';
        label =
          namespace === 'all'
            ? 'ObjPanel - Pods - All namespaces'
            : `ObjPanel - Pods - ${namespace}`;
      } else if (displayScope.startsWith('node:')) {
        const nodeName = displayScope.slice('node:'.length);
        label = `ObjPanel - Pods - ${nodeName}`;
      } else if (displayScope.startsWith('workload:')) {
        const parts = displayScope.split(':');
        const workloadName = parts[parts.length - 1];
        label = `ObjPanel - Pods - ${workloadName}`;
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
      metricsOnly: false,
    });
    const logModeDetails = resolveModeDetails({
      domain: 'container-logs',
      streamMode: STREAM_MODE_BY_NAME['container-logs'],
      streamActive: containerLogsStreamActive,
      streamHealthy: containerLogsStreamHealthy,
      pollingEnabled: logPollingDetails.enabled,
      metricsOnly: false,
    });
    const logRows = containerLogsScopeEntries.map<DiagnosticsRow>(([scope, state]) => {
      const payload = state.data as ContainerLogsSnapshotPayload | null;
      const lastUpdated = state.lastUpdated ?? state.lastAutoRefresh ?? state.lastManualRefresh;
      const lastUpdatedInfo = formatLastUpdated(lastUpdated);
      const normalizedScope = stripClusterScope(scope);
      const parts = normalizedScope.split(':');
      const namespace = parts[0] ?? '';
      const name = parts.slice(2).join(':');
      const namespaceLabel = namespace && namespace !== CLUSTER_SCOPE ? namespace : '-';
      const label = name ? `ObjPanel - Logs - ${name}` : scope;
      const roleDetails = resolveScopeRole('container-logs', scope);
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
        domain: 'container-logs',
        status: state.status,
        error: state.error,
        scope,
        streamHealth: containerLogsStreamHealth,
      });

      return {
        rowKey: `container-logs:${scope}`,
        domain: 'container-logs' as RefreshDomain,
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
        role: roleDetails.label,
        roleTooltip: roleDetails.tooltip,
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

    // Build rows for object panel scoped domains (details, events, yaml, helm).
    const buildObjectPanelRows = (
      domain: RefreshDomain,
      tabName: string,
      entries: Array<[string, DomainSnapshotState<any>]>
    ): DiagnosticsRow[] => {
      return entries.map(([scope, state]) => {
        const lastUpdated = state.lastUpdated ?? state.lastAutoRefresh ?? state.lastManualRefresh;
        const lastUpdatedInfo = formatLastUpdated(lastUpdated);
        const normalizedScope = stripClusterScope(scope);
        const parts = normalizedScope.split(':');
        const namespace = parts[0] ?? '';
        const name = parts.slice(2).join(':');
        const namespaceLabel = namespace && namespace !== CLUSTER_SCOPE ? namespace : '-';
        const label = name ? `ObjPanel - ${tabName} - ${name}` : `ObjPanel - ${tabName}`;
        const version = state.version != null ? String(state.version) : '—';
        const scopeDetails = resolveScopeDetails(scope, selectedClusterId, getClusterMeta);
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
          label,
          status: state.status,
          version,
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
          namespace: namespaceLabel,
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
      });
    };

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
    pickPreferredScopeState,
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
  const { currentCapabilityRows, previousCapabilityRows } = useMemo(() => {
    const current: typeof capabilityBatchRows = [];
    const previous: typeof capabilityBatchRows = [];
    const activeNamespaceKey = selectedNamespace?.toLowerCase() ?? null;

    for (const row of capabilityBatchRows) {
      // Filter to active cluster only.
      if (selectedClusterId && row.clusterId && row.clusterId !== selectedClusterId) {
        continue;
      }
      const isCurrent =
        row.scope === 'Cluster' ||
        row.pendingCount > 0 ||
        row.inFlightCount > 0 ||
        (activeNamespaceKey != null && row.scope.toLowerCase() === activeNamespaceKey);
      if (isCurrent) {
        current.push(row);
      } else {
        previous.push(row);
      }
    }
    return { currentCapabilityRows: current, previousCapabilityRows: previous };
  }, [capabilityBatchRows, selectedNamespace, selectedClusterId]);

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
    onKeyDown: (event) => {
      if (event.key !== 'Tab') {
        return false;
      }

      const direction = event.shiftKey ? 'backward' : 'forward';
      const target = event.target as HTMLElement | null;
      if (target && target.closest('.diagnostics-content')) {
        return false;
      }

      const items = focusables();
      if (items.length === 0) {
        return false;
      }

      const current = target && panelRef.current?.contains(target) ? findActiveIndex() : -1;
      if (current === -1) {
        return direction === 'forward' ? focusFirst() : focusLast();
      }
      const next = direction === 'forward' ? current + 1 : current - 1;
      if (next < 0 || next >= items.length) {
        return false;
      }
      return focusAt(next);
    },
  });

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
      <div className="diagnostics-scroll-area">
        {activeTab === 'refresh-domains'
          ? refreshDomainsContent
          : activeTab === 'streams'
            ? streamsContent
            : activeTab === 'k8s-api'
              ? kubernetesAPIContent
              : activeTab === 'table-performance'
                ? tablePerformanceContent
                : activeTab === 'capability-checks'
                  ? capabilityChecksContent
                  : activeTab === 'effective-permissions'
                    ? effectivePermissionsContent
                    : brokerReadsContent}
      </div>
    </DockablePanel>
  );
};
