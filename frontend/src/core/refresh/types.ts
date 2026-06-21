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
import { nodes } from '@wailsjs/go/models';
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

export interface ResourceRef {
  clusterId: string;
  group: string;
  version: string;
  kind: string;
  resource?: string;
  namespace?: string;
  name?: string;
  uid?: string;
}

export interface DisplayRef {
  clusterId: string;
  group?: string;
  version?: string;
  kind: string;
  resource?: string;
  namespace?: string;
  name?: string;
  uid?: string;
}

export interface ResourceLink {
  ref?: ResourceRef;
  display?: DisplayRef;
}

export interface ResourceStatusPresentation {
  label: string;
  state: string;
  presentation?: string;
  reason?: string;
  message?: string;
  signals?: Array<{
    type: string;
    name: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
  badges?: Array<{
    text: string;
    status: string;
  }>;
  lifecycle?: {
    deleting: boolean;
    finalizerBlocked: boolean;
  };
}

export interface ResourceModel {
  ref: ResourceRef;
  source: string;
  scope: string;
  metadata?: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    creationTimestamp?: string;
    resourceVersion?: string;
    finalizers?: string[];
  };
  status: ResourceStatusPresentation;
  facts?: Record<string, unknown>;
}

export interface ConditionFacts {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
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
  ref: ResourceRef;
  name: string;
  phase: string;
  status?: string;
  statusState?: string;
  statusPresentation?: string;
  statusReason?: string;
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
  gracePeriodSeconds?: number;
  timeoutSeconds?: number;
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
  status: 'running' | 'canceling' | 'cancelled' | 'succeeded' | 'failed';
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
  statusState?: string;
  statusPresentation?: string;
  statusReason?: string;
  roles: string;
  age: string;
  ageTimestamp?: number;
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
  taints?: nodes.NodeTaint[];
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

export interface ClusterNodeSnapshotPayload extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: ClusterNodeSnapshotEntry[];
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

export interface WorkloadTypeResourceUsage {
  cpuUsage: string;
  memoryUsage: string;
}

export interface WorkloadResourceUsage {
  deployments: WorkloadTypeResourceUsage;
  daemonSets: WorkloadTypeResourceUsage;
  statefulSets: WorkloadTypeResourceUsage;
  jobs: WorkloadTypeResourceUsage;
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
  succeededPods: number;
  pendingPods: number;
  failedPods: number;
  readyPods: number;
  startingPods: number;
  failingPods: number;
  terminatingPods: number;
  restartedPods: number;
  notReadyPods: number;
  totalNamespaces: number;
  totalDeployments: number;
  totalStatefulSets: number;
  totalDaemonSets: number;
  totalCronJobs: number;
  workloadResourceUsage: WorkloadResourceUsage;
  readyNodes: number;
  notReadyNodes: number;
  cordonedNodes: number;
  recentEvents: RecentEventEntry[];
}

export interface RecentEventEntry {
  clusterId?: string;
  clusterName?: string;
  involvedObject?: ResourceLink;
  eventUid: string;
  reason: string;
  message: string;
  timestamp: number;
  objectKind: string;
  objectName: string;
  objectNamespace: string;
  objectApiVersion: string;
  objectUid: string;
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
  ageTimestamp?: number;
  typeAlias?: string;
}

export interface ClusterRBACSnapshotPayload extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: ClusterRBACEntry[];
}

export interface ClusterStorageEntry extends ClusterMeta {
  kind: string;
  name: string;
  storageClass?: string;
  capacity: string;
  accessModes: string;
  status: string;
  statusState?: string;
  statusPresentation?: string;
  statusReason?: string;
  claim: string;
  age: string;
  ageTimestamp?: number;
}

export interface ClusterStorageSnapshotPayload extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: ClusterStorageEntry[];
}

export interface ClusterConfigEntry extends ClusterMeta {
  kind: string;
  name: string;
  details: string;
  isDefault?: boolean;
  age: string;
  ageTimestamp?: number;
}

export interface ClusterConfigSnapshotPayload extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: ClusterConfigEntry[];
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
  ageTimestamp?: number;
  typeAlias?: string;
}

export interface ClusterCRDSnapshotPayload extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: ClusterCRDEntry[];
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
  status?: string;
  statusState?: string;
  statusPresentation?: string;
  ready?: boolean;
  observedGeneration?: number;
  conditions?: ConditionFacts[];
  age: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface ClusterCustomSnapshotPayload extends ClusterMeta {
  resources: ClusterCustomEntry[];
  kinds?: string[];
}

export interface ClusterEventEntry extends ClusterMeta {
  kind: string;
  kindAlias?: string;
  name: string;
  uid?: string;
  resourceVersion?: string;
  namespace: string;
  objectNamespace?: string;
  objectUid?: string;
  objectApiVersion?: string;
  involvedObject?: ResourceLink;
  type: string;
  source: string;
  reason: string;
  object: string;
  message: string;
  age: string;
  ageTimestamp?: number;
}

export interface ClusterEventsSnapshotPayload extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: ClusterEventEntry[];
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
  actionFacts?: {
    status?: string;
    unschedulable?: boolean;
    portForwardAvailable?: boolean;
    hpaManaged?: boolean;
    desiredReplicas?: number;
  };
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

// The catalog is the ResourceQueryProviderCatalog member of the resource-query
// contract. It cannot extend ResourceQueryEnvelopeFields because its `kinds`
// facet is the richer KindInfo[] (not string[]) and it carries a keyset
// pagination model; instead it surfaces the envelope's provider/completeness/
// capabilities contract fields directly. See backend CatalogSnapshot.
export interface CatalogSnapshotPayload extends ClusterMeta {
  provider?: string;
  completeness?: 'complete' | 'partial';
  capabilities?: ResourceQueryCapabilities;
  items: CatalogItem[];
  continue?: string;
  previous?: string;
  cursorInvalid?: boolean;
  total: number;
  /** In-scope item count before filters — the "of M" in "showing N of M items due to filters". */
  unfilteredTotal?: number;
  totalIsExact?: boolean;
  resourceCount: number;
  kinds?: KindInfo[];
  namespaces?: string[];
  facetsExact?: boolean;
  issues?: ResourceQueryIssue[];
  hasNext?: boolean;
  hasPrevious?: boolean;
  namespaceGroups?: CatalogNamespaceGroup[];
  parity?: CatalogParity | null;
  batchIndex: number;
  batchSize: number;
  totalBatches: number;
  isFinal: boolean;
  firstBatchLatencyMs?: number;
}

export interface ResourceQueryRequest {
  clusterId: string;
  table: string;
  namespaces?: string[];
  kinds?: string[];
  search?: string;
  predicates?: ResourceQueryPredicate[];
  sortField?: string;
  sortDirection?: string;
  limit?: number;
  continue?: string;
}

export interface ResourceQueryPredicate {
  field: string;
  op: string;
  value?: string;
}

export interface ResourceQueryResult {
  rows: ResourceQueryRow[];
  continue?: string;
  cursorInvalid?: boolean;
  total: number;
  totalIsExact: boolean;
  facets: ResourceQueryFacets;
  facetsExact: boolean;
  partial?: ResourceQueryIssue[];
  dynamic?: ResourceQueryDynamicRef;
}

export interface ResourceQueryCapabilities {
  sortableFields?: string[];
  filterableFields?: string[];
  searchableFields?: string[];
  /**
   * The family's closed set of kinds — the option list the Kinds dropdown
   * renders. Backend-owned (see ResourceQueryCapabilities in
   * backend/refresh/snapshot/resource_query_contract.go); the kind FACETS
   * collapse to the active selection by design and must never be used as the
   * dropdown options. Absent for open kind sets (events).
   */
  kindVocabulary?: string[];
}

/**
 * Flattened canonical query envelope shared by every backend-query resource
 * inventory payload. Migrated domain payloads extend this and add a typed
 * `rows` field. Mirrors the backend `ResourceQueryEnvelope` (Go JSON inlining
 * flattens it to the top level), using flat facet fields to match the wire.
 */
export interface ResourceQueryEnvelopeFields {
  provider?: string;
  table?: string;
  queryIdentity?: string;
  continue?: string;
  previous?: string;
  cursorInvalid?: boolean;
  total?: number;
  totalIsExact?: boolean;
  kinds?: string[];
  namespaces?: string[];
  statuses?: string[];
  nodes?: string[];
  facetsExact?: boolean;
  completeness?: 'complete' | 'partial';
  issues?: ResourceQueryIssue[];
  dynamic?: ResourceQueryDynamicRef;
  capabilities?: ResourceQueryCapabilities;
}

export interface ResourceQueryRow {
  clusterId: string;
  group: string;
  version: string;
  kind: string;
  resource: string;
  namespace?: string;
  name: string;
  uid?: string;
  status?: string;
  ready?: string;
  details?: string;
  age?: string;
  restarts?: number;
  owner?: string;
  node?: string;
  crdName?: string;
  crdGroup?: string;
  crdScope?: string;
  storageVersion?: string;
  storageClass?: string;
  capacity?: string;
  claim?: string;
  chartVersion?: string;
  appVersion?: string;
  helmRevision?: string;
  helmUpdated?: string;
  autoscalingTarget?: string;
  autoscalingCurrent?: string;
  autoscalingDesired?: string;
  cpu?: string;
  memory?: string;
}

export interface ResourceQueryFacets {
  kinds?: string[];
  namespaces?: string[];
  statuses?: string[];
  nodes?: string[];
}

export interface ResourceQueryIssue {
  kind: string;
  message: string;
}

export interface ResourceQueryDynamicRef {
  source: string;
  revision: string;
  policy: string;
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
  statusState?: string;
  statusPresentation?: string;
  statusReason?: string;
  ready: string;
  restarts: number;
  age: string;
  ageTimestamp?: number;
  ownerKind: string;
  ownerName: string;
  portForwardAvailable?: boolean;
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

export interface PodSnapshotPayload extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: PodSnapshotEntry[];
  metrics?: PodMetricsInfo;
  // Scope-level counts (all pods in scope, before search/pagination) so a
  // query-backed view shows total/unhealthy badges and can decide whether a
  // pending health filter has matches — without retaining the live row set.
  // healthCounts keys match the "health" filter modes ('unhealthy', 'restarts',
  // 'not-ready'). Mirrors snapshot.PodSnapshot. See
  // docs/architecture/notify-only-streams.md.
  totalCount?: number;
  healthCounts?: Record<string, number>;
}

export interface ObjectDetailsSnapshotPayload extends ClusterMeta {
  details: any;
  // Object creation time (RFC3339 UTC) for every kind; the frontend formats it
  // into Age with the same formatter the Browse table uses. Omitted by the
  // backend when unavailable. Mirrors snapshot.ObjectDetailsSnapshotPayload.
  creationTimestamp?: string;
  // Relative "last modified" time (same format as Age); omitted by the backend
  // when it can't be determined. Mirrors snapshot.ObjectDetailsSnapshotPayload.
  lastModified?: string;
  resourceModel?: ResourceModel;
}

export interface ObjectEventSummary extends ClusterMeta {
  kind: string;
  name?: string;
  uid?: string;
  resourceVersion?: string;
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
  involvedObjectUid?: string;
  // apiVersion of the event's involvedObject (e.g. "apps/v1", "v1",
  // "documentdb.services.k8s.aws/v1alpha1"). Required for GVK
  // disambiguation when opening the related object — see

  involvedObjectApiVersion?: string;
  involvedObject?: ResourceLink;
  namespace: string;
}

export interface ObjectEventsSnapshotPayload extends ClusterMeta {
  events: ObjectEventSummary[];
}

// Mirrors backend snapshot.ObjectMapReference — see backend/refresh/snapshot/object_map.go.
// All identity fields included so the frontend can re-seed the map or open
// any node in the ObjectPanel without a separate lookup.
export interface ObjectMapReference {
  clusterId: string;
  clusterName?: string;
  group: string;
  version: string;
  kind: string;
  resource?: string;
  namespace?: string;
  name: string;
  uid?: string;
}

export interface ObjectMapNode {
  id: string;
  depth: number;
  ref: ObjectMapReference;
  creationTimestamp?: string;
  status?: ObjectMapStatus;
  actionFacts?: {
    status?: string;
    unschedulable?: boolean;
    portForwardAvailable?: boolean;
    hpaManaged?: boolean;
    desiredReplicas?: number;
  };
}

export interface ObjectMapStatus {
  state: string;
  label: string;
  presentation?: string;
  reason?: string;
}

// Edge `type` is one of the backend tracer categories: owner, selector,
// endpoint, schedules, uses, mounts, storage, routes, scales. The frontend
// keeps it as a string to stay forward-compatible when the backend adds new
// tracers without a frontend release.
export interface ObjectMapEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  tracedBy?: string;
}

export interface ObjectMapSnapshotPayload extends ClusterMeta {
  seed: ObjectMapReference;
  nodes: ObjectMapNode[];
  edges: ObjectMapEdge[];
  maxDepth: number;
  maxNodes: number;
  truncated: boolean;
  warnings?: string[];
}

export interface ObjectYAMLSnapshotPayload extends ClusterMeta {
  yaml: string;
}

export interface ObjectHelmManifestSnapshotPayload extends ClusterMeta {
  manifest: string;
  revision?: number;
  resources?: ResourceLink[];
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
  statusState?: string;
  statusPresentation?: string;
  statusReason?: string;
  restarts: number;
  age: string;
  ageTimestamp?: number;
  portForwardAvailable?: boolean;
  hpaManaged?: boolean | null;
  cpuUsage?: string;
  cpuRequest?: string;
  cpuLimit?: string;
  memUsage?: string;
  memRequest?: string;
  memLimit?: string;
  desiredReplicas?: number;
}

export interface NamespaceWorkloadSnapshotPayload extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: NamespaceWorkloadSummary[];
}

export interface NamespaceConfigSummary extends ClusterMeta {
  kind: string;
  typeAlias?: string;
  name: string;
  namespace: string;
  data: number;
  age: string;
  ageTimestamp?: number;
}

export interface NamespaceConfigSnapshotPayload extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: NamespaceConfigSummary[];
}

export interface NamespaceNetworkSummary extends ClusterMeta {
  kind: string;
  name: string;
  namespace: string;
  details: string;
  age: string;
  ageTimestamp?: number;
}

export interface NamespaceNetworkSnapshotPayload extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: NamespaceNetworkSummary[];
}

export interface NamespaceRBACSummary extends ClusterMeta {
  kind: string;
  name: string;
  namespace: string;
  details: string;
  age: string;
  ageTimestamp?: number;
}

export interface NamespaceRBACSnapshotPayload extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: NamespaceRBACSummary[];
}

export interface NamespaceStorageSummary extends ClusterMeta {
  kind: string;
  name: string;
  namespace: string;
  capacity: string;
  status: string;
  statusState?: string;
  statusPresentation?: string;
  statusReason?: string;
  storageClass: string;
  age: string;
  ageTimestamp?: number;
}

export interface NamespaceStorageSnapshotPayload extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: NamespaceStorageSummary[];
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
  ageTimestamp?: number;
}

export interface NamespaceAutoscalingSnapshotPayload
  extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: NamespaceAutoscalingSummary[];
}

export interface NamespaceQuotaSummary extends ClusterMeta {
  kind: string;
  name: string;
  namespace: string;
  details: string;
  age: string;
  ageTimestamp?: number;
  // PDB-only fields used by the quotas view.
  minAvailable?: string;
  maxUnavailable?: string;
  status?: {
    disruptionsAllowed?: number;
    currentHealthy?: number;
    desiredHealthy?: number;
  };
}

export interface NamespaceQuotasSnapshotPayload extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: NamespaceQuotaSummary[];
}

export interface NamespaceEventSummary extends ClusterMeta {
  kind: string;
  kindAlias?: string;
  name: string;
  uid?: string;
  resourceVersion?: string;
  namespace: string;
  objectNamespace?: string;
  objectUid?: string;
  objectApiVersion?: string;
  involvedObject?: ResourceLink;
  type: string;
  source: string;
  reason: string;
  object: string;
  message: string;
  age: string;
  ageTimestamp?: number;
}

export interface NamespaceEventsSnapshotPayload extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: NamespaceEventSummary[];
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
  status?: string;
  statusState?: string;
  statusPresentation?: string;
  ready?: boolean;
  observedGeneration?: number;
  conditions?: ConditionFacts[];
  age: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface NamespaceCustomSnapshotPayload extends ClusterMeta {
  resources: NamespaceCustomSummary[];
  kinds?: string[];
}

export interface NamespaceHelmSummary extends ClusterMeta {
  name: string;
  namespace: string;
  chart: string;
  appVersion: string;
  status: string;
  statusState?: string;
  statusPresentation?: string;
  statusReason?: string;
  revision: number;
  updated: string;
  description?: string;
  age: string;
  ageTimestamp?: number;
}

export interface NamespaceHelmSnapshotPayload extends ClusterMeta, ResourceQueryEnvelopeFields {
  rows: NamespaceHelmSummary[];
}

export interface ContainerLogsEntry {
  timestamp: string;
  pod: string;
  container: string;
  line: string;
  isInit: boolean;
  isEphemeral?: boolean;
  /** Monotonically increasing sequence ID assigned by the frontend for stable rendering keys. */
  _seq?: number;
}

export interface ContainerLogsSnapshotPayload {
  entries: ContainerLogsEntry[];
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
  | 'object-map'
  | 'object-yaml'
  | 'object-helm-manifest'
  | 'object-helm-values'
  | 'container-logs'
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
  'object-map': ObjectMapSnapshotPayload;
  'object-yaml': ObjectYAMLSnapshotPayload;
  'object-helm-manifest': ObjectHelmManifestSnapshotPayload;
  'object-helm-values': ObjectHelmValuesSnapshotPayload;
  'container-logs': ContainerLogsSnapshotPayload;
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
  // Resource domain these counters belong to (resources stream only); absent for
  // stream-level/socket activity (sessions/connect) and non-per-domain streams.
  // Lets diagnostics show one row per domain. Mirrors backend telemetry.StreamStatus.
  domain?: string;
  // Cluster these counters belong to. The backend emits one entry per
  // (stream, cluster) so diagnostics stays multi-cluster aware; absent only for
  // legacy single-recorder payloads. Mirrors backend telemetry.StreamStatus.
  clusterId?: string;
  clusterName?: string;
  activeSessions: number;
  totalMessages: number;
  droppedMessages: number;
  skippedTargets: number;
  errorCount: number;
  lastConnect: number;
  lastEvent: number;
  lastError?: string;
  // When the last error occurred (unix ms); lets diagnostics show its relative
  // age. Mirrors backend telemetry.StreamStatus.LastErrorAt.
  lastErrorAt?: number;
  lastSkipReason?: string;
}

export interface TelemetrySummary {
  snapshots: TelemetrySnapshotStatus[];
  metrics: TelemetryMetricsStatus;
  streams: TelemetryStreamStatus[];
}
