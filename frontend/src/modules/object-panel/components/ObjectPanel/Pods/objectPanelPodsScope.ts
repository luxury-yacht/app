/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/objectPanelPodsScope.ts
 *
 * Computes the backend pods-query scope for the object panel's Pods tab from the
 * panel's object identity. Workloads resolve to a `workload:` scope and nodes to
 * a `node:` scope; everything else (and incomplete identities) resolves to null
 * so the caller never issues a cluster-wide pods fetch.
 */
import { TABS } from '../constants';
import type { PanelObjectData } from '../types';

const PODS_TAB_KINDS: ReadonlySet<string> = new Set(TABS.PODS.onlyForKinds);

/** Whether objects of this kind have a Pods tab in the object panel. */
export const objectKindHasPodsTab = (kind: string): boolean =>
  PODS_TAB_KINDS.has(kind.toLowerCase());

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
  const normalizedKind = objectKind?.trim().toLowerCase() ?? null;
  if (!objectData || !normalizedKind) {
    return null;
  }
  const objectName = objectData.name?.trim();
  if (!objectName) {
    return null;
  }

  if (normalizedKind === 'node') {
    return `node:${objectName}`;
  }

  const workloadNamespace = objectData.namespace?.trim();
  if (workloadNamespace && PODS_TAB_KINDS.has(normalizedKind)) {
    const workloadKindSegment = objectData.kind?.trim();
    const workloadGroup = objectData.group?.trim();
    const workloadVersion = objectData.version?.trim();
    if (!workloadGroup || !workloadVersion || !workloadKindSegment) {
      return null;
    }
    return `workload:${workloadNamespace}:${workloadGroup}:${workloadVersion}:${workloadKindSegment}:${objectName}`;
  }

  return null;
}
