import { Graph, CanvasEvent, CommonEvent, EdgeEvent, GraphEvent, NodeEvent } from '@antv/g6';
import type { GraphData } from '@antv/g6';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { resolveKindBadgeVisualStyle } from '@shared/utils/kindBadgeColors';
import type { ObjectMapLayout, PositionedEdge, PositionedNode } from './objectMapLayout';
import { ensureObjectMapG6CardNodeRegistered } from './objectMapG6CardNode';
import { ensureObjectMapG6PathEdgeRegistered } from './objectMapG6PathEdge';
import { createObjectMapG6ApplyQueue, type ObjectMapG6ApplyQueue } from './objectMapG6ApplyQueue';
import { OBJECT_MAP_G6_CARD_NODE } from './objectMapG6Constants';
import { objectMapG6EdgeState, objectMapG6NodeState, toObjectMapG6Data } from './objectMapG6Data';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import { ObjectMapG6TooltipOverlay } from './ObjectMapG6TooltipOverlay';
import {
  handleObjectMapG6Drag,
  handleObjectMapG6DragEnd,
  handleObjectMapG6NodeClick,
  handleObjectMapG6NodeContextMenu,
  handleObjectMapG6NodePointerDown,
  objectMapG6TooltipPoint,
  type ObjectMapG6ElementPointerEvent as G6ElementPointerEvent,
} from './objectMapG6Interactions';
import { computeObjectMapTooltipLayout } from './objectMapG6Tooltip';
import { clearObjectMapNodeGesture, createObjectMapNodeGestureState } from './objectMapNodeGesture';
import type {
  ObjectMapHoverEdge,
  ObjectMapContextMenuAction,
  ObjectMapNodeBadgeLookup,
  ObjectMapNodeDragEnd,
  ObjectMapNodeDragMove,
  ObjectMapNodeDragStart,
  ObjectMapObjectAction,
  ObjectMapSelectionState,
  ObjectMapViewportChangeAction,
  ObjectMapViewportControls,
} from './objectMapRendererTypes';

const WHEEL_ZOOM_DELTA_LIMIT = 50;
const WHEEL_ZOOM_SENSITIVITY = 1;

const findNode = (layout: ObjectMapLayout, id: string): PositionedNode | null =>
  layout.nodes.find((node) => node.id === id) ?? null;

const findEdge = (layout: ObjectMapLayout, id: string): PositionedEdge | null =>
  layout.edges.find((edge) => edge.id === id) ?? null;

const cssVar = (styles: CSSStyleDeclaration, name: string): string =>
  styles.getPropertyValue(name).trim();

const cssColorVar = (element: HTMLElement, styles: CSSStyleDeclaration, name: string): string => {
  const raw = cssVar(styles, name);
  if (!raw.includes('var(')) return raw;
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.color = `var(${name})`;
  const probeRoot = element.parentElement ?? element;
  probeRoot.appendChild(probe);
  const resolved = window.getComputedStyle(probe).color.trim();
  probe.remove();
  return resolved || raw;
};

const cssNumber = (styles: CSSStyleDeclaration, name: string): number => {
  const value = Number.parseFloat(cssVar(styles, name));
  return Number.isFinite(value) ? value : 0;
};

const readPalette = (element: HTMLElement): ObjectMapG6Palette => {
  const styles = window.getComputedStyle(element);
  return {
    accent: cssColorVar(element, styles, '--color-accent'),
    accentBg: cssColorVar(element, styles, '--color-accent-bg'),
    background: cssColorVar(element, styles, '--color-bg'),
    backgroundSecondary: cssColorVar(element, styles, '--color-bg-secondary'),
    border: cssColorVar(element, styles, '--color-border'),
    text: cssColorVar(element, styles, '--color-text'),
    textSecondary: cssColorVar(element, styles, '--color-text-secondary'),
    textTertiary: cssColorVar(element, styles, '--color-text-tertiary'),
    textInverse: cssColorVar(element, styles, '--color-text-inverse'),
    edgeRoutes: cssColorVar(element, styles, '--object-map-edge-routes'),
    edgeEndpoint: cssColorVar(element, styles, '--object-map-edge-endpoint'),
    edgeVolumeBinding: cssColorVar(element, styles, '--object-map-edge-volume-binding'),
    edgeStorageClass: cssColorVar(element, styles, '--object-map-edge-storage-class'),
    edgeMounts: cssColorVar(element, styles, '--object-map-edge-mounts'),
    edgeSchedules: cssColorVar(element, styles, '--object-map-edge-schedules'),
    edgeScales: cssColorVar(element, styles, '--object-map-edge-scales'),
    edgeGrants: cssColorVar(element, styles, '--object-map-edge-grants'),
    edgeBinds: cssColorVar(element, styles, '--object-map-edge-binds'),
    edgeAggregates: cssColorVar(element, styles, '--object-map-edge-aggregates'),
    edgeFilteredPath: cssColorVar(element, styles, '--object-map-edge-filtered-path'),
    edgeUses: cssColorVar(element, styles, '--object-map-edge-uses'),
    edgeDefault: cssColorVar(element, styles, '--object-map-edge-default'),
    edgeLineWidth: cssNumber(styles, '--object-map-edge-line-width'),
    edgeHighlightedLineWidth: cssNumber(styles, '--object-map-edge-highlighted-line-width'),
    edgeHoveredLineWidth: cssNumber(styles, '--object-map-edge-hovered-line-width'),
    edgeDimmedOpacity: cssNumber(styles, '--object-map-edge-dimmed-opacity'),
    edgeDash: [
      cssNumber(styles, '--object-map-edge-dash-length'),
      cssNumber(styles, '--object-map-edge-dash-gap'),
    ],
    nodeConnectedLineWidth: cssNumber(styles, '--object-map-node-connected-line-width'),
    nodeSelectedLineWidth: cssNumber(styles, '--object-map-node-selected-line-width'),
    nodeEdgeHoveredLineWidth: cssNumber(styles, '--object-map-node-edge-hovered-line-width'),
    nodeDimmedOpacity: cssNumber(styles, '--object-map-node-dimmed-opacity'),
    tooltipMaxWidth: cssNumber(styles, '--object-map-tooltip-max-width'),
    tooltipHeight: cssNumber(styles, '--object-map-tooltip-height'),
    tooltipOffsetY: cssNumber(styles, '--object-map-tooltip-offset-y'),
    tooltipArrowWidth: cssNumber(styles, '--object-map-tooltip-arrow-width'),
    tooltipArrowHeight: cssNumber(styles, '--object-map-tooltip-arrow-height'),
    tooltipRadius: cssNumber(styles, '--object-map-tooltip-radius'),
    tooltipSourceY: cssNumber(styles, '--object-map-tooltip-source-y'),
    tooltipRelationshipY: cssNumber(styles, '--object-map-tooltip-relationship-y'),
    tooltipTargetY: cssNumber(styles, '--object-map-tooltip-target-y'),
    tooltipHorizontalPadding: cssNumber(styles, '--object-map-tooltip-horizontal-padding'),
    tooltipBadgeGap: cssNumber(styles, '--object-map-tooltip-badge-gap'),
    tooltipBadgeMaxWidth: cssNumber(styles, '--object-map-tooltip-badge-max-width'),
    tooltipBadgeMaxFontSize: cssNumber(styles, '--object-map-tooltip-badge-max-font-size'),
    tooltipBadgePaddingX: cssNumber(styles, '--object-map-tooltip-badge-padding-x'),
    tooltipBadgePaddingY: cssNumber(styles, '--object-map-tooltip-badge-padding-y'),
    tooltipNameFontSize: cssNumber(styles, '--object-map-tooltip-name-font-size'),
    tooltipNameFontWeight: cssNumber(styles, '--object-map-tooltip-name-font-weight'),
    tooltipRelationshipFontSize: cssNumber(styles, '--object-map-tooltip-relationship-font-size'),
    tooltipRelationshipFontWeight: cssNumber(
      styles,
      '--object-map-tooltip-relationship-font-weight'
    ),
    fitViewPadding: cssNumber(styles, '--object-map-fit-view-padding'),
    fullOpacity: cssNumber(styles, '--object-map-full-opacity'),
    fontFamily: styles.fontFamily,
  };
};

const samePalette = (previous: ObjectMapG6Palette | null, next: ObjectMapG6Palette): boolean => {
  if (!previous) return false;
  return (Object.keys(next) as Array<keyof ObjectMapG6Palette>).every((key) => {
    const previousValue = previous[key];
    const nextValue = next[key];
    if (Array.isArray(previousValue) && Array.isArray(nextValue)) {
      return (
        previousValue.length === nextValue.length &&
        previousValue.every((value, index) => value === nextValue[index])
      );
    }
    return previousValue === nextValue;
  });
};

const objectMapG6NodeOptions = (palette: ObjectMapG6Palette) => ({
  type: OBJECT_MAP_G6_CARD_NODE,
  state: {
    selected: {
      stroke: palette.accent,
      lineWidth: palette.nodeSelectedLineWidth + 1,
      opacity: palette.fullOpacity,
    },
    connected: {
      stroke: palette.accent,
      lineWidth: palette.nodeConnectedLineWidth,
      opacity: palette.fullOpacity,
    },
    edgeHovered: {
      stroke: palette.accent,
      lineWidth: palette.nodeEdgeHoveredLineWidth,
      opacity: palette.fullOpacity,
    },
    dimmed: { opacity: palette.nodeDimmedOpacity },
    seed: {
      stroke: palette.accent,
      opacity: palette.fullOpacity,
    },
  },
});

const objectMapG6EdgeOptions = (palette: ObjectMapG6Palette) => ({
  state: {
    hovered: { lineWidth: palette.edgeHoveredLineWidth, opacity: palette.fullOpacity },
    highlighted: { lineWidth: palette.edgeHighlightedLineWidth, opacity: palette.fullOpacity },
    dimmed: { opacity: palette.edgeDimmedOpacity },
  },
});

const fitGraphToView = async (graph: Graph, padding: number): Promise<void> => {
  if (graph.destroyed) return;
  await graph.fitView({ when: 'always', direction: 'both' }, false);
  if (graph.destroyed || padding <= 0) return;
  const [width, height] = graph.getSize();
  if (width <= 0 || height <= 0) return;
  const widthRatio = Math.max(0.01, (width - padding * 2) / width);
  const heightRatio = Math.max(0.01, (height - padding * 2) / height);
  const zoomRatio = Math.min(widthRatio, heightRatio);
  if (zoomRatio < 1) {
    await graph.zoomBy(zoomRatio, false);
  }
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

const edgeEndpointLabel = (node: PositionedNode | null): string =>
  node ? node.ref.name : 'Unknown';

const edgeEndpointKind = (node: PositionedNode | null): string => node?.ref.kind ?? 'Object';

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
  onNavigateView?: ObjectMapObjectAction;
  onNodeContextMenu?: ObjectMapContextMenuAction;
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
  onNavigateView,
  onNodeContextMenu,
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
  const [palette, setPalette] = useState<ObjectMapG6Palette | null>(null);
  const [styleVersion, setStyleVersion] = useState(0);
  const paletteReady = palette !== null;
  const paletteRef = useRef<ObjectMapG6Palette | null>(null);
  paletteRef.current = palette;
  const onUserViewportChangeRef = useRef(onUserViewportChange);
  onUserViewportChangeRef.current = onUserViewportChange;
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const handlersRef = useRef({
    onHoverEdge,
    onClearHoverEdge,
    onSelectNode,
    onClearSelection,
    onOpenPanel,
    onNavigateView,
    onNodeContextMenu,
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
    onNodeContextMenu,
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

  const refreshPalette = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const nextPalette = readPalette(container);
    setPalette((previousPalette) =>
      samePalette(previousPalette, nextPalette) ? previousPalette : nextPalette
    );
    setStyleVersion((previous) => previous + 1);
  }, []);

  useLayoutEffect(() => {
    refreshPalette();
  }, [refreshPalette]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const schedulePaletteRefresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refreshPalette);
    };
    const observer = new MutationObserver(schedulePaletteRefresh);
    const observed = new Set<HTMLElement>([document.documentElement, document.body, container]);
    const objectMapRoot = container.closest<HTMLElement>('.object-map');
    if (objectMapRoot) observed.add(objectMapRoot);
    observed.forEach((element) => {
      observer.observe(element, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme', 'data-theme-name'],
      });
    });
    const colorSchemeQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    colorSchemeQuery?.addEventListener('change', schedulePaletteRefresh);
    schedulePaletteRefresh();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      colorSchemeQuery?.removeEventListener('change', schedulePaletteRefresh);
    };
  }, [refreshPalette]);

  const updateTooltipPosition = useCallback(() => {
    const edge = hoverEdgeRef.current;
    if (!edge) {
      setTooltipPosition(null);
      return;
    }
    setTooltipPosition({ x: edge.tooltipX, y: edge.tooltipY });
  }, []);

  const scheduleFitGraphToView = useCallback(() => {
    const graph = graphRef.current;
    const currentPalette = paletteRef.current;
    if (!graph || graph.destroyed || !currentPalette) return;
    void fitGraphToView(graph, currentPalette.fitViewPadding)
      .then(updateTooltipPosition)
      .catch((error: unknown) => {
        if (graphRef.current === graph && !graph.destroyed) {
          console.error('[ObjectMapG6Renderer] Failed to fit graph to view:', error);
        }
      });
  }, [updateTooltipPosition]);

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
      scheduleFitGraphToView();
    }
    updateTooltipPosition();
  }, [autoFit, scheduleFitGraphToView, updateTooltipPosition]);

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

  useEffect(() => {
    const container = containerRef.current;
    const initialPalette = paletteRef.current;
    if (!container || !paletteReady || !initialPalette) return;
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
      node: objectMapG6NodeOptions(initialPalette),
      edge: objectMapG6EdgeOptions(initialPalette),
    });
    graphRef.current = graph;
    const nodeGestureState = nodeGestureRef.current;

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

    const emitConnectionHover = (edge: PositionedEdge, event: G6ElementPointerEvent) => {
      const currentPalette = paletteRef.current;
      const point = objectMapG6TooltipPoint(event, container, currentPalette?.tooltipOffsetY ?? 0);
      const sourceNode = findNode(layoutRef.current, edge.sourceId);
      const targetNode = findNode(layoutRef.current, edge.targetId);
      handlersRef.current.onHoverEdge({
        tooltipX: point.x,
        tooltipY: point.y,
        sourceLabel: edgeEndpointLabel(sourceNode),
        sourceKind: edgeEndpointKind(sourceNode),
        label: edge.label,
        targetLabel: edgeEndpointLabel(targetNode),
        targetKind: edgeEndpointKind(targetNode),
        type: edge.type,
        tracedBy: edge.tracedBy,
        filteredPath: edge.filteredPath,
      });
    };

    const nodeInteractionContext = () => ({
      getLayout: () => layoutRef.current,
      gestureState: nodeGestureState,
      graph,
      handlers: handlersRef.current,
      markNodeClickHandled: () => {
        ignoreNextCanvasClickRef.current = true;
        requestAnimationFrame(() => {
          ignoreNextCanvasClickRef.current = false;
        });
      },
    });

    graph.on(NodeEvent.CLICK, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      handleObjectMapG6NodeClick(nodeInteractionContext(), event);
    });

    graph.on(NodeEvent.CONTEXT_MENU, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      handleObjectMapG6NodeContextMenu(nodeInteractionContext(), event);
    });

    graph.on(NodeEvent.POINTER_DOWN, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      handleObjectMapG6NodePointerDown(nodeInteractionContext(), event);
    });

    graph.on(CommonEvent.DRAG, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      handleObjectMapG6Drag(nodeInteractionContext(), event);
    });

    graph.on(CommonEvent.DRAG_END, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      handleObjectMapG6DragEnd(nodeInteractionContext(), event);
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
      emitConnectionHover(edge, event);
    });
    graph.on(EdgeEvent.POINTER_MOVE, (rawEvent) => {
      const event = rawEvent as G6ElementPointerEvent;
      const edge = findEdge(layoutRef.current, event.target.id);
      if (!edge || hoveredEdgeIdRef.current !== edge.id) return;
      emitConnectionHover(edge, event);
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
      if (graph.destroyed) return;
      onUserViewportChangeRef.current?.();
      if (!isZoomWheelEvent(event)) return;
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
        applyQueue.setRenderedData(initialData);
        applyQueue.setReady(true);
        scheduleSelectionState(layoutRef.current, selectionStateRef.current);
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
    return () => {
      disposed = true;
      graphRef.current = null;
      hoveredEdgeIdRef.current = null;
      clearObjectMapNodeGesture(nodeGestureState);
      applyQueue.clear();
      container.removeEventListener('wheel', handleWheelZoom);
      if (initialRenderSettled) {
        destroyGraph();
      }
    };
  }, [applyQueue, paletteReady, scheduleGraphData, scheduleSelectionState, updateTooltipPosition]);

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
        onUserViewportChangeRef.current?.();
        void graph.zoomBy(1.2, false);
      },
      zoomOut: () => {
        const graph = graphRef.current;
        if (!graph || graph.destroyed) return;
        onUserViewportChangeRef.current?.();
        void graph.zoomBy(0.8, false);
      },
      fitToView: () => {
        scheduleFitGraphToView();
      },
      focusNode: (nodeId: string) => {
        const graph = graphRef.current;
        if (!graph || graph.destroyed) return;
        void graph.focusElement(nodeId, false).catch((error: unknown) => {
          if (graphRef.current === graph && !graph.destroyed) {
            console.error('[ObjectMapG6Renderer] Failed to focus node:', error);
          }
        });
      },
    };
    onViewportControlsChange(controls);
    return () => onViewportControlsChange(null);
  }, [onViewportControlsChange, scheduleFitGraphToView]);

  useEffect(() => {
    if (!autoFit) return;
    scheduleFitGraphToView();
  }, [autoFit, data, palette, scheduleFitGraphToView]);

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
