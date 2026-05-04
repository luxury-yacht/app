/**
 * frontend/src/modules/object-map/objectMapDedupe.ts
 *
 * Drops edges that duplicate information already present elsewhere in
 * the graph, so the visualisation reads as a single canonical path
 * for each conceptual relationship instead of a tangle of parallel
 * lines representing the same thing.
 *
 * Two cases handled today, both around Service traffic routing:
 *
 *   1. Direct Service → Pod `selector` edges are dropped when the
 *      same Pod is reachable via the endpoint chain
 *      Service → EndpointSlice → Pod. The endpoint chain is a more
 *      faithful representation of what the Service is *actually*
 *      routing to (it reflects the endpoint controller's status, not
 *      just the spec selector). When the two diverge — a Pod that
 *      matches the selector but isn't ready, so it's excluded from
 *      the EndpointSlice — the direct selector edge survives,
 *      visibly flagging the discrepancy. That's the interesting case
 *      and worth keeping.
 *
 *   2. Service → EndpointSlice `owner` edges are dropped when a
 *      parallel `endpoint` edge exists between the same pair. The
 *      backend emits both because EndpointSlices have an
 *      ownerReferences entry pointing at the Service AND the Service
 *      reachability tracer adds a "has endpoints" link via the
 *      service-name label. They're the same relationship; "endpoint"
 *      is more semantically informative for this visualisation.
 *
 * Pure edge filter — node set is unchanged, no other side effects.
 */

import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';

const SERVICE_KIND = 'Service';
const ENDPOINTSLICE_KIND = 'EndpointSlice';

export const dedupeServiceEdges = (
  nodes: ObjectMapNode[],
  edges: ObjectMapEdge[]
): ObjectMapEdge[] => {
  const nodesById = new Map<string, ObjectMapNode>();
  nodes.forEach((node) => nodesById.set(node.id, node));

  const kindOf = (id: string): string | undefined => nodesById.get(id)?.ref.kind;

  // For each Service, the set of EndpointSlice ids it's connected to
  // via `endpoint` edges. For each EndpointSlice, the set of node ids
  // (typically Pods) reachable via its outgoing `endpoint` edges
  // (TargetRefs).
  const slicesByService = new Map<string, Set<string>>();
  const targetsBySlice = new Map<string, Set<string>>();

  edges.forEach((edge) => {
    if (edge.type !== 'endpoint') return;
    const sourceKind = kindOf(edge.source);
    const targetKind = kindOf(edge.target);
    if (sourceKind === SERVICE_KIND && targetKind === ENDPOINTSLICE_KIND) {
      let slices = slicesByService.get(edge.source);
      if (!slices) {
        slices = new Set();
        slicesByService.set(edge.source, slices);
      }
      slices.add(edge.target);
      return;
    }
    if (sourceKind === ENDPOINTSLICE_KIND) {
      let targets = targetsBySlice.get(edge.source);
      if (!targets) {
        targets = new Set();
        targetsBySlice.set(edge.source, targets);
      }
      targets.add(edge.target);
    }
  });

  // Resolve "Service routes to X via endpoint chain" — flatten across
  // all of a Service's EndpointSlices.
  const endpointChainTargets = new Map<string, Set<string>>();
  slicesByService.forEach((sliceIds, serviceId) => {
    const reachable = new Set<string>();
    sliceIds.forEach((sliceId) => {
      const targets = targetsBySlice.get(sliceId);
      if (!targets) return;
      targets.forEach((targetId) => reachable.add(targetId));
    });
    endpointChainTargets.set(serviceId, reachable);
  });

  // Pre-build the "for this (source, target) pair, what edge types
  // exist?" lookup so the owner-vs-endpoint check is O(1).
  const typesByPair = new Map<string, Set<string>>();
  edges.forEach((edge) => {
    const key = `${edge.source}|${edge.target}`;
    let types = typesByPair.get(key);
    if (!types) {
      types = new Set();
      typesByPair.set(key, types);
    }
    types.add(edge.type);
  });

  return edges.filter((edge) => {
    if (edge.type === 'selector') {
      // Drop only when source is a Service and the target is also
      // reachable via that Service's endpoint chain. Selector edges
      // from non-Services (shouldn't happen, but defensive) and
      // selector edges to Pods that aren't in the endpoint chain
      // (the divergence case) survive.
      if (kindOf(edge.source) !== SERVICE_KIND) return true;
      const reachable = endpointChainTargets.get(edge.source);
      if (reachable && reachable.has(edge.target)) {
        return false;
      }
      return true;
    }

    if (
      edge.type === 'owner' &&
      kindOf(edge.source) === SERVICE_KIND &&
      kindOf(edge.target) === ENDPOINTSLICE_KIND
    ) {
      const types = typesByPair.get(`${edge.source}|${edge.target}`);
      if (types && types.has('endpoint')) {
        return false;
      }
      return true;
    }

    return true;
  });
};
