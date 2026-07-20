import type { NamespaceMetric, NamespaceSummary, ResourceRef } from '@/core/refresh/types';

export type NamespaceSummaryWithMetrics = NamespaceSummary & {
  cpuUsageMilli?: number;
  memoryUsageBytes?: number;
};

const identityKey = (ref: ResourceRef): string =>
  [ref.clusterId, ref.group, ref.version, ref.kind, ref.namespace ?? '', ref.name ?? ''].join('\0');

export const joinNamespaceMetrics = (
  namespaces: readonly NamespaceSummary[],
  metrics: readonly NamespaceMetric[] | null | undefined
): NamespaceSummaryWithMetrics[] => {
  if (!metrics || metrics.length === 0) {
    return namespaces.slice();
  }
  const metricsByIdentity = new Map(
    metrics.map((metric) => [identityKey(metric.ref), metric] as const)
  );

  return namespaces.map((namespace) => {
    const metric = metricsByIdentity.get(identityKey(namespace.ref));
    if (!metric) {
      return namespace;
    }
    return {
      ...namespace,
      cpuUsageMilli: metric.cpuUsageMilli,
      memoryUsageBytes: metric.memoryUsageBytes,
    };
  });
};
