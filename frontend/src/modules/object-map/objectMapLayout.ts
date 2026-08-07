/**
 * frontend/src/modules/object-map/objectMapLayout.ts
 *
 * Seed-anchored compact min-length layered layout. Five passes:
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
 *   (5) Overloaded logical columns are split into horizontal lanes.
 *       Lane packing keeps contiguous same-kind groups together unless
 *       one kind group alone exceeds the lane limit. The logical column
 *       value is preserved, but neighboring columns are shifted so lanes
 *       do not overlap.
 *
 * Edges are routed as cubic beziers between source-right and target-
 * left anchors. The same-column rightward-arc fallback is retained for
 * the rare cycle case where the topological pass can't drain all
 * nodes; cycles cause the backend BFS depth to be used as a fallback
 * column, which can collide.
 */

import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';
import { OBJECT_MAP_CARD_STYLE } from './objectMapCardStyle';
import type { ObjectMapFilteredPath, ObjectMapLayoutEdge } from './objectMapKindFilter';

export const OBJECT_MAP_NODE_WIDTH = OBJECT_MAP_CARD_STYLE.width;
export const OBJECT_MAP_NODE_HEIGHT = OBJECT_MAP_CARD_STYLE.height;
export const OBJECT_MAP_COLUMN_GAP = 100;
export const OBJECT_MAP_ROW_GAP = 24;
export const OBJECT_MAP_MAX_NODES_PER_LANE = 24;
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
  creationTimestamp?: string;
  status?: ObjectMapNode['status'];
}

export interface PositionedEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  label: string;
  tracedBy?: string;
  filteredPath?: ObjectMapFilteredPath;
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

type NodeColumnGraph = {
  outgoing: Map<string, string[]>;
  inDegree: Map<string, number>;
};

const appendOutgoingTarget = (
  outgoing: Map<string, string[]>,
  sourceId: string,
  targetId: string
): void => {
  const targets = outgoing.get(sourceId);
  if (targets) {
    targets.push(targetId);
    return;
  }
  outgoing.set(sourceId, [targetId]);
};

const buildNodeColumnGraph = (nodes: ObjectMapNode[], edges: ObjectMapEdge[]): NodeColumnGraph => {
  const validIds = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  const inDegree = new Map(nodes.map((node) => [node.id, 0]));

  edges.forEach((edge) => {
    if (!validIds.has(edge.source) || !validIds.has(edge.target) || edge.source === edge.target) {
      return;
    }
    appendOutgoingTarget(outgoing, edge.source, edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  });

  return { outgoing, inDegree };
};

const seedLongestPathSources = (
  inDegree: Map<string, number>,
  columns: Map<string, number>
): string[] => {
  const queue: string[] = [];
  inDegree.forEach((degree, id) => {
    if (degree === 0) {
      columns.set(id, 0);
      queue.push(id);
    }
  });
  return queue;
};

const advanceLongestPathTarget = (
  targetId: string,
  sourceColumn: number,
  columns: Map<string, number>,
  remaining: Map<string, number>
): boolean => {
  const currentColumn = columns.get(targetId);
  const candidateColumn = sourceColumn + 1;
  if (currentColumn === undefined || candidateColumn > currentColumn) {
    columns.set(targetId, candidateColumn);
  }

  const priorRemaining = remaining.get(targetId);
  if (priorRemaining === undefined) {
    return false;
  }
  const nextRemaining = priorRemaining - 1;
  remaining.set(targetId, nextRemaining);
  return nextRemaining === 0;
};

const computeLongestPathColumns = ({
  outgoing,
  inDegree,
}: NodeColumnGraph): Map<string, number> => {
  const columns = new Map<string, number>();
  const remaining = new Map(inDegree);
  const queue = seedLongestPathSources(inDegree, columns);

  for (let head = 0; head < queue.length; head += 1) {
    const sourceId = queue[head];
    const sourceColumn = sourceId === undefined ? undefined : columns.get(sourceId);
    if (sourceColumn === undefined || sourceId === undefined) {
      continue;
    }
    for (const targetId of outgoing.get(sourceId) ?? []) {
      if (advanceLongestPathTarget(targetId, sourceColumn, columns, remaining)) {
        queue.push(targetId);
      }
    }
  }

  return columns;
};

const applyCycleFallbackColumns = (nodes: ObjectMapNode[], columns: Map<string, number>): void => {
  nodes.forEach((node) => {
    if (!columns.has(node.id)) {
      columns.set(node.id, node.depth);
    }
  });
};

const anchorColumnsAtSeed = (columns: Map<string, number>, seedId: string): void => {
  const seedColumn = columns.get(seedId);
  if (seedColumn === undefined || seedColumn === 0) {
    return;
  }
  columns.forEach((value, id) => {
    columns.set(id, value - seedColumn);
  });
};

const leftmostSuccessorColumn = (
  sourceId: string,
  outgoing: Map<string, string[]>,
  columns: Map<string, number>
): number | null => {
  let minimum = Infinity;
  for (const successorId of outgoing.get(sourceId) ?? []) {
    const successorColumn = columns.get(successorId);
    if (successorColumn !== undefined) {
      minimum = Math.min(minimum, successorColumn);
    }
  }
  return minimum === Infinity ? null : minimum;
};

const pullSourcesTowardSuccessors = (
  seedId: string,
  graph: NodeColumnGraph,
  columns: Map<string, number>
): void => {
  graph.inDegree.forEach((degree, id) => {
    if (degree !== 0 || id === seedId) {
      return;
    }
    const successorColumn = leftmostSuccessorColumn(id, graph.outgoing, columns);
    if (successorColumn !== null) {
      columns.set(id, successorColumn - 1);
    }
  });
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
  const graph = buildNodeColumnGraph(nodes, edges);

  // Step 1: longest-path layering. Sources start at column 0; each
  // other node lands at max(predecessor column + 1).
  const columns = computeLongestPathColumns(graph);

  // Defensive fallback for nodes the topological pass never reached
  // (cycles). K8s graphs are normally acyclic so this should not fire.
  applyCycleFallbackColumns(nodes, columns);

  // Step 2: anchor the seed at column 0.
  anchorColumnsAtSeed(columns, seedId);

  // Step 3: pull each true source (in-degree zero, not the seed) right
  // to sit one column left of its leftmost successor. Doesn't violate
  // any constraint because the source has no predecessors and its
  // outgoing edges still satisfy col(target) >= col(source) + 1 after
  // the move.
  pullSourcesTowardSuccessors(seedId, graph, columns);

  return columns;
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
    if (sList) {
      sList.push(edge.target);
    } else {
      adj.set(edge.source, [edge.target]);
    }
    const tList = adj.get(edge.target);
    if (tList) {
      tList.push(edge.source);
    } else {
      adj.set(edge.target, [edge.source]);
    }
  });
  return adj;
};

type BarycenterOrderingContext = {
  columns: Map<number, ObjectMapNode[]>;
  adjacency: Map<string, string[]>;
  columnOf: Map<string, number>;
};

const nodeIndexInColumn = (context: BarycenterOrderingContext, nodeId: string): number => {
  const column = context.columnOf.get(nodeId);
  if (column === undefined) {
    return -1;
  }
  return context.columns.get(column)?.findIndex((node) => node.id === nodeId) ?? -1;
};

const computeNodeBarycenter = (
  context: BarycenterOrderingContext,
  node: ObjectMapNode,
  neighborColumn: number
): number => {
  let indexSum = 0;
  let neighborCount = 0;
  for (const neighborId of context.adjacency.get(node.id) ?? []) {
    if (context.columnOf.get(neighborId) !== neighborColumn) {
      continue;
    }
    const index = nodeIndexInColumn(context, neighborId);
    if (index < 0) {
      continue;
    }
    indexSum += index;
    neighborCount += 1;
  }
  return neighborCount === 0 ? Infinity : indexSum / neighborCount;
};

const compareNodesByBarycenter = (
  context: BarycenterOrderingContext,
  neighborColumn: number,
  left: ObjectMapNode,
  right: ObjectMapNode
): number => {
  // Kind is the outermost sort key so same-kind nodes cluster into a
  // contiguous band. Within a kind group, barycenter and then the
  // deterministic namespace/name comparison drive alignment.
  if (left.ref.kind !== right.ref.kind) {
    return left.ref.kind.localeCompare(right.ref.kind);
  }
  const leftBarycenter = computeNodeBarycenter(context, left, neighborColumn);
  const rightBarycenter = computeNodeBarycenter(context, right, neighborColumn);
  if (leftBarycenter === rightBarycenter) {
    return compareForColumn(left, right);
  }
  if (leftBarycenter === Infinity) {
    return 1;
  }
  if (rightBarycenter === Infinity) {
    return -1;
  }
  return leftBarycenter - rightBarycenter;
};

const orderColumnFromNeighbor = (
  context: BarycenterOrderingContext,
  column: number,
  neighborColumn: number
): void => {
  context.columns
    .get(column)
    ?.sort((left, right) => compareNodesByBarycenter(context, neighborColumn, left, right));
};

const sweepColumnsForward = (context: BarycenterOrderingContext, sortedColumns: number[]): void => {
  for (let index = 1; index < sortedColumns.length; index += 1) {
    const column = sortedColumns[index];
    const neighborColumn = sortedColumns[index - 1];
    if (column !== undefined && neighborColumn !== undefined) {
      orderColumnFromNeighbor(context, column, neighborColumn);
    }
  }
};

const sweepColumnsBackward = (
  context: BarycenterOrderingContext,
  sortedColumns: number[],
  seedColumn: number
): void => {
  for (let index = sortedColumns.length - 2; index >= 0; index -= 1) {
    const column = sortedColumns[index];
    const neighborColumn = sortedColumns[index + 1];
    if (column !== undefined && neighborColumn !== undefined && column !== seedColumn) {
      orderColumnFromNeighbor(context, column, neighborColumn);
    }
  }
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
    columns.get(col)?.sort(compareForColumn);
  });
  // Index lookup is recomputed through this context because column
  // orderings mutate after every directional sweep.
  const context = { columns, adjacency: adj, columnOf };

  for (let sweep = 0; sweep < BARYCENTER_SWEEPS; sweep += 1) {
    if (sweep % 2 === 0) {
      // Left-to-right: order each column by the barycenter of its left neighbors.
      sweepColumnsForward(context, sortedColumns);
      continue;
    }
    // Right-to-left: keep the seed column fixed as the layout pivot.
    sweepColumnsBackward(context, sortedColumns, seedColumn);
  }
};

const splitColumnIntoKindAwareLanes = (columnNodes: ObjectMapNode[]): ObjectMapNode[][] => {
  if (columnNodes.length <= OBJECT_MAP_MAX_NODES_PER_LANE) {
    return [columnNodes];
  }

  const lanes: ObjectMapNode[][] = [];
  let currentLane: ObjectMapNode[] = [];
  let groupStart = 0;

  const pushCurrentLane = () => {
    if (currentLane.length === 0) {
      return;
    }
    lanes.push(currentLane);
    currentLane = [];
  };

  const appendGroup = (group: ObjectMapNode[]) => {
    if (group.length > OBJECT_MAP_MAX_NODES_PER_LANE) {
      pushCurrentLane();
      for (let index = 0; index < group.length; index += OBJECT_MAP_MAX_NODES_PER_LANE) {
        lanes.push(group.slice(index, index + OBJECT_MAP_MAX_NODES_PER_LANE));
      }
      return;
    }

    if (
      currentLane.length > 0 &&
      currentLane.length + group.length > OBJECT_MAP_MAX_NODES_PER_LANE
    ) {
      pushCurrentLane();
    }
    currentLane.push(...group);
  };

  for (let index = 1; index < columnNodes.length; index += 1) {
    const previousKind = columnNodes[index - 1]?.ref.kind;
    const nextKind = columnNodes[index]?.ref.kind;
    if (previousKind === nextKind) {
      continue;
    }
    appendGroup(columnNodes.slice(groupStart, index));
    groupStart = index;
  }
  // Flush the trailing run: the loop emits a group at each kind boundary and
  // stops before the last node, so the final same-kind run is still pending.
  appendGroup(columnNodes.slice(groupStart));

  pushCurrentLane();
  return lanes;
};

const computeColumnStartX = (
  sortedColumns: number[],
  laneCounts: Map<number, number>,
  seedColumn: number
): Map<number, number> => {
  const columnStartX = new Map<number, number>();
  columnStartX.set(seedColumn, 0);

  let rightX = (laneCounts.get(seedColumn) ?? 1) * COLUMN_STRIDE;
  for (const column of sortedColumns.filter((col) => col > seedColumn)) {
    columnStartX.set(column, rightX);
    rightX += (laneCounts.get(column) ?? 1) * COLUMN_STRIDE;
  }

  let leftX = 0;
  for (const column of sortedColumns.filter((col) => col < seedColumn).reverse()) {
    leftX -= (laneCounts.get(column) ?? 1) * COLUMN_STRIDE;
    columnStartX.set(column, leftX);
  }

  return columnStartX;
};

const computeLaneHeight = (laneNodes: ObjectMapNode[]): number => {
  let totalHeight = 0;
  laneNodes.forEach((node, index) => {
    if (index > 0) {
      const sameKind = laneNodes[index - 1].ref.kind === node.ref.kind;
      totalHeight += sameKind ? OBJECT_MAP_ROW_GAP : OBJECT_MAP_ROW_GAP + OBJECT_MAP_KIND_GROUP_GAP;
    }
    totalHeight += OBJECT_MAP_NODE_HEIGHT;
  });
  return totalHeight;
};

export const computeObjectMapLayout = (
  nodes: ObjectMapNode[],
  edges: ObjectMapLayoutEdge[],
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
    if (list) {
      list.push(node);
    } else {
      columns.set(col, [node]);
    }
  });

  const seedColumn = columnOf.get(seedId) ?? 0;
  const adj = buildCrossColumnAdjacency(edges, columnOf);
  orderColumnsByBarycenter(columns, adj, columnOf, seedColumn);

  const positioned = new Map<string, PositionedNode>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const sortedColumns = Array.from(columns.keys()).sort((a, b) => a - b);
  const columnLanes = new Map<number, ObjectMapNode[][]>();
  const laneCounts = new Map<number, number>();
  sortedColumns.forEach((column) => {
    const columnNodes = columns.get(column);
    if (!columnNodes) {
      return;
    }
    const lanes = splitColumnIntoKindAwareLanes(columnNodes);
    columnLanes.set(column, lanes);
    laneCounts.set(column, lanes.length);
  });
  const columnStartX = computeColumnStartX(sortedColumns, laneCounts, seedColumn);

  sortedColumns.forEach((column) => {
    const columnNodes = columns.get(column);
    if (!columnNodes) {
      return;
    }
    const lanes = columnLanes.get(column) ?? [columnNodes];
    const columnX = columnStartX.get(column) ?? column * COLUMN_STRIDE;

    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      const laneNodes = lanes[laneIndex];
      const laneX = columnX + laneIndex * COLUMN_STRIDE;
      const totalHeight = computeLaneHeight(laneNodes);
      let y = -totalHeight / 2;

      laneNodes.forEach((node, index) => {
        if (index > 0) {
          const sameKind = laneNodes[index - 1].ref.kind === node.ref.kind;
          const gap = sameKind
            ? OBJECT_MAP_ROW_GAP
            : OBJECT_MAP_ROW_GAP + OBJECT_MAP_KIND_GROUP_GAP;
          y += OBJECT_MAP_NODE_HEIGHT + gap;
        }
        positioned.set(node.id, {
          id: node.id,
          x: laneX,
          y,
          width: OBJECT_MAP_NODE_WIDTH,
          height: OBJECT_MAP_NODE_HEIGHT,
          column,
          isSeed: node.id === seedId,
          ref: node.ref,
          creationTimestamp: node.creationTimestamp,
          status: node.status,
        });
        minX = Math.min(minX, laneX);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, laneX + OBJECT_MAP_NODE_WIDTH);
        maxY = Math.max(maxY, y + OBJECT_MAP_NODE_HEIGHT);
      });
    }
  });

  return {
    nodes: Array.from(positioned.values()),
    edges: routeObjectMapEdges(Array.from(positioned.values()), edges),
    bounds: minX === Infinity ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY },
  };
};

export const routeObjectMapEdges = (
  nodes: PositionedNode[],
  edges: ObjectMapLayoutEdge[]
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
        filteredPath: edge.filteredPath,
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
      filteredPath: edge.filteredPath,
      d: buildCrossColumnPath(sourceX, sourceY, targetX, targetY),
      midX: (sourceX + targetX) / 2,
      midY: (sourceY + targetY) / 2,
      sameColumn: false,
    });
  });
  return positionedEdges;
};
