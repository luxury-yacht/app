import { parseApiVersion } from '@shared/constants/builtinGroupVersions';
import { resourceLinkToObjectReference } from '@shared/utils/resourceLinkIdentity';
import type { PodSnapshotEntry } from '@/core/refresh/types';

// Pod rows carry the resolved controller's API version, including custom owners.
// Missing identity (including the backend's None sentinel) stays display-only.
export const podOwnerReference = (pod: PodSnapshotEntry, clusterName?: string | null) => {
  const { group, version } = parseApiVersion(pod.ownerApiVersion);
  return resourceLinkToObjectReference(
    {
      ref: {
        clusterId: pod.ref.clusterId,
        namespace: pod.ref.namespace,
        group: group ?? '',
        version: version ?? '',
        kind: pod.ownerKind,
        name: pod.ownerName,
      },
    },
    clusterName
  );
};

// Keep the first spelling of a namespace while deduplicating within each exact cluster.
export const podNamespacePermissionTargets = (
  pods: readonly PodSnapshotEntry[],
  fallbackClusterId?: string | null
): Array<{ namespace: string; clusterId: string }> => {
  const seen = new Set<string>();
  const targets: Array<{ namespace: string; clusterId: string }> = [];
  for (const pod of pods) {
    const namespace = pod.ref.namespace?.trim();
    const clusterId = pod.ref.clusterId?.trim() || fallbackClusterId?.trim();
    if (!namespace || !clusterId) {
      continue;
    }
    const key = `${clusterId}|${namespace.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      targets.push({ namespace, clusterId });
    }
  }
  return targets;
};
