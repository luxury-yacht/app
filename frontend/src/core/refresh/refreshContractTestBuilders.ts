import type {
  CatalogSnapshotPayload,
  ClusterConfigSnapshotPayload,
  ClusterEventsSnapshotPayload,
  ClusterNodeSnapshotEntry,
  ClusterNodeSnapshotPayload,
  NamespaceAutoscalingSnapshotPayload,
  NamespaceConfigSnapshotPayload,
  NamespaceWorkloadSnapshotPayload,
  NamespaceWorkloadSummary,
  PodSnapshotEntry,
  PodSnapshotPayload,
  ResourceQueryCapabilities,
  TelemetrySummary,
} from './types';

const capabilities = (): ResourceQueryCapabilities => ({
  sortableFields: [],
  filterableFields: [],
  searchableFields: [],
  kindVocabulary: [],
});

const queryEnvelope = (table: string) => ({
  provider: 'typed-resource' as const,
  table,
  total: 0,
  unfilteredTotal: 0,
  totalIsExact: true,
  facetsExact: true,
  capabilities: capabilities(),
});

const emptyRowsPayload = (table: string) => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  ...queryEnvelope(table),
  rows: [],
});

const metricsStatus = () => ({ stale: false, successCount: 0, failureCount: 0 });

export const makePodSnapshotPayload = (
  overrides: Partial<PodSnapshotPayload> = {}
): PodSnapshotPayload => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  ...queryEnvelope('pods'),
  rows: [],
  metrics: metricsStatus(),
  totalCount: 0,
  healthCounts: {},
  ...overrides,
});

export const makeClusterConfigSnapshotPayload = (
  overrides: Partial<ClusterConfigSnapshotPayload> = {}
): ClusterConfigSnapshotPayload => ({
  ...emptyRowsPayload('cluster-config'),
  ...overrides,
});

export const makeClusterEventsSnapshotPayload = (
  overrides: Partial<ClusterEventsSnapshotPayload> = {}
): ClusterEventsSnapshotPayload => ({
  ...emptyRowsPayload('cluster-events'),
  ...overrides,
});

export const makeNamespaceConfigSnapshotPayload = (
  overrides: Partial<NamespaceConfigSnapshotPayload> = {}
): NamespaceConfigSnapshotPayload => ({
  ...emptyRowsPayload('namespace-config'),
  ...overrides,
});

export const makeNamespaceAutoscalingSnapshotPayload = (
  overrides: Partial<NamespaceAutoscalingSnapshotPayload> = {}
): NamespaceAutoscalingSnapshotPayload => ({
  ...emptyRowsPayload('namespace-autoscaling'),
  ...overrides,
});

export const makeNamespaceWorkloadSnapshotPayload = (
  overrides: Partial<NamespaceWorkloadSnapshotPayload> = {}
): NamespaceWorkloadSnapshotPayload => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  ...queryEnvelope('namespace-workloads'),
  rows: [],
  metrics: metricsStatus(),
  ...overrides,
});

export const makeClusterNodeSnapshotPayload = (
  overrides: Partial<ClusterNodeSnapshotPayload> = {}
): ClusterNodeSnapshotPayload => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  ...queryEnvelope('nodes'),
  rows: [],
  metrics: metricsStatus(),
  ...overrides,
});

export const makeCatalogSnapshotPayload = (
  overrides: Partial<CatalogSnapshotPayload> = {}
): CatalogSnapshotPayload => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  provider: 'catalog',
  capabilities: capabilities(),
  items: [],
  total: 0,
  unfilteredTotal: 0,
  totalIsExact: true,
  resourceCount: 0,
  facetsExact: true,
  hasNext: false,
  hasPrevious: false,
  batchIndex: 0,
  batchSize: 0,
  totalBatches: 1,
  isFinal: true,
  ...overrides,
});

export const makePodSnapshotEntry = (
  overrides: Partial<PodSnapshotEntry> = {}
): PodSnapshotEntry => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  namespace: 'default',
  name: 'pod-a',
  node: 'node-a',
  status: 'Running',
  ready: '1/1',
  restarts: 0,
  age: '1m',
  ownerKind: 'Deployment',
  ownerName: 'web',
  portForwardAvailable: false,
  cpuRequest: '10m',
  cpuLimit: '20m',
  cpuUsage: '10m',
  memRequest: '10Mi',
  memLimit: '20Mi',
  memUsage: '20Mi',
  ...overrides,
});

export const makeClusterNodeSnapshotEntry = (
  overrides: Partial<ClusterNodeSnapshotEntry> = {}
): ClusterNodeSnapshotEntry => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  name: 'node-a',
  status: 'Ready',
  roles: 'worker',
  age: '1d',
  version: 'v1.31.0',
  cpuCapacity: '8',
  cpuAllocatable: '7600m',
  cpuRequests: '2',
  cpuLimits: '4',
  cpuUsage: '1200m',
  memoryCapacity: '32Gi',
  memoryAllocatable: '30Gi',
  memRequests: '6Gi',
  memLimits: '12Gi',
  memoryUsage: '5Gi',
  pods: '18',
  podsCapacity: '110',
  podsAllocatable: '100',
  restarts: 0,
  kind: 'Node',
  cpu: '1200m',
  memory: '5Gi',
  unschedulable: false,
  ...overrides,
});

export const makeNamespaceWorkloadSummary = (
  overrides: Partial<NamespaceWorkloadSummary> = {}
): NamespaceWorkloadSummary => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  kind: 'Deployment',
  name: 'api',
  namespace: 'default',
  ready: '1/1',
  status: 'Ready',
  restarts: 0,
  age: '1m',
  portForwardAvailable: false,
  ...overrides,
});

type TelemetrySummaryOverrides = Omit<Partial<TelemetrySummary>, 'metrics' | 'connection'> & {
  metrics?: Partial<TelemetrySummary['metrics']>;
  connection?: Partial<TelemetrySummary['connection']>;
};

export const makeTelemetrySummary = (
  overrides: TelemetrySummaryOverrides = {}
): TelemetrySummary => {
  const metrics: TelemetrySummary['metrics'] = {
    lastCollected: 0,
    lastDurationMs: 0,
    consecutiveFailures: 0,
    successCount: 0,
    failureCount: 0,
    active: false,
    ...overrides.metrics,
  };
  const connection: TelemetrySummary['connection'] = {
    retryAttempts: 0,
    retrySuccesses: 0,
    retryExhausted: 0,
    transportRebuilds: 0,
    ...overrides.connection,
  };
  return {
    snapshots: [],
    streams: [],
    ...overrides,
    metrics,
    connection,
  };
};
