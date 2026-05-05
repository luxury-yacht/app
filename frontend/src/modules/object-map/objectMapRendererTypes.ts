/**
 * frontend/src/modules/object-map/objectMapRendererTypes.ts
 *
 * Shared object-map renderer contracts used by the map shell and G6 renderer.
 */

import type { ObjectMapReference } from '@core/refresh/types';
import type { ObjectMapFilteredPath } from './objectMapKindFilter';
import type { PositionedNode } from './objectMapLayout';

export interface ObjectMapHoverEdge {
  tooltipX: number;
  tooltipY: number;
  sourceLabel: string;
  sourceKind: string;
  label: string;
  targetLabel: string;
  targetKind: string;
  type: string;
  tracedBy?: string;
  filteredPath?: ObjectMapFilteredPath;
}

export interface ObjectMapSelectionState {
  activeId: string | null;
  connectedIds: Set<string>;
  connectedEdgeIds: Set<string>;
}

export interface ObjectMapNodeBadge {
  /** Deployment id whose RS group this badge controls. */
  deploymentId: string;
  /** Number of RSs hidden when the group is collapsed. */
  hiddenCount: number;
  /** True when the group is currently expanded. */
  expanded: boolean;
}

export interface ObjectMapPointer {
  pointerId: number;
  button?: number;
  clientX: number;
  clientY: number;
  /** Renderer-local layout coordinate for drag math. */
  layoutX?: number;
  /** Renderer-local layout coordinate for drag math. */
  layoutY?: number;
}

export interface ObjectMapContextMenuRequest {
  ref: ObjectMapReference;
  position: { x: number; y: number };
}

export interface ObjectMapCanvasContextMenuRequest {
  position: { x: number; y: number };
}

export type ObjectMapNodeBadgeLookup = (nodeId: string) => ObjectMapNodeBadge | null;

export type ObjectMapNodeDragStart = (node: PositionedNode, pointer: ObjectMapPointer) => void;
export type ObjectMapNodeDragMove = (pointer: ObjectMapPointer) => void;
export type ObjectMapNodeDragEnd = (pointer: ObjectMapPointer) => void;

export type ObjectMapObjectAction = (ref: ObjectMapReference) => void;

export type ObjectMapContextMenuAction = (request: ObjectMapContextMenuRequest) => void;

export type ObjectMapCanvasContextMenuAction = (request: ObjectMapCanvasContextMenuRequest) => void;

export interface ObjectMapViewportControls {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  fitToView: () => void;
  focusNode: (nodeId: string) => void;
}

export type ObjectMapViewportChangeAction = () => void;
