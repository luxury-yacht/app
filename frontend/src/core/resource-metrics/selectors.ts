import type { ResolvedObjectReference } from '@shared/utils/objectIdentity';
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

const sameText = (left: string | null | undefined, right: string | null | undefined): boolean =>
  (left ?? '') === (right ?? '');

const sameKind = (left: string | null | undefined, right: string | null | undefined): boolean =>
  (left ?? '').toLowerCase() === (right ?? '').toLowerCase();

// One payload carries both halves: base rows arrive with live usage joined at
// serve, and payload.metrics carries the poller freshness/error metadata.

export const selectPodMetrics = (
  payload: PodSnapshotPayload | null | undefined,
  ref: ResolvedObjectReference
): ResourceMetricsData | null => {
  const row = (payload?.rows ?? []).find(
    (candidate) =>
      sameText(candidate.ref.clusterId, ref.clusterId) &&
      sameText(candidate.ref.namespace, ref.namespace) &&
      sameText(candidate.ref.name, ref.name)
  );
  if (!row) {
    return null;
  }
  const data = podRowResourceMetrics(row, payload?.metrics);
  return hasResourceMetricData(data) ? data : null;
};

export const selectWorkloadMetrics = (
  payload: NamespaceWorkloadSnapshotPayload | null | undefined,
  ref: ResolvedObjectReference
): ResourceMetricsData | null => {
  const row = (payload?.rows ?? []).find(
    (candidate) =>
      sameText(candidate.ref.clusterId, ref.clusterId) &&
      sameText(candidate.ref.namespace, ref.namespace) &&
      sameKind(candidate.ref.kind, ref.kind) &&
      sameText(candidate.ref.name, ref.name)
  );
  if (!row) {
    return null;
  }
  const data = workloadRowResourceMetrics(row, payload?.metrics);
  return hasResourceMetricData(data) ? data : null;
};

export const selectNodeMetrics = (
  payload: ClusterNodeSnapshotPayload | null | undefined,
  ref: ResolvedObjectReference
): ResourceMetricsData | null => {
  const row = (payload?.rows ?? []).find(
    (candidate) =>
      sameText(candidate.ref.clusterId, ref.clusterId) && sameText(candidate.ref.name, ref.name)
  );
  if (!row) {
    return null;
  }
  const data = nodeRowResourceMetrics(row, payload?.metrics);
  return hasResourceMetricData(data) ? data : null;
};
