/**
 * frontend/src/modules/object-map/objectMapG6ApplyQueue.ts
 *
 * Serializes async G6 data and selection updates so rapid map changes apply
 * in order without racing stale graph renders or viewport-preservation work.
 */

import type { EdgeData, Graph, GraphData, NodeData } from '@antv/g6';
import { objectMapG6EdgeState, objectMapG6NodeState } from './objectMapG6Data';
import type { ObjectMapLayout } from './objectMapLayout';
import type { ObjectMapSelectionState } from './objectMapRendererTypes';

const findEdge = (layout: ObjectMapLayout, id: string) =>
  layout.edges.find((edge) => edge.id === id) ?? null;

const graphNodes = (data: GraphData): NodeData[] => data.nodes ?? [];
const graphEdges = (data: GraphData): EdgeData[] => data.edges ?? [];

const nodeCenter = (
  data: GraphData,
  id: string | null | undefined
): { x: number; y: number } | null => {
  if (!id) return null;
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
  if (!center) return null;
  const [x, y] = graph.getViewportByCanvas([center.x, center.y]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
};

const sameIds = <T extends { id?: string }>(previous: T[], next: T[]): boolean => {
  if (previous.length !== next.length) return false;
  const previousIds = new Set(previous.map((entry) => entry.id));
  return next.every((entry) => entry.id && previousIds.has(entry.id));
};

const lineDashChanged = (previous?: unknown, next?: unknown): boolean => {
  if (previous === next) return false;
  if (!Array.isArray(previous) || !Array.isArray(next)) return true;
  return previous.length !== next.length || previous.some((value, index) => value !== next[index]);
};

const objectMapPathChanged = (previous?: unknown, next?: unknown): boolean => {
  if (previous === next) return false;
  if (!Array.isArray(previous) || !Array.isArray(next)) return true;
  if (previous.length !== next.length) return true;
  return previous.some((previousSegment, segmentIndex) => {
    const nextSegment = next[segmentIndex];
    if (!Array.isArray(previousSegment) || !Array.isArray(nextSegment)) return true;
    return (
      previousSegment.length !== nextSegment.length ||
      previousSegment.some((value, valueIndex) => value !== nextSegment[valueIndex])
    );
  });
};

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
    previousStyle.x !== nextStyle.x ||
    previousStyle.y !== nextStyle.y ||
    sizeChanged ||
    previousStyle.fill !== nextStyle.fill ||
    previousStyle.stroke !== nextStyle.stroke ||
    previousStyle.lineWidth !== nextStyle.lineWidth ||
    previousStyle.radius !== nextStyle.radius ||
    previousStyle.opacity !== nextStyle.opacity ||
    previousStyle.cardDetailLevel !== nextStyle.cardDetailLevel ||
    previousStyle.cardKindBadgeText !== nextStyle.cardKindBadgeText ||
    previousStyle.cardKindBadgeFill !== nextStyle.cardKindBadgeFill ||
    previousStyle.cardKindBadgeTextFill !== nextStyle.cardKindBadgeTextFill ||
    previousStyle.cardKindBadgeStroke !== nextStyle.cardKindBadgeStroke ||
    previousStyle.cardKindBadgeBorderWidth !== nextStyle.cardKindBadgeBorderWidth ||
    previousStyle.cardKindBadgeRadius !== nextStyle.cardKindBadgeRadius ||
    previousStyle.cardKindBadgeFontSize !== nextStyle.cardKindBadgeFontSize ||
    previousStyle.cardKindBadgeFontWeight !== nextStyle.cardKindBadgeFontWeight ||
    previousStyle.cardKindBadgeLetterSpacing !== nextStyle.cardKindBadgeLetterSpacing ||
    previousStyle.cardKindBadgePaddingX !== nextStyle.cardKindBadgePaddingX ||
    previousStyle.cardKindBadgePaddingY !== nextStyle.cardKindBadgePaddingY ||
    previousStyle.cardBackgroundOpacity !== nextStyle.cardBackgroundOpacity ||
    previousStyle.cardForegroundOpacity !== nextStyle.cardForegroundOpacity ||
    previousStyle.cardCollapseBadgeText !== nextStyle.cardCollapseBadgeText ||
    previousStyle.cardCollapseBadgeFill !== nextStyle.cardCollapseBadgeFill ||
    previousStyle.cardCollapseBadgeTextFill !== nextStyle.cardCollapseBadgeTextFill ||
    previousStyle.cardCollapseBadgeStroke !== nextStyle.cardCollapseBadgeStroke ||
    previousStyle.cardNameText !== nextStyle.cardNameText ||
    previousStyle.cardNamespaceText !== nextStyle.cardNamespaceText ||
    previousStyle.cardAgeText !== nextStyle.cardAgeText ||
    previousStyle.cardStatusText !== nextStyle.cardStatusText ||
    previousStyle.cardStatusReason !== nextStyle.cardStatusReason ||
    previousStyle.cardStatusFill !== nextStyle.cardStatusFill ||
    previousStyle.cardStatusStroke !== nextStyle.cardStatusStroke ||
    previousStyle.cardFontFamily !== nextStyle.cardFontFamily ||
    previousStyle.cardNameFill !== nextStyle.cardNameFill ||
    previousStyle.cardNamespaceFill !== nextStyle.cardNamespaceFill ||
    previousStyle.cardAgeFill !== nextStyle.cardAgeFill
  );
};

const edgeChanged = (previous: EdgeData, next: EdgeData): boolean => {
  const previousStyle = previous.style ?? {};
  const nextStyle = next.style ?? {};
  return (
    previous.source !== next.source ||
    previous.target !== next.target ||
    previousStyle.stroke !== nextStyle.stroke ||
    previousStyle.lineWidth !== nextStyle.lineWidth ||
    previousStyle.opacity !== nextStyle.opacity ||
    previousStyle.objectMapEdgeDetailLevel !== nextStyle.objectMapEdgeDetailLevel ||
    objectMapPathChanged(previousStyle.objectMapPath, nextStyle.objectMapPath) ||
    lineDashChanged(previousStyle.lineDash, nextStyle.lineDash) ||
    previous.data?.label !== next.data?.label ||
    previous.data?.type !== next.data?.type ||
    previous.data?.tracedBy !== next.data?.tracedBy ||
    JSON.stringify(previous.data?.filteredPath) !== JSON.stringify(next.data?.filteredPath) ||
    previous.data?.midX !== next.data?.midX ||
    previous.data?.midY !== next.data?.midY ||
    previous.data?.path !== next.data?.path
  );
};

export const applyGraphData = async (
  graph: Graph,
  previousData: GraphData,
  nextData: GraphData,
  options: { preserveViewportNodeId?: string | null } = {}
): Promise<void> => {
  const previousNodes = graphNodes(previousData);
  const nextNodes = graphNodes(nextData);
  const previousEdges = graphEdges(previousData);
  const nextEdges = graphEdges(nextData);
  const previousViewportPoint = nodeViewportPoint(
    graph,
    previousData,
    options.preserveViewportNodeId
  );
  const preserveViewportForNode = async () => {
    if (!previousViewportPoint) return;
    const nextViewportPoint = nodeViewportPoint(graph, nextData, options.preserveViewportNodeId);
    if (!nextViewportPoint) return;
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

  if (nodeUpdates.length === 0 && edgeUpdates.length === 0) return;
  const patch: { nodes?: NodeData[]; edges?: EdgeData[] } = {};
  if (nodeUpdates.length > 0) patch.nodes = nodeUpdates;
  if (edgeUpdates.length > 0) patch.edges = edgeUpdates;
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
  if (graph.destroyed) return;
  const states: Record<string, string[]> = {};
  const hoveredEdge = hoveredEdgeId ? findEdge(layout, hoveredEdgeId) : null;
  const hoveredNodeIds = new Set(hoveredEdge ? [hoveredEdge.sourceId, hoveredEdge.targetId] : []);
  layout.nodes.forEach((node) => {
    const nodeStates = objectMapG6NodeState(node, selectionState);
    states[node.id] = hoveredNodeIds.has(node.id) ? [...nodeStates, 'edgeHovered'] : nodeStates;
  });
  layout.edges.forEach((edge) => {
    const edgeStates = objectMapG6EdgeState(edge, selectionState);
    states[edge.id] = edge.id === hoveredEdgeId ? [...edgeStates, 'hovered'] : edgeStates;
  });
  if (graph.destroyed) return;
  await graph.setElementState(states, false);
};

interface ApplySlot<T> {
  version: number;
  applying: boolean;
  latest: T | null;
}

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
  onGraphDataError,
  onSelectionStateError,
  onGraphDataTiming,
  onSelectionStateTiming,
  applyGraphDataFn = applyGraphData,
  applySelectionStateFn = applySelectionState,
}: ObjectMapG6ApplyQueueOptions): ObjectMapG6ApplyQueue => {
  let graphReady = false;
  let renderedData: GraphData | null = null;
  const selectionApply: ApplySlot<{
    layout: ObjectMapLayout;
    selectionState: ObjectMapSelectionState;
  }> = {
    version: 0,
    applying: false,
    latest: null,
  };
  const dataApply: ApplySlot<GraphData> = {
    version: 0,
    applying: false,
    latest: null,
  };

  const scheduleSelectionState = (
    nextLayout: ObjectMapLayout,
    nextSelectionState: ObjectMapSelectionState
  ) => {
    const graph = getGraph();
    if (!graph || graph.destroyed) return;
    if (!graphReady) {
      selectionApply.latest = {
        layout: nextLayout,
        selectionState: nextSelectionState,
      };
      return;
    }

    selectionApply.version += 1;
    selectionApply.latest = { layout: nextLayout, selectionState: nextSelectionState };
    if (selectionApply.applying) return;
    selectionApply.applying = true;

    const run = async () => {
      try {
        while (selectionApply.latest && !graph.destroyed) {
          const requestedVersion = selectionApply.version;
          const latest = selectionApply.latest;
          selectionApply.latest = null;
          const startedAt = objectMapApplyTimingNow();
          await applySelectionStateFn(
            graph,
            latest.layout,
            latest.selectionState,
            getHoveredEdgeId()
          );
          onSelectionStateTiming?.({
            durationMs: objectMapApplyTimingNow() - startedAt,
            nodes: latest.layout.nodes.length,
            edges: latest.layout.edges.length,
          });
          if (selectionApply.version === requestedVersion) {
            break;
          }
        }
      } catch (error) {
        if (getGraph() === graph && !graph.destroyed) {
          onSelectionStateError?.(error);
        }
      } finally {
        selectionApply.applying = false;
        if (selectionApply.latest && graphReady && !graph.destroyed) {
          scheduleSelectionState(
            selectionApply.latest.layout,
            selectionApply.latest.selectionState
          );
        }
      }
    };
    void run();
  };

  const scheduleGraphData = (nextData: GraphData) => {
    const graph = getGraph();
    if (!graph || graph.destroyed) return;
    dataApply.version += 1;
    dataApply.latest = nextData;
    if (!graphReady) return;
    if (dataApply.applying) return;
    dataApply.applying = true;

    const run = async () => {
      try {
        while (dataApply.latest && !graph.destroyed) {
          const requestedVersion = dataApply.version;
          const latest = dataApply.latest;
          dataApply.latest = null;
          const startedAt = objectMapApplyTimingNow();
          let mode: ObjectMapG6GraphDataTiming['mode'] = 'update';
          if (renderedData) {
            await applyGraphDataFn(graph, renderedData, latest, {
              preserveViewportNodeId: getPreserveViewportNodeId(),
            });
          } else {
            mode = 'initial-render';
            graph.setData(latest);
            await graph.render();
          }
          onGraphDataTiming?.({
            durationMs: objectMapApplyTimingNow() - startedAt,
            mode,
            nodes: latest.nodes?.length ?? 0,
            edges: latest.edges?.length ?? 0,
          });
          if (graph.destroyed) return;
          renderedData = latest;
          scheduleSelectionState(getCurrentLayout(), getCurrentSelectionState());
          if (dataApply.version === requestedVersion) {
            break;
          }
        }
      } catch (error) {
        if (getGraph() === graph && !graph.destroyed) {
          onGraphDataError?.(error);
        }
      } finally {
        dataApply.applying = false;
        if (dataApply.latest && graphReady && !graph.destroyed) {
          scheduleGraphData(dataApply.latest);
        }
      }
    };
    void run();
  };

  const setReady = (ready: boolean) => {
    graphReady = ready;
    if (!graphReady) return;
    if (dataApply.latest) {
      scheduleGraphData(dataApply.latest);
      return;
    }
    if (selectionApply.latest) {
      scheduleSelectionState(selectionApply.latest.layout, selectionApply.latest.selectionState);
    }
  };

  const clear = () => {
    graphReady = false;
    renderedData = null;
    selectionApply.latest = null;
    selectionApply.applying = false;
    dataApply.latest = null;
    dataApply.applying = false;
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
