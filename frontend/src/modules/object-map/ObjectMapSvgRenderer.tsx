/**
 * SVG renderer for the object map.
 *
 * Why pure SVG (no foreignObject): WebKit/Wails renders foreignObject content
 * inconsistently when a parent SVG has a non-identity transform. Native SVG
 * primitives transform uniformly, so this fallback renderer keeps node cards
 * as rect/text primitives.
 */

import React, { useCallback } from 'react';
import type { ObjectMapReference } from '@core/refresh/types';
import type { ObjectMapLayout, PositionedEdge, PositionedNode } from './objectMapLayout';
import { objectMapEdgeClass } from './objectMapEdgeStyle';
import type { PanZoomViewport } from './usePanZoom';
import type {
  ObjectMapHoverEdge,
  ObjectMapNodeBadge,
  ObjectMapNodeBadgeLookup,
  ObjectMapNodeDragEnd,
  ObjectMapNodeDragMove,
  ObjectMapNodeDragStart,
  ObjectMapObjectAction,
  ObjectMapPointer,
  ObjectMapSelectionState,
} from './objectMapRendererTypes';

const NODE_PADDING_X = 10;
const NODE_KIND_BASELINE_Y = 18;
const NODE_NAME_BASELINE_Y = 38;
const NODE_NAMESPACE_BASELINE_Y = 56;
const NODE_CORNER_RADIUS = 6;

const KIND_MAX_CHARS = 26;
const NAME_MAX_CHARS = 32;
const NAMESPACE_MAX_CHARS = 28;

const TOOLTIP_WIDTH = 200;
const TOOLTIP_HEIGHT_SINGLE = 28;
const TOOLTIP_HEIGHT_DOUBLE = 44;
const TOOLTIP_LABEL_MAX_CHARS = 30;
const TOOLTIP_TRACE_MAX_CHARS = 36;

const BADGE_WIDTH = 28;
const BADGE_HEIGHT = 16;
const BADGE_MARGIN = 4;
const BADGE_TEXT_BASELINE = 12;

const truncate = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}\u2026`;
};

const formatNamespace = (ref: PositionedNode['ref']): string =>
  ref.namespace?.trim() ? ref.namespace : 'cluster-scoped';

const toObjectMapPointer = (event: React.PointerEvent): ObjectMapPointer => ({
  pointerId: event.pointerId,
  button: event.button,
  clientX: event.clientX,
  clientY: event.clientY,
});

const buildNodeClass = (node: PositionedNode, selectionState: ObjectMapSelectionState): string => {
  const classes = ['object-map-node'];
  if (node.isSeed) classes.push('object-map-node--seed');
  if (selectionState.activeId === node.id) {
    classes.push('object-map-node--selected');
  } else if (selectionState.activeId !== null) {
    if (selectionState.connectedIds.has(node.id)) {
      classes.push('object-map-node--connected');
    } else {
      classes.push('object-map-node--dimmed');
    }
  }
  return classes.join(' ');
};

const buildEdgeClass = (edge: PositionedEdge, selectionState: ObjectMapSelectionState): string => {
  const base = objectMapEdgeClass(edge.type);
  if (selectionState.activeId === null) {
    return base;
  }
  if (selectionState.connectedEdgeIds.has(edge.id)) {
    return `${base} object-map-edge--highlighted`;
  }
  return `${base} object-map-edge--dimmed`;
};

const ObjectMapNodeCard: React.FC<{
  node: PositionedNode;
  className: string;
  badge: ObjectMapNodeBadge | null;
  onSelect: (id: string) => void;
  onToggleGroup: (deploymentId: string) => void;
  onDragStart: ObjectMapNodeDragStart;
  onDragMove: ObjectMapNodeDragMove;
  onDragEnd: ObjectMapNodeDragEnd;
  onOpenPanel?: ObjectMapObjectAction;
  onNavigateView?: ObjectMapObjectAction;
}> = ({
  node,
  className,
  badge,
  onSelect,
  onToggleGroup,
  onDragStart,
  onDragMove,
  onDragEnd,
  onOpenPanel,
  onNavigateView,
}) => {
  const handleClick = useCallback(
    (event: React.MouseEvent<SVGGElement>) => {
      event.stopPropagation();
      if (event.metaKey || event.ctrlKey) {
        if (onOpenPanel) onOpenPanel(node.ref);
        return;
      }
      if (event.altKey) {
        if (onNavigateView) onNavigateView(node.ref);
        return;
      }
      onSelect(node.id);
    },
    [node, onSelect, onOpenPanel, onNavigateView]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<SVGGElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(node.id);
      }
    },
    [node.id, onSelect]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGGElement>) => {
      event.stopPropagation();
      onDragStart(node, toObjectMapPointer(event));
      if (event.button === 0) {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }
    },
    [node, onDragStart]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGGElement>) => {
      event.stopPropagation();
      onDragMove(toObjectMapPointer(event));
    },
    [onDragMove]
  );

  const handlePointerEnd = useCallback(
    (event: React.PointerEvent<SVGGElement>) => {
      event.stopPropagation();
      onDragEnd(toObjectMapPointer(event));
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    },
    [onDragEnd]
  );

  const stopPointer = useCallback((event: React.PointerEvent) => {
    event.stopPropagation();
  }, []);

  const handleBadgeClick = useCallback(
    (event: React.MouseEvent<SVGGElement>) => {
      event.stopPropagation();
      if (badge) onToggleGroup(badge.deploymentId);
    },
    [badge, onToggleGroup]
  );

  const handleBadgeKeyDown = useCallback(
    (event: React.KeyboardEvent<SVGGElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        if (badge) onToggleGroup(badge.deploymentId);
      }
    },
    [badge, onToggleGroup]
  );

  return (
    <g
      className={className}
      transform={`translate(${node.x} ${node.y})`}
      role="button"
      tabIndex={0}
      aria-label={`${node.ref.kind}: ${node.ref.name}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <title>
        {node.ref.kind}: {node.ref.name}
      </title>
      <rect
        className="object-map-node__bg"
        width={node.width}
        height={node.height}
        rx={NODE_CORNER_RADIUS}
        ry={NODE_CORNER_RADIUS}
      />
      <text className="object-map-node__kind" x={NODE_PADDING_X} y={NODE_KIND_BASELINE_Y}>
        {truncate(node.ref.kind, KIND_MAX_CHARS)}
      </text>
      <text className="object-map-node__name" x={NODE_PADDING_X} y={NODE_NAME_BASELINE_Y}>
        {truncate(node.ref.name, NAME_MAX_CHARS)}
      </text>
      <text className="object-map-node__namespace" x={NODE_PADDING_X} y={NODE_NAMESPACE_BASELINE_Y}>
        {truncate(formatNamespace(node.ref), NAMESPACE_MAX_CHARS)}
      </text>
      {badge && (
        <g
          className="object-map-node__badge"
          role="button"
          tabIndex={0}
          aria-label={
            badge.expanded
              ? 'Collapse other ReplicaSets'
              : `Show ${badge.hiddenCount} hidden ReplicaSet${badge.hiddenCount === 1 ? '' : 's'}`
          }
          transform={`translate(${node.width - BADGE_WIDTH - BADGE_MARGIN} ${BADGE_MARGIN})`}
          onClick={handleBadgeClick}
          onKeyDown={handleBadgeKeyDown}
          onPointerDown={stopPointer}
          onPointerMove={stopPointer}
          onPointerUp={stopPointer}
          onPointerCancel={stopPointer}
        >
          <rect
            className="object-map-node__badge-bg"
            width={BADGE_WIDTH}
            height={BADGE_HEIGHT}
            rx={3}
            ry={3}
          />
          <text
            className="object-map-node__badge-text"
            x={BADGE_WIDTH / 2}
            y={BADGE_TEXT_BASELINE}
            textAnchor="middle"
          >
            {badge.expanded ? '\u2212' : `+${badge.hiddenCount}`}
          </text>
        </g>
      )}
    </g>
  );
};

export interface ObjectMapSvgRendererProps {
  layout: ObjectMapLayout;
  viewport: PanZoomViewport;
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
  onOpenPanel?: (ref: ObjectMapReference) => void;
  onNavigateView?: (ref: ObjectMapReference) => void;
}

const ObjectMapSvgRenderer: React.FC<ObjectMapSvgRendererProps> = ({
  layout,
  viewport,
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
  onOpenPanel,
  onNavigateView,
}) => (
  <svg className="object-map__svg" width="100%" height="100%">
    <g
      transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}
      className="object-map__viewport"
    >
      <g className="object-map__edges">
        {layout.edges.map((edge) => (
          <path
            key={edge.id}
            d={edge.d}
            className={buildEdgeClass(edge, selectionState)}
            onMouseEnter={() =>
              onHoverEdge({
                midX: edge.midX,
                midY: edge.midY,
                label: edge.label,
                type: edge.type,
                tracedBy: edge.tracedBy,
              })
            }
            onMouseLeave={onClearHoverEdge}
          />
        ))}
      </g>
      <g className="object-map__nodes">
        {layout.nodes.map((node) => (
          <ObjectMapNodeCard
            key={node.id}
            node={node}
            className={buildNodeClass(node, selectionState)}
            badge={badgeForNode(node.id)}
            onSelect={onSelectNode}
            onToggleGroup={onToggleGroup}
            onDragStart={onNodeDragStart}
            onDragMove={onNodeDragMove}
            onDragEnd={onNodeDragEnd}
            onOpenPanel={onOpenPanel}
            onNavigateView={onNavigateView}
          />
        ))}
      </g>
      {hoverEdge && (
        <g
          className="object-map__edge-tooltip"
          transform={`translate(${hoverEdge.midX} ${hoverEdge.midY})`}
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
    </g>
  </svg>
);

export default ObjectMapSvgRenderer;
