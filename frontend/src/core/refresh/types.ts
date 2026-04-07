/**
 * frontend/src/core/refresh/types.ts
 *
 * Shared refresh domain and payload type definitions.
 * Used by RefreshManager, RefreshManagerContext, and various components.
 * - Defines the structure of payloads for different refresh domains.
 * - Facilitates type-safe handling of refresh data across the app.
 * - Provides a clear contract for what data is expected in each refresh scenario.
 * - Enables easier maintenance and extension of refresh-related features.
 * - Helps ensure consistency between backend data structures and frontend usage.
 * - Supports telemetry and monitoring of refresh operations by defining standard payloads.
 */
import { types } from '@wailsjs/go/models';
import type { SnapshotStats } from './client';

// PermissionDeniedStatus mirrors Status-like RBAC error payloads from the refresh API.
export interface PermissionDeniedDetails {
  domain?: string;
  resource?: string;
  kind?: string;
  name?: string;
}

export interface PermissionDeniedStatus {
  kind?: string;
  apiVersion?: string;
  message?: string;
  reason?: string;
  details?: PermissionDeniedDetails;
  code?: number;
}

// ClusterMeta identifies a cluster on every snapshot payload. The Go
// backend at backend/refresh/snapshot/cluster_meta.go declares
// ClusterID as a non-optional string and stamps it on every snapshot
// via WithClusterMeta, so this type matches the wire contract —
// required on the frontend side.
//
// Making this required is load-bearing for the multi-cluster rule in
// AGENTS.md: downstream merge-key and command-dispatch logic can
// trust that clusterId is present without sprinkling `?? ''`
// fallbacks that would silently degrade to cross-cluster collisions.
//
// Descendant types (NamespaceSummary, PodSnapshotEntry,
// ClusterNodeSnapshotEntry, etc.) still declare clusterId as
// optional because each of those is a separate cascade to tighten —
// this refactor is bounded to ClusterMeta and its direct descendants
// (snapshot payload wrappers).
export interface ClusterMeta {
  clusterId: string;
  clusterName?: string;
}

export interface NamespaceSummary extends ClusterMeta {
  name: string;
  phase: string;
  resourceVersion: string;
  creationTimestamp: number;
  hasWorkloads?: boolean;
  workloadsUnknown?: boolean;
}

export interface NamespaceSnapshotPayload extends ClusterMeta {
  namespaces: NamespaceSummary[];
}

export interface NodePodMetric {
  namespace: string;
  name: string;
  cpuUsage: string;
  memoryUsage: string;
}

export interface DrainNodeOptionsPayload {
  gracePeriodSeconds: number;
  ignoreDaemonSets: boolean;
  deleteEmptyDirData: boolean;
  force: boolean;
  disableEviction: boolean;
  skipWaitForPodsToTerminate: boolean;
}

export interface NodeMaintenanceDrainEvent {
  id: string;
  timestamp: number;
  kind: 'info' | 'pod' | 'error';
  phase?: string;
  message?: string;
  podNamespace?: string;
  podName?: string;
}

export interface NodeMaintenanceDrainJob extends ClusterMeta {
  id: string;
  nodeName: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: number;
  completedAt?: number;
  message?: string;
  options: DrainNodeOptionsPayload;
  events: NodeMaintenanceDrainEvent[];
}

export interface NodeMaintenanceSnapshotPayload extends ClusterMeta {
  drains: NodeMaintenanceDrainJob[];
}

export interface ClusterNodeSnapshotEntry extends ClusterMeta {
  name: string;
  status: string;
  roles: string;
  age: string;
  version: string;
  internalIP?: string;
  externalIP?: string;
  cpuCapacity: string;
  cpuAllocatable: string;
  cpuRequests: string;
  cpuLimits: string;
  cpuUsage: string;
  memoryCapacity: string;
  memoryAllocatable: string;
  memRequests: string;
  memLimits: string;
  memoryUsage: string;
  pods: string;
  podsCapacity: string;
  podsAllocatable: string;
  restarts: number;
  kind: string;
  cpu: string;
  memory: string;
  unschedulable: boolean;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  taints?: types.NodeTaint[];
  podMetrics?: NodePodMetric[];
}

export interface NodeMetricsInfo {
  collectedAt?: number;
  stale: boolean;
  lastError?: string;
  consecutiveFailures?: number;
  successCount: number;
  failureCount: number;
}

export interface ClusterNodeSnapshotPayload extends ClusterMeta {
  nodes: ClusterNodeSnapshotEntry[];
  metrics?: NodeMetricsInfo;
  metricsByCluster?: Record<string, NodeMetricsInfo>;
}

export type ClusterNodeRow = ClusterNodeSnapshotEntry;

export interface ClusterOverviewMetrics {
  collectedAt?: number;
  stale: boolean;
  lastError?: string;
  consecutiveFailures?: number;
  successCount: number;
  failureCount: number;
}

export interface ClusterOverviewPayload {
  clusterType: string;
  clusterVersion: string;
  cpuUsage: string;
  cpuRequests: string;
  cpuLimits: string;
  cpuAllocatable: string;
  memoryUsage: string;
  memoryRequests: string;
  memoryLimits: string;
  memoryAllocatable: string;
  totalNodes: number;
  fargateNodes: number;
  regularNodes: number;
  ec2Nodes: number;
  virtualNodes: number;
  vmNodes: number;
  totalPods: number;
  totalContainers: number;
  totalInitContainers: number;
  runningPods: number;
  pendingPods: number;
  failedPods: number;
  restartedPods: number;
  totalNamespaces: number;
}

export interface ClusterOverviewSnapshotPayload extends ClusterMeta {
  overview: ClusterOverviewPayload;
  metrics: ClusterOverviewMetrics;
  metricsByCluster?: Record<string, ClusterOverviewMetrics>;
  overviewByCluster?: Record<string, ClusterOverviewPayload>;
}

export interface ClusterRBACEntry extends ClusterMeta {
  kind: string;
  name: string;
  details: string;
  age: string;
  typeAlias?: string;
}

export interface ClusterRBACSnapshotPayload extends ClusterMeta {
  resources: ClusterRBACEntry[];
}

export interface ClusterStorageEntry extends ClusterMeta {
  kind: string;
  name: string;
  storageClass?: string;
  capacity: string;
  accessModes: string;
  status: string;
  claim: string;
  age: string;
}

export interface ClusterStorageSnapshotPayload extends ClusterMeta {
  volumes: ClusterStorageEntry[];
}

export interface ClusterConfigEntry extends ClusterMeta {
  kind: string;
  name: string;
  details: string;
  isDefault?: boolean;
  age: string;
}

export interface ClusterConfigSnapshotPayload extends ClusterMeta {
  resources: ClusterConfigEntry[];
}

export interface ClusterCRDEntry extends ClusterMeta {
  kind: string;
  name: string;
  group: string;
  scope: string;
  details: string;
  /**
   * Name of the CRD's storage version (the version etcd persists). When
   * a CRD serves multiple versions, exactly one is the storage version
   * and the API server converts to/from it. The Version column in the
   * cluster CRDs view renders this as `storageVersion` for single-version
   * CRDs and `storageVersion (+N)` for multi-version CRDs. See
   * .
   */
  storageVersion?: string;
  /**
   * Number of *additional* served versions beyond the storage version.
   * Zero for single-version CRDs.
   */
  extraServedVersionCount?: number;
  age: string;
  typeAlias?: string;
}

export interface ClusterCRDSnapshotPayload extends ClusterMeta {
  definitions: ClusterCRDEntry[];
}

export interface ClusterCustomEntry extends ClusterMeta {
  kind: string;
  name: string;
  apiGroup: string;
  /** API version paired with apiGroup for GVK-aware resolution of the
   * owning CRD. */
  apiVersion: string;
  /**
   * Canonical Kubernetes name of the CustomResourceDefinition that
   * defines this resource's Kind, in the form `<plural>.<group>` (e.g.
   * `dbclusters.rds.services.k8s.aws`). Used by ClusterViewCustom's
   * CRD column to render a clickable cell that opens the owning CRD
   * in the object panel. Same-shape field as
   * `NamespaceCustomSummary.crdName`.
   */
  crdName?: string;
  age: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface ClusterCustomSnapshotPayload extends ClusterMeta {
  resources: ClusterCustomEntry[];
}

export interface ClusterEventEntry extends ClusterMeta {
  kind: string;
  kindAlias?: string;
  name: string;
  uid?: string;
  resourceVersion?: string;
  namespace: string;
  objectNamespace?: string;
  type: string;
  source: string;
  reason: string;
  object: string;
  message: string;
  age: string;
  ageTimestamp?: number;
}

export interface ClusterEventsSnapshotPayload extends ClusterMeta {
  events: ClusterEventEntry[];
}

export type CatalogItemScope = 'Cluster' | 'Namespace';

export interface KindInfo {
  kind: string;
  namespaced: boolean;
}

export interface CatalogItem extends ClusterMeta {
  kind: string;
  group: string;
  version: string;
  resource: string;
  namespace?: string;
  name: string;
  uid: string;
  resourceVersion: string;
  creationTimestamp: string;
  scope: CatalogItemScope;
  labelsDigest?: string;
}

export interface CatalogParity {
  checked: boolean;
  catalogCount: number;
  legacyCount: number;
  missingSample?: string[];
  extraSample?: string[];
}

export interface CatalogNamespaceGroup extends ClusterMeta {
  namespaces: string[];
  selectedNamespaces?: string[];
}

export interface CatalogSnapshotPayload extends ClusterMeta {
  items: CatalogItem[];
  continue?: string;
  total: number;
  resourceCount: number;
  kinds?: KindInfo[];
  namespaces?: string[];
  namespaceGroups?: CatalogNamespaceGroup[];
  parity?: CatalogParity | null;
  batchIndex: number;
  batchSize: number;
  totalBatches: number;
  isFinal: boolean;
  firstBatchLatencyMs?: number;
}

// Indicates whether the catalog stream payload is a full replacement or a partial update.
export type CatalogStreamSnapshotMode = 'full' | 'partial';

export interface CatalogStreamEventPayload {
  reset?: boolean;
  ready?: boolean;
  cacheReady: boolean;
  truncated: boolean;
  snapshotMode: CatalogStreamSnapshotMode;
  snapshot: CatalogSnapshotPayload;
  stats: SnapshotStats;
  generatedAt: number;
  sequence: number;
}

export interface PodSnapshotEntry extends ClusterMeta {
  name: string;
  namespace: string;
  node: string;
  status: string;
  ready: string;
  restarts: number;
  age: string;
  ownerKind: string;
  ownerName: string;
  /**
   * Wire-form apiVersion of the controlling owner (e.g. "apps/v1",
   * "argoproj.io/v1alpha1"). Threaded from
   * pod.OwnerReferences[*].APIVersion so the panel can open
   * CRD-as-Pod-owner targets correctly. See
   * .
   */
  ownerApiVersion?: string;
  cpuRequest: string;
  cpuLimit: string;
  cpuUsage: string;
  memRequest: string;
  memLimit: string;
  memUsage: string;
}

export interface PodMetricsInfo {
  collectedAt?: number;
  stale: boolean;
  lastError?: string;
  consecutiveFailures?: number;
  successCount: number;
  failureCount: number;
}

export interface PodSnapshotPayload extends ClusterMeta {
  pods: PodSnapshotEntry[];
  metrics?: PodMetricsInfo;
}

export interface ObjectDetailsSnapshotPayload extends ClusterMeta {
  details: any;
}

export interface ObjectEventSummary extends ClusterMeta {
  kind: string;
  eventType: string;
  reason: string;
  message: string;
  count: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  source:
    | string
    | {
        component?: string;
        host?: string;
        reportingController?: string;
        reportingInstance?: string;
      };
  involvedObjectName: string;
  involvedObjectKind: string;
  involvedObjectNamespace?: string;
  // apiVersion of the event's involvedObject (e.g. "apps/v1", "v1",
  // "documentdb.services.k8s.aws/v1alpha1"). Required for GVK
  // disambiguation when opening the related object — see

  involvedObjectApiVersion?: string;
  namespace: string;
}

export interface ObjectEventsSnapshotPayload extends ClusterMeta {
  events: ObjectEventSummary[];
}

export interface ObjectYAMLSnapshotPayload extends ClusterMeta {
  yaml: string;
}

export interface ObjectHelmManifestSnapshotPayload extends ClusterMeta {
  manifest: string;
  revision?: number;
}

export interface ObjectHelmValuesSnapshotPayload extends ClusterMeta {
  values: Record<string, any>;
  revision?: number;
}

export interface NamespaceWorkloadSummary extends ClusterMeta {
  kind: string;
  name: string;
  namespace: string;
  ready: string;
  status: string;
  restarts: number;
  age: string;
  cpuUsage?: string;
  cpuRequest?: string;
  cpuLimit?: string;
  memUsage?: string;
  memRequest?: string;
  memLimit?: string;
}

export interface NamespaceWorkloadSnapshotPayload extends ClusterMeta {
  workloads: NamespaceWorkloadSummary[];
}

export interface NamespaceConfigSummary extends ClusterMeta {
  kind: string;
  typeAlias?: string;
  name: string;
  namespace: string;
  data: number;
  age: string;
}

export interface NamespaceConfigSnapshotPayload extends ClusterMeta {
  resources: NamespaceConfigSummary[];
}

export interface NamespaceNetworkSummary extends ClusterMeta {
  kind: string;
  name: string;
  namespace: string;
  details: string;
  age: string;
}

export interface NamespaceNetworkSnapshotPayload extends ClusterMeta {
  resources: NamespaceNetworkSummary[];
}

export interface NamespaceRBACSummary extends ClusterMeta {
  kind: string;
  name: string;
  namespace: string;
  details: string;
  age: string;
}

export interface NamespaceRBACSnapshotPayload extends ClusterMeta {
  resources: NamespaceRBACSummary[];
}

export interface NamespaceStorageSummary extends ClusterMeta {
  kind: string;
  name: string;
  namespace: string;
  capacity: string;
  status: string;
  storageClass: string;
  age: string;
}

export interface NamespaceStorageSnapshotPayload extends ClusterMeta {
  resources: NamespaceStorageSummary[];
}

export interface NamespaceAutoscalingSummary extends ClusterMeta {
  kind: string;
  name: string;
  namespace: string;
  /** Display string "Kind/Name" for the table column. */
  target: string;
  /**
   * Wire-form apiVersion of the scale target (e.g. "apps/v1",
   * "documentdb.services.k8s.aws/v1alpha1"). Threaded from
   * `hpa.Spec.ScaleTargetRef.APIVersion` so the panel can open the target
   * with a fully-qualified GVK — required for CRDs that share a Kind. See
   * .
   */
  targetApiVersion?: string;
  min: number;
  max: number;
  current: number;
  age: string;
}

export interface NamespaceAutoscalingSnapshotPayload extends ClusterMeta {
  resources: NamespaceAutoscalingSummary[];
}

export interface NamespaceQuotaSummary extends ClusterMeta {
  kind: string;
  name: string;
  namespace: string;
  details: string;
  age: string;
  // PDB-only fields used by the quotas view.
  minAvailable?: string;
  maxUnavailable?: string;
  status?: {
    disruptionsAllowed?: number;
    currentHealthy?: number;
    desiredHealthy?: number;
  };
}

export interface NamespaceQuotasSnapshotPayload extends ClusterMeta {
  resources: NamespaceQuotaSummary[];
}

export interface NamespaceEventSummary extends ClusterMeta {
  kind: string;
  kindAlias?: string;
  name: string;
  uid?: string;
  resourceVersion?: string;
  namespace: string;
  objectNamespace?: string;
  type: string;
  source: string;
  reason: string;
  object: string;
  message: string;
  age: string;
  ageTimestamp?: number;
}

export interface NamespaceEventsSnapshotPayload extends ClusterMeta {
  events: NamespaceEventSummary[];
}

export interface NamespaceCustomSummary extends ClusterMeta {
  kind: string;
  name: string;
  apiGroup: string;
  /** API version paired with apiGroup for GVK-aware resolution of the
   * owning CRD. */
  apiVersion: string;
  /**
   * Canonical Kubernetes name of the CustomResourceDefinition that
   * defines this resource's Kind, in the form `<plural>.<group>` (e.g.
   * `dbinstances.rds.services.k8s.aws`). Used by NsViewCustom's CRD
   * column to render a clickable cell that opens the owning CRD in
   * the object panel.
   */
  crdName?: string;
  namespace: string;
  age: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface NamespaceCustomSnapshotPayload extends ClusterMeta {
  resources: NamespaceCustomSummary[];
}

export interface NamespaceHelmSummary extends ClusterMeta {
  name: string;
  namespace: string;
  chart: string;
  appVersion: string;
  status: string;
  revision: number;
  updated: string;
  description?: string;
  notes?: string;
  age: string;
}

export interface NamespaceHelmSnapshotPayload extends ClusterMeta {
  releases: NamespaceHelmSummary[];
}

export interface ObjectLogEntry {
  timestamp: string;
  pod: string;
  container: string;
  line: string;
  isInit: boolean;
  /** Monotonically increasing sequence ID assigned by the frontend for stable rendering keys. */
  _seq?: number;
}

export interface ObjectLogsSnapshotPayload {
  entries: ObjectLogEntry[];
  sequence: number;
  generatedAt: number;
  resetCount: number;
  error?: string | null;
}

export type RefreshDomain =
  | 'namespaces'
  | 'cluster-overview'
  | 'nodes'
  | 'object-maintenance'
  | 'pods'
  | 'object-details'
  | 'object-events'
  | 'object-yaml'
  | 'object-helm-manifest'
  | 'object-helm-values'
  | 'object-logs'
  | 'cluster-rbac'
  | 'cluster-storage'
  | 'cluster-config'
  | 'cluster-crds'
  | 'cluster-custom'
  | 'cluster-events'
  | 'catalog'
  | 'catalog-diff'
  | 'namespace-workloads'
  | 'namespace-config'
  | 'namespace-network'
  | 'namespace-rbac'
  | 'namespace-storage'
  | 'namespace-autoscaling'
  | 'namespace-quotas'
  | 'namespace-events'
  | 'namespace-custom'
  | 'namespace-helm';

export interface DomainPayloadMap {
  namespaces: NamespaceSnapshotPayload;
  'cluster-overview': ClusterOverviewSnapshotPayload;
  nodes: ClusterNodeSnapshotPayload;
  'object-maintenance': NodeMaintenanceSnapshotPayload;
  pods: PodSnapshotPayload;
  'object-details': ObjectDetailsSnapshotPayload;
  'object-events': ObjectEventsSnapshotPayload;
  'object-yaml': ObjectYAMLSnapshotPayload;
  'object-helm-manifest': ObjectHelmManifestSnapshotPayload;
  'object-helm-values': ObjectHelmValuesSnapshotPayload;
  'object-logs': ObjectLogsSnapshotPayload;
  'cluster-rbac': ClusterRBACSnapshotPayload;
  'cluster-storage': ClusterStorageSnapshotPayload;
  'cluster-config': ClusterConfigSnapshotPayload;
  'cluster-crds': ClusterCRDSnapshotPayload;
  'cluster-custom': ClusterCustomSnapshotPayload;
  'cluster-events': ClusterEventsSnapshotPayload;
  catalog: CatalogSnapshotPayload;
  'catalog-diff': CatalogSnapshotPayload;
  'namespace-workloads': NamespaceWorkloadSnapshotPayload;
  'namespace-config': NamespaceConfigSnapshotPayload;
  'namespace-network': NamespaceNetworkSnapshotPayload;
  'namespace-rbac': NamespaceRBACSnapshotPayload;
  'namespace-storage': NamespaceStorageSnapshotPayload;
  'namespace-autoscaling': NamespaceAutoscalingSnapshotPayload;
  'namespace-quotas': NamespaceQuotasSnapshotPayload;
  'namespace-events': NamespaceEventsSnapshotPayload;
  'namespace-custom': NamespaceCustomSnapshotPayload;
  'namespace-helm': NamespaceHelmSnapshotPayload;
}

export interface TelemetrySnapshotStatus {
  domain: string;
  scope?: string;
  clusterId?: string;
  clusterName?: string;
  lastStatus: 'success' | 'error';
  lastError?: string;
  lastDurationMs: number;
  lastUpdated: number;
  successCount: number;
  failureCount: number;
  truncated?: boolean;
  totalItems?: number;
  warnings?: string[];
}

export interface TelemetryMetricsStatus {
  lastCollected: number;
  lastDurationMs: number;
  consecutiveFailures: number;
  lastError?: string;
  successCount: number;
  failureCount: number;
  active?: boolean;
}

export interface TelemetryStreamStatus {
  name: string;
  activeSessions: number;
  totalMessages: number;
  droppedMessages: number;
  errorCount: number;
  lastConnect: number;
  lastEvent: number;
  lastError?: string;
}

export interface TelemetrySummary {
  snapshots: TelemetrySnapshotStatus[];
  metrics: TelemetryMetricsStatus;
  streams: TelemetryStreamStatus[];
}
