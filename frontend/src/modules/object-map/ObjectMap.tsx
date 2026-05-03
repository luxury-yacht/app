/**
 * frontend/src/modules/object-map/ObjectMap.tsx
 *
 * Self-contained graph renderer for the object-map snapshot. Takes a
 * payload as a prop and owns nothing about how the data was fetched.
 * The wrapping MapTab manages refresh/scope/lifecycle so this component
 * can be relocated into a different host without rewiring.
 *
 * Why pure SVG (no foreignObject): WebKit (and therefore Wails on
 * macOS) renders foreignObject content inconsistently when the parent
 * SVG has a non-identity transform — some elements scale with the
 * transform, some render at native HTML pixel size. Both versions can
 * appear in the same view, producing "ghost" cards at the wrong size
 * and position. Native SVG primitives transform uniformly across all
 * engines, so node cards are built from <rect> + <text>. The
 * trade-off: SVG <text> has no text-overflow:ellipsis, so we truncate
 * strings by character count.
 *
 * Click semantics: clicking a node selects it, which highlights the
 * node, its direct neighbours, and the edges connecting them while
 * dimming everything else. Clicking the background or the same node
 * again clears the selection. There is intentionally no "open object
 * panel" interaction here — the component is purely a visualisation.
 */

import React, { useCallback, useMemo, useState } from 'react';
import './ObjectMap.css';
import type { ObjectMapSnapshotPayload } from '@core/refresh/types';
import {
  computeCollapseInfo,
  filterByCollapseInfo,
  type DeploymentGroup,
} from './objectMapCollapse';
import { dedupeServiceEdges } from './objectMapDedupe';
import {
  computeObjectMapLayout,
  type PositionedEdge,
  type PositionedNode,
} from './objectMapLayout';
import { objectMapEdgeClass, OBJECT_MAP_EDGE_KINDS } from './objectMapEdgeStyle';
import { usePanZoom } from './usePanZoom';

export interface ObjectMapProps {
  payload: ObjectMapSnapshotPayload;
  // Forces a refit when bumped — wire to a host's "Reset view" trigger.
  resetToken?: number;
  // Optional refresh callback. When provided, a "Refresh" button
  // appears in the toolbar; the host wires it to whatever fetch flow
  // it owns. Without it, the button is omitted (so the component is
  // still usable in non-fetching contexts like Storybook).
  onRefresh?: () => void;
  // Disables the refresh button while a fetch is in flight.
  isRefreshing?: boolean;
}

interface HoverEdge {
  midX: number;
  midY: number;
  label: string;
  type: string;
  tracedBy?: string;
}

interface SelectionState {
  activeId: string | null;
  connectedIds: Set<string>;
  connectedEdgeIds: Set<string>;
}

const EMPTY_SELECTION: SelectionState = {
  activeId: null,
  connectedIds: new Set(),
  connectedEdgeIds: new Set(),
};

// Layout constants for the SVG node card. These match the visual
// hierarchy of the previous HTML version (kind small + uppercase, name
// medium + bold, namespace small + muted). Vertical positions are y
// coordinates of each text line's BASELINE (SVG default
// dominant-baseline = "alphabetic").
const NODE_PADDING_X = 10;
const NODE_KIND_BASELINE_Y = 18;
const NODE_NAME_BASELINE_Y = 38;
const NODE_NAMESPACE_BASELINE_Y = 56;
const NODE_CORNER_RADIUS = 6;

// Char limits per line, chosen so the longest realistic content fits
// within the node's interior width (~200px after padding) at the
// configured font sizes. Refined empirically — the kind line never
// approaches the limit (longest built-in is "ENDPOINTSLICE" at 13
// chars), the name line is the one that truncates often.
const KIND_MAX_CHARS = 26;
const NAME_MAX_CHARS = 22;
const NAMESPACE_MAX_CHARS = 28;

// Edge tooltip dimensions, sized so the rectangular background fits a
// short label and an optional `tracedBy` line above the edge midpoint.
const TOOLTIP_WIDTH = 200;
const TOOLTIP_HEIGHT_SINGLE = 28;
const TOOLTIP_HEIGHT_DOUBLE = 44;
const TOOLTIP_LABEL_MAX_CHARS = 30;
const TOOLTIP_TRACE_MAX_CHARS = 36;

// Expand/collapse badge sizing (top-right corner of an RS card).
const BADGE_WIDTH = 28;
const BADGE_HEIGHT = 16;
const BADGE_MARGIN = 4;
const BADGE_TEXT_BASELINE = 12;

const truncate = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  // Use a single-character ellipsis (U+2026) so the visible width
  // matches a single-glyph slot — three dots would push the truncation
  // past the budget.
  return `${text.slice(0, maxChars - 1)}…`;
};

const formatNamespace = (ref: PositionedNode['ref']): string =>
  ref.namespace?.trim() ? ref.namespace : 'cluster-scoped';

const buildNodeClass = (node: PositionedNode, selectionState: SelectionState): string => {
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

const buildEdgeClass = (edge: PositionedEdge, selectionState: SelectionState): string => {
  const base = objectMapEdgeClass(edge.type);
  if (selectionState.activeId === null) {
    return base;
  }
  if (selectionState.connectedEdgeIds.has(edge.id)) {
    return `${base} object-map-edge--highlighted`;
  }
  return `${base} object-map-edge--dimmed`;
};

interface NodeBadge {
  /** Deployment id whose RS group this badge controls. */
  deploymentId: string;
  /** Number of RSs hidden when the group is collapsed. */
  hiddenCount: number;
  /** True when the group is currently expanded (badge shows "−"). */
  expanded: boolean;
}

const ObjectMapNodeCard: React.FC<{
  node: PositionedNode;
  className: string;
  badge: NodeBadge | null;
  onSelect: (id: string) => void;
  onToggleGroup: (deploymentId: string) => void;
}> = ({ node, className, badge, onSelect, onToggleGroup }) => {
  const handleClick = useCallback(
    (event: React.MouseEvent<SVGGElement>) => {
      // Stop the SVG-level "background click clears selection" handler
      // from firing for clicks that landed on a node.
      event.stopPropagation();
      onSelect(node.id);
    },
    [node.id, onSelect]
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

  // Stop pan-drag from kicking in when the user click-drags a node.
  const stopPointer = useCallback((event: React.PointerEvent) => {
    event.stopPropagation();
  }, []);

  const handleBadgeClick = useCallback(
    (event: React.MouseEvent<SVGGElement>) => {
      // Don't bubble — badge clicks must not also select the parent node.
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
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerDown={stopPointer}
      onPointerUp={stopPointer}
      tabIndex={0}
      role="button"
      aria-label={`${node.ref.kind}: ${node.ref.name}`}
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
          transform={`translate(${node.width - BADGE_WIDTH - BADGE_MARGIN} ${BADGE_MARGIN})`}
          onClick={handleBadgeClick}
          onKeyDown={handleBadgeKeyDown}
          onPointerDown={stopPointer}
          onPointerUp={stopPointer}
          tabIndex={0}
          role="button"
          aria-label={
            badge.expanded
              ? 'Collapse other ReplicaSets'
              : `Show ${badge.hiddenCount} hidden ReplicaSet${badge.hiddenCount === 1 ? '' : 's'}`
          }
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
            {badge.expanded ? '−' : `+${badge.hiddenCount}`}
          </text>
        </g>
      )}
    </g>
  );
};

const ObjectMap: React.FC<ObjectMapProps> = ({
  payload,
  resetToken = 0,
  onRefresh,
  isRefreshing = false,
}) => {
  const seedId = useMemo(() => {
    const ref = payload.seed;
    const namespace = ref.namespace ?? '';
    return (
      payload.nodes.find((node) => {
        const r = node.ref;
        if (r.uid && ref.uid) return r.uid === ref.uid;
        return (
          r.clusterId === ref.clusterId &&
          r.kind === ref.kind &&
          r.name === ref.name &&
          (r.namespace ?? '') === namespace &&
          r.group === ref.group &&
          r.version === ref.version
        );
      })?.id ?? ''
    );
  }, [payload]);

  // Per-Deployment expand state for the ReplicaSet collapse feature.
  // Default empty = every Deployment is collapsed; the user toggles a
  // group by clicking the +N badge on its current RS.
  const [expandedDeployments, setExpandedDeployments] = useState<Set<string>>(() => new Set());

  const handleToggleGroup = useCallback((deploymentId: string) => {
    setExpandedDeployments((prev) => {
      const next = new Set(prev);
      if (next.has(deploymentId)) {
        next.delete(deploymentId);
      } else {
        next.add(deploymentId);
      }
      return next;
    });
  }, []);

  // Pre-process edges to drop redundant Service relationships (e.g.,
  // direct selector lines that duplicate the endpoint chain). Runs
  // before collapse and layout so downstream passes see the
  // already-deduplicated graph.
  const dedupedEdges = useMemo(
    () => dedupeServiceEdges(payload.nodes, payload.edges),
    [payload.nodes, payload.edges]
  );

  const collapseInfo = useMemo(
    () => computeCollapseInfo(payload.nodes, dedupedEdges, seedId, expandedDeployments),
    [payload.nodes, dedupedEdges, seedId, expandedDeployments]
  );

  const filtered = useMemo(
    () => filterByCollapseInfo(payload.nodes, dedupedEdges, collapseInfo.visibleNodeIds),
    [payload.nodes, dedupedEdges, collapseInfo.visibleNodeIds]
  );

  const layout = useMemo(
    () => computeObjectMapLayout(filtered.nodes, filtered.edges, seedId),
    [filtered.nodes, filtered.edges, seedId]
  );

  // Resolve a per-node badge spec from the collapse info. Memoized so
  // we don't rebuild the lookup on every render frame; downstream
  // ObjectMapNodeCard consumers get a stable null when a node has no
  // badge.
  const badgeForNode = useCallback(
    (nodeId: string): NodeBadge | null => {
      const group: DeploymentGroup | undefined = collapseInfo.groupsByCurrentRs.get(nodeId);
      if (!group) return null;
      return {
        deploymentId: group.deploymentId,
        hiddenCount: group.collapsibleRsIds.length,
        expanded: expandedDeployments.has(group.deploymentId),
      };
    },
    [collapseInfo.groupsByCurrentRs, expandedDeployments]
  );

  const [autoFit, setAutoFit] = useState(true);
  const {
    viewport,
    containerRef,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    zoomIn,
    zoomOut,
    resetView,
    isPanning,
    wasDrag,
  } = usePanZoom(layout.bounds, { resetToken, autoFit });

  const [hoverEdge, setHoverEdge] = useState<HoverEdge | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(true);

  // Edge types that actually appear in the rendered layout. The legend
  // filters to this set so the panel stays compact and only mentions
  // colours the user is currently looking at.
  const visibleEdgeTypes = useMemo(() => {
    const types = new Set<string>();
    layout.edges.forEach((edge) => types.add(edge.type.trim().toLowerCase()));
    return types;
  }, [layout.edges]);

  const legendEntries = useMemo(
    () => OBJECT_MAP_EDGE_KINDS.filter((entry) => visibleEdgeTypes.has(entry.type)),
    [visibleEdgeTypes]
  );

  // Clear selection if it points at a node that no longer exists (e.g.
  // after a refresh removed it). Layout drives the canonical node set.
  React.useEffect(() => {
    if (activeNodeId === null) return;
    if (!layout.nodes.some((n) => n.id === activeNodeId)) {
      setActiveNodeId(null);
    }
  }, [layout.nodes, activeNodeId]);

  // Pre-index edges by direction for the selection-trace BFS. Each
  // node has separate lists of outgoing and incoming edges so the
  // forward and backward chains can each walk in their own direction
  // only.
  const adjacency = useMemo(() => {
    const outgoing = new Map<string, Array<{ edgeId: string; neighbor: string }>>();
    const incoming = new Map<string, Array<{ edgeId: string; neighbor: string }>>();
    layout.edges.forEach((edge) => {
      let outs = outgoing.get(edge.sourceId);
      if (!outs) {
        outs = [];
        outgoing.set(edge.sourceId, outs);
      }
      outs.push({ edgeId: edge.id, neighbor: edge.targetId });
      let ins = incoming.get(edge.targetId);
      if (!ins) {
        ins = [];
        incoming.set(edge.targetId, ins);
      }
      ins.push({ edgeId: edge.id, neighbor: edge.sourceId });
    });
    return { outgoing, incoming };
  }, [layout.edges]);

  // Selection trace: from the active node, walk the forward chain via
  // outgoing edges only, AND the backward chain via incoming edges
  // only. Each chain is a separate BFS — once a node enters the
  // forward chain, we keep walking forward from it (its outgoing); a
  // node in the backward chain only walks backward (its incoming).
  // Result: clicking a Pod highlights its ancestors (RS, Deployment,
  // HPA), the things routing to it (Service, Ingress), AND its
  // dependencies (CMs, PVC → PV, Node) — but NOT sibling Pods of the
  // same RS, since reaching them would require going forward from RS
  // (which is in the backward chain).
  const selectionState: SelectionState = useMemo(() => {
    if (activeNodeId === null) return EMPTY_SELECTION;
    const connectedIds = new Set<string>();
    const connectedEdgeIds = new Set<string>();

    // Forward chain — walks only outgoing edges.
    const forwardVisited = new Set<string>([activeNodeId]);
    const forwardQueue: string[] = [activeNodeId];
    while (forwardQueue.length > 0) {
      const u = forwardQueue.shift()!;
      const outs = adjacency.outgoing.get(u);
      if (!outs) continue;
      for (const { edgeId, neighbor } of outs) {
        connectedEdgeIds.add(edgeId);
        if (forwardVisited.has(neighbor)) continue;
        forwardVisited.add(neighbor);
        connectedIds.add(neighbor);
        forwardQueue.push(neighbor);
      }
    }

    // Backward chain — walks only incoming edges. Independent of the
    // forward chain; a node reachable via both gets added to both
    // visited sets, which is fine — we only union into connectedIds.
    const backwardVisited = new Set<string>([activeNodeId]);
    const backwardQueue: string[] = [activeNodeId];
    while (backwardQueue.length > 0) {
      const u = backwardQueue.shift()!;
      const ins = adjacency.incoming.get(u);
      if (!ins) continue;
      for (const { edgeId, neighbor } of ins) {
        connectedEdgeIds.add(edgeId);
        if (backwardVisited.has(neighbor)) continue;
        backwardVisited.add(neighbor);
        connectedIds.add(neighbor);
        backwardQueue.push(neighbor);
      }
    }

    return { activeId: activeNodeId, connectedIds, connectedEdgeIds };
  }, [activeNodeId, adjacency]);

  const handleNodeClick = useCallback((id: string) => {
    setActiveNodeId((prev) => (prev === id ? null : id));
  }, []);

  const clearHoverEdge = useCallback(() => {
    setHoverEdge(null);
  }, []);

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent) => {
      // Releasing a pan also fires a click; ignore those so the pan
      // doesn't unintentionally clear a selection the user is reading.
      if (wasDrag()) return;
      // Node groups stop propagation on their own click handlers, so
      // anything that bubbles up here is a background click.
      const target = event.target as Element | null;
      if (target && target.closest('g.object-map-node')) {
        return;
      }
      setActiveNodeId(null);
    },
    [wasDrag]
  );

  if (layout.nodes.length === 0) {
    return (
      <div className="object-map object-map--empty" data-testid="object-map-empty">
        <p>No related objects found.</p>
      </div>
    );
  }

  return (
    <div className="object-map" data-testid="object-map">
      <div className="object-map__toolbar">
        <button
          type="button"
          className="object-map__toolbar-button"
          onClick={zoomOut}
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="object-map__toolbar-button"
          onClick={zoomIn}
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="object-map__toolbar-button"
          onClick={resetView}
          title={
            autoFit
              ? 'Fit to view (auto-fit is on; turn it off to use this manually)'
              : 'Fit to view'
          }
          disabled={autoFit}
        >
          Fit
        </button>
        <button
          type="button"
          className={`object-map__toolbar-button ${
            autoFit ? 'object-map__toolbar-button--active' : ''
          }`}
          onClick={() => setAutoFit((prev) => !prev)}
          title={
            autoFit
              ? 'Auto-fit on (viewport recenters when the graph changes)'
              : 'Auto-fit off (your pan/zoom is preserved across changes)'
          }
          aria-pressed={autoFit}
        >
          Auto-fit
        </button>
        <button
          type="button"
          className={`object-map__toolbar-button ${
            showLegend ? 'object-map__toolbar-button--active' : ''
          }`}
          onClick={() => setShowLegend((prev) => !prev)}
          title={showLegend ? 'Hide legend' : 'Show legend'}
          aria-pressed={showLegend}
        >
          Legend
        </button>
        {onRefresh && (
          <button
            type="button"
            className="object-map__toolbar-button"
            onClick={onRefresh}
            title="Refresh"
            disabled={isRefreshing}
          >
            Refresh
          </button>
        )}
      </div>
      <div
        ref={containerRef}
        className={`object-map__canvas ${isPanning ? 'object-map__canvas--panning' : ''}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={handleCanvasClick}
      >
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
                    setHoverEdge({
                      midX: edge.midX,
                      midY: edge.midY,
                      label: edge.label,
                      type: edge.type,
                      tracedBy: edge.tracedBy,
                    })
                  }
                  onMouseLeave={clearHoverEdge}
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
                  onSelect={handleNodeClick}
                  onToggleGroup={handleToggleGroup}
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
                  <text
                    className="object-map__edge-tooltip-trace"
                    x={0}
                    y={-12}
                    textAnchor="middle"
                  >
                    {truncate(hoverEdge.tracedBy, TOOLTIP_TRACE_MAX_CHARS)}
                  </text>
                )}
              </g>
            )}
          </g>
        </svg>
        {showLegend && legendEntries.length > 0 && (
          <div className="object-map__legend" role="region" aria-label="Edge color legend">
            {legendEntries.map((entry) => (
              <div key={entry.type} className="object-map__legend-row">
                <svg className="object-map__legend-swatch" width={26} height={6} aria-hidden="true">
                  <line x1={0} y1={3} x2={26} y2={3} className={objectMapEdgeClass(entry.type)} />
                </svg>
                <span className="object-map__legend-label">{entry.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {payload.truncated && (
        <div className="object-map__banner object-map__banner--truncated">
          Showing {layout.nodes.length} of many. Increase the depth/node limits to see more.
        </div>
      )}
      {payload.warnings && payload.warnings.length > 0 && (
        <details className="object-map__warnings">
          <summary>
            {payload.warnings.length} warning{payload.warnings.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {payload.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

export default ObjectMap;
