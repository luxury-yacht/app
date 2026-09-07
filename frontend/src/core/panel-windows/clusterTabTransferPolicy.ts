export const canMoveClusterToNewWindow = (
  clusterId: string,
  windowClusterIds: readonly string[]
): boolean => windowClusterIds.includes(clusterId);
