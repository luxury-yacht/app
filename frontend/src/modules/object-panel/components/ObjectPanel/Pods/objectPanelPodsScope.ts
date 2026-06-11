/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/objectPanelPodsScope.ts
 *
 * Computes the backend pods-query scope for the object panel's Pods tab from the
 * panel's object identity. Workloads resolve to a `workload:` scope and nodes to
 * a `node:` scope; everything else (and incomplete identities) resolves to null
 * so the caller never issues a cluster-wide pods fetch.
 */
import type { PanelObjectData } from '../types';

// The kinds whose pods the panel can scope to, with the GVK used as a fallback
// when PanelObjectData omits the original-case group/version/kind. These keys
// mirror the pods tab's `onlyForKinds` (see constants.ts) plus `node`.
const WORKLOAD_SCOPE_GVK: Record<string, { group: string; version: string; kind: string }> = {
  deployment: { group: 'apps', version: 'v1', kind: 'Deployment' },
  daemonset: { group: 'apps', version: 'v1', kind: 'DaemonSet' },
  statefulset: { group: 'apps', version: 'v1', kind: 'StatefulSet' },
  job: { group: 'batch', version: 'v1', kind: 'Job' },
  replicaset: { group: 'apps', version: 'v1', kind: 'ReplicaSet' },
};

/**
 * Builds the pods-query base scope for an object panel object.
 *
 * Returns `node:<name>` for nodes, `workload:<ns>:<group>:<version>:<kind>:<name>`
 * for the supported workload kinds, or null when the object cannot be scoped
 * (missing identity, no namespace, or an unsupported kind).
 */
export function buildObjectPanelPodsScope(
  objectData: PanelObjectData | null,
  objectKind: string | null
): string | null {
  const normalizedKind = objectKind?.toLowerCase() ?? null;
  if (!objectData?.name || !normalizedKind) {
    return null;
  }

  if (normalizedKind === 'node') {
    return `node:${objectData.name}`;
  }

  const workloadNamespace = objectData.namespace?.trim();
  // Prefer the original-case Kind/group/version from PanelObjectData; fall back
  // to the GVK map only when the data source didn't provide them.
  const fallbackGVK = WORKLOAD_SCOPE_GVK[normalizedKind];
  if (workloadNamespace && fallbackGVK) {
    const workloadKindSegment = objectData.kind ?? fallbackGVK.kind;
    const workloadGroup = objectData.group ?? fallbackGVK.group;
    const workloadVersion = objectData.version ?? fallbackGVK.version;
    if (!workloadVersion || !workloadKindSegment) {
      return null;
    }
    return `workload:${workloadNamespace}:${workloadGroup}:${workloadVersion}:${workloadKindSegment}:${objectData.name}`;
  }

  return null;
}
