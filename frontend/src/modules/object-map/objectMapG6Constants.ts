/**
 * frontend/src/modules/object-map/objectMapG6Constants.ts
 *
 * Shared extension names for custom G6 object-map elements.
 */

export const OBJECT_MAP_G6_CARD_NODE = 'object-map-card';
export const OBJECT_MAP_G6_PATH_EDGE = 'object-map-path-edge';

export type ObjectMapG6CardDetailLevel = 'full' | 'compact' | 'minimal' | 'dot';
export type ObjectMapG6EdgeDetailLevel = 'routed' | 'simple';

export const objectMapG6CardDetailLevelForZoom = (zoom: number): ObjectMapG6CardDetailLevel => {
  if (zoom >= 0.75) return 'full';
  if (zoom >= 0.45) return 'compact';
  if (zoom >= 0.2) return 'minimal';
  return 'dot';
};
