/**
 * frontend/src/modules/object-map/objectMapEdgeStyle.ts
 *
 * Maps backend edge `type` values to a CSS class so each edge picks up
 * the right stroke colour from ObjectMap.css. Keep this list in sync
 * with the tracer categories in backend/refresh/snapshot/object_map.go.
 */

const KNOWN_EDGE_TYPES = new Set([
  'owner',
  'selector',
  'endpoint',
  'schedules',
  'uses',
  'mounts',
  'storage',
  'routes',
  'scales',
]);

export const objectMapEdgeClass = (edgeType: string): string => {
  const normalized = edgeType.trim().toLowerCase();
  const variant = KNOWN_EDGE_TYPES.has(normalized) ? normalized : 'default';
  return `object-map-edge object-map-edge--${variant}`;
};
