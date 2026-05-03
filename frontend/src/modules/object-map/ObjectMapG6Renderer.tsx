import { Graph, CanvasEvent, CommonEvent, EdgeEvent, GraphEvent, NodeEvent } from '@antv/g6';
import type { EdgeData, GraphData, NodeData } from '@antv/g6';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ObjectMapReference } from '@core/refresh/types';
import type { ObjectMapLayout, PositionedEdge, PositionedNode } from './objectMapLayout';
import { ensureObjectMapG6CardNodeRegistered } from './objectMapG6CardNode';
import { ensureObjectMapG6PathEdgeRegistered } from './objectMapG6PathEdge';
import { OBJECT_MAP_G6_CARD_NODE } from './objectMapG6Constants';
import {
  DEFAULT_OBJECT_MAP_G6_PALETTE,
  objectMapG6EdgeState,
  objectMapG6NodeState,
  toObjectMapG6Data,
} from './objectMapG6Data';
import type { ObjectMapG6Palette } from './objectMapG6Data';
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
const WHEEL_ZOOM_DELTA_LIMIT = 50;
const WHEEL_ZOOM_SENSITIVITY = 1;

const findNode = (layout: ObjectMapLayout, id: string): PositionedNode | null =>
  layout.nodes.find((node) => node.id === id) ?? null;

const findEdge = (layout: ObjectMapLayout, id: string): PositionedEdge | null =>
  layout.edges.find((edge) => edge.id === id) ?? null;

const cssVar = (styles: CSSStyleDeclaration, name: string, fallback: string): string =>
  styles.getPropertyValue(name).trim() || fallback;

const readPalette = (element: HTMLElement): ObjectMapG6Palette => {
  const styles = window.getComputedStyle(element);
  return {
    accent: cssVar(styles, '--color-accent', DEFAULT_OBJECT_MAP_G6_PALETTE.accent),
    accentBg: cssVar(styles, '--color-accent-bg', DEFAULT_OBJECT_MAP_G6_PALETTE.accentBg),
    background: cssVar(styles, '--color-bg', DEFAULT_OBJECT_MAP_G6_PALETTE.background),
    backgroundSecondary: cssVar(
      styles,
      '--color-bg-secondary',
      DEFAULT_OBJECT_MAP_G6_PALETTE.backgroundSecondary
    ),
    border: cssVar(styles, '--color-border', DEFAULT_OBJECT_MAP_G6_PALETTE.border),
    text: cssVar(styles, '--color-text', DEFAULT_OBJECT_MAP_G6_PALETTE.text),
    textSecondary: cssVar(
      styles,
      '--color-text-secondary',
      DEFAULT_OBJECT_MAP_G6_PALETTE.textSecondary
    ),
    textTertiary: cssVar(
      styles,
      '--color-text-tertiary',
      DEFAULT_OBJECT_MAP_G6_PALETTE.textTertiary
    ),
    textInverse: cssVar(styles, '--color-text-inverse', DEFAULT_OBJECT_MAP_G6_PALETTE.textInverse),
    edgeRoutes: DEFAULT_OBJECT_MAP_G6_PALETTE.edgeRoutes,
    edgeEndpoint: DEFAULT_OBJECT_MAP_G6_PALETTE.edgeEndpoint,
    edgeStorage: DEFAULT_OBJECT_MAP_G6_PALETTE.edgeStorage,
    edgeMounts: DEFAULT_OBJECT_MAP_G6_PALETTE.edgeMounts,
    edgeSchedules: cssVar(
      styles,
      '--badge-green-text',
      DEFAULT_OBJECT_MAP_G6_PALETTE.edgeSchedules
    ),
    edgeScales: DEFAULT_OBJECT_MAP_G6_PALETTE.edgeScales,
    edgeUses: cssVar(styles, '--color-text-secondary', DEFAULT_OBJECT_MAP_G6_PALETTE.edgeUses),
    fontFamily: styles.fontFamily || DEFAULT_OBJECT_MAP_G6_PALETTE.fontFamily,
  };
};

const isMacPlatform = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

const isZoomWheelEvent = (event: WheelEvent): boolean => {
  if (isMacPlatform()) {
    return event.metaKey || event.ctrlKey;
  }
  return event.ctrlKey;
};

const wheelZoomRatio = (event: WheelEvent): number => {
  const dominantDelta =
    Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  const clampedDelta = Math.max(
    -WHEEL_ZOOM_DELTA_LIMIT,
    Math.min(WHEEL_ZOOM_DELTA_LIMIT, -dominantDelta)
  );
  return 1 + (clampedDelta * WHEEL_ZOOM_SENSITIVITY) / 100;
};

type G6DisplayObjectTarget = {
  className?: string;
  parentNode?: G6DisplayObjectTarget | null;
};

type G6ElementPointerEvent = {
  target: { id: string };
  targetType?: string;
  originalTarget?: G6DisplayObjectTarget | null;
  pointerId?: number;
  button?: number;
  client?: { x: number; y: number };
  canvas?: { x: number; y: number };
  nativeEvent?: {
    pointerId?: number;
    button?: number;
    clientX?: number;
    clientY?: number;
  };
  clientX?: number;
  clientY?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
};

type ObjectMapPointerInput = {
  pointerId?: number;
  button?: number;
  client?: { x: number; y: number };
  canvas?: { x: number; y: number };
  nativeEvent?: {
    pointerId?: number;
    button?: number;
    clientX?: number;
    clientY?: number;
  };
  clientX?: number;
  clientY?: number;
};

const eventPointerId = (event: ObjectMapPointerInput): number =>
  event.pointerId ?? event.nativeEvent?.pointerId ?? 1;

const eventButton = (event: ObjectMapPointerInput): number =>
  event.button ?? event.nativeEvent?.button ?? 0;

const eventClientPoint = (event: ObjectMapPointerInput): { x: number; y: number } => ({
  x: event.clientX ?? event.client?.x ?? event.nativeEvent?.clientX ?? 0,
  y: event.clientY ?? event.client?.y ?? event.nativeEvent?.clientY ?? 0,
});

const layoutPoint = (
  point: Float32Array | number[] | { x: number; y: number } | null
): { x?: number; y?: number } => {
  if (!point) return {};
  if ('x' in point) return { x: point.x, y: point.y };
  return { x: point[0], y: point[1] };
};

const toObjectMapPointerInput = (event: ObjectMapPointerInput, graph?: Graph) => {
  const client = eventClientPoint(event);
  const layout = layoutPoint(
    event.canvas ??
      (!graph || graph.destroyed ? null : graph.getCanvasByClient([client.x, client.y]))
  );
  return {
    pointerId: eventPointerId(event),
    button: eventButton(event),
    clientX: client.x,
    clientY: client.y,
    layoutX: layout.x,
    layoutY: layout.y,
  };
};

const toObjectMapPointer = (event: G6ElementPointerEvent, graph?: Graph) =>
  toObjectMapPointerInput(event, graph);

const isBadgeEvent = (event: G6ElementPointerEvent): boolean => {
  let target = event.originalTarget;
  for (let depth = 0; target && depth < 8; depth += 1) {
    if (target.className?.startsWith('badge-')) {
      return true;
    }
    target = target.parentNode ?? null;
  }
  return false;
};

const truncate = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}\u2026`;
};

const EMPTY_SELECTION_STATE: ObjectMapSelectionState = {
  activeId: null,
  connectedIds: new Set(),
  connectedEdgeIds: new Set(),
};

const graphNodes = (data: GraphData): NodeData[] => data.nodes ?? [];
const graphEdges = (data: GraphData): EdgeData[] => data.edges ?? [];

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

const badgeText = (node: NodeData): string | undefined => {
  const badges = node.style?.badges;
  if (!Array.isArray(badges)) return undefined;
  return badges.map((badge) => badge?.text).join('|');
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
    previousStyle.opacity !== nextStyle.opacity ||
    previousStyle.cardKindText !== nextStyle.cardKindText ||
    previousStyle.cardNameText !== nextStyle.cardNameText ||
    previousStyle.cardNamespaceText !== nextStyle.cardNamespaceText ||
    badgeText(previous) !== badgeText(next)
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
    lineDashChanged(previousStyle.lineDash, nextStyle.lineDash) ||
    previous.data?.label !== next.data?.label ||
    previous.data?.type !== next.data?.type ||
    previous.data?.tracedBy !== next.data?.tracedBy ||
    previous.data?.midX !== next.data?.midX ||
    previous.data?.midY !== next.data?.midY ||
    previous.data?.path !== next.data?.path
  );
};

const applyGraphData = async (
  graph: Graph,
  previousData: GraphData,
  nextData: GraphData
): Promise<void> => {
  const previousNodes = graphNodes(previousData);
  const nextNodes = graphNodes(nextData);
  const previousEdges = graphEdges(previousData);
  const nextEdges = graphEdges(nextData);

  if (!sameIds(previousNodes, nextNodes) || !sameIds(previousEdges, nextEdges)) {
    graph.setData(nextData);
    await graph.draw();
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
};

const applySelectionState = async (
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
  onToggleGroup,
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
  const hoveredEdgeIdRef = useRef<string | null>(null);
  const ignoreNextCanvasClickRef = useRef(false);
  const manualDragPointerIdRef = useRef<number | null>(null);
  const selectionApplyRef = useRef<{
    version: number;
    applying: boolean;
    latest: { layout: ObjectMapLayout; selectionState: ObjectMapSelectionState } | null;
  }>({
    version: 0,
    applying: false,
    latest: null,
  });
  const dataApplyRef = useRef<{
    version: number;
    applying: boolean;
    latest: GraphData | null;
  }>({
    version: 0,
    applying: false,
    latest: null,
  });
  const [palette, setPalette] = useState<ObjectMapG6Palette | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const graphReadyRef = useRef(false);
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
    onToggleGroup,
    badgeForNode,
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
    onToggleGroup,
    badgeForNode,
  };
  const activePalette = palette ?? DEFAULT_OBJECT_MAP_G6_PALETTE;
  const data = useMemo(
    () => toObjectMapG6Data(layout, EMPTY_SELECTION_STATE, badgeForNode, activePalette),
    [layout, badgeForNode, activePalette]
  );
  const dataRef = useRef(data);
  dataRef.current = data;
  const renderedDataRef = useRef<GraphData | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const selectionStateRef = useRef(selectionState);
  selectionStateRef.current = selectionState;
  hoverEdgeRef.current = hoverEdge;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setPalette(readPalette(container));
  }, []);

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

  const resizeGraphToContainer = useCallback(() => {
    const graph = graphRef.current;
    const container = containerRef.current;
    if (!graph || graph.destroyed || !container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) return;
    const [currentWidth, currentHeight] = graph.getSize();
    if (currentWidth !== width || currentHeight !== height) {
      graph.setSize(width, height);
    }
    if (autoFit) {
      void graph.fitView({ when: 'always', direction: 'both' }, false);
    }
    updateTooltipPosition();
  }, [autoFit, updateTooltipPosition]);

  const scheduleSelectionState = useCallback(
    (nextLayout: ObjectMapLayout, nextSelectionState: ObjectMapSelectionState) => {
      const graph = graphRef.current;
      if (!graph || graph.destroyed) return;
      if (!graphReadyRef.current) {
        selectionApplyRef.current.latest = {
          layout: nextLayout,
          selectionState: nextSelectionState,
        };
        return;
      }
      const ref = selectionApplyRef.current;
      ref.version += 1;
      ref.latest = { layout: nextLayout, selectionState: nextSelectionState };
      if (ref.applying) return;
      ref.applying = true;
      const run = async () => {
        try {
          while (ref.latest && !graph.destroyed) {
            const requestedVersion = ref.version;
            const latest = ref.latest;
            ref.latest = null;
            await applySelectionState(
              graph,
              latest.layout,
              latest.selectionState,
              hoveredEdgeIdRef.current
            );
            if (ref.version === requestedVersion) {
              break;
            }
          }
        } catch (error) {
          if (graphRef.current === graph && !graph.destroyed) {
            console.error('[ObjectMapG6Renderer] Failed to apply selection state:', error);
          }
        } finally {
          ref.applying = false;
          if (ref.latest && graphReadyRef.current && !graph.destroyed) {
            scheduleSelectionState(ref.latest.layout, ref.latest.selectionState);
          }
        }
      };
      void run();
    },
    []
  );

  const scheduleGraphData = useCallback(
    (nextData: GraphData) => {
      const graph = graphRef.current;
      if (!graph || graph.destroyed) return;
      const ref = dataApplyRef.current;
      ref.version += 1;
      ref.latest = nextData;
      if (!graphReadyRef.current) return;
      if (ref.applying) return;
      ref.applying = true;
      const run = async () => {
        try {
          while (ref.latest && !graph.destroyed) {
            const requestedVersion = ref.version;
            const latest = ref.latest;
            ref.latest = null;
            const previousData = renderedDataRef.current;
            if (previousData) {
              await applyGraphData(graph, previousData, latest);
            } else {
              graph.setData(latest);
              await graph.draw();
            }
            if (graph.destroyed) return;
            renderedDataRef.current = latest;
            scheduleSelectionState(layoutRef.current, selectionStateRef.current);
            if (ref.version === requestedVersion) {
              break;
            }
          }
        } catch (error) {
          if (graphRef.current === graph && !graph.destroyed) {
            console.error('[ObjectMapG6Renderer] Failed to apply graph data:', error);
          }
        } finally {
          ref.applying = false;
          if (ref.latest && graphReadyRef.current && !graph.destroyed) {
            scheduleGraphData(ref.latest);
          }
        }
      };
      void run();
    },
    [scheduleSelectionState]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !palette) return;
    ensureObjectMapG6CardNodeRegistered();
    ensureObjectMapG6PathEdgeRegistered();
    const initialData = dataRef.current;
    const graph = new Graph({
      container,
      autoResize: true,
      animation: false,
      data: initialData,
      behaviors: [
        'drag-canvas',
        {
          type: 'scroll-canvas',
          enable: (event: WheelEvent) => !isZoomWheelEvent(event),
          range: Infinity,
        },
      ],
      node: {
        type: OBJECT_MAP_G6_CARD_NODE,
        state: {
          selected: { stroke: palette.accent, lineWidth: 2.5, opacity: 1 },
          connected: { stroke: palette.accent, lineWidth: 1.5, opacity: 1 },
          edgeHovered: { stroke: palette.accent, lineWidth: 2.5, opacity: 1 },
          dimmed: { opacity: 0.25 },
          seed: { stroke: palette.accent, lineWidth: 2, opacity: 1 },
        },
      },
      edge: {
        state: {
          hovered: { lineWidth: 4, opacity: 1 },
          highlighted: { lineWidth: 2.5, opacity: 1 },
          dimmed: { opacity: 0.15 },
        },
      },
    });
    graphRef.current = graph;

    const moveManualNodeDrag = (event: ObjectMapPointerInput) => {
      const pointerId = eventPointerId(event);
      if (manualDragPointerIdRef.current !== pointerId) return;
      handlersRef.current.onNodeDragMove(toObjectMapPointerInput(event, graph));
    };

    const endManualNodeDrag = (event: ObjectMapPointerInput) => {
      const pointerId = eventPointerId(event);
      if (manualDragPointerIdRef.current !== pointerId) return;
      handlersRef.current.onNodeDragEnd(toObjectMapPointerInput(event, graph));
      manualDragPointerIdRef.current = null;
    };

    const setConnectionHoverState = (edge: PositionedEdge, hovered: boolean) => {
      if (graph.destroyed) return;
      const states: Record<string, string[]> = {
        [edge.id]: hovered
          ? [...objectMapG6EdgeState(edge, selectionStateRef.current), 'hovered']
          : objectMapG6EdgeState(edge, selectionStateRef.current),
      };
      [edge.sourceId, edge.targetId].forEach((nodeId) => {
        const node = findNode(layoutRef.current, nodeId);
        if (!node) return;
        const nodeStates = objectMapG6NodeState(node, selectionStateRef.current);
        states[nodeId] = hovered ? [...nodeStates, 'edgeHovered'] : nodeStates;
      });
      void graph.setElementState(states, false).catch((error: unknown) => {
        if (graphRef.current === graph && !graph.destroyed) {
          console.error('[ObjectMapG6Renderer] Failed to apply connection hover state:', error);
        }
      });
    };

    graph.on(NodeEvent.CLICK, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      const id = event.target.id;
      const node = findNode(layoutRef.current, id);
      if (!node) return;
      ignoreNextCanvasClickRef.current = true;
      requestAnimationFrame(() => {
        ignoreNextCanvasClickRef.current = false;
      });
      const { badgeForNode, onOpenPanel, onNavigateView, onSelectNode, onToggleGroup } =
        handlersRef.current;
      if (isBadgeEvent(event)) {
        const badge = badgeForNode(id);
        if (badge) onToggleGroup(badge.deploymentId);
        return;
      }
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

    graph.on(NodeEvent.POINTER_DOWN, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      if (eventButton(event) !== 0 || isBadgeEvent(event)) return;
      const node = findNode(layoutRef.current, event.target.id);
      if (!node) return;
      manualDragPointerIdRef.current = eventPointerId(event);
      handlersRef.current.onNodeDragStart(node, toObjectMapPointer(event, graph));
    });

    graph.on(CommonEvent.DRAG, (rawEvent) => {
      moveManualNodeDrag(rawEvent as G6ElementPointerEvent);
    });

    graph.on(CommonEvent.DRAG_END, (rawEvent) => {
      endManualNodeDrag(rawEvent as G6ElementPointerEvent);
    });

    graph.on(EdgeEvent.POINTER_ENTER, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      const edge = findEdge(layoutRef.current, event.target.id);
      if (!edge) return;
      const previousHoverEdgeId = hoveredEdgeIdRef.current;
      hoveredEdgeIdRef.current = edge.id;
      if (previousHoverEdgeId && previousHoverEdgeId !== edge.id) {
        const previousEdge = findEdge(layoutRef.current, previousHoverEdgeId);
        if (previousEdge) {
          setConnectionHoverState(previousEdge, false);
        }
      }
      setConnectionHoverState(edge, true);
      handlersRef.current.onHoverEdge({
        midX: edge.midX,
        midY: edge.midY,
        label: edge.label,
        type: edge.type,
        tracedBy: edge.tracedBy,
      });
    });
    graph.on(EdgeEvent.POINTER_LEAVE, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      const edge = findEdge(layoutRef.current, event.target.id);
      if (edge && hoveredEdgeIdRef.current === edge.id) {
        hoveredEdgeIdRef.current = null;
        setConnectionHoverState(edge, false);
      }
      handlersRef.current.onClearHoverEdge();
    });
    graph.on(CanvasEvent.CLICK, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      if (event.targetType && event.targetType !== 'canvas') {
        return;
      }
      if (ignoreNextCanvasClickRef.current) {
        ignoreNextCanvasClickRef.current = false;
        return;
      }
      handlersRef.current.onClearSelection();
    });
    graph.on(GraphEvent.AFTER_TRANSFORM, updateTooltipPosition);
    graph.on(GraphEvent.AFTER_SIZE_CHANGE, updateTooltipPosition);

    const handleWheelZoom = (event: WheelEvent) => {
      if (!isZoomWheelEvent(event) || graph.destroyed) return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const origin: [number, number] = [event.clientX - rect.left, event.clientY - rect.top];
      void graph.zoomBy(wheelZoomRatio(event), false, origin).catch((error: unknown) => {
        if (graphRef.current === graph && !graph.destroyed) {
          console.error('[ObjectMapG6Renderer] Failed to zoom graph:', error);
        }
      });
    };
    container.addEventListener('wheel', handleWheelZoom, { passive: false });

    let disposed = false;
    let initialRenderSettled = false;
    const destroyGraph = () => {
      if (!graph.destroyed) {
        graph.destroy();
      }
    };
    const renderInitialGraph = async () => {
      try {
        await graph.render();
        initialRenderSettled = true;
        if (disposed || graph.destroyed || graphRef.current !== graph) {
          return;
        }
        renderedDataRef.current = initialData;
        graphReadyRef.current = true;
        scheduleSelectionState(layoutRef.current, selectionStateRef.current);
        const pendingData = dataApplyRef.current.latest;
        if (pendingData) {
          scheduleGraphData(pendingData);
        }
      } catch (error) {
        initialRenderSettled = true;
        if (!disposed && graphRef.current === graph && !graph.destroyed) {
          console.error('[ObjectMapG6Renderer] Failed to render graph:', error);
        }
      } finally {
        if (disposed) {
          destroyGraph();
        }
      }
    };
    void renderInitialGraph();
    const selectionApply = selectionApplyRef.current;
    const dataApply = dataApplyRef.current;
    return () => {
      disposed = true;
      graphRef.current = null;
      graphReadyRef.current = false;
      hoveredEdgeIdRef.current = null;
      manualDragPointerIdRef.current = null;
      renderedDataRef.current = null;
      selectionApply.latest = null;
      selectionApply.applying = false;
      dataApply.latest = null;
      dataApply.applying = false;
      container.removeEventListener('wheel', handleWheelZoom);
      if (initialRenderSettled) {
        destroyGraph();
      }
    };
  }, [palette, scheduleGraphData, scheduleSelectionState, updateTooltipPosition]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || graph.destroyed) return;
    scheduleGraphData(data);
  }, [data, scheduleGraphData]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || graph.destroyed) return;
    scheduleSelectionState(layout, selectionState);
  }, [layout, scheduleSelectionState, selectionState]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resizeGraphToContainer);
    });
    observer.observe(container);
    frame = requestAnimationFrame(resizeGraphToContainer);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [resizeGraphToContainer]);

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
