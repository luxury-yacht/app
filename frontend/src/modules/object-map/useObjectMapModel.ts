import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ObjectMapSnapshotPayload } from '@core/refresh/types';
import {
  computeCollapseInfo,
  filterByCollapseInfo,
  type DeploymentGroup,
} from './objectMapCollapse';
import { dedupeServiceEdges } from './objectMapDedupe';
import { filterByDirectionalReachability } from './objectMapDirectionalFilter';
import {
  computeObjectMapBounds,
  computeObjectMapLayout,
  routeObjectMapEdges,
  type ObjectMapLayout,
  type PositionedNode,
} from './objectMapLayout';
import { computeObjectMapSelectionState } from './objectMapSelection';
import type {
  ObjectMapHoverEdge,
  ObjectMapNodeBadge,
  ObjectMapPointer,
} from './objectMapRendererTypes';

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

const NODE_DRAG_THRESHOLD_PX = 3;

export const useObjectMapModel = (payload: ObjectMapSnapshotPayload) => {
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

  const dedupedEdges = useMemo(
    () => dedupeServiceEdges(payload.nodes, payload.edges),
    [payload.nodes, payload.edges]
  );

  const directionallyReachable = useMemo(
    () => filterByDirectionalReachability(payload.nodes, dedupedEdges, seedId),
    [payload.nodes, dedupedEdges, seedId]
  );

  const collapseInfo = useMemo(
    () =>
      computeCollapseInfo(
        directionallyReachable.nodes,
        directionallyReachable.edges,
        seedId,
        expandedDeployments
      ),
    [directionallyReachable.nodes, directionallyReachable.edges, seedId, expandedDeployments]
  );

  const collapsed = useMemo(
    () =>
      filterByCollapseInfo(
        directionallyReachable.nodes,
        directionallyReachable.edges,
        collapseInfo.visibleNodeIds
      ),
    [directionallyReachable.nodes, directionallyReachable.edges, collapseInfo.visibleNodeIds]
  );

  const filtered = useMemo(
    // Collapse can remove the only edge connecting a Pod dependency
    // (for example its scheduled Node). Prune again so hidden ReplicaSet
    // branches do not leave disconnected remnants in the rendered graph.
    () => filterByDirectionalReachability(collapsed.nodes, collapsed.edges, seedId),
    [collapsed.nodes, collapsed.edges, seedId]
  );

  const baseLayout = useMemo(
    () => computeObjectMapLayout(filtered.nodes, filtered.edges, seedId),
    [filtered.nodes, filtered.edges, seedId]
  );

  const [nodePositionOverrides, setNodePositionOverrides] = useState<NodePositionOverrides>(
    () => new Map()
  );
  const nodeDragRef = useRef<NodeDragState | null>(null);
  const suppressNextNodeClickRef = useRef(false);

  useEffect(() => {
    setNodePositionOverrides(new Map());
    nodeDragRef.current = null;
    suppressNextNodeClickRef.current = false;
  }, [filtered.nodes, filtered.edges]);

  const layout: ObjectMapLayout = useMemo(() => {
    if (nodePositionOverrides.size === 0) {
      return baseLayout;
    }
    const nodes = baseLayout.nodes.map((node) => {
      const override = nodePositionOverrides.get(node.id);
      if (!override) return node;
      return { ...node, x: override.x, y: override.y };
    });
    return {
      nodes,
      edges: routeObjectMapEdges(nodes, filtered.edges),
      bounds: computeObjectMapBounds(nodes),
    };
  }, [baseLayout, filtered.edges, nodePositionOverrides]);

  const badgeForNode = useCallback(
    (nodeId: string): ObjectMapNodeBadge | null => {
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

  const [hoverEdge, setHoverEdge] = useState<ObjectMapHoverEdge | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (activeNodeId === null) return;
    if (!layout.nodes.some((n) => n.id === activeNodeId)) {
      setActiveNodeId(null);
    }
  }, [layout.nodes, activeNodeId]);

  const selectionState = useMemo(
    () => computeObjectMapSelectionState(layout.edges, activeNodeId),
    [layout.edges, activeNodeId]
  );

  const selectNode = useCallback((id: string) => {
    if (suppressNextNodeClickRef.current) {
      suppressNextNodeClickRef.current = false;
      return;
    }
    setActiveNodeId((prev) => (prev === id ? null : id));
  }, []);

  const focusNode = useCallback(
    (id: string) => {
      if (!layout.nodes.some((node) => node.id === id)) return;
      setActiveNodeId(id);
    },
    [layout.nodes]
  );

  const startNodeDrag = useCallback((node: PositionedNode, pointer: ObjectMapPointer) => {
    if (pointer.button !== 0) return;
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
    if (!drag || drag.pointerId !== pointer.pointerId) return;
    const dxScreen = pointer.clientX - drag.originClientX;
    const dyScreen = pointer.clientY - drag.originClientY;
    if (!drag.didDrag && Math.hypot(dxScreen, dyScreen) >= NODE_DRAG_THRESHOLD_PX) {
      drag.didDrag = true;
      setAutoFit(false);
    }
    if (!drag.didDrag) return;
    const hasLayoutCoordinates =
      drag.originLayoutX !== undefined &&
      drag.originLayoutY !== undefined &&
      pointer.layoutX !== undefined &&
      pointer.layoutY !== undefined;
    const dxLayout = hasLayoutCoordinates ? pointer.layoutX! - drag.originLayoutX! : dxScreen;
    const dyLayout = hasLayoutCoordinates ? pointer.layoutY! - drag.originLayoutY! : dyScreen;
    const nextX = drag.startX + dxLayout;
    const nextY = drag.startY + dyLayout;
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
    if (!drag || drag.pointerId !== pointer.pointerId) return;
    if (drag.didDrag) {
      suppressNextNodeClickRef.current = true;
    }
    nodeDragRef.current = null;
  }, []);

  const resetLayout = useCallback(() => {
    setNodePositionOverrides(new Map());
    nodeDragRef.current = null;
    suppressNextNodeClickRef.current = false;
  }, []);

  const clearHoverEdge = useCallback(() => {
    setHoverEdge(null);
  }, []);

  const clearSelection = useCallback(() => {
    setActiveNodeId(null);
  }, []);

  return {
    layout,
    badgeForNode,
    autoFit,
    setAutoFit,
    hoverEdge,
    setHoverEdge,
    clearHoverEdge,
    selectionState,
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
