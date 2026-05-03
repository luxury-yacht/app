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
 * docs/development handoff note.
 */

import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';

export interface DirectionalFilterResult {
  nodes: ObjectMapNode[];
  edges: ObjectMapEdge[];
}

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

  const validIds = new Set(nodes.map((n) => n.id));
  const outgoing = new Map<string, Array<{ edgeId: string; neighbor: string }>>();
  const incoming = new Map<string, Array<{ edgeId: string; neighbor: string }>>();
  edges.forEach((edge) => {
    if (!validIds.has(edge.source) || !validIds.has(edge.target)) return;
    if (edge.source === edge.target) return;
    let outs = outgoing.get(edge.source);
    if (!outs) {
      outs = [];
      outgoing.set(edge.source, outs);
    }
    outs.push({ edgeId: edge.id, neighbor: edge.target });
    let ins = incoming.get(edge.target);
    if (!ins) {
      ins = [];
      incoming.set(edge.target, ins);
    }
    ins.push({ edgeId: edge.id, neighbor: edge.source });
  });

  const reachableNodes = new Set<string>([seedId]);
  const reachableEdges = new Set<string>();

  // Forward BFS — walk outgoing edges only. Nodes reached this way
  // are the seed's descendants/dependencies; we only continue along
  // their outgoing edges, never their incoming.
  {
    const visited = new Set<string>([seedId]);
    const queue: string[] = [seedId];
    while (queue.length > 0) {
      const u = queue.shift()!;
      const outs = outgoing.get(u);
      if (!outs) continue;
      for (const { edgeId, neighbor } of outs) {
        reachableEdges.add(edgeId);
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        reachableNodes.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // Backward BFS — walk incoming edges only. Nodes reached this way
  // are the seed's ancestors/consumers; from each we only continue
  // backward, never forward.
  {
    const visited = new Set<string>([seedId]);
    const queue: string[] = [seedId];
    while (queue.length > 0) {
      const u = queue.shift()!;
      const ins = incoming.get(u);
      if (!ins) continue;
      for (const { edgeId, neighbor } of ins) {
        reachableEdges.add(edgeId);
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        reachableNodes.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return {
    nodes: nodes.filter((n) => reachableNodes.has(n.id)),
    edges: edges.filter((e) => reachableEdges.has(e.id)),
  };
};
