/**
 * frontend/src/modules/object-map/objectMapKindFilter.ts
 *
 * Applies kind filters to object-map layouts while preserving transitive
 * relationships through filtered objects.
 */

import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';

export const FILTERED_PATH_EDGE_TYPE = 'filtered-path';

export interface ObjectMapFilteredPathNode {
  id: string;
  ref: ObjectMapNode['ref'];
  filtered: boolean;
}

export interface ObjectMapFilteredPathRelationship {
  type: string;
  label: string;
}

export interface ObjectMapFilteredPath {
  nodes: ObjectMapFilteredPathNode[];
  relationships: ObjectMapFilteredPathRelationship[];
  additionalPathCount: number;
}

export type ObjectMapLayoutEdge = ObjectMapEdge & {
  filteredPath?: ObjectMapFilteredPath;
};

interface CandidatePath {
  nodes: string[];
  edges: ObjectMapEdge[];
}

interface ContractedPath {
  count: number;
  path: CandidatePath;
}

const comparePath = (a: CandidatePath, b: CandidatePath): number => {
  if (a.edges.length !== b.edges.length) {
    return a.edges.length - b.edges.length;
  }
  return a.nodes.join('\0').localeCompare(b.nodes.join('\0'));
};

const toFilteredPath = (
  path: CandidatePath,
  count: number,
  nodeById: Map<string, ObjectMapNode>,
  visibleNodeIds: Set<string>
): ObjectMapFilteredPath | null => {
  const nodes = path.nodes
    .map((id) => {
      const node = nodeById.get(id);
      if (!node) {
        return null;
      }
      return {
        id,
        ref: node.ref,
        filtered: !visibleNodeIds.has(id),
      };
    })
    .filter((node): node is ObjectMapFilteredPathNode => Boolean(node));
  if (nodes.length !== path.nodes.length) {
    return null;
  }
  return {
    nodes,
    relationships: path.edges.map((edge) => ({ type: edge.type, label: edge.label })),
    additionalPathCount: Math.max(0, count - 1),
  };
};

export const contractObjectMapKindFilter = (
  nodes: ObjectMapNode[],
  edges: ObjectMapLayoutEdge[],
  selectedKindSet: Set<string>
): { nodes: ObjectMapNode[]; edges: ObjectMapLayoutEdge[] } => {
  if (selectedKindSet.size === 0) {
    return { nodes, edges };
  }

  const visibleNodes = nodes.filter((node) => selectedKindSet.has(node.ref.kind));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, ObjectMapLayoutEdge[]>();

  edges.forEach((edge) => {
    let list = outgoing.get(edge.source);
    if (!list) {
      list = [];
      outgoing.set(edge.source, list);
    }
    list.push(edge);
  });

  const visibleEdges: ObjectMapLayoutEdge[] = edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
  );
  const contracted = new Map<string, ContractedPath>();

  visibleNodes.forEach((source) => {
    const firstEdges = outgoing.get(source.id) ?? [];
    firstEdges.forEach((firstEdge) => {
      if (visibleNodeIds.has(firstEdge.target)) {
        return;
      }
      if (!nodeById.has(firstEdge.target)) {
        return;
      }

      const queue: CandidatePath[] = [
        {
          nodes: [source.id, firstEdge.target],
          edges: [firstEdge],
        },
      ];

      for (let head = 0; head < queue.length; head += 1) {
        const current = queue[head];
        const currentNodeId = current.nodes[current.nodes.length - 1];
        const nextEdges = outgoing.get(currentNodeId) ?? [];

        nextEdges.forEach((edge) => {
          if (!nodeById.has(edge.target)) {
            return;
          }
          if (current.nodes.includes(edge.target)) {
            return;
          }
          const nextPath: CandidatePath = {
            nodes: [...current.nodes, edge.target],
            edges: [...current.edges, edge],
          };

          if (visibleNodeIds.has(edge.target)) {
            const key = `${source.id}\0${edge.target}`;
            const existing = contracted.get(key);
            if (!existing) {
              contracted.set(key, { count: 1, path: nextPath });
            } else {
              existing.count += 1;
              if (comparePath(nextPath, existing.path) < 0) {
                existing.path = nextPath;
              }
            }
            return;
          }

          queue.push(nextPath);
        });
      }
    });
  });

  contracted.forEach((entry, key) => {
    const [source, target] = key.split('\0');
    const filteredPath = toFilteredPath(entry.path, entry.count, nodeById, visibleNodeIds);
    if (!filteredPath) {
      return;
    }
    visibleEdges.push({
      id: `${FILTERED_PATH_EDGE_TYPE}:${source}:${target}`,
      source,
      target,
      type: FILTERED_PATH_EDGE_TYPE,
      label: 'filtered path',
      filteredPath,
    });
  });

  return { nodes: visibleNodes, edges: visibleEdges };
};
