/**
 * frontend/src/modules/object-map/useObjectMapModel.ts
 *
 * State model for object-map layout, selection, hover, collapse groups,
 * manual positioning, and auto-fit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeCollapseInfo,
  type DeploymentGroup,
  filterByCollapseInfo,
} from './objectMapCollapse';
import {
  computeObjectMapLayout,
  type ObjectMapLayout,
  type PositionedNode,
} from './objectMapLayout';
import { OBJECT_MAP_NODE_DRAG_THRESHOLD_PX } from './objectMapNodeGesture';
import type { NormalizedObjectMapPayload } from './objectMapPayload';
import type {
  ObjectMapHoverEdge,
  ObjectMapNodeBadge,
  ObjectMapPointer,
} from './objectMapRendererTypes';
import { filterByLineage } from './objectMapTraversal';

type NodePositionOverrides = Map<string, { x: number; y: number }>;

interface NodeDragState {
  pointerId: number;
  nodeId: string;
  originClientX: number;
  originClientY: number;
  originLayoutX?: number;
  originLayoutY?: number;
  startX: number;
  startY: number;
  didDrag: boolean;
}

// nodeDragDelta measures a drag in layout units when the renderer reports
// layout coordinates, else in screen pixels.
const nodeDragDelta = (
  drag: NodeDragState,
  pointer: ObjectMapPointer
): { x: number; y: number; screenDistance: number } => {
  const dxScreen = pointer.clientX - drag.originClientX;
  const dyScreen = pointer.clientY - drag.originClientY;
  const { originLayoutX, originLayoutY } = drag;
  const { layoutX, layoutY } = pointer;
  return {
    x: originLayoutX !== undefined && layoutX !== undefined ? layoutX - originLayoutX : dxScreen,
    y: originLayoutY !== undefined && layoutY !== undefined ? layoutY - originLayoutY : dyScreen,
    screenDistance: Math.hypot(dxScreen, dyScreen),
  };
};

export const useObjectMapModel = (payload: NormalizedObjectMapPayload) => {
  const seedId = useMemo(() => {
    const ref = payload.seed;
    const namespace = ref.namespace ?? '';
    return (
      payload.nodes.find((node) => {
        const r = node.ref;
        if (r.clusterId !== ref.clusterId) {
          return false;
        }
        if (r.uid && ref.uid) {
          return r.uid === ref.uid;
        }
        return (
          r.kind === ref.kind &&
          r.name === ref.name &&
          (r.namespace ?? '') === namespace &&
          r.group === ref.group &&
          r.version === ref.version
        );
      })?.id ?? ''
    );
  }, [payload]);

  const [expandedDeployments, setExpandedDeployments] = useState<Set<string>>(() => new Set());

  const toggleGroup = useCallback((deploymentId: string) => {
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

  // The backend owns map membership; collapse is the only view control that
  // removes objects before layout.
  const collapseInfo = useMemo(
    () => computeCollapseInfo(payload.nodes, payload.edges, seedId, expandedDeployments),
    [payload.nodes, payload.edges, seedId, expandedDeployments]
  );

  const collapsed = useMemo(
    () => filterByCollapseInfo(payload.nodes, payload.edges, collapseInfo.visibleNodeIds),
    [payload.nodes, payload.edges, collapseInfo.visibleNodeIds]
  );

  const filtered = useMemo(
    // Hiding a collapsed ReplicaSet can strand an object reachable only
    // through it (for example a ConfigMap its old pod template used). Apply the
    // map's one rule again to what is still shown.
    () => filterByLineage(collapsed.nodes, collapsed.edges, seedId),
    [collapsed.nodes, collapsed.edges, seedId]
  );

  // The computed layout before pins; visible state applies pins in every view.
  const layout: ObjectMapLayout = useMemo(
    () => computeObjectMapLayout(filtered.nodes, filtered.edges, seedId),
    [filtered.nodes, filtered.edges, seedId]
  );

  const [nodePositionOverrides, setNodePositionOverrides] = useState<NodePositionOverrides>(
    () => new Map()
  );
  const nodeDragRef = useRef<NodeDragState | null>(null);

  const resetLayout = useCallback(() => {
    setNodePositionOverrides(new Map());
    nodeDragRef.current = null;
  }, []);

  // Pins survive refreshes; only objects that left the graph lose theirs.
  useEffect(() => {
    const present = new Set(payload.nodes.map((node) => node.id));
    setNodePositionOverrides((previous) => {
      if (Array.from(previous.keys()).every((id) => present.has(id))) {
        return previous;
      }
      return new Map(Array.from(previous).filter(([id]) => present.has(id)));
    });
  }, [payload.nodes]);

  const badgeForNode = useCallback(
    (nodeId: string): ObjectMapNodeBadge | null => {
      const group: DeploymentGroup | undefined = collapseInfo.groupsByCurrentRs.get(nodeId);
      if (!group) {
        return null;
      }
      return {
        deploymentId: group.deploymentId,
        hiddenCount: group.collapsibleRsIds.length,
        expanded: expandedDeployments.has(group.deploymentId),
      };
    },
    [collapseInfo.groupsByCurrentRs, expandedDeployments]
  );

  const [autoFit, setAutoFit] = useState(true);

  const [hoverEdge, setHoverEdge] = useState<ObjectMapHoverEdge | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (activeNodeId === null) {
      return;
    }
    if (!layout.nodes.some((n) => n.id === activeNodeId)) {
      setActiveNodeId(null);
    }
  }, [layout.nodes, activeNodeId]);

  const selectNode = useCallback((id: string) => {
    setActiveNodeId((prev) => (prev === id ? null : id));
  }, []);

  const focusNode = useCallback(
    (id: string) => {
      if (!layout.nodes.some((node) => node.id === id)) {
        return;
      }
      setActiveNodeId(id);
    },
    [layout.nodes]
  );

  const startNodeDrag = useCallback((node: PositionedNode, pointer: ObjectMapPointer) => {
    if (pointer.button !== 0) {
      return;
    }
    nodeDragRef.current = {
      pointerId: pointer.pointerId,
      nodeId: node.id,
      originClientX: pointer.clientX,
      originClientY: pointer.clientY,
      originLayoutX: pointer.layoutX,
      originLayoutY: pointer.layoutY,
      startX: node.x,
      startY: node.y,
      didDrag: false,
    };
  }, []);

  const moveNodeDrag = useCallback((pointer: ObjectMapPointer) => {
    const drag = nodeDragRef.current;
    if (drag?.pointerId !== pointer.pointerId) {
      return;
    }
    const delta = nodeDragDelta(drag, pointer);
    if (!drag.didDrag && delta.screenDistance >= OBJECT_MAP_NODE_DRAG_THRESHOLD_PX) {
      drag.didDrag = true;
      setAutoFit(false);
    }
    if (!drag.didDrag) {
      return;
    }
    const nextX = drag.startX + delta.x;
    const nextY = drag.startY + delta.y;
    setNodePositionOverrides((prev) => {
      const current = prev.get(drag.nodeId);
      if (current && current.x === nextX && current.y === nextY) {
        return prev;
      }
      const next = new Map(prev);
      next.set(drag.nodeId, { x: nextX, y: nextY });
      return next;
    });
  }, []);

  const endNodeDrag = useCallback((pointer: ObjectMapPointer) => {
    const drag = nodeDragRef.current;
    if (drag?.pointerId !== pointer.pointerId) {
      return;
    }
    nodeDragRef.current = null;
  }, []);

  const clearHoverEdge = useCallback(() => {
    setHoverEdge(null);
  }, []);

  const clearSelection = useCallback(() => {
    setActiveNodeId(null);
  }, []);

  return {
    layout,
    pinnedPositions: nodePositionOverrides as ReadonlyMap<string, { x: number; y: number }>,
    seedId,
    badgeForNode,
    autoFit,
    setAutoFit,
    hoverEdge,
    setHoverEdge,
    clearHoverEdge,
    activeNodeId,
    selectNode,
    focusNode,
    toggleGroup,
    startNodeDrag,
    moveNodeDrag,
    endNodeDrag,
    resetLayout,
    clearSelection,
    hasNodePositionOverrides: nodePositionOverrides.size > 0,
  };
};
