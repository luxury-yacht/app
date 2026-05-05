/**
 * frontend/src/modules/object-map/ObjectMapG6Renderer.tsx
 *
 * G6-backed object-map renderer. Owns graph lifecycle and delegates data
 * patching, event translation, palette reading, viewport helpers, and tooltip
 * rendering to focused helpers.
 */

import type { Graph, GraphData } from '@antv/g6';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveKindBadgeVisualStyle } from '@shared/utils/kindBadgeColors';
import type { ObjectMapLayout } from './objectMapLayout';
import { createObjectMapG6ApplyQueue, type ObjectMapG6ApplyQueue } from './objectMapG6ApplyQueue';
import { toObjectMapG6Data } from './objectMapG6Data';
import { ObjectMapG6TooltipOverlay } from './ObjectMapG6TooltipOverlay';
import type { ObjectMapG6EventHandlers } from './objectMapG6EventBindings';
import { objectMapG6EdgeOptions, objectMapG6NodeOptions } from './objectMapG6RendererOptions';
import { computeObjectMapTooltipLayout } from './objectMapG6Tooltip';
import { createObjectMapNodeGestureState } from './objectMapNodeGesture';
import { useObjectMapG6GraphLifecycle } from './useObjectMapG6GraphLifecycle';
import { useObjectMapG6Palette } from './useObjectMapG6Palette';
import { useObjectMapG6Viewport } from './useObjectMapG6Viewport';
import type {
  ObjectMapHoverEdge,
  ObjectMapContextMenuAction,
  ObjectMapCanvasContextMenuAction,
  ObjectMapNodeBadgeLookup,
  ObjectMapNodeDragEnd,
  ObjectMapNodeDragMove,
  ObjectMapNodeDragStart,
  ObjectMapObjectAction,
  ObjectMapSelectionState,
  ObjectMapViewportChangeAction,
  ObjectMapViewportControls,
} from './objectMapRendererTypes';

const EMPTY_SELECTION_STATE: ObjectMapSelectionState = {
  activeId: null,
  connectedIds: new Set(),
  connectedEdgeIds: new Set(),
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
  onUserViewportChange,
  onViewportControlsChange,
}) => {
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
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
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
  const data = useMemo<GraphData>(() => {
    if (!palette) {
      return { nodes: [], edges: [] };
    }
    const badgeStyleCache = new Map<string, ReturnType<typeof resolveKindBadgeVisualStyle>>();
    return toObjectMapG6Data(
      layout,
      EMPTY_SELECTION_STATE,
      badgeForNode,
      palette,
      (kind) => {
        const key = `${styleVersion}:${kind.trim()}`;
        const cached = badgeStyleCache.get(key);
        if (cached) return cached;
        const resolved = resolveKindBadgeVisualStyle(kind, containerRef.current);
        badgeStyleCache.set(key, resolved);
        return resolved;
      },
      useShortResourceNames
    );
  }, [layout, badgeForNode, palette, styleVersion, useShortResourceNames]);
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
    onUserViewportChangeRef,
    paletteReady,
    paletteRef,
    selectionStateRef,
    scheduleSelectionState,
    updateTooltipPosition,
  });

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || graph.destroyed || !palette || !applyQueue.isReady()) return;
    graph.setNode(objectMapG6NodeOptions(palette));
    graph.setEdge(objectMapG6EdgeOptions(palette));
  }, [applyQueue, palette]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || graph.destroyed || !palette) return;
    scheduleGraphData(data);
  }, [data, palette, scheduleGraphData]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || graph.destroyed) return;
    scheduleSelectionState(layout, selectionState);
  }, [layout, scheduleSelectionState, selectionState]);

  useObjectMapG6Viewport({
    autoFit,
    containerRef,
    data,
    graphRef,
    onUserViewportChangeRef,
    onViewportControlsChange,
    palette,
    paletteRef,
    updateTooltipPosition,
  });

  useEffect(() => {
    updateTooltipPosition();
  }, [hoverEdge, updateTooltipPosition]);

  const tooltipText = useMemo(() => {
    if (!palette || !hoverEdge) return null;
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
      <svg className="object-map__g6-overlay" width="100%" height="100%" aria-hidden="true">
        {palette && tooltipText && tooltipPosition && (
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
