import type {
  ClusterNodeSnapshotPayload,
  NamespaceWorkloadSnapshotPayload,
  NodeMetricsInfo,
  PodSnapshotPayload,
} from '@/core/refresh/types';
import type { ResolvedObjectReference } from '@shared/utils/objectIdentity';
import {
  hasResourceMetricData,
  nodeRowResourceMetrics,
  podRowResourceMetrics,
  workloadRowResourceMetrics,
} from './valueAdapters';
import type { ResourceMetricsData } from './types';

const sameText = (left: string | null | undefined, right: string | null | undefined): boolean =>
  (left ?? '') === (right ?? '');

const sameKind = (left: string | null | undefined, right: string | null | undefined): boolean =>
  (left ?? '').toLowerCase() === (right ?? '').toLowerCase();

export const selectPodMetrics = (
  payload: PodSnapshotPayload | null | undefined,
  ref: ResolvedObjectReference
): ResourceMetricsData | null => {
  const row = payload?.rows.find(
    (candidate) =>
      sameText(candidate.clusterId, ref.clusterId) &&
      sameText(candidate.namespace, ref.namespace) &&
      sameText(candidate.name, ref.name)
  );
  if (!row) {
    return null;
  }
  const data = podRowResourceMetrics(row, payload?.metrics);
  return hasResourceMetricData(data) ? data : null;
};

export const selectWorkloadMetrics = (
  payload: NamespaceWorkloadSnapshotPayload | null | undefined,
  ref: ResolvedObjectReference,
  freshness?: NodeMetricsInfo | null
): ResourceMetricsData | null => {
  const row = payload?.rows.find(
    (candidate) =>
      sameText(candidate.clusterId, ref.clusterId) &&
      sameText(candidate.namespace, ref.namespace) &&
      sameKind(candidate.kind, ref.kind) &&
      sameText(candidate.name, ref.name)
  );
  if (!row) {
    return null;
  }
  const data = workloadRowResourceMetrics(row, freshness);
  return hasResourceMetricData(data) ? data : null;
};

export const selectNodeMetrics = (
  payload: ClusterNodeSnapshotPayload | null | undefined,
  ref: ResolvedObjectReference
): ResourceMetricsData | null => {
  const row = payload?.rows.find(
    (candidate) =>
      sameText(candidate.clusterId, ref.clusterId) && sameText(candidate.name, ref.name)
  );
  if (!row) {
    return null;
  }
  const data = nodeRowResourceMetrics(row, payload?.metrics);
  return hasResourceMetricData(data) ? data : null;
};
