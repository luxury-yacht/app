/**
 * frontend/src/modules/object-map/ObjectMap.tsx
 *
 * Self-contained graph renderer for the object-map snapshot. Takes a
 * payload as a prop and owns nothing about how the data was fetched.
 * The wrapping MapTab manages refresh/scope/lifecycle so this component
 * can be relocated into a different host without rewiring.
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
  computeObjectMapLayout,
  type PositionedEdge,
  type PositionedNode,
} from './objectMapLayout';
import { objectMapEdgeClass } from './objectMapEdgeStyle';
import { usePanZoom } from './usePanZoom';

export interface ObjectMapProps {
  payload: ObjectMapSnapshotPayload;
  // Forces a refit when bumped — wire to a host's "Reset view" trigger.
  resetToken?: number;
}

interface HoverEdge {
  midX: number;
  midY: number;
  label: string;
  type: string;
  tracedBy?: string;
}

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

const ObjectMapNodeCard: React.FC<{
  node: PositionedNode;
  className: string;
  onClick: (id: string) => void;
}> = ({ node, className, onClick }) => {
  const handleClick = useCallback(() => {
    onClick(node.id);
  }, [node.id, onClick]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick(node.id);
      }
    },
    [node.id, onClick]
  );

  // Stop pan-drag from kicking in when the user click-drags a node. The
  // outer pointer-handlers run on the SVG background; node interactions
  // shouldn't double as a pan.
  const stopPointer = useCallback((event: React.PointerEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerDown={stopPointer}
      onPointerUp={stopPointer}
      title={`${node.ref.kind}: ${node.ref.name}`}
    >
      <div className="object-map-node__kind">{node.ref.kind}</div>
      <div className="object-map-node__name">{node.ref.name}</div>
      <div className="object-map-node__namespace">{formatNamespace(node.ref)}</div>
    </button>
  );
};

const ObjectMap: React.FC<ObjectMapProps> = ({ payload, resetToken = 0 }) => {
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

  const layout = useMemo(
    () => computeObjectMapLayout(payload.nodes, payload.edges, seedId),
    [payload.nodes, payload.edges, seedId]
  );

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
  } = usePanZoom(layout.bounds, { resetToken });

  const [hoverEdge, setHoverEdge] = useState<HoverEdge | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  // Clear selection if it points at a node that no longer exists (e.g.
  // after a refresh removed it). Layout drives the canonical node set.
  React.useEffect(() => {
    if (activeNodeId === null) return;
    if (!layout.nodes.some((n) => n.id === activeNodeId)) {
      setActiveNodeId(null);
    }
  }, [layout.nodes, activeNodeId]);

  // Pre-index edges for O(1) lookup of "what's connected to node X" so
  // the per-node className computation in render stays cheap even on
  // graphs near the 1000-node backend cap.
  const adjacency = useMemo(() => {
    const nodesByNeighbor = new Map<string, Set<string>>();
    const edgesByNode = new Map<string, Set<string>>();
    layout.edges.forEach((edge) => {
      let aNeighbors = nodesByNeighbor.get(edge.sourceId);
      if (!aNeighbors) {
        aNeighbors = new Set();
        nodesByNeighbor.set(edge.sourceId, aNeighbors);
      }
      aNeighbors.add(edge.targetId);
      let bNeighbors = nodesByNeighbor.get(edge.targetId);
      if (!bNeighbors) {
        bNeighbors = new Set();
        nodesByNeighbor.set(edge.targetId, bNeighbors);
      }
      bNeighbors.add(edge.sourceId);
      let aEdges = edgesByNode.get(edge.sourceId);
      if (!aEdges) {
        aEdges = new Set();
        edgesByNode.set(edge.sourceId, aEdges);
      }
      aEdges.add(edge.id);
      let bEdges = edgesByNode.get(edge.targetId);
      if (!bEdges) {
        bEdges = new Set();
        edgesByNode.set(edge.targetId, bEdges);
      }
      bEdges.add(edge.id);
    });
    return { nodesByNeighbor, edgesByNode };
  }, [layout.edges]);

  const selectionState: SelectionState = useMemo(() => {
    if (activeNodeId === null) return EMPTY_SELECTION;
    return {
      activeId: activeNodeId,
      connectedIds: adjacency.nodesByNeighbor.get(activeNodeId) ?? new Set(),
      connectedEdgeIds: adjacency.edgesByNode.get(activeNodeId) ?? new Set(),
    };
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
      // Node buttons stop their click propagation, so anything that
      // bubbles up to the canvas is by definition a background click.
      // Defensive check kept for safety against future markup changes.
      const target = event.target as Element | null;
      if (target && target.closest('button.object-map-node')) {
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
          title="Fit to view"
        >
          Fit
        </button>
        <span className="object-map__toolbar-meta">
          {layout.nodes.length} nodes · {layout.edges.length} edges
        </span>
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
                <foreignObject
                  key={node.id}
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                >
                  <ObjectMapNodeCard
                    node={node}
                    className={buildNodeClass(node, selectionState)}
                    onClick={handleNodeClick}
                  />
                </foreignObject>
              ))}
            </g>
            {hoverEdge && (
              <g
                className="object-map__edge-tooltip"
                transform={`translate(${hoverEdge.midX} ${hoverEdge.midY})`}
              >
                <foreignObject x={-100} y={-44} width={200} height={48}>
                  <div className="object-map__edge-tooltip-card">
                    <div className="object-map__edge-tooltip-label">{hoverEdge.label}</div>
                    {hoverEdge.tracedBy && (
                      <div className="object-map__edge-tooltip-trace">{hoverEdge.tracedBy}</div>
                    )}
                  </div>
                </foreignObject>
              </g>
            )}
          </g>
        </svg>
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
