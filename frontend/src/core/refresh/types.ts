import { types } from '@wailsjs/go/models';
import type { SnapshotStats } from './client';

export interface NamespaceSnapshotPayload {
  namespaces: Array<{
    name: string;
    phase: string;
    resourceVersion: string;
    creationTimestamp: number;
    hasWorkloads?: boolean;
    workloadsUnknown?: boolean;
  }>;
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

export interface NodeMaintenanceDrainJob {
  id: string;
  nodeName: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: number;
  completedAt?: number;
  message?: string;
  options: DrainNodeOptionsPayload;
  events: NodeMaintenanceDrainEvent[];
}

export interface NodeMaintenanceSnapshotPayload {
  drains: NodeMaintenanceDrainJob[];
}

export interface ClusterNodeSnapshotEntry {
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

export interface ClusterNodeSnapshotPayload {
  nodes: ClusterNodeSnapshotEntry[];
  metrics?: NodeMetricsInfo;
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
  totalPods: number;
  totalContainers: number;
  totalInitContainers: number;
  runningPods: number;
  pendingPods: number;
  failedPods: number;
  restartedPods: number;
  totalNamespaces: number;
}

export interface ClusterOverviewSnapshotPayload {
  overview: ClusterOverviewPayload;
  metrics: ClusterOverviewMetrics;
}

export interface ClusterRBACEntry {
  kind: string;
  name: string;
  details: string;
  age: string;
  typeAlias?: string;
}

export interface ClusterRBACSnapshotPayload {
  resources: ClusterRBACEntry[];
}

export interface ClusterStorageEntry {
  kind: string;
  name: string;
  storageClass?: string;
  capacity: string;
  accessModes: string;
  status: string;
  claim: string;
  age: string;
}

export interface ClusterStorageSnapshotPayload {
  volumes: ClusterStorageEntry[];
}

export interface ClusterConfigEntry {
  kind: string;
  name: string;
  details: string;
  isDefault?: boolean;
  age: string;
}

export interface ClusterConfigSnapshotPayload {
  resources: ClusterConfigEntry[];
}

export interface ClusterCRDEntry {
  kind: string;
  name: string;
  group: string;
  scope: string;
  details: string;
  age: string;
  typeAlias?: string;
}

export interface ClusterCRDSnapshotPayload {
  definitions: ClusterCRDEntry[];
}

export interface ClusterCustomEntry {
  kind: string;
  name: string;
  apiGroup: string;
  age: string;
}

export interface ClusterCustomSnapshotPayload {
  resources: ClusterCustomEntry[];
}

export interface ClusterEventEntry {
  kind: string;
  kindAlias?: string;
  name: string;
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

export interface ClusterEventsSnapshotPayload {
  events: ClusterEventEntry[];
}

export type CatalogItemScope = 'Cluster' | 'Namespace';

export interface CatalogItem {
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

export interface CatalogSnapshotPayload {
  items: CatalogItem[];
  continue?: string;
  total: number;
  resourceCount: number;
  kinds?: string[];
  namespaces?: string[];
  parity?: CatalogParity | null;
  batchIndex: number;
  batchSize: number;
  totalBatches: number;
  isFinal: boolean;
  firstBatchLatencyMs?: number;
}

export interface CatalogStreamEventPayload {
  reset?: boolean;
  ready?: boolean;
  snapshot: CatalogSnapshotPayload;
  stats: SnapshotStats;
  generatedAt: number;
}

export interface PodSnapshotEntry {
  name: string;
  namespace: string;
  node: string;
  status: string;
  ready: string;
  restarts: number;
  age: string;
  ownerKind: string;
  ownerName: string;
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

export interface PodSnapshotPayload {
  pods: PodSnapshotEntry[];
  metrics?: PodMetricsInfo;
}

export interface ObjectDetailsSnapshotPayload {
  details: any;
}

export interface ObjectEventSummary {
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
  namespace: string;
}

export interface ObjectEventsSnapshotPayload {
  events: ObjectEventSummary[];
}

export interface ObjectYAMLSnapshotPayload {
  yaml: string;
}

export interface ObjectHelmManifestSnapshotPayload {
  manifest: string;
  revision?: number;
}

export interface ObjectHelmValuesSnapshotPayload {
  values: Record<string, any>;
  revision?: number;
}

export interface NamespaceWorkloadSummary {
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

export interface NamespaceWorkloadSnapshotPayload {
  workloads: NamespaceWorkloadSummary[];
}

export interface NamespaceConfigSummary {
  kind: string;
  typeAlias?: string;
  name: string;
  namespace: string;
  data: number;
  age: string;
}

export interface NamespaceConfigSnapshotPayload {
  resources: NamespaceConfigSummary[];
}

export interface NamespaceNetworkSummary {
  kind: string;
  name: string;
  namespace: string;
  details: string;
  age: string;
}

export interface NamespaceNetworkSnapshotPayload {
  resources: NamespaceNetworkSummary[];
}

export interface NamespaceRBACSummary {
  kind: string;
  name: string;
  namespace: string;
  details: string;
  age: string;
}

export interface NamespaceRBACSnapshotPayload {
  resources: NamespaceRBACSummary[];
}

export interface NamespaceStorageSummary {
  kind: string;
  name: string;
  namespace: string;
  capacity: string;
  status: string;
  storageClass: string;
  age: string;
}

export interface NamespaceStorageSnapshotPayload {
  resources: NamespaceStorageSummary[];
}

export interface NamespaceAutoscalingSummary {
  kind: string;
  name: string;
  namespace: string;
  target: string;
  min: number;
  max: number;
  current: number;
  age: string;
}

export interface NamespaceAutoscalingSnapshotPayload {
  resources: NamespaceAutoscalingSummary[];
}

export interface NamespaceQuotaSummary {
  kind: string;
  name: string;
  namespace: string;
  details: string;
  age: string;
}

export interface NamespaceQuotasSnapshotPayload {
  resources: NamespaceQuotaSummary[];
}

export interface NamespaceEventSummary {
  kind: string;
  kindAlias?: string;
  name: string;
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

export interface NamespaceEventsSnapshotPayload {
  events: NamespaceEventSummary[];
}

export interface NamespaceCustomSummary {
  kind: string;
  name: string;
  apiGroup: string;
  namespace: string;
  age: string;
}

export interface NamespaceCustomSnapshotPayload {
  resources: NamespaceCustomSummary[];
}

export interface NamespaceHelmSummary {
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

export interface NamespaceHelmSnapshotPayload {
  releases: NamespaceHelmSummary[];
}

export interface ObjectLogEntry {
  timestamp: string;
  pod: string;
  container: string;
  line: string;
  isInit: boolean;
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
  | 'node-maintenance'
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
  'node-maintenance': NodeMaintenanceSnapshotPayload;
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
