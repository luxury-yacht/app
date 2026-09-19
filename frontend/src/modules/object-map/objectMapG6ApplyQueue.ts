/**
 * frontend/src/modules/object-map/objectMapG6ApplyQueue.ts
 *
 * Serializes async G6 data and selection updates so rapid map changes apply
 * in order without racing stale graph renders or viewport-preservation work.
 */

import type { EdgeData, Graph, GraphData, NodeData } from '@antv/g6';
import { objectMapG6EdgeState, objectMapG6NodeState } from './objectMapG6Data';
import { findObjectMapG6Edge } from './objectMapG6RendererOptions';
import type { ObjectMapLayout } from './objectMapLayout';
import type { ObjectMapSelectionState } from './objectMapRendererTypes';

const graphNodes = (data: GraphData): NodeData[] => data.nodes ?? [];
const graphEdges = (data: GraphData): EdgeData[] => data.edges ?? [];

const nodeCenter = (
  data: GraphData,
  id: string | null | undefined
): { x: number; y: number } | null => {
  if (!id) {
    return null;
  }
  const node = graphNodes(data).find((entry) => entry.id === id);
  const x = Number(node?.style?.x);
  const y = Number(node?.style?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
};

const nodeViewportPoint = (
  graph: Graph,
  data: GraphData,
  id: string | null | undefined
): { x: number; y: number } | null => {
  const center = nodeCenter(data, id);
  if (!center) {
    return null;
  }
  const [x, y] = graph.getViewportByCanvas([center.x, center.y]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
};

const sameIds = <T extends { id?: string }>(previous: T[], next: T[]): boolean => {
  if (previous.length !== next.length) {
    return false;
  }
  const previousIds = new Set(previous.map((entry) => entry.id));
  return next.every((entry) => entry.id && previousIds.has(entry.id));
};

const lineDashChanged = (previous?: unknown, next?: unknown): boolean => {
  if (previous === next) {
    return false;
  }
  if (!Array.isArray(previous) || !Array.isArray(next)) {
    return true;
  }
  return previous.length !== next.length || previous.some((value, index) => value !== next[index]);
};

const objectMapPathChanged = (previous?: unknown, next?: unknown): boolean => {
  if (previous === next) {
    return false;
  }
  if (!Array.isArray(previous) || !Array.isArray(next)) {
    return true;
  }
  if (previous.length !== next.length) {
    return true;
  }
  return previous.some((previousSegment, segmentIndex) => {
    const nextSegment = next[segmentIndex];
    if (!Array.isArray(previousSegment) || !Array.isArray(nextSegment)) {
      return true;
    }
    return (
      previousSegment.length !== nextSegment.length ||
      previousSegment.some((value, valueIndex) => value !== nextSegment[valueIndex])
    );
  });
};

const fieldsChanged = <T extends object>(
  previous: T,
  next: T,
  fields: readonly (keyof T)[]
): boolean => fields.some((field) => previous[field] !== next[field]);

const NODE_STYLE_FIELDS = [
  'x',
  'y',
  'fill',
  'stroke',
  'lineWidth',
  'radius',
  'opacity',
  'cardDetailLevel',
  'cardKindBadgeText',
  'cardKindBadgeFill',
  'cardKindBadgeTextFill',
  'cardKindBadgeStroke',
  'cardKindBadgeBorderWidth',
  'cardKindBadgeRadius',
  'cardKindBadgeFontSize',
  'cardKindBadgeFontWeight',
  'cardKindBadgeLetterSpacing',
  'cardKindBadgePaddingX',
  'cardKindBadgePaddingY',
  'cardBackgroundOpacity',
  'cardForegroundOpacity',
  'cardCollapseBadgeText',
  'cardCollapseBadgeFill',
  'cardCollapseBadgeTextFill',
  'cardCollapseBadgeStroke',
  'cardNameText',
  'cardNamespaceText',
  'cardAgeText',
  'cardStatusText',
  'cardStatusReason',
  'cardStatusFill',
  'cardStatusStroke',
  'cardFontFamily',
  'cardNameFill',
  'cardNamespaceFill',
  'cardAgeFill',
] as const satisfies readonly (keyof NonNullable<NodeData['style']>)[];

const EDGE_STYLE_FIELDS = [
  'stroke',
  'lineWidth',
  'opacity',
  'objectMapEdgeDetailLevel',
] as const satisfies readonly (keyof NonNullable<EdgeData['style']>)[];

const EDGE_DATA_FIELDS = [
  'label',
  'type',
  'tracedBy',
  'midX',
  'midY',
  'path',
] as const satisfies readonly (keyof NonNullable<EdgeData['data']>)[];

const nodeChanged = (previous: NodeData, next: NodeData): boolean => {
  const previousStyle = previous.style ?? {};
  const nextStyle = next.style ?? {};
  const previousSize = previousStyle.size;
  const nextSize = nextStyle.size;
  const sizeChanged =
    Array.isArray(previousSize) &&
    Array.isArray(nextSize) &&
    (previousSize[0] !== nextSize[0] || previousSize[1] !== nextSize[1]);
  return (
    previous.type !== next.type ||
    fieldsChanged(previousStyle, nextStyle, NODE_STYLE_FIELDS) ||
    sizeChanged
  );
};

const edgeChanged = (previous: EdgeData, next: EdgeData): boolean => {
  const previousStyle = previous.style ?? {};
  const nextStyle = next.style ?? {};
  return (
    previous.source !== next.source ||
    previous.target !== next.target ||
    fieldsChanged(previousStyle, nextStyle, EDGE_STYLE_FIELDS) ||
    objectMapPathChanged(previousStyle.objectMapPath, nextStyle.objectMapPath) ||
    lineDashChanged(previousStyle.lineDash, nextStyle.lineDash) ||
    fieldsChanged(previous.data ?? {}, next.data ?? {}, EDGE_DATA_FIELDS) ||
    JSON.stringify(previous.data?.filteredPath) !== JSON.stringify(next.data?.filteredPath)
  );
};

export const applyGraphData = async (
  graph: Graph,
  previousData: GraphData,
  nextData: GraphData,
  options: { preserveViewportNodeId?: string | null; draggedNodeId?: string | null } = {}
): Promise<void> => {
  const previousNodes = graphNodes(previousData);
  const nextNodes = graphNodes(nextData);
  const previousEdges = graphEdges(previousData);
  const nextEdges = graphEdges(nextData);
  // A user drag moves the preserve node on purpose; panning the viewport to
  // keep it fixed would cancel the drag and slide the rest of the map instead.
  const preserveViewportNodeId =
    options.preserveViewportNodeId === options.draggedNodeId
      ? null
      : options.preserveViewportNodeId;
  const previousViewportPoint = nodeViewportPoint(graph, previousData, preserveViewportNodeId);
  const preserveViewportForNode = async () => {
    if (!previousViewportPoint) {
      return;
    }
    const nextViewportPoint = nodeViewportPoint(graph, nextData, preserveViewportNodeId);
    if (!nextViewportPoint) {
      return;
    }
    await graph.translateBy(
      [
        previousViewportPoint.x - nextViewportPoint.x,
        previousViewportPoint.y - nextViewportPoint.y,
      ],
      false
    );
  };

  if (!sameIds(previousNodes, nextNodes) || !sameIds(previousEdges, nextEdges)) {
    graph.setData(nextData);
    await graph.render();
    await preserveViewportForNode();
    return;
  }

  const previousNodeById = new Map(previousNodes.map((node) => [node.id, node]));
  const previousEdgeById = new Map(previousEdges.map((edge) => [edge.id, edge]));
  const nodeUpdates = nextNodes.filter((node) => {
    const previous = node.id ? previousNodeById.get(node.id) : undefined;
    return !previous || nodeChanged(previous, node);
  });
  const edgeUpdates = nextEdges.filter((edge) => {
    const previous = edge.id ? previousEdgeById.get(edge.id) : undefined;
    return !previous || edgeChanged(previous, edge);
  });

  if (nodeUpdates.length === 0 && edgeUpdates.length === 0) {
    return;
  }
  const patch: { nodes?: NodeData[]; edges?: EdgeData[] } = {};
  if (nodeUpdates.length > 0) {
    patch.nodes = nodeUpdates;
  }
  if (edgeUpdates.length > 0) {
    patch.edges = edgeUpdates;
  }
  graph.updateData(patch);
  await graph.draw();
  await preserveViewportForNode();
};

export const applySelectionState = async (
  graph: Graph,
  layout: ObjectMapLayout,
  selectionState: ObjectMapSelectionState,
  hoveredEdgeId: string | null = null
): Promise<void> => {
  if (graph.destroyed) {
    return;
  }
  const states: Record<string, string[]> = {};
  const hoveredEdge = hoveredEdgeId ? findObjectMapG6Edge(layout, hoveredEdgeId) : null;
  layout.nodes.forEach((node) => {
    states[node.id] = objectMapG6NodeState(node, selectionState, hoveredEdge);
  });
  layout.edges.forEach((edge) => {
    states[edge.id] = objectMapG6EdgeState(edge, selectionState, hoveredEdge?.id);
  });
  if (graph.destroyed) {
    return;
  }
  await graph.setElementState(states, false);
};

// Each run owns its completion. Clearing a slot releases that ownership before
// a replacement graph starts, even if the old G6 promise is still settling.
const createGraphApplySlot = <T>(
  getGraph: () => Graph | null,
  isReady: () => boolean,
  apply: (graph: Graph, value: T, isCurrent: () => boolean) => Promise<void>,
  onError?: (error: unknown) => void
) => {
  let latest: T | null = null;
  let activeRun: object | null = null;

  const flush = () => {
    const graph = getGraph();
    if (!graph || graph.destroyed || !isReady() || activeRun || !latest) {
      return;
    }
    const run = {};
    activeRun = run;
    const isCurrent = () => activeRun === run && getGraph() === graph && !graph.destroyed;
    const applyPending = async () => {
      while (latest && isCurrent() && isReady()) {
        const value = latest;
        latest = null;
        await apply(graph, value, isCurrent);
      }
    };
    void applyPending()
      .catch((error) => {
        if (isCurrent()) {
          onError?.(error);
        }
      })
      .finally(() => {
        if (activeRun === run) {
          activeRun = null;
          flush();
        }
      });
  };

  return {
    flush,
    hasPending: () => latest !== null,
    schedule: (value: T) => {
      const graph = getGraph();
      if (!graph || graph.destroyed) {
        return;
      }
      latest = value;
      flush();
    },
    clear: () => {
      latest = null;
      activeRun = null;
    },
  };
};

const objectMapApplyTimingNow = (): number =>
  typeof performance === 'undefined' ? Date.now() : performance.now();

export interface ObjectMapG6GraphDataTiming {
  durationMs: number;
  mode: 'initial-render' | 'update';
  nodes: number;
  edges: number;
}

export interface ObjectMapG6SelectionStateTiming {
  durationMs: number;
  nodes: number;
  edges: number;
}

export interface ObjectMapG6ApplyQueueOptions {
  getGraph: () => Graph | null;
  getCurrentLayout: () => ObjectMapLayout;
  getCurrentSelectionState: () => ObjectMapSelectionState;
  getHoveredEdgeId: () => string | null;
  getPreserveViewportNodeId: () => string | null;
  getDraggedNodeId?: () => string | null;
  onGraphDataError?: (error: unknown) => void;
  onSelectionStateError?: (error: unknown) => void;
  onGraphDataTiming?: (timing: ObjectMapG6GraphDataTiming) => void;
  onSelectionStateTiming?: (timing: ObjectMapG6SelectionStateTiming) => void;
  applyGraphDataFn?: typeof applyGraphData;
  applySelectionStateFn?: typeof applySelectionState;
}

export interface ObjectMapG6ApplyQueue {
  clear: () => void;
  getRenderedData: () => GraphData | null;
  isReady: () => boolean;
  setReady: (ready: boolean) => void;
  setRenderedData: (data: GraphData | null) => void;
  scheduleGraphData: (data: GraphData) => void;
  scheduleSelectionState: (
    layout: ObjectMapLayout,
    selectionState: ObjectMapSelectionState
  ) => void;
}

export const createObjectMapG6ApplyQueue = ({
  getGraph,
  getCurrentLayout,
  getCurrentSelectionState,
  getHoveredEdgeId,
  getPreserveViewportNodeId,
  getDraggedNodeId,
  onGraphDataError,
  onSelectionStateError,
  onGraphDataTiming,
  onSelectionStateTiming,
  applyGraphDataFn = applyGraphData,
  applySelectionStateFn = applySelectionState,
}: ObjectMapG6ApplyQueueOptions): ObjectMapG6ApplyQueue => {
  let graphReady = false;
  let renderedData: GraphData | null = null;
  const selectionApply = createGraphApplySlot<{
    layout: ObjectMapLayout;
    selectionState: ObjectMapSelectionState;
  }>(
    getGraph,
    () => graphReady,
    async (graph, latest, isCurrent) => {
      const startedAt = objectMapApplyTimingNow();
      await applySelectionStateFn(graph, latest.layout, latest.selectionState, getHoveredEdgeId());
      if (isCurrent()) {
        onSelectionStateTiming?.({
          durationMs: objectMapApplyTimingNow() - startedAt,
          nodes: latest.layout.nodes.length,
          edges: latest.layout.edges.length,
        });
      }
    },
    onSelectionStateError
  );

  const scheduleSelectionState = (
    layout: ObjectMapLayout,
    selectionState: ObjectMapSelectionState
  ) => selectionApply.schedule({ layout, selectionState });

  const dataApply = createGraphApplySlot<{ data: GraphData; draggedNodeId: string | null }>(
    getGraph,
    () => graphReady,
    async (graph, latest, isCurrent) => {
      const startedAt = objectMapApplyTimingNow();
      const mode = renderedData ? 'update' : 'initial-render';
      if (renderedData) {
        await applyGraphDataFn(graph, renderedData, latest.data, {
          preserveViewportNodeId: getPreserveViewportNodeId(),
          draggedNodeId: latest.draggedNodeId,
        });
      } else {
        graph.setData(latest.data);
        await graph.render();
      }
      if (!isCurrent()) {
        return;
      }
      onGraphDataTiming?.({
        durationMs: objectMapApplyTimingNow() - startedAt,
        mode,
        nodes: latest.data.nodes?.length ?? 0,
        edges: latest.data.edges?.length ?? 0,
      });
      renderedData = latest.data;
      scheduleSelectionState(getCurrentLayout(), getCurrentSelectionState());
    },
    onGraphDataError
  );

  // Capture the drag with its payload: the gesture can end before this update
  // applies, and reading it then would wrongly restore viewport preservation.
  const scheduleGraphData = (data: GraphData) => {
    dataApply.schedule({ data, draggedNodeId: getDraggedNodeId?.() ?? null });
  };

  const setReady = (ready: boolean) => {
    graphReady = ready;
    if (dataApply.hasPending()) {
      dataApply.flush();
    } else {
      selectionApply.flush();
    }
  };

  const clear = () => {
    graphReady = false;
    renderedData = null;
    selectionApply.clear();
    dataApply.clear();
  };

  return {
    clear,
    getRenderedData: () => renderedData,
    isReady: () => graphReady,
    setReady,
    setRenderedData: (data) => {
      renderedData = data;
    },
    scheduleGraphData,
    scheduleSelectionState,
  };
};
