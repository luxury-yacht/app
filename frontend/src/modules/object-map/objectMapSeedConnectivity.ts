/**
 * frontend/src/modules/object-map/objectMapSeedConnectivity.ts
 *
 * Drops objects the user's view controls have cut off from the seed. The
 * backend decides which objects belong in the map; hiding collapsed
 * ReplicaSets can still strand an object that was reachable only through them
 * (for example a ConfigMap an old pod template referenced). Connectivity here
 * ignores edge direction because the backend graph's own membership does.
 */

import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';

export interface SeedConnectivityResult {
  nodes: ObjectMapNode[];
  edges: ObjectMapEdge[];
}

const buildUndirectedAdjacency = (
  nodeIds: Set<string>,
  edges: ObjectMapEdge[]
): Map<string, string[]> => {
  const adjacency = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const neighbors = adjacency.get(from);
    if (neighbors) {
      neighbors.push(to);
    } else {
      adjacency.set(from, [to]);
    }
  };
  edges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) {
      return;
    }
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  });
  return adjacency;
};

const collectConnectedIds = (seedId: string, adjacency: Map<string, string[]>): Set<string> => {
  const connected = new Set<string>([seedId]);
  const queue = [seedId];
  for (const nodeId of queue) {
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (!connected.has(neighbor)) {
        connected.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return connected;
};

export const filterBySeedConnectivity = (
  nodes: ObjectMapNode[],
  edges: ObjectMapEdge[],
  seedId: string
): SeedConnectivityResult => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  // Namespace maps have no seed object; every object they hold belongs.
  if (!nodeIds.has(seedId)) {
    return { nodes, edges };
  }
  const connected = collectConnectedIds(seedId, buildUndirectedAdjacency(nodeIds, edges));
  return {
    nodes: nodes.filter((node) => connected.has(node.id)),
    edges: edges.filter((edge) => connected.has(edge.source) && connected.has(edge.target)),
  };
};
