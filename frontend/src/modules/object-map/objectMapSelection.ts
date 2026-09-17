/**
 * frontend/src/modules/object-map/objectMapSelection.ts
 *
 * Computes selected and connected object-map node/edge state.
 */

import type { PositionedEdge } from './objectMapLayout';
import type { ObjectMapSelectionState } from './objectMapRendererTypes';
import {
  appendDirectionalEdge,
  collectDirectionalConnections,
  type DirectionalAdjacency,
} from './objectMapTraversal';

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

  const adjacency: DirectionalAdjacency = { outgoing: new Map(), incoming: new Map() };
  edges.forEach((edge) => {
    appendDirectionalEdge(adjacency, edge.id, edge.sourceId, edge.targetId);
  });

  return { activeId: activeNodeId, ...collectDirectionalConnections(activeNodeId, adjacency) };
};
