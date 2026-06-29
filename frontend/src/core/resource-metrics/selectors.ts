import type {
  ClusterNodeMetricsSnapshotPayload,
  ClusterNodeSnapshotPayload,
  NamespaceWorkloadMetricsSnapshotPayload,
  NamespaceWorkloadSnapshotPayload,
  PodMetricsSnapshotPayload,
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

const METRIC_NO_DATA = '-';

const sameText = (left: string | null | undefined, right: string | null | undefined): boolean =>
  (left ?? '') === (right ?? '');

const sameKind = (left: string | null | undefined, right: string | null | undefined): boolean =>
  (left ?? '').toLowerCase() === (right ?? '').toLowerCase();

export const selectPodMetrics = (
  metricsPayload: PodMetricsSnapshotPayload | null | undefined,
  basePayload: PodSnapshotPayload | null | undefined,
  ref: ResolvedObjectReference
): ResourceMetricsData | null => {
  const baseRow = basePayload?.rows.find(
    (candidate) =>
      sameText(candidate.clusterId, ref.clusterId) &&
      sameText(candidate.namespace, ref.namespace) &&
      sameText(candidate.name, ref.name)
  );
  if (!baseRow) {
    return null;
  }
  const metricRow = metricsPayload?.rows.find(
    (candidate) =>
      sameText(candidate.clusterId, ref.clusterId) &&
      sameText(candidate.namespace, ref.namespace) &&
      sameText(candidate.name, ref.name)
  );
  const data = podRowResourceMetrics(
    {
      ...baseRow,
      cpuUsage: metricRow?.cpuUsage ?? METRIC_NO_DATA,
      memUsage: metricRow?.memUsage ?? METRIC_NO_DATA,
    },
    metricsPayload?.metrics
  );
  return hasResourceMetricData(data) ? data : null;
};

export const selectWorkloadMetrics = (
  metricsPayload: NamespaceWorkloadMetricsSnapshotPayload | null | undefined,
  basePayload: NamespaceWorkloadSnapshotPayload | null | undefined,
  ref: ResolvedObjectReference
): ResourceMetricsData | null => {
  const baseRow = basePayload?.rows.find(
    (candidate) =>
      sameText(candidate.clusterId, ref.clusterId) &&
      sameText(candidate.namespace, ref.namespace) &&
      sameKind(candidate.kind, ref.kind) &&
      sameText(candidate.name, ref.name)
  );
  if (!baseRow) {
    return null;
  }
  const metricRow = metricsPayload?.rows.find(
    (candidate) =>
      sameText(candidate.clusterId, ref.clusterId) &&
      sameText(candidate.namespace, ref.namespace) &&
      sameKind(candidate.kind, ref.kind) &&
      sameText(candidate.name, ref.name)
  );
  const data = workloadRowResourceMetrics(
    {
      ...baseRow,
      ready: metricRow?.ready ?? baseRow.ready,
      cpuUsage: metricRow?.cpuUsage ?? METRIC_NO_DATA,
      memUsage: metricRow?.memUsage ?? METRIC_NO_DATA,
    },
    metricsPayload?.metrics
  );
  return hasResourceMetricData(data) ? data : null;
};

export const selectNodeMetrics = (
  metricsPayload: ClusterNodeMetricsSnapshotPayload | null | undefined,
  basePayload: ClusterNodeSnapshotPayload | null | undefined,
  ref: ResolvedObjectReference
): ResourceMetricsData | null => {
  const baseRow = basePayload?.rows.find(
    (candidate) =>
      sameText(candidate.clusterId, ref.clusterId) && sameText(candidate.name, ref.name)
  );
  if (!baseRow) {
    return null;
  }
  const metricRow = metricsPayload?.rows.find(
    (candidate) =>
      sameText(candidate.clusterId, ref.clusterId) && sameText(candidate.name, ref.name)
  );
  const data = nodeRowResourceMetrics(
    {
      ...baseRow,
      cpuUsage: metricRow?.cpuUsage ?? METRIC_NO_DATA,
      memoryUsage: metricRow?.memoryUsage ?? METRIC_NO_DATA,
      podMetrics: metricRow?.podMetrics,
    },
    metricsPayload?.metrics
  );
  return hasResourceMetricData(data) ? data : null;
};
