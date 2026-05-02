/**
 * frontend/src/modules/object-map/objectMapLayout.ts
 *
 * Depth-based horizontal-LR layout for the object map. Two passes:
 *
 *   (1) Column assignment uses the backend's `depth` (BFS hops from the
 *       seed) directly as the column index. This preserves the seed-
 *       distance semantics that make the visual readable as a
 *       neighbourhood map.
 *
 *   (2) Within each column, nodes are reordered by Sugiyama-style
 *       barycenter sweeps over their cross-column neighbours. Without
 *       this step the column order is alphabetic and edges cross
 *       wildly. With it, connected siblings end up vertically aligned
 *       and crossings drop sharply.
 *
 * Same-column edges (which arise naturally because BFS depth is
 * undirected — Service and EndpointSlice often land at the same depth)
 * are routed as wide rightward arcs that bulge out of the gutter
 * instead of straight lines that overlap node bodies.
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
  depth: number;
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
  // to target-left through the gutter; same-column edges arc rightward.
  d: string;
  // Cached midpoint for the hover label. The edge handler runs on every
  // pointer move, so we don't recompute the bezier each time.
  midX: number;
  midY: number;
  // True when the edge endpoints share a depth column. Consumers may
  // want to treat these differently (e.g. de-emphasise visually) — the
  // backend tracer doesn't know about layout, so this is the only place
  // the distinction is materialised.
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
  // pulled out by `arcStretch` produce a smooth half-loop.
  const c1x = anchorX + arcStretch;
  const c2x = anchorX + arcStretch;
  return `M ${anchorX} ${sourceY} C ${c1x} ${sourceY}, ${c2x} ${targetY}, ${anchorX} ${targetY}`;
};

const buildCrossColumnAdjacency = (
  edges: ObjectMapEdge[],
  depthOf: Map<string, number>
): Map<string, string[]> => {
  // We only feed cross-column edges into the barycenter sort because
  // same-column edges would create circular constraints (each node's
  // position would depend on its sibling's position in the same
  // column). The end result of the sweeps still keeps same-column
  // siblings near each other indirectly, since their cross-column
  // neighbours tend to align.
  const adj = new Map<string, string[]>();
  edges.forEach((edge) => {
    const sd = depthOf.get(edge.source);
    const td = depthOf.get(edge.target);
    if (sd === undefined || td === undefined || sd === td) {
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
  depthOf: Map<string, number>
): void => {
  const sortedDepths = Array.from(columns.keys()).sort((a, b) => a - b);
  if (sortedDepths.length <= 1) {
    return;
  }

  // Initial ordering: deterministic kind/namespace/name sort. Provides
  // a stable baseline so barycenter ties resolve the same way each run.
  sortedDepths.forEach((depth) => {
    columns.get(depth)!.sort(compareForColumn);
  });

  // Index lookup is recomputed each pass because columns mutate.
  const indexOf = (nodeId: string): number => {
    const depth = depthOf.get(nodeId);
    if (depth === undefined) return -1;
    return columns.get(depth)!.findIndex((n) => n.id === nodeId);
  };

  const barycenter = (node: ObjectMapNode, neighborDepth: number): number => {
    const neighbors = adj.get(node.id);
    if (!neighbors || neighbors.length === 0) return Infinity;
    let sum = 0;
    let count = 0;
    for (const neighborId of neighbors) {
      if (depthOf.get(neighborId) !== neighborDepth) continue;
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
      for (let i = 1; i < sortedDepths.length; i += 1) {
        const col = columns.get(sortedDepths[i])!;
        const neighborDepth = sortedDepths[i - 1];
        col.sort((a, b) => {
          const ba = barycenter(a, neighborDepth);
          const bb = barycenter(b, neighborDepth);
          if (ba === Infinity && bb === Infinity) return compareForColumn(a, b);
          if (ba === Infinity) return 1;
          if (bb === Infinity) return -1;
          return ba - bb || compareForColumn(a, b);
        });
      }
    } else {
      // Right-to-left: skip the seed column (depth 0) — it has only the seed.
      for (let i = sortedDepths.length - 2; i >= 0; i -= 1) {
        if (sortedDepths[i] === 0) continue;
        const col = columns.get(sortedDepths[i])!;
        const neighborDepth = sortedDepths[i + 1];
        col.sort((a, b) => {
          const ba = barycenter(a, neighborDepth);
          const bb = barycenter(b, neighborDepth);
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

  const depthOf = new Map<string, number>();
  const columns = new Map<number, ObjectMapNode[]>();
  nodes.forEach((node) => {
    depthOf.set(node.id, node.depth);
    const list = columns.get(node.depth);
    if (list) list.push(node);
    else columns.set(node.depth, [node]);
  });

  const adj = buildCrossColumnAdjacency(edges, depthOf);
  orderColumnsByBarycenter(columns, adj, depthOf);

  const positioned = new Map<string, PositionedNode>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  Array.from(columns.entries())
    .sort(([a], [b]) => a - b)
    .forEach(([depth, columnNodes]) => {
      const columnX = depth * COLUMN_STRIDE;
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
          depth: node.depth,
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
      // Stretch the arc by ~1.5× node width so the bulge clears
      // intermediate siblings stacked between source and target.
      const arcStretch = source.width * 1.5;
      // Cubic bezier midpoint at t=0.5 collapses to:
      //   midX = 0.5*sx + 0.5*tx + 0.75*stretch
      // which simplifies for same-column to anchorX + 0.75*stretch.
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
