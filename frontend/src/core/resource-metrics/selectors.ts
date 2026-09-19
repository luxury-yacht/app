import type { ClusterObjectReference } from '@shared/utils/objectIdentity';
import type {
  ClusterNodeSnapshotPayload,
  NamespaceWorkloadSnapshotPayload,
  PodSnapshotPayload,
} from '@/core/refresh/types';
import type { ResourceMetricsData } from './types';
import {
  hasResourceMetricData,
  nodeRowResourceMetrics,
  podRowResourceMetrics,
  workloadRowResourceMetrics,
} from './valueAdapters';

const matchesMetricsReference = (
  row: Pick<
    ClusterObjectReference,
    'clusterId' | 'group' | 'version' | 'kind' | 'namespace' | 'name'
  >,
  ref: ClusterObjectReference
): boolean =>
  row.clusterId === ref.clusterId &&
  row.group === ref.group &&
  row.version === ref.version &&
  row.kind.toLowerCase() === ref.kind.toLowerCase() &&
  (row.namespace ?? '') === (ref.namespace ?? '') &&
  row.name === ref.name;

// One payload carries both halves: base rows arrive with live usage joined at
// serve, and payload.metrics carries the poller freshness/error metadata.

export const selectPodMetrics = (
  payload: PodSnapshotPayload | null | undefined,
  ref: ClusterObjectReference
): ResourceMetricsData | null => {
  const row = payload?.rows?.find((candidate) => matchesMetricsReference(candidate.ref, ref));
  if (!row) {
    return null;
  }
  const data = podRowResourceMetrics(row, payload?.metrics);
  return hasResourceMetricData(data) ? data : null;
};

export const selectWorkloadMetrics = (
  payload: NamespaceWorkloadSnapshotPayload | null | undefined,
  ref: ClusterObjectReference
): ResourceMetricsData | null => {
  const row = payload?.rows?.find((candidate) => matchesMetricsReference(candidate.ref, ref));
  if (!row) {
    return null;
  }
  const data = workloadRowResourceMetrics(row, payload?.metrics);
  return hasResourceMetricData(data) ? data : null;
};

export const selectNodeMetrics = (
  payload: ClusterNodeSnapshotPayload | null | undefined,
  ref: ClusterObjectReference
): ResourceMetricsData | null => {
  const row = payload?.rows?.find((candidate) => matchesMetricsReference(candidate.ref, ref));
  if (!row) {
    return null;
  }
  const data = nodeRowResourceMetrics(row, payload?.metrics);
  return hasResourceMetricData(data) ? data : null;
};
