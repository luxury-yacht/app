import { parseClusterScope } from './clusterScope';
import type { Snapshot, SnapshotStats } from './client';
import { getScopedDomainState, setScopedDomainState } from './store';
import type {
  ClusterNodeSnapshotPayload,
  DomainPayloadMap,
  NamespaceWorkloadSnapshotPayload,
  PodSnapshotPayload,
  RefreshDomain,
} from './types';
import { mergeWorkloadMetricRows } from './snapshotMerge';

type ApplyMetricsSnapshotOptions<K extends RefreshDomain> = {
  domain: K;
  snapshot: Snapshot<DomainPayloadMap[K]>;
  etag: string | undefined;
  isManual: boolean;
  scope?: string;
  clearRefreshError: (domain: RefreshDomain, scope?: string) => void;
};

const updateStats = (stats: SnapshotStats | null, count: number): SnapshotStats | null => {
  if (!stats) {
    return null;
  }
  return { ...stats, itemCount: count };
};

export function applyMetricsSnapshot<K extends RefreshDomain>({
  domain,
  snapshot,
  etag,
  isManual,
  scope,
  clearRefreshError,
}: ApplyMetricsSnapshotOptions<K>): boolean {
  // Metrics-only refreshes update usage fields without replacing stream-driven rows.
  const now = Date.now();
  const resolvedScope = scope ?? snapshot.scope ?? '';
  const parsedScope = parseClusterScope(resolvedScope);
  // parseClusterScope always returns a string clusterId (empty when the
  // scope carries no cluster prefix); no fallback needed.
  const clusterId = parsedScope.clusterId;

  if (domain === 'pods') {
    if (!scope) {
      return false;
    }
    const previous = getScopedDomainState('pods', scope);
    if (!previous.data) {
      return false;
    }
    const payload = snapshot.payload as PodSnapshotPayload;
    const incomingByKey = new Map(
      payload.pods.map((pod) => [
        `${pod.clusterId ?? clusterId}::${pod.namespace}::${pod.name}`,
        pod,
      ])
    );
    const existingPods = previous.data.pods ?? [];
    const mappedPods = existingPods.map((existing) => {
      const key = `${existing.clusterId ?? clusterId}::${existing.namespace}::${existing.name}`;
      const incoming = incomingByKey.get(key);
      if (!incoming) {
        return existing;
      }
      const nextCpuUsage = incoming.cpuUsage ?? existing.cpuUsage;
      const nextMemUsage = incoming.memUsage ?? existing.memUsage;
      if (nextCpuUsage === existing.cpuUsage && nextMemUsage === existing.memUsage) {
        return existing;
      }
      return {
        ...existing,
        cpuUsage: nextCpuUsage,
        memUsage: nextMemUsage,
      };
    });
    const nextPods = mappedPods.every((pod, index) => pod === existingPods[index])
      ? existingPods
      : mappedPods;
    const nextMetrics = (() => {
      const incomingMetrics = payload.metrics;
      const previousMetrics = previous.data.metrics;
      if (!incomingMetrics) {
        return previousMetrics;
      }
      if (!previousMetrics) {
        return incomingMetrics;
      }
      return incomingMetrics.stale === previousMetrics.stale &&
        incomingMetrics.lastError === previousMetrics.lastError &&
        incomingMetrics.collectedAt === previousMetrics.collectedAt &&
        incomingMetrics.consecutiveFailures === previousMetrics.consecutiveFailures &&
        incomingMetrics.successCount === previousMetrics.successCount &&
        incomingMetrics.failureCount === previousMetrics.failureCount
        ? previousMetrics
        : incomingMetrics;
    })();
    const nextPayload: PodSnapshotPayload =
      nextPods === existingPods && nextMetrics === previous.data.metrics
        ? previous.data
        : {
            ...previous.data,
            pods: nextPods,
            metrics: nextMetrics,
          };
    setScopedDomainState('pods', scope, (prev) => ({
      ...prev,
      status: 'ready',
      data: nextPayload,
      stats: updateStats(prev.stats ?? snapshot.stats ?? null, nextPods.length),
      version: snapshot.version,
      checksum: snapshot.checksum,
      etag: etag ?? snapshot.checksum ?? prev.etag,
      lastUpdated: now,
      lastManualRefresh: isManual ? now : prev.lastManualRefresh,
      lastAutoRefresh: !isManual ? now : prev.lastAutoRefresh,
      error: null,
      isManual,
      scope,
    }));
    clearRefreshError(domain, scope);
    return true;
  }

  if (domain === 'namespace-workloads') {
    if (!scope) {
      return false;
    }
    const previous = getScopedDomainState('namespace-workloads', scope);
    if (!previous.data) {
      return false;
    }
    const payload = snapshot.payload as NamespaceWorkloadSnapshotPayload;
    const existingWorkloads = previous.data.workloads ?? [];
    const nextWorkloads = mergeWorkloadMetricRows(
      existingWorkloads,
      payload.workloads ?? [],
      clusterId
    );
    const nextPayload: NamespaceWorkloadSnapshotPayload =
      nextWorkloads === existingWorkloads
        ? previous.data
        : {
            ...previous.data,
            workloads: nextWorkloads,
          };
    setScopedDomainState('namespace-workloads', scope, (prev) => ({
      ...prev,
      status: 'ready',
      data: nextPayload,
      stats: updateStats(prev.stats ?? snapshot.stats ?? null, nextWorkloads.length),
      version: snapshot.version,
      checksum: snapshot.checksum,
      etag: etag ?? snapshot.checksum ?? prev.etag,
      lastUpdated: now,
      lastManualRefresh: isManual ? now : prev.lastManualRefresh,
      lastAutoRefresh: !isManual ? now : prev.lastAutoRefresh,
      error: null,
      isManual,
      scope,
    }));
    clearRefreshError(domain, scope || undefined);
    return true;
  }

  if (domain === 'nodes') {
    if (!scope) {
      return false;
    }
    const previous = getScopedDomainState('nodes', scope);
    if (!previous.data) {
      return false;
    }
    const payload = snapshot.payload as ClusterNodeSnapshotPayload;
    const incomingByKey = new Map(
      payload.nodes.map((node) => [`${node.clusterId ?? clusterId}::${node.name}`, node])
    );
    const existingNodes = previous.data.nodes ?? [];
    const nextNodes = existingNodes.map((existing) => {
      const key = `${existing.clusterId ?? clusterId}::${existing.name}`;
      const incoming = incomingByKey.get(key);
      if (!incoming) {
        return existing;
      }
      return {
        ...existing,
        cpuUsage: incoming.cpuUsage ?? existing.cpuUsage,
        memoryUsage: incoming.memoryUsage ?? existing.memoryUsage,
        podMetrics: incoming.podMetrics ?? existing.podMetrics,
      };
    });
    const nextPayload: ClusterNodeSnapshotPayload = {
      ...previous.data,
      nodes: nextNodes,
      metrics: payload.metrics ?? previous.data.metrics,
      metricsByCluster: payload.metricsByCluster ?? previous.data.metricsByCluster,
    };
    setScopedDomainState('nodes', scope, (prev) => ({
      ...prev,
      status: 'ready',
      data: nextPayload,
      stats: updateStats(prev.stats ?? snapshot.stats ?? null, nextNodes.length),
      version: snapshot.version,
      checksum: snapshot.checksum,
      etag: etag ?? snapshot.checksum ?? prev.etag,
      lastUpdated: now,
      lastManualRefresh: isManual ? now : prev.lastManualRefresh,
      lastAutoRefresh: !isManual ? now : prev.lastAutoRefresh,
      error: null,
      isManual,
      scope,
    }));
    clearRefreshError(domain, scope || undefined);
    return true;
  }

  return false;
}
