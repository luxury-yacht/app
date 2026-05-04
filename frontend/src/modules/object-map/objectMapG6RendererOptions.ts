/**
 * frontend/src/modules/object-map/objectMapG6RendererOptions.ts
 *
 * Pure G6 renderer options and layout lookup helpers for the object-map
 * renderer.
 */

import { OBJECT_MAP_G6_CARD_NODE } from './objectMapG6Constants';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import type { ObjectMapLayout, PositionedEdge, PositionedNode } from './objectMapLayout';

export const findObjectMapG6Node = (layout: ObjectMapLayout, id: string): PositionedNode | null =>
  layout.nodes.find((node) => node.id === id) ?? null;

export const findObjectMapG6Edge = (layout: ObjectMapLayout, id: string): PositionedEdge | null =>
  layout.edges.find((edge) => edge.id === id) ?? null;

export const objectMapG6NodeOptions = (palette: ObjectMapG6Palette) => ({
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

export const objectMapG6EdgeOptions = (palette: ObjectMapG6Palette) => ({
  state: {
    hovered: { lineWidth: palette.edgeHoveredLineWidth, opacity: palette.fullOpacity },
    highlighted: { lineWidth: palette.edgeHighlightedLineWidth, opacity: palette.fullOpacity },
    dimmed: { opacity: palette.edgeDimmedOpacity },
  },
});

export const objectMapG6EndpointLabel = (node: PositionedNode | null): string =>
  node ? node.ref.name : 'Unknown';

export const objectMapG6EndpointKind = (node: PositionedNode | null): string =>
  node?.ref.kind ?? 'Object';
