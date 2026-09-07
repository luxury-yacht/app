export const resolvePanelWindowClusterName = (
  clusters: ReadonlyMap<string, { clusterName: string }>,
  clusterId: string
): string => {
  const name = clusters.get(clusterId)?.clusterName;
  if (!name) {
    return clusterId;
  }
  const duplicate = Array.from(clusters).some(
    ([id, cluster]) => id !== clusterId && cluster.clusterName === name
  );
  return duplicate ? `${name} · ${clusterId}` : name;
};
