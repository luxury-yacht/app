/**
 * frontend/src/modules/object-map/ObjectMapG6Renderer.tsx
 *
 * G6-backed object-map renderer. Owns graph lifecycle and delegates data
 * patching, event translation, palette reading, viewport helpers, and tooltip
 * rendering to focused helpers.
 */

import type { Graph, GraphData } from '@antv/g6';
import { GraphEvent } from '@antv/g6';
import { useZoom } from '@core/contexts/ZoomContext';
import { parseAgeTimestampMillis, useAgeClock } from '@shared/hooks/useAgeClock';

import { resolveKindBadgeVisualStyle } from '@shared/utils/kindBadgeColors';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ObjectMapG6TooltipOverlay } from './ObjectMapG6TooltipOverlay';
import {
  type ObjectMapRendererDebugSnapshot,
  publishObjectMapRendererDebugSnapshot,
} from './objectMapDebugStore';
import { createObjectMapG6ApplyQueue, type ObjectMapG6ApplyQueue } from './objectMapG6ApplyQueue';
import {
  type ObjectMapG6CardDetailLevel,
  type ObjectMapG6EdgeDetailLevel,
  objectMapG6CardDetailLevelForZoom,
} from './objectMapG6Constants';
import { toObjectMapG6Data } from './objectMapG6Data';
import type { ObjectMapG6EventHandlers } from './objectMapG6EventBindings';
import { objectMapG6EdgeOptions, objectMapG6NodeOptions } from './objectMapG6RendererOptions';
import { computeObjectMapTooltipLayout } from './objectMapG6Tooltip';
import type { ObjectMapLayout } from './objectMapLayout';
import { createObjectMapNodeGestureState } from './objectMapNodeGesture';
import type {
  ObjectMapCanvasContextMenuAction,
  ObjectMapContextMenuAction,
  ObjectMapHoverEdge,
  ObjectMapNodeBadgeLookup,
  ObjectMapNodeDragEnd,
  ObjectMapNodeDragMove,
  ObjectMapNodeDragStart,
  ObjectMapObjectAction,
  ObjectMapSelectionState,
  ObjectMapViewportChangeAction,
  ObjectMapViewportControls,
} from './objectMapRendererTypes';
import { useObjectMapG6GraphLifecycle } from './useObjectMapG6GraphLifecycle';
import { useObjectMapG6Palette } from './useObjectMapG6Palette';
import { useObjectMapG6Viewport } from './useObjectMapG6Viewport';

const EMPTY_SELECTION_STATE: ObjectMapSelectionState = {
  activeId: null,
  connectedIds: new Set(),
  connectedEdgeIds: new Set(),
};

const OBJECT_MAP_DEBUG_GRID_MIN_SCREEN_SPACING = 48;
const OBJECT_MAP_DEBUG_GRID_MAX_SCREEN_SPACING = 160;
const OBJECT_MAP_DEBUG_GRID_MAX_LINES = 120;
const OBJECT_MAP_SIMPLE_EDGE_NODE_THRESHOLD = 300;
const OBJECT_MAP_SIMPLE_EDGE_EDGE_THRESHOLD = 600;

const objectMapRendererTimingNow = (): number =>
  typeof performance === 'undefined' ? Date.now() : performance.now();

interface ObjectMapDebugGridLine {
  value: number;
  screen: number;
  major: boolean;
  origin: boolean;
}

interface ObjectMapDebugGridState {
  size: [number, number];
  zoom: number;
  origin: [number, number];
  verticalLines: ObjectMapDebugGridLine[];
  horizontalLines: ObjectMapDebugGridLine[];
}

const objectMapDebugGridSpacing = (zoom: number): number => {
  let spacing = 100;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  while (spacing * safeZoom < OBJECT_MAP_DEBUG_GRID_MIN_SCREEN_SPACING) {
    spacing *= 2;
  }
  while (spacing * safeZoom > OBJECT_MAP_DEBUG_GRID_MAX_SCREEN_SPACING && spacing > 25) {
    spacing /= 2;
  }
  return spacing;
};

const isObjectMapDebugGridMajorLine = (value: number, spacing: number): boolean => {
  if (value === 0) {
    return true;
  }
  return Math.abs(Math.round(value / spacing)) % 5 === 0;
};

const computeObjectMapDebugGridState = (graph: Graph): ObjectMapDebugGridState | null => {
  if (graph.destroyed) {
    return null;
  }
  const [width, height] = graph.getSize();
  if (width <= 0 || height <= 0) {
    return null;
  }
  const zoom = graph.getZoom();
  const spacing = objectMapDebugGridSpacing(zoom);
  const topLeft = graph.getCanvasByViewport([0, 0]);
  const bottomRight = graph.getCanvasByViewport([width, height]);
  const minCanvasX = Math.floor(Math.min(topLeft[0], bottomRight[0]) / spacing) * spacing;
  const maxCanvasX = Math.ceil(Math.max(topLeft[0], bottomRight[0]) / spacing) * spacing;
  const minCanvasY = Math.floor(Math.min(topLeft[1], bottomRight[1]) / spacing) * spacing;
  const maxCanvasY = Math.ceil(Math.max(topLeft[1], bottomRight[1]) / spacing) * spacing;
  const origin = graph.getViewportByCanvas([0, 0]);
  const verticalLines: ObjectMapDebugGridLine[] = [];
  const horizontalLines: ObjectMapDebugGridLine[] = [];

  for (
    let x = minCanvasX;
    x <= maxCanvasX && verticalLines.length < OBJECT_MAP_DEBUG_GRID_MAX_LINES;
    x += spacing
  ) {
    const viewportPoint = graph.getViewportByCanvas([x, 0]);
    if (Number.isFinite(viewportPoint[0])) {
      verticalLines.push({
        value: x,
        screen: viewportPoint[0],
        major: isObjectMapDebugGridMajorLine(x, spacing),
        origin: x === 0,
      });
    }
  }

  for (
    let y = minCanvasY;
    y <= maxCanvasY && horizontalLines.length < OBJECT_MAP_DEBUG_GRID_MAX_LINES;
    y += spacing
  ) {
    const viewportPoint = graph.getViewportByCanvas([0, y]);
    if (Number.isFinite(viewportPoint[1])) {
      horizontalLines.push({
        value: y,
        screen: viewportPoint[1],
        major: isObjectMapDebugGridMajorLine(y, spacing),
        origin: y === 0,
      });
    }
  }

  return {
    size: [width, height],
    zoom,
    origin: [origin[0], origin[1]],
    verticalLines,
    horizontalLines,
  };
};

const ObjectMapDebugGridOverlay: React.FC<{ grid: ObjectMapDebugGridState }> = ({ grid }) => {
  const [width, height] = grid.size;
  const originVisible =
    grid.origin[0] >= 0 &&
    grid.origin[0] <= width &&
    grid.origin[1] >= 0 &&
    grid.origin[1] <= height;

  return (
    <svg
      className="object-map__debug-grid"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      aria-hidden="true"
    >
      {grid.verticalLines.map((line) => (
        <line
          key={`x-${line.value}`}
          className={
            line.origin
              ? 'object-map__debug-grid-axis'
              : line.major
                ? 'object-map__debug-grid-line object-map__debug-grid-line--major'
                : 'object-map__debug-grid-line'
          }
          x1={line.screen}
          y1={0}
          x2={line.screen}
          y2={height}
        />
      ))}
      {grid.horizontalLines.map((line) => (
        <line
          key={`y-${line.value}`}
          className={
            line.origin
              ? 'object-map__debug-grid-axis'
              : line.major
                ? 'object-map__debug-grid-line object-map__debug-grid-line--major'
                : 'object-map__debug-grid-line'
          }
          x1={0}
          y1={line.screen}
          x2={width}
          y2={line.screen}
        />
      ))}
      {grid.verticalLines
        .filter((line) => line.major && line.screen >= 0 && line.screen <= width)
        .map((line) => (
          <text
            key={`x-label-${line.value}`}
            className="object-map__debug-grid-label"
            x={line.screen + 3}
            y={12}
          >
            x {Math.round(line.value)}
          </text>
        ))}
      {grid.horizontalLines
        .filter((line) => line.major && line.screen >= 0 && line.screen <= height)
        .map((line) => (
          <text
            key={`y-label-${line.value}`}
            className="object-map__debug-grid-label"
            x={4}
            y={line.screen - 3}
          >
            y {Math.round(line.value)}
          </text>
        ))}
      {!!originVisible && (
        <g transform={`translate(${grid.origin[0]} ${grid.origin[1]})`}>
          <circle className="object-map__debug-grid-origin" r={4} />
          <text className="object-map__debug-grid-origin-label" x={7} y={-7}>
            0,0
          </text>
        </g>
      )}
      <text className="object-map__debug-grid-zoom" x={8} y={height - 8}>
        zoom {grid.zoom.toFixed(3)}
      </text>
    </svg>
  );
};

export interface ObjectMapG6RendererProps {
  layout: ObjectMapLayout;
  selectionState: ObjectMapSelectionState;
  useShortResourceNames?: boolean;
  hoverEdge: ObjectMapHoverEdge | null;
  onHoverEdge: (edge: ObjectMapHoverEdge) => void;
  onClearHoverEdge: () => void;
  badgeForNode: ObjectMapNodeBadgeLookup;
  onSelectNode: (id: string) => void;
  onToggleGroup: (deploymentId: string) => void;
  onNodeDragStart: ObjectMapNodeDragStart;
  onNodeDragMove: ObjectMapNodeDragMove;
  onNodeDragEnd: ObjectMapNodeDragEnd;
  onClearSelection: () => void;
  onOpenPanel?: ObjectMapObjectAction;
  onOpenObjectMap?: ObjectMapObjectAction;
  onNavigateView?: ObjectMapObjectAction;
  onNodeContextMenu?: ObjectMapContextMenuAction;
  onCanvasContextMenu?: ObjectMapCanvasContextMenuAction;
  autoFit: boolean;
  preserveViewportNodeId?: string | null;
  debugMapId?: string;
  showDebugGrid?: boolean;
  onUserViewportChange?: ObjectMapViewportChangeAction;
  onViewportControlsChange?: (controls: ObjectMapViewportControls | null) => void;
}

const ObjectMapG6Renderer: React.FC<ObjectMapG6RendererProps> = ({
  layout,
  selectionState,
  useShortResourceNames = false,
  hoverEdge,
  onHoverEdge,
  onClearHoverEdge,
  badgeForNode,
  onSelectNode,
  onToggleGroup,
  onNodeDragStart,
  onNodeDragMove,
  onNodeDragEnd,
  onClearSelection,
  onOpenPanel,
  onOpenObjectMap,
  onNavigateView,
  onNodeContextMenu,
  onCanvasContextMenu,
  autoFit,
  preserveViewportNodeId = null,
  debugMapId,
  showDebugGrid = false,
  onUserViewportChange,
  onViewportControlsChange,
}) => {
  const { zoomLevel } = useZoom();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const hoverEdgeRef = useRef(hoverEdge);
  const hoveredEdgeIdRef = useRef<string | null>(null);
  const ignoreNextCanvasClickRef = useRef(false);
  const nodeGestureRef = useRef(createObjectMapNodeGestureState());
  const applyQueueRef = useRef<ObjectMapG6ApplyQueue | null>(null);
  const { palette, paletteReady, paletteRef, styleVersion } = useObjectMapG6Palette(containerRef);
  const onUserViewportChangeRef = useRef(onUserViewportChange);
  onUserViewportChangeRef.current = onUserViewportChange;
  const [graphReady, setGraphReady] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const [debugGrid, setDebugGrid] = useState<ObjectMapDebugGridState | null>(null);
  const [cardDetailLevel, setCardDetailLevel] = useState<ObjectMapG6CardDetailLevel>('full');
  const rendererTimingsRef = useRef<ObjectMapRendererDebugSnapshot['timings']>({
    g6DataMs: null,
    graphDataApplyMs: null,
    graphDataApplyMode: null,
    selectionStateApplyMs: null,
  });
  const publishRendererDebugSnapshotRef = useRef<() => void>(() => undefined);
  const handlersRef = useRef<ObjectMapG6EventHandlers>({
    onHoverEdge,
    onClearHoverEdge,
    onSelectNode,
    onClearSelection,
    onOpenPanel,
    onOpenObjectMap,
    onNavigateView,
    onNodeContextMenu,
    onCanvasContextMenu,
    onNodeDragStart,
    onNodeDragMove,
    onNodeDragEnd,
    onToggleGroup,
    badgeForNode,
  });
  handlersRef.current = {
    onHoverEdge,
    onClearHoverEdge,
    onSelectNode,
    onClearSelection,
    onOpenPanel,
    onOpenObjectMap,
    onNavigateView,
    onNodeContextMenu,
    onCanvasContextMenu,
    onNodeDragStart,
    onNodeDragMove,
    onNodeDragEnd,
    onToggleGroup,
    badgeForNode,
  };
  const edgeDetailLevel = useMemo<ObjectMapG6EdgeDetailLevel>(
    () =>
      layout.nodes.length >= OBJECT_MAP_SIMPLE_EDGE_NODE_THRESHOLD ||
      layout.edges.length >= OBJECT_MAP_SIMPLE_EDGE_EDGE_THRESHOLD
        ? 'simple'
        : 'routed',
    [layout.edges.length, layout.nodes.length]
  );
  const newestCreationTimestamp = useMemo(() => {
    let newest: number | null = null;
    for (const node of layout.nodes) {
      const timestamp = parseAgeTimestampMillis(node.creationTimestamp);
      if (timestamp !== null && (newest === null || timestamp > newest)) {
        newest = timestamp;
      }
    }
    return newest;
  }, [layout.nodes]);
  const ageNow = useAgeClock(newestCreationTimestamp);
  const dataResult = useMemo<{ data: GraphData; durationMs: number }>(() => {
    const startedAt = objectMapRendererTimingNow();
    if (!palette) {
      return {
        data: { nodes: [], edges: [] },
        durationMs: objectMapRendererTimingNow() - startedAt,
      };
    }
    const badgeStyleCache = new Map<string, ReturnType<typeof resolveKindBadgeVisualStyle>>();
    const nextData = toObjectMapG6Data(layout, EMPTY_SELECTION_STATE, badgeForNode, palette, {
      kindBadgeStyleForKind: (kind) => {
        const key = `${styleVersion}:${kind.trim()}`;
        const cached = badgeStyleCache.get(key);
        if (cached) {
          return cached;
        }
        const resolved = resolveKindBadgeVisualStyle(kind, containerRef.current);
        badgeStyleCache.set(key, resolved);
        return resolved;
      },
      useShortResourceNames,
      cardDetailLevel,
      edgeDetailLevel,
      ageNow,
    });
    return { data: nextData, durationMs: objectMapRendererTimingNow() - startedAt };
  }, [
    ageNow,
    cardDetailLevel,
    edgeDetailLevel,
    layout,
    badgeForNode,
    palette,
    styleVersion,
    useShortResourceNames,
  ]);
  const data = dataResult.data;
  const dataRef = useRef(data);
  dataRef.current = data;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const selectionStateRef = useRef(selectionState);
  selectionStateRef.current = selectionState;
  const preserveViewportNodeIdRef = useRef(preserveViewportNodeId);
  preserveViewportNodeIdRef.current = preserveViewportNodeId;
  hoverEdgeRef.current = hoverEdge;
  if (!applyQueueRef.current) {
    applyQueueRef.current = createObjectMapG6ApplyQueue({
      getGraph: () => graphRef.current,
      getCurrentLayout: () => layoutRef.current,
      getCurrentSelectionState: () => selectionStateRef.current,
      getHoveredEdgeId: () => hoveredEdgeIdRef.current,
      getPreserveViewportNodeId: () => preserveViewportNodeIdRef.current,
      onGraphDataError: (error) => {
        console.error('[ObjectMapG6Renderer] Failed to apply graph data:', error);
      },
      onSelectionStateError: (error) => {
        console.error('[ObjectMapG6Renderer] Failed to apply selection state:', error);
      },
      onGraphDataTiming: (timing) => {
        rendererTimingsRef.current = {
          ...rendererTimingsRef.current,
          graphDataApplyMs: timing.durationMs,
          graphDataApplyMode: timing.mode,
        };
        publishRendererDebugSnapshotRef.current();
      },
      onSelectionStateTiming: (timing) => {
        rendererTimingsRef.current = {
          ...rendererTimingsRef.current,
          selectionStateApplyMs: timing.durationMs,
        };
        publishRendererDebugSnapshotRef.current();
      },
    });
  }
  const applyQueue = applyQueueRef.current;

  const updateTooltipPosition = useCallback(() => {
    const edge = hoverEdgeRef.current;
    if (!edge) {
      setTooltipPosition(null);
      return;
    }
    setTooltipPosition({ x: edge.tooltipX, y: edge.tooltipY });
  }, []);

  const publishRendererDebugSnapshot = useCallback(() => {
    if (!debugMapId) {
      return;
    }
    const graph = graphRef.current;
    let viewport: ObjectMapRendererDebugSnapshot['viewport'] = null;
    if (graphReady && graph && !graph.destroyed) {
      try {
        const zoom = graph.getZoom();
        const position = graph.getPosition();
        const size = graph.getSize();
        viewport =
          Number.isFinite(zoom) &&
          Number.isFinite(position[0]) &&
          Number.isFinite(position[1]) &&
          Number.isFinite(size[0]) &&
          Number.isFinite(size[1])
            ? {
                zoom,
                position: [position[0], position[1]] as [number, number],
                size,
              }
            : null;
      } catch {
        viewport = null;
      }
    }
    publishObjectMapRendererDebugSnapshot(debugMapId, {
      graphReady,
      renderedNodeCount: data.nodes?.length ?? 0,
      renderedEdgeCount: data.edges?.length ?? 0,
      cardDetailLevel,
      edgeDetailLevel,
      viewport,
      timings: {
        ...rendererTimingsRef.current,
        g6DataMs: dataResult.durationMs,
      },
      updatedAt: Date.now(),
    });
  }, [
    cardDetailLevel,
    data.edges?.length,
    data.nodes?.length,
    dataResult.durationMs,
    debugMapId,
    edgeDetailLevel,
    graphReady,
  ]);
  publishRendererDebugSnapshotRef.current = publishRendererDebugSnapshot;

  const updateDebugGrid = useCallback(() => {
    if (!showDebugGrid || !graphReady) {
      setDebugGrid(null);
      return;
    }
    const graph = graphRef.current;
    if (!graph || graph.destroyed) {
      setDebugGrid(null);
      return;
    }
    try {
      setDebugGrid(computeObjectMapDebugGridState(graph));
    } catch {
      setDebugGrid(null);
    }
  }, [graphReady, showDebugGrid]);

  const updateCardDetailLevel = useCallback(() => {
    if (!graphReady) {
      return;
    }
    const graph = graphRef.current;
    if (!graph || graph.destroyed) {
      return;
    }
    try {
      const nextLevel = objectMapG6CardDetailLevelForZoom(graph.getZoom());
      setCardDetailLevel((previous) => (previous === nextLevel ? previous : nextLevel));
    } catch {
      setCardDetailLevel('full');
    }
  }, [graphReady]);

  const scheduleSelectionState = useCallback(
    (nextLayout: ObjectMapLayout, nextSelectionState: ObjectMapSelectionState) => {
      applyQueue.scheduleSelectionState(nextLayout, nextSelectionState);
    },
    [applyQueue]
  );

  const scheduleGraphData = useCallback(
    (nextData: GraphData) => {
      applyQueue.scheduleGraphData(nextData);
    },
    [applyQueue]
  );

  useObjectMapG6GraphLifecycle({
    applyQueue,
    containerRef,
    dataRef,
    graphRef,
    handlersRef,
    hoveredEdgeIdRef,
    ignoreNextCanvasClickRef,
    layoutRef,
    nodeGestureState: nodeGestureRef.current,
    onGraphReadyChange: setGraphReady,
    onUserViewportChangeRef,
    paletteReady,
    paletteRef,
    selectionStateRef,
    scheduleSelectionState,
    updateTooltipPosition,
  });

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || graph.destroyed || !palette || !applyQueue.isReady()) {
      return;
    }
    graph.setNode(objectMapG6NodeOptions(palette));
    graph.setEdge(objectMapG6EdgeOptions(palette));
  }, [applyQueue, palette]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || graph.destroyed || !palette) {
      return;
    }
    scheduleGraphData(data);
  }, [data, palette, scheduleGraphData]);

  useEffect(() => {
    publishRendererDebugSnapshot();
  }, [publishRendererDebugSnapshot]);

  useEffect(() => {
    if (!debugMapId || !graphReady) {
      return;
    }
    const graph = graphRef.current;
    if (!graph || graph.destroyed) {
      return;
    }
    graph.on(GraphEvent.AFTER_TRANSFORM, publishRendererDebugSnapshot);
    graph.on(GraphEvent.AFTER_SIZE_CHANGE, publishRendererDebugSnapshot);
    return () => {
      if (!graph.destroyed) {
        graph.off(GraphEvent.AFTER_TRANSFORM, publishRendererDebugSnapshot);
        graph.off(GraphEvent.AFTER_SIZE_CHANGE, publishRendererDebugSnapshot);
      }
    };
  }, [debugMapId, graphReady, publishRendererDebugSnapshot]);

  useEffect(() => {
    updateCardDetailLevel();
  }, [updateCardDetailLevel]);

  useEffect(() => {
    if (!graphReady) {
      return;
    }
    const graph = graphRef.current;
    if (!graph || graph.destroyed) {
      return;
    }
    graph.on(GraphEvent.AFTER_TRANSFORM, updateCardDetailLevel);
    return () => {
      if (!graph.destroyed) {
        graph.off(GraphEvent.AFTER_TRANSFORM, updateCardDetailLevel);
      }
    };
  }, [graphReady, updateCardDetailLevel]);

  useEffect(() => {
    updateDebugGrid();
  }, [updateDebugGrid]);

  useEffect(() => {
    if (!showDebugGrid || !graphReady) {
      return;
    }
    const graph = graphRef.current;
    if (!graph || graph.destroyed) {
      return;
    }
    graph.on(GraphEvent.AFTER_TRANSFORM, updateDebugGrid);
    graph.on(GraphEvent.AFTER_SIZE_CHANGE, updateDebugGrid);
    return () => {
      if (!graph.destroyed) {
        graph.off(GraphEvent.AFTER_TRANSFORM, updateDebugGrid);
        graph.off(GraphEvent.AFTER_SIZE_CHANGE, updateDebugGrid);
      }
    };
  }, [graphReady, showDebugGrid, updateDebugGrid]);

  useEffect(() => {
    void data;
    if (!showDebugGrid) {
      return;
    }
    const frame = requestAnimationFrame(updateDebugGrid);
    return () => cancelAnimationFrame(frame);
  }, [showDebugGrid, updateDebugGrid, data]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || graph.destroyed) {
      return;
    }
    scheduleSelectionState(layout, selectionState);
  }, [layout, scheduleSelectionState, selectionState]);

  useObjectMapG6Viewport({
    appZoomLevel: zoomLevel,
    autoFit,
    containerRef,
    data,
    graphReady,
    graphRef,
    onUserViewportChangeRef,
    onViewportControlsChange,
    palette,
    paletteRef,
    updateTooltipPosition,
  });

  useEffect(() => {
    void hoverEdge;
    updateTooltipPosition();
  }, [updateTooltipPosition, hoverEdge]);

  const tooltipText = useMemo(() => {
    if (!palette || !hoverEdge) {
      return null;
    }
    return computeObjectMapTooltipLayout({
      hoverEdge,
      palette,
      useShortResourceNames,
      container: containerRef.current,
    });
  }, [hoverEdge, palette, useShortResourceNames]);

  return (
    <div className="object-map__g6-stack">
      <div ref={containerRef} className="object-map__g6" data-testid="object-map-g6" />
      {!!(showDebugGrid && debugGrid) && <ObjectMapDebugGridOverlay grid={debugGrid} />}
      <svg className="object-map__g6-overlay" width="100%" height="100%" aria-hidden="true">
        {!!(palette && tooltipText && tooltipPosition) && (
          <ObjectMapG6TooltipOverlay
            palette={palette}
            tooltipLayout={tooltipText}
            tooltipPosition={tooltipPosition}
          />
        )}
      </svg>
    </div>
  );
};

export default ObjectMapG6Renderer;
