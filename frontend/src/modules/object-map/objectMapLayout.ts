/**
 * frontend/src/modules/object-map/objectMapLayout.ts
 *
 * Seed-anchored compact min-length layered layout. Four passes:
 *
 *   (1) Longest-path layering. Sugiyama-style: every node's column =
 *       max(predecessor column + 1) along directed edges. This
 *       guarantees every edge spans at least one column going strictly
 *       left-to-right (no same-column edges, no backward edges) in any
 *       acyclic graph.
 *
 *   (2) Shift so the seed sits at column 0. Anchored layout — left of
 *       the seed = ancestors and consumers, right of the seed =
 *       descendants and dependencies.
 *
 *   (3) Backward pass: pull graph "sources" (in-degree-zero nodes
 *       other than the seed) rightward to sit adjacent to their
 *       leftmost successor. Without this step, sources land at the
 *       leftmost column even when they have only one edge connecting
 *       them to the rest of the graph — e.g., a Karpenter NodeClaim
 *       that owns the Pod's Node would otherwise be many columns left
 *       of Node despite the direct owner edge between them. The
 *       no-same-column-edges guarantee from step (1) is preserved
 *       because moving a source rightward can only shorten its
 *       outgoing edges, never violate them.
 *
 *   (4) Within each column, barycenter sweeps reorder nodes so
 *       connected siblings line up across columns, dropping the
 *       overall edge-crossing count sharply.
 *
 * Edges are routed as cubic beziers between source-right and target-
 * left anchors. The same-column rightward-arc fallback is retained for
 * the rare cycle case where the topological pass can't drain all
 * nodes; cycles cause the backend BFS depth to be used as a fallback
 * column, which can collide.
 */

import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';

export const OBJECT_MAP_NODE_WIDTH = 220;
export const OBJECT_MAP_NODE_HEIGHT = 64;
export const OBJECT_MAP_COLUMN_GAP = 100;
export const OBJECT_MAP_ROW_GAP = 24;
// Extra vertical space inserted when two consecutive nodes in a
// column have different kinds. Visually groups same-kind objects so
// "all the Pods" or "all the ConfigMaps" read as a band rather than
// scattered through the column.
export const OBJECT_MAP_KIND_GROUP_GAP = 24;

const COLUMN_STRIDE = OBJECT_MAP_NODE_WIDTH + OBJECT_MAP_COLUMN_GAP;

// Number of alternating left↔right sweeps for barycenter ordering.
// Sugiyama's original suggestion is ~24, but for the small graphs we
// render here (≤ 1000 nodes per backend cap, typically dozens) four
// sweeps converge well and keep the layout cheap.
const BARYCENTER_SWEEPS = 4;

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  // Layout column relative to the seed (seed = 0; ancestors negative;
  // descendants/dependencies positive). Computed by the directional
  // layering pass — NOT the backend's BFS depth.
  column: number;
  isSeed: boolean;
  ref: ObjectMapNode['ref'];
}

export interface PositionedEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  label: string;
  tracedBy?: string;
  // Cubic bezier path string. Cross-column edges run from source-right
  // to target-left through the gutter; same-column edges arc rightward
  // (defensive fallback for the rare cycle case).
  d: string;
  // Cached midpoint for the hover label. The edge handler runs on every
  // pointer move, so we don't recompute the bezier each time.
  midX: number;
  midY: number;
  // True when the edge endpoints share a column. Should be exceedingly
  // rare under directional layering — only happens when both endpoints
  // are in a cycle the topological sort couldn't break. Kept as a
  // signal so renderers and tests can distinguish.
  sameColumn: boolean;
}

export interface ObjectMapLayout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export const computeObjectMapBounds = (
  nodes: PositionedNode[]
): { minX: number; minY: number; maxX: number; maxY: number } => {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach((node) => {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  });
  return { minX, minY, maxX, maxY };
};

const compareForColumn = (a: ObjectMapNode, b: ObjectMapNode): number => {
  if (a.ref.kind !== b.ref.kind) {
    return a.ref.kind.localeCompare(b.ref.kind);
  }
  const aNs = a.ref.namespace ?? '';
  const bNs = b.ref.namespace ?? '';
  if (aNs !== bNs) {
    return aNs.localeCompare(bNs);
  }
  return a.ref.name.localeCompare(b.ref.name);
};

/**
 * Assign each node a column index via compact min-length layered
 * layout. Three steps:
 *
 *   1. Longest-path layering (Kahn's algorithm) propagates from
 *      sources, giving each node column = max(predecessor + 1). This
 *      guarantees every edge spans at least one column.
 *   2. Shift so the seed sits at column 0.
 *   3. Pull graph sources (in-degree-zero nodes, not the seed)
 *      rightward to sit adjacent to their leftmost successor — the
 *      slack-on-the-left a source has by definition. Preserves the
 *      "every edge spans ≥ 1 column" invariant because moving a source
 *      right can only shorten its outgoing edges.
 *
 * Cycles fall back to backend BFS depth (defensive — K8s graphs are
 * normally acyclic).
 */
const computeNodeColumns = (
  nodes: ObjectMapNode[],
  edges: ObjectMapEdge[],
  seedId: string
): Map<string, number> => {
  const validIds = new Set(nodes.map((n) => n.id));
  const out = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  nodes.forEach((n) => inDegree.set(n.id, 0));

  edges.forEach((edge) => {
    if (!validIds.has(edge.source) || !validIds.has(edge.target)) return;
    if (edge.source === edge.target) return;
    let outs = out.get(edge.source);
    if (!outs) {
      outs = [];
      out.set(edge.source, outs);
    }
    outs.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  });

  // Step 1: longest-path layering. Sources start at column 0; each
  // other node lands at max(predecessor column + 1).
  const column = new Map<string, number>();
  const remaining = new Map(inDegree);
  const queue: string[] = [];
  inDegree.forEach((degree, id) => {
    if (degree === 0) {
      column.set(id, 0);
      queue.push(id);
    }
  });
  while (queue.length > 0) {
    const u = queue.shift()!;
    const cu = column.get(u)!;
    const outs = out.get(u);
    if (!outs) continue;
    for (const v of outs) {
      const cv = column.get(v);
      const candidate = cu + 1;
      if (cv === undefined || candidate > cv) {
        column.set(v, candidate);
      }
      const newRemaining = remaining.get(v)! - 1;
      remaining.set(v, newRemaining);
      if (newRemaining === 0) {
        queue.push(v);
      }
    }
  }

  // Defensive fallback for nodes the topological pass never reached
  // (cycles). K8s graphs are normally acyclic so this should not fire.
  nodes.forEach((node) => {
    if (!column.has(node.id)) {
      column.set(node.id, node.depth);
    }
  });

  // Step 2: anchor the seed at column 0.
  const seedColumn = column.get(seedId);
  if (seedColumn !== undefined && seedColumn !== 0) {
    column.forEach((value, id) => column.set(id, value - seedColumn));
  }

  // Step 3: pull each true source (in-degree zero, not the seed) right
  // to sit one column left of its leftmost successor. Doesn't violate
  // any constraint because the source has no predecessors and its
  // outgoing edges still satisfy col(target) >= col(source) + 1 after
  // the move.
  inDegree.forEach((degree, id) => {
    if (degree !== 0) return;
    if (id === seedId) return;
    const outs = out.get(id);
    if (!outs || outs.length === 0) return;
    let minSuccessorColumn = Infinity;
    for (const successor of outs) {
      const sc = column.get(successor);
      if (sc !== undefined) {
        minSuccessorColumn = Math.min(minSuccessorColumn, sc);
      }
    }
    if (minSuccessorColumn !== Infinity) {
      column.set(id, minSuccessorColumn - 1);
    }
  });

  return column;
};

const buildCrossColumnPath = (
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): string => {
  const handle = Math.max(40, Math.abs(targetX - sourceX) / 2);
  const c1x = sourceX + handle;
  const c2x = targetX - handle;
  return `M ${sourceX} ${sourceY} C ${c1x} ${sourceY}, ${c2x} ${targetY}, ${targetX} ${targetY}`;
};

const buildSameColumnPath = (
  anchorX: number,
  sourceY: number,
  targetY: number,
  arcStretch: number
): string => {
  // Both endpoints sit at the same x; bulge the bezier rightward into
  // the gutter so the line never crosses node bodies. Control points
  // pulled out by `arcStretch` produce a smooth half-loop. Only fires
  // for cycle-trapped pairs under the directional layering model.
  const c1x = anchorX + arcStretch;
  const c2x = anchorX + arcStretch;
  return `M ${anchorX} ${sourceY} C ${c1x} ${sourceY}, ${c2x} ${targetY}, ${anchorX} ${targetY}`;
};

const buildCrossColumnAdjacency = (
  edges: ObjectMapEdge[],
  columnOf: Map<string, number>
): Map<string, string[]> => {
  // We only feed cross-column edges into the barycenter sort because
  // same-column edges (cycle artifacts under the new layering) would
  // create circular constraints. Cross-column edges drive the actual
  // visual ordering anyway.
  const adj = new Map<string, string[]>();
  edges.forEach((edge) => {
    const sc = columnOf.get(edge.source);
    const tc = columnOf.get(edge.target);
    if (sc === undefined || tc === undefined || sc === tc) {
      return;
    }
    const sList = adj.get(edge.source);
    if (sList) sList.push(edge.target);
    else adj.set(edge.source, [edge.target]);
    const tList = adj.get(edge.target);
    if (tList) tList.push(edge.source);
    else adj.set(edge.target, [edge.source]);
  });
  return adj;
};

const orderColumnsByBarycenter = (
  columns: Map<number, ObjectMapNode[]>,
  adj: Map<string, string[]>,
  columnOf: Map<string, number>,
  seedColumn: number
): void => {
  const sortedColumns = Array.from(columns.keys()).sort((a, b) => a - b);
  if (sortedColumns.length <= 1) {
    return;
  }

  // Initial ordering: deterministic kind/namespace/name sort. Provides
  // a stable baseline so barycenter ties resolve the same way each run.
  sortedColumns.forEach((col) => {
    columns.get(col)!.sort(compareForColumn);
  });

  // Index lookup is recomputed each pass because column orderings mutate.
  const indexOf = (nodeId: string): number => {
    const col = columnOf.get(nodeId);
    if (col === undefined) return -1;
    return columns.get(col)!.findIndex((n) => n.id === nodeId);
  };

  const barycenter = (node: ObjectMapNode, neighborColumn: number): number => {
    const neighbors = adj.get(node.id);
    if (!neighbors || neighbors.length === 0) return Infinity;
    let sum = 0;
    let count = 0;
    for (const neighborId of neighbors) {
      if (columnOf.get(neighborId) !== neighborColumn) continue;
      const idx = indexOf(neighborId);
      if (idx < 0) continue;
      sum += idx;
      count += 1;
    }
    return count === 0 ? Infinity : sum / count;
  };

  for (let sweep = 0; sweep < BARYCENTER_SWEEPS; sweep += 1) {
    const forward = sweep % 2 === 0;
    if (forward) {
      // Left-to-right: each column ordered by barycenter of its left neighbours.
      for (let i = 1; i < sortedColumns.length; i += 1) {
        const col = columns.get(sortedColumns[i])!;
        const neighborColumn = sortedColumns[i - 1];
        col.sort((a, b) => {
          // Kind is the outermost sort key so same-kind nodes cluster
          // into a contiguous band; the position pass below adds an
          // extra gap when consecutive nodes' kinds differ. Within a
          // kind group, barycenter (then namespace/name) drives order
          // for cross-column alignment.
          if (a.ref.kind !== b.ref.kind) {
            return a.ref.kind.localeCompare(b.ref.kind);
          }
          const ba = barycenter(a, neighborColumn);
          const bb = barycenter(b, neighborColumn);
          if (ba === Infinity && bb === Infinity) return compareForColumn(a, b);
          if (ba === Infinity) return 1;
          if (bb === Infinity) return -1;
          return ba - bb || compareForColumn(a, b);
        });
      }
    } else {
      // Right-to-left: skip the seed column — it pivots the layout and
      // only contains the seed (plus any unrelated nodes that happen to
      // share its column).
      for (let i = sortedColumns.length - 2; i >= 0; i -= 1) {
        if (sortedColumns[i] === seedColumn) continue;
        const col = columns.get(sortedColumns[i])!;
        const neighborColumn = sortedColumns[i + 1];
        col.sort((a, b) => {
          // Kind is the outermost sort key so same-kind nodes cluster
          // into a contiguous band; the position pass below adds an
          // extra gap when consecutive nodes' kinds differ. Within a
          // kind group, barycenter (then namespace/name) drives order
          // for cross-column alignment.
          if (a.ref.kind !== b.ref.kind) {
            return a.ref.kind.localeCompare(b.ref.kind);
          }
          const ba = barycenter(a, neighborColumn);
          const bb = barycenter(b, neighborColumn);
          if (ba === Infinity && bb === Infinity) return compareForColumn(a, b);
          if (ba === Infinity) return 1;
          if (bb === Infinity) return -1;
          return ba - bb || compareForColumn(a, b);
        });
      }
    }
  }
};

export const computeObjectMapLayout = (
  nodes: ObjectMapNode[],
  edges: ObjectMapEdge[],
  seedId: string
): ObjectMapLayout => {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  }

  const columnOf = computeNodeColumns(nodes, edges, seedId);
  const columns = new Map<number, ObjectMapNode[]>();
  nodes.forEach((node) => {
    const col = columnOf.get(node.id) ?? 0;
    const list = columns.get(col);
    if (list) list.push(node);
    else columns.set(col, [node]);
  });

  const seedColumn = columnOf.get(seedId) ?? 0;
  const adj = buildCrossColumnAdjacency(edges, columnOf);
  orderColumnsByBarycenter(columns, adj, columnOf, seedColumn);

  const positioned = new Map<string, PositionedNode>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  Array.from(columns.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([column, columnNodes]) => {
      const columnX = column * COLUMN_STRIDE;

      // Pre-walk to compute the total column height with extra gaps
      // inserted between kind transitions, so we can centre the column
      // around y=0 after accounting for the larger inter-group spacing.
      let totalHeight = 0;
      columnNodes.forEach((node, index) => {
        if (index > 0) {
          const sameKind = columnNodes[index - 1].ref.kind === node.ref.kind;
          totalHeight += sameKind
            ? OBJECT_MAP_ROW_GAP
            : OBJECT_MAP_ROW_GAP + OBJECT_MAP_KIND_GROUP_GAP;
        }
        totalHeight += OBJECT_MAP_NODE_HEIGHT;
      });

      let y = -totalHeight / 2;
      columnNodes.forEach((node, index) => {
        if (index > 0) {
          const sameKind = columnNodes[index - 1].ref.kind === node.ref.kind;
          const gap = sameKind
            ? OBJECT_MAP_ROW_GAP
            : OBJECT_MAP_ROW_GAP + OBJECT_MAP_KIND_GROUP_GAP;
          y += OBJECT_MAP_NODE_HEIGHT + gap;
        }
        positioned.set(node.id, {
          id: node.id,
          x: columnX,
          y,
          width: OBJECT_MAP_NODE_WIDTH,
          height: OBJECT_MAP_NODE_HEIGHT,
          column,
          isSeed: node.id === seedId,
          ref: node.ref,
        });
        minX = Math.min(minX, columnX);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, columnX + OBJECT_MAP_NODE_WIDTH);
        maxY = Math.max(maxY, y + OBJECT_MAP_NODE_HEIGHT);
      });
    });

  return {
    nodes: Array.from(positioned.values()),
    edges: routeObjectMapEdges(Array.from(positioned.values()), edges),
    bounds: minX === Infinity ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY },
  };
};

export const routeObjectMapEdges = (
  nodes: PositionedNode[],
  edges: ObjectMapEdge[]
): PositionedEdge[] => {
  const positioned = new Map(nodes.map((node) => [node.id, node]));
  const positionedEdges: PositionedEdge[] = [];
  edges.forEach((edge) => {
    const source = positioned.get(edge.source);
    const target = positioned.get(edge.target);
    if (!source || !target) {
      return;
    }
    const sameColumn = source.x === target.x;
    if (sameColumn) {
      const anchorX = source.x + source.width;
      const sourceY = source.y + source.height / 2;
      const targetY = target.y + target.height / 2;
      const arcStretch = source.width * 1.5;
      const midX = anchorX + 0.75 * arcStretch;
      const midY = (sourceY + targetY) / 2;
      positionedEdges.push({
        id: edge.id,
        sourceId: edge.source,
        targetId: edge.target,
        type: edge.type,
        label: edge.label,
        tracedBy: edge.tracedBy,
        d: buildSameColumnPath(anchorX, sourceY, targetY, arcStretch),
        midX,
        midY,
        sameColumn: true,
      });
      return;
    }
    const sourceIsLeft = source.x <= target.x;
    const sourceX = sourceIsLeft ? source.x + source.width : source.x;
    const targetX = sourceIsLeft ? target.x : target.x + target.width;
    const sourceY = source.y + source.height / 2;
    const targetY = target.y + target.height / 2;
    positionedEdges.push({
      id: edge.id,
      sourceId: edge.source,
      targetId: edge.target,
      type: edge.type,
      label: edge.label,
      tracedBy: edge.tracedBy,
      d: buildCrossColumnPath(sourceX, sourceY, targetX, targetY),
      midX: (sourceX + targetX) / 2,
      midY: (sourceY + targetY) / 2,
      sameColumn: false,
    });
  });
  return positionedEdges;
};
