/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/objectPanelPodsScope.ts
 *
 * Computes the pods-query selector for the object panel's Pods tab from the
 * panel's object identity. Workloads resolve to a workload selector and nodes to
 * a node selector; everything else (and incomplete identities) resolves to null
 * so the caller never issues a cluster-wide pods fetch.
 */
import type { ScopeSelector } from '@/core/refresh/scopeSelector';
import type { PanelObjectData } from '../types';

// These keys mirror the pods tab's `onlyForKinds` (see constants.ts) plus `node`.
const WORKLOAD_SCOPE_KINDS = new Set([
  'deployment',
  'daemonset',
  'statefulset',
  'job',
  'replicaset',
]);

/**
 * Builds the pods-query base selector for an object panel object: the node
 * selector for nodes, the workload selector for the supported workload kinds, or
 * null when the object cannot be scoped (missing identity, no namespace, or an
 * unsupported kind).
 */
export function buildObjectPanelPodsSelector(
  objectData: PanelObjectData | null,
  objectKind: string | null
): ScopeSelector | null {
  const normalizedKind = objectKind?.trim().toLowerCase() ?? null;
  if (!objectData || !normalizedKind) {
    return null;
  }
  const objectName = objectData.name?.trim();
  if (!objectName) {
    return null;
  }

  if (normalizedKind === 'node') {
    return { kind: 'node', node: objectName };
  }

  const workloadNamespace = objectData.namespace?.trim();
  if (workloadNamespace && WORKLOAD_SCOPE_KINDS.has(normalizedKind)) {
    const kind = objectData.kind?.trim();
    const group = objectData.group?.trim();
    const version = objectData.version?.trim();
    if (!group || !version || !kind) {
      return null;
    }
    return {
      kind: 'workload',
      object: { namespace: workloadNamespace, group, version, kind, name: objectName },
    };
  }

  return null;
}
