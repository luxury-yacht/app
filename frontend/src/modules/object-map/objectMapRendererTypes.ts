import type { ObjectMapReference } from '@core/refresh/types';
import type { PositionedNode } from './objectMapLayout';

export interface ObjectMapHoverEdge {
  midX: number;
  midY: number;
  label: string;
  type: string;
  tracedBy?: string;
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

export type ObjectMapNodeBadgeLookup = (nodeId: string) => ObjectMapNodeBadge | null;

export type ObjectMapNodeDragStart = (node: PositionedNode, pointer: ObjectMapPointer) => void;
export type ObjectMapNodeDragMove = (pointer: ObjectMapPointer) => void;
export type ObjectMapNodeDragEnd = (pointer: ObjectMapPointer) => void;

export type ObjectMapObjectAction = (ref: ObjectMapReference) => void;

export interface ObjectMapViewportControls {
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
}
