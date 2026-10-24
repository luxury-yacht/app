/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/objectPanelPodsScope.ts
 *
 * Computes the pods-query selector for the object panel's Pods tab from the
 * panel's object identity and its kind's pods facet: owners select by workload,
 * nodes by node name. Everything else (and incomplete identities) resolves to
 * null so the caller never issues a cluster-wide pods fetch.
 */
import { lookupKindFacets } from '@shared/kinds/kindFacets';
import type { ScopeSelector } from '@/core/refresh/scopeSelector';
import type { PanelObjectData } from '../types';

/**
 * Builds the pods-query base selector for an object panel object: the node
 * selector or the workload selector its kind's pods facet names, or null when
 * the object cannot be scoped (incomplete identity, no namespace for a workload,
 * or a kind without a Pods tab).
 */
export function buildObjectPanelPodsSelector(
  objectData: PanelObjectData | null
): ScopeSelector | null {
  const facets = lookupKindFacets(objectData);
  const objectName = objectData?.name?.trim();
  if (!facets || !objectName) {
    return null;
  }
  if (facets.panel.pods === 'node') {
    return { kind: 'node', node: objectName };
  }
  const namespace = objectData?.namespace?.trim();
  if (facets.panel.pods !== 'owner' || !namespace) {
    return null;
  }
  return {
    kind: 'workload',
    // The backend matches the owner's kind exactly, so send the canonical spelling.
    object: {
      namespace,
      group: facets.group,
      version: objectData?.version?.trim() ?? '',
      kind: facets.kind,
      name: objectName,
    },
  };
}
