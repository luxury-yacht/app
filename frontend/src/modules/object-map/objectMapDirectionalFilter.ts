/**
 * frontend/src/modules/object-map/objectMapDirectionalFilter.ts
 *
 * Restricts the rendered node set to "things directionally connected
 * to the seed". Two independent BFSs from the seed:
 *
 *   - Forward chain: walk only outgoing edges.
 *   - Backward chain: walk only incoming edges.
 *
 * A node is kept if it's reachable in at least one of those pure
 * directions; edges are kept only if they were traversed during one
 * of the BFSs. Mixed-direction paths are excluded — e.g., from a
 * Node seed walking backward to a Pod, we do NOT then walk forward
 * from that Pod to its ConfigMap, because that would mean the Pod
 * was entered backward and then expanded forward.
 *
 * Why this lives on the frontend: the backend's BFS still walks
 * bidirectionally for "two-way" edge types (owner/selector/endpoint/
 * routes/scales), so a hub-kind seed (Node, PV, ServiceAccount, etc.)
 * gets a much larger snapshot than the user actually wants. This
 * filter post-processes the snapshot to enforce directional purity
 * without requiring a backend change. The same logic could be
 * pushed to the backend later for bandwidth efficiency — see the
 * object-map workflow docs.
 */

import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';
import {
  appendDirectionalEdge,
  collectDirectionalConnections,
  type DirectionalAdjacency,
} from './objectMapTraversal';

export interface DirectionalFilterResult {
  nodes: ObjectMapNode[];
  edges: ObjectMapEdge[];
}

const buildDirectionalAdjacency = (
  nodes: ObjectMapNode[],
  edges: ObjectMapEdge[]
): DirectionalAdjacency => {
  const validIds = new Set(nodes.map((node) => node.id));
  const adjacency: DirectionalAdjacency = { outgoing: new Map(), incoming: new Map() };

  edges.forEach((edge) => {
    if (!validIds.has(edge.source) || !validIds.has(edge.target) || edge.source === edge.target) {
      return;
    }
    appendDirectionalEdge(adjacency, edge.id, edge.source, edge.target);
  });

  return adjacency;
};

export const filterByDirectionalReachability = (
  nodes: ObjectMapNode[],
  edges: ObjectMapEdge[],
  seedId: string
): DirectionalFilterResult => {
  // Defensive — if seed isn't in the payload (shouldn't happen, but
  // possible during a snapshot/refresh race), keep the input as-is.
  if (!nodes.some((node) => node.id === seedId)) {
    return { nodes, edges };
  }

  const adjacency = buildDirectionalAdjacency(nodes, edges);
  const { connectedIds, connectedEdgeIds } = collectDirectionalConnections(seedId, adjacency);
  connectedIds.add(seedId);

  return {
    nodes: nodes.filter((n) => connectedIds.has(n.id)),
    edges: edges.filter((e) => connectedEdgeIds.has(e.id)),
  };
};
