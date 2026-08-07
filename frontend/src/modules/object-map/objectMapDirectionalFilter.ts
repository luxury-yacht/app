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

export interface DirectionalFilterResult {
  nodes: ObjectMapNode[];
  edges: ObjectMapEdge[];
}

type DirectionalNeighbor = { edgeId: string; neighbor: string };

type DirectionalAdjacency = {
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

const buildDirectionalAdjacency = (
  nodes: ObjectMapNode[],
  edges: ObjectMapEdge[]
): DirectionalAdjacency => {
  const validIds = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, DirectionalNeighbor[]>();
  const incoming = new Map<string, DirectionalNeighbor[]>();

  edges.forEach((edge) => {
    if (!validIds.has(edge.source) || !validIds.has(edge.target) || edge.source === edge.target) {
      return;
    }
    appendDirectionalNeighbor(outgoing, edge.source, {
      edgeId: edge.id,
      neighbor: edge.target,
    });
    appendDirectionalNeighbor(incoming, edge.target, {
      edgeId: edge.id,
      neighbor: edge.source,
    });
  });

  return { outgoing, incoming };
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

  const { outgoing, incoming } = buildDirectionalAdjacency(nodes, edges);

  const reachableNodes = new Set<string>([seedId]);
  const reachableEdges = new Set<string>();

  // Forward BFS — walk outgoing edges only. Nodes reached this way
  // are the seed's descendants/dependencies; we only continue along
  // their outgoing edges, never their incoming.
  collectDirectionalReachability(seedId, outgoing, reachableNodes, reachableEdges);

  // Backward BFS — walk incoming edges only. Nodes reached this way
  // are the seed's ancestors/consumers; from each we only continue
  // backward, never forward.
  collectDirectionalReachability(seedId, incoming, reachableNodes, reachableEdges);

  return {
    nodes: nodes.filter((n) => reachableNodes.has(n.id)),
    edges: edges.filter((e) => reachableEdges.has(e.id)),
  };
};
