import type { PositionedEdge } from './objectMapLayout';
import type { ObjectMapSelectionState } from './objectMapRendererTypes';

const EMPTY_SELECTION: ObjectMapSelectionState = {
  activeId: null,
  connectedIds: new Set(),
  connectedEdgeIds: new Set(),
};

export const computeObjectMapSelectionState = (
  edges: PositionedEdge[],
  activeNodeId: string | null
): ObjectMapSelectionState => {
  if (activeNodeId === null) return EMPTY_SELECTION;

  const outgoing = new Map<string, Array<{ edgeId: string; neighbor: string }>>();
  const incoming = new Map<string, Array<{ edgeId: string; neighbor: string }>>();
  edges.forEach((edge) => {
    let outs = outgoing.get(edge.sourceId);
    if (!outs) {
      outs = [];
      outgoing.set(edge.sourceId, outs);
    }
    outs.push({ edgeId: edge.id, neighbor: edge.targetId });

    let ins = incoming.get(edge.targetId);
    if (!ins) {
      ins = [];
      incoming.set(edge.targetId, ins);
    }
    ins.push({ edgeId: edge.id, neighbor: edge.sourceId });
  });

  const connectedIds = new Set<string>();
  const connectedEdgeIds = new Set<string>();

  const walk = (
    adjacency: Map<string, Array<{ edgeId: string; neighbor: string }>>,
    visited: Set<string>
  ): void => {
    const queue: string[] = [activeNodeId];
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      const adjacent = adjacency.get(current);
      if (!adjacent) continue;
      for (const { edgeId, neighbor } of adjacent) {
        connectedEdgeIds.add(edgeId);
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        connectedIds.add(neighbor);
        queue.push(neighbor);
      }
    }
  };

  walk(outgoing, new Set([activeNodeId]));
  walk(incoming, new Set([activeNodeId]));

  return { activeId: activeNodeId, connectedIds, connectedEdgeIds };
};
