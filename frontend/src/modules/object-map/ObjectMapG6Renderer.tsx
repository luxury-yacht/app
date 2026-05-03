import { Graph, CanvasEvent, EdgeEvent, GraphEvent, NodeEvent } from '@antv/g6';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ObjectMapReference } from '@core/refresh/types';
import type { ObjectMapLayout, PositionedEdge, PositionedNode } from './objectMapLayout';
import { ensureObjectMapG6CardNodeRegistered } from './objectMapG6CardNode';
import { OBJECT_MAP_G6_CARD_NODE } from './objectMapG6Constants';
import { toObjectMapG6Data } from './objectMapG6Data';
import type {
  ObjectMapHoverEdge,
  ObjectMapNodeBadgeLookup,
  ObjectMapNodeDragEnd,
  ObjectMapNodeDragMove,
  ObjectMapNodeDragStart,
  ObjectMapObjectAction,
  ObjectMapSelectionState,
  ObjectMapViewportControls,
} from './objectMapRendererTypes';

const TOOLTIP_WIDTH = 200;
const TOOLTIP_HEIGHT_SINGLE = 28;
const TOOLTIP_HEIGHT_DOUBLE = 44;
const TOOLTIP_LABEL_MAX_CHARS = 30;
const TOOLTIP_TRACE_MAX_CHARS = 36;

const findNode = (layout: ObjectMapLayout, id: string): PositionedNode | null =>
  layout.nodes.find((node) => node.id === id) ?? null;

const findEdge = (layout: ObjectMapLayout, id: string): PositionedEdge | null =>
  layout.edges.find((edge) => edge.id === id) ?? null;

type G6ElementPointerEvent = {
  target: { id: string };
  pointerId?: number;
  button?: number;
  clientX: number;
  clientY: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
};

const toObjectMapPointer = (event: G6ElementPointerEvent) => ({
  pointerId: event.pointerId ?? 1,
  button: event.button,
  clientX: event.clientX,
  clientY: event.clientY,
});

const truncate = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}\u2026`;
};

export interface ObjectMapG6RendererProps {
  layout: ObjectMapLayout;
  selectionState: ObjectMapSelectionState;
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
  onNavigateView?: ObjectMapObjectAction;
  autoFit: boolean;
  onViewportControlsChange?: (controls: ObjectMapViewportControls | null) => void;
}

const ObjectMapG6Renderer: React.FC<ObjectMapG6RendererProps> = ({
  layout,
  selectionState,
  hoverEdge,
  onHoverEdge,
  onClearHoverEdge,
  badgeForNode,
  onSelectNode,
  onNodeDragStart,
  onNodeDragMove,
  onNodeDragEnd,
  onClearSelection,
  onOpenPanel,
  onNavigateView,
  autoFit,
  onViewportControlsChange,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const hoverEdgeRef = useRef(hoverEdge);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const handlersRef = useRef({
    onHoverEdge,
    onClearHoverEdge,
    onSelectNode,
    onClearSelection,
    onOpenPanel,
    onNavigateView,
    onNodeDragStart,
    onNodeDragMove,
    onNodeDragEnd,
  });
  handlersRef.current = {
    onHoverEdge,
    onClearHoverEdge,
    onSelectNode,
    onClearSelection,
    onOpenPanel,
    onNavigateView,
    onNodeDragStart,
    onNodeDragMove,
    onNodeDragEnd,
  };
  const data = useMemo(
    () => toObjectMapG6Data(layout, selectionState, badgeForNode),
    [layout, selectionState, badgeForNode]
  );
  const dataRef = useRef(data);
  dataRef.current = data;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  hoverEdgeRef.current = hoverEdge;

  const updateTooltipPosition = useCallback(() => {
    const graph = graphRef.current;
    const edge = hoverEdgeRef.current;
    if (!graph || graph.destroyed || !edge) {
      setTooltipPosition(null);
      return;
    }
    const [x, y] = graph.getViewportByCanvas([edge.midX, edge.midY]);
    setTooltipPosition({ x, y });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    ensureObjectMapG6CardNodeRegistered();
    const graph = new Graph({
      container,
      autoResize: true,
      animation: false,
      layout: { type: 'preset' },
      data: dataRef.current,
      behaviors: [
        'drag-canvas',
        'zoom-canvas',
        { type: 'drag-element', animation: false, hideEdge: 'none' },
      ],
      node: {
        type: OBJECT_MAP_G6_CARD_NODE,
        state: {
          selected: { stroke: '#2563eb', lineWidth: 2.5 },
          connected: { stroke: '#2563eb', lineWidth: 1.5 },
          dimmed: { opacity: 0.25 },
          seed: { stroke: '#2563eb', lineWidth: 2 },
        },
      },
      edge: {
        type: 'line',
        state: {
          highlighted: { lineWidth: 2.5 },
          dimmed: { opacity: 0.15 },
        },
      },
    });
    graphRef.current = graph;

    graph.on(NodeEvent.CLICK, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      const id = event.target.id;
      const node = findNode(layoutRef.current, id);
      if (!node) return;
      const { onOpenPanel, onNavigateView, onSelectNode } = handlersRef.current;
      if (event.metaKey || event.ctrlKey) {
        if (onOpenPanel) onOpenPanel(node.ref as ObjectMapReference);
        return;
      }
      if (event.altKey) {
        if (onNavigateView) onNavigateView(node.ref as ObjectMapReference);
        return;
      }
      onSelectNode(id);
    });

    graph.on(NodeEvent.DRAG_START, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      const node = findNode(layoutRef.current, event.target.id);
      if (!node) return;
      handlersRef.current.onNodeDragStart(node, toObjectMapPointer(event));
    });

    graph.on(NodeEvent.DRAG, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      handlersRef.current.onNodeDragMove(toObjectMapPointer(event));
    });

    graph.on(NodeEvent.DRAG_END, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      handlersRef.current.onNodeDragEnd(toObjectMapPointer(event));
    });

    graph.on(EdgeEvent.POINTER_ENTER, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      const edge = findEdge(layoutRef.current, event.target.id);
      if (!edge) return;
      handlersRef.current.onHoverEdge({
        midX: edge.midX,
        midY: edge.midY,
        label: edge.label,
        type: edge.type,
        tracedBy: edge.tracedBy,
      });
    });
    graph.on(EdgeEvent.POINTER_LEAVE, () => handlersRef.current.onClearHoverEdge());
    graph.on(CanvasEvent.CLICK, () => handlersRef.current.onClearSelection());
    graph.on(GraphEvent.AFTER_TRANSFORM, updateTooltipPosition);
    graph.on(GraphEvent.AFTER_SIZE_CHANGE, updateTooltipPosition);

    void graph.render();
    return () => {
      graph.destroy();
      graphRef.current = null;
    };
  }, [updateTooltipPosition]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || graph.destroyed) return;
    graph.setData(data);
    void graph.draw();
  }, [data]);

  useEffect(() => {
    if (!onViewportControlsChange) return;
    const controls: ObjectMapViewportControls = {
      zoomIn: () => {
        const graph = graphRef.current;
        if (!graph || graph.destroyed) return;
        void graph.zoomBy(1.2, false);
      },
      zoomOut: () => {
        const graph = graphRef.current;
        if (!graph || graph.destroyed) return;
        void graph.zoomBy(0.8, false);
      },
      fitToView: () => {
        const graph = graphRef.current;
        if (!graph || graph.destroyed) return;
        void graph.fitView({ when: 'always', direction: 'both' }, false);
      },
    };
    onViewportControlsChange(controls);
    return () => onViewportControlsChange(null);
  }, [onViewportControlsChange]);

  useEffect(() => {
    if (!autoFit) return;
    const graph = graphRef.current;
    if (!graph || graph.destroyed) return;
    void graph.fitView({ when: 'always', direction: 'both' }, false);
  }, [autoFit, data]);

  useEffect(() => {
    updateTooltipPosition();
  }, [hoverEdge, updateTooltipPosition]);

  return (
    <div className="object-map__g6-stack">
      <div ref={containerRef} className="object-map__g6" data-testid="object-map-g6" />
      <svg className="object-map__g6-overlay" width="100%" height="100%" aria-hidden="true">
        {hoverEdge && tooltipPosition && (
          <g
            className="object-map__edge-tooltip"
            transform={`translate(${tooltipPosition.x} ${tooltipPosition.y})`}
          >
            <rect
              className="object-map__edge-tooltip-bg"
              x={-TOOLTIP_WIDTH / 2}
              y={hoverEdge.tracedBy ? -TOOLTIP_HEIGHT_DOUBLE - 4 : -TOOLTIP_HEIGHT_SINGLE - 4}
              width={TOOLTIP_WIDTH}
              height={hoverEdge.tracedBy ? TOOLTIP_HEIGHT_DOUBLE : TOOLTIP_HEIGHT_SINGLE}
              rx={4}
              ry={4}
            />
            <text
              className="object-map__edge-tooltip-label"
              x={0}
              y={hoverEdge.tracedBy ? -28 : -14}
              textAnchor="middle"
            >
              {truncate(hoverEdge.label, TOOLTIP_LABEL_MAX_CHARS)}
            </text>
            {hoverEdge.tracedBy && (
              <text className="object-map__edge-tooltip-trace" x={0} y={-12} textAnchor="middle">
                {truncate(hoverEdge.tracedBy, TOOLTIP_TRACE_MAX_CHARS)}
              </text>
            )}
          </g>
        )}
      </svg>
    </div>
  );
};

export default ObjectMapG6Renderer;
