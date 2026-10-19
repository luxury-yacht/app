/**
 * frontend/src/modules/object-map/objectMapSelection.ts
 *
 * Computes selected and connected object-map node/edge state.
 */

import type { PositionedEdge } from './objectMapLayout';
import type { ObjectMapSelectionState } from './objectMapRendererTypes';
import { collectLineage } from './objectMapTraversal';

const EMPTY_SELECTION: ObjectMapSelectionState = {
  activeId: null,
  connectedIds: new Set(),
  connectedEdgeIds: new Set(),
};

export const isObjectMapEdgeDimmedBySelection = (
  selectionState: ObjectMapSelectionState,
  edgeId: string
): boolean => selectionState.activeId !== null && !selectionState.connectedEdgeIds.has(edgeId);

export const computeObjectMapSelectionState = (
  edges: PositionedEdge[],
  activeNodeId: string | null
): ObjectMapSelectionState => {
  if (activeNodeId === null) {
    return EMPTY_SELECTION;
  }

  // The active object's lineage, with every link between its objects, as on
  // the map itself.
  const { nodeIds, edgeIds } = collectLineage(
    activeNodeId,
    edges.map((edge) => ({ id: edge.id, source: edge.sourceId, target: edge.targetId }))
  );
  nodeIds.delete(activeNodeId);
  return { activeId: activeNodeId, connectedIds: nodeIds, connectedEdgeIds: edgeIds };
};
