/**
 * The object map's one rule, on the frontend: an object belongs to another
 * object's lineage if links that all point the same way connect them, and the
 * lineage keeps every link between its objects. The backend builds each map by
 * this rule from the seed; selection highlight and the prune after ReplicaSet
 * collapse apply it to what is shown. Each direction has its own
 * visited set, so paths never switch direction.
 */

import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';

type LineageEdge = Pick<ObjectMapEdge, 'id' | 'source' | 'target'>;

type DirectionalAdjacency = {
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
};

const appendNeighbor = (
  adjacency: Map<string, string[]>,
  nodeId: string,
  neighbor: string
): void => {
  const entries = adjacency.get(nodeId);
  if (entries) {
    entries.push(neighbor);
    return;
  }
  adjacency.set(nodeId, [neighbor]);
};

const buildDirectionalAdjacency = (edges: LineageEdge[]): DirectionalAdjacency => {
  const adjacency: DirectionalAdjacency = { outgoing: new Map(), incoming: new Map() };
  edges.forEach((edge) => {
    appendNeighbor(adjacency.outgoing, edge.source, edge.target);
    appendNeighbor(adjacency.incoming, edge.target, edge.source);
  });
  return adjacency;
};

const collectDirectionalReachability = (
  seedId: string,
  adjacency: Map<string, string[]>,
  reachableNodes: Set<string>
): void => {
  const visited = new Set<string>([seedId]);
  const queue: string[] = [seedId];
  for (const nodeId of queue) {
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      reachableNodes.add(neighbor);
      queue.push(neighbor);
    }
  }
};

/**
 * Returns the seed's lineage: the seed, the objects same-direction links
 * connect to it, and every link whose two ends are both in the lineage,
 * including links no path from the seed walks.
 */
export const collectLineage = (
  seedId: string,
  edges: LineageEdge[]
): { nodeIds: Set<string>; edgeIds: Set<string> } => {
  const adjacency = buildDirectionalAdjacency(edges);
  const nodeIds = new Set<string>([seedId]);
  collectDirectionalReachability(seedId, adjacency.outgoing, nodeIds);
  collectDirectionalReachability(seedId, adjacency.incoming, nodeIds);
  const edgeIds = new Set<string>();
  edges.forEach((edge) => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      edgeIds.add(edge.id);
    }
  });
  return { nodeIds, edgeIds };
};

/**
 * Keeps the seed's lineage. Namespace maps have no seed object, so they are
 * returned unchanged.
 */
export const filterByLineage = (
  nodes: ObjectMapNode[],
  edges: ObjectMapEdge[],
  seedId: string
): { nodes: ObjectMapNode[]; edges: ObjectMapEdge[] } => {
  const presentIds = new Set(nodes.map((node) => node.id));
  if (!presentIds.has(seedId)) {
    return { nodes, edges };
  }
  const { nodeIds, edgeIds } = collectLineage(
    seedId,
    edges.filter((edge) => presentIds.has(edge.source) && presentIds.has(edge.target))
  );
  return {
    nodes: nodes.filter((node) => nodeIds.has(node.id)),
    edges: edges.filter((edge) => edgeIds.has(edge.id)),
  };
};
