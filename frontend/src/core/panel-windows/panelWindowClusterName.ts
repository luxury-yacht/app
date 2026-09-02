export const resolvePanelWindowClusterName = (
  clusters: ReadonlyMap<string, { clusterName: string }>,
  clusterId: string
): string => clusters.get(clusterId)?.clusterName || clusterId;
