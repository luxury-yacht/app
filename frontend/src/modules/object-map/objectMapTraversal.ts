/**
 * The object map's one rule, on the frontend: an object belongs to another
 * object's lineage if links that all point the same way connect them. The
 * backend builds each map by this rule from the seed; selection highlight, focus
 * mode, and the prune after ReplicaSet collapse apply it to what is shown. Each
 * direction has its own visited set, so paths never switch direction.
 */

import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';

type DirectionalNeighbor = { edgeId: string; neighbor: string };

export type DirectionalAdjacency = {
  outgoing: Map<string, DirectionalNeighbor[]>;
  incoming: Map<string, DirectionalNeighbor[]>;
};

const appendDirectionalNeighbor = (
  adjacency: Map<string, DirectionalNeighbor[]>,
  nodeId: string,
  neighbor: DirectionalNeighbor
): void => {
  const entries = adjacency.get(nodeId);
  if (entries) {
    entries.push(neighbor);
    return;
  }
  adjacency.set(nodeId, [neighbor]);
};

export const appendDirectionalEdge = (
  adjacency: DirectionalAdjacency,
  edgeId: string,
  source: string,
  target: string
): void => {
  appendDirectionalNeighbor(adjacency.outgoing, source, { edgeId, neighbor: target });
  appendDirectionalNeighbor(adjacency.incoming, target, { edgeId, neighbor: source });
};

const collectDirectionalReachability = (
  seedId: string,
  adjacency: Map<string, DirectionalNeighbor[]>,
  reachableNodes: Set<string>,
  reachableEdges: Set<string>
): void => {
  const visited = new Set<string>([seedId]);
  const queue: string[] = [seedId];
  for (const nodeId of queue) {
    const neighbors = adjacency.get(nodeId) ?? [];
    for (const { edgeId, neighbor } of neighbors) {
      reachableEdges.add(edgeId);
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      reachableNodes.add(neighbor);
      queue.push(neighbor);
    }
  }
};

export const collectDirectionalConnections = (seedId: string, adjacency: DirectionalAdjacency) => {
  const connectedIds = new Set<string>();
  const connectedEdgeIds = new Set<string>();
  collectDirectionalReachability(seedId, adjacency.outgoing, connectedIds, connectedEdgeIds);
  collectDirectionalReachability(seedId, adjacency.incoming, connectedIds, connectedEdgeIds);
  return { connectedIds, connectedEdgeIds };
};

const buildDirectionalAdjacency = (
  nodeIds: Set<string>,
  edges: ObjectMapEdge[]
): DirectionalAdjacency => {
  const adjacency: DirectionalAdjacency = { outgoing: new Map(), incoming: new Map() };
  edges.forEach((edge) => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target) {
      appendDirectionalEdge(adjacency, edge.id, edge.source, edge.target);
    }
  });
  return adjacency;
};

/**
 * Keeps the seed, the objects in its lineage, and every link between the kept
 * objects. Namespace maps have no seed object, so they are returned unchanged.
 */
export const filterByLineage = (
  nodes: ObjectMapNode[],
  edges: ObjectMapEdge[],
  seedId: string
): { nodes: ObjectMapNode[]; edges: ObjectMapEdge[] } => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (!nodeIds.has(seedId)) {
    return { nodes, edges };
  }
  const { connectedIds } = collectDirectionalConnections(
    seedId,
    buildDirectionalAdjacency(nodeIds, edges)
  );
  connectedIds.add(seedId);
  return {
    nodes: nodes.filter((node) => connectedIds.has(node.id)),
    edges: edges.filter((edge) => connectedIds.has(edge.source) && connectedIds.has(edge.target)),
  };
};
