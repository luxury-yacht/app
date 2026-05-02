/**
 * frontend/src/modules/object-map/objectMapLayout.ts
 *
 * Role-based directional layered layout for the object map. Three passes:
 *
 *   (1) Column assignment uses Sugiyama-style longest-path layering on
 *       the directed edge graph: every node's column = max(predecessor
 *       column + 1) along outgoing-edge direction. Anchored on the
 *       seed (shifted so seedColumn = 0). Because every K8s edge has a
 *       natural left-to-right direction (owner→child, controller→
 *       instance, consumer→resource), this places ancestors strictly
 *       left of the seed and dependencies strictly to the right.
 *       Critically: same-column edges become impossible by construction
 *       in any acyclic graph, so the spurious "loop-back" arcs that
 *       the previous BFS-depth model produced (e.g. ReplicaSet and the
 *       ConfigMap its template references both at depth=1 from a Pod
 *       seed) disappear.
 *
 *   (2) Within each column, nodes are reordered by Sugiyama-style
 *       barycenter sweeps over their cross-column neighbours, so
 *       connected siblings end up vertically aligned and crossings
 *       drop sharply.
 *
 *   (3) Edges are routed as cubic beziers between source-right and
 *       target-left anchors, drape-shaped via control points pulled
 *       into the gutters.
 *
 * Cycles (rare in K8s but defensively handled): nodes the topological
 * sort cannot reach fall back to the backend's BFS depth as their
 * column. The same-column edge routing remains as a defensive fallback
 * for that case so cycle-trapped pairs still draw without crossing
 * through node bodies.
 */

import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';

export const OBJECT_MAP_NODE_WIDTH = 220;
export const OBJECT_MAP_NODE_HEIGHT = 64;
export const OBJECT_MAP_COLUMN_GAP = 100;
export const OBJECT_MAP_ROW_GAP = 24;

const COLUMN_STRIDE = OBJECT_MAP_NODE_WIDTH + OBJECT_MAP_COLUMN_GAP;
const ROW_STRIDE = OBJECT_MAP_NODE_HEIGHT + OBJECT_MAP_ROW_GAP;

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
 * Assign each node a column index using Sugiyama-style longest-path
 * layering. Edges are treated as directed (source → target). After the
 * topological pass, the result is shifted so the seed sits at column 0.
 *
 * Cycles: any node whose in-degree never reaches zero (i.e., it sits in
 * a strongly-connected component the sort cannot drain) falls back to
 * its backend-provided BFS depth. K8s graphs are normally acyclic so
 * this branch should rarely fire in practice.
 */
const computeNodeColumns = (
  nodes: ObjectMapNode[],
  edges: ObjectMapEdge[],
  seedId: string
): Map<string, number> => {
  const validIds = new Set(nodes.map((n) => n.id));
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  nodes.forEach((n) => inDegree.set(n.id, 0));

  edges.forEach((edge) => {
    // Skip edges that reference unknown nodes or self-loops; both would
    // poison the topological pass without adding layout signal.
    if (!validIds.has(edge.source) || !validIds.has(edge.target)) return;
    if (edge.source === edge.target) return;
    let outs = adj.get(edge.source);
    if (!outs) {
      outs = [];
      adj.set(edge.source, outs);
    }
    outs.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  });

  const column = new Map<string, number>();
  const remainingIn = new Map(inDegree);
  const queue: string[] = [];
  inDegree.forEach((d, id) => {
    if (d === 0) {
      column.set(id, 0);
      queue.push(id);
    }
  });

  while (queue.length > 0) {
    const u = queue.shift()!;
    const cu = column.get(u)!;
    const outs = adj.get(u);
    if (!outs) continue;
    for (const v of outs) {
      const cv = column.get(v);
      const candidate = cu + 1;
      if (cv === undefined || candidate > cv) {
        column.set(v, candidate);
      }
      const newDegree = remainingIn.get(v)! - 1;
      remainingIn.set(v, newDegree);
      if (newDegree === 0) {
        queue.push(v);
      }
    }
  }

  // Defensive fallback for nodes the sort never reached (cycles).
  // Backend BFS depth is the best proxy we have for "where they ought
  // to be" relative to the seed; it preserves the old behaviour for
  // anything pathological.
  nodes.forEach((node) => {
    if (!column.has(node.id)) {
      column.set(node.id, node.depth);
    }
  });

  // Anchor the seed at column 0 by shifting the whole layout. We don't
  // anchor during the topological pass because the seed isn't
  // necessarily a source — for a Pod seed, ancestors (RS, Deployment,
  // HPA) feed in from the left and the seed lands several columns in.
  const seedColumn = column.get(seedId);
  if (seedColumn !== undefined && seedColumn !== 0) {
    column.forEach((value, id) => column.set(id, value - seedColumn));
  }

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
      const totalHeight = columnNodes.length * ROW_STRIDE - OBJECT_MAP_ROW_GAP;
      const startY = -totalHeight / 2;
      columnNodes.forEach((node, index) => {
        const y = startY + index * ROW_STRIDE;
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

  return {
    nodes: Array.from(positioned.values()),
    edges: positionedEdges,
    bounds: minX === Infinity ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY },
  };
};
