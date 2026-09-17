/**
 * Shared directional graph traversal for map filtering and selection.
 * Each direction has its own visited set, so paths never switch direction.
 */

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
  for (let head = 0; head < queue.length; head += 1) {
    const nodeId = queue[head];
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
