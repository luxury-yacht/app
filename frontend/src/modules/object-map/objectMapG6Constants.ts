/**
 * frontend/src/modules/object-map/objectMapG6Constants.ts
 *
 * Shared extension names for custom G6 object-map elements.
 */

export const OBJECT_MAP_G6_CARD_NODE = 'object-map-card';
export const OBJECT_MAP_G6_PATH_EDGE = 'object-map-path-edge';

export type ObjectMapG6CardDetailLevel = 'full' | 'compact' | 'minimal';
export type ObjectMapG6EdgeDetailLevel = 'routed' | 'simple';

// Cards always keep their shape and scale naturally with zoom; only the card
// CONTENTS (text, badges) drop out as zoom decreases.
export const objectMapG6CardDetailLevelForZoom = (zoom: number): ObjectMapG6CardDetailLevel => {
  if (zoom >= 0.75) {
    return 'full';
  }
  if (zoom >= 0.45) {
    return 'compact';
  }
  return 'minimal';
};
