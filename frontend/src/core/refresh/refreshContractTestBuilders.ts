import type {
  CatalogSnapshotPayload,
  ClusterConfigSnapshotPayload,
  ClusterEventsSnapshotPayload,
  ClusterNodeSnapshotPayload,
  NamespaceAutoscalingSnapshotPayload,
  NamespaceConfigSnapshotPayload,
  NamespaceWorkloadSnapshotPayload,
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

export const makePodSnapshotPayload = (
  overrides: Partial<PodSnapshotPayload> = {}
): PodSnapshotPayload => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  ...queryEnvelope('pods'),
  rows: [],
  metrics: { stale: false, successCount: 0, failureCount: 0 },
  totalCount: 0,
  healthCounts: {},
  ...overrides,
});

export const makeClusterConfigSnapshotPayload = (
  overrides: Partial<ClusterConfigSnapshotPayload> = {}
): ClusterConfigSnapshotPayload => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  ...queryEnvelope('cluster-config'),
  rows: [],
  ...overrides,
});

export const makeClusterEventsSnapshotPayload = (
  overrides: Partial<ClusterEventsSnapshotPayload> = {}
): ClusterEventsSnapshotPayload => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  ...queryEnvelope('cluster-events'),
  rows: [],
  ...overrides,
});

export const makeNamespaceConfigSnapshotPayload = (
  overrides: Partial<NamespaceConfigSnapshotPayload> = {}
): NamespaceConfigSnapshotPayload => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  ...queryEnvelope('namespace-config'),
  rows: [],
  ...overrides,
});

export const makeNamespaceAutoscalingSnapshotPayload = (
  overrides: Partial<NamespaceAutoscalingSnapshotPayload> = {}
): NamespaceAutoscalingSnapshotPayload => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  ...queryEnvelope('namespace-autoscaling'),
  rows: [],
  ...overrides,
});

export const makeNamespaceWorkloadSnapshotPayload = (
  overrides: Partial<NamespaceWorkloadSnapshotPayload> = {}
): NamespaceWorkloadSnapshotPayload => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  ...queryEnvelope('namespace-workloads'),
  rows: [],
  metrics: { stale: false, successCount: 0, failureCount: 0 },
  ...overrides,
});

export const makeClusterNodeSnapshotPayload = (
  overrides: Partial<ClusterNodeSnapshotPayload> = {}
): ClusterNodeSnapshotPayload => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  ...queryEnvelope('nodes'),
  rows: [],
  metrics: { stale: false, successCount: 0, failureCount: 0 },
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
